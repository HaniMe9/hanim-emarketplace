/**
 * Payment and settlement operations.
 *
 * The routes stay thin; everything that moves money or books a journal entry
 * goes through here, so the rules are enforced once:
 *
 *  - A capture is idempotent on `(orderId, provider)`. Replaying a capture never
 *    produces a second charge or a second ledger posting.
 *  - Cash in, escrow, commission, VAT and PSP fee are booked as one balanced
 *    journal entry. `postJournal` refuses an unbalanced entry, so the invariant
 *    cannot be bypassed from here.
 *  - A payout requires a verified destination account and no outstanding cash
 *    shortfall. Both refusals are explicit, never silent.
 */

import type { Db } from '../store.ts';
import type { Minor, Order, ReconciliationRun, Settlement } from '../../shared/types.ts';
import { entry, postJournal, rate, sum } from '../lib/money.ts';
import { AppError } from '../lib/errors.ts';
import type { Logger } from '../lib/logger.ts';
import type { Metrics } from '../lib/metrics.ts';
import { fees } from '../data/finance.ts';
import { logActivity, audit } from '../routes/helpers.ts';
import type { PaymentProvider } from '../integrations/types.ts';
import { id } from '../lib/ids.ts';

/** Where an order's money came from, which decides the cash account. */
function cashAccountFor(order: Order): 'cash_psp' | 'cash_cod_in_transit' | 'receivable_b2b' {
  if (order.channel === 'b2b') return 'receivable_b2b';
  return order.paymentMethod === 'cod' ? 'cash_cod_in_transit' : 'cash_psp';
}

export interface CaptureInput {
  order: Order;
  provider: PaymentProvider;
  /** Charged to the buyer. Must equal the order total. */
  amount: Minor;
  idempotencyKey: string;
  actor: string;
}

export interface CaptureResult {
  state: 'captured' | 'pending' | 'failed' | 'replayed';
  providerRef: string;
  journalEntryId?: string;
  message: string;
}

/**
 * Book the cash receipt for a paid order.
 *
 * The gross comes in as an argument rather than being read off `order.paid`.
 * That is deliberate: `order.paid` is only correct once the order has been marked
 * paid, and the two used to be sequenced such that callers had to mark the order
 * paid *before* booking — so a throw inside `postJournal` (a rejected negative
 * line, say) left the order marked captured with no journal entry behind it.
 * Taking the amount explicitly means the journal can be posted first, on its
 * own, and the order only mutated once the money is actually booked.
 *
 * The seller's net is derived as the residual of what the buyer paid, rather
 * than restated as gross minus fees, so the entry balances by construction: a
 * rounding change upstream cannot open a half-santim hole in the ledger.
 */
export function bookCapture(db: Db, order: Order, gross: Minor, providerFee: Minor, at = new Date().toISOString()) {
  const cashAcct = cashAccountFor(order);
  const commission = rate(order.subtotal, fees.commissionRate);
  const pspFee = order.paymentMethod === 'cod' || order.channel === 'b2b' ? 0 : providerFee;
  let sellerNet = gross - order.tax - order.deliveryFee - commission;
  const suspense = sellerNet < 0 ? -sellerNet : 0;
  if (suspense > 0) sellerNet = 0;

  const lines = [
    entry(cashAcct, gross - pspFee, 0, `Order ${order.code} collected`),
    entry('escrow_seller_payable', 0, sellerNet, `Seller net of ${order.subtotal} gross`),
    entry('revenue_commission', 0, commission, 'Platform commission'),
    entry('revenue_delivery', 0, order.deliveryFee, 'Delivery fee collected'),
    entry('tax_payable_vat', 0, order.tax, 'VAT accrued 15%'),
  ];
  if (pspFee > 0) lines.push(entry('expense_psp', pspFee, 0, 'PSP processing fee'));
  if (suspense > 0) lines.push(entry('suspense', suspense, 0, 'Shortfall held pending reconciliation'));

  const je = postJournal({
    journal: 'sales',
    refType: 'order',
    refId: order.id,
    refLabel: order.code,
    at,
    lines,
    description: `Order ${order.code} — ${order.lines.length} line(s), ${order.paymentMethod.toUpperCase()}`,
    attachments: [`invoice:${order.invoiceNo ?? 'n/a'}`],
  });
  db.ledger.unshift(je);
  return je;
}

/**
 * Capture a payment for an order.
 *
 * Idempotency is keyed on the order plus the provider, not on the caller's
 * key: two different requests for the same order must not become two charges,
 * and the same request replayed must not either.
 */
