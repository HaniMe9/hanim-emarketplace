/**
 * Delivery carriers and the SMS gateway.
 *
 * Carriers differ in coverage rather than in the shape of the API, so one
 * adapter is configured with the provider list it is allowed to use and picks by
 * zone. The sandbox carrier books a plausible tracking reference and a delivery
 * estimate, which keeps the fulfilment and tracking screens working offline.
 */

import type { ShippingProviderConfig, SmsProviderConfig } from '../config.ts';
import { ProviderError } from '../lib/errors.ts';
import type { Metrics } from '../lib/metrics.ts';
import type { Logger } from '../lib/logger.ts';
import type { CreateShipmentRequest, SendSmsRequest, SendSmsResult, ShipmentBooking, ShipmentProvider, SmsProvider, TrackingResult } from './types.ts';

export class SandboxShipmentProvider implements ShipmentProvider {
  readonly name = 'sandbox_carrier';
  readonly mode = 'sandbox' as const;

  async book(input: CreateShipmentRequest): Promise<ShipmentBooking> {
    return {
      provider: input.partner,
      trackingRef: `HM${input.orderCode.replace(/\D/g, '').slice(0, 10)}ET`,
      status: 'created',
      estimatedAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      raw: { simulated: true, codAmount: input.codAmount },
    };
  }

  async track(): Promise<TrackingResult> {
    return { status: 'in_transit', events: [] };
  }
}

export class LiveShipmentProvider implements ShipmentProvider {
  readonly name: string;
  readonly mode = 'live' as const;
  // Fields rather than constructor parameter properties: the build runs with
  // `erasableSyntaxOnly`, which forbids emit-only syntax so the same source can
  // be type-stripped by Node at runtime.
  private readonly cfg: ShippingProviderConfig;
  private readonly metrics: Metrics;
  private readonly log: Logger;

  constructor(cfg: ShippingProviderConfig, metrics: Metrics, log: Logger) {
    this.cfg = cfg;
    this.metrics = metrics;
    this.log = log;
    this.name = cfg.providers.join(',');
  }

  private headers() {
    return { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${this.cfg.apiKey}` };
  }

  async book(input: CreateShipmentRequest): Promise<ShipmentBooking> {
    const url = `${this.cfg.baseUrl.replace(/\/+$/, '')}/shipments`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: this.headers(),
        body: JSON.stringify({
          reference: input.orderCode,
          carrier: input.partner,
          from: input.from,
          to: input.to,
          codAmount: input.codAmount,
          weightKg: input.weightKg,
        }),
      });
      const text = await res.text();
      const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      if (!res.ok) {
        this.metrics.increment('provider_requests_total', { provider: this.name, operation: 'book', outcome: 'error' });
        throw new ProviderError(this.name, `Carrier rejected the booking with ${res.status}`, {
          status: res.status >= 500 ? 503 : 502,
          retryable: res.status >= 500,
          detail: parsed,
        });
      }
      this.metrics.increment('provider_requests_total', { provider: this.name, operation: 'book', outcome: 'success' });
      return {
        provider: String(parsed.carrier ?? input.partner),
        trackingRef: String(parsed.trackingRef ?? parsed.id ?? ''),
        status: 'created',
        estimatedAt: String(parsed.estimatedAt ?? new Date(Date.now() + 3 * 86_400_000).toISOString()),
        raw: parsed,
      };
    } catch (e) {
      if (e instanceof ProviderError) {
        this.log.warn('Carrier booking failed', { carrier: input.partner, status: e.status });
        throw e;
      }
      throw new ProviderError(
        this.name,
        controller.signal.aborted ? `Carrier booking timed out after ${this.cfg.timeoutMs}ms` : 'Carrier is unreachable',
        { status: 503, cause: e },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async track(trackingRef: string): Promise<TrackingResult> {
    const url = `${this.cfg.baseUrl.replace(/\/+$/, '')}/shipments/${encodeURIComponent(trackingRef)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: this.headers() });
      if (res.status === 404) return { status: 'failed', events: [] };
      if (!res.ok) {
        throw new ProviderError(this.name, `Carrier tracking failed with ${res.status}`, { status: 502, retryable: res.status >= 500 });
      }
      const parsed = (await res.json()) as Record<string, unknown>;
      const rawStatus = String(parsed.status ?? 'in_transit').toLowerCase();
      const status: TrackingResult['status'] =
        rawStatus === 'delivered' ? 'delivered' : rawStatus === 'failed' ? 'failed' : rawStatus === 'created' ? 'created' : 'in_transit';
      const events = Array.isArray(parsed.events)
        ? (parsed.events as Record<string, unknown>[]).map((e) => ({
            status: String(e.status ?? ''),
            at: String(e.at ?? new Date().toISOString()),
            note: e.note ? String(e.note) : undefined,
          }))
        : [];
      return { status, events };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createShipmentProvider(cfg: ShippingProviderConfig, metrics: Metrics, log: Logger): ShipmentProvider {
  return cfg.mode === 'live' ? new LiveShipmentProvider(cfg, metrics, log) : new SandboxShipmentProvider();
}

export class SandboxSmsProvider implements SmsProvider {
  readonly name = 'sandbox_sms';
  readonly mode = 'sandbox' as const;
  /** Captured rather than sent, so tests can assert on what a buyer would receive. */
  readonly sent: SendSmsRequest[] = [];

  async send(input: SendSmsRequest): Promise<SendSmsResult> {
    this.sent.push(input);
    return { provider: this.name, messageRef: `sms_${this.sent.length}`, accepted: true };
  }
}

export class LiveSmsProvider implements SmsProvider {
  readonly name: string;
  readonly mode = 'live' as const;
  // Fields rather than constructor parameter properties: see LiveShipmentProvider.
  private readonly cfg: SmsProviderConfig;
  private readonly metrics: Metrics;
  private readonly log: Logger;

  constructor(cfg: SmsProviderConfig, metrics: Metrics, log: Logger) {
    this.cfg = cfg;
    this.metrics = metrics;
    this.log = log;
    this.name = cfg.provider;
  }

  async send(input: SendSmsRequest): Promise<SendSmsResult> {
    const url = `${this.cfg.baseUrl.replace(/\/+$/, '')}/messages`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify({ to: input.to, message: input.message, from: this.cfg.from, reference: input.reference }),
      });
      if (!res.ok) {
        this.metrics.increment('provider_requests_total', { provider: this.name, operation: 'sms', outcome: 'error' });
        throw new ProviderError(this.name, `SMS gateway rejected the message with ${res.status}`, {
          status: res.status >= 500 ? 503 : 502,
          retryable: res.status >= 500,
        });
      }
      const parsed = (await res.json()) as Record<string, unknown>;
      this.metrics.increment('provider_requests_total', { provider: this.name, operation: 'sms', outcome: 'success' });
      return { provider: this.name, messageRef: String(parsed.id ?? ''), accepted: true };
    } catch (e) {
      if (e instanceof ProviderError) {
        this.log.warn('SMS delivery failed', { to: maskPhone(input.to), status: e.status });
        throw e;
      }
      throw new ProviderError(this.name, 'SMS gateway is unreachable', { status: 503, cause: e });
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createSmsProvider(cfg: SmsProviderConfig, metrics: Metrics, log: Logger): SmsProvider {
  return cfg.mode === 'live' ? new LiveSmsProvider(cfg, metrics, log) : new SandboxSmsProvider();
}

/** Phone numbers are never logged in full. */
export function maskPhone(phone: string): string {
  const digits = String(phone ?? '');
  if (digits.length <= 4) return '••••';
  return digits.replace(/.(?=.{4})/g, '•');
}
