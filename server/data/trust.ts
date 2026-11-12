import type { AiSuggestion, Dispute, NotificationItem, Order, ReorderSuggestion, RiskEvaluation, RiskRule, VerificationCase } from '../../shared/types.ts';
import { daysAgo, daysAhead } from '../lib/ids.ts';

export const riskRules: RiskRule[] = [
  {
    id: 'velocity_24h', label: 'Order velocity in 24h', severity: 'medium', enabled: true, action: 'flag',
    description: 'More than 6 orders in a rolling 24-hour window from one account or device, or a basket value spike of 4x the account median.',
    hits30d: 214, falsePositiveRate: 4.2, params: { maxOrders24h: 6, valueSpikeMultiple: 4 },
  },
  {
    id: 'new_account_high_value_cod', label: 'New account, high-value COD', severity: 'high', enabled: true, action: 'require_otp',
    description: 'Account less than 14 days old placing a cash-on-delivery order above ETB 5,000. Requires delivery OTP plus a photo at the door.',
    hits30d: 96, falsePositiveRate: 6.8, params: { accountAgeDays: 14, amountThreshold: 500000 },
  },
  {
    id: 'destination_changed', label: 'Destination changed after order', severity: 'high', enabled: true, action: 'hold',
    description: 'Delivery address modified after the order left the warehouse. Holds the parcel and requires seller re-confirmation.',
    hits30d: 41, falsePositiveRate: 2.9, params: { holdHours: 24 },
  },
  {
    id: 'impossible_delivery_combination', label: 'Impossible delivery combination', severity: 'medium', enabled: true, action: 'block',
    description: 'Requested window outside the courier coverage area, or an address outside the zone for the assigned agent. Blocks at checkout rather than failing in the field.',
    hits30d: 178, falsePositiveRate: 3.4, params: { blockOutsideZones: true, amountThreshold: 200000 },
  },
  {
    id: 'cod_amount_anomaly', label: 'COD amount anomaly', severity: 'low', enabled: true, action: 'flag',
    description: 'Cash due at the door differs from the order total by more than ETB 0.50, or cash due exceeds ETB 30,000 which exceeds the agent float limit.',
    hits30d: 63, falsePositiveRate: 1.9, params: { toleranceMinor: 50, agentFloatLimit: 3000000 },
  },
  {
    id: 'device_fingerprint_repeat', label: 'Repeated device fingerprint', severity: 'high', enabled: true, action: 'hold',
    description: 'One device fingerprint creating multiple accounts, or more than three accounts from one address within 30 days.',
    hits30d: 28, falsePositiveRate: 5.1, params: { maxAccountsPerDevice: 2, windowDays: 30 },
  },
  {
    id: 'b2b_credit_over_limit', label: 'B2B credit over limit', severity: 'high', enabled: true, action: 'block',
    description: 'A purchase order would take an organisation past its assessed credit limit. Blocked before the PO is issued, not after the invoice.',
    hits30d: 12, falsePositiveRate: 0.4, params: { hardBlock: true },
  },
];

export function buildRiskEvaluations(orders: Order[]): RiskEvaluation[] {
  const out: RiskEvaluation[] = [];
  for (const o of orders.slice(0, 26)) {
    const flags: RiskEvaluation['triggered'] = [];
    const signals: RiskEvaluation['signals'] = [
      { label: 'Account age', value: `${(20 + (o.riskScore % 200))} days` },
      { label: 'Orders in 24h', value: String(o.riskScore % 5) },
      { label: 'Payment method', value: o.paymentMethod },
      { label: 'Basket value', value: `ETB ${(o.total / 100).toLocaleString('en-ET')}` },
      { label: 'Zone coverage', value: o.address.city === 'Addis Ababa' ? 'Covered' : 'Partner only' },
    ];
    if (o.riskScore > 20) flags.push({ rule: 'velocity_24h', label: 'Order velocity in 24h', severity: 'medium', detail: '6 orders in the last 24 hours against an account median of 1.' });
    if (o.paymentMethod === 'cod' && o.total > 500000) flags.push({ rule: 'new_account_high_value_cod', label: 'New account, high-value COD', severity: 'high', detail: `Cash of ETB ${(o.total / 100).toLocaleString('en-ET')} on a 12-day-old account.` });
    if (o.address.city !== 'Addis Ababa' && o.total > 200000) flags.push({ rule: 'impossible_delivery_combination', label: 'Impossible delivery combination', severity: 'medium', detail: `Zone ${o.address.subcity} is partner-covered only for high-value orders.` });
    if (o.total > 3000000) flags.push({ rule: 'cod_amount_anomaly', label: 'COD amount anomaly', severity: 'low', detail: 'Cash due exceeds the agent float limit for a single stop.' });
    const score = Math.min(99, flags.reduce((a, f) => a + (f.severity === 'high' ? 38 : f.severity === 'medium' ? 21 : 9), o.riskScore));
    out.push({
      orderId: o.id,
      at: o.placedAt,
      score,
      decision: score > 70 ? 'review' : 'allow',
      triggered: flags,
      signals,
    });
  }
  return out;
}

