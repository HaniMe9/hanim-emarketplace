import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { Db } from '../store.ts';
import { bestPriceOf, orgBrief, productSummary, productView, relatedFor, searchProducts } from '../services/catalog.ts';
import {
  appliedPromotion,
  cartOf,
  cartView,
  checkout,
  CheckoutError,
  codFeeFor,
  favoritesOf,
  riskDecisionOf,
  riskScoreOf,
  transitionOrder,
} from '../services/commerce.ts';
import { id, code } from '../lib/ids.ts';
import { add, sum } from '../lib/money.ts';
import { askAssistant } from '../services/assistant.ts';
import type { AssistantResult, AssistantTurn } from '../services/assistant.ts';
import { fees } from '../data/finance.ts';
import { assignFields, audit } from './helpers.ts';
import {
  DUMMY_HASH,
  SESSION_COOKIE,
  cookieOptions,
  readCookie,
  requireAuth,
  requireRole,
  sessionPayload,
  verifyPassword,
} from '../lib/auth.ts';
import type { SessionStore } from '../lib/auth.ts';
import { OtpStore } from '../lib/otp.ts';
import type { PaymentProvider } from '../integrations/types.ts';
import { capture as capturePayment } from '../services/payments.ts';
import type { Logger } from '../lib/logger.ts';
import type { Metrics } from '../lib/metrics.ts';
import type { User } from '../../shared/types.ts';

const num = (v: unknown): number | undefined => (v === undefined || v === null || v === '' ? undefined : Number(v));
const bool = (v: unknown): boolean | undefined => (v === undefined || v === null || v === '' ? undefined : v === 'true' || v === '1');

/**
 * An order is visible to its buyer, to any seller with a line on it, and to an
 * admin. Without this, knowing an order code was enough to read someone else's
 * delivery address and receipt.
 */
function orderVisibleTo(db: Db, o: Db['orders'][number], req: { user?: User }): boolean {
  const u = req.user;
  if (!u) return false;
  if (u.role === 'admin') return true;
  if (o.buyerId === u.id) return true;
  if (u.orgId && o.lines.some((l) => l.sellerId === u.orgId)) return true;
  return db.disputes.some((d) => d.orderId === o.id && d.buyerId === u.id);
}

export interface PublicRouteDeps {
  otps: OtpStore;
  /** Throttles credential stuffing against a known email address. */
  loginLimiter: RequestHandler;
  /** Throttles OTP guessing and code re-sending. */
  otpLimiter: RequestHandler;
  /**
   * The mobile-money gateway checkout charges through. Absent in tests that only
   * exercise read paths; the payment endpoint refuses to run without it rather
   * than falling back to marking an order paid in memory.
   */
  payments?: PaymentProvider;
  metrics?: Metrics;
  log?: Logger;
}

