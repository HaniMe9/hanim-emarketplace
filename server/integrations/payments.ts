/**
 * Mobile-money payment providers (Telebirr, CBE Birr, Awash) plus a sandbox.
 *
 * The sandbox is not a stub: it enforces idempotency, books a fee, and returns a
 * realistic reference, so reconciliation and refund paths behave the same way
 * they will against a real PSP. Only the network call differs.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentProviderConfig } from '../config.ts';
import { ProviderError } from '../lib/errors.ts';
import type { Metrics } from '../lib/metrics.ts';
import type { Logger } from '../lib/logger.ts';
import type { ChargeRequest, ChargeResult, PaymentProvider, RefundRequest, RefundResult, VerifyResult } from './types.ts';

/** Deterministic reference so a sandbox charge is traceable in reconciliation. */
const sandboxRef = (prefix: string, key: string) => `${prefix}_${createHmac('sha256', 'sandbox').update(key).digest('hex').slice(0, 16).toUpperCase()}`;

export class SandboxPaymentProvider implements PaymentProvider {
  readonly name = 'sandbox';
  readonly mode = 'sandbox' as const;
  private readonly feeRate: number;
  private readonly charges = new Map<string, ChargeResult>();

  constructor(feeRate: number) {
    this.feeRate = feeRate;
  }

  async charge(input: ChargeRequest): Promise<ChargeResult> {
    // Idempotency is enforced by the provider rather than trusted from the
    // caller: the same key resolves to the same charge even across a retry.
    const existing = this.charges.get(input.idempotencyKey);
    if (existing) return { ...existing, raw: { replayed: true } };

    const result: ChargeResult = {
      provider: this.name,
      providerRef: sandboxRef('CHG', input.idempotencyKey),
      state: 'succeeded',
      amount: input.amount,
      fee: Math.round(input.amount * this.feeRate),
      raw: { simulated: true, method: input.method },
    };
    this.charges.set(input.idempotencyKey, result);
    return result;
  }

  async refund(input: RefundRequest): Promise<RefundResult> {
    return {
      provider: this.name,
      providerRef: sandboxRef('RFD', input.idempotencyKey),
      state: 'succeeded',
      amount: input.amount,
      raw: { simulated: true, reason: input.reason },
    };
  }

  async verify(providerRef: string): Promise<VerifyResult> {
    for (const charge of this.charges.values()) {
      if (charge.providerRef === providerRef) {
        return { paid: charge.state === 'succeeded', providerRef, amount: charge.amount };
      }
    }
    return { paid: false, providerRef, amount: 0 };
  }

  verifySignature(_rawBody: Buffer, signature: string | undefined): boolean {
    // Sandbox accepts a fixed development signature so webhook tests run without
    // a provider account. The live path below is the real check.
    return signature === 'sandbox-signature';
  }
}

export class LivePaymentProvider implements PaymentProvider {
  readonly name: string;
  readonly mode = 'live' as const;
  // Declared as fields rather than constructor parameter properties: the build
  // runs with `erasableSyntaxOnly`, which forbids emit-only syntax so the same
  // source can be stripped of types by Node's type-stripping loader at runtime.
  private readonly cfg: PaymentProviderConfig;
  private readonly metrics: Metrics;
  private readonly log: Logger;

  constructor(cfg: PaymentProviderConfig, metrics: Metrics, log: Logger) {
    this.cfg = cfg;
    this.metrics = metrics;
    this.log = log;
    this.name = cfg.provider;
  }

  /**
   * POST with a bounded retry. Retries happen only for calls carrying an
   * idempotency key: without one, a timed-out request may still have been
   * accepted by the provider, and repeating it could charge a buyer twice.
   */
  private async call<T>(operation: string, path: string, body: unknown, idempotencyKey?: string): Promise<T> {
    const url = `${this.cfg.baseUrl.replace(/\/+$/, '')}${path}`;
    const attempts = idempotencyKey ? 3 : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
      try {
        const res = await fetch(url, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            'x-app-id': this.cfg.appId,
            'x-app-secret': this.cfg.appSecret,
            ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
          },
          body: JSON.stringify(body),
        });
        const text = await res.text();

        let parsed: unknown;
        try {
          parsed = text ? JSON.parse(text) : {};
        } catch {
          this.metrics.increment('provider_requests_total', { provider: this.name, operation, outcome: 'error' });
          throw new ProviderError(this.name, `Provider returned a non-JSON response (${res.status})`, { status: 502, cause: text.slice(0, 200) });
        }