const REASONS: [Dispute['reason'], string, string, Dispute['status'], Dispute['resolution']][] = [
  ['not_received', 'Order never arrived', 'Buyer says the parcel was marked delivered but they were not home and no one in the building received it. Proof of delivery shows a photo taken 40 metres from the address.', 'seller_response', { outcome: 'return_and_refund', amount: 0, note: 'Awaiting the agent statement on the delivery photo location.', at: daysAgo(0) }],
  ['damaged', 'Item arrived broken', 'Refrigerator arrived with a dented compressor housing and the shelf glass is cracked. Photos attached. Box itself was intact.', 'mediation', undefined],
  ['wrong_item', 'Wrong model delivered', 'Ordered the 55-inch TV, received a 43-inch. The listing and the invoice both say 55 inch.', 'resolved_buyer', { outcome: 'refund_full', amount: 2008000, note: 'Seller shipped the wrong size. Full refund plus return label issued.', at: daysAgo(2) }],
  ['missing_parts', 'Missing parts in the box', 'Coffee set arrived without the steel filter. The packaging had been opened before delivery and resealed.', 'open', undefined],
  ['not_as_described', 'Not as described', 'Listing says undyed handloom cotton. The received blanket feels like synthetic blend. Buyer provided a close-up photo.', 'seller_response', undefined],
  ['late_delivery', 'Delivered far too late', 'Promised 2 days, arrived in 11. Buyer needed it for an event.', 'resolved_seller', { outcome: 'release_to_seller', amount: 0, note: 'Delay was caused by an address change the buyer made after dispatch. No seller fault, no refund.', at: daysAgo(3) }],
  ['counterfeit', 'Suspected inauthentic', 'Sunglasses arrived with a serial number that does not match the brand database. Requesting authenticity check.', 'mediation', undefined],
];

export function buildDisputes(orders: Order[]): Dispute[] {
  const disputed = orders.filter((o) => o.status === 'disputed' || o.status === 'refunded');
  return REASONS.map(([reason, summary, body, status, resolution], i) => {
    const o = disputed[i % Math.max(1, disputed.length)] ?? orders[i % orders.length];
    const sellerId = o.lines[0]?.sellerId ?? 'org_selam';
    return {
      id: `dsp_${i + 1}`,
      code: `DSP-${2100 + i}`,
      orderId: o.id,
      orderCode: o.code,
      buyerId: o.buyerId,
      buyerName: o.buyerName,
      sellerId,
      sellerName: o.lines[0]?.sellerName ?? 'Seller',
      reason,
      summary,
      status,
      amount: o.total,
      evidence:
        i === 0
          ? [
              { id: 'ev_1', kind: 'photo' as const, url: '/api/media/ev_1', uploadedBy: 'buyer' as const },
              { id: 'ev_2', kind: 'photo' as const, url: '/api/media/pod_photo', uploadedBy: 'system' as const },
            ]
          : i % 2 === 0
            ? [{ id: 'ev_1', kind: 'photo' as const, url: `/api/media/ev_${i + 1}`, uploadedBy: 'buyer' as const }]
            : [],
      structuredThread: [
        { id: `th_${i}_1`, by: 'buyer' as const, at: daysAgo(9 - i * 0.5), reasonCode: reason, body, attachments: i === 0 ? ['ev_1', 'ev_2'] : [] },
        ...(status === 'open'
          ? []
          : [{ id: `th_${i}_2`, by: 'seller' as const, at: daysAgo(8 - i * 0.5), reasonCode: 'response', body: i === 1 ? 'The unit was checked and packed by our team. Photographs of the packing process are available on request. We are happy to replace rather than refund if the buyer prefers.' : 'Our delivery record shows the parcel was handed over at the address with proof attached. We have shared the delivery log with HaniMarket.', attachments: [] }]),
        ...(status === 'mediation'
          ? [{ id: `th_${i}_3`, by: 'mediator' as const, at: daysAgo(3), reasonCode: 'mediation_opened', body: 'Mediator assigned. Both parties asked to submit evidence within 48 hours. Payout for this order stays blocked until the case closes.', attachments: [] }]
          : []),
      ],
      resolution: resolution
        ? { outcome: resolution.outcome, amount: resolution.amount || o.total, note: resolution.note, at: resolution.at }
        : undefined,
      createdAt: daysAgo(9 - i * 0.5),
      slaHours: 72,
      dueAt: daysAgo(9 - i * 0.5 - 3),
    };
  });
}

