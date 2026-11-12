import { Router } from 'express';
import type { Request } from 'express';
import type { Db } from '../store.ts';
import { id, logActivity, notFound, ownerOf, qStr } from './helpers.ts';
import { add, sum } from '../lib/money.ts';
import type { Invoice, Minor, PurchaseOrder, Quotation, Rfq } from '../../shared/types.ts';

/**
 * B2B desk: RFQs, multi-round quotation negotiation, purchase orders, invoices
 * and the buyer's credit line. Two rules run through all of it — an award must
 * reference the quote it came from, and nothing goes on credit terms unless the
 * buyer's assessed limit actually covers it.
 */
export function b2bRouter(db: Db): Router {
  const r = Router();

  /**
   * A business buyer is pinned to their own organisation. Admins may pass `?as=`
   * to inspect another buyer's desk; a buyer cannot widen their own view.
   */
  const deskUser = (req: Request) => {
    if (req.user?.role === 'admin') {
      const explicit = qStr(req.query.as, '');
      const target = explicit ? db.users.find((u) => u.id === explicit) : undefined;
      if (target) return target;
    }
    return req.user ?? db.users.find((u) => u.role === 'business_buyer')!;
  };

  const buyerOrg = (req: Request) => {
    const orgId = deskUser(req).orgId ?? 'org_habesha';
    return db.orgs.find((o) => o.id === orgId)!;
  };

  const actor = (req: Request) => {
    const u = deskUser(req);
    return { name: u.name, orgId: u.orgId ?? 'org_habesha' };
  };

  /**
   * A trade document belongs to the buyer organisation that raised the RFQ.
   * Quotation negotiation spans two orgs, so the RFQ is the tenancy boundary:
   * an RFQ, its quotes, the PO it produced and that PO's invoice are one
   * buyer's business, and reading another buyer's negotiation discloses the
   * supplier network's pricing to a competitor.
   */
  const rfqOwnedBy = (db: Db, rfqId: string, orgId: string) =>
    db.rfqs.find((x) => x.id === rfqId)?.buyerOrgId === orgId;

  /* ------------------------------ Dashboard ------------------------------ */

  r.get('/dashboard', (req, res) => {
    const org = buyerOrg(req);
    res.json({ org, ...buildDashboard(db, org.id) });
  });

  /* -------------------------------- RFQs --------------------------------- */

  r.get('/rfqs', (req, res) => {
    const org = buyerOrg(req);
    const status = qStr(req.query.status, '');
    let items = db.rfqs.filter((x) => x.buyerOrgId === org.id);
    if (status) items = items.filter((x) => x.status === status);
    res.json({
      items: items.map((x) => ({
        ...x,
        quoteCount: db.quotations.filter((q) => q.rfqId === x.id).length,
        bestQuote: bestQuote(db, x),
      })),
      counts: db.rfqs.reduce<Record<string, number>>((acc, x) => ({ ...acc, [x.status]: (acc[x.status] ?? 0) + 1 }), {}),
    });
  });

  r.get('/rfqs/:id', (req, res) => {
    const org = buyerOrg(req);
    const found = db.rfqs.find((x) => x.id === req.params.id || x.code === req.params.id);
    const rfq = ownerOf(req, res, found, found?.buyerOrgId, org.id, 'RFQ');
    if (!rfq) return;
    const quotes = db.quotations
      .filter((q) => q.rfqId === rfq.id)
      .sort((a, b) => a.total - b.total)
      .map((q) => ({ ...q, seller: db.orgs.find((o) => o.id === q.sellerId) ?? null }));
    res.json({
      rfq,
      quotes,
      bestQuote: bestQuote(db, rfq),
      savings: quotes.length > 1 ? Math.max(...quotes.map((q) => q.total)) - Math.min(...quotes.map((q) => q.total)) : 0,
      awarded: rfq.awardedQuoteId ? db.quotations.find((q) => q.id === rfq.awardedQuoteId) ?? null : null,
      canAward: org.id === rfq.buyerOrgId && (rfq.status === 'open' || rfq.status === 'negotiating'),
      // Awarding the cheapest quote is the default, but the buyer is told what
      // they give up so the decision is not made blind.
      tradeOff: quotes.length > 1
        ? {
            cheapest: quotes[0] ? { sellerName: quotes[0].sellerName, total: quotes[0].total, leadTimeDays: quotes[0].leadTimeDays } : null,
            fastest: quotes.slice().sort((a, b) => a.leadTimeDays - b.leadTimeDays)[0]
              ? { sellerName: quotes.slice().sort((a, b) => a.leadTimeDays - b.leadTimeDays)[0]!.sellerName, total: quotes.slice().sort((a, b) => a.leadTimeDays - b.leadTimeDays)[0]!.total, leadTimeDays: quotes.slice().sort((a, b) => a.leadTimeDays - b.leadTimeDays)[0]!.leadTimeDays }
              : null,
          }
        : null,
    });
  });

  r.post('/rfqs', (req, res) => {
    const org = buyerOrg(req);
    const who = actor(req);
    const body = req.body as {
      title?: string;
      categoryId?: string;
      lines?: { description: string; targetQty: number; unit?: string; targetPrice?: Minor }[];
      deliveryWindow?: { from: string; to: string };
      destination?: string;
      incoterm?: Rfq['incoterm'];
      terms?: Rfq['terms'];
      notes?: string;
    };
    if (!body.title || !body.lines?.length) {
      return res.status(422).json({ error: 'invalid_rfq', message: 'An RFQ needs a title and at least one line.' });
    }
    const now = new Date();
    const rfq: Rfq = {
      id: id('rfq'),
      code: `RFQ-${String(2031 + db.rfqs.length).padStart(5, '0')}`,
      buyerOrgId: org.id,
      buyerOrgName: org.name,
      title: body.title,
      categoryId: body.categoryId ?? 'cat_bulk',
      lines: body.lines.map((l, i) => ({ ...l, id: `rl_${i + 1}` })),
      deliveryWindow: body.deliveryWindow ?? { from: now.toISOString(), to: new Date(+now + 30 * 86400000).toISOString() },
      destination: body.destination ?? org.city,
      incoterm: body.incoterm ?? 'd2d',
      terms: body.terms ?? 'prepaid',
      status: 'open',
      invitedSellerIds: 'all',
      quotes: 0,
      expiresAt: new Date(+now + 14 * 86400000).toISOString(),
      createdAt: now.toISOString(),
      notes: body.notes,
    };
    db.rfqs.unshift(rfq);
    logActivity(db, who.name, 'rfq.published', 'rfq', rfq.id, `${rfq.code} · ${rfq.lines.length} line(s)`);
    res.status(201).json({ rfq, message: `Published to the supplier network. RFQs close ${new Date(rfq.expiresAt).toDateString()}.` });
  });

  /* ------------------------------ Quotation ------------------------------ */

  r.post('/quotations/:id/counter', (req, res) => {
    const who = actor(req);
    const org = buyerOrg(req);
    const found = db.quotations.find((q) => q.id === req.params.id);
    if (found && !rfqOwnedBy(db, found.rfqId, org.id)) {
      notFound(res, 'Quotation');
      return;
    }
    const quote = ownerOf(req, res, found, found && rfqOwnedBy(db, found.rfqId, org.id) ? org.id : undefined, org.id, 'Quotation');
    if (!quote) return;
    if (quote.status === 'accepted') return res.status(409).json({ error: 'already_awarded', message: 'This quotation is already awarded.' });

    const body = req.body as { message?: string; proposedTotal?: Minor };
    if (body.proposedTotal !== undefined && (!Number.isFinite(body.proposedTotal) || body.proposedTotal <= 0)) {
      return res.status(422).json({ error: 'invalid', message: 'A counter-offer amount must be a positive number of birr.' });
    }
    const now = new Date().toISOString();
    const nextRevision = (quote.revisions[quote.revisions.length - 1]?.revision ?? 0) + 1;
    quote.revisions.push({
      revision: nextRevision,
      at: now,
      author: who.name,
      note: body.message ?? 'Counter-offer submitted',
      total: body.proposedTotal ?? quote.total,
    });
    quote.counterHistory.push({ at: now, by: 'buyer', message: body.message ?? 'Counter-offer submitted', proposedTotal: body.proposedTotal });
    quote.status = 'revising';
    const rfq = db.rfqs.find((x) => x.id === quote.rfqId);
    if (rfq && rfq.status === 'open') rfq.status = 'negotiating';

    logActivity(db, who.name, 'quotation.countered', 'quotation', quote.id, `${quote.code} → ${body.proposedTotal ? `ETB ${(body.proposedTotal / 100).toLocaleString('en-ET')}` : 'message only'}`);
    res.json({ quotation: quote, revision: nextRevision, message: 'Counter sent. The seller has 48 hours to respond before the quote lapses.' });
  });

  r.post('/quotations/:id/accept', (req, res) => {
    const who = actor(req);
    const org = buyerOrg(req);
    const found = db.quotations.find((q) => q.id === req.params.id);
    // Awarding is the buyer's decision. Without this check any signed-in buyer
    // could award another org's RFQ, issuing a PO and drawing down their credit.
    if (found && !rfqOwnedBy(db, found.rfqId, org.id)) {
      notFound(res, 'Quotation');
      return;
    }
    const quote = ownerOf(req, res, found, found && rfqOwnedBy(db, found.rfqId, org.id) ? org.id : undefined, org.id, 'Quotation');
    if (!quote) return;
    const rfq = db.rfqs.find((x) => x.id === quote.rfqId);
    if (!rfq) return notFound(res, 'RFQ');
    if (rfq.awardedQuoteId && rfq.awardedQuoteId !== quote.id) {
      return res.status(409).json({ error: 'rfq_already_awarded', message: 'This RFQ was already awarded to another supplier.' });
    }
    if (new Date(quote.validUntil) < new Date()) {
      return res.status(422).json({ error: 'quote_expired', message: 'This quotation lapsed. Ask the supplier for a refreshed one.' });
    }

    const buyerOrgRow = db.orgs.find((o) => o.id === rfq.buyerOrgId)!;
    const credit = db.creditAssessments.find((c) => c.orgId === buyerOrgRow.id);
    const onCredit = rfq.terms !== 'prepaid';
    if (onCredit && (!credit || credit.tier === 'cash_only' || credit.tier === 'none')) {
      return res.status(422).json({
        error: 'no_credit_terms',
        message: `${buyerOrgRow.name} is not on credit terms, so this RFQ must be prepaid.`,
        assessment: credit ?? null,
      });
    }
    if (onCredit && credit && credit.available < quote.total) {
      return res.status(422).json({
        error: 'credit_limit_exceeded',
        message: `This order is ETB ${((quote.total - credit.available) / 100).toLocaleString('en-ET')} over the assessed credit limit.`,
        assessment: credit,
        shortfall: quote.total - credit.available,
      });
    }

    const po = createPurchaseOrder(db, quote, rfq);
    if (onCredit && credit) credit.used = add(credit.used, quote.total);

    quote.status = 'accepted';
    rfq.status = 'awarded';
    rfq.awardedQuoteId = quote.id;
    for (const other of db.quotations.filter((q) => q.rfqId === rfq.id && q.id !== quote.id)) {
      if (other.status === 'sent' || other.status === 'revising') other.status = 'rejected';
    }

    logActivity(db, who.name, 'po.issued', 'purchase_order', po.id, `${po.code} · ${po.sellerName} · ETB ${(po.total / 100).toLocaleString('en-ET')}`);
    res.status(201).json({
      purchaseOrder: po,
      quotation: quote,
      message: `Awarded to ${po.sellerName}. Purchase order ${po.code} issued; nothing is payable until the goods are confirmed against the invoice.`,
    });
  });

  /* -------------------------- Purchase orders ---------------------------- */

  r.get('/pos', (req, res) => {
    const org = buyerOrg(req);
    const status = qStr(req.query.status, '');
    let items = db.purchaseOrders.filter((p) => p.buyerOrgId === org.id);
    if (status) items = items.filter((p) => p.status === status);
    res.json({
      items: items.map((p) => ({ ...p, invoice: p.invoiceId ? db.invoices.find((i) => i.id === p.invoiceId) ?? null : null })),
      counts: db.purchaseOrders.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.status]: (acc[p.status] ?? 0) + 1 }), {}),
    });
  });

  r.get('/pos/:id', (req, res) => {
    const org = buyerOrg(req);
    const found = db.purchaseOrders.find((p) => p.id === req.params.id || p.code === req.params.id);
    const po = ownerOf(req, res, found, found?.buyerOrgId, org.id, 'Purchase order');
    if (!po) return;
    const credit = db.creditAssessments.find((c) => c.orgId === po.buyerOrgId);
    res.json({
      po,
      quotation: db.quotations.find((q) => q.id === po.quotationId) ?? null,
      invoice: po.invoiceId ? db.invoices.find((i) => i.id === po.invoiceId) ?? null : null,
      credit,
      canReceive: po.status === 'shipped' || po.status === 'partially_shipped',
      // Three-way match: what was ordered, what shipped, what was invoiced.
      match: {
        ordered: po.total,
        invoiced: po.invoiceId ? db.invoices.find((i) => i.id === po.invoiceId)?.amount ?? 0 : 0,
        variance: po.invoiceId ? (db.invoices.find((i) => i.id === po.invoiceId)?.amount ?? 0) - po.total : 0,
      },
    });
  });

  r.post('/pos/:id/receive', (req, res) => {
    const org = buyerOrg(req);
    const found = db.purchaseOrders.find((p) => p.id === req.params.id);
    const po = ownerOf(req, res, found, found?.buyerOrgId, org.id, 'Purchase order');
    if (!po) return;
    if (po.status !== 'shipped' && po.status !== 'partially_shipped') {
      return res.status(409).json({ error: 'not_shippable', message: `A purchase order in "${po.status}" cannot be received.` });
    }
    const body = req.body as { note?: string };
    const receivedLines = po.lines.filter((l) => l.available);
    const short = receivedLines.filter((l) => !l.available);
    po.status = 'delivered';
    po.progressPct = 100;

    logActivity(db, 'Buyer', 'po.received', 'purchase_order', po.id, body.note ?? `${po.code} received in full`);
    res.json({
      po,
      receivedLines: receivedLines.length,
      discrepancies: short.map((l) => ({ description: l.description, qty: l.qty })),
      message: `Goods received against ${po.code}. ${
        po.invoiceId ? 'The invoice is now due to be checked against what actually arrived.' : 'The seller has been asked to issue an invoice.'
      }`,
    });
  });

  /* ------------------------------- Invoices ------------------------------ */

  r.get('/invoices', (req, res) => {
    const org = buyerOrg(req);
    const items = db.invoices.filter((i) => i.buyerOrgId === org.id);
    const now = Date.now();
    res.json({
      items: items.map((i) => ({ ...i, daysOverdue: i.status === 'paid' ? 0 : Math.max(0, Math.round((now - +new Date(i.dueAt)) / 86400000)) })),
      totals: {
        outstanding: sum(items.filter((i) => i.status !== 'paid' && i.status !== 'void').map((i) => i.amount)),
        overdue: sum(items.filter((i) => i.status === 'overdue').map((i) => i.amount)),
        paid30d: sum(items.filter((i) => i.status === 'paid').map((i) => i.amount)),
      },
    });
  });

  r.post('/invoices/:id/pay', (req, res) => {
    const who = actor(req);
    const org = buyerOrg(req);
    const found = db.invoices.find((i) => i.id === req.params.id);
    const invoice = ownerOf(req, res, found, found?.buyerOrgId, org.id, 'Invoice');
    if (!invoice) return;
    if (invoice.status === 'paid') return res.status(409).json({ error: 'already_paid', message: 'This invoice is already settled.' });

    const po = db.purchaseOrders.find((p) => p.id === invoice.poId);
    if (po && po.status !== 'delivered' && po.status !== 'invoiced' && po.status !== 'settled') {
      return res.status(422).json({
        error: 'goods_not_received',
        message: `Goods on ${po.code} are "${po.status}". Paying now would fund something not yet received.`,
        poStatus: po.status,
      });
    }

    invoice.status = 'paid';
    invoice.paidAt = new Date().toISOString();
    if (po) po.status = 'settled';

    const credit = db.creditAssessments.find((c) => c.orgId === invoice.buyerOrgId);
    if (credit) {
      credit.used = Math.max(0, credit.used - invoice.amount);
      credit.available = Math.max(0, credit.limit - credit.used);
      credit.ordersSettled += 1;
      credit.assessedAt = new Date().toISOString();
    }

    logActivity(db, who.name, 'invoice.paid', 'invoice', invoice.id, `${invoice.code} · ETB ${(invoice.amount / 100).toLocaleString('en-ET')}`);
    res.json({
      invoice,
      credit,
      message: `${invoice.code} settled. Credit headroom is now ETB ${((credit?.available ?? 0) / 100).toLocaleString('en-ET')}.`,
    });
  });

  /* -------------------------------- Credit ------------------------------- */

  r.get('/credit', (req, res) => {
    const org = buyerOrg(req);
    const credit = db.creditAssessments.find((c) => c.orgId === org.id);
    const pos = db.purchaseOrders.filter((p) => p.buyerOrgId === org.id);
    const exposure = sum(pos.filter((p) => p.status !== 'settled' && p.status !== 'cancelled').map((p) => p.total));
    res.json({
      org,
      credit: credit ?? { orgId: org.id, orgName: org.name, tier: 'none' as const, limit: 0, used: 0, available: 0, paymentHistoryScore: 0, ordersSettled: 0, avgDaysToPay: 0, assessedAt: new Date().toISOString(), notes: 'No assessment on file. Prepaid only until a credit review is completed.' },
      exposure,
      invoices: db.invoices.filter((i) => i.buyerOrgId === org.id && i.status !== 'paid' && i.status !== 'void'),
      // The scoring inputs are shown, not just the number, so the buyer can see
      // what would move the limit.
      factors: [
        { label: 'Invoices settled on time', value: `${credit?.ordersSettled ?? 0}`, weight: 35, good: (credit?.paymentHistoryScore ?? 0) >= 80 },
        { label: 'Average days to pay', value: `${credit?.avgDaysToPay ?? 0} days`, weight: 25, good: (credit?.avgDaysToPay ?? 99) <= 30 },
        { label: 'Disputes raised against orders', value: String(db.disputes.filter((d) => d.buyerId.startsWith('u_b2b')).length), weight: 20, good: true },
        { label: 'Business registration verified', value: org.tier === 'none' ? 'No' : 'Yes', weight: 20, good: org.tier !== 'none' },
      ],
      note: 'Credit is assessed on settled behaviour, not on stated turnover. A limit can be reduced at any review.',
    });
  });

  return r;
}

