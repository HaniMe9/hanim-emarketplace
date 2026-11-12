/**
 * Provider webhooks.
 *
 * An inbound webhook is untrusted input from the internet, so the raw request
 * bytes are kept and the signature is checked against those bytes before the
 * body is parsed. Re-serialising the JSON and checking that would let a payload
 * that differs byte-for-byte from what was signed pass.
 *
 * Handlers are idempotent: providers retry until they get a 2xx, so the same
 * event arriving twice must not double-credit an order. Each event carries an
 * id and processed events are remembered.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Shipment } from '../../shared/types.ts';
import type { Db } from '../store.ts';
import { AppError } from '../lib/errors.ts';
import type { Logger } from '../lib/logger.ts';
import type { Metrics } from '../lib/metrics.ts';
import type { PaymentProvider } from '../integrations/types.ts';
import { bookCapture } from '../services/payments.ts';
import { postJournal, entry } from '../lib/money.ts';
import { audit } from './helpers.ts';
import { id } from '../lib/ids.ts';

/** Signature headers the providers in scope use. */
const SIGNATURE_HEADERS = ['x-hm-signature', 'x-telebirr-signature', 'x-signature', 'x-callback-signature'];

export interface WebhookDeps {
  payments: PaymentProvider;
  metrics: Metrics;
  log: Logger;
  /** Called after state changes so the snapshot can be flushed. */
  onMutate: () => void;
}