export const verificationCases: VerificationCase[] = [
  {
    id: 'vc_1', orgId: 'org_newbie', orgName: 'Kidist Tailuring & Craft'.replace('Tailuring', 'Tailoring'), orgType: 'seller',
    submittedTier: 'basic', currentTier: 'none', status: 'in_review', submittedAt: daysAgo(2), slaHours: 72,
    checks: [
      { id: 'c1', name: 'Business registration (የንግድ ምዝገባ)', status: 'pass', note: 'Cross-checked against the trade registry. Name matches the ID of the owner.', weight: 30 },
      { id: 'c2', name: 'Tax ID (TIN) validation', status: 'pending', note: 'TIN submitted but not yet verified against the tax authority feed.', weight: 25 },
      { id: 'c3', name: 'Owner ID verification', status: 'pass', note: 'National ID verified. Face match score 0.97.', weight: 20 },
      { id: 'c4', name: 'Bank account ownership', status: 'pass', note: 'Account name matches the registered business name.', weight: 15 },
      { id: 'c5', name: 'Bank account ownership', status: 'pass', note: 'Account number format valid for CBE.', weight: 10 },
    ],
    documents: [{ id: 'd1', kind: 'Business licence', file: 'kidist-licence.pdf', uploadedAt: daysAgo(2) }, { id: 'd2', kind: 'National ID', file: 'kidist-id.jpg', uploadedAt: daysAgo(2) }, { id: 'd3', kind: 'TIN certificate', file: 'kidist-tin.pdf', uploadedAt: daysAgo(1) }],
    score: 75, blocking: [{ id: 'b1', reason: 'TIN validation incomplete — cannot issue a fiscal invoice' }],
    reviewer: 'u_admin1',
  },
  {
    id: 'vc_2', orgId: 'org_medina', orgName: 'Medina Electronics PLC', orgType: 'seller',
    submittedTier: 'business', currentTier: 'basic', status: 'needs_info', submittedAt: daysAgo(5), slaHours: 72,
    checks: [
      { id: 'c1', name: 'Business registration', status: 'pass', note: 'Valid PLC registration.', weight: 25 },
      { id: 'c2', name: 'Tax ID (TIN) validation', status: 'pass', note: 'TIN valid and active.', weight: 20 },
      { id: 'c3', name: 'Bank account ownership', status: 'fail', note: 'Account holder name is "Michael Girma" but the registered entity is "Medina Electronics PLC". Needs a company resolution letter or a corporate account.', weight: 30 },
      { id: 'c4', name: 'Trade licence', status: 'pending', note: 'Awaiting upload.', weight: 15 },
      { id: 'c5', name: 'Sanctions and watchlist screening', status: 'pass', note: 'No matches.', weight: 10 },
    ],
    documents: [{ id: 'd1', kind: 'Business licence', file: 'medina-licence.pdf', uploadedAt: daysAgo(5) }, { id: 'd2', kind: 'TIN certificate', file: 'medina-tin.pdf', uploadedAt: daysAgo(5) }],
    score: 55, blocking: [{ id: 'b1', reason: 'Payout account name does not match the registered entity' }, { id: 'b2', reason: 'Trade licence not uploaded' }],
    reviewer: 'u_finance1',
  },
  {
    id: 'vc_3', orgId: 'org_glow', orgName: 'Glow Beauty Ethiopia', orgType: 'seller',
    submittedTier: 'business', currentTier: 'basic', status: 'queued', submittedAt: daysAgo(0.2), slaHours: 48,
    checks: [
      { id: 'c1', name: 'Business registration', status: 'pass', note: 'Valid registration.', weight: 25 },
      { id: 'c2', name: 'Tax ID (TIN) validation', status: 'pending', note: 'Queued.', weight: 25 },
      { id: 'c3', name: 'Distribution authorisation', status: 'pending', note: 'Awaiting the brand authorisation letters from the Korean supplier.', weight: 30 },
      { id: 'c4', name: 'Product safety registration', status: 'pending', note: 'Cosmetic products require a product registration certificate.', weight: 20 },
    ],
    documents: [{ id: 'd1', kind: 'Business licence', file: 'glow-licence.pdf', uploadedAt: daysAgo(0.2) }, { id: 'd2', kind: 'Supplier authorisation', file: 'seoul-authorisation.pdf', uploadedAt: daysAgo(0.2) }],
    score: 25, blocking: [{ id: 'b1', reason: 'Business tier requires cosmetic product registration' }],
  },
  {
    id: 'vc_4', orgId: 'org_kidsworld', orgName: 'Kids World Trading', orgType: 'seller',
    submittedTier: 'trusted', currentTier: 'basic', status: 'approved', submittedAt: daysAgo(11), slaHours: 72,
    checks: [
      { id: 'c1', name: 'Business registration', status: 'pass', note: 'Valid.', weight: 20 },
      { id: 'c2', name: 'Tax ID (TIN) validation', status: 'pass', note: 'Valid.', weight: 20 },
      { id: 'c3', name: 'Bank account ownership', status: 'pass', note: 'Name matches.', weight: 20 },
      { id: 'c4', name: 'Performance history', status: 'pass', note: '87% delivery success, 5.2% cancellation over 90 days. Above the trusted-tier floor of 82%.', weight: 30 },
      { id: 'c5', name: 'Dispute history', status: 'pass', note: '3.1% dispute rate. Under the 4% ceiling.', weight: 10 },
    ],
    documents: [{ id: 'd1', kind: 'Business licence', file: 'kids-licence.pdf', uploadedAt: daysAgo(11) }],
    score: 84, blocking: [], reviewer: 'u_admin1', reviewedAt: daysAgo(8),
  },
  {
    id: 'vc_5', orgId: 'org_habesha', orgName: 'Habesha Retail Group', orgType: 'buyer_org',
    submittedTier: 'enterprise', currentTier: 'basic', status: 'rejected', submittedAt: daysAgo(22), slaHours: 120,
    checks: [
      { id: 'c1', name: 'Business registration', status: 'pass', note: 'Valid.', weight: 20 },
      { id: 'c2', name: 'Tax ID (TIN) validation', status: 'pass', note: 'Valid.', weight: 15 },
      { id: 'c3', name: 'Bank statements (6 months)', status: 'fail', note: 'Statement shows an invoice still unpaid at 51 days. Enterprise terms require a clean 12-month payment record.', weight: 40 },
      { id: 'c4', name: 'Credit bureau report', status: 'fail', note: 'Two late payments recorded in the last 12 months.', weight: 25 },
    ],
    documents: [{ id: 'd1', kind: 'Business licence', file: 'habesha-licence.pdf', uploadedAt: daysAgo(22) }, { id: 'd2', kind: 'Bank statement', file: 'cbe-6months.pdf', uploadedAt: daysAgo(22) }],
    score: 34, blocking: [{ id: 'b1', reason: 'Payment record does not meet the enterprise credit threshold' }],
    reviewer: 'u_finance1', reviewedAt: daysAgo(20),
  },
];

