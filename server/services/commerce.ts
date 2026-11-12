import type { CartLine, CartTotals, CartView, Minor, Order, PaymentMethod } from '../../shared/types.ts';
import type { Db } from '../store.ts';
import { add, mul, pct, sum } from '../lib/money.ts';
import { fees } from '../data/finance.ts';
import { code, id, minutesAgo } from '../lib/ids.ts';

const DELIVERY_ZONES: Record<string, { fee: Minor; days: [number, number] }> = {
  'addis ababa': { fee: fees.deliveryFlat, days: [1, 3] },
  addis: { fee: fees.deliveryFlat, days: [1, 3] },
  adama: { fee: 8500, days: [2, 4] },
  mekelle: { fee: 16000, days: [3, 6] },
  hawassa: { fee: 12000, days: [3, 5] },
  'bahir dar': { fee: 14000, days: [3, 6] },
  'dire dawa': { fee: 17000, days: [4, 7] },
  default: { fee: 22000, days: [5, 9] },
};

export function zoneFor(city: string) {
  const k = (city ?? '').toLowerCase();
  return DELIVERY_ZONES[k] ?? DELIVERY_ZONES.default;
}

export function codFeeFor(city: string, total: Minor): Minor {
  const z = zoneFor(city);
  return Math.round(fees.codFeeRate * Math.min(total, 5000000) + (z.days[0] > 3 ? 500 : 0));
}

function lineFor(offerId: string, qty: number, db: Db): CartLine | null {
  const offer = db.offers.find((o) => o.id === offerId);
  if (!offer) return null;
  const p = db.products.find((x) => x.id === offer.productId);
  if (!p) return null;
  const seller = db.orgs.find((s) => s.id === offer.sellerId);
  const tier = offer.tierPrices?.filter((t) => qty >= t.minQty).sort((a, b) => b.minQty - a.minQty)[0];
  return {
    id: `cl_${offer.id}`,
    offerId: offer.id,
    productId: p.id,
    sellerId: offer.sellerId,
    title: p.title,
    image: p.images[0],
    unitPrice: tier ? tier.price : offer.price,
    qty,
    stock: offer.stock,
    condition: offer.condition,
    fulfillment: offer.fulfillment,
    sellerName: seller?.name ?? 'Seller',
    etaDays: offer.etaDays,
    tierPrice: tier,
  };
}

/** The mutable basket row for an account, created on first write. */
export function cartOf(db: Db, userId: string | null): { userId: string | null; lines: { offerId: string; qty: number }[] } {
  let cart = db.carts.find((c) => c.userId === userId);
  if (!cart) {
    cart = { userId, lines: [] };
    db.carts.push(cart);
  }
  return cart;
}

export function favoritesOf(db: Db, userId: string | null): string[] {
  return db.favoritesByUser.find((f) => f.userId === userId)?.productIds ?? [];
}

export function cartView(db: Db, city = 'Addis Ababa', userId: string | null = null): CartView {
  const lines = cartOf(db, userId)
    .lines.map((c) => lineFor(c.offerId, c.qty, db))
    .filter((l): l is CartLine => !!l);

  const subtotal = sum(lines.map((l) => l.unitPrice * l.qty));
  const zone = zoneFor(city);
  const sellerCount = new Set(lines.map((l) => l.sellerId)).size;
  const delivery = subtotal >= 300000 ? 0 : zone.fee + Math.max(0, sellerCount - 1) * 2500;
  const tax = mul(add(subtotal, delivery), 0.15);
  const compareTotal = sum(
    lines.map((l) => {
      const offer = db.offers.find((o) => o.id === l.offerId);
      return ((offer?.compareAtPrice ?? l.unitPrice) - l.unitPrice) * l.qty;
    }),
  );
  const totals: CartTotals = {
    subtotal,
    delivery,
    tax,
    discount: 0,
    total: add(subtotal, delivery, tax),
    itemCount: sum(lines.map((l) => l.qty)),
    savings: Math.max(0, compareTotal),
  };
  return {
    lines,
    totals,
    deliveryEstimate: { min: zone.days[0], max: zone.days[1], fee: zone.fee },
    codFee: codFeeFor(city, totals.total),
  };
}

/* ------------------------------ Promotions ------------------------------ */

