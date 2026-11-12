import type { Db } from '../store.ts';
import { ledgerBalances } from '../lib/money.ts';
import { addresses, categories, users } from './core.ts';
import { credentials } from './auth.ts';
import { orgs } from './orgs.ts';
import { buildProducts } from './products.ts';
import { buildOffers, buildReviews, promotions } from './offers.ts';
import { buildCommerce } from './commerce.ts';
import { buildTrade } from './trade.ts';
import { buildRoutes } from './delivery.ts';
import { buildLedger, buildReconciliations, payoutAccounts } from './finance.ts';
import { buildAiSuggestions, buildDisputes, buildNotifications, buildReorder, buildRiskEvaluations, riskRules, verificationCases } from './trust.ts';
import { buildB2BDashboards, buildPlatformMetrics, buildSellerMetrics } from './metrics.ts';
import { buildAgents, buildBuyBoxOverrides, buildCodDeposits, buildDeliveryEvents, buildSyncQueue, featureFlags, settings } from './ops.ts';
import { daysAgo } from '../lib/ids.ts';

export function buildDatabase(): Db {
  const products = buildProducts();
  const offers = buildOffers(products);
  const reviews = buildReviews(products);
  const { orders, payments, shipments } = buildCommerce(products, offers, orgs, addresses);
  const trade = buildTrade();
  const { ledger, settlements, taxReceipts } = buildLedger(orders);
  const agentRoutes = buildRoutes(orders, orgs);
  const agents = buildAgents();
  const riskEvaluations = buildRiskEvaluations(orders);
  const disputes = buildDisputes(orders);

  // The ledger invariant must hold at boot, not only at runtime.
  if (!ledgerBalances(ledger)) throw new Error('Ledger does not balance at boot — refusing to start.');

  // Every seeded user must be able to sign in, or a demo account is a dead end.
  const missingCredential = users.find((u) => !credentials.some((c) => c.userId === u.id));
  if (missingCredential) throw new Error(`No credential seeded for ${missingCredential.id}.`);

  for (const p of products) {
    const cat = categories.find((c) => c.id === p.categoryId);
    if (cat) cat.productCount += 1;
    const root = cat?.parentId ?? cat?.id;
    const rootCat = categories.find((c) => c.id === root);
    if (rootCat) rootCat.productCount += 1;
  }

  const db: Db = {
    version: 1,
    users,
    credentials,
    addresses,
    categories,
    products,
    offers,
    orgs,
    orders,
    payments,
    shipments,
    reviews,
    promotions,
    couponsUsed: [{ code: 'WELCOME100', userId: 'u_buyer1', at: daysAgo(40) }],
    rfqs: trade.rfqs,
    quotations: trade.quotations,
    purchaseOrders: trade.pos,
    invoices: trade.invoices,
    creditAssessments: trade.creditAssessments,
    suppliers: trade.suppliers,
    procurementOrders: trade.procurementOrders,
    expenses: trade.expenses,
    employees: trade.employees,
    productionBatches: trade.batches,
    agentRoutes,
    agents,
    deliveryEvents: buildDeliveryEvents(agentRoutes),
    codDeposits: buildCodDeposits(agentRoutes, agents),
    syncQueue: buildSyncQueue(agentRoutes),
    ledger,
    settlements,
    reconciliations: buildReconciliations(),
    payoutAccounts,
    taxReceipts,
    riskRules,
    riskEvaluations,
    disputes,
    verificationCases,
    aiSuggestions: buildAiSuggestions(),
    reorderSuggestions: buildReorder(products.map((p) => ({ id: p.id, title: p.title }))),
    notifications: buildNotifications(),
    settings,
    featureFlags,
    buyBoxOverrides: buildBuyBoxOverrides(offers),
    sellerMetrics: buildSellerMetrics('org_selam', offers, orders, products),
    platformMetrics: buildPlatformMetrics(orders),
    b2bDashboards: buildB2BDashboards(trade),
    // Seeded per account so the demo buyer opens with a basket and favourites.
    carts: [
      {
        userId: 'u_buyer1',
        lines: [
          { offerId: offers[3]?.id ?? 'of_0004', qty: 1 },
          { offerId: offers[11]?.id ?? 'of_0012', qty: 2 },
        ],
      },
      { userId: null, lines: [] },
    ],
    favoritesByUser: [
      { userId: 'u_buyer1', productIds: [products[2]?.id, products[12]?.id].filter(Boolean) as string[] },
      { userId: null, productIds: [] },
    ],
    activity: [],
    searchLog: [
      { q: 'jbl', at: daysAgo(0.02), results: 1 },
      { q: 'yirgacheffe', at: daysAgo(0.1), results: 1 },
      { q: 'ቡና', at: daysAgo(0.3), results: 3 },
      { q: 'diapers bulk', at: daysAgo(1), results: 1 },
      { q: 'laptop i7', at: daysAgo(1.4), results: 2 },
    ],
    auditLog: [],
  };
  return db;
}

export function metricsForSeller(sellerId: string, db: Db) {
  return buildSellerMetrics(sellerId, db.offers, db.orders, db.products);
}