export function buildAiSuggestions(): AiSuggestion[] {
  const mk = (
    capability: AiSuggestion['capability'],
    actor: string,
    surface: AiSuggestion['surface'],
    inputSummary: string,
    output: string,
    decision: AiSuggestion['guardrail']['decision'],
    opts: { applied?: boolean; guardReason?: string; fail?: string; tokens?: number; latency?: number } = {},
  ): AiSuggestion => ({
    id: `ai_${Math.random().toString(36).slice(2, 10)}`,
    capability,
    at: daysAgo(Math.floor(Math.random() * 6)),
    model: 'hm-router → ethiopia-tuned-llm-v3',
    inputSummary,
    output,
    tokensIn: opts.tokens ?? 780 + Math.floor(Math.random() * 900),
    tokensOut: 220 + Math.floor(Math.random() * 400),
    costMinor: 18 + Math.floor(Math.random() * 40),
    latencyMs: opts.latency ?? 900 + Math.floor(Math.random() * 2200),
    guardrail: {
      decision,
      checks: [
        { id: 'g1', name: 'No PII in output', result: decision === 'blocked' ? 'fail' : 'pass' },
        { id: 'g2', name: 'No fabricated price or stock claim', result: decision === 'flagged' ? 'warn' : 'pass' },
        { id: 'g3', name: 'Amharic language safety', result: 'pass' },
        { id: 'g4', name: 'Prohibited claims filter', result: 'pass' },
        { id: 'g5', name: 'Catalog grounding check', result: decision === 'blocked' ? 'fail' : opts.fail ? 'warn' : 'pass' },
      ],
      reason: opts.guardReason,
    },
    applied: opts.applied ?? false,
    surface,
    actor,
  });

  return [
    mk('listing_generation', 'Marta Tesfaye', 'seller_portal', 'Product photo + brand + 3 attributes, category Electronics > Mobile Phones', 'Samsung Galaxy A55 5G — 128GB, 8GB RAM, Midnight Black\nሳምሰን ላይክስ A55 5G — 128ጊባ, 8ጊባ ራም, ማይድናይት ጥቁር\n\n6.6" Super AMOLED 120Hz display · 50MP OIS camera · 5000mAh battery. IP67 water resistant with a 12-month manufacturer warranty.', 'allowed', { applied: true }),
    mk('listing_generation', 'Yonas Bekele', 'seller_portal', 'Single photo of a teak dining table, no measurements provided', 'Solid Teak Dining Table\nየሲዳር ድል የበትት መጠረጃ ሥንት\n\nSeats six. Solid teak with a hand-rubbed oil finish. Delivered assembled inside Addis.', 'flagged', { guardReason: 'Dimensions missing from the source. Guardrail flagged the draft rather than inventing measurements — seller must add size before publishing.' }),
    mk('pricing_guidance', 'Marta Tesfaye', 'seller_portal', 'Offer of_0001 · 240 units on hand · 41 sold in 30d · 3 competing offers', 'At ETB 28,400 you are ETB 300 above the cheapest competing offer and you hold 74% of the category volume. Dropping to ETB 28,100 puts you in the Buy Box position and costs you about ETB 12,300 in monthly margin at current velocity. Suggested: ETB 28,100.', 'allowed', { applied: true }),
    mk('pricing_guidance', 'Rahel Haile', 'seller_portal', 'Offer of_0013 · Yirgacheffe 1kg · 30-day price history', 'Holding at ETB 480 is defensible. You have the highest rating in the coffee category and the only single-origin washed option. Raising to ETB 510 would add about ETB 46,000 in monthly margin with a modelled 3% volume drop. Suggested: test ETB 505 for two weeks.', 'allowed', { applied: false }),
    mk('demand_forecast', 'Marta Tesfaye', 'seller_portal', 'Offer of_0004 · 28 days of sales history · reorder level 12', 'Suggested reorder: 90 units of JBL Tune 770NC. Your 28-day moving average is 3.2 units a day and cover is currently 9 days against a 12-day reorder level. Reasoning: moving average 28d, no seasonal signal with only 8 weeks of history, one promotional spike excluded.', 'allowed', { applied: true }),
    mk('recommendations', 'system', 'buyer_web', 'Home page render for 42,110 visitors', 'Baseline: category popularity, blended with recency and a small exploration term. The machine-learned challenger model is in shadow evaluation and has NOT beaten the baseline on conversion over 14 days, so it is not serving traffic.', 'allowed', { applied: true, latency: 180 }),
    mk('buyer_assistant', 'Abebe Kebede', 'buyer_web', '"I need noise cancelling headphones under ETB 5,000 for a 6 hour flight"', 'Two good options. The JBL Tune 770NC at ETB 3,850 gives you 70 hours of battery with ANC on for most of the flight, and it folds flat. The Sony WH-1000XM5 at ETB 14,200 is the better-sounding pair if the budget stretches. For a 6-hour flight on a budget, take the JBL.', 'allowed', { applied: true }),
    mk('buyer_assistant', 'Abebe Kebede', 'buyer_web', '"yirgacheffe ቡና ለሰጋ እና ለእንጀት ምን ልወስድ"', 'የይርጋችፌ የተበረቀቀ ነጭ ለእንጀት ነው። ለቡና ማንሌት የተጠረቀ ውሃ ያስፈልጋል። እስካሁን ወይስ አለመስበስ ካልፈለገዎ የይርጋችፌ አንድ ኪሎ ይገቡ። 52 ኤትቢ በበትት ውስጥ ነው።', 'allowed', { applied: true }),
    mk('translation_am_en', 'system', 'seller_portal', 'Batch of 42 seller descriptions en → am', '42 of 42 translated. 4 flagged for a human pass because the source contained a product-claim sentence that the Amharic rendering would have over-strengthened. The 4 flagged items were not published.', 'flagged', { guardReason: 'Product claim strength changed during translation. Published only after seller confirmation.' }),
    mk('listing_generation', 'Michael Girma', 'seller_portal', 'Product description supplied by seller with a contact phone number and a competitor brand name', 'Blocked. The draft contained a competitor brand name and the seller\'s own phone number in the description body, both of which violate listing policy.', 'blocked', { guardReason: 'Prohibited claim: competitor comparison plus off-platform contact details.', fail: 'Catalog grounding check failed' }),
    mk('pricing_guidance', 'Nahom Solomon', 'seller_portal', 'BulkMart offer of_0026 · MOQ 20 · tier pricing', 'Your tier table is inconsistent. The 20-unit tier is priced below your 4-unit tier, and the 5-unit tier is priced above the 20-unit tier. Buyers doing price comparisons will flag the listing. Suggested ladder: 4 units 100%, 20 units 94%, 100 units 88%.', 'allowed', { applied: true }),
    mk('demand_forecast', 'system', 'admin', 'Platform-wide reorder sweep across 3,180 offers', 'The model produced a suggested reorder for 214 offers but we are still serving the popularity baseline for buyer-facing recommendations. Shadow mode only — no auto-orders are placed anywhere in the system.', 'allowed', { applied: false }),
  ];
}

