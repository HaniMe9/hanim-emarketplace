import type {
  B2BDashboard,
  CreditAssessment,
  Invoice,
  Offer,
  Order,
  PlatformMetrics,
  Product,
  PurchaseOrder,
  Quotation,
  Rfq,
  SellerMetrics,
} from '../../shared/types.ts';
import { daysAgo } from '../lib/ids.ts';

const series = (days: number, base: number, growth: number, vol: number) =>
  Array.from({ length: days }, (_, i) => {
    const trend = base * (1 + (growth * i) / days);
    return Math.round(trend * (1 + (Math.sin(i * 1.7) * vol) / 100));
  });

export function buildSellerMetrics(sellerId: string, offers: Offer[], orders: Order[], products: Product[]): SellerMetrics {
  const mine = offers.filter((o) => o.sellerId === sellerId);
  const myLines = orders.flatMap((o) => o.lines.filter((l) => l.sellerId === sellerId).map((l) => ({ o, l })));
  const active = myLines.filter(({ o }) => o.status !== 'cancelled');
  const gmv = active.reduce((a, { l }) => a + l.lineTotal, 0);
  const unitsByProduct = new Map<string, number>();
  active.forEach(({ l }) => unitsByProduct.set(l.productId, (unitsByProduct.get(l.productId) ?? 0) + l.qty));
  const cancelled = myLines.filter(({ o }) => o.status === 'cancelled').length;
  const disputed = myLines.filter(({ o }) => o.status === 'disputed').length;
  const revenue = series(30, Math.max(240000, gmv / 30), 26, 22);
  const visitors = series(30, Math.max(180, Math.round(revenue[0] / 900)), 34, 16);
  const orderCounts = revenue.map((r, i) => Math.max(1, Math.round(r / Math.max(1, gmv / Math.max(1, active.length) || 200000)) + (i % 5)));
  const lowStock = mine
    .filter((o) => o.stock <= (o.tierPrices ? 40 : 25))
    .slice(0, 6)
    .map((o) => ({ offerId: o.id, title: products.find((p) => p.id === o.productId)?.title ?? 'Product', stock: o.stock, reorderLevel: o.tierPrices ? 40 : 25, image: products.find((p) => p.id === o.productId)?.images[0] ?? '' }));

  return {
    gmv30d: gmv,
    gmvDeltaPct: 12.4,
    orders30d: active.length,
    ordersDeltaPct: 8.1,
    conversionRate: 2.9,
    conversionDeltaPct: 0.4,
    views30d: visitors.reduce((a, b) => a + b, 0),
    avgOrderValue: active.length ? Math.round(gmv / active.length) : 0,
    cancelRate: myLines.length ? Number(((cancelled / myLines.length) * 100).toFixed(1)) : 0,
    lateShipRate: 3.2,
    activeListings: mine.filter((o) => o.status === 'live').length,
    pendingModeration: mine.filter((o) => o.status === 'pending_review').length,
    lowStockCount: mine.filter((o) => o.stock <= (o.tierPrices ? 40 : 25)).length,
    unpaidBalance: active.filter(({ o }) => o.status === 'delivered').reduce((a, { l }) => a + l.lineTotal, 0),
    nextSettlementAt: daysAgo(-3),
    topProducts: [...unitsByProduct.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([pid, units]) => {
        const p = products.find((x) => x.id === pid);
        const offer = mine.find((o) => o.productId === pid);
        return { id: pid, title: p?.title ?? 'Product', units, revenue: units * (offer?.price ?? 0), image: p?.images[0] ?? '' };
      }),
    series: revenue.map((v, i) => ({ date: `D-${29 - i}`, revenue: v, orders: orderCounts[i], visitors: visitors[i] })),
    funnel: [
      { stage: 'Impressions', value: visitors.reduce((a, b) => a + b, 0), rate: 100 },
      { stage: 'Product views', value: Math.round(visitors.reduce((a, b) => a + b, 0) * 0.34), rate: 34 },
      { stage: 'Add to cart', value: Math.round(visitors.reduce((a, b) => a + b, 0) * 0.061), rate: 6.1 },
      { stage: 'Checkout started', value: Math.round(visitors.reduce((a, b) => a + b, 0) * 0.038), rate: 3.8 },
      { stage: 'Orders paid', value: active.length, rate: 2.9 },
    ],
    lowStock,
    actionQueue: [
      ...(lowStock.length ? [{ id: 'stock', type: 'inventory', label: `${lowStock.length} offers below reorder level`, detail: 'Suggested reorder quantities include the reasoning behind each number', severity: 'medium' as const, dueAt: daysAgo(-2) }] : []),
      { id: 'pack', type: 'fulfilment', label: `${active.filter(({ o }) => o.status === 'confirmed').length} orders waiting to be packed`, detail: 'Confirmed orders not yet marked packed', severity: 'high' as const, dueAt: daysAgo(0) },
      { id: 'ship', type: 'fulfilment', label: '3 parcels past the 24-hour dispatch SLA', detail: 'Dispatch late rate is 3.2% this month', severity: 'medium' as const, dueAt: daysAgo(0) },
      { id: 'reply', type: 'messaging', label: '4 buyer questions unanswered', detail: 'Average response time is 1.4 hours against a 4-hour target', severity: 'low' as const, dueAt: daysAgo(-1) },
      { id: 'review', type: 'trust', label: '2 reviews pending moderation', detail: 'Reviews only go live after the moderation queue clears', severity: 'low' as const, dueAt: daysAgo(-3) },
      ...(disputed ? [{ id: 'dispute', type: 'trust' as const, label: `${disputed} disputed order${disputed === 1 ? '' : 's'} need a response`, detail: 'The 72-hour dispute SLA is running. Payout stays blocked until the case closes.', severity: 'high' as const, dueAt: daysAgo(0) }] : []),
    ],
  };
}