export function webhookRoutes(db: Db, deps: WebhookDeps): Router {
  const r = Router();
  const processed = new Set<string>();

  const readSignature = (req: Request): string | undefined => {
    for (const h of SIGNATURE_HEADERS) {
      const v = req.header(h);
      if (v) return v;
    }
    return undefined;
  };

  /**
   * Payments provider calling back that a charge settled. This is the
   * authoritative signal that money moved; the browser returning from a
   * redirect is not.
   */
  r.post('/payments', (req: Request, res: Response) => {
    const signature = readSignature(req);
    if (!deps.payments.verifySignature(req.rawBody ?? Buffer.alloc(0), signature)) {
      deps.metrics.increment('webhook_events_total', { provider: deps.payments.name, outcome: 'invalid_signature' });
      deps.log.warn('Rejected webhook with a bad signature', { provider: deps.payments.name, ip: req.ip });
      throw AppError.forbidden('Webhook signature verification failed.');
    }

    const event = (req.body ?? {}) as Record<string, unknown>;
    const eventId = String(event.id ?? event.eventId ?? '');
    if (eventId && processed.has(eventId)) {
      deps.metrics.increment('webhook_events_total', { provider: deps.payments.name, outcome: 'duplicate' });
      return res.json({ ok: true, duplicate: true });
    }

    const providerRef = String(event.transactionId ?? event.reference ?? '');
    const status = String(event.status ?? '').toUpperCase();
    const payment = db.payments.find((p) => p.providerRef === providerRef);
    if (!payment) {
      deps.metrics.increment('webhook_events_total', { provider: deps.payments.name, outcome: 'unknown_payment' });
      // Acknowledge anyway: retrying an event we cannot place will never succeed
      // and only delays the provider's retry budget.
      return res.json({ ok: true, ignored: 'unknown payment reference' });
    }

    const order = db.orders.find((o) => o.id === payment.orderId);
    if (!order) {
      deps.metrics.increment('webhook_events_total', { provider: deps.payments.name, outcome: 'unknown_payment' });
      return res.json({ ok: true, ignored: 'payment has no order' });
    }

    if (status === 'SUCCESS' || status === 'SETTLED') {
      if (payment.state !== 'captured' && order.paymentState !== 'captured') {
        bookCapture(db, order, order.total, payment.fee);
        payment.state = 'captured';
        payment.capturedAt = new Date().toISOString();
        order.paymentState = 'captured';
        order.paid = order.total;
        deps.metrics.increment('payment_attempts_total', { provider: deps.payments.name, method: order.paymentMethod, outcome: 'captured' });
        deps.metrics.increment('payment_amount_minor_total', { provider: deps.payments.name }, order.total);
        audit(db, 'webhook', 'payment.captured', `order:${order.id}`, { providerRef });
        deps.onMutate();
      }
    } else if (status === 'FAILED' || status === 'REVERSED') {
      payment.state = 'failed';
      order.paymentState = 'failed';
      deps.metrics.increment('payment_attempts_total', { provider: deps.payments.name, method: order.paymentMethod, outcome: 'error' });
      audit(db, 'webhook', 'payment.failed', `order:${order.id}`, { providerRef, status });
      deps.onMutate();
    }

    if (eventId) processed.add(eventId);
    deps.metrics.increment('webhook_events_total', { provider: deps.payments.name, outcome: 'processed' });
    return res.json({ ok: true });
  });

  /** Carrier calling back with a delivery scan. */
  r.post('/shipping', (req: Request, res: Response) => {
    const signature = readSignature(req);
    if (!deps.payments.verifySignature(req.rawBody ?? Buffer.alloc(0), signature)) {
      deps.metrics.increment('webhook_events_total', { provider: 'shipping', outcome: 'invalid_signature' });
      throw AppError.forbidden('Webhook signature verification failed.');
    }
    const event = (req.body ?? {}) as Record<string, unknown>;
    const trackingRef = String(event.trackingRef ?? event.reference ?? '');
    const shipment = db.shipments.find((s) => s.trackingRef === trackingRef || s.id === trackingRef);
    if (!shipment) {
      deps.metrics.increment('webhook_events_total', { provider: 'shipping', outcome: 'unknown_shipment' });
      return res.json({ ok: true, ignored: 'unknown tracking reference' });
    }

    const status = String(event.status ?? '').toLowerCase();
    // Carrier vocabulary mapped onto the statuses this domain actually uses, so
    // a scan cannot invent a status the buyer-facing tracker has no label for.
    const map: Record<string, Shipment['status']> = {
      created: 'pending',
      in_transit: 'picked_up',
      out_for_delivery: 'out_for_delivery',
      delivered: 'delivered',
      failed: 'failed',
      returned: 'returned',
    };
    const next = map[status];
    if (next && next !== shipment.status) {
      shipment.status = next;
      shipment.events.push({
        id: id('se'),
        status: next,
        at: String(event.at ?? new Date().toISOString()),
        actor: 'carrier',
        note: event.note ? String(event.note) : `Carrier scan: ${status}`,
      });
      if (next === 'delivered') {
        shipment.deliveredAt = new Date().toISOString();
        if (shipment.codAmount) shipment.cashCollected = shipment.codAmount;
      }
      deps.onMutate();
    }

    deps.metrics.increment('webhook_events_total', { provider: 'shipping', outcome: 'processed' });
    return res.json({ ok: true });
  });

  return r;
}

/**
 * Record an externally-initiated refund (a chargeback, or a provider reversing a
 * settlement we had booked). Kept here so the ledger entry is created the same
 * way regardless of who initiated it.
 */
export function bookExternalReversal(db: Db, providerRef: string, amount: number, reason: string): string {
  const payment = db.payments.find((p) => p.providerRef === providerRef);
  if (!payment) throw AppError.notFound(`No payment matches ${providerRef}.`);
  const order = db.orders.find((o) => o.id === payment.orderId);
  const je = postJournal({
    journal: 'refund',
    refType: 'refund',
    refId: id('rfd'),
    refLabel: `${order?.code ?? payment.orderId} external reversal`,
    at: new Date().toISOString(),
    lines: [entry('refund_payable', amount, 0, 'Provider-initiated reversal'), entry('cash_psp', 0, amount, 'Cash out to buyer by provider')],
    description: `Provider reversal for ${order?.code ?? providerRef} — ${reason}`,
    postedBy: 'auto',
  });
  db.ledger.unshift(je);
  payment.state = 'refunded';
  return je.id;
}
