import { Router } from 'express';
import type { Request } from 'express';
import type { Db } from '../store.ts';
import type { SessionStore } from '../lib/auth.ts';
import { adminDirectoryRoutes } from './adminDirectory.ts';
import { audit, daysAgo, id, logActivity, minutesAgo, notFound, qInt, qStr } from './helpers.ts';
import { entry, ledgerBalances, postJournal, rate, sum } from '../lib/money.ts';
import { fees } from '../data/finance.ts';
import { selectBuyBox } from '../services/catalog.ts';
import type { AccountCode, Dispute, Minor, NotificationItem, Role, VerificationCase } from '../../shared/types.ts';

const ACCOUNT_LABELS: Record<AccountCode, string> = {
  cash_psp: 'Provider account (Telebirr, CBE Birr, Awash)',
  cash_cod_in_transit: 'Cash held by delivery agents',
  receivable_buyer: 'Receivable from buyers',
  receivable_b2b: 'Receivable from business buyers',
  escrow_seller_payable: 'Escrow — seller balances',
  seller_payable: 'Settled seller payables',
  revenue_commission: 'Commission revenue',
  revenue_delivery: 'Delivery fee revenue',
  tax_payable_vat: 'VAT payable to the authority',
  tax_payable_withholding: 'Withholding tax payable',
  refund_payable: 'Refunds owed to buyers',
  discount_expense: 'Promotion subsidy expense',
  expense_psp: 'Payment processing expense',
  platform_cash: 'Platform operating cash',
  suspense: 'Suspense — unreconciled',
};

/**
 * Platform operations console. Three things it will not do: approve a listing
 * without recording who approved it, move money without a balanced journal, or
 * release a payout while a reconciliation says the cash is short.
 */