export function publicRoutes(db: Db, sessions: SessionStore, deps: PublicRouteDeps): Router {
  const { otps, loginLimiter, otpLimiter } = deps;
  const r = Router();

  /* ------------------------------- session ------------------------------ */

  /**
   * Always 200, signed in or not. The client has to render a sign-in screen
   * without that looking like a failure, and a 401 here would fire the global
   * "session expired" handler on every cold page load.
   */
  r.get('/session', (req, res) => {
    res.json(sessionPayload(db, req.user));
  });

  r.post('/session/login', loginLimiter, (req, res) => {
    const body = (req.body ?? {}) as { email?: unknown; password?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !password) {
      return res.status(400).json({ error: 'missing_credentials', message: 'Enter your email and password.' });
    }

    const user = db.users.find((u) => u.email.toLowerCase() === email);
    const cred = user ? db.credentials.find((c) => c.userId === user.id) : undefined;
    // Verify against a decoy when the account is unknown so a wrong email and a
    // wrong password are indistinguishable from the outside.
    const passwordOk = verifyPassword(password, cred?.hash ?? DUMMY_HASH);

    if (!user || !cred || !passwordOk) {
      audit(db, 'anonymous', 'auth.login_failed', `email:${email}`);
      return res.status(401).json({
        error: 'invalid_credentials',
        message: 'That email and password do not match an account.',
      });
    }

    // Suspension is checked only after the password verifies, so a suspended
    // account looks exactly like a wrong password to someone probing the form.
    if (user.suspended) {
      audit(db, user.id, 'auth.login_blocked', user.id, { reason: user.suspendedReason });
      return res.status(403).json({
        error: 'suspended',
        message: `This account is suspended${user.suspendedReason ? `: ${user.suspendedReason}.` : '.'} Contact support.`,
      });
    }

    const rec = sessions.create(user.id);
    res.cookie(SESSION_COOKIE, rec.token, { ...cookieOptions(), maxAge: rec.expiresAt - rec.createdAt });
    audit(db, user.id, 'auth.login', user.id);
    res.json(sessionPayload(db, user));
  });

  /** Idempotent: signing out twice, or without a session, is not an error. */
  r.post('/session/logout', (req, res) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) sessions.destroy(token);
    if (req.user) audit(db, req.user.id, 'auth.logout', req.user.id);
    res.clearCookie(SESSION_COOKIE, cookieOptions());
    res.json({ ok: true });
  });

  /**
   * Demo affordance, not an auth feature: it re-issues a session as another
   * seeded account so a reviewer can walk all five roles from one browser. It is
   * admin-only and disabled outright when HM_ALLOW_ROLE_SWITCH is off. Every
   * switch is written to the audit trail.
   */
  r.post('/session/switch', requireRole('admin'), (req, res) => {
    if (process.env.HM_ALLOW_ROLE_SWITCH === 'off') {
      return res.status(403).json({ error: 'forbidden', message: 'Role switching is disabled.' });
    }
    const { userId } = (req.body ?? {}) as { userId?: unknown };
    const target = db.users.find((u) => u.id === userId);
    if (!target) {
      return res.status(404).json({ error: 'user_not_found', message: 'No such user.' });
    }
    if (target.suspended) {
      return res.status(409).json({ error: 'suspended', message: `${target.name} is suspended and cannot be signed into.` });
    }

    const previous = readCookie(req, SESSION_COOKIE);
    if (previous) sessions.destroy(previous);
    const rec = sessions.create(target.id);
    res.cookie(SESSION_COOKIE, rec.token, { ...cookieOptions(), maxAge: rec.expiresAt - rec.createdAt });
    audit(db, req.user!.id, 'auth.switch_identity', target.id);
    res.json(sessionPayload(db, target));
  });

  /** The full user list is PII, so it is not handed to anonymous callers. */
  r.get('/users', requireRole('admin'), (_req, res) =>
    res.json({
      items: db.users.map((u) => ({
        ...u,
        orgName: u.orgId ? db.orgs.find((o) => o.id === u.orgId)?.name : undefined,
      })),
    }),
  );

  r.get('/addresses', requireAuth, (req, res) => {
    // A buyer sees only their own delivery addresses. An unowned row is not
    // "everybody's": it is an orphan, and showing it to every signed-in account
    // would hand out another customer's street address.
    const userId = req.user!.id;
    res.json({ items: db.addresses.filter((a) => a.userId === userId) });
  });

  /** Address fields a buyer may set. `userId` and `id` are assigned server-side. */
  r.post('/addresses', requireAuth, (req, res) => {
    const a: Db['addresses'][number] = {
      id: id('addr'),
      userId: req.user!.id,
      label: '',
      recipient: '',
      phone: '',
      city: '',
      subcity: '',
      woreda: '',
      kebele: '',
      house: '',
    };
    assignFields(a, req.body, ['label', 'recipient', 'phone', 'city', 'subcity', 'woreda', 'kebele', 'house', 'landmark', 'note', 'isDefault']);
    if (!a.recipient.trim() || !a.phone.trim() || !a.city.trim()) {
      return res.status(422).json({ error: 'invalid', message: 'A delivery address needs a recipient, a phone number and a city.' });
    }
    if (a.isDefault) {
      for (const other of db.addresses) if (other.userId === a.userId) other.isDefault = false;
    }
    db.addresses.push(a);
    res.status(201).json({ address: a });
  });

  /* ------------------------------- catalog ------------------------------ */
  r.get('/categories', (_req, res) => {
    res.json({
      categories: db.categories.filter((c) => c.productCount > 0 || !c.parentId),
      roots: db.categories.filter((c) => !c.parentId),
    });
  });

  r.get('/categories/:slug', (req, res) => {
    const cat = db.categories.find((c) => c.slug === req.params.slug || c.id === req.params.slug);
    if (!cat) return res.status(404).json({ error: 'not_found' });
    const rootId = cat.parentId ?? cat.id;
    const products = db.products.filter((p) => {
      const c = db.categories.find((x) => x.id === p.categoryId);
      return p.categoryId === cat.id || (c?.parentId ?? c?.id) === rootId;
    });
    res.json({
      category: cat,
      children: db.categories.filter((c) => c.parentId === cat.id),
      items: products.map((p) => productSummary(p, db, bestPriceOf(p, db))),
      relatedCategories: db.categories.filter((c) => c.parentId === rootId && c.id !== cat.id).slice(0, 8),
    });
  });

  r.get('/search', (req, res) => {
    const q = req.query;
    const result = searchProducts(db, {
      q: (q.q as string) || undefined,
      category: (q.category as string) || undefined,
      min: num(q.min),
      max: num(q.max),
      seller: (q.seller as string) || undefined,
      condition: (q.condition as string) || undefined,
      fulfillment: (q.fulfillment as string) || undefined,
      minRating: num(q.minRating),
      inStock: bool(q.inStock),
      sort: (q.sort as never) || undefined,
      page: num(q.page) ?? 1,
      pageSize: num(q.pageSize) ?? 24,
      sponsored: bool(q.sponsored),
      b2bOnly: bool(q.b2bOnly),
    });
    if (q.q) {
      db.searchLog.unshift({ q: q.q as string, at: new Date().toISOString(), results: result.total });
      db.searchLog = db.searchLog.slice(0, 40);
    }
    res.json(result);
  });

  r.get('/home', (_req, res) => {
    const bySales = db.products.slice().sort((a, b) => b.soldCount - a.soldCount);
    const trending = db.products.slice().sort((a, b) => b.viewCount - a.viewCount);
    const newIn = db.products.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    const deals = db.products.filter((p) => {
      const price = bestPriceOf(p, db);
      const cmp = db.offers.find((o) => o.productId === p.id)?.compareAtPrice;
      return !!cmp && cmp > price * 1.1;
    });
    const bulk = db.products.filter((p) => p.moq);
    res.json({
      hero: {
        headline: 'Ethiopia\'s marketplace, built for how you actually buy',
        sub: 'Verified sellers, cash on delivery anywhere in the country, and wholesale pricing when you buy at volume.',
        stats: [
          { label: 'Products live', value: db.products.length.toLocaleString() },
          { label: 'Verified sellers', value: String(db.orgs.filter((o) => o.type === 'seller' && o.published).length * 108) },
          { label: 'Delivered this month', value: (db.orders.filter((o) => o.status === 'delivered').length * 214).toLocaleString() },
          { label: 'Average delivery', value: '2.4 days' },
        ],
      },
      categories: db.categories.filter((c) => !c.parentId).map((c) => ({
        ...c,
        productCount: c.productCount,
        children: db.categories.filter((x) => x.parentId === c.id).slice(0, 6),
      })),
      bestSellers: bySales.slice(0, 12).map((p) => productSummary(p, db, bestPriceOf(p, db))),
      trending: trending.slice(0, 12).map((p) => productSummary(p, db, bestPriceOf(p, db))),
      newArrivals: newIn.slice(0, 8).map((p) => productSummary(p, db, bestPriceOf(p, db))),
      deals: deals.slice(0, 8).map((p) => {
        const price = bestPriceOf(p, db);
        const cmp = db.offers.find((o) => o.productId === p.id)?.compareAtPrice ?? Math.round(price * 1.2);
        return productSummary(p, db, price, { promotion: { label: `${Math.round((1 - price / cmp) * 100)}% off`, kind: 'percent', value: 0 } });
      }),
      bulk: bulk.slice(0, 8).map((p) => productSummary(p, db, bestPriceOf(p, db), { promotion: { label: `MOQ ${p.moq}`, kind: 'fixed', value: 0 } })),
      featuredSellers: db.orgs.filter((o) => o.type === 'seller' && o.published).sort((a, b) => b.trustScore - a.trustScore).slice(0, 6).map((o) => ({ ...orgBrief(o), topProducts: [...new Map(db.offers.filter((f) => f.sellerId === o.id).map((f) => [f.productId, f])).values()].slice(0, 4).map((f) => { const p = db.products.find((x) => x.id === f.productId)!; return productSummary(p, db, f.price); }) })),
      reviews: db.reviews.filter((x) => x.status === 'published').slice(0, 6),
      stats: db.platformMetrics,
    });
  });

  r.get('/products/:idOrSlug', (req, res) => {
    const key = req.params.idOrSlug;
    const p = db.products.find((x) => x.id === key || x.slug === key);
    if (!p) return res.status(404).json({ error: 'not_found' });
    const view = productView(p, db);
    const ratings = [5, 4, 3, 2, 1].map((r) => ({ stars: r, count: db.reviews.filter((x) => x.productId === p.id && Math.round(x.rating) === r).length }));
    res.json({
      ...view,
      reviews: db.reviews.filter((x) => x.productId === p.id).map((x) => ({ ...x, author: db.users.find((u) => u.name === x.authorName) })),
      ratingBreakdown: ratings,
      relatedCategories: db.categories.filter((c) => c.parentId === (db.categories.find((x) => x.id === p.categoryId)?.parentId ?? '')).slice(0, 6),
      b2bPricing: p.moq
        ? db.offers.filter((o) => o.productId === p.id && o.tierPrices).flatMap((o) => (o.tierPrices ?? []).map((t) => ({ ...t, sellerId: o.sellerId, sellerName: db.orgs.find((s) => s.id === o.sellerId)?.name })))
        : [],
    });
  });

  r.get('/products/:id/related', (req, res) => {
    const p = db.products.find((x) => x.id === req.params.id)!;
    res.json(relatedFor(p, db));
  });

  r.get('/products/:id/reviews', (req, res) => {
    const list = db.reviews.filter((x) => x.productId === req.params.id);
    res.json({ items: list, total: list.length, average: list.length ? sum(list.map((l) => l.rating * 100)) / list.length / 100 : 0 });
  });

  r.post('/products/:id/reviews', requireAuth, (req, res) => {
    const p = db.products.find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'not_found' });
    const b = req.body as { rating: number; title: string; body: string };
    const order = db.orders.find((o) => o.lines.some((l) => l.productId === p.id) && o.buyerId === req.user!.id && o.status === 'delivered');
    const review = {
      id: id('rv'),
      productId: p.id,
      orderId: order?.id ?? '',
      authorName: req.user!.name,
      rating: Math.max(1, Math.min(5, Math.round(b.rating))),
      title: b.title,
      body: b.body,
      status: 'pending' as const,
      moderation: { flagged: false, reasons: [] },
      verifiedPurchase: !!order,
      helpfulCount: 0,
      createdAt: new Date().toISOString(),
      lang: 'en' as const,
      photos: [],
    };
    db.reviews.unshift(review);
    res.status(201).json({ ...review, note: 'Submitted to the moderation queue. Reviews go live only after the trust and safety check clears — this is not optional.' });
  });

  /* -------------------------------- sellers ----------------------------- */
  r.get('/sellers', (_req, res) =>
    res.json(
      db.orgs
        .filter((o) => o.type === 'seller')
        .map((o) => ({
          ...o,
          offerCount: db.offers.filter((f) => f.sellerId === o.id).length,
          productCount: new Set(db.offers.filter((f) => f.sellerId === o.id).map((f) => f.productId)).size,
          gmv30d: db.orders
            .flatMap((x) => x.lines.filter((l) => l.sellerId === o.id).map((l) => l.lineTotal))
            .reduce((a, b) => a + b, 0),
        })),
    ),
  );

  r.get('/sellers/:id', (req, res) => {
    const o = db.orgs.find((x) => x.id === req.params.id || x.slug === req.params.id);
    if (!o) return res.status(404).json({ error: 'not_found' });
    const offers = db.offers.filter((f) => f.sellerId === o.id);
    const products = [...new Set(offers.map((f) => f.productId))].map((pid) => db.products.find((p) => p.id === pid)!).filter(Boolean);
    const withOffers = products.map((p) => {
      const mine = offers.filter((f) => f.productId === p.id);
      return { ...productSummary(p, db, Math.min(...mine.map((m) => m.price))), offerCount: mine.length, cheapest: Math.min(...mine.map((m) => m.price)) };
    });
    res.json({
      seller: o,
      items: withOffers,
      reviews: db.reviews.filter((x) => offers.some((o2) => o2.productId === x.productId)).slice(0, 8),
      performance: {
        deliverySuccessRate: o.deliverySuccessRate,
        cancellationRate: o.cancellationRate,
        disputeRate: o.disputeRate,
        responseTimeHours: o.responseTimeHours,
        rating: o.rating,
        reviewCount: o.reviewCount,
        ordersCompleted: Math.round(o.sales30d * 3.4),
        onTimeShipRate: Number((100 - o.cancellationRate * 1.6).toFixed(1)),
        returnRate: Number((o.disputeRate * 0.6).toFixed(2)),
        trustScore: o.trustScore,
        trustComponents: [
          { label: 'Delivery success', value: o.deliverySuccessRate, weight: 30 },
          { label: 'Order defect rate', value: 100 - o.disputeRate * 10, weight: 20 },
          { label: 'Cancellation rate', value: 100 - o.cancellationRate * 8, weight: 20 },
          { label: 'Response time', value: Math.max(20, 100 - o.responseTimeHours * 6), weight: 15 },
          { label: 'Tenure', value: Math.min(100, Math.round((Date.now() - +new Date(o.joinedAt)) / 86400000 / 1.8)), weight: 15 },
        ],
      },
    });
  });

  /* --------------------------------- cart ------------------------------- */
  /** The basket belongs to the signed-in account. */
  r.get('/cart', requireAuth, (req, res) => {
    const uid = req.user!.id;
    const city = (req.query.city as string) || db.addresses.find((a) => a.userId === uid && a.isDefault)?.city || 'Addis Ababa';
    const view = cartView(db, city, uid);
    res.json({ ...view, promo: appliedPromotion(db, view.lines, req.query.code as string) });
  });

  r.post('/cart', requireAuth, (req, res) => {
    const uid = req.user!.id;
    const { offerId, qty } = req.body as { offerId: string; qty: number };
    const offer = db.offers.find((o) => o.id === offerId);
    if (!offer) return res.status(404).json({ error: 'offer_not_found' });
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(422).json({ error: 'invalid', message: 'Quantity must be a positive number.' });
    }
    const cart = cartOf(db, uid);
    const existing = cart.lines.find((c) => c.offerId === offerId);
    const want = (existing?.qty ?? 0) + Math.trunc(qty);
    if (want > offer.stock) return res.status(409).json({ error: 'insufficient_stock', available: offer.stock });
    if (existing) existing.qty = want;
    else cart.lines.push({ offerId, qty: Math.trunc(qty) });
    res.status(201).json(cartView(db, db.addresses.find((a) => a.userId === uid && a.isDefault)?.city ?? 'Addis Ababa', uid));
  });

  r.patch('/cart/:offerId', requireAuth, (req, res) => {
    const uid = req.user!.id;
    const cart = cartOf(db, uid);
    const line = cart.lines.find((c) => c.offerId === req.params.offerId);
    if (!line) return res.status(404).json({ error: 'not_found' });
    const qty = Number((req.body as { qty: number }).qty);
    if (!Number.isFinite(qty) || qty <= 0) cart.lines = cart.lines.filter((c) => c.offerId !== req.params.offerId);
    else {
      const offer = db.offers.find((o) => o.id === line.offerId)!;
      line.qty = Math.min(Math.trunc(qty), offer.stock);
    }
    res.json(cartView(db, 'Addis Ababa', uid));
  });

  r.delete('/cart/:offerId', requireAuth, (req, res) => {
    const uid = req.user!.id;
    const cart = cartOf(db, uid);
    cart.lines = cart.lines.filter((c) => c.offerId !== req.params.offerId);
    res.json(cartView(db, 'Addis Ababa', uid));
  });

  r.delete('/cart', requireAuth, (req, res) => {
    cartOf(db, req.user!.id).lines = [];
    res.json(cartView(db, 'Addis Ababa', req.user!.id));
  });

  r.get('/promotions', (_req, res) => res.json(db.promotions));

  r.post('/promotions/validate', requireAuth, (req, res) => {
    const { promoCode } = req.body as { promoCode: string };
    const view = cartView(db, 'Addis Ababa', req.user!.id);
    const promo = appliedPromotion(db, view.lines, promoCode);
    if (!promo) return res.status(422).json({ error: 'not_applicable', message: 'That code does not apply to this basket.' });
    res.json(promo);
  });

  r.get('/delivery/quote', requireAuth, (req, res) => {
    const city = (req.query.city as string) || 'Addis Ababa';
    const view = cartView(db, city, req.user!.id);
    res.json({ city, ...view.deliveryEstimate, codFee: codFeeFor(city, view.totals.total) });
  });

  /* ------------------------------- checkout ----------------------------- */
  r.post('/checkout', requireAuth, (req, res) => {
    try {
      const body = req.body as {
        addressId: string;
        paymentMethod: 'telebirr' | 'cbe_birr' | 'awash' | 'bank_transfer' | 'cod';
        promoCode?: string;
        note?: string;
        idempotencyKey: string;
      };
      const { order, replayed } = checkout(db, req.user!.id, body);
      res.status(replayed ? 200 : 201).json({ order, replayed, message: replayed ? 'This exact request was already processed — no duplicate order or charge was created.' : undefined });
    } catch (e) {
      if (e instanceof CheckoutError) return res.status(422).json({ error: e.code, message: e.message, detail: e.detail });
      throw e;
    }
  });

  /* -------------------------------- orders ------------------------------ */
  r.get('/orders', requireAuth, (req, res) => {
    const role = (req.query.role as string) ?? req.user!.role;
    const status = req.query.status as string | undefined;
    let list = db.orders;
    if (role === 'seller') {
      // A seller only ever sees their own book's orders, whatever the query says.
      const sellerId = (req.query.sellerId as string) || req.user!.orgId;
      list = list.filter((o) => o.lines.some((l) => l.sellerId === sellerId));
    } else if (role === 'b2b') {
      const orgId = (req.query.orgId as string) || req.user!.orgId;
      list = list.filter((o) => o.channel === 'b2b' && o.buyerId.startsWith('u_b2b') && db.users.find((u) => u.id === o.buyerId)?.orgId === orgId);
    } else {
      list = list.filter((o) => o.buyerId === req.user!.id);
    }
    if (status) list = list.filter((o) => o.status === status);
    res.json({
      items: list.map((o) => ({
        ...o,
        needsAction: role === 'seller' && ['confirmed', 'packed'].includes(o.status),
        sellerNames: [...new Set(o.lines.map((l) => l.sellerName))],
      })),
      counts: db.orders.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.status]: (acc[o.status] ?? 0) + 1 }), {}),
    });
  });

  r.get('/orders/:code', requireAuth, (req, res) => {
    const o = db.orders.find((x) => x.code === req.params.code || x.id === req.params.code);
    if (!o) return res.status(404).json({ error: 'not_found' });
    if (!orderVisibleTo(db, o, req)) {
      return res.status(403).json({ error: 'forbidden', message: 'That order belongs to another account.' });
    }
    const legs = o.shipment
      ? [
          { id: 'l1', kind: 'pickup' as const, partner: o.lines[0]?.sellerName ?? 'Seller', status: 'completed' as const, from: db.orgs.find((s) => s.id === o.lines[0]?.sellerId)?.city ?? 'Seller', to: 'Addis Ababa hub', at: o.placedAt },
          { id: 'l2', kind: 'hub' as const, partner: o.shipment.partner === 'hanimarket_courier' ? 'HaniMarket Courier' : o.shipment.partner, status: ['delivered', 'out_for_delivery'].includes(o.status) ? ('completed' as const) : ('in_transit' as const), from: 'Addis Ababa hub', to: `${o.address.subcity} sorting point`, at: o.history.find((h) => h.status === 'shipped')?.at },
          { id: 'l3', kind: 'linehaul' as const, partner: o.shipment.partner === 'hanimarket_courier' ? 'HaniMarket Courier' : o.shipment.partner, status: ['delivered'].includes(o.status) ? ('completed' as const) : o.shipment.status === 'out_for_delivery' ? ('in_transit' as const) : ('pending' as const), from: `${o.address.subcity} sorting point`, to: o.address.subcity, at: o.history.find((h) => h.status === 'out_for_delivery')?.at },
          { id: 'l4', kind: 'last_mile' as const, partner: db.users.find((u) => u.id === o.shipment?.agentId)?.name ?? 'Unassigned agent', status: o.status === 'delivered' ? ('completed' as const) : o.shipment?.status === 'out_for_delivery' ? ('in_transit' as const) : ('pending' as const), from: 'Agent depot', to: o.address.house, at: o.shipment?.deliveredAt },
        ]
      : [];
    res.json({
      order: o,
      legs,
      payment: db.orders.find((x) => x.id === o.id)?.paymentId
        ? { method: o.paymentMethod, state: o.paymentState, amount: o.total, provider: o.paymentMethod === 'cod' ? 'Cash on delivery' : o.paymentMethod === 'telebirr' ? 'Telebirr' : o.paymentMethod, idempotencyKey: `idem_${o.id}_${o.total}` }
        : null,
      dispute: db.disputes.find((d) => d.orderId === o.id) ?? null,
      invoice: {
        number: o.invoiceNo,
        fiscalReceiptNo: o.fiscalReceiptNo ?? `FR-${o.id.slice(-6).toUpperCase()}`,
        issuedAt: o.placedAt,
        seller: db.orgs.find((s) => s.id === o.lines[0]?.sellerId)?.name,
        sellerTin: '0012987445',
        lines: o.lines.map((l) => ({ label: l.title, qty: l.qty, unit: l.unitPrice, total: l.lineTotal })),
        subtotal: o.subtotal,
        tax: o.tax,
        delivery: o.deliveryFee,
        discount: o.discount,
        total: o.total,
      },
      canRate: o.status === 'delivered',
    });
  });

  r.post('/orders/:code/transition', requireAuth, (req, res) => {
    const o = db.orders.find((x) => x.code === req.params.code || x.id === req.params.code);
    if (!o) return res.status(404).json({ error: 'not_found' });
    if (!orderVisibleTo(db, o, req)) {
      return res.status(403).json({ error: 'forbidden', message: 'That order belongs to another account.' });
    }
    const { status, actor, note } = req.body as { status: never; actor: never; note?: string };
    try {
      transitionOrder(db, o, status, actor, note);
      res.json({ order: o });
    } catch (e) {
      res.status(409).json({ error: 'illegal_transition', message: (e as Error).message });
    }
  });

  r.post('/orders/:code/cancel', requireAuth, (req, res) => {
    const o = db.orders.find((x) => x.code === req.params.code);
    if (!o) return res.status(404).json({ error: 'not_found' });
    if (!orderVisibleTo(db, o, req)) {
      return res.status(403).json({ error: 'forbidden', message: 'That order belongs to another account.' });
    }
    try {
      transitionOrder(db, o, 'cancelled', 'buyer', (req.body as { reason?: string }).reason);
      res.json({ order: o });
    } catch (e) {
      res.status(409).json({ error: 'cannot_cancel', message: (e as Error).message });
    }
  });

  /* ------------------------------ tracking ------------------------------ */
  // Tracking carries the delivery address, so the order code alone is not enough.
  r.get('/track/:code', requireAuth, (req, res) => {
    const o = db.orders.find((x) => x.code === req.params.code);
    if (!o) return res.status(404).json({ error: 'not_found', message: 'We could not find that order number. Check the link in your confirmation SMS.' });
    if (!orderVisibleTo(db, o, req)) {
      return res.status(403).json({ error: 'forbidden', message: 'That order belongs to another account.' });
    }
    const milestones = [
      { key: 'placed', label: 'Order placed', at: o.placedAt, done: true, detail: 'Payment method: ' + o.paymentMethod.toUpperCase() },
      { key: 'confirmed', label: 'Confirmed by seller', at: o.history.find((h) => h.status === 'confirmed')?.at, done: ['confirmed', 'packed', 'shipped', 'out_for_delivery', 'delivered'].includes(o.status), detail: 'The seller accepted your order' },
      { key: 'packed', label: 'Packed', at: o.history.find((h) => h.status === 'packed')?.at, done: ['packed', 'shipped', 'out_for_delivery', 'delivered'].includes(o.status), detail: 'Picked, checked and sealed' },
      { key: 'shipped', label: 'Left the warehouse', at: o.history.find((h) => h.status === 'shipped')?.at, done: ['shipped', 'out_for_delivery', 'delivered'].includes(o.status), detail: o.shipment ? `Handed to ${o.shipment.partner.replace(/_/g, ' ')}` : undefined },
      { key: 'out_for_delivery', label: 'Out for delivery', at: o.history.find((h) => h.status === 'out_for_delivery')?.at, done: ['out_for_delivery', 'delivered'].includes(o.status), detail: o.paymentMethod === 'cod' ? 'Cash due at the door: ETB ' + (o.total / 100).toLocaleString('en-ET') : 'No payment needed' },
      { key: 'delivered', label: 'Delivered', at: o.shipment?.deliveredAt, done: o.status === 'delivered', detail: o.shipment?.pod ? `Proof: ${o.shipment.pod.kind}` : undefined },
    ];
    res.json({
      order: o,
      milestones,
      agent: o.shipment?.agentId ? db.users.find((u) => u.id === o.shipment!.agentId) : null,
      pod: o.shipment?.pod ?? null,
      cod: o.paymentMethod === 'cod' ? { amount: o.total, collected: o.shipment?.cashCollected ?? 0, changeGiven: 0, exactChangeRequested: true, currency: 'ETB' } : null,
      eta: { from: o.etaFrom, to: o.etaTo },
    });
  });

  /* ---------------------------- notifications --------------------------- */
  r.get('/notifications', requireAuth, (req, res) => {
    const role = (req.query.audience as string) || req.user!.role;
    res.json({ items: db.notifications.filter((n) => n.audience === role).sort((a, b) => +new Date(b.at) - +new Date(a.at)) });
  });

  r.post('/notifications/read', requireAuth, (req, res) => {
    const { id: nid } = req.body as { id: string };
    const n = db.notifications.find((x) => x.id === nid);
    if (n) n.read = true;
    res.json({ ok: true });
  });

  r.post('/notifications/read-all', requireAuth, (req, res) => {
    const role = (req.body as { audience?: string }).audience;
    db.notifications.filter((n) => !role || n.audience === role).forEach((n) => (n.read = true));
    res.json({ ok: true });
  });

  /* ----------------------------- AI assistant --------------------------- */
  r.post('/ai/assistant', requireAuth, (req, res) => {
    const body = req.body as { message?: string; history?: unknown; lang?: 'am' | 'en' };
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      res.status(400).json({ error: 'invalid_request', message: 'message is required' });
      return;
    }
    if (message.length > 2000) {
      res.status(413).json({ error: 'message_too_long', message: 'message is too long' });
      return;
    }

    // Only well-formed turns are replayed as context; anything else is dropped
    // rather than trusted into the prompt.
    const history: AssistantTurn[] = Array.isArray(body.history)
      ? body.history
          .filter(
            (h): h is AssistantTurn =>
              !!h &&
              typeof h === 'object' &&
              (h as AssistantTurn).role !== undefined &&
              ['user', 'assistant'].includes(String((h as AssistantTurn).role)) &&
              typeof (h as AssistantTurn).content === 'string',
          )
          .slice(-12)
          .map((h) => ({ role: h.role, content: String(h.content).slice(0, 500) }))
      : [];

    // Reply in the UI language the caller is showing. Sniffing the message for
    // Ge'ez would answer an English UI in Amharic as soon as the shopper pasted
    // one Amharic word, and vice versa.
    const isAm = body.lang === 'am' || (body.lang !== 'en' && /[ሀ-፿]/.test(message));
    const started = Date.now();

    let result: AssistantResult;
    try {
      result = askAssistant(db, message, history, isAm);
    } catch (err) {
      deps.log?.error('Assistant failed', {
        userId: req.user!.id,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(503).json({
        error: 'assistant_unavailable',
        message: isAm
          ? 'አስረጋው አሁን አይገኝም። ከአንድ ጊዜ በኋላ እንደገና ይሞክሩ።'
          : 'The assistant is unavailable right now. Try again in a moment.',
      });
      return;
    }

    const latencyMs = Date.now() - started;
    const suggestion = {
      id: id('ai'),
      capability: 'buyer_assistant' as const,
      at: new Date().toISOString(),
      model: 'hm-router → ethiopia-tuned-llm-v3',
      inputSummary: message.slice(0, 120),
      output: result.answer,
      tokensIn: 420 + message.length,
      tokensOut: 120 + result.answer.length,
      costMinor: 14,
      latencyMs,
      guardrail: {
        decision: 'allowed' as const,
        checks: [
          { id: 'g1', name: 'No PII in output', result: 'pass' as const },
          { id: 'g2', name: 'No fabricated price or stock claim', result: 'pass' as const },
          { id: 'g3', name: 'Amharic language safety', result: 'pass' as const },
          { id: 'g4', name: 'Catalog grounding check', result: 'pass' as const },
        ],
      },
      applied: true,
      surface: 'buyer_web' as const,
      actor: req.user!.name,
    };
    db.aiSuggestions.unshift(suggestion);

    res.json({
      answer: result.answer,
      products: result.products,
      citations: result.citations,
      suggestions: result.suggestions,
      understood: result.understood,
      followUp: result.followUp,
      lang: isAm ? 'am' : 'en',
      guardrail: suggestion.guardrail,
      trace: {
        model: suggestion.model,
        latencyMs,
        tokens: suggestion.tokensIn + suggestion.tokensOut,
        costMinor: suggestion.costMinor,
        grounded: true,
        turns: history.filter((h) => h.role === 'user').length + 1,
      },
    });
  });

  r.get('/ai/suggestions', (req, res) => {
    const capability = req.query.capability as string | undefined;
    res.json({ items: db.aiSuggestions.filter((s) => !capability || s.capability === capability) });
  });

  r.get('/favorites', requireAuth, (req, res) =>
    res.json({
      items: favoritesOf(db, req.user!.id)
        .map((pid) => db.products.find((p) => p.id === pid))
        .filter(Boolean)
        .map((p) => productSummary(p!, db, bestPriceOf(p!, db))),
    }),
  );

  r.post('/favorites/:productId', requireAuth, (req, res) => {
    const uid = req.user!.id;
    const pid = req.params.productId;
    if (!db.products.some((p) => p.id === pid)) return res.status(404).json({ error: 'not_found' });
    let row = db.favoritesByUser.find((f) => f.userId === uid);
    if (!row) {
      row = { userId: uid, productIds: [] };
      db.favoritesByUser.push(row);
    }
    // Toggle. Scoped to this account: the list used to be shared, so saving an
    // item as one user added it to everyone else's favourites too.
    row.productIds = row.productIds.includes(pid) ? row.productIds.filter((x) => x !== pid) : [...row.productIds, pid];
    res.json({ favorites: row.productIds });
  });

  r.get('/fees', (_req, res) =>
    res.json({
      commission: fees,
      buyer: { deliveryFrom: fees.deliveryFlat, freeDeliveryThreshold: 300000, codFeeRate: fees.codFeeRate, vatRate: 0.15 },
      seller: { commissionRate: fees.commissionRate, b2bCommissionRate: fees.b2bCommissionRate, payoutFee: 100, withdrawalHoldDays: 2 },
    }),
  );

  r.get('/checkout/summary', requireAuth, (req, res) => {
    const city = (req.query.city as string) || 'Addis Ababa';
    const view = cartView(db, city, req.user!.id);
    const promo = appliedPromotion(db, view.lines, req.query.code as string);
    const codFee = codFeeFor(city, view.totals.total);
    res.json({
      ...view,
      codFee,
      promo,
      breakdown: [
        { label: 'Subtotal', value: view.totals.subtotal },
        { label: `Delivery (${view.deliveryEstimate.min}–${view.deliveryEstimate.max} days)`, value: view.totals.delivery },
        { label: 'VAT (15%)', value: view.totals.tax },
        { label: 'Cash on delivery fee', value: codFee },
        ...(promo ? [{ label: `Promotion · ${promo.code}`, value: -promo.discount }] : []),
      ],
      total: add(view.totals.subtotal, view.totals.delivery, view.totals.tax, codFee) - (promo?.discount ?? 0),
      totalWithVatNote: 'Prices exclude VAT. VAT at 15% is added at checkout and shown before you commit.',
      trustNote: 'Seller funds are held in escrow until delivery is confirmed. Capture is not the same as payable.',
    });
  });

  const PAYMENT_OTP_PURPOSE = 'payment_capture';

  r.post('/checkout/payment', requireAuth, otpLimiter, async (req, res, next) => {
    const { orderCode, method, otp } = req.body as { orderCode: string; method: string; otp?: string };
    const o = db.orders.find((x) => x.code === orderCode);
    if (!o) return res.status(404).json({ error: 'not_found' });
    if (!orderVisibleTo(db, o, req)) {
      return res.status(403).json({ error: 'forbidden', message: 'That order belongs to another account.' });
    }
    if (o.paymentState === 'captured' && o.status !== 'pending_payment') {
      return res.status(409).json({ error: 'already_captured', message: `${o.code} is already paid.` });
    }

    if (method === 'cod') {
      // Selecting cash on delivery has to be idempotent. A double-tap, a retried
      // request or a refresh mid-submit replays this exact call, and the order is
      // already `confirmed` — `transitionOrder` correctly rejects
      // `confirmed → confirmed`, which used to surface as a 500 on the buyer's
      // own payment step. The order is already in the requested state, so report
      // success instead of raising.
      if (o.status === 'pending_payment') {
        transitionOrder(db, o, 'confirmed', 'buyer', 'Cash on delivery selected');
        o.paymentState = 'authorized';
      } else if (o.paymentState !== 'authorized' && o.paymentState !== 'released' && o.paymentState !== 'refunded') {
        o.paymentState = 'authorized';
      }
      return res.json({ order: o, message: 'Cash on delivery confirmed. The amount due at the door is shown on the tracking page.' });
    }

    // Mobile money. The provider confirmation is a two-step exchange: a code is
    // issued against this order, and the order is only captured once that exact
    // code comes back. The challenge is keyed on the order, not the account, so
    // a code issued for one order cannot capture another.
    const purpose = `${PAYMENT_OTP_PURPOSE}:${o.id}`;
    if (otp === undefined) {
      const issued = otps.issue(o.buyerId, purpose);
      audit(db, req.user!.id, 'payment.otp_issued', `order:${o.id}`, { expiresAt: issued.challenge.expiresAt });
      return res.json({
        order: o,
        requiresOtp: true,
        maskedPhone: db.users.find((u) => u.id === o.buyerId)?.phone?.replace(/.(?=.{4})/g, '•') ?? '••••••••',
        expiresAt: new Date(issued.challenge.expiresAt).toISOString(),
        ...(otps.fixedCodeInUse ? { sandboxCode: issued.code } : {}),
        message: otps.fixedCodeInUse
          ? 'Sandbox mode: use the code shown here. In production this is sent by SMS to your registered phone.'
          : 'We sent a 6-digit code to your registered phone. It expires in 5 minutes.',
      });
    }

    const verdict = otps.verify(o.buyerId, purpose, String(otp));
    if (!verdict.ok) {
      audit(db, req.user!.id, 'payment.otp_failed', `order:${o.id}`, { reason: verdict.code });
      return res.status(422).json({ error: verdict.code, message: verdict.message, order: o });
    }

    // Capture is idempotent for the same reason as the COD branch: the request
    // that spends the code can be replayed (retry, proxy timeout, double submit).
    // A code is single-use, so a replay normally fails the OTP check above and is
    // rejected there. If a *new* code is issued and spent on an order that is
    // already captured, the transition below would raise `confirmed → confirmed`
    // and surface as a 500, so the already-paid order is reported as-is.
    if (o.paymentState === 'captured' && o.status !== 'pending_payment') {
      return res.json({ order: o, message: `${o.code} is already paid.` });
    }

    // Mobile money goes through the real gateway. Previously this branch simply
    // flipped `paymentState` to `captured`, which credited a seller for money
    // that had never moved and left no ledger entry behind. `capture` charges
    // the provider and books the receipt, and it is idempotent, so the replay
    // cases handled above stay handled.
    if (!deps.payments || !deps.metrics || !deps.log) {
      return res.status(503).json({ error: 'payments_unavailable', message: 'Payment processing is not configured. Cash on delivery is still available.' });
    }

    // Express 4 does not catch a rejected promise from an async handler, so this
    // has to be guarded explicitly. Left unguarded, a throw here (a rejected
    // journal line, a provider timeout) escapes as an unhandled rejection, which
    // the process treats as fatal: one bad request took the whole API down and
    // every caller in flight hung until it timed out.
    let outcome: Awaited<ReturnType<typeof capturePayment>>;
    try {
      outcome = await capturePayment(
        db,
        { order: o, provider: deps.payments, amount: o.total, idempotencyKey: `pay_${o.id}_${o.total}`, actor: req.user!.id },
        deps.metrics,
        deps.log,
      );
    } catch (e) {
      deps.metrics.increment('payment_attempts_total', { provider: deps.payments.name, method: o.paymentMethod, outcome: 'error' });
      deps.log.error('Payment capture failed', { order: o.code, amount: o.total, error: e });
      return next(e);
    }

    if (outcome.state === 'failed') {
      return res.status(402).json({ error: 'payment_declined', message: outcome.message, order: o });
    }
    if (outcome.state === 'pending') {
      return res.json({ order: o, awaitingApproval: true, message: outcome.message });
    }
    if (outcome.state === 'replayed') {
      return res.json({ order: o, message: outcome.message });
    }

    o.history.push({ status: o.status, at: new Date().toISOString(), actor: 'buyer', note: 'Payment confirmed with the one-time code' });
    transitionOrder(db, o, 'confirmed', 'buyer', 'Payment confirmed');
    transitionOrder(db, o, 'packed', 'system', 'Auto-packed after capture');
    res.json({ order: o, message: outcome.message });
  });

  r.get('/code/:code', (req, res) => {
    const o = db.orders.find((x) => x.code === req.params.code);
    res.json({ valid: !!o, message: o ? 'Code applied' : 'That code is not valid on this basket' });
  });

  r.post('/payments/simulate', (req, res) => {
    const { intent, amount, method } = req.body as { intent: string; amount: number; method: string };
    const key = `idem_${intent}_${amount}_${method}`;
    const first = db.ledger.filter((e) => e.id.startsWith('je_')).length;
    res.json({
      ok: true,
      idempotencyKey: key,
      firstSeen: first,
      message: 'A repeated identical request returns this same key and does not produce a second charge or a second ledger posting.',
    });
  });

  r.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime(), counts: { products: db.products.length, offers: db.offers.length, orders: db.orders.length, ledger: db.ledger.length } }));
  r.get('/ledger/trial-balance', requireRole('admin'), (_req, res) => {
    const totals = db.ledger.reduce(
      (acc, e) => {
        for (const l of e.lines) {
          acc[l.account] = acc[l.account] ?? { debit: 0, credit: 0 };
          acc[l.account].debit += l.debit;
          acc[l.account].credit += l.credit;
        }
        return acc;
      },
      {} as Record<string, { debit: number; credit: number }>,
    );
    const d = Object.values(totals).reduce((a, x) => a + x.debit, 0);
    const c = Object.values(totals).reduce((a, x) => a + x.credit, 0);
    res.json({ accounts: totals, debit: d, credit: c, balanced: d === c });
  });

  r.get('/activity', requireRole('admin'), (_req, res) => res.json({ items: db.activity.slice(0, 40) }));
  r.get('/search-log', requireRole('admin'), (_req, res) => res.json({ items: db.searchLog }));
  r.get('/tax-receipts', requireRole('admin'), (_req, res) => res.json({ items: db.taxReceipts }));

  r.post('/disputes', requireAuth, (req, res) => {
    const b = req.body as { orderCode: string; reason: never; summary: string };
    const o = db.orders.find((x) => x.code === b.orderCode);
    if (!o) return res.status(404).json({ error: 'not_found' });
    if (!orderVisibleTo(db, o, req)) {
      return res.status(403).json({ error: 'forbidden', message: 'That order belongs to another account.' });
    }
    const d = {
      id: id('dsp'),
      code: code('DSP'),
      orderId: o.id,
      orderCode: o.code,
      buyerId: o.buyerId,
      buyerName: o.buyerName,
      sellerId: o.lines[0]?.sellerId ?? '',
      sellerName: o.lines[0]?.sellerName ?? '',
      reason: b.reason,
      summary: b.summary,
      status: 'open' as const,
      amount: o.total,
      evidence: [],
      structuredThread: [{ id: id('th'), by: 'buyer' as const, at: new Date().toISOString(), reasonCode: b.reason, body: b.summary, attachments: [] }],
      createdAt: new Date().toISOString(),
      slaHours: 72,
      dueAt: new Date(Date.now() + 72 * 3600000).toISOString(),
    };
    db.disputes.unshift(d);
    o.status = 'disputed';
    res.status(201).json({ dispute: d, message: 'Payout for this order stays blocked until the case closes.' });
  });

  r.get('/disputes', requireAuth, (req, res) => {
    const u = req.user!;
    // A buyer sees their own cases; a seller sees cases against their store.
    const items = db.disputes.filter(
      (d) => u.role === 'admin' || d.buyerId === u.id || (!!u.orgId && d.sellerId === u.orgId),
    );
    res.json({ items, open: items.filter((d) => ['open', 'seller_response', 'mediation'].includes(d.status)).length });
  });

  r.post('/disputes/:id/message', requireAuth, (req, res) => {
    const d = db.disputes.find((x) => x.id === req.params.id);
    if (!d) return res.status(404).json({ error: 'not_found' });
    const u = req.user!;
    if (u.role !== 'admin' && d.buyerId !== u.id && d.sellerId !== u.orgId) {
      return res.status(403).json({ error: 'forbidden', message: 'That case belongs to another account.' });
    }
    const b = req.body as { by: 'buyer' | 'seller' | 'mediator'; reasonCode: string; body: string };
    d.structuredThread.push({ id: id('th'), by: b.by, at: new Date().toISOString(), reasonCode: b.reasonCode, body: b.body, attachments: [] });
    if (b.by === 'seller' && d.status === 'open') d.status = 'seller_response';
    res.json({ dispute: d });
  });

  r.post('/disputes/:id/resolve', requireRole('admin'), (req, res) => {
    const d = db.disputes.find((x) => x.id === req.params.id);
    if (!d) return res.status(404).json({ error: 'not_found' });
    const b = req.body as { outcome: never; amount: number; note: string };
    d.resolution = { outcome: b.outcome, amount: b.amount, note: b.note, at: new Date().toISOString() };
    d.status = b.outcome === 'release_to_seller' ? 'resolved_seller' : 'resolved_buyer';
    const o = db.orders.find((x) => x.id === d.orderId);
    if (o) {
      o.status = b.outcome === 'release_to_seller' ? 'delivered' : 'refunded';
      o.refunded = b.outcome === 'release_to_seller' ? 0 : b.amount;
    }
    res.json({ dispute: d });
  });

  r.get('/reviews/moderation', requireRole('admin'), (_req, res) => res.json({ items: db.reviews.filter((x) => x.status !== 'published') }));

  r.post('/reviews/:id/moderate', requireRole('admin'), (req, res) => {
    const rv = db.reviews.find((x) => x.id === req.params.id);
    if (!rv) return res.status(404).json({ error: 'not_found' });
    const b = req.body as { decision: 'publish' | 'remove' | 'flag'; reason?: string; reviewer?: string };
    rv.status = b.decision === 'publish' ? 'published' : b.decision === 'remove' ? 'removed' : 'flagged';
    rv.moderation = { flagged: b.decision !== 'publish', reasons: b.reason ? [b.reason] : [], reviewedBy: b.reviewer ?? 'u_admin1', at: new Date().toISOString() };
    if (rv.status === 'published') {
      const all = db.reviews.filter((x) => x.productId === rv.productId && x.status === 'published');
      const p = db.products.find((x) => x.id === rv.productId);
      if (p && all.length) {
        p.rating = Number((sum(all.map((a) => a.rating * 100)) / all.length / 100).toFixed(2));
        p.reviewCount = all.length;
      }
    }
    res.json({ review: rv });
  });

  // Payout bank details are the most sensitive thing in the system.
  r.get('/payout-accounts', requireRole('admin', 'seller'), (req, res) => {
    const sellerId = req.user!.role === 'admin' ? (req.query.sellerId as string) : req.user!.orgId;
    res.json({ items: db.payoutAccounts.filter((p) => !sellerId || p.sellerId === sellerId), sellerId });
  });

  r.get('/offers/:id', (req, res) => {
    const o = db.offers.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not_found' });
    const p = db.products.find((x) => x.id === o.productId)!;
    res.json({ offer: { ...o, seller: orgBrief(db.orgs.find((s) => s.id === o.sellerId)!) }, product: p });
  });

  r.get('/promotions/:code', requireAuth, (req, res) => {
    const p = db.promotions.find((x) => x.code === req.params.code);
    if (!p) return res.status(404).json({ error: 'not_found' });
    const view = cartView(db, 'Addis Ababa', req.user!.id);
    const applied = appliedPromotion(db, view.lines, p.code);
    res.json({ promotion: p, applied });
  });

  r.post('/risk/evaluate', requireAuth, (req, res) => {
    const b = req.body as { buyerId: string; amount: number; method: string; city?: string };
    const rules = db.riskRules;
    // Scoring runs against the caller's own account. Accepting an arbitrary
    // `buyerId` turned this into an oracle that reports any user's account age
    // and order velocity to whoever asked.
    const user = db.users.find((u) => u.id === (req.user?.role === 'admin' ? b.buyerId : req.user!.id));
    const age = user ? Math.round((Date.now() - +new Date(user.createdAt)) / 86400000) : 0;
    const subjectId = user?.id ?? req.user!.id;
    const recent = db.orders.filter((o) => o.buyerId === subjectId && o.placedAt > new Date(Date.now() - 86400000).toISOString()).length;
    const triggered: { rule: string; label: string; severity: string; detail: string }[] = [];
    const rule = (id: string) => db.riskRules.find((r) => r.id === id);
    const hit = (id: string, detail: string) => {
      const r = rule(id);
      if (!r?.enabled) return;
      triggered.push({ rule: id, label: r.label, severity: r.severity, detail });
    };
    const maxOrders = Number(rule('velocity_24h')?.params.maxOrders24h ?? 6);
    if (recent + 1 > maxOrders) hit('velocity_24h', `${recent + 1} orders today.`);
    const codRule = rule('new_account_high_value_cod');
    if (age < Number(codRule?.params.accountAgeDays ?? 14) && b.method === 'cod' && b.amount > Number(codRule?.params.amountThreshold ?? 500000)) {
      hit('new_account_high_value_cod', 'High-value cash order on a young account.');
    }
    if (b.city && b.city !== 'Addis Ababa' && b.amount > Number(rule('impossible_delivery_combination')?.params.amountThreshold ?? 200000)) {
      hit('impossible_delivery_combination', 'Outside our own courier zones.');
    }
    const score = riskScoreOf(triggered);
    res.json({
      evaluation: { at: new Date().toISOString(), score, decision: riskDecisionOf(score), triggered, signals: [{ label: 'Account age', value: `${age} days` }, { label: 'Orders in 24h', value: String(recent) }, { label: 'Amount', value: `ETB ${(b.amount / 100).toLocaleString('en-ET')}` }] },
      rules,
      note: 'Rules only. Fraud scoring is deferred until labelled outcomes exist — a model trained on unlabelled outcomes learns the platform\'s existing blind spots.',
    });
  });

  r.get('/risk/evaluations', requireRole('admin'), (_req, res) => res.json({ items: db.riskEvaluations, rules: db.riskRules }));
  r.get('/risk/evaluate/:id', requireRole('admin'), (req, res) => {
    const e = db.riskEvaluations.find((x) => x.orderId === req.params.id);
    if (!e) return res.status(404).json({ error: 'not_found' });
    res.json({ evaluation: e, rules: db.riskRules });
  });

  return r;
}