export function appliedPromotion(db: Db, lines: CartLine[], codeStr?: string): { discount: Minor; label: string; code: string } | null {
  if (codeStr) {
    const promo = db.promotions.find((p) => p.code === codeStr.toUpperCase() && p.active);
    if (promo) {
      const sellers = new Set(lines.map((l) => l.sellerId));
      const applies = promo.appliesToSellerIds === 'all' || promo.appliesToSellerIds.some((s) => sellers.has(s));
      const subtotal = sum(lines.map((l) => l.unitPrice * l.qty));
      if (applies && subtotal >= promo.minSubtotal) {
        const d = promo.kind === 'percent' ? pct(subtotal, promo.value) : promo.kind === 'fixed' ? Math.min(promo.value, subtotal) : 0;
        return { discount: d, label: promo.description, code: promo.code };
      }
    }
  }
  // Automatic best eligible promotion.
  const sellers = new Set(lines.map((l) => l.sellerId));
  const subtotal = sum(lines.map((l) => l.unitPrice * l.qty));
  const eligible = db.promotions
    .filter((p) => p.active && subtotal >= p.minSubtotal && (p.appliesToSellerIds === 'all' || p.appliesToSellerIds.some((s) => sellers.has(s))))
    .map((p) => ({ p, d: p.kind === 'percent' ? pct(subtotal, p.value) : p.kind === 'fixed' ? Math.min(p.value, subtotal) : 0 }))
    .filter((x) => x.d > 0)
    .sort((a, b) => b.d - a.d);
  if (!eligible.length) return null;
  return { discount: eligible[0].d, label: eligible[0].p.description, code: eligible[0].p.code };
}

/* --------------------------- Checkout / saga ---------------------------- */

export interface CheckoutInput {
  addressId: string;
  paymentMethod: PaymentMethod;
  promoCode?: string;
  note?: string;
  idempotencyKey: string;
}

/** Idempotency ledger: a repeated identical request never duplicates anything. */
const idempotency = new Map<string, { orderId: string; at: string }>();

export class CheckoutError extends Error {
  code: string;
  detail?: unknown;
  constructor(code: string, message: string, detail?: unknown) {
    super(message);
    this.name = 'CheckoutError';
    this.code = code;
    this.detail = detail;
  }
}