export function adminRoutes(db: Db, sessions?: SessionStore): Router {
  const r = Router();

  // Directory management (users, sellers, categories) lives in its own module
  // but inherits this router's admin gate, since it is mounted here rather than
  // separately in the app.
  r.use(adminDirectoryRoutes(db, sessions));

  /** The acting admin. Attribute is theirs; they cannot spoof it. */
  const who = (req: Request) => req.user?.name ?? 'Admin';

  const allStops = () => db.agentRoutes.flatMap((x) => x.stops);

  /* ----------------------------- platform ------------------------------- */

  r.get('/platform', (_req, res) => {
    const m = db.platformMetrics;
    const window = (o: { placedAt: string }) => +new Date(o.placedAt) > Date.now() - 30 * 86400000;
    const recent = db.orders.filter(window);
    const gmv30 = sum(recent.map((o) => o.subtotal));
    const commission30 = sum(recent.map((o) => rate(o.subtotal, fees.commissionRate)));
    const stops = allStops();
    const delivered = db.orders.filter((o) => o.status === 'delivered').length;
    const failedStops = stops.filter((s) => s.status === 'failed').length;
    const subs = db.orgs.filter((o) => o.type === 'seller').reduce((a, o) => a + o.sales30d, 0);
    const shortDeposits = db.codDeposits.filter((d) => d.status === 'short' || d.status === 'late');
    const outstandingCod = sum(stops.filter((s) => s.status === 'delivered').map((s) => s.codAmount));

    res.json({
      metrics: m,
      gmv: {
        gmv30d: gmv30,
        netRevenue30d: commission30,
        takeRate: gmv30 ? Number(((commission30 / gmv30) * 100).toFixed(2)) : 0,
        aov: recent.length ? Math.round(gmv30 / recent.length) : 0,
        sellerSales30d: subs,
        note: 'Transaction commission is the primary revenue engine. Subscriptions are a secondary layer, never the primary model.',
      },
      health: {
        deliverySuccess: stops.length ? Number(((stops.filter((s) => s.status === 'delivered').length / stops.length) * 100).toFixed(1)) : 100,
        disputeRate: db.orders.length ? Number(((db.disputes.length / db.orders.length) * 100).toFixed(2)) : 0,
        disputeOpen: db.disputes.filter((d) => !['closed', 'resolved_buyer', 'resolved_seller'].includes(d.status)).length,
        verificationBacklog: db.verificationCases.filter((v) => ['queued', 'in_review', 'needs_info'].includes(v.status)).length,
        listingsPending: db.offers.filter((o) => o.status === 'pending_review').length,
        ledgerBalanced: ledgerBalances(db.ledger),
        codOutstanding: outstandingCod,
        codDepositsShort: shortDeposits.length,
        codShortAmount: sum(shortDeposits.map((d) => Math.max(0, d.variance))),
        cashReconciliationGap: db.reconciliations.filter((x) => x.status !== 'clean').length,
        pspSuccess: db.payments.length ? Number(((db.payments.filter((p) => p.state === 'captured' || p.state === 'released').length / db.payments.length) * 100).toFixed(1)) : 100,
        agentsOffline: db.agents.filter((a) => {
          const route = db.agentRoutes.find((x) => x.agentId === a.userId && x.status !== 'completed');
          return route && !route.online;
        }).length,
        syncQueuePending: db.syncQueue.filter((q) => q.status !== 'synced').length,
      },
      breakdown: {
        orders: db.orders.length,
        sellers: db.orgs.filter((o) => o.type === 'seller').length,
        buyers: db.orgs.filter((o) => o.type === 'buyer_org').length,
        products: db.products.length,
        offers: db.offers.length,
        users: db.users.length,
        agents: db.agents.length,
        disputes: db.disputes.length,
        rfqs: db.rfqs.length,
        purchaseOrders: db.purchaseOrders.length,
        suppliers: db.suppliers.length,
        employees: db.employees.length,
        ledgerEntries: db.ledger.length,
        aiSuggestions: db.aiSuggestions.length,
        delivered,
        failedStops,
        stops: stops.length,
      },
      ledger: {
        entries: db.ledger.length,
        balanced: ledgerBalances(db.ledger),
        trialBalance: trialBalance(db),
        lastEntry: db.ledger[0] ?? null,
      },
      activity: db.activity.slice(0, 14),
      incidents: [
        { id: 'in_1', severity: 'info', title: 'PSP latency above threshold in Hawassa', at: minutesAgo(38), status: 'monitoring', note: 'Fallback provider engaged automatically. No failed captures.' },
        { id: 'in_2', severity: 'warn', title: 'COD remittance short at Kirkos', at: daysAgo(1), status: 'open', note: 'ETB 1,240 outstanding against one agent. The affected seller payout is blocked, not delayed quietly.' },
        { id: 'in_3', severity: 'info', title: 'Search p95 latency improved to 210ms', at: daysAgo(2), status: 'resolved', note: 'Amharic tokenizer cache warmed.' },
      ],
    });
  });

  r.get('/activity', (req, res) => {
    res.json({ items: db.activity.slice(0, qInt(req.query.limit, 30)) });
  });

  r.get('/audit', (req, res) => {
    res.json({ items: db.auditLog.slice(0, qInt(req.query.limit, 50)) });
  });

  /* ---------------------------- moderation ------------------------------ */

  r.get('/moderation', (_req, res) => {
    const queue = [
      ...db.offers.filter((o) => o.status === 'pending_review').map((o) => ({
        type: 'listing' as const,
        id: o.id,
        org: db.orgs.find((s) => s.id === o.sellerId)?.name ?? '',
        title: db.products.find((p) => p.id === o.productId)?.title ?? '',
        at: o.createdAt,
        risk: 'low' as const,
        reason: 'New listing awaiting review before it can go live.',
      })),
      ...db.disputes.filter((d) => !['closed', 'resolved_buyer', 'resolved_seller'].includes(d.status)).map((d) => ({
        type: 'dispute' as const,
        id: d.id,
        org: d.sellerName,
        title: d.summary,
        at: d.createdAt,
        risk: d.amount > 1000000 ? ('high' as const) : ('medium' as const),
        reason: `Buyer opened a dispute. ETB ${(d.amount / 100).toLocaleString('en-ET')} stays in escrow until the case closes.`,
        slaHours: d.slaHours,
        dueAt: d.dueAt,
      })),
      ...db.verificationCases.filter((v) => ['queued', 'in_review', 'needs_info'].includes(v.status)).map((v) => ({
        type: 'verification' as const,
        id: v.id,
        org: v.orgName,
        title: `${v.submittedTier} verification`,
        at: v.submittedAt,
        risk: v.blocking.length ? ('high' as const) : ('medium' as const),
        reason: v.blocking.length ? v.blocking[0]!.reason : 'Documents pending review.',
        slaHours: v.slaHours,
        dueAt: new Date(+new Date(v.submittedAt) + v.slaHours * 3600000).toISOString(),
      })),
      ...db.reviews.filter((x) => x.status === 'pending').map((x) => ({
        type: 'review' as const,
        id: x.id,
        org: x.authorName,
        title: x.title,
        at: x.createdAt,
        risk: 'low' as const,
        reason: 'Review held from publication until the trust check clears.',
      })),
    ].sort((a, b) => (a.at < b.at ? 1 : -1));
    res.json({
      queue,
      counts: {
        listing: queue.filter((x) => x.type === 'listing').length,
        dispute: queue.filter((x) => x.type === 'dispute').length,
        verification: queue.filter((x) => x.type === 'verification').length,
        review: queue.filter((x) => x.type === 'review').length,
      },
    });
  });

  r.post('/moderation/:type/:id', (req, res) => {
    const actor = who(req);
    const b = req.body as { action?: 'approve' | 'reject' | 'escalate' | 'resolve'; note?: string; outcome?: NonNullable<Dispute['resolution']>['outcome']; amount?: Minor };
    const { type, id: targetId } = req.params;

    if (type === 'listing') {
      const offer = db.offers.find((x) => x.id === targetId);
      if (!offer) return notFound(res, 'Listing');
      if (b.action === 'approve') {
        offer.status = 'live';
        // Buy Box eligibility follows the verified tier, never the reviewer's opinion.
        offer.buyBoxEligible = (db.orgs.find((s) => s.id === offer.sellerId)?.tier ?? 'none') !== 'none';
        logActivity(db, actor, 'listing.approved', 'offer', offer.id, db.products.find((p) => p.id === offer.productId)?.title ?? '');
        audit(db, actor, 'listing.approve', `offer:${offer.id}`, { status: 'live' });
      } else {
        offer.status = 'rejected';
        logActivity(db, actor, 'listing.rejected', 'offer', offer.id, b.note ?? '');
        audit(db, actor, 'listing.reject', `offer:${offer.id}`, { status: 'rejected', note: b.note });
      }
      return res.json({ offer, message: `Listing ${b.action === 'approve' ? 'approved' : 'rejected'}.` });
    }

    if (type === 'verification') {
      const v = db.verificationCases.find((x) => x.id === targetId);
      if (!v) return notFound(res, 'Verification case');
      v.reviewer = actor;
      v.reviewedAt = new Date().toISOString();
      const org = db.orgs.find((o) => o.id === v.orgId);
      if (b.action === 'approve') {
        v.status = 'approved';
        if (org) {
          const order: VerificationCase['currentTier'][] = ['none', 'basic', 'business', 'trusted', 'enterprise'];
          // A tier is never lowered by an approval.
          if (order.indexOf(v.submittedTier) > order.indexOf(org.tier)) org.tier = v.submittedTier;
          org.published = org.tier !== 'none';
        }
        logActivity(db, actor, 'verification.approved', 'verification', v.id, `${v.orgName} → ${v.submittedTier}`);
        audit(db, actor, 'verification.approve', `verification:${v.id}`, { tier: v.submittedTier });
      } else {
        v.status = 'reject' === b.action ? 'rejected' : 'needs_info';
        logActivity(db, actor, `verification.${b.action}`, 'verification', v.id, b.note ?? '');
        audit(db, actor, `verification.${b.action}`, `verification:${v.id}`, { note: b.note });
      }
      return res.json({ verification: v, org: org ?? null });
    }

    if (type === 'dispute') {
      const d = db.disputes.find((x) => x.id === targetId);
      if (!d) return notFound(res, 'Dispute');
      if (b.action === 'escalate') {
        d.status = 'mediation';
        d.structuredThread.push({ id: id('th'), by: 'mediator', at: new Date().toISOString(), reasonCode: d.reason, body: b.note ?? 'Escalated to mediation.', attachments: [] });
        logActivity(db, actor, 'dispute.escalated', 'dispute', d.id, b.note ?? '');
        audit(db, actor, 'dispute.escalate', `dispute:${d.id}`);
      } else {
        const outcome = b.outcome ?? 'refund_partial';
        d.resolution = { outcome, amount: b.amount ?? d.amount, note: b.note ?? '', at: new Date().toISOString() };
        d.status = outcome === 'release_to_seller' ? 'resolved_seller' : 'resolved_buyer';
        const order = db.orders.find((o) => o.id === d.orderId);
        if (order) {
          if (outcome === 'release_to_seller') {
            order.status = 'delivered';
          } else {
            order.status = 'refunded';
            order.refunded = d.resolution.amount;
            order.paymentState = 'refunded';
          }
        }
        logActivity(db, actor, 'dispute.resolved', 'dispute', d.id, `${outcome} · ETB ${((d.resolution.amount ?? 0) / 100).toLocaleString('en-ET')}`);
        audit(db, actor, 'dispute.resolve', `dispute:${d.id}`, { outcome, amount: d.resolution.amount });
      }
      return res.json({ dispute: d, message: d.status === 'mediation' ? 'Escalated. The 72-hour clock is still running.' : 'Resolved and the escrow released accordingly.' });
    }

    if (type === 'review') {
      const rv = db.reviews.find((x) => x.id === targetId);
      if (!rv) return notFound(res, 'Review');
      rv.status = b.action === 'approve' ? 'published' : 'removed';
      rv.moderation = { flagged: b.action !== 'approve', reasons: b.note ? [b.note] : [], reviewedBy: actor, at: new Date().toISOString() };
      audit(db, actor, `review.${b.action}`, `review:${rv.id}`);
      return res.json({ review: rv });
    }

    return res.status(400).json({ error: 'unknown_type', message: `"${type}" is not a moderatable item.` });
  });

  /* ----------------------------- disputes ------------------------------- */

  r.get('/disputes', (req, res) => {
    const status = qStr(req.query.status, '');
    const items = status ? db.disputes.filter((d) => d.status === status) : db.disputes;
    res.json({
      items: items.map((d) => ({
        ...d,
        hoursLeft: Math.round((+new Date(d.dueAt) - Date.now()) / 3600000),
        breached: +new Date(d.dueAt) < Date.now() && !['closed', 'resolved_buyer', 'resolved_seller'].includes(d.status),
        order: db.orders.find((o) => o.id === d.orderId) ?? null,
      })),
      counts: db.disputes.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.status]: (acc[d.status] ?? 0) + 1 }), {}),
    });
  });

  r.post('/disputes/:id/message', (req, res) => {
    const actor = who(req);
    const d = db.disputes.find((x) => x.id === req.params.id);
    if (!d) return notFound(res, 'Dispute');
    const b = req.body as { body?: string };
    d.structuredThread.push({ id: id('th'), by: 'mediator', at: new Date().toISOString(), reasonCode: d.reason, body: b.body ?? '', attachments: [] });
    logActivity(db, actor, 'dispute.mediated', 'dispute', d.id);
    audit(db, actor, 'dispute.message', `dispute:${d.id}`);
    res.json({ dispute: d });
  });

  /* --------------------------- verifications ---------------------------- */

  r.get('/verifications', (req, res) => {
    const status = qStr(req.query.status, '');
    const items = status ? db.verificationCases.filter((v) => v.status === status) : db.verificationCases;
    res.json({
      items: items.map((v) => ({
        ...v,
        org: db.orgs.find((o) => o.id === v.orgId) ?? null,
        hoursLeft: Math.round((+new Date(v.submittedAt) + v.slaHours * 3600000 - Date.now()) / 3600000),
        failedChecks: v.checks.filter((c) => c.status === 'fail'),
        pendingChecks: v.checks.filter((c) => c.status === 'pending'),
      })),
      backlog: db.verificationCases.filter((v) => ['queued', 'in_review', 'needs_info'].includes(v.status)).length,
    });
  });

  /* ------------------------------ finance ------------------------------- */

  r.get('/finance', (req, res) => {
    res.json({
      ledger: {
        entries: db.ledger.slice(0, qInt(req.query.limit, 50)),
        balanced: ledgerBalances(db.ledger),
        trialBalance: trialBalance(db),
      },
      settlements: db.settlements.map((s) => ({
        ...s,
        // A cash shortfall blocks payouts that have not happened yet. It does
        // not retroactively mark money that was already sent as blocked.
        blockedBy: s.status === 'paid' ? null : blockedBy(db, s.sellerId),
        organisation: db.orgs.find((o) => o.id === s.sellerId)?.name ?? s.sellerName,
      })),
      reconciliations: db.reconciliations,
      codDeposits: db.codDeposits,
      taxReceipts: db.taxReceipts.slice(0, 20),
      payoutAccounts: db.payoutAccounts,
      fees: db.settings,
      revenue: {
        commission30d: sum(db.orders.map((o) => rate(o.subtotal, fees.commissionRate))),
        delivery30d: sum(db.orders.map((o) => o.deliveryFee)),
        pspExpense30d: sum(db.payments.map((p) => p.fee)),
        escrowBalance: sum(db.orders.filter((o) => ['delivered', 'out_for_delivery', 'shipped'].includes(o.status)).map((o) => o.total)),
      },
    });
  });

  /**
   * Confirm that the seller actually controls a bank account. This is the only
   * writer of `verified` — sellers can add accounts themselves, but nothing
   * becomes payable until a human has confirmed ownership here.
   */
  r.post('/payout-accounts/:id/verify', (req, res) => {
    const actor = who(req);
    const account = db.payoutAccounts.find((p) => p.id === req.params.id);
    if (!account) return notFound(res, 'Payout account');
    if (account.verified) {
      return res.status(409).json({ error: 'already_verified', message: `${account.bank} is already verified for this seller.` });
    }
    const org = db.orgs.find((o) => o.id === account.sellerId);
    const confirm = (req.body as { confirmed?: boolean }).confirmed === true;
    if (!confirm) {
      return res.status(422).json({
        error: 'confirmation_required',
        message: `Confirm you have checked the account holder name against ${org?.name ?? 'the seller'} on ${account.bank} before verifying.`,
        account,
      });
    }
    account.verified = true;
    // Exactly one default per seller, so a payout has one unambiguous destination.
    for (const p of db.payoutAccounts) {
      if (p.sellerId === account.sellerId && p.id !== account.id) p.isDefault = false;
    }
    account.isDefault = true;
    logActivity(db, actor, 'payout_account.verified', 'payout_account', account.id, `${account.bank} · ${account.accountName}`);
    audit(db, actor, 'payout_account.verify', `payout_account:${account.id}`, { sellerId: account.sellerId, bank: account.bank, last4: account.accountNumber.slice(-4) });
    res.json({ account, message: `${account.bank} verified for ${account.accountName}. Payouts to this seller can now be released.` });
  });

  r.post('/settlements/:id/approve', (req, res) => {
    const actor = who(req);
    const s = db.settlements.find((x) => x.id === req.params.id);
    if (!s) return notFound(res, 'Settlement');
    const blocker = blockedBy(db, s.sellerId);
    if (blocker) {
      return res.status(422).json({
        error: 'payout_blocked',
        message: `This payout is blocked by reconciliation: ${blocker}`,
        blocker,
        message2: 'Resolve the cash variance first. Approving anyway would move the problem downstream.',
      });
    }
    s.status = 'approved';
    s.holdFlag = false;
    logActivity(db, actor, 'settlement.approved', 'settlement', s.id, `ETB ${(s.netPayable / 100).toLocaleString('en-ET')}`);
    audit(db, actor, 'settlement.approve', `settlement:${s.id}`, { netPayable: s.netPayable });
    res.json({ settlement: s, message: `${s.code} approved for ETB ${(s.netPayable / 100).toLocaleString('en-ET')}.` });
  });

  r.post('/settlements/:id/pay', (req, res) => {
    const actor = who(req);
    const s = db.settlements.find((x) => x.id === req.params.id);
    if (!s) return notFound(res, 'Settlement');
    if (s.status !== 'approved' && s.status !== 'ready') {
      return res.status(409).json({ error: 'not_approved', message: `A ${s.status} settlement cannot be paid.` });
    }
    const blocker = blockedBy(db, s.sellerId);
    if (blocker) {
      return res.status(422).json({ error: 'payout_blocked', message: `Blocked by reconciliation: ${blocker}`, blocker });
    }
    // Money only ever leaves through an account finance has confirmed it owns.
    // Sellers can add their own accounts (seller.ts), and those arrive
    // unverified — without this check an unverified destination is a payout
    // redirection that no one ever reviewed.
    const account = db.payoutAccounts.find((p) => p.sellerId === s.sellerId && p.verified);
    if (!account) {
      return res.status(422).json({
        error: 'no_verified_account',
        message: `${s.sellerName} has no payout account with verified ownership. Verify one before releasing funds.`,
        sellerId: s.sellerId,
      });
    }

    s.status = 'paid';
    s.paidAt = new Date().toISOString();
    s.payoutRef = `PO-${80000 + db.settlements.length * 13}`;
    s.payoutMethod = account.bank;

    const je = postJournal({
      journal: 'settlement',
      refType: 'payout',
      refId: s.id,
      refLabel: `${s.code} payout`,
      at: s.paidAt,
      lines: [
        entry('seller_payable', s.netPayable, 0, 'Settled to seller account', { type: 'seller', id: s.sellerId }),
        entry('platform_cash', 0, s.netPayable, 'Payout executed'),
      ],
      description: `Payout ${s.payoutRef} to ${s.sellerName} via ${s.payoutMethod}`,
      postedBy: 'finance',
    });
    db.ledger.unshift(je);
    logActivity(db, actor, 'settlement.paid', 'settlement', s.id, `ETB ${(s.netPayable / 100).toLocaleString('en-ET')} · ${s.payoutRef}`);
    audit(db, actor, 'settlement.pay', `settlement:${s.id}`, { netPayable: s.netPayable, ref: s.payoutRef });
    res.json({ settlement: s, journalEntry: je, message: `Paid. Journal ${je.id} posted and the trial balance still balances.` });
  });

  r.get('/ledger', (req, res) => {
    const journal = qStr(req.query.journal, '');
    const items = journal ? db.ledger.filter((e) => e.journal === journal) : db.ledger;
    res.json({
      items: items.map((e) => ({ ...e, lines: e.lines.map((l) => ({ ...l, label: ACCOUNT_LABELS[l.account] })) })),
      trialBalance: trialBalance(db),
      balanced: ledgerBalances(db.ledger),
      accounts: Object.keys(ACCOUNT_LABELS).map((code) => ({ code, label: ACCOUNT_LABELS[code as AccountCode] })),
    });
  });

  r.post('/ledger/adjustment', (req, res) => {
    const actor = who(req);
    const b = req.body as { account?: AccountCode; amount?: Minor; memo?: string };
    if (!b.account || !ACCOUNT_LABELS[b.account]) return res.status(422).json({ error: 'invalid_account', message: 'Pick an account from the chart of accounts.' });
    const amount = Math.abs(b.amount ?? 0);
    if (amount === 0) return res.status(422).json({ error: 'invalid_amount', message: 'An adjustment needs a non-zero amount.' });
    // Suspense is the only account a manual adjustment may touch without a
    // documented business reason. Everything else must come from a real event.
    const je = postJournal({
      journal: 'accrual',
      refType: 'adjustment',
      refId: id('adj'),
      refLabel: `ADJ-${b.account}`,
      at: new Date().toISOString(),
      lines: [
        entry('suspense', amount, 0, b.memo ?? 'Manual adjustment into suspense'),
        entry(b.account, 0, amount, b.memo ?? 'Manual adjustment'),
      ],
      description: `Manual adjustment by ${actor}: ${b.memo ?? 'no reason given'}`,
      postedBy: 'finance',
    });
    db.ledger.unshift(je);
    audit(db, actor, 'ledger.adjust', `account:${b.account}`, { amount, memo: b.memo });
    res.status(201).json({ journalEntry: je, message: 'Adjustment posted to suspense. It stays visible until a real event clears it.' });
  });

  /* --------------------------- reconciliation --------------------------- */

  r.get('/reconciliation', (_req, res) => {
    res.json({
      runs: db.reconciliations,
      codDeposits: db.codDeposits,
      shortfalls: db.codDeposits.filter((d) => d.variance > 0),
      blockedSettlements: db.settlements.filter((s) => s.status !== 'paid' && blockedBy(db, s.sellerId)),
      note: 'A cash shortfall blocks the seller payout. It does not get written off, and it is not netted against the next run.',
    });
  });

  /**
   * Record what an agent actually remitted. This is the only way a shortfall
   * clears: money arriving, not someone clicking "resolve". A deposit that
   * still does not add up stays short and keeps holding the payout.
   */
  r.post('/reconciliation/cod/:id', (req, res) => {
    const actor = who(req);
    const dep = db.codDeposits.find((x) => x.id === req.params.id);
    if (!dep) return notFound(res, 'Cash deposit');
    const b = req.body as { received?: Minor; reference?: string; method?: typeof dep.method };

    if (b.received !== undefined) {
      if (b.received < 0) return res.status(422).json({ error: 'invalid_amount', message: 'A remittance cannot be negative. Use a recovery entry instead.' });
      dep.received = b.received;
      dep.variance = dep.expected - dep.received;
      if (b.reference) dep.reference = b.reference;
      if (b.method) dep.method = b.method;
    }
    if (b.received !== undefined) dep.receivedAt = new Date().toISOString();

    if (dep.variance > 0) {
      dep.status = new Date() > new Date(dep.dueAt) ? 'late' : 'submitted';
      dep.note = `Short by ETB ${(dep.variance / 100).toLocaleString('en-ET')}. Payouts stay blocked until the balance arrives.`;
    } else {
      dep.status = 'confirmed';
      dep.note = b.received === undefined ? 'Confirmed against the bank statement.' : 'Remittance received in full.';
    }

    const stillBlocked = db.settlements.filter((s) => s.status !== 'paid' && blockedBy(db, s.sellerId));
    audit(db, actor, 'reconciliation.cod', `deposit:${dep.id}`, { received: dep.received, variance: dep.variance, status: dep.status });
    res.json({
      deposit: dep,
      cleared: dep.variance <= 0,
      stillBlocked: stillBlocked.map((s) => s.code),
      message:
        dep.variance <= 0
          ? `Deposit ${dep.id} reconciled in full. ${stillBlocked.length} payout${stillBlocked.length === 1 ? '' : 's'} remain blocked.`
          : `Still short by ETB ${(dep.variance / 100).toLocaleString('en-ET')}. ${stillBlocked.length} payout${stillBlocked.length === 1 ? '' : 's'} stay blocked.`,
    });
  });

  /* ------------------------------- Buy Box ------------------------------ */

  r.get('/buybox', (_req, res) => {
    const products = db.products
      .map((p) => {
        const offers = db.offers.filter((o) => o.productId === p.id);
        if (!offers.length) return null;
        const sel = selectBuyBox(offers, db, p);
        return {
          productId: p.id,
          title: p.title,
          image: p.images[0],
          offerCount: offers.length,
          winner: sel.offer ? { offerId: sel.offer.id, sellerId: sel.offer.sellerId, sellerName: db.orgs.find((o) => o.id === sel.offer!.sellerId)?.name ?? '', price: sel.offer.price } : null,
          reason: sel.reason,
          override: db.buyBoxOverrides.find((o) => o.productId === p.id) ?? null,
        };
      })
      .filter(Boolean);
    res.json({ products, overrides: db.buyBoxOverrides });
  });

  r.post('/buybox/override', (req, res) => {
    const actor = who(req);
    const b = req.body as { productId?: string; offerId?: string; reason?: string; expiresAt?: string };
    const offer = db.offers.find((o) => o.id === b.offerId);
    if (!offer) return notFound(res, 'Offer');
    if (!b.reason || b.reason.length < 10) {
      return res.status(422).json({ error: 'reason_required', message: 'A Buy Box override needs a written reason. It is shown to buyers as a promoted placement.' });
    }
    const override = {
      id: id('bbo'),
      productId: offer.productId,
      offerId: offer.id,
      reason: b.reason,
      by: actor,
      at: new Date().toISOString(),
      expiresAt: b.expiresAt,
    };
    db.buyBoxOverrides.unshift(override);
    audit(db, actor, 'buybox.override', `product:${offer.productId}`, { offerId: offer.id, reason: b.reason });
    res.status(201).json({ override, message: 'Override recorded. The buyer-facing ranking explanation will label this as a promoted placement.' });
  });

  r.delete('/buybox/override/:id', (req, res) => {
    const actor = who(req);
    const before = db.buyBoxOverrides.length;
    db.buyBoxOverrides = db.buyBoxOverrides.filter((o) => o.id !== req.params.id);
    if (db.buyBoxOverrides.length === before) return notFound(res, 'Override');
    audit(db, actor, 'buybox.override_removed', `override:${req.params.id}`);
    res.json({ ok: true, message: 'Override removed. Ranking returns to price, stock and seller performance.' });
  });

  /* ------------------------------ settings ------------------------------ */

  r.get('/settings', (_req, res) => {
    res.json({ settings: db.settings, flags: db.featureFlags, updatedBy: db.users.find((u) => u.id === db.settings.updatedBy)?.name ?? 'Admin' });
  });

  r.patch('/settings', (req, res) => {
    const actor = who(req);
    const b = req.body as { settings?: Partial<typeof db.settings> };
    if (!b.settings) return res.status(422).json({ error: 'no_settings', message: 'Nothing to update.' });
    const before = { ...db.settings };
    Object.assign(db.settings, b.settings, { updatedAt: new Date().toISOString(), updatedBy: 'u_admin1' });
    audit(db, actor, 'settings.update', 'settings', { before, after: db.settings });
    res.json({ settings: db.settings, message: 'Platform settings updated. Fee and tax changes apply to new orders only.' });
  });

  r.patch('/feature-flags', (req, res) => {
    const actor = who(req);
    const b = req.body as { flags?: Partial<typeof db.featureFlags> };
    if (!b.flags) return res.status(422).json({ error: 'no_flags', message: 'Nothing to toggle.' });
    const before = { ...db.featureFlags };
    Object.assign(db.featureFlags, b.flags, { updatedAt: new Date().toISOString() });
    audit(db, actor, 'feature_flags.update', 'feature_flags', { before, after: db.featureFlags });
    res.json({ flags: db.featureFlags, message: 'Flags updated. Shadow flags never serve buyer traffic.' });
  });

  /* -------------------------------- risk -------------------------------- */

  r.get('/risk', (_req, res) => {
    res.json({
      rules: db.riskRules,
      evaluations: db.riskEvaluations.slice(0, 40),
      decisions: db.riskEvaluations.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.decision]: (acc[e.decision] ?? 0) + 1 }), {}),
      note: 'Rules only, with measured false-positive rates. There is no fraud model trained here, because there are no labelled fraud outcomes to train on yet.',
    });
  });

  r.patch('/risk/rules/:id', (req, res) => {
    const actor = who(req);
    const rule = db.riskRules.find((x) => x.id === req.params.id);
    if (!rule) return notFound(res, 'Risk rule');
    const b = req.body as { enabled?: boolean; action?: typeof rule.action };
    if (b.enabled !== undefined) rule.enabled = b.enabled;
    if (b.action) rule.action = b.action;
    audit(db, actor, 'risk_rule.update', `rule:${rule.id}`, { enabled: rule.enabled, action: rule.action });
    res.json({ rule, message: `Rule "${rule.label}" updated. It hits ${rule.hits30d} times a month at a ${rule.falsePositiveRate}% false-positive rate.` });
  });

  /* --------------------------------- AI --------------------------------- */

  r.get('/ai', (_req, res) => {
    const items = db.aiSuggestions;
    res.json({
      items: items.slice(0, 40),
      totals: {
        calls: items.length,
        costMinor: sum(items.map((s) => s.costMinor)),
        tokensIn: sum(items.map((s) => s.tokensIn)),
        tokensOut: sum(items.map((s) => s.tokensOut)),
        blocked: items.filter((s) => s.guardrail.decision === 'blocked').length,
        flagged: items.filter((s) => s.guardrail.decision === 'flagged').length,
        applied: items.filter((s) => s.applied).length,
      },
      note: 'Guardrails are the reason these suggestions are safe to show. Blocked and flagged output is never published.',
    });
  });

  /* ---------------------------- notifications -------------------------- */

  r.get('/notifications', (req, res) => {
    const audience = qStr(req.query.audience, '') as Role | '';
    res.json({ items: audience ? db.notifications.filter((n) => n.audience === audience) : db.notifications });
  });

  r.post('/notify', (req, res) => {
    const actor = who(req);
    const b = req.body as Partial<NotificationItem> & { audience?: Role };
    if (!b.audience || !b.title) return res.status(422).json({ error: 'invalid_notification', message: 'A notification needs an audience and a title.' });
    const item: NotificationItem = {
      id: id('ntf'),
      at: new Date().toISOString(),
      channel: b.channel ?? 'in_app',
      audience: b.audience,
      title: b.title,
      body: b.body ?? '',
      severity: b.severity ?? 'info',
      read: false,
      link: b.link,
      entityType: b.entityType,
      entityId: b.entityId,
      dedupeKey: `${b.audience}:${b.title}:${b.entityId ?? ''}`,
    };
    if (db.notifications.some((n) => n.dedupeKey === item.dedupeKey)) {
      return res.status(409).json({ error: 'duplicate', message: 'That notification was already sent.' });
    }
    db.notifications.unshift(item);
    audit(db, actor, 'notification.send', `audience:${b.audience}`, { title: b.title });
    res.status(201).json({ notification: item });
  });

  return r;
}