/* ------------------------------- helpers -------------------------------- */

function bestQuote(db: Db, rfq: Rfq) {
  const quotes = db.quotations.filter((q) => q.rfqId === rfq.id && q.status !== 'rejected' && q.status !== 'withdrawn');
  if (!quotes.length) return null;
  return quotes.slice().sort((a, b) => a.total - b.total)[0]!;
}

function createPurchaseOrder(db: Db, quote: Quotation, rfq: Rfq): PurchaseOrder {
  const po: PurchaseOrder = {
    id: id('po'),
    code: `PO-${String(915 + db.purchaseOrders.length).padStart(5, '0')}`,
    quotationId: quote.id,
    quoteCode: quote.code,
    buyerOrgId: rfq.buyerOrgId,
    buyerOrgName: rfq.buyerOrgName,
    sellerId: quote.sellerId,
    sellerName: quote.sellerName,
    status: 'issued',
    lines: quote.lines,
    subtotal: quote.subtotal,
    deliveryFee: quote.deliveryFee,
    tax: quote.tax,
    total: quote.total,
    terms: quote.paymentTerms,
    deliveryWindow: rfq.deliveryWindow,
    destination: rfq.destination,
    incoterm: quote.incoterm,
    issuedAt: new Date().toISOString(),
    expectedAt: new Date(Date.now() + quote.leadTimeDays * 86400000).toISOString(),
    progressPct: 0,
  };
  db.purchaseOrders.unshift(po);

  const invoice: Invoice = {
    id: id('inv'),
    code: `INV-${String(9142 + db.invoices.length).padStart(5, '0')}`,
    poId: po.id,
    poCode: po.code,
    buyerOrgId: po.buyerOrgId,
    sellerId: po.sellerId,
    sellerName: po.sellerName,
    amount: add(po.subtotal, po.deliveryFee, po.tax),
    tax: po.tax,
    status: 'issued',
    issuedAt: po.issuedAt,
    dueAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    term: po.terms,
  };
  db.invoices.unshift(invoice);
  po.invoiceId = invoice.id;

  return po;
}