export function buildPlatformMetrics(orders: Order[]): PlatformMetrics {
  const paid = orders.filter((o) => o.status !== 'pending_payment' && o.status !== 'cancelled');
  const gmv = paid.reduce((a, o) => a + o.subtotal, 0);
  const gmvSeries = series(30, Math.max(1800000, gmv / 30), 31, 18);
  return {
    gmv30d: gmv,
    orders30d: paid.length,
    activeSellers: 42,
    activeBuyers: 12840,
    deliveredOrders30d: orders.filter((o) => o.status === 'delivered').length,
    avgDeliveryDays: 2.4,
    codRatio: Number(((paid.filter((o) => o.paymentMethod === 'cod').length / Math.max(1, paid.length)) * 100).toFixed(1)),
    disputeRate: Number(((orders.filter((o) => o.status === 'disputed').length / Math.max(1, paid.length)) * 100).toFixed(2)),
    commissionRevenue30d: Math.round(gmv * 0.05),
    escrowBalance: Math.round(gmv * 0.38),
    openDisputes: 7,
    pendingVerifications: 3,
    series: gmvSeries.map((v, i) => ({
      date: `D-${29 - i}`,
      gmv: v,
      orders: Math.max(1, Math.round(v / 90000) + (i % 4)),
      sellers: 38 + Math.floor(i / 3),
      buyers: 11200 + i * 58,
    })),
    categoryMix: [
      { name: 'Electronics', gmv: Math.round(gmv * 0.38), share: 38 },
      { name: 'Home & Living', gmv: Math.round(gmv * 0.19), share: 19 },
      { name: 'Grocery & Food', gmv: Math.round(gmv * 0.15), share: 15 },
      { name: 'Business & Industrial', gmv: Math.round(gmv * 0.12), share: 12 },
      { name: 'Fashion', gmv: Math.round(gmv * 0.08), share: 8 },
      { name: 'Health & Beauty', gmv: Math.round(gmv * 0.05), share: 5 },
      { name: 'Baby & Kids', gmv: Math.round(gmv * 0.02), share: 2 },
      { name: 'Automotive', gmv: Math.round(gmv * 0.01), share: 1 },
    ],
    cities: [
      { name: 'Addis Ababa', orders: Math.round(paid.length * 0.62) },
      { name: 'Adama', orders: Math.round(paid.length * 0.11) },
      { name: 'Mekelle', orders: Math.round(paid.length * 0.08) },
      { name: 'Hawassa', orders: Math.round(paid.length * 0.07) },
      { name: 'Bahir Dar', orders: Math.round(paid.length * 0.05) },
      { name: 'Dire Dawa', orders: Math.round(paid.length * 0.04) },
      { name: 'Other', orders: Math.round(paid.length * 0.03) },
    ],
  };
}

export function buildB2BDashboards(trade: {
  rfqs: Rfq[];
  quotations: Quotation[];
  pos: PurchaseOrder[];
  invoices: Invoice[];
  creditAssessments: CreditAssessment[];
}): B2BDashboard[] {
  // One dashboard per organisation that actually issues RFQs, so a new buyer org
  // in the seed shows up without anyone editing this file.
  const orgs = [...new Set(trade.rfqs.map((r) => r.buyerOrgId))];
  return orgs.map((orgId) => {
    const rfqs = trade.rfqs.filter((r) => r.buyerOrgId === orgId);
    const rfqIds = new Set(rfqs.map((r) => r.id));
    const quotations = trade.quotations.filter((q) => rfqIds.has(q.rfqId));
    const pos = trade.pos.filter((p) => p.buyerOrgId === orgId);
    const openPos = pos.filter((p) => p.status !== 'cancelled');
    const invoices = trade.invoices.filter((i) => i.buyerOrgId === orgId);
    const assessment = trade.creditAssessments.find((c) => c.orgId === orgId);

    // Supplier concentration from actual purchase orders, not a hand-written list.
    const supplierSpend = new Map<string, { spend: number; orders: number }>();
    for (const p of pos) {
      const row = supplierSpend.get(p.sellerId) ?? { spend: 0, orders: 0 };
      row.spend += p.total;
      row.orders += 1;
      supplierSpend.set(p.sellerId, row);
    }

    return {
      openRfqs: rfqs.filter((r) => r.status === 'open').length,
      quotesReceived: quotations.length,
      negotiationPending: quotations.filter((q) => q.status === 'revising').length,
      activePos: openPos.length,
      committedSpend: openPos.reduce((a, p) => a + p.total, 0),
      creditLimit: assessment?.limit ?? 0,
      creditUsed: assessment?.used ?? 0,
      creditAvailable: assessment?.available ?? 0,
      savingsVsRetail: Number((pos.reduce((a, p) => a + p.total, 0) * 0.118).toFixed(1)),
      recent: rfqs.slice(0, 5),
      dueInvoices: invoices.filter((i) => i.status === 'issued' || i.status === 'partially_paid' || i.status === 'overdue').slice(0, 5),
      topSuppliers: [...supplierSpend.entries()]
        .sort((a, b) => b[1].spend - a[1].spend)
        .slice(0, 5)
        .map(([id, row]) => ({
          id,
          name: id.replace('org_', '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          spend: row.spend,
          onTimePct: 82 + ((id.length * 7) % 15),
          orders: row.orders,
        })),
    };
  });
}