export function buildReorder(products: { id: string; title: string }[]): ReorderSuggestion[] {
  const titleOf = (id: string, fallback: string) => products.find((p) => p.id === id)?.title ?? fallback;
  return [
    { productId: 'p_001', title: titleOf('p_001', 'Samsung Galaxy A55 5G — 128GB, 8GB RAM'), sku: 'SEL-A55-128-BLK', onHand: 14, reorderLevel: 30, avgDailySales: 3.2, daysOfCover: 4, suggestedQty: 90, supplierName: 'Horizon Electronics FZE', unitCost: 2410000, forecastMethod: 'moving_average_28d', confidence: 0.72, reasoning: ['28-day moving average is 3.2 units/day', 'Last promotion lifted velocity 2.1x — excluded from the baseline', 'Supplier lead time 24 days, so 90 units covers the gap', 'No seasonal pattern yet: only 8 weeks of history'], baselineOnly: true },
    { productId: 'p_004', title: titleOf('p_004', 'JBL Tune 770NC Wireless ANC Headphones'), sku: 'SEL-JBL-770-BLK', onHand: 41, reorderLevel: 40, avgDailySales: 1.9, daysOfCover: 21, suggestedQty: 60, supplierName: 'Horizon Electronics FZE', unitCost: 298000, forecastMethod: 'moving_average_28d', confidence: 0.68, reasoning: ['28-day moving average is 1.9 units/day', 'Currently just above the reorder level', 'Suggested quantity covers 30 days at current rate'], baselineOnly: true },
    { productId: 'p_013', title: titleOf('p_013', 'Yirgacheffe Washed Coffee Beans — 1kg, roasted to order'), sku: 'ADD-YIR-1KG', onHand: 0, reorderLevel: 120, avgDailySales: 11.4, daysOfCover: 0, suggestedQty: 400, supplierName: 'Bule Hora Washing Station Cooperative', unitCost: 42000, forecastMethod: 'moving_average_28d', confidence: 0.81, reasoning: ['Roasted to order — zero stock is normal, this is a green-coffee signal', '28-day moving average is 11.4 kg/day', 'Tuesday and Friday roast slots need 6-day forward notice', 'Batch BATCH-CO-114 covers 260 kg of the gap'], baselineOnly: true },
    { productId: 'p_007', title: titleOf('p_007', 'Lenovo IdeaPad Slim 3 — Ryzen 5, 16GB, 512GB'), sku: 'LEN-IP3-R5-16', onHand: 22, reorderLevel: 25, avgDailySales: 1.1, daysOfCover: 20, suggestedQty: 40, supplierName: 'Horizon Electronics FZE', unitCost: 1980000, forecastMethod: 'seasonal_naive', confidence: 0.54, reasoning: ['Seasonal-naive baseline applied: same period last month sold 38 units', 'Weekly variance is high, so confidence is low', '40 units is a cautious position, not a forecast'], baselineOnly: true },
    { productId: 'p_019', title: titleOf('p_019', 'Mineral Sunscreen SPF 50 PA++++ — 75ml'), sku: 'GB-SPF50-75', onHand: 8, reorderLevel: 150, avgDailySales: 7.8, daysOfCover: 1, suggestedQty: 350, supplierName: 'Seoul Beauty Group', unitCost: 6200, forecastMethod: 'trend_linear', confidence: 0.79, reasoning: ['Upward trend of 2.4 units/day over the last 14 days', 'Stock will be gone within a day at the current rate', 'Batch BATCH-GB-041 produced 1,000 units — check whether that batch is already in your warehouse before ordering'], baselineOnly: true },
    { productId: 'p_021', title: titleOf('p_021', 'Huggies Extra Absorbent Diapers Size 4 — 240 count'), sku: 'KID-HUG-4-240', onHand: 340, reorderLevel: 200, avgDailySales: 5.2, daysOfCover: 65, suggestedQty: 0, supplierName: 'Imported direct', unitCost: 331000, forecastMethod: 'moving_average_28d', confidence: 0.86, reasoning: ['65 days of cover at the current rate', 'No reorder suggested — the B2B pipeline already has an open purchase order for 100 cases', 'Re-evaluate after RFQ-02031 closes'], baselineOnly: true },
  ];
}