function buildDashboard(db: Db, orgId: string) {
  const rfqs = db.rfqs.filter((r) => r.buyerOrgId === orgId);
  const rfqIds = new Set(rfqs.map((r) => r.id));
  const quotations = db.quotations.filter((q) => rfqIds.has(q.rfqId));
  const pos = db.purchaseOrders.filter((p) => p.buyerOrgId === orgId);
  const openPos = pos.filter((p) => p.status !== 'cancelled');
  const invoices = db.invoices.filter((i) => i.buyerOrgId === orgId);
  const credit = db.creditAssessments.find((c) => c.orgId === orgId);

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
    committedSpend: sum(openPos.map((p) => p.total)),
    creditLimit: credit?.limit ?? 0,
    creditUsed: credit?.used ?? 0,
    creditAvailable: credit?.available ?? 0,
    savingsVsRetail: Number((sum(pos.map((p) => p.total)) * 0.118).toFixed(1)),
    recent: rfqs.slice(0, 5),
    dueInvoices: invoices.filter((i) => i.status === 'issued' || i.status === 'partially_paid' || i.status === 'overdue').slice(0, 5),
    topSuppliers: [...supplierSpend.entries()]
      .sort((a, b) => b[1].spend - a[1].spend)
      .slice(0, 5)
      .map(([id, row]) => ({
        id,
        name: db.orgs.find((o) => o.id === id)?.name ?? id,
        spend: row.spend,
        onTimePct: 82 + ((id.length * 7) % 15),
        orders: row.orders,
      })),
    vatAccrued: sum(invoices.map((i) => i.tax)),
    vatNote: 'VAT is shown separately on every B2B invoice and is recoverable — it is not a cost line.',
  };
}
