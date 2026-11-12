import type { JournalEntry, Minor, Order, PayoutAccount, ReconciliationRun, Settlement, TaxReceipt } from '../../shared/types.ts';
import { daysAgo } from '../lib/ids.ts';
import { entry, postJournal, rate } from '../lib/money.ts';

const COMMISSION = 0.05;
const WITHHOLDING = 0.02;

/** Platform fee schedule — a revenue function, kept explicit. */
export const fees = {
  commissionRate: COMMISSION,
  paymentFeeRate: 0.011,
  codFeeRate: 0.01,
  deliveryFlat: 4500,
  promoSubsidyShare: 0.5,
  b2bCommissionRate: 0.03,
};

export function buildLedger(orders: Order[]): { ledger: JournalEntry[]; settlements: Settlement[]; taxReceipts: TaxReceipt[] } {
  const ledger: JournalEntry[] = [];
  const settlements: Settlement[] = [];
  const taxReceipts: TaxReceipt[] = [];
  const bySeller = new Map<string, Order[]>();
  let fr = 70000;

  for (const o of orders) {
    if (o.status === 'pending_payment' || o.status === 'cancelled') continue;
    const sellerId = o.lines[0]?.sellerId ?? 'unknown';

    // --- Cash / escrow receipt at order capture -------------------------------
    const cashAcct = o.channel === 'b2b' ? 'receivable_b2b' : o.paymentMethod === 'cod' ? 'cash_cod_in_transit' : 'cash_psp';
    // The provider withholds its fee before the money lands, so only the net
    // amount ever lands in the cash account and the fee itself is an expense.
    const pspFee = o.paymentMethod === 'cod' || o.channel === 'b2b' ? 0 : rate(o.total, fees.paymentFeeRate);
    const commission = rate(o.subtotal, fees.commissionRate);
    // The seller's cut is the residual of what the buyer actually paid once VAT and
    // the delivery fee are stripped out. Deriving it (rather than restating gross
    // minus discounts) keeps the entry balanced by construction, so a rounding
    // change upstream can never produce a half-santim hole in the ledger.
    let sellerNet = o.paid - o.tax - o.deliveryFee - commission;
    const suspense = sellerNet < 0 ? -sellerNet : 0;
    if (suspense > 0) sellerNet = 0;
    const lines = [
      entry(cashAcct, o.paid - pspFee, 0, `Order ${o.code} collected`),
      entry('escrow_seller_payable', 0, sellerNet, `Seller net of ${o.subtotal} gross`),
      entry('revenue_commission', 0, commission, 'Platform commission'),
      entry('revenue_delivery', 0, o.deliveryFee, 'Delivery fee collected'),
      entry('tax_payable_vat', 0, o.tax, 'VAT accrued 15%'),
    ];
    if (pspFee > 0) lines.push(entry('expense_psp', pspFee, 0, 'PSP processing fee'));
    if (suspense > 0) lines.push(entry('suspense', suspense, 0, 'Shortfall held pending reconciliation'));
    ledger.push(
      postJournal({
        journal: 'sales',
        refType: 'order',
        refId: o.id,
        refLabel: o.code,
        at: o.placedAt,
        lines,
        description: `Order ${o.code} — ${o.lines.length} line(s), ${o.paymentMethod.toUpperCase()}`,
        attachments: [`invoice:${o.invoiceNo ?? 'n/a'}`],
      }),
    );

    // The promotion discount lands on the seller's net above. The platform carries
    // its contracted share of that discount, booked as an expense with a matching
    // credit back into escrow so the seller is not quietly funding our marketing.
    if (o.discount > 0) {
      const subsidy = rate(o.discount, fees.promoSubsidyShare);
      if (subsidy > 0) {
        ledger.push(
          postJournal({
            journal: 'accrual',
            refType: 'adjustment',
            refId: `${o.id}_promo`,
            refLabel: `${o.code} promo subsidy`,
            at: o.placedAt,
            lines: [
              entry('discount_expense', subsidy, 0, 'Platform share of promotion discount'),
              entry('escrow_seller_payable', 0, subsidy, 'Reimburse seller for platform share'),
            ],
            description: `Promotion subsidy on order ${o.code} — ${Math.round(fees.promoSubsidyShare * 100)}% of a ETB ${(o.discount / 100).toFixed(2)} discount`,
            postedBy: 'auto',
          }),
        );
      }
    }

    // --- Tax receipt ----------------------------------------------------------
    fr += 3;
    taxReceipts.push({
      id: `fr_${o.id}`,
      orderCode: o.code,
      buyerName: o.buyerName,
      at: o.placedAt,
      gross: o.subtotal,
      tax: o.tax,
      net: o.subtotal,
      fiscalCode: o.channel === 'b2b' ? 'B2B-SLS' : 'B2C-SLS',
      fiscalReceiptNo: o.fiscalReceiptNo ?? `FR-${fr}`,
      status: o.fiscalReceiptNo ? 'reported' : 'pending_sync',
      buyerTin: o.channel === 'b2b' ? '0012457896' : undefined,
    });

    if (!bySeller.has(sellerId)) bySeller.set(sellerId, []);
    bySeller.get(sellerId)!.push(o);
  }

  // --- Settlements per seller ------------------------------------------------
  const periods: [string, string][] = [
    ['Settle-2026-09-A', 'Settlement run · 1–15 Sep 2026'],
    ['Settle-2026-08-B', 'Settlement run · 16–31 Aug 2026'],
  ];
  let sIdx = 0;
  for (const [sellerId, list] of bySeller) {
    const delivered = list.filter((o) => o.status === 'delivered' || o.status === 'shipped' || o.status === 'out_for_delivery' || o.status === 'refunded');
    if (!delivered.length) continue;
    for (let pi = 0; pi < periods.length; pi++) {
      const chunk = pi === 0 ? delivered.slice(0, Math.ceil(delivered.length / 2)) : delivered.slice(Math.ceil(delivered.length / 2));
      if (!chunk.length) continue;
      sIdx += 1;
      const gross = chunk.reduce((a, o) => a + o.subtotal, 0) as Minor;
      const commission = rate(gross, fees.commissionRate) as Minor;
      const deliveryFees = chunk.reduce((a, o) => a + o.deliveryFee, 0) as Minor;
      const refunds = chunk.filter((o) => o.status === 'refunded').reduce((a, o) => a + o.total, 0) as Minor;
      const withholding = rate(gross, WITHHOLDING) as Minor;
      const adjustments = 0;
      const netPayable = gross - commission - refunds - withholding + adjustments;
      const [code, desc] = periods[pi];
      const createdAt = pi === 0 ? daysAgo(3) : daysAgo(18);
      const status: Settlement['status'] =
        pi === 0 ? (sellerId === 'org_medina' ? 'blocked' : sellerId === 'org_kidsworld' ? 'approved' : sellerId === 'org_glow' ? 'on_hold' : 'paid') : 'paid';

      const s: Settlement = {
        id: `stl_${sIdx}`,
        code: `${code}-${sellerId.replace('org_', '').toUpperCase().slice(0, 4)}`,
        sellerId,
        sellerName: sellerId.replace('org_', '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        periodFrom: pi === 0 ? '2026-09-01' : '2026-08-16',
        periodTo: pi === 0 ? '2026-09-15' : '2026-08-31',
        orderCount: chunk.length,
        grossSales: gross,
        commission,
        deliveryFees,
        refunds,
        adjustments,
        withholdingTax: withholding,
        netPayable,
        status,
        blockedReason: status === 'blocked' ? 'Cash remittance from the delivery partner is short by ETB 1,240. Payout held until reconciliation clears.' : status === 'on_hold' ? 'One disputed order worth ETB 12,500 is still in mediation. Held out of this run.' : undefined,
        payoutRef: status === 'paid' ? `PO-${70000 + sIdx * 13}` : undefined,
        payoutMethod: status === 'paid' ? 'CBE Birr · 1000••••4821' : undefined,
        createdAt,
        paidAt: status === 'paid' ? daysAgo(pi === 0 ? 1 : 12) : undefined,
        holdFlag: status === 'on_hold' || status === 'blocked',
        note: status === 'blocked' ? 'Reconciliation service blocked this payout automatically.' : undefined,
      };

      if (status === 'paid' || status === 'approved') {
        const settlementLines: JournalEntry['lines'] = [
          entry('seller_payable', netPayable, 0, 'Release of accrued seller balance', { type: 'seller', id: sellerId }),
        ];
        if (refunds > 0) settlementLines.push(entry('refund_payable', refunds, 0, 'Refunds borne by the seller', { type: 'seller', id: sellerId }));
        if (adjustments !== 0) settlementLines.push(entry('discount_expense', adjustments, 0, 'Manual settlement adjustment', { type: 'seller', id: sellerId }));
        settlementLines.push(
          entry('revenue_commission', commission, 0, 'Commission recognised', { type: 'seller', id: sellerId }),
          entry('tax_payable_withholding', withholding, 0, 'Withholding tax on seller payouts'),
          // Relieve escrow by exactly what the other lines consume, so the entry
          // balances whatever the numbers upstream happen to be.
          entry('escrow_seller_payable', 0, netPayable + refunds + commission + withholding + adjustments, 'Relieve escrow'),
        );
        const je = postJournal({
          journal: 'settlement',
          refType: 'settlement',
          refId: s.id,
          refLabel: s.code,
          at: createdAt,
          lines: settlementLines,
          description: desc,
          postedBy: 'finance',
        });
        s.journalEntryId = je.id;
        ledger.push(je);
        if (status === 'paid') {
          const payout = postJournal({
            journal: 'settlement',
            refType: 'payout',
            refId: s.id,
            refLabel: `${s.code} payout`,
            at: s.paidAt!,
            lines: [
              entry('seller_payable', netPayable, 0, 'Settled to seller account', { type: 'seller', id: sellerId }),
              entry('platform_cash', 0, netPayable, 'Payout executed'),
            ],
            description: `Payout ${s.payoutRef} to ${s.payoutMethod}`,
            postedBy: 'finance',
          });
          ledger.push(payout);
        }
      }
      settlements.push(s);
    }
  }

  // --- Refund postings -------------------------------------------------------
  for (const o of orders.filter((x) => x.status === 'refunded').slice(0, 3)) {
    const fee = rate(o.subtotal, fees.commissionRate);
    ledger.push(
      postJournal({
        journal: 'refund',
        refType: 'refund',
        refId: o.id,
        refLabel: o.code,
        at: o.history[o.history.length - 1]?.at ?? o.placedAt,
        lines: [
          entry('refund_payable', o.total, 0, 'Refund issued to buyer'),
          entry('cash_psp', 0, o.total, 'Cash out to buyer in the original method'),
        ],
        description: `Full refund for order ${o.code} — item not as described`,
      }),
    );
    ledger.push(
      postJournal({
        journal: 'refund',
        refType: 'refund',
        refId: `${o.id}_clawback`,
        refLabel: `${o.code} clawback`,
        at: o.history[o.history.length - 1]?.at ?? o.placedAt,
        lines: [
          entry('escrow_seller_payable', fee, 0, 'Commission retained out of seller net'),
          entry('revenue_commission', 0, fee, 'Commission retained on refunded order'),
        ],
        description: `Commission of ETB ${(fee / 100).toFixed(2)} retained on refunded order ${o.code}`,
      }),
    );
  }

  // --- COD remittance posting -------------------------------------------------
  const codDelivered = orders.filter((o) => o.paymentMethod === 'cod' && o.status === 'delivered');
  if (codDelivered.length) {
    const collected = codDelivered.reduce((a, o) => a + o.total, 0) as Minor;
    const agentFee = rate(collected, fees.codFeeRate) as Minor;
    ledger.push(
      postJournal({
        journal: 'accrual',
        refType: 'adjustment',
        refId: 'cod_remit_1',
        refLabel: 'COD-REM-2026-09',
        at: daysAgo(2),
        lines: [
          entry('cash_psp', collected - agentFee, 0, 'Agent cash remitted to the PSP'),
          entry('discount_expense', agentFee, 0, 'COD handling fee borne by the platform'),
          entry('cash_cod_in_transit', 0, collected, 'Relieve cash held by delivery agents'),
        ],
        description: `Cash-on-delivery remittance for ${codDelivered.length} delivered orders`,
      }),
    );
  }

  // --- VAT remittance ---------------------------------------------------------
  const vatLiability = orders
    .filter((o) => o.status !== 'pending_payment' && o.status !== 'cancelled')
    .reduce((a, o) => a + o.tax, 0) as Minor;
  if (vatLiability > 0) {
    ledger.push(
      postJournal({
        journal: 'tax',
        refType: 'adjustment',
        refId: 'vat_2026_09',
        refLabel: 'VAT-2026-09',
        at: daysAgo(5),
        lines: [
          entry('tax_payable_vat', vatLiability, 0, 'VAT return filed and settled with the authority'),
          entry('platform_cash', 0, vatLiability, 'Cash out for the VAT filing'),
        ],
        description: `VAT settlement — 15% of ETB ${(vatLiability / 100).toFixed(2)} for September 2026`,
        postedBy: 'finance',
      }),
    );
  }
  return { ledger, settlements, taxReceipts };
}

export function buildReconciliations(): ReconciliationRun[] {
  return [
    {
      id: 'rec_1', at: daysAgo(1), scope: 'psp', counterparty: 'Telebirr',
      records: 1284, matched: 1281, mismatched: 3, missing: 0, netDifference: 0,
      status: 'exceptions', payoutBlocked: false,
      exceptions: [
        { id: 'ex_1', kind: 'amount', detail: 'Transaction for order HM-48231 settled at ETB 4,512.00 but the intent was ETB 4,512.50. Shortfall of ETB 0.50.', amount: 50, ref: 'HM-48231', at: daysAgo(1), resolution: 'open' },
        { id: 'ex_2', kind: 'duplicate', detail: 'Two identical captures on the same idempotency key. Second one auto-reversed, no net impact.', amount: 0, ref: 'idem_ord_48219_451250', at: daysAgo(2), resolution: 'resolved' },
        { id: 'ex_3', kind: 'unmatched_charge', detail: 'PSP fee charged twice for one settlement batch. ETB 12.40 under dispute with the provider.', amount: 1240, ref: 'PSP-700234', at: daysAgo(3), resolution: 'investigating' },
      ],
    },
    {
      id: 'rec_2', at: daysAgo(0), scope: 'cod_remittance', counterparty: 'HaniMarket Courier',
      records: 342, matched: 338, mismatched: 3, missing: 1, netDifference: 124000,
      status: 'exceptions', payoutBlocked: true,
      exceptions: [
        { id: 'ex_4', kind: 'missing_payout', detail: 'Cash collected for 4 deliveries has not been remitted. ETB 1,240.00 outstanding against the agent.', amount: 124000, ref: 'AGENT-KALKIDAN', at: daysAgo(1), resolution: 'open' },
        { id: 'ex_5', kind: 'late_remittance', detail: 'Remittance for 11 Sep was made 2 days after the agreed cutoff.', amount: 0, ref: 'REM-2026-09-11', at: daysAgo(2), resolution: 'investigating' },
        { id: 'ex_6', kind: 'amount', detail: 'One delivery recorded as collected at ETB 2,150.00 but the order shows ETB 2,150.00 collected and ETB 45.00 COD fee not deducted.', amount: 4500, ref: 'HM-48214', at: daysAgo(2), resolution: 'open' },
      ],
    },
    {
      id: 'rec_3', at: daysAgo(2), scope: 'payouts', counterparty: 'CBE Birr',
      records: 42, matched: 42, mismatched: 0, missing: 0, netDifference: 0,
      status: 'clean', payoutBlocked: false, exceptions: [],
    },
    {
      id: 'rec_4', at: daysAgo(5), scope: 'bank', counterparty: 'Awash Bank',
      records: 18, matched: 18, mismatched: 0, missing: 0, netDifference: 0,
      status: 'clean', payoutBlocked: false, exceptions: [],
    },
  ];
}

export const payoutAccounts: PayoutAccount[] = [
  { id: 'pa_1', sellerId: 'org_selam', bank: 'CBE', accountName: 'Selam Tech Trading PLC', accountNumber: '1000234567891', verified: true, isDefault: true },
  { id: 'pa_2', sellerId: 'org_habesha_home', bank: 'Awash Bank', accountName: 'Habesha Home Goods PLC', accountNumber: '1000456789012', verified: true, isDefault: true },
  { id: 'pa_3', sellerId: 'org_addis', bank: 'Dashen Bank', accountName: 'Addis Coffee Estate PLC', accountNumber: '1000678901234', verified: true, isDefault: true },
  { id: 'pa_4', sellerId: 'org_bulkmart', bank: 'CBE', accountName: 'BulkMart Trading PLC', accountNumber: '1000890123456', verified: true, isDefault: true },
  { id: 'pa_5', sellerId: 'org_kichen', bank: 'NBE', accountName: 'Kíchen Moda PLC', accountNumber: '1000901234789', verified: true, isDefault: true },
  { id: 'pa_6', sellerId: 'org_glow', bank: 'NBE', accountName: 'Glow Beauty Ethiopia', accountNumber: '1000123987654', verified: false, isDefault: true },
  { id: 'pa_7', sellerId: 'org_kidsworld', bank: 'Zemen Bank', accountName: 'Kids World Trading', accountNumber: '1000765432109', verified: true, isDefault: true },
  { id: 'pa_8', sellerId: 'org_fbab', bank: 'CBE', accountName: 'HaniMarket Fulfilment Services PLC', accountNumber: '1000555667788', verified: true, isDefault: true },
];