export function buildNotifications(): NotificationItem[] {
  const mk = (n: Omit<NotificationItem, 'id' | 'dedupeKey'>): NotificationItem => ({
    ...n,
    id: `ntf_${Math.random().toString(36).slice(2, 10)}`,
    dedupeKey: `${n.audience}:${n.title}:${n.entityId ?? ''}`,
  });
  return [
    mk({ at: daysAgo(0, 0), channel: 'in_app', audience: 'buyer', title: 'Your order is out for delivery', body: 'HM-48231 is with the agent. Expect a call shortly. Please prepare exact change if you chose cash on delivery.', severity: 'info', read: false, link: '/orders/HM-48231', entityType: 'order', entityId: 'HM-48231' }),
    mk({ at: daysAgo(0), channel: 'sms', audience: 'buyer', title: 'Agent arriving in 30 minutes', body: 'Kalkidan is 30 minutes away with 2 parcels. Track: hanimarket.et/t/HM-48231', severity: 'info', read: false, link: '/track/HM-48231', entityType: 'order', entityId: 'HM-48231' }),
    mk({ at: daysAgo(1), channel: 'in_app', audience: 'seller', title: 'Payout approved', body: 'Settlement Settle-2026-09-A for ETB 1,284,900 has been approved and will be sent to CBE ••••4821.', severity: 'success', read: false, link: '/seller/payouts', entityType: 'settlement', entityId: 'stl_1' }),
    mk({ at: daysAgo(1), channel: 'in_app', audience: 'seller', title: '3 new orders to pack', body: 'Three orders placed in the last hour, all in Bole Zone 1 and 2.', severity: 'warn', read: false, link: '/seller/orders', entityType: 'order' }),
    mk({ at: daysAgo(1), channel: 'in_app', audience: 'admin', title: 'Payout blocked by reconciliation', body: 'Settlement for Medina Electronics is blocked. Cash remittance from HaniMarket Courier is short by ETB 1,240.', severity: 'critical', read: false, link: '/admin/finance', entityType: 'settlement', entityId: 'stl_medina' }),
    mk({ at: daysAgo(2), channel: 'in_app', audience: 'admin', title: 'Verification case needs a decision', body: 'Medina Electronics PLC submitted for business tier. The payout account name does not match the registered entity.', severity: 'warn', read: false, link: '/admin/verifications', entityType: 'verification', entityId: 'vc_2' }),
    mk({ at: daysAgo(2), channel: 'in_app', audience: 'business_buyer', title: 'New quotation on RFQ-02031', body: 'Selam Tech quoted ETB 56,545,650 for 240 units, valid until tomorrow. You also have 2 other quotes to compare.', severity: 'info', read: false, link: '/b2b/rfqs/rfq_1', entityType: 'quotation', entityId: 'qt_2' }),
    mk({ at: daysAgo(2), channel: 'email', audience: 'business_buyer', title: 'RFQ-02028 was awarded', body: 'You awarded Selam Tech Trading. Purchase order PO-00914 has been issued and the seller has confirmed.', severity: 'success', read: true, link: '/b2b/pos/po_2', entityType: 'purchase_order', entityId: 'po_2' }),
    mk({ at: daysAgo(3), channel: 'in_app', audience: 'agent', title: 'Cash remittance overdue', body: 'ETB 1,240 collected yesterday has not been remitted. Settlement for your route is blocked until it clears.', severity: 'critical', read: false, link: '/agent', entityType: 'agent', entityId: 'u_agent1' }),
    mk({ at: daysAgo(3), channel: 'sms', audience: 'buyer', title: 'Your dispute is in mediation', body: 'DSP-2102 has been assigned to a mediator. Payout stays blocked until the case closes. Reply STOP to opt out.', severity: 'warn', read: true, link: '/orders/HM-48218', entityType: 'dispute', entityId: 'dsp_2' }),
    mk({ at: daysAgo(4), channel: 'in_app', audience: 'seller', title: 'Buy Box position lost', body: 'You lost the Buy Box on 3 offers after a competitor reduced price. Prices and the ranking explanation are in your Buy Box tab.', severity: 'warn', read: true, link: '/seller/buybox', entityType: 'offer' }),
    mk({ at: daysAgo(4), channel: 'in_app', audience: 'seller', title: 'Store publication pending', body: 'Your store will go live as soon as business verification clears. Buyers cannot see you until then.', severity: 'info', read: true, link: '/seller/verification', entityType: 'verification', entityId: 'vc_1' }),
    mk({ at: daysAgo(5), channel: 'in_app', audience: 'admin', title: 'New dispute opened', body: 'DSP-2104 — missing parts. 72-hour SLA started.', severity: 'warn', read: true, link: '/admin/disputes', entityType: 'dispute', entityId: 'dsp_4' }),
    mk({ at: daysAgo(6), channel: 'in_app', audience: 'admin', title: 'AI evaluation failed', body: 'A listing-generation run was blocked by the prohibited-claims guardrail. Output was not published.', severity: 'warn', read: true, link: '/admin/ai', entityType: 'ai', entityId: 'ai_blocked' }),
    mk({ at: daysAgo(6), channel: 'in_app', audience: 'business_buyer', title: 'Invoice INV-09118 is overdue', body: 'Invoice from Addis Coffee Estate is 12 days past due. Net-30 credit terms are suspended for Habesha Retail Group.', severity: 'critical', read: true, link: '/b2b/invoices', entityType: 'invoice', entityId: 'inv_4' }),
    mk({ at: daysAgo(8), channel: 'in_app', audience: 'seller', title: 'Reorder suggestion', body: '3 products are below their reorder level. Suggested quantities include the reasoning behind each number.', severity: 'info', read: true, link: '/seller/inventory', entityType: 'inventory' }),
  ];
}

export const expiryWindow = daysAhead(30);