export function checkout(db: Db, buyerId: string, input: CheckoutInput): { order: Order; replayed: boolean } {
  const seen = idempotency.get(input.idempotencyKey);
  if (seen) {
    const order = db.orders.find((o) => o.id === seen.orderId);
    if (order) return { order, replayed: true };
  }

  const address = db.addresses.find((a) => a.id === input.addressId);
  if (!address) throw new CheckoutError('address_not_found', 'That delivery address does not exist.');
  // A buyer may only ship to an address on their own account. Without this, a
  // known address id was enough to have an order delivered to someone else.
  // An unowned address is refused too: "nobody claimed it" is not consent to
  // have a parcel delivered there.
  if (address.userId !== buyerId) {
    throw new CheckoutError('address_not_yours', 'That delivery address belongs to another account.');
  }

  const view = cartView(db, address.city, buyerId);
  if (!view.lines.length) throw new CheckoutError('empty_cart', 'Your basket is empty.');

  /* --- Inventory reservation, in the same transaction as the order write --- */
  for (const line of view.lines) {
    const offer = db.offers.find((o) => o.id === line.offerId)!;
    if (offer.stock < line.qty) {
      throw new CheckoutError('insufficient_stock', `Only ${offer.stock} left of ${line.title}.`, { offerId: offer.id, available: offer.stock });
    }
  }

  /* --- Risk rules evaluated synchronously at checkout ---------------------- */
  const evaluation = evaluateRisk(db, buyerId, view, input.paymentMethod);
  const blocking = evaluation.triggered.find((t) => {
    const rule = db.riskRules.find((r) => r.id === t.rule);
    return rule?.action === 'block' || rule?.action === 'hold';
  });
  if (blocking) {
    throw new CheckoutError('risk_blocked', `This order was held by a risk rule: ${blocking.label}.`, evaluation);
  }

  const promo = appliedPromotion(db, view.lines, input.promoCode);
  const discount = promo?.discount ?? 0;
  const codFee = input.paymentMethod === 'cod' ? codFeeFor(address.city, view.totals.total) : 0;
  const total = Math.max(0, add(view.totals.subtotal, view.totals.delivery, view.totals.tax, codFee) - discount);

  const orderId = id('ord');
  const now = new Date().toISOString();
  const zone = zoneFor(address.city);
  const etaTo = new Date(Date.now() + zone.days[1] * 86400000).toISOString();
  const etaFrom = new Date(Date.now() + zone.days[0] * 86400000).toISOString();

  const order: Order = {
    id: orderId,
    code: code('HM'),
    buyerId,
    buyerName: db.users.find((u) => u.id === buyerId)?.name ?? 'Guest',
    status: input.paymentMethod === 'cod' ? 'confirmed' : 'pending_payment',
    lines: view.lines.map((l, i) => {
      const p = db.products.find((x) => x.id === l.productId)!;
      return {
        id: `${orderId}_l${i}`,
        productId: l.productId,
        offerId: l.offerId,
        sellerId: l.sellerId,
        title: l.title,
        titleAm: p.titleAm,
        image: l.image,
        qty: l.qty,
        unitPrice: l.unitPrice,
        lineTotal: l.unitPrice * l.qty,
        condition: l.condition,
        fulfillment: l.fulfillment,
        sellerName: l.sellerName,
      };
    }),
    address,
    addressSnapshotNote: input.note,
    subtotal: view.totals.subtotal,
    deliveryFee: view.totals.delivery,
    tax: view.totals.tax,
    discount,
    total,
    paymentMethod: input.paymentMethod,
    paymentState: input.paymentMethod === 'cod' ? 'authorized' : 'created',
    paid: 0,
    refunded: 0,
    channel: 'b2c',
    riskFlags: evaluation.triggered.map((t) => t.rule),
    riskScore: evaluation.score,
    invoiceNo: `INV-${code('').slice(1)}`,
    placedAt: now,
    etaFrom,
    etaTo,
    history: [{ status: 'pending_payment', at: now, actor: 'buyer', note: 'Order placed' }],
    canCancel: true,
    canReview: false,
  };

  // Reserve stock atomically.
  for (const line of view.lines) {
    const offer = db.offers.find((o) => o.id === line.offerId)!;
    offer.stock -= line.qty;
  }

  db.orders.unshift(order);
  db.shipments.push({
    id: id('sh'),
    orderId,
    agentId: undefined,
    partner: zone.days[0] > 3 ? 'ethio_post' : 'hanimarket_courier',
    zone: `${address.subcity} Zone`,
    codAmount: input.paymentMethod === 'cod' ? total : 0,
    status: 'pending',
    events: [{ id: id('se'), status: 'pending', at: now, actor: 'system', note: 'Awaiting seller dispatch' }],
    expectedAt: etaTo,
    attempt: 0,
    codFee,
  });
  order.shipment = db.shipments[db.shipments.length - 1];

  if (promo) {
    const record = db.promotions.find((p) => p.code === promo.code);
    if (record) record.usedCount += 1;
    db.couponsUsed.push({ code: promo.code, userId: buyerId, at: now });
  }

  idempotency.set(input.idempotencyKey, { orderId, at: now });
  // Clear only this buyer's basket — emptying a shared one would have wiped the
  // basket of every other signed-in user at the same time.
  cartOf(db, buyerId).lines = [];
  db.activity.unshift({ id: id('act'), at: now, actor: order.buyerName, action: 'order.placed', entity: 'order', entityId: orderId, detail: `${order.lines.length} line(s), ETB ${(total / 100).toLocaleString('en-ET')}` });
  return { order, replayed: false };
}

/**
 * Weight per severity. A single high-severity hit (38) plus one medium (21)
 * clears the review threshold, so a new account placing a large cash order is
 * actually looked at rather than waved through.
 */
const SEVERITY_WEIGHT = { high: 38, medium: 21, low: 9 } as const;

/**
 * Score a triggered-rule set. Every call site has to come through here: when
 * checkout and the admin preview each carried their own copy of this sum they
 * drifted, and the checkout copy was capped so that nothing could ever exceed
 * the allow threshold.
 */
export function riskScoreOf(triggered: readonly { severity: string }[]): number {
  const raw = triggered.reduce((a, t) => a + (SEVERITY_WEIGHT[t.severity as keyof typeof SEVERITY_WEIGHT] ?? SEVERITY_WEIGHT.low), 4);
  return Math.max(0, Math.min(99, raw));
}

/**
 * Score bands. `review` does not block by itself — the blocking decision is
 * made from the triggered rules' configured `action`, which is what operations
 * tunes. This only decides whether the order is surfaced for a human to look at.
 */
export function riskDecisionOf(score: number): 'allow' | 'review' {
  return score > 40 ? 'review' : 'allow';
}