/* ------------------------------- helpers -------------------------------- */

/**
 * A payout is blocked when the cash behind it does not reconcile. Scoped to
 * the seller: if one of their COD orders went out with an agent who is short,
 * only that seller's balance waits. Everyone else still gets paid.
 */
function blockedBy(db: Db, sellerId: string): string | null {
  const shortDeposits = db.codDeposits.filter((d) => d.variance > 0 && d.status !== 'confirmed');
  if (!shortDeposits.length) return null;

  const blockingAgents = new Set(shortDeposits.map((d) => d.agentId));
  const sellerOrderIds = new Set(
    db.orders.filter((o) => o.lines.some((l) => l.sellerId === sellerId) && o.status === 'delivered').map((o) => o.id),
  );
  if (!sellerOrderIds.size) return null;

  const exposedStops = allStopsOf(db).filter(
    (s) => blockingAgents.has(s.agentId) && sellerOrderIds.has(s.orderId),
  );
  if (!exposedStops.length) return null;

  const total = sum(shortDeposits.map((d) => d.variance));
  return `Cash remittance is short by ETB ${(total / 100).toLocaleString('en-ET')} across ${shortDeposits.length} deposit${shortDeposits.length === 1 ? '' : 's'}. ${exposedStops.length} of this seller's delivered COD orders went out with the affected agent${exposedStops.length === 1 ? '' : 's'}.`;
}