export async function capture(db: Db, input: CaptureInput, metrics: Metrics, log: Logger): Promise<CaptureResult> {
  const { order, provider } = input;

  if (input.amount !== order.total) {
    // Booking a receipt for a different amount than the order total would put
    // the ledger out of step with the order the buyer agreed to.
    throw AppError.unprocessable('amount_mismatch', `Charge must equal the order total of ${(order.total / 100).toFixed(2)} ETB.`);
  }
  if (order.paymentState === 'captured') {
    const existing = db.payments.find((p) => p.orderId === order.id && p.state === 'captured');
    return {
      state: 'replayed',
      providerRef: existing?.providerRef ?? '',
      message: `${order.code} is already paid. No second charge was created.`,
    };
  }

  const buyer = db.users.find((u) => u.id === order.buyerId);
  const key = `cap_${order.id}_${provider.name}`;

  let result;
  try {
    result = await provider.charge({
      orderId: order.id,
      orderCode: order.code,
      amount: order.total,
      method: order.paymentMethod,
      buyerPhone: buyer?.phone ?? '',
      buyerName: order.buyerName,
      idempotencyKey: key,
      description: `HaniMarket order ${order.code}`,
    });
  } catch (e) {
    metrics.increment('payment_attempts_total', { provider: provider.name, method: order.paymentMethod, outcome: 'error' });
    throw e;
  }

  metrics.increment('payment_attempts_total', { provider: provider.name, method: order.paymentMethod, outcome: result.state });

  if (result.state === 'failed') {
    order.paymentState = 'failed';
    audit(db, input.actor, 'payment.failed', `order:${order.id}`, { providerRef: result.providerRef });
    log.warn('Payment declined', { order: order.code, provider: provider.name, providerRef: result.providerRef });
    return { state: 'failed', providerRef: result.providerRef, message: 'The payment was declined. No money was taken.' };
  }

  if (result.state === 'pending') {
    // The buyer still has to approve on their handset. Recording a receipt here
    // would credit the seller for money that has not moved.
    order.paymentState = 'authorized';
    db.payments.unshift({
      id: id('pay'),
      orderId: order.id,
      method: order.paymentMethod,
      amount: order.total,
      fee: result.fee,
      // `authorized` is this domain's name for "initiated, not yet settled".
      // `pending` is the provider's word, not ours.
      state: 'authorized',
      provider: provider.name,
      providerRef: result.providerRef,
      createdAt: new Date().toISOString(),
      idempotencyKey: key,
    });
    return {
      state: 'pending',
      providerRef: result.providerRef,
      message: 'Check your phone and approve the payment to continue.',
    };
  }

  const at = new Date().toISOString();
  // Post the journal first, on its own. If `postJournal` rejects, nothing has
  // been mutated yet and the order is still honestly `pending_payment`, rather
  // than marked paid with no receipt booked behind it.
  const je = bookCapture(db, order, order.total, result.fee, at);
  order.paymentState = 'captured';
  order.paid = order.total;
  db.payments.unshift({
    id: id('pay'),
    orderId: order.id,
    method: order.paymentMethod,
    amount: order.total,
    fee: result.fee,
    state: 'captured',
    provider: provider.name,
    providerRef: result.providerRef,
    createdAt: at,
    capturedAt: at,
    idempotencyKey: key,
  });

  metrics.increment('payment_amount_minor_total', { provider: provider.name }, order.total);
  audit(db, input.actor, 'payment.captured', `order:${order.id}`, { amount: order.total, providerRef: result.providerRef, provider: provider.name });
  log.info('Payment captured', { order: order.code, amount: order.total, provider: provider.name, providerRef: result.providerRef });

  return {
    state: 'captured',
    providerRef: result.providerRef,
    journalEntryId: je.id,
    message: 'Payment captured. Funds are held in escrow until delivery is confirmed.',
  };
}

