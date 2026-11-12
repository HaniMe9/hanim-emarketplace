/**
 * Contracts for the third-party systems the marketplace depends on.
 *
 * Each integration has a sandbox implementation that behaves plausibly without
 * network access and a live implementation that performs real HTTP calls. They
 * satisfy the same interface, so the code path exercised in tests is the code
 * path that ships.
 *
 * Three rules hold across every integration:
 *  - Money-moving calls take an idempotency key. A retry after a timeout must
 *    never charge or refund twice.
 *  - Failures surface as `ProviderError` carrying the provider name, so the
 *    error handler and the metrics both key on something consistent.
 *  - Every network call has a timeout. A hung provider must not pin a request
 *    handler open indefinitely.
 */

import type { Minor, PaymentMethod } from '../../shared/types.ts';

/* ------------------------------- Payments -------------------------------- */

export interface ChargeRequest {
  orderId: string;
  orderCode: string;
  amount: Minor;
  method: PaymentMethod;
  buyerPhone: string;
  buyerName: string;
  /** Stable across retries of the same logical charge. */
  idempotencyKey: string;
  description: string;
}

export interface ChargeResult {
  provider: string;
  providerRef: string;
  state: 'pending' | 'succeeded' | 'failed';
  amount: Minor;
  fee: Minor;
  /** Set when `state` is `pending`: the buyer must confirm on their handset. */
  confirmation?: { channel: 'sms' | 'push'; token: string; expiresAt: string };
  raw?: unknown;
}

export interface RefundRequest {
  providerRef: string;
  amount: Minor;
  reason: string;
  idempotencyKey: string;
}

export interface RefundResult {
  provider: string;
  providerRef: string;
  state: 'pending' | 'succeeded' | 'failed';
  amount: Minor;
  raw?: unknown;
}

export interface VerifyResult {
  paid: boolean;
  providerRef: string;
  amount: Minor;
  paidAt?: string;
}

export interface PaymentProvider {
  readonly name: string;
  readonly mode: 'sandbox' | 'live';
  charge(input: ChargeRequest): Promise<ChargeResult>;
  refund(input: RefundRequest): Promise<RefundResult>;
  /** Poll a charge the provider reported as pending. */
  verify(providerRef: string): Promise<VerifyResult>;
  /** True when the signature on an inbound webhook is authentic. */
  verifySignature(rawBody: Buffer, signature: string | undefined): boolean;
}

/* ------------------------------- Shipping -------------------------------- */

export interface CreateShipmentRequest {
  orderId: string;
  orderCode: string;
  partner: string;
  from: { name: string; city: string };
  to: { name: string; phone: string; city: string; subcity?: string; house: string };
  codAmount: Minor;
  weightKg?: number;
}

export type ShipmentState = 'created' | 'in_transit' | 'delivered' | 'failed';

export interface ShipmentBooking {
  provider: string;
  trackingRef: string;
  status: ShipmentState;
  estimatedAt: string;
  raw?: unknown;
}

export interface TrackingResult {
  status: ShipmentState;
  events: { status: string; at: string; note?: string }[];
}

export interface ShipmentProvider {
  readonly name: string;
  readonly mode: 'sandbox' | 'live';
  book(input: CreateShipmentRequest): Promise<ShipmentBooking>;
  track(trackingRef: string): Promise<TrackingResult>;
  cancel?(trackingRef: string, reason: string): Promise<void>;
}

/* ---------------------------------- SMS ---------------------------------- */

export interface SendSmsRequest {
  to: string;
  message: string;
  /** Correlates a delivery receipt with the challenge that caused it. */
  reference?: string;
}

export interface SendSmsResult {
  provider: string;
  messageRef: string;
  accepted: boolean;
}

/**
 * OTP codes are delivered through this interface rather than being returned to
 * the caller. The route that issues a code needs to know it was issued, not
 * what it was, and the SMS gateway is the only thing that should ever hold the
 * plaintext.
 */
export interface SmsProvider {
  readonly name: string;
  readonly mode: 'sandbox' | 'live';
  send(input: SendSmsRequest): Promise<SendSmsResult>;
}