function allStopsOf(db: Db) {
  const orderByShipment = new Map(db.orders.filter((o) => o.shipment).map((o) => [o.shipment!.id, o.id]));
  return db.agentRoutes.flatMap((x) =>
    x.stops.map((s) => ({
      ...s,
      agentId: x.agentId,
      agentName: x.agentName,
      routeId: x.id,
      orderId: orderByShipment.get(s.shipmentId) ?? '',
    })),
  );
}

function trialBalance(db: Db) {
  const totals = db.ledger.reduce(
    (acc, e) => {
      for (const l of e.lines) {
        acc[l.account] = acc[l.account] ?? { debit: 0, credit: 0, label: ACCOUNT_LABELS[l.account] };
        acc[l.account]!.debit += l.debit;
        acc[l.account]!.credit += l.credit;
      }
      return acc;
    },
    {} as Record<string, { debit: number; credit: number; label: string }>,
  );
  const debit = Object.values(totals).reduce((a, x) => a + x.debit, 0);
  const credit = Object.values(totals).reduce((a, x) => a + x.credit, 0);
  return {
    accounts: Object.entries(totals).map(([account, v]) => ({ account, label: v.label, debit: v.debit, credit: v.credit, balance: v.debit - v.credit })),
    debit,
    credit,
    balanced: debit === credit,
  };
}