export function evaluateRisk(db: Db, buyerId: string, view: CartView, method: PaymentMethod) {
  const user = db.users.find((u) => u.id === buyerId);
  const accountAgeDays = user ? Math.round((Date.now() - +new Date(user.createdAt)) / 86400000) : 0;
  const recent = db.orders.filter((o) => o.buyerId === buyerId && o.placedAt > minutesAgo(1440)).length;
  const subtotal = view.totals.subtotal;
  const triggered: { rule: string; label: string; severity: string; detail: string }[] = [];
  const signals = [
    { label: 'Account age', value: `${accountAgeDays} days` },
    { label: 'Orders in 24h', value: String(recent + 1) },
    { label: 'Basket value', value: `ETB ${(subtotal / 100).toLocaleString('en-ET')}` },
    { label: 'Payment method', value: method },
    { label: 'Zone coverage', value: view.deliveryEstimate.min > 3 ? 'Partner only' : 'Covered' },
  ];

  const rule = (ruleId: string) => db.riskRules.find((r) => r.id === ruleId)!;
  // Rule parameters are configuration, not code: read them as numbers and fall
  // back to a zero threshold if a value is ever stored as text.
  const numParam = (ruleId: string, key: string) => {
    const raw = rule(ruleId).params[key];
    return typeof raw === 'number' ? raw : Number(raw ?? 0);
  };
  // Severity and label come from the configured rule, so retuning a rule in
  // admin changes what checkout enforces rather than only what it displays.
  const hit = (ruleId: string, detail: string) => {
    const r = rule(ruleId);
    if (!r?.enabled) return;
    triggered.push({ rule: ruleId, label: r.label, severity: r.severity, detail });
  };
  if (recent + 1 > numParam('velocity_24h', 'maxOrders24h')) {
    hit('velocity_24h', `${recent + 1} orders in the last 24 hours.`);
  }
  if (accountAgeDays < numParam('new_account_high_value_cod', 'accountAgeDays') && method === 'cod' && subtotal > numParam('new_account_high_value_cod', 'amountThreshold')) {
    hit('new_account_high_value_cod', `Cash of ETB ${(subtotal / 100).toLocaleString('en-ET')} on a ${accountAgeDays}-day-old account.`);
  }
  if (view.deliveryEstimate.min > 3 && subtotal > numParam('impossible_delivery_combination', 'amountThreshold')) {
    hit('impossible_delivery_combination', 'This zone is partner-covered only; the order cannot be picked up by our own agent.');
  }

  const score = riskScoreOf(triggered);
  return { orderId: undefined, at: new Date().toISOString(), score, decision: riskDecisionOf(score), triggered, signals };
}

/* ---------------------------- Order transitions ------------------------- */

const ALLOWED: Record<Order['status'], Order['status'][]> = {
  pending_payment: ['confirmed', 'cancelled'],
  confirmed: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['out_for_delivery', 'delivered', 'disputed'],
  out_for_delivery: ['delivered', 'disputed', 'refunded'],
  delivered: ['disputed', 'refunded'],
  cancelled: [],
  refunded: [],
  disputed: ['refunded', 'delivered'],
};

export class TransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Illegal state transition: ${from} → ${to}. Allowed from ${from}: ${ALLOWED[from as Order['status']].join(', ') || 'nothing (terminal)'}`);
    this.name = 'TransitionError';
  }
}

export function transitionOrder(db: Db, order: Order, to: Order['status'], actor: Order['history'][number]['actor'], note?: string) {
  if (!ALLOWED[order.status].includes(to)) throw new TransitionError(order.status, to);
  const now = new Date().toISOString();
  order.status = to;
  order.history.push({ status: to, at: now, actor, note });
  order.canCancel = ALLOWED[to].includes('cancelled');
  order.canReview = to === 'delivered';

  const ship = order.shipment;
  if (ship) {
    const map: Partial<Record<Order['status'], ShipmentStatus>> = {
      packed: 'assigned',
      shipped: 'picked_up',
      out_for_delivery: 'out_for_delivery',
      delivered: 'delivered',
      cancelled: 'returned',
      refunded: 'returned',
    };
    const next = map[to];
    if (next) {
      ship.status = next;
      ship.events.push({ id: id('se'), status: next, at: now, actor: actor === 'agent' ? 'agent' : actor === 'seller' ? 'seller' : 'system', note });
      if (to === 'delivered') {
        ship.deliveredAt = now;
        if (ship.codAmount) ship.cashCollected = ship.codAmount;
        order.paymentState = 'released';
        order.paid = order.total;
      }
    }
  }
  if (to === 'cancelled') {
    for (const l of order.lines) {
      const offer = db.offers.find((o) => o.id === l.offerId);
      if (offer) offer.stock += l.qty;
    }
    order.paymentState = 'failed';
  }
  if (to === 'refunded') {
    order.refunded = order.total;
    order.paymentState = 'refunded';
  }
  db.activity.unshift({ id: id('act'), at: now, actor, action: `order.${to}`, entity: 'order', entityId: order.id, detail: note ?? '' });
  return order;
}

type ShipmentStatus = NonNullable<Db['shipments'][number]['status']>;

export { sum };