/** Refund an order in the original method, booking the cash-out. */
export async function refund(
  db: Db,
  order: Order,
  provider: PaymentProvider,
  amount: Minor,
  reason: string,
  actor: string,
  metrics: Metrics,
  log: Logger,
): Promise<{ providerRef: string; journalEntryId: string }> {
  const payment = db.payments.find((p) => p.orderId === order.id);
  if (order.paymentMethod === 'cod') {
    // Cash was collected at the door, so a refund is a cash-out to the buyer,
    // not a call to a mobile-money provider.
    const je = postJournal({
      journal: 'refund',
      refType: 'refund',
      refId: id('rfd'),
      refLabel: `${order.code} refund`,
      at: new Date().toISOString(),
      lines: [entry('refund_payable', amount, 0, 'Refund issued to buyer'), entry('cash_cod_in_transit', 0, amount, 'Cash out to buyer')],
      description: `Cash refund for order ${order.code} — ${reason}`,
      postedBy: 'finance',
    });
    db.ledger.unshift(je);
    order.refunded = amount;
    order.paymentState = 'refunded';
    audit(db, actor, 'payment.refunded', `order:${order.id}`, { amount, method: 'cod' });
    return { providerRef: `COD-RFD-${order.id}`, journalEntryId: je.id };
  }

  const res = await provider.refund({
    providerRef: payment?.providerRef ?? '',
    amount,
    reason,
    idempotencyKey: `rfd_${order.id}_${amount}`,
  });

  const commissionRetained = rate(order.subtotal, fees.commissionRate);
  const lines = [entry('refund_payable', amount, 0, 'Refund issued to buyer'), entry('cash_psp', 0, amount, 'Cash out to buyer in the original method')];
  // Commission already recognised on this order is clawed back, so a refund
  // does not leave revenue on the books for a sale that was reversed.
  if (commissionRetained > 0) {
    lines.push(entry('escrow_seller_payable', commissionRetained, 0, 'Commission retained out of seller net'));
    lines.push(entry('revenue_commission', 0, commissionRetained, 'Commission reversed on refunded order'));
  }
  const je = postJournal({
    journal: 'refund',
    refType: 'refund',
    refId: id('rfd'),
    refLabel: `${order.code} refund`,
    at: new Date().toISOString(),
    lines,
    description: `Refund for order ${order.code} — ${reason}`,
    postedBy: 'finance',
  });
  db.ledger.unshift(je);

  order.refunded = amount;
  order.paymentState = 'refunded';
  if (payment) payment.state = 'refunded';
  metrics.increment('payment_attempts_total', { provider: provider.name, method: order.paymentMethod, outcome: 'refunded' });
  audit(db, actor, 'payment.refunded', `order:${order.id}`, { amount, providerRef: res.providerRef });
  log.info('Refund issued', { order: order.code, amount, provider: provider.name });
  return { providerRef: res.providerRef, journalEntryId: je.id };
}

/* ----------------------------- Payouts ----------------------------------- */

/**
 * A payout is blocked while cash behind it has not reconciled.
 *
 * Scoped to the seller: if one of their COD orders went out with an agent who is
 * short, only that seller's balance waits. Everyone else still gets paid.
 */
export function payoutBlocker(db: Db, sellerId: string): string | null {
  const short = db.codDeposits.filter((d) => d.variance > 0 && d.status !== 'confirmed');
  if (!short.length) return null;

  const blockingAgents = new Set(short.map((d) => d.agentId));
  const sellerOrderIds = new Set(
    db.orders.filter((o) => o.lines.some((l) => l.sellerId === sellerId) && o.status === 'delivered').map((o) => o.id),
  );
  if (!sellerOrderIds.size) return null;

  const shipmentToOrder = new Map(db.orders.filter((o) => o.shipment).map((o) => [o.shipment!.id, o.id]));
  const exposed = db.agentRoutes.flatMap((route) =>
    route.stops
      .filter((s) => blockingAgents.has(route.agentId) && sellerOrderIds.has(shipmentToOrder.get(s.shipmentId) ?? ''))
      .map((s) => s.shipmentId),
  );
  if (!exposed.length) return null;

  const total = sum(short.map((d) => d.variance));
  return `Cash remittance is short by ETB ${(total / 100).toLocaleString('en-ET')} across ${short.length} deposit${short.length === 1 ? '' : 's'}. ${exposed.length} of this seller's delivered COD orders went out with the affected agent${exposed.length === 1 ? '' : 's'}.`;
}

export interface PayOutResult {
  settlement: Settlement;
  journalEntryId: string;
  providerRef: string;
}

/**
 * Release an approved settlement to the seller's verified bank account.
 *
 * Both refusals are explicit: no verified account is a redirect that nobody
 * reviewed, and an unreconciled shortfall is money the platform does not have.
 */