        if (!res.ok) {
          const transient = res.status === 408 || res.status === 429 || res.status >= 500;
          const err = new ProviderError(this.name, `Provider rejected ${operation} with ${res.status}`, {
            status: transient ? 503 : 502,
            retryable: transient,
            detail: parsed,
          });
          if (!transient) {
            this.metrics.increment('provider_requests_total', { provider: this.name, operation, outcome: 'error' });
            throw err;
          }
          lastError = err;
        } else {
          this.metrics.increment('provider_requests_total', { provider: this.name, operation, outcome: 'success' });
          return parsed as T;
        }
      } catch (e) {
        if (e instanceof ProviderError && !e.retryable) throw e;
        lastError = e;
      } finally {
        clearTimeout(timer);
      }

      if (attempt < attempts) {
        this.log.debug('Retrying provider call', { provider: this.name, operation, attempt });
        // Backoff with a ceiling so a provider outage does not become a retry
        // storm from every instance simultaneously.
        await new Promise((r) => setTimeout(r, Math.min(250 * 2 ** (attempt - 1), 2000)));
      }
    }

    this.metrics.increment('provider_requests_total', { provider: this.name, operation, outcome: 'error' });
    if (lastError instanceof ProviderError) {
      this.log.warn('Payment provider call failed', {
        provider: this.name,
        operation,
        status: lastError.status,
        retryable: lastError.retryable,
      });
      throw lastError;
    }
    const message =
      lastError instanceof Error && lastError.name === 'AbortError'
        ? `${operation} timed out after ${this.cfg.timeoutMs}ms`
        : `${operation} could not reach the provider`;
    this.log.warn('Payment provider unreachable', { provider: this.name, operation, error: lastError });
    throw new ProviderError(this.name, message, { status: 503, retryable: true, cause: lastError });
  }

  async charge(input: ChargeRequest): Promise<ChargeResult> {
    const res = await this.call<Record<string, unknown>>(
      'charge',
      '/payments/charge',
      {
        reference: input.orderCode,
        internalRef: input.orderId,
        amount: input.amount,
        currency: 'ETB',
        channel: input.method,
        payer: { name: input.buyerName, phone: input.buyerPhone },
        description: input.description,
      },
      input.idempotencyKey,
    );
    const state = String(res.status ?? 'PENDING').toUpperCase();
    return {
      provider: this.name,
      providerRef: String(res.transactionId ?? res.id ?? ''),
      state: state === 'SUCCESS' ? 'succeeded' : state === 'FAILED' ? 'failed' : 'pending',
      amount: Number(res.amount ?? input.amount),
      fee: Number(res.fee ?? 0),
      confirmation: res.confirmationRequired
        ? {
            channel: 'sms',
            token: String(res.confirmationToken ?? ''),
            expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          }
        : undefined,
      raw: res,
    };
  }

  async refund(input: RefundRequest): Promise<RefundResult> {
    const res = await this.call<Record<string, unknown>>(
      'refund',
      '/payments/refund',
      { transactionId: input.providerRef, amount: input.amount, reason: input.reason },
      input.idempotencyKey,
    );
    const state = String(res.status ?? 'PENDING').toUpperCase();
    return {
      provider: this.name,
      providerRef: String(res.refundId ?? res.id ?? ''),
      state: state === 'SUCCESS' ? 'succeeded' : state === 'FAILED' ? 'failed' : 'pending',
      amount: Number(res.amount ?? input.amount),
      raw: res,
    };
  }

  async verify(providerRef: string): Promise<VerifyResult> {
    const url = `${this.cfg.baseUrl.replace(/\/+$/, '')}/payments/${encodeURIComponent(providerRef)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json', 'x-app-id': this.cfg.appId, 'x-app-secret': this.cfg.appSecret },
      });
      if (res.status === 404) return { paid: false, providerRef, amount: 0 };
      if (!res.ok) {
        throw new ProviderError(this.name, `Provider verification failed with ${res.status}`, {
          status: 502,
          retryable: res.status >= 500,
        });
      }
      const parsed = (await res.json()) as Record<string, unknown>;
      const state = String(parsed.status ?? '').toUpperCase();
      return {
        paid: state === 'SUCCESS' || state === 'SETTLED',
        providerRef,
        amount: Number(parsed.amount ?? 0),
        paidAt: parsed.settledAt ? String(parsed.settledAt) : undefined,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * HMAC-SHA256 over the exact bytes received, compared in constant time.
   * Verifying the parsed body instead would let a re-serialised payload pass a
   * check its bytes never earned.
   */
  verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected = createHmac('sha256', this.cfg.webhookSecret).update(rawBody).digest('hex');
    const provided = signature.replace(/^sha256=/, '');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(provided, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

export function createPaymentProvider(cfg: PaymentProviderConfig, metrics: Metrics, log: Logger): PaymentProvider {
  return cfg.mode === 'live' ? new LivePaymentProvider(cfg, metrics, log) : new SandboxPaymentProvider(cfg.feeRate);
}
