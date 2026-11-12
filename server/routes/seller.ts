import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Db } from '../store.ts';
import { offerView, productView, selectBuyBox } from '../services/catalog.ts';
import { buildSellerMetrics } from '../data/metrics.ts';
import { id, code, notFound, audit, logActivity, actorFor, assignFields, ownerOf } from './helpers.ts';
import { rate, sum } from '../lib/money.ts';
import { fees } from '../data/finance.ts';
import type { PayoutAccount } from '../../shared/types.ts';

export function sellerRoutes(db: Db): Router {
  const r = Router();

  /**
   * Which store this request is about. A seller is pinned to their own org and
   * cannot read a competitor's by editing the query — only an admin, who is
   * already past the role gate, may pass `?sellerId=`.
   *
   * There is deliberately no fallback org. A seller record with no `orgId` used
   * to resolve to `org_selam`, which handed a real competitor's catalogue,
   * orders and payouts to anyone signed in as a seller without a store. The
   * caller turns a `null` into a 403; an org-less seller is a setup error, not
   * a licence to read somebody else's books.
   */
  const currentSeller = (req: Request) => {
    if (req.user?.role === 'admin') return (req.query.sellerId as string) || 'org_selam';
    return req.user?.orgId ?? null;
  };

  /**
   * `currentSeller` for handlers that go on to use the id. Refuses the request
   * itself so no handler has to remember the null case.
   */
  const sellerId = (req: Request, res: Response): string | null => {
    const sid = currentSeller(req);
    if (sid && db.orgs.some((o) => o.id === sid)) return sid;
    res.status(403).json({
      error: 'no_store',
      message: 'This account is not attached to a seller organisation yet.',
    });
    return null;
  };

  /* ------------------------------ dashboard ----------------------------- */
  r.get('/dashboard', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const org = db.orgs.find((o) => o.id === sid)!;
    const m = buildSellerMetrics(sid, db.offers, db.orders, db.products);
    const myOrders = db.orders.filter((o) => o.lines.some((l) => l.sellerId === sid));
    const myOffers = db.offers.filter((o) => o.sellerId === sid);

    const buyBox = myOffers.map((o) => {
      const p = db.products.find((x) => x.id === o.productId)!;
      const all = db.offers.filter((x) => x.productId === o.productId);
      const sel = selectBuyBox(all, db, p);
      const live = all.filter((x) => x.status === 'live' && x.stock > 0);
      const cheapest = live.slice().sort((a, b) => a.price - b.price)[0];
      const ranks = live.slice().sort((a, b) => a.price - b.price).findIndex((x) => x.id === o.id) + 1;
      return {
        offerId: o.id,
        productId: o.productId,
        title: p.title,
        image: p.images[0],
        price: o.price,
        cheapestPrice: cheapest?.price ?? o.price,
        delta: cheapest ? cheapest.price - o.price : 0,
        isCheapest: cheapest?.id === o.id,
        isBuyBox: sel.offer?.id === o.id,
        reason: sel.offer?.id === o.id ? sel.reason : undefined,
        competitorCount: live.length - 1,
        rankByPrice: ranks || 1,
        eligible: o.buyBoxEligible,
        ineligibilityReason: o.buyBoxEligible ? undefined : 'Verification tier is below the level required for Buy Box eligibility. Business verification is the gate.',
        stock: o.stock,
        promoted: o.promoted,
        lostAt: sel.offer?.id === o.id ? undefined : db.orders[0]?.placedAt,
      };
    });

    res.json({
      seller: org,
      metrics: m,
      buyBox,
      orders: {
        needsAction: myOrders.filter((o) => ['confirmed', 'packed'].includes(o.status)).map((o) => ({ ...o, sellerName: org.name, needsAction: true })),
        recent: myOrders.slice(0, 12).map((o) => ({ ...o, sellerName: org.name, needsAction: ['confirmed', 'packed'].includes(o.status) })),
        byStatus: myOrders.reduce<Record<string, number>>((a, o) => ({ ...a, [o.status]: (a[o.status] ?? 0) + 1 }), {}),
      },
      finance: {
        availableBalance: sum(
          db.settlements.filter((s) => s.sellerId === sid && s.status === 'paid').map((s) => s.netPayable),
        ),
        pendingEscrow: sum(
          db.orders
            .filter((o) => o.lines.some((l) => l.sellerId === sid) && ['delivered', 'out_for_delivery'].includes(o.status))
            .map((o) => o.lines.filter((l) => l.sellerId === sid).reduce((a, l) => a + l.lineTotal, 0)),
        ),
        settlements: db.settlements.filter((s) => s.sellerId === sid),
        payoutAccount: db.payoutAccounts.find((p) => p.sellerId === sid),
        commissionRate: fees.commissionRate,
        lifetimeCommission: myOrders.reduce((a, o) => a + o.lines.filter((l) => l.sellerId === sid).reduce((b, l) => b + rate(l.lineTotal, fees.commissionRate), 0), 0),
        lifetimeSales: myOrders.reduce((a, o) => a + o.lines.filter((l) => l.sellerId === sid).reduce((b, l) => b + l.lineTotal, 0), 0),
        taxReceipts: db.taxReceipts.slice(0, 12),
      },
      reorder: db.reorderSuggestions.filter((s) => db.offers.some((o) => o.sellerId === sid && o.productId === s.productId)),
      ai: db.aiSuggestions.filter((s) => s.surface === 'seller_portal').slice(0, 8),
      storePublication: {
        published: org.published,
        state: org.suspended ? 'suspended' : org.published ? 'published' : org.kyc.status === 'pending' ? 'pending_verification' : 'draft',
        events: [
          { key: 'registered', at: org.joinedAt, done: true, label: 'Registration complete' },
          { key: 'basic', at: org.kyc.reviewedAt, done: org.tier !== 'none', label: 'Basic identity verified' },
          { key: 'business', at: org.tier === 'trusted' || org.tier === 'enterprise' ? org.kyc.reviewedAt : undefined, done: ['trusted', 'enterprise'].includes(org.tier), label: 'Business verification cleared' },
          { key: 'published', at: org.published ? org.kyc.reviewedAt : undefined, done: org.published, label: 'Store published — visible to buyers' },
          { key: 'buybox', at: undefined, done: db.offers.some((o) => o.sellerId === sid && o.buyBoxEligible), label: 'Buy Box eligible' },
        ],
      },
    });
  });

  /* ------------------------------ listings ------------------------------ */
  r.get('/listings', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const status = req.query.status as string | undefined;
    const q = ((req.query.q as string) ?? '').toLowerCase();
    let list = db.offers.filter((o) => o.sellerId === sid);
    if (status && status !== 'all') list = list.filter((o) => o.status === status);
    if (q) list = list.filter((o) => db.products.find((p) => p.id === o.productId)?.title.toLowerCase().includes(q));
    res.json({
      items: list.map((o) => {
        const p = db.products.find((x) => x.id === o.productId)!;
        const view = productView(p, db);
        return {
          ...offerView(o, db, view.buyBox?.id),
          product: p,
          isBuyBox: view.buyBox?.id === o.id,
          competitorCount: db.offers.filter((x) => x.productId === o.productId && x.id !== o.id && x.status === 'live').length,
          revenue30d: db.orders.reduce((a, ord) => a + ord.lines.filter((l) => l.offerId === o.id).reduce((b, l) => b + l.lineTotal, 0), 0),
          unitsSold30d: db.orders.reduce((a, ord) => a + ord.lines.filter((l) => l.offerId === o.id).reduce((b, l) => b + l.qty, 0), 0),
        };
      }),
      counts: {
        all: db.offers.filter((o) => o.sellerId === sid).length,
        live: db.offers.filter((o) => o.sellerId === sid && o.status === 'live').length,
        draft: db.offers.filter((o) => o.sellerId === sid && o.status === 'draft').length,
        pending_review: db.offers.filter((o) => o.sellerId === sid && o.status === 'pending_review').length,
        paused: db.offers.filter((o) => o.sellerId === sid && o.status === 'paused').length,
        rejected: db.offers.filter((o) => o.sellerId === sid && o.status === 'rejected').length,
      },
    });
  });

  r.get('/listings/:id', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const found = db.offers.find((x) => x.id === req.params.id);
    const o = ownerOf(req, res, found, found?.sellerId, sid, 'Listing');
    if (!o) return;
    const p = db.products.find((x) => x.id === o.productId)!;
    const view = productView(p, db);
    res.json({ offer: offerView(o, db, view.buyBox?.id), product: p, siblings: db.offers.filter((x) => x.productId === o.productId).map((x) => offerView(x, db, view.buyBox?.id)), isBuyBox: view.buyBox?.id === o.id, buyBoxReason: view.buyBoxReason });
  });

  r.post('/listings', (req, res) => {
    const b = req.body as { productId: string; title: string; price: number; stock: number; condition: never; fulfillment: never; moq?: number; tierPrices?: { minQty: number; price: number }[]; description: string; categoryId: string; images?: string[]; brand?: string };
    const sid = sellerId(req, res);
    if (!sid) return;
    const org = db.orgs.find((o) => o.id === sid)!;
    const product = {
      id: id('p'),
      slug: b.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60),
      title: b.title,
      titleAm: '',
      description: b.description,
      categoryId: b.categoryId,
      brand: b.brand,
      attributes: {},
      images: b.images?.length ? b.images : ['/api/media/new1'],
      rating: 0,
      reviewCount: 0,
      soldCount: 0,
      viewCount: 0,
      tags: [],
      createdAt: new Date().toISOString(),
      moq: b.moq ?? null,
    };
    db.products.push(product);
    const offer = {
      id: id('of'),
      productId: product.id,
      sellerId: sid,
      price: b.price,
      stock: b.stock,
      condition: b.condition,
      fulfillment: b.fulfillment,
      location: org.city,
      etaDays: [2, 4] as [number, number],
      buyBoxEligible: org.tier !== 'none',
      promoted: false,
      tierPrices: b.tierPrices,
      status: 'pending_review' as const,
      rating: 0,
      createdAt: new Date().toISOString(),
    };
    db.offers.push(offer);
    db.activity.unshift({ id: id('act'), at: new Date().toISOString(), actor: org.name, action: 'listing.submitted', entity: 'offer', entityId: offer.id, detail: b.title });
    res.status(201).json({
      offer: offerView(offer, db),
      product,
      message: 'Submitted to moderation. Listings go live after the trust and safety check clears — we do not publish unmoderated listings.',
    });
  });

  /**
   * Fields a seller may change on their own listing. Deliberately absent:
   * `sellerId` (that is the tenancy key), `status` (publishing is the trust and
   * safety team's decision, not the seller's), `buyBoxEligible` (gated on
   * verification tier), `promoted` (a paid placement, purchased through its own
   * endpoint), `rating` and `createdAt`.
   */
  const LISTING_EDITABLE = [
    'price',
    'compareAtPrice',
    'stock',
    'condition',
    'fulfillment',
    'location',
    'etaDays',
    'warranty',
    'tierPrices',
  ] as const satisfies readonly (keyof Db['offers'][number] & string)[];

  r.patch('/listings/:id', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const found = db.offers.find((x) => x.id === req.params.id);
    const o = ownerOf(req, res, found, found?.sellerId, sid, 'Listing');
    if (!o) return;
    if (o.status === 'pending_review') {
      return res.status(409).json({
        error: 'in_review',
        message: 'This listing is with trust and safety. Edits resume once the review is decided.',
      });
    }
    assignFields(o, req.body, LISTING_EDITABLE);
    if (o.price < 0 || o.stock < 0) {
      return res.status(422).json({ error: 'invalid', message: 'Price and stock cannot be negative.' });
    }
    res.json({ offer: offerView(o, db) });
  });

  r.delete('/listings/:id', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const found = db.offers.find((x) => x.id === req.params.id);
    const o = ownerOf(req, res, found, found?.sellerId, sid, 'Listing');
    if (!o) return;
    o.status = 'paused';
    logActivity(db, db.orgs.find((x) => x.id === sid)?.name ?? 'Seller', 'listing.paused', 'offer', o.id, o.id);
    res.json({ ok: true, status: 'paused' });
  });

  /* ----------------------------- inventory ------------------------------ */
  r.get('/inventory', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const items = db.offers
      .filter((o) => o.sellerId === sid)
      .map((o) => {
        const p = db.products.find((x) => x.id === o.productId)!;
        const sold30 = db.orders.reduce((a, ord) => a + ord.lines.filter((l) => l.offerId === o.id).reduce((b, l) => b + l.qty, 0), 0);
        const reorder = db.reorderSuggestions.find((s) => s.productId === o.productId);
        const committed = db.orders
          .filter((ord) => !['delivered', 'cancelled', 'refunded'].includes(ord.status))
          .reduce((a, ord) => a + ord.lines.filter((l) => l.offerId === o.id).reduce((b, l) => b + l.qty, 0), 0);
        return {
          offerId: o.id,
          productId: o.productId,
          title: p.title,
          image: p.images[0],
          sku: `${o.sellerId.replace('org_', '').toUpperCase().slice(0, 4)}-${p.id.slice(2)}`,
          onHand: o.stock,
          reserved: committed,
          available: o.stock - committed,
          reorderLevel: o.tierPrices ? 40 : 25,
          sold30d: sold30,
          avgDailySales: Number((sold30 / 30).toFixed(2)),
          daysOfCover: sold30 > 0 ? Math.round(o.stock / (sold30 / 30)) : 999,
          value: o.stock * o.price,
          cost: o.stock * (reorder?.unitCost ?? Math.round(o.price * 0.78)),
          location: o.location,
          status: o.stock === 0 ? 'out_of_stock' : o.stock <= (o.tierPrices ? 40 : 25) ? 'low' : 'healthy',
          reorder: reorder ?? null,
        };
      })
      .sort((a, b) => a.daysOfCover - b.daysOfCover);
    res.json({
      items,
      summary: {
        skus: items.length,
        totalUnits: sum(items.map((i) => i.onHand)),
        reservedUnits: sum(items.map((i) => i.reserved)),
        stockValue: sum(items.map((i) => i.value)),
        lowStock: items.filter((i) => i.status === 'low').length,
        outOfStock: items.filter((i) => i.status === 'out_of_stock').length,
      },
      note: 'Seller ERP consumes StockAdjusted events from the Inventory context. It does not keep its own copy of stock — this table is the single source of truth.',
    });
  });

  r.post('/inventory/:offerId/adjust', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const found = db.offers.find((x) => x.id === req.params.offerId);
    const o = ownerOf(req, res, found, found?.sellerId, sid, 'Listing');
    if (!o) return;
    const b = req.body as { delta: number; reason: string; note?: string };
    if (!Number.isFinite(b.delta) || !b.reason) {
      return res.status(422).json({ error: 'invalid', message: 'An adjustment needs a signed quantity and a reason.' });
    }
    o.stock = Math.max(0, o.stock + Math.trunc(b.delta));
    // The feed records who made the change, which is the caller — not the org
    // that happens to own the listing, which would attribute the edit to them.
    logActivity(db, db.orgs.find((x) => x.id === sid)?.name ?? 'Seller', 'StockAdjusted', 'offer', o.id, `${b.delta > 0 ? '+' : ''}${b.delta} — ${b.reason}`);
    res.json({ offer: offerView(o, db), event: { type: 'StockAdjusted', at: new Date().toISOString(), delta: b.delta, reason: b.reason, note: b.note } });
  });

  r.get('/reorder', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    res.json({
      items: db.reorderSuggestions.filter((s) => db.offers.some((o) => o.sellerId === sid && o.productId === s.productId)),
      note: 'Suggestions only. Nothing is ever auto-ordered, and every number shows the reasoning behind it so you can disagree.',
      method: '28-day moving average, with promotional spikes excluded',
    });
  });

  /* -------------------------------- orders ------------------------------ */
  r.get('/orders', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const status = req.query.status as string | undefined;
    let list = db.orders.filter((o) => o.lines.some((l) => l.sellerId === sid));
    if (status && status !== 'all') list = list.filter((o) => o.status === status);
    res.json({
      items: list.map((o) => {
        const mine = o.lines.filter((l) => l.sellerId === sid);
        return {
          ...o,
          lines: mine,
          subtotal: sum(mine.map((l) => l.lineTotal)),
          total: sum(mine.map((l) => l.lineTotal)) + Math.round(o.deliveryFee * 0.6) + Math.round(o.tax * 0.6),
          sellerName: db.orgs.find((x) => x.id === sid)?.name ?? '',
          needsAction: ['confirmed', 'packed'].includes(o.status),
        };
      }),
      counts: db.orders
        .filter((o) => o.lines.some((l) => l.sellerId === sid))
        .reduce<Record<string, number>>((a, o) => ({ ...a, [o.status]: (a[o.status] ?? 0) + 1 }), {}),
    });
  });

  r.post('/orders/:code/fulfil', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const found = db.orders.find((x) => x.code === req.params.code);
    // A seller may only progress an order they have a line on.
    const o = ownerOf(req, res, found, found?.lines.some((l) => l.sellerId === sid) ? sid : undefined, sid, 'Order');
    if (!o) return;
    const b = req.body as { action: 'pack' | 'ship' | 'cancel'; note?: string; trackingRef?: string };
    const map = { pack: 'packed', ship: 'shipped', cancel: 'cancelled' } as const;
    const target = map[b.action];
    if (!target) return res.status(422).json({ error: 'invalid', message: 'Action must be pack, ship or cancel.' });
    const o2 = o;
    const allowed = (o2.status === 'confirmed' && target === 'packed') || (o2.status === 'packed' && target === 'shipped') || (['confirmed', 'packed', 'shipped'].includes(o2.status) && target === 'cancelled');
    if (!allowed) return res.status(409).json({ error: 'illegal_transition', message: `Cannot go from ${o2.status} to ${target}.` });
    o2.status = target;
    o2.history.push({ status: target, at: new Date().toISOString(), actor: 'seller', note: b.note ?? (b.action === 'ship' ? `Handed to courier${b.trackingRef ? ` · ${b.trackingRef}` : ''}` : undefined) });
    if (o2.shipment) {
      const st = target === 'packed' ? 'assigned' : target === 'shipped' ? 'picked_up' : 'returned';
      o2.shipment.status = st;
      o2.shipment.events.push({ id: id('se'), status: st, at: new Date().toISOString(), actor: 'seller', note: b.note });
    }
    res.json({ order: o2 });
  });

  /* -------------------------------- store ------------------------------- */
  r.get('/store', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const org = db.orgs.find((o) => o.id === sid)!;
    res.json({
      org,
      offers: db.offers.filter((o) => o.sellerId === sid).length,
      products: new Set(db.offers.filter((o) => o.sellerId === sid).map((o) => o.productId)).size,
      kyc: org.kyc,
      verificationCase: db.verificationCases.find((v) => v.orgId === sid) ?? null,
      limits: {
        tier: org.tier,
        maxTransaction: org.tier === 'none' ? 0 : org.tier === 'basic' ? 5000000 : org.tier === 'trusted' ? 25000000 : 200000000,
        b2bEligible: ['trusted', 'enterprise'].includes(org.tier),
        buyBoxEligible: db.offers.some((o) => o.sellerId === sid && o.buyBoxEligible),
        promotedEligible: org.trustScore >= 70,
        subscriptionEligible: org.tier !== 'none',
        nextTier: org.tier === 'none' ? 'basic' : org.tier === 'basic' ? 'business' : org.tier === 'business' ? 'trusted' : 'enterprise',
      },
    });
  });

  /**
   * A seller edits their public storefront. `tier`, `published`, `suspended`,
   * `trustScore`, `kyc`, `joinedAt` and `sales30d` are deliberately not on this
   * list — they are verification and trust outcomes that a self-service form has
   * no business setting, and `Object.assign` over the whole org handed it to any
   * seller who sent the field.
   */
  const STORE_EDITABLE = ['name', 'description', 'phone', 'city', 'region'] as const satisfies readonly (keyof Db['orgs'][number] & string)[];

  r.patch('/store', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const org = db.orgs.find((o) => o.id === sid)!;
    const written = assignFields(org, req.body, STORE_EDITABLE);
    if (written.includes('name') && org.name.trim().length < 2) {
      return res.status(422).json({ error: 'invalid', message: 'A store name needs at least two characters.' });
    }
    audit(db, actorFor(db, req, 'seller').name, 'seller.self_update', `org:${org.id}`, { fields: written });
    res.json({ org, message: written.length ? 'Storefront updated.' : 'Nothing to update.' });
  });

  r.get('/verification', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const org = db.orgs.find((o) => o.id === sid)!;
    res.json({
      org,
      kyc: org.kyc,
      case: db.verificationCases.find((v) => v.orgId === sid) ?? null,
      tiers: [
        { tier: 'none', label: 'Registered', requirements: ['Email and phone verified'], limits: 'Cannot list products. Store is invisible to buyers.', color: 'bad' },
        { tier: 'basic', label: 'Basic identity', requirements: ['Business registration', 'Owner ID', 'TIN validation'], limits: 'ETB 50,000 transaction limit per order. No Buy Box, no B2B.', color: 'warn' },
        { tier: 'business', label: 'Business verified', requirements: ['Bank account ownership', 'Trade licence', 'Sanctions screening'], limits: 'ETB 250,000 per order. Store published. Buy Box eligible.', color: 'info' },
        { tier: 'trusted', label: 'Trusted seller', requirements: ['90 days of delivery history above 82%', 'Dispute rate under 4%', 'Payout account verified'], limits: 'ETB 2.5M per order. B2B access, promoted listings, Priority support.', color: 'brand' },
        { tier: 'enterprise', label: 'Enterprise', requirements: ['12 months of history', 'Audited financials', 'FBA or own-fleet fulfilment proof'], limits: 'Unlimited order value. Prime badge, FBA pool access, dedicated account manager.', color: 'gold' },
      ],
    });
  });

  /* ------------------------------ settlements --------------------------- */
  r.get('/payouts', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const settlements = db.settlements.filter((s) => s.sellerId === sid);
    res.json({
      settlements,
      accounts: db.payoutAccounts.filter((p) => p.sellerId === sid),
      statementTotals: {
        gross: sum(settlements.map((s) => s.grossSales)),
        commission: sum(settlements.map((s) => s.commission)),
        refunds: sum(settlements.map((s) => s.refunds)),
        withholding: sum(settlements.map((s) => s.withholdingTax)),
        net: sum(settlements.map((s) => s.netPayable)),
      },
      journal: db.ledger.filter((e) => e.refId.startsWith('stl_') || settlements.some((s) => e.refId === s.id)).slice(0, 20),
    });
  });

  /* ------------------------------- analytics ---------------------------- */
  r.get('/analytics', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const m = buildSellerMetrics(sid, db.offers, db.orders, db.products);
    const myOffers = db.offers.filter((o) => o.sellerId === sid);
    const traffic = myOffers.slice(0, 10).map((o) => {
      const p = db.products.find((x) => x.id === o.productId)!;
      return { id: p.id, title: p.title, views: p.viewCount, sold: p.soldCount, conversion: Number(((p.soldCount / Math.max(1, p.viewCount)) * 100).toFixed(2)) };
    });
    res.json({
      metrics: m,
      traffic: traffic.sort((a, b) => b.conversion - a.conversion),
      searches: db.searchLog.filter((s) => traffic.some((t) => t.title.toLowerCase().includes(s.q.toLowerCase()))).slice(0, 10),
      cohorts: [
        { label: 'New visitors', pct: 62, converted: 1.8, note: 'Most traffic is new — search and browse, not returning' },
        { label: 'Returning', pct: 27, converted: 4.6, note: 'Returning visitors convert 2.5x better' },
        { label: 'Direct', pct: 11, converted: 6.1, note: 'Highest intent, usually from shared links' },
      ],
      devices: [
        { label: 'Mobile', pct: 71 },
        { label: 'Desktop', pct: 22 },
        { label: 'Tablet', pct: 7 },
      ],
      ranking: {
        signals: [
          { name: 'Price vs category median', weight: 34, note: 'Your Buy Box weight is the highest single factor' },
          { name: 'Fulfilment method', weight: 16, note: 'FBA offers get a meaningful lift' },
          { name: 'Delivery reliability', weight: 16, note: `${db.orgs.find((o) => o.id === sid)?.deliverySuccessRate}% success rate` },
          { name: 'Delivery speed', weight: 10, note: 'Faster promised delivery ranks higher' },
          { name: 'Stock availability', weight: 8, note: 'Backordered offers are demoted' },
          { name: 'Seller trust score', weight: 10, note: 'Computed from real order and delivery events, never self-reported' },
        ],
        buyBoxWins: myOffers.filter((o) => selectBuyBox(db.offers.filter((x) => x.productId === o.productId), db, db.products.find((p) => p.id === o.productId)!).offer?.id === o.id).length,
        total: myOffers.length,
      },
    });
  });

  /* -------------------------------- mini ERP ---------------------------- */
  r.get('/erp/suppliers', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    res.json({
      items: db.suppliers.filter((s) => s.sellerId === sid),
      summary: {
        count: db.suppliers.filter((s) => s.sellerId === sid).length,
        totalSpend: sum(db.suppliers.filter((s) => s.sellerId === sid).map((s) => s.totalSpend)),
        openOrders: sum(db.suppliers.filter((s) => s.sellerId === sid).map((s) => s.openOrders)),
        avgRating: Number((sum(db.suppliers.filter((s) => s.sellerId === sid).map((s) => s.rating * 100)) / Math.max(1, db.suppliers.filter((s) => s.sellerId === sid).length) / 100).toFixed(2)),
      },
    });
  });

  r.get('/erp/procurement', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const list = db.procurementOrders.filter((p) => p.sellerId === sid);
    res.json({
      items: list,
      summary: {
        open: list.filter((p) => !['received', 'cancelled', 'draft'].includes(p.status)).length,
        awaitingReceipt: list.filter((p) => ['issued', 'acknowledged', 'partially_received'].includes(p.status)).length,
        late: list.filter((p) => !['received', 'cancelled', 'draft'].includes(p.status) && +new Date(p.expectedAt) < Date.now()).length,
        committed: sum(list.filter((p) => !['received', 'cancelled'].includes(p.status)).map((p) => p.total)),
        receivedValue: sum(list.filter((p) => p.status === 'received').map((p) => p.total)),
      },
    });
  });

  r.post('/erp/procurement/:id/receive', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const found = db.procurementOrders.find((x) => x.id === req.params.id);
    const p = ownerOf(req, res, found, found?.sellerId, sid, 'Purchase order');
    if (!p) return;
    const b = req.body as { lineId: string; qty: number; condition: 'good' | 'damaged'; note?: string };
    const line = p.lines.find((l) => l.id === b.lineId);
    if (!line) return notFound(res, 'Purchase order line');
    if (!Number.isFinite(b.qty) || b.qty <= 0) {
      return res.status(422).json({ error: 'invalid', message: 'A receipt needs a positive quantity.' });
    }
    line.receivedQty = Math.min(line.qty, line.receivedQty + Math.trunc(b.qty));
    if (b.condition === 'good' && p.sellerId) {
      const offer = db.offers.find((o) => o.sellerId === p.sellerId && o.productId && o.productId === p.id);
      if (offer) offer.stock += Math.trunc(b.qty);
    }
    const all = p.lines.every((l) => l.receivedQty >= l.qty);
    p.status = all ? 'received' : 'partially_received';
    if (all) p.receivedAt = new Date().toISOString();
    res.json({ order: p, goodsReceipt: { id: code('GR'), at: new Date().toISOString(), lineId: b.lineId, qty: b.qty, condition: b.condition, note: b.note } });
  });

  r.get('/erp/expenses', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const list = db.expenses.filter((e) => e.sellerId === sid);
    const byCategory = [...new Set(list.map((e) => e.category))].map((c) => ({
      category: c,
      total: sum(list.filter((e) => e.category === c).map((e) => e.amount)),
      count: list.filter((e) => e.category === c).length,
    }));
    res.json({
      items: list,
      byCategory: byCategory.sort((a, b) => b.total - a.total),
      summary: {
        thisMonth: sum(list.filter((e) => +new Date(e.incurredAt) > Date.now() - 30 * 86400000).map((e) => e.amount)),
        recurring: sum(list.filter((e) => e.recurring).map((e) => e.amount)),
        accrued: sum(list.filter((e) => e.status === 'accrued').map((e) => e.amount)),
        due: list.filter((e) => e.nextDueAt && +new Date(e.nextDueAt) < Date.now() + 7 * 86400000).length,
      },
    });
  });

  /** A seller records their own spend. `sellerId` and `id` are assigned here. */
  r.post('/erp/expenses', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const e: Db['expenses'][number] = {
      id: id('exp'),
      sellerId: sid,
      category: 'other',
      label: '',
      amount: 0,
      incurredAt: new Date().toISOString(),
      recurring: false,
      recurrence: null,
      status: 'recorded',
    };
    const written = assignFields(e, req.body, ['category', 'label', 'amount', 'recurring', 'recurrence', 'nextDueAt', 'status', 'vendor', 'attachment']);
    if (!e.label.trim() || e.amount <= 0) {
      return res.status(422).json({ error: 'invalid', message: 'An expense needs a label and a positive amount.' });
    }
    db.expenses.unshift(e);
    res.status(201).json({ expense: e, fields: written });
  });

  r.get('/erp/employees', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const list = db.employees.filter((e) => e.sellerId === sid);
    res.json({
      items: list,
      summary: {
        headcount: list.filter((e) => e.status === 'active').length,
        onLeave: list.filter((e) => e.status === 'on_leave').length,
        monthlyPayroll: sum(list.filter((e) => e.status === 'active').map((e) => e.monthlyPayroll)),
        byDepartment: [...new Set(list.map((e) => e.department))].map((d) => ({ department: d, count: list.filter((e) => e.department === d).length, payroll: sum(list.filter((e) => e.department === d).map((e) => e.monthlyPayroll)) })),
      },
    });
  });

  r.get('/erp/production', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const list = db.productionBatches.filter((b) => b.sellerId === sid);
    res.json({
      items: list.map((b) => ({ ...b, materialCost: sum(b.bom.map((x) => x.qtyPerUnit * x.unitCost)) })),
      summary: {
        active: list.filter((b) => ['planned', 'in_production', 'quality_check'].includes(b.status)).length,
        completed: list.filter((b) => b.status === 'completed').length,
        avgYield: Number((sum(list.map((b) => b.yieldPct)) / Math.max(1, list.length)).toFixed(1)),
        wipValue: sum(list.filter((b) => b.status !== 'completed' && b.status !== 'scrapped').map((b) => b.unitCost * b.producedQty)),
      },
    });
  });

  /** Batch fields the seller owns. `yieldPct` is derived below, never accepted. */
  const BATCH_EDITABLE = [
    'productId',
    'productTitle',
    'status',
    'plannedQty',
    'producedQty',
    'scrappedQty',
    'bom',
    'startedAt',
    'completedAt',
    'unitCost',
  ] as const satisfies readonly (keyof Db['productionBatches'][number] & string)[];

  r.post('/erp/production', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const batch: Db['productionBatches'][number] = {
      id: id('bt'),
      code: code('BATCH'),
      sellerId: sid,
      productId: '',
      productTitle: '',
      status: 'planned',
      plannedQty: 0,
      producedQty: 0,
      scrappedQty: 0,
      bom: [],
      startedAt: new Date().toISOString(),
      yieldPct: 0,
      unitCost: 0,
    };
    assignFields(batch, req.body, BATCH_EDITABLE);
    if (!batch.productTitle.trim()) {
      return res.status(422).json({ error: 'invalid', message: 'A batch needs a product.' });
    }
    if (batch.plannedQty > 0) batch.yieldPct = Number(((batch.producedQty / batch.plannedQty) * 100).toFixed(1));
    db.productionBatches.unshift(batch);
    res.status(201).json({ batch });
  });

  r.patch('/erp/production/:id', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const found = db.productionBatches.find((x) => x.id === req.params.id);
    const b = ownerOf(req, res, found, found?.sellerId, sid, 'Batch');
    if (!b) return;
    const written = assignFields(b, req.body, BATCH_EDITABLE);
    if (b.plannedQty > 0) b.yieldPct = Number(((b.producedQty / b.plannedQty) * 100).toFixed(1));
    res.json({ batch: b, fields: written });
  });

  r.get('/erp/overview', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const sup = db.suppliers.filter((s) => s.sellerId === sid);
    const po = db.procurementOrders.filter((p) => p.sellerId === sid);
    const exp = db.expenses.filter((e) => e.sellerId === sid);
    const emp = db.employees.filter((e) => e.sellerId === sid);
    const bat = db.productionBatches.filter((b) => b.sellerId === sid);
    const sales = sum(db.orders.flatMap((o) => o.lines.filter((l) => l.sellerId === sid).map((l) => l.lineTotal)));
    const cogs = sum(db.reorderSuggestions.filter((s) => db.offers.some((o) => o.sellerId === sid && o.productId === s.productId)).map((s) => s.unitCost));
    const opex = sum(exp.map((e) => e.amount));
    res.json({
      sales,
      cogs,
      grossProfit: sales - cogs,
      grossMargin: sales ? Number((((sales - cogs) / sales) * 100).toFixed(1)) : 0,
      opex,
      payroll: sum(emp.map((e) => e.monthlyPayroll)),
      netBeforeTax: sales - cogs - opex,
      procurement: { suppliers: sup.length, openOrders: po.filter((p) => !['received', 'cancelled'].includes(p.status)).length, committed: sum(po.filter((p) => !['received', 'cancelled'].includes(p.status)).map((p) => p.total)) },
      production: { active: bat.filter((b) => !['completed', 'scrapped'].includes(b.status)).length, wipValue: sum(bat.filter((b) => !['completed', 'scrapped'].includes(b.status)).map((b) => b.unitCost * b.producedQty)) },
      topSuppliers: sup.sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 4),
      recentExpenses: exp.slice(0, 6),
      note: 'This is the Seller ERP context. It owns suppliers, procurement, expenses, employees and batches — and consumes StockAdjusted and PaymentCaptured events rather than duplicating their state.',
    });
  });

  /* ------------------------------- copilot ------------------------------ */
  r.get('/ai/history', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const sellerName = db.orgs.find((o) => o.id === sid)?.name;
    res.json({
      items: db.aiSuggestions.filter((a) => a.surface === 'seller_portal' && (!sellerName || a.actor === sellerName)).slice(0, 25),
    });
  });

  r.post('/ai/copilot', (req, res) => {
    const b = req.body as { task: 'listing' | 'pricing' | 'forecast' | 'translate'; input: string; offerId?: string };
    const sid = sellerId(req, res);
    if (!sid) return;
    const now = new Date().toISOString();
    let output = '';
    let guard: { decision: 'allowed' | 'blocked' | 'flagged'; reason?: string } = { decision: 'allowed' };

    if (b.task === 'listing') {
      const hasPhone = /\+?251|9\d{8}/.test(b.input);
      const hasCompetitor = /\bvs\b|samsung|jbl|apple|sony|tecno/i.test(b.input) && /better|cheaper|compare/i.test(b.input);
      if (hasPhone || hasCompetitor) {
        guard = { decision: 'blocked', reason: hasPhone ? 'Output contained an off-platform contact number.' : 'Output contained a competitor comparison, which listing policy prohibits.' };
        output = 'Blocked. Nothing was published and no draft was saved.';
      } else {
        output = `${b.input.split('\n')[0] || 'New product'}\n\n${b.input}\n\nSold and shipped from ${db.orgs.find((o) => o.id === sid)?.city}.`;
      }
    } else if (b.task === 'pricing') {
      // Pricing guidance only ever analyses the seller's own offer. Accepting any
      // `offerId` handed a competitor's category pricing to whoever asked.
      const requested = b.offerId ? db.offers.find((o) => o.id === b.offerId) : undefined;
      const offer = b.offerId
        ? ownerOf(req, res, requested, requested?.sellerId, sid, 'Listing')
        : db.offers.find((o) => o.sellerId === sid);
      if (!offer) return;
      const p = db.products.find((x) => x.id === offer.productId)!;
      const all = db.offers.filter((o) => o.productId === offer.productId && o.status === 'live');
      const cheapest = all.slice().sort((a, b2) => a.price - b2.price)[0];
      const median = all.map((o) => o.price).sort((a, b2) => a - b2)[Math.floor(all.length / 2)];
      const suggested = cheapest.id === offer.id ? Math.round(offer.price * 1.04) : Math.max(cheapest.price + 100, Math.round(median * 0.98));
      output = `${p.title}\n\nCategory median is ETB ${(median / 100).toLocaleString('en-ET')}. You are at ETB ${(offer.price / 100).toLocaleString('en-ET')}${cheapest.id === offer.id ? ' — already the cheapest' : `, ETB ${((offer.price - cheapest.price) / 100).toLocaleString('en-ET')} above the cheapest offer`}.\n\nSuggested price: ETB ${(suggested / 100).toLocaleString('en-ET')}. At your current velocity that is about ETB ${Math.round((suggested - offer.price) * 12 * 0.78 / 100).toLocaleString('en-ET')} more margin per month. I would not go below ETB ${(cheapest.price / 100).toLocaleString('en-ET')} — below that you are racing to the bottom on a product you are winning on reliability anyway.`;
    } else if (b.task === 'forecast') {
      const s = db.reorderSuggestions[0];
      output = `Suggested reorder for ${s?.title ?? 'your top seller'}: ${s?.suggestedQty ?? 0} units.\n\nReasoning:\n${(s?.reasoning ?? []).map((x) => `• ${x}`).join('\n')}\n\nConfidence ${Math.round((s?.confidence ?? 0) * 100)}% using ${s?.forecastMethod}. This is a suggestion — no order will be placed without your approval.`;
    } else {
      output = `[am] ${b.input}`;
    }

    const suggestion = {
      id: id('ai'),
      capability: b.task === 'listing' ? ('listing_generation' as const) : b.task === 'pricing' ? ('pricing_guidance' as const) : b.task === 'forecast' ? ('demand_forecast' as const) : ('translation_am_en' as const),
      at: now,
      model: 'hm-router → ethiopia-tuned-llm-v3',
      inputSummary: b.input.slice(0, 120),
      output,
      tokensIn: 500 + b.input.length,
      tokensOut: 200 + output.length,
      costMinor: 16,
      latencyMs: 780 + (b.input.length % 900),
      guardrail: {
        decision: guard.decision,
        checks: [
          { id: 'g1', name: 'No PII in output', result: guard.reason?.includes('contact') ? 'fail' as const : 'pass' as const },
          { id: 'g2', name: 'No fabricated price or stock claim', result: 'pass' as const },
          { id: 'g3', name: 'Amharic language safety', result: 'pass' as const },
          { id: 'g4', name: 'Prohibited claims filter', result: guard.reason?.includes('competitor') ? 'fail' as const : 'pass' as const },
          { id: 'g5', name: 'Catalog grounding check', result: b.task === 'pricing' ? ('pass' as const) : ('warn' as const) },
        ],
        reason: guard.reason,
      },
      applied: guard.decision === 'allowed',
      surface: 'seller_portal' as const,
      actor: db.orgs.find((o) => o.id === sid)?.name ?? 'Seller',
    };
    db.aiSuggestions.unshift(suggestion);
    res.json({ suggestion, output, guardrail: suggestion.guardrail });
  });

  r.get('/buybox', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const mine = db.offers.filter((o) => o.sellerId === sid);
    res.json({
      items: mine.map((o) => {
        const p = db.products.find((x) => x.id === o.productId)!;
        const all = db.offers.filter((x) => x.productId === o.productId && x.status === 'live');
        const sel = selectBuyBox(all, db, p);
        return {
          offerId: o.id,
          title: p.title,
          image: p.images[0],
          price: o.price,
          isBuyBox: sel.offer?.id === o.id,
          reason: sel.reason,
          competitors: all.filter((x) => x.id !== o.id).map((x) => ({ id: x.id, price: x.price, seller: db.orgs.find((s) => s.id === x.sellerId)?.name, fulfillment: x.fulfillment, etaDays: x.etaDays, stock: x.stock })),
        };
      }),
      explainer: 'The Buy Box is chosen on a weighted score, not raw price. Price is the largest single factor at 34%, but fulfilment method, delivery reliability, speed, stock, trust score and recent performance decide the rest. That is deliberate — the cheapest offer is not always the one that arrives.',
      weights: [
        { name: 'Price vs category median', weight: 34 },
        { name: 'Fulfilment method', weight: 16 },
        { name: 'Delivery reliability', weight: 16 },
        { name: 'Seller trust score', weight: 10 },
        { name: 'Delivery speed', weight: 10 },
        { name: 'Stock availability', weight: 8 },
        { name: 'Recent performance', weight: 4 },
        { name: 'Offer rating', weight: 2 },
      ],
    });
  });

  r.get('/promoted', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const org = db.orgs.find((o) => o.id === sid)!;
    res.json({
      eligible: org.trustScore >= 70,
      reason: org.trustScore >= 70 ? undefined : 'Promoted listings need a trust score of 70 or above. Yours is ' + org.trustScore + '.',
      active: db.offers.filter((o) => o.sellerId === sid && o.promoted).map((o) => ({ offerId: o.id, title: db.products.find((p) => p.id === o.productId)?.title, clicks: 1240, orders: 38, spend: sum([]) , cpc: 180, ctr: 4.1 })),
      packages: [
        { id: 'starter', label: 'Starter', daily: 30000, cpc: 220, minRating: 4.0, note: 'Up to 3 promoted offers' },
        { id: 'growth', label: 'Growth', daily: 90000, cpc: 180, minRating: 4.2, note: 'Up to 15 promoted offers, category placement' },
        { id: 'category', label: 'Category leader', daily: 240000, cpc: 150, minRating: 4.4, note: 'Category landing page placement, homepage rotation' },
      ],
      note: 'Sponsored placement is a separate paid layer above the organic score. It never displaces the Buy Box — the Buy Box is decided on relevance and reliability only.',
    });
  });

  r.post('/promoted', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const actor = actorFor(db, req, 'seller');
    const b = req.body as { offerId: string; daily: number; cpc: number };
    const found = db.offers.find((x) => x.id === b.offerId);
    const o = ownerOf(req, res, found, found?.sellerId, sid, 'Listing');
    if (!o) return;
    const org = db.orgs.find((x) => x.id === sid)!;
    if (org.trustScore < 70) {
      return res.status(422).json({
        error: 'not_eligible',
        message: `Promoted listings need a trust score of 70 or above. Yours is ${org.trustScore}.`,
      });
    }
    o.promoted = true;
    logActivity(db, actor.name, 'listing.promoted', 'offer', o.id, `ETB ${(b.daily / 100).toFixed(2)}/day at ETB ${(b.cpc / 100).toFixed(2)} CPC`);
    res.json({ ok: true, offer: o, budget: b.daily, cpc: b.cpc });
  });

  r.get('/payouts/:id', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const found = db.settlements.find((x) => x.id === req.params.id);
    const s = ownerOf(req, res, found, found?.sellerId, sid, 'Settlement');
    if (!s) return;
    const orders = db.orders.filter((o) => o.lines.some((l) => l.sellerId === s.sellerId));
    res.json({
      settlement: s,
      orders: orders.slice(0, 12).map((o) => ({ code: o.code, at: o.placedAt, gross: sum(o.lines.filter((l) => l.sellerId === s.sellerId).map((l) => l.lineTotal)), commission: rate(sum(o.lines.filter((l) => l.sellerId === s.sellerId).map((l) => l.lineTotal)), fees.commissionRate), net: sum(o.lines.filter((l) => l.sellerId === s.sellerId).map((l) => l.lineTotal)) - rate(sum(o.lines.filter((l) => l.sellerId === s.sellerId).map((l) => l.lineTotal)), fees.commissionRate) })),
      journal: db.ledger.filter((e) => e.refId === s.id || e.id === s.journalEntryId),
    });
  });

  /**
   * A seller can ask finance to release an accruing settlement early. This is a
   * request, not an approval: money only moves after admin approves and pays,
   * and only into a payout account finance has verified ownership of.
   */
  r.post('/payouts/:id/request', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const actor = actorFor(db, req, 'seller');
    const s = db.settlements.find((x) => x.id === req.params.id && x.sellerId === sid);
    if (!s) return notFound(res, 'Settlement');

    if (s.status === 'paid') {
      return res.status(409).json({ error: 'already_paid', message: `${s.code} has already been paid out.` });
    }
    if (s.status === 'blocked' || s.status === 'on_hold' || s.holdFlag) {
      return res.status(422).json({
        error: 'settlement_blocked',
        message: s.blockedReason ?? `${s.code} is on hold. Finance has to clear it before a payout can be requested.`,
      });
    }
    if (s.payoutRequestedAt) {
      return res.status(409).json({
        error: 'already_requested',
        message: `You already requested ${s.code}. Finance reviews requests in order.`,
      });
    }
    const account = db.payoutAccounts.find((p) => p.sellerId === sid && p.verified);
    if (!account) {
      return res.status(422).json({
        error: 'no_verified_account',
        message: 'Add a payout account and have finance verify it before requesting a payout. Nothing is released to an unverified account.',
      });
    }

    s.payoutRequestedAt = new Date().toISOString();
    logActivity(db, actor.name, 'settlement.requested', 'settlement', s.id, `${s.code} · ETB ${(s.netPayable / 100).toLocaleString('en-ET')} to ${account.bank}`);
    audit(db, actor.name, 'settlement.request', `settlement:${s.id}`, { netPayable: s.netPayable, account: account.bank });
    res.json({
      settlement: s,
      message: `${s.code} requested. Finance reviews it and the amount lands in your verified ${account.bank} account.`,
    });
  });

  r.post('/payout-accounts', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const actor = actorFor(db, req, 'seller');
    const b = req.body as { bank?: string; accountName?: string; accountNumber?: string };
    const bank = (b.bank ?? '').trim();
    const accountName = (b.accountName ?? '').trim();
    const accountNumber = (b.accountNumber ?? '').replace(/\s+/g, '');
    if (!bank || !accountName || accountNumber.length < 4) {
      return res.status(422).json({ error: 'invalid', message: 'Bank, account name and a valid account number are all required.' });
    }
    const mine = db.payoutAccounts.filter((p) => p.sellerId === sid);
    if (mine.some((p) => p.accountNumber === accountNumber)) {
      return res.status(409).json({ error: 'duplicate', message: 'That account number is already on file for your organisation.' });
    }

    const account: PayoutAccount = {
      id: id('pa'),
      sellerId: sid,
      bank,
      accountName,
      accountNumber,
      verified: false,
      isDefault: mine.length === 0,
    };
    db.payoutAccounts.push(account);
    logActivity(db, actor.name, 'payout_account.added', 'payout_account', account.id, `${bank} · ${accountName} · pending verification`);
    audit(db, actor.name, 'payout_account.create', `payout_account:${account.id}`, { bank, accountName, last4: accountNumber.slice(-4) });
    res.json({
      account,
      message: 'Account added. Finance verifies account ownership before the first payout can be released to it.',
    });
  });

  r.get('/earnings', (req, res) => {
    const sid = sellerId(req, res);
    if (!sid) return;
    const myLines = db.orders.flatMap((o) => o.lines.filter((l) => l.sellerId === sid).map((l) => ({ o, l })));
    const byDay = new Map<string, { revenue: number; commission: number; net: number; orders: number }>();
    for (const { o, l } of myLines) {
      const day = o.placedAt.slice(0, 10);
      const cur = byDay.get(day) ?? { revenue: 0, commission: 0, net: 0, orders: 0 };
      cur.revenue += l.lineTotal;
      cur.commission += rate(l.lineTotal, fees.commissionRate);
      cur.net += l.lineTotal - rate(l.lineTotal, fees.commissionRate);
      cur.orders += 1;
      byDay.set(day, cur);
    }
    const rows = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 30);
    res.json({
      rows: rows.map(([date, v]) => ({ date, ...v })),
      totals: {
        revenue: sum(rows.map(([, v]) => v.revenue)),
        commission: sum(rows.map(([, v]) => v.commission)),
        net: sum(rows.map(([, v]) => v.net)),
      },
      byProduct: [...myLines.reduce((a, { l }) => a.set(l.title, (a.get(l.title) ?? 0) + l.lineTotal), new Map<string, number>())].map(([title, revenue]) => ({ title, revenue, commission: rate(revenue, fees.commissionRate) })).sort((a, b) => b.revenue - a.revenue).slice(0, 10),
      note: 'Commission on transactions is the primary revenue mechanism, deliberately aligned with your success. Subscription is never the primary model.',
    });
  });

  return r;
}