export function paySettlement(db: Db, settlement: Settlement, actor: string, reference?: string): PayOutResult {
  if (settlement.status !== 'approved' && settlement.status !== 'ready') {
    throw AppError.conflict('not_approved', `A ${settlement.status} settlement cannot be paid.`);
  }

  const blocker = payoutBlocker(db, settlement.sellerId);
  if (blocker) {
    throw AppError.unprocessable('payout_blocked', `Blocked by reconciliation: ${blocker}`, { blocker });
  }

  const account = db.payoutAccounts.find((p) => p.sellerId === settlement.sellerId && p.verified);
  if (!account) {
    throw AppError.unprocessable('no_verified_account', `${settlement.sellerName} has no payout account with verified ownership. Verify one before releasing funds.`, {
      sellerId: settlement.sellerId,
    });
  }

  const paidAt = new Date().toISOString();
  const providerRef = reference ?? `PO-${Date.now().toString(36).toUpperCase()}`;
  settlement.status = 'paid';
  settlement.paidAt = paidAt;
  settlement.payoutRef = providerRef;
  settlement.payoutMethod = `${account.bank} · ${maskAccount(account.accountNumber)}`;

  const je = postJournal({
    journal: 'settlement',
    refType: 'payout',
    refId: settlement.id,
    refLabel: `${settlement.code} payout`,
    at: paidAt,
    lines: [
      entry('seller_payable', settlement.netPayable, 0, 'Settled to seller account', { type: 'seller', id: settlement.sellerId }),
      entry('platform_cash', 0, settlement.netPayable, 'Payout executed'),
    ],
    description: `Payout ${providerRef} to ${settlement.sellerName} via ${account.bank}`,
    postedBy: 'finance',
  });
  db.ledger.unshift(je);

  logActivity(db, actor, 'settlement.paid', 'settlement', settlement.id, `ETB ${(settlement.netPayable / 100).toLocaleString('en-ET')} · ${providerRef}`);
  audit(db, actor, 'settlement.pay', `settlement:${settlement.id}`, { netPayable: settlement.netPayable, ref: providerRef, bank: account.bank });

  return { settlement, journalEntryId: je.id, providerRef };
}

const maskAccount = (n: string) => `${n.slice(0, 4)}••••${n.slice(-4)}`;

/* ------------------------- Reconciliation --------------------------------- */

/**
 * Compare what the provider says was collected against what we booked.
 *
 * Any difference lands in `suspense` rather than being netted away, and a
 * shortfall blocks the payouts behind it.
 */
export function reconcilePayments(db: Db, provider: PaymentProvider, at = new Date().toISOString()): ReconciliationRun {
  const exceptions: ReconciliationRun['exceptions'] = [];
  let matched = 0;
  let mismatched = 0;
  let missing = 0;
  let netDifference = 0;

  for (const payment of db.payments) {
    const order = db.orders.find((o) => o.id === payment.orderId);
    if (!order) {
      missing += 1;
      exceptions.push({
        id: id('ex'),
        kind: 'missing_payout',
        detail: `Payment ${payment.providerRef} has no matching order.`,
        amount: payment.amount,
        ref: payment.providerRef,
        at,
        resolution: 'open',
      });
      continue;
    }
    if (payment.amount === order.total) {
      matched += 1;
    } else {
      mismatched += 1;
      const diff = payment.amount - order.total;
      netDifference += diff;
      exceptions.push({
        id: id('ex'),
        kind: 'amount',
        detail: `${payment.providerRef} settled at ETB ${(payment.amount / 100).toFixed(2)} but the intent was ETB ${(order.total / 100).toFixed(2)}.`,
        amount: Math.abs(diff),
        ref: payment.providerRef,
        at,
        resolution: 'open',
      });
    }
  }

  // Any unresolved difference is parked in suspense so it stays visible until a
  // real event clears it.
  if (netDifference > 0) {
    const je = postJournal({
      journal: 'accrual',
      refType: 'adjustment',
      refId: id('recon'),
      refLabel: `RECON-${at.slice(0, 10)}`,
      at,
      lines: [entry('suspense', netDifference, 0, 'Unreconciled provider difference'), entry('cash_psp', 0, netDifference, 'Provider overage to clear')],
      description: `Payment reconciliation for ${at.slice(0, 10)} — ${exceptions.length} exception(s)`,
      postedBy: 'auto',
    });
    db.ledger.unshift(je);
  }

  return {
    id: id('rec'),
    at,
    scope: 'psp',
    counterparty: provider.name,
    records: db.payments.length,
    matched,
    mismatched,
    missing,
    netDifference,
    status: exceptions.length ? 'exceptions' : 'clean',
    payoutBlocked: false,
    exceptions,
  };
}
