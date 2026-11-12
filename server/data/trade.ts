import type {
  CreditAssessment, Employee, Expense, Invoice, ProductionBatch, ProcurementOrder, PurchaseOrder, Quotation, Rfq, Supplier,
} from '../../shared/types.ts';
import { daysAgo, daysAhead } from '../lib/ids.ts';

export function buildTrade() {
  const rfqs: Rfq[] = [
    {
      id: 'rfq_1', code: 'RFQ-02031', buyerOrgId: 'org_lemlem', buyerOrgName: 'LemLem Trading',
      title: 'Smartphones for Q4 retail — 240 units across 3 models', categoryId: 'cat_phones',
      lines: [
        { productId: 'p_001', description: 'Samsung Galaxy A55 5G 128GB, 8GB RAM, sealed', targetQty: 120, unit: 'pcs', targetPrice: 2720000 },
        { productId: 'p_002', description: 'Tecno Spark 30 Pro 256GB, 8GB RAM', targetQty: 80, unit: 'pcs', targetPrice: 1890000 },
        { description: 'Entry-level 5G handset, 128GB, brand-agnostic acceptable', targetQty: 40, unit: 'pcs', targetPrice: 1350000 },
      ],
      deliveryWindow: { from: daysAhead(12), to: daysAhead(26) }, destination: 'Addis Ababa · Bole warehouse',
      incoterm: 'd2d', terms: 'credit_net30', status: 'quoting', invitedSellerIds: 'all', quotes: 3,
      bestPrice: 65120000, expiresAt: daysAhead(4), createdAt: daysAgo(6), notes: 'Must be sealed with local warranty. Split delivery across two batches acceptable. Payment on 30-day terms against our trade account.',
    },
    {
      id: 'rfq_2', code: 'RFQ-02034', buyerOrgId: 'org_habesha', buyerOrgName: 'Habesha Retail Group',
      title: 'Monthly staples — teff, mitmita, coffee, 3 pallets', categoryId: 'cat_spices',
      lines: [
        { productId: 'p_015', description: 'Spiced mitmita teff flour 5kg — 60 sacks', targetQty: 60, unit: 'sacks', targetPrice: 90000 },
        { productId: 'p_027', description: 'Whole wheat flour 25kg sack — 20 sacks', targetQty: 20, unit: 'sacks', targetPrice: 176000 },
        { productId: 'p_013', description: 'Yirgacheffe washed beans 1kg — retail packs', targetQty: 60, unit: 'kg', targetPrice: 45000 },
      ],
      deliveryWindow: { from: daysAhead(5), to: daysAhead(12) }, destination: 'Adama · store warehouse',
      incoterm: 'd2d', terms: 'prepaid', status: 'open', invitedSellerIds: ['org_addis', 'org_bulkmart'], quotes: 1,
      expiresAt: daysAhead(2), createdAt: daysAgo(2), notes: 'Deliver to our Adama warehouse. We need the tax invoice with our TIN on it for the books.',
    },
    {
      id: 'rfq_3', code: 'RFQ-02028', buyerOrgId: 'org_lemlem', buyerOrgName: 'LemLem Trading',
      title: 'Laptops for branch staff — 40 units, business spec', categoryId: 'cat_laptops',
      lines: [
        { productId: 'p_006', description: 'i7 / 16GB / 512GB business laptop with 3-year warranty', targetQty: 25, unit: 'pcs', targetPrice: 4550000 },
        { productId: 'p_007', description: 'Ryzen 5 / 16GB / 512GB laptop', targetQty: 15, unit: 'pcs', targetPrice: 2180000 },
      ],
      deliveryWindow: { from: daysAhead(8), to: daysAhead(20) }, destination: 'Addis Ababa · Bole warehouse',
      incoterm: 'd2d', terms: 'credit_net30', status: 'awarded', invitedSellerIds: ['org_selam', 'org_fbab'], quotes: 2,
      bestPrice: 144550000, expiresAt: daysAgo(1), createdAt: daysAgo(14),
      awardedQuoteId: 'qt_3', notes: 'Need on-site warranty support in Addis. Prefer a single supplier for the whole batch.',
    },
    {
      id: 'rfq_4', code: 'RFQ-02035', buyerOrgId: 'org_habesha', buyerOrgName: 'Habesha Retail Group',
      title: 'Janitorial and packaging supplies for 4 stores', categoryId: 'cat_bulk',
      lines: [
        { productId: 'p_026', description: 'Industrial degreaser 20L', targetQty: 24, unit: 'units', targetPrice: 138000 },
        { productId: 'p_025', description: 'Shipping boxes 40x30x30, 25 pcs per bundle', targetQty: 120, unit: 'bundles', targetPrice: 30000 },
        { productId: 'p_028', description: 'Nitrile gloves, 1000 pcs per case', targetQty: 20, unit: 'cases', targetPrice: 92000 },
      ],
      deliveryWindow: { from: daysAhead(7), to: daysAhead(18) }, destination: 'Adama + 3 branch stores',
      incoterm: 'd2d', terms: 'credit_net30', status: 'negotiating', invitedSellerIds: ['org_bulkmart'], quotes: 1,
      expiresAt: daysAhead(3), createdAt: daysAgo(9), notes: 'Split delivery across four stores is fine. Consolidate into one invoice please.',
    },
    {
      id: 'rfq_5', code: 'RFQ-02026', buyerOrgId: 'org_lemlem', buyerOrgName: 'LemLem Trading',
      title: 'Diapers — quarterly replenishment, size 4 and 5', categoryId: 'cat_diapers',
      lines: [{ productId: 'p_021', description: 'Extra absorbent diapers size 4, 240-count case', targetQty: 100, unit: 'cases', targetPrice: 372000 }],
      deliveryWindow: { from: daysAgo(10), to: daysAgo(2) }, destination: 'Addis Ababa · Bole warehouse',
      incoterm: 'd2d', terms: 'credit_net30', status: 'closed', invitedSellerIds: 'all', quotes: 4,
      bestPrice: 37200000, expiresAt: daysAgo(6), createdAt: daysAgo(20), awardedQuoteId: 'qt_1',
    },
    {
      id: 'rfq_6', code: 'RFQ-02036', buyerOrgId: 'org_lemlem', buyerOrgName: 'LemLem Trading',
      title: 'Sunscreen and skincare range for our beauty shelf', categoryId: 'cat_skincare',
      lines: [
        { productId: 'p_019', description: 'Mineral sunscreen SPF 50 75ml', targetQty: 200, unit: 'pcs', targetPrice: 15200 },
        { productId: 'p_018', description: 'Ceramide moisturiser 50ml', targetQty: 150, unit: 'pcs', targetPrice: 11400 },
      ],
      deliveryWindow: { from: daysAhead(15), to: daysAhead(30) }, destination: 'Addis Ababa · Bole warehouse',
      incoterm: 'd2d', terms: 'prepaid', status: 'open', invitedSellerIds: ['org_glow'], quotes: 0,
      expiresAt: daysAhead(6), createdAt: daysAgo(1), notes: 'We want a shelf-ready display carton with each case.',
    },
  ];

  const quotations: Quotation[] = [
    {
      id: 'qt_1', code: 'QT-04510', rfqId: 'rfq_5', sellerId: 'org_kidsworld', sellerName: 'Kids World Trading',
      status: 'accepted',
      lines: [
        { id: 'ql_1', description: 'Extra absorbent diapers size 4, 240-count case', qty: 100, unitPrice: 372000, leadTimeDays: 7, available: true },
      ],
      subtotal: 37200000, deliveryFee: 180000, tax: 5607000, total: 42987000,
      incoterm: 'D2D Addis Ababa', validityDays: 14, validUntil: daysAgo(6), paymentTerms: 'Net 30 from purchase order',
      revisions: [
        { revision: 1, at: daysAgo(17), author: 'seller', note: 'Initial quote at list price', total: 43548000 },
        { revision: 2, at: daysAgo(15), author: 'buyer', note: 'Counter: 100 cases committed, request volume tier', total: 42987000 },
        { revision: 3, at: daysAgo(14), author: 'seller', note: 'Accepted counter, added delivery to Bole', total: 42987000 },
      ],
      leadTimeDays: 7, message: 'We can hold this price as long as the PO lands within the validity window. Stock is already in the hub.',
      counterHistory: [
        { at: daysAgo(16), by: 'buyer', message: 'What is your best on 100 cases if we commit to a quarterly repeat?', proposedTotal: 42987000 },
        { at: daysAgo(15), by: 'seller', message: 'Can do that. Also we can drop the delivery charge if you pick up from the hub.', proposedTotal: 42807000 },
        { at: daysAgo(14), by: 'buyer', message: 'Keep the delivery, we would rather have it at our door.', proposedTotal: 42987000 },
      ],
      createdAt: daysAgo(17),
    },
    {
      id: 'qt_2', code: 'QT-04512', rfqId: 'rfq_1', sellerId: 'org_selam', sellerName: 'Selam Tech Trading',
      status: 'sent',
      lines: [
        { id: 'ql_2', description: 'Samsung Galaxy A55 5G 128GB, 8GB RAM, sealed', qty: 120, unitPrice: 2740000, leadTimeDays: 10, available: true },
        { id: 'ql_3', description: 'Tecno Spark 30 Pro 256GB, 8GB RAM', qty: 80, unitPrice: 1910000, leadTimeDays: 10, available: true },
        { id: 'ql_4', description: 'Entry-level 5G handset, 128GB', qty: 40, unitPrice: 1420000, leadTimeDays: 14, available: true },
      ],
      subtotal: 490800000, deliveryFee: 900000, tax: 73756500, total: 565456500,
      incoterm: 'D2D Addis Ababa', validityDays: 7, validUntil: daysAhead(1), paymentTerms: 'Net 30, subject to trade account',
      revisions: [
        { revision: 1, at: daysAgo(5), author: 'seller', note: 'Full quantity available, 10-day lead time', total: 565456500 },
        { revision: 2, at: daysAgo(3), author: 'seller', note: 'Added freight line after carrier quote update', total: 565456500 },
      ],
      leadTimeDays: 10, message: 'All three lines are in our Bole warehouse already. We can split delivery into two batches at no extra freight if that helps your cash flow.',
      counterHistory: [{ at: daysAgo(3), by: 'buyer', message: 'Can you meet 2,700,000 on the A55 if we take all 240 units?' }],
      createdAt: daysAgo(5),
    },
    {
      id: 'qt_3', code: 'QT-04508', rfqId: 'rfq_3', sellerId: 'org_selam', sellerName: 'Selam Tech Trading',
      status: 'accepted',
      lines: [
        { id: 'ql_5', description: 'i7 / 16GB / 512GB business laptop, 3-year warranty', qty: 25, unitPrice: 4480000, leadTimeDays: 12, available: true },
        { id: 'ql_6', description: 'Ryzen 5 / 16GB / 512GB laptop', qty: 15, unitPrice: 2210000, leadTimeDays: 9, available: true },
      ],
      subtotal: 145150000, deliveryFee: 600000, tax: 21817500, total: 167167500,
      incoterm: 'D2D Addis Ababa', validityDays: 10, validUntil: daysAgo(1), paymentTerms: 'Net 30 from purchase order',
      revisions: [
        { revision: 1, at: daysAgo(12), author: 'seller', note: 'Single-supplier quote with onsite warranty included', total: 167167500 },
        { revision: 2, at: daysAgo(10), author: 'buyer', note: 'Counter: met the price on the Ryzen line but asked for the 3-year warranty to be included at no extra cost', total: 166230000 },
        { revision: 3, at: daysAgo(9), author: 'seller', note: 'Met the counter, kept 3-year warranty on all units', total: 166230000 },
      ],
      leadTimeDays: 12, message: 'Onsite warranty registration is included for all 40 units. We will deploy a technician to your branches during the first month.',
      counterHistory: [
        { at: daysAgo(10), by: 'buyer', message: 'We need 2,200,000 on the Ryzen line to make this work.', proposedTotal: 166230000 },
        { at: daysAgo(9), by: 'seller', message: 'Done. Warranty stays at 3 years on all units.', proposedTotal: 166230000 },
      ],
      createdAt: daysAgo(12),
    },
    {
      id: 'qt_4', code: 'QT-04513', rfqId: 'rfq_1', sellerId: 'org_medina', sellerName: 'Medina Electronics PLC',
      status: 'sent',
      lines: [
        { id: 'ql_7', description: 'Samsung Galaxy A55 5G 128GB, 8GB RAM, sealed', qty: 120, unitPrice: 2685000, leadTimeDays: 18, available: true },
        { id: 'ql_8', description: 'Tecno Spark 30 Pro 256GB, 8GB RAM', qty: 80, unitPrice: 1880000, leadTimeDays: 18, available: false },
      ],
      subtotal: 472600000, deliveryFee: 2400000, tax: 71250000, total: 546250000,
      incoterm: 'D2D Addis Ababa', validityDays: 5, validUntil: daysAhead(1), paymentTerms: '50% advance, 50% on delivery',
      revisions: [{ revision: 1, at: daysAgo(4), author: 'seller', note: 'Competitive on A55, but Spark line is out of stock until next month', total: 546250000 }],
      leadTimeDays: 18, message: 'We can beat everyone on the A55 line. The Spark allocation is tight — we can only confirm 40 of the 80 units in this window.',
      counterHistory: [], createdAt: daysAgo(4),
    },
    {
      id: 'qt_5', code: 'QT-04514', rfqId: 'rfq_1', sellerId: 'org_fbab', sellerName: 'HaniMarket Fulfilment Hub',
      status: 'sent',
      lines: [
        { id: 'ql_9', description: 'Samsung Galaxy A55 5G 128GB, 8GB RAM, sealed', qty: 120, unitPrice: 2795000, leadTimeDays: 5, available: true },
        { id: 'ql_10', description: 'Tecno Spark 30 Pro 256GB, 8GB RAM', qty: 80, unitPrice: 1950000, leadTimeDays: 5, available: true },
        { id: 'ql_11', description: 'Entry-level 5G handset, 128GB', qty: 40, unitPrice: 1460000, leadTimeDays: 5, available: true },
      ],
      subtotal: 500600000, deliveryFee: 0, tax: 75090000, total: 575690000,
      incoterm: 'D2D Addis Ababa', validityDays: 10, validUntil: daysAhead(5), paymentTerms: 'Net 30, or net 15 for 2% discount',
      revisions: [{ revision: 1, at: daysAgo(3), author: 'seller', note: 'All lines pooled in the hub, 5-day turnaround, free freight', total: 575690000 }],
      leadTimeDays: 5, message: 'Everything is already in the Bole hub, so we can turn this around in five days. Free freight inside Addis on orders this size.',
      counterHistory: [], createdAt: daysAgo(3),
    },
    {
      id: 'qt_6', code: 'QT-04515', rfqId: 'rfq_2', sellerId: 'org_addis', sellerName: 'Addis Coffee Estate',
      status: 'sent',
      lines: [
        { id: 'ql_12', description: 'Spiced mitmita teff flour 5kg — 60 sacks', qty: 60, unitPrice: 92000, leadTimeDays: 6, available: true },
        { id: 'ql_13', description: 'Yirgacheffe washed beans 1kg — retail packs', qty: 60, unitPrice: 45500, leadTimeDays: 3, available: true },
      ],
      subtotal: 8250000, deliveryFee: 220000, tax: 1270500, total: 9740500,
      incoterm: 'D2D Adama', validityDays: 7, validUntil: daysAhead(3), paymentTerms: 'Prepaid, or net 15 on approved account',
      revisions: [{ revision: 1, at: daysAgo(1), author: 'seller', note: 'Milling slot reserved for your delivery window', total: 9740500 }],
      leadTimeDays: 6, message: 'We have reserved a milling slot for your 60 sacks. Beans are roasted Tuesday and will be packed fresh.',
      counterHistory: [], createdAt: daysAgo(1),
    },
    {
      id: 'qt_7', code: 'QT-04516', rfqId: 'rfq_4', sellerId: 'org_bulkmart', sellerName: 'BulkMart Trading PLC',
      status: 'revising',
      lines: [
        { id: 'ql_14', description: 'Industrial degreaser 20L', qty: 24, unitPrice: 139000, leadTimeDays: 8, available: true },
        { id: 'ql_15', description: 'Shipping boxes 40x30x30, 25 pcs per bundle', qty: 120, unitPrice: 29800, leadTimeDays: 5, available: true },
        { id: 'ql_16', description: 'Nitrile gloves, 1000 pcs per case', qty: 20, unitPrice: 94000, leadTimeDays: 12, available: true },
      ],
      subtotal: 7846000, deliveryFee: 480000, tax: 1248900, total: 9574900,
      incoterm: 'D2D Adama + branches', validityDays: 10, validUntil: daysAhead(6), paymentTerms: 'Net 30, consolidated monthly invoice',
      revisions: [
        { revision: 1, at: daysAgo(7), author: 'seller', note: 'Pallet pricing, split delivery included', total: 9574900 },
        { revision: 2, at: daysAgo(4), author: 'buyer', note: 'Counter: consolidate to one delivery and reduce the price to ETB 91,200', total: 9120000 },
      ],
      leadTimeDays: 12, message: 'We can consolidate into a single delivery to your Adama warehouse at a lower freight cost, but that means your three branches wait for the full run.',
      counterHistory: [
        { at: daysAgo(5), by: 'buyer', message: 'We would rather have one delivery. What is the single-drop price?', proposedTotal: 9120000 },
        { at: daysAgo(4), by: 'seller', message: 'Reviewing with the warehouse team, will come back tomorrow.', proposedTotal: 9120000 },
      ],
      createdAt: daysAgo(7),
    },
  ];

  const pos: PurchaseOrder[] = [
    {
      id: 'po_1', code: 'PO-00912', quotationId: 'qt_1', quoteCode: 'QT-04510', buyerOrgId: 'org_lemlem', buyerOrgName: 'LemLem Trading',
      sellerId: 'org_kidsworld', sellerName: 'Kids World Trading', status: 'settled',
      lines: [{ id: 'pl_1', description: 'Extra absorbent diapers size 4, 240-count case', qty: 100, unitPrice: 372000, leadTimeDays: 7, available: true }],
      subtotal: 37200000, deliveryFee: 180000, tax: 5607000, total: 42987000, terms: 'Net 30',
      deliveryWindow: { from: daysAgo(12), to: daysAgo(6) }, destination: 'Addis Ababa · Bole warehouse', incoterm: 'D2D',
      issuedAt: daysAgo(16), expectedAt: daysAgo(6), progressPct: 100, invoiceId: 'inv_1', receivableDueAt: daysAgo(1),
    },
    {
      id: 'po_2', code: 'PO-00914', quotationId: 'qt_3', quoteCode: 'QT-04508', buyerOrgId: 'org_lemlem', buyerOrgName: 'LemLem Trading',
      sellerId: 'org_selam', sellerName: 'Selam Tech Trading', status: 'in_production',
      lines: [
        { id: 'pl_2', description: 'i7 / 16GB / 512GB business laptop, 3-year warranty', qty: 25, unitPrice: 4480000, leadTimeDays: 12, available: true },
        { id: 'pl_3', description: 'Ryzen 5 / 16GB / 512GB laptop', qty: 15, unitPrice: 2210000, leadTimeDays: 9, available: true },
      ],
      subtotal: 145150000, deliveryFee: 600000, tax: 21817500, total: 166230000, terms: 'Net 30',
      deliveryWindow: { from: daysAgo(4), to: daysAhead(8) }, destination: 'Addis Ababa · Bole warehouse', incoterm: 'D2D',
      issuedAt: daysAgo(9), expectedAt: daysAhead(8), progressPct: 35,
    },
    {
      id: 'po_3', code: 'PO-00908', quotationId: 'qt_1', quoteCode: 'QT-04510', buyerOrgId: 'org_habesha', buyerOrgName: 'Habesha Retail Group',
      sellerId: 'org_addis', sellerName: 'Addis Coffee Estate', status: 'shipped',
      lines: [
        { id: 'pl_4', description: 'Yirgacheffe washed beans 1kg, 40 cases', qty: 40, unitPrice: 44000, leadTimeDays: 4, available: true },
        { id: 'pl_5', description: 'Spiced mitmita 5kg, 12 sacks', qty: 12, unitPrice: 91000, leadTimeDays: 6, available: true },
      ],
      subtotal: 2852000, deliveryFee: 120000, tax: 445800, total: 3417800, terms: 'Prepaid',
      deliveryWindow: { from: daysAgo(3), to: daysAhead(1) }, destination: 'Adama · store warehouse', incoterm: 'D2D',
      issuedAt: daysAgo(11), expectedAt: daysAhead(1), progressPct: 80, invoiceId: 'inv_3',
    },
    {
      id: 'po_4', code: 'PO-00916', quotationId: 'qt_5', quoteCode: 'QT-04515', buyerOrgId: 'org_lemlem', buyerOrgName: 'LemLem Trading',
      sellerId: 'org_fbab', sellerName: 'HaniMarket Fulfilment Hub', status: 'issued',
      lines: [{ id: 'pl_6', description: 'Mineral sunscreen SPF 50 75ml, shelf-ready cases', qty: 200, unitPrice: 15200, leadTimeDays: 5, available: true }],
      subtotal: 3040000, deliveryFee: 0, tax: 456000, total: 3496000, terms: 'Net 15 (2% discount applied)',
      deliveryWindow: { from: daysAhead(5), to: daysAhead(12) }, destination: 'Addis Ababa · Bole warehouse', incoterm: 'D2D',
      issuedAt: daysAgo(1), expectedAt: daysAhead(12), progressPct: 0,
    },
  ];

  const invoices: Invoice[] = [
    { id: 'inv_1', code: 'INV-09120', poId: 'po_1', poCode: 'PO-00912', buyerOrgId: 'org_lemlem', sellerId: 'org_kidsworld', sellerName: 'Kids World Trading', amount: 42987000, tax: 5607000, status: 'paid', issuedAt: daysAgo(13), dueAt: daysAgo(1), paidAt: daysAgo(2), term: 'Net 30', fiscalReceiptNo: 'FR-70812' },
    { id: 'inv_2', code: 'INV-09134', poId: 'po_2', poCode: 'PO-00914', buyerOrgId: 'org_lemlem', sellerId: 'org_selam', sellerName: 'Selam Tech Trading', amount: 166230000, tax: 21817500, status: 'issued', issuedAt: daysAgo(3), dueAt: daysAhead(27), term: 'Net 30', fiscalReceiptNo: 'FR-70944' },
    { id: 'inv_3', code: 'INV-09131', poId: 'po_3', poCode: 'PO-00908', buyerOrgId: 'org_habesha', sellerId: 'org_addis', sellerName: 'Addis Coffee Estate', amount: 3417800, tax: 445800, status: 'issued', issuedAt: daysAgo(2), dueAt: daysAhead(12), term: 'Prepaid', fiscalReceiptNo: 'FR-70931' },
    { id: 'inv_4', code: 'INV-09118', poId: 'po_1', poCode: 'PO-00908', buyerOrgId: 'org_habesha', sellerId: 'org_addis', sellerName: 'Addis Coffee Estate', amount: 1890000, tax: 247350, status: 'overdue', issuedAt: daysAgo(48), dueAt: daysAgo(12), term: 'Net 30', fiscalReceiptNo: 'FR-70418' },
    { id: 'inv_5', code: 'INV-09140', poId: 'po_3', poCode: 'PO-00910', buyerOrgId: 'org_habesha', sellerId: 'org_bulkmart', sellerName: 'BulkMart Trading PLC', amount: 7420000, tax: 993300, status: 'partially_paid', issuedAt: daysAgo(20), dueAt: daysAgo(5), term: 'Net 30', fiscalReceiptNo: 'FR-70720' },
  ];

  const creditAssessments: CreditAssessment[] = [
    { orgId: 'org_lemlem', orgName: 'LemLem Trading', tier: 'net30', limit: 250000000, used: 166230000, available: 83770000, paymentHistoryScore: 92, ordersSettled: 14, avgDaysToPay: 27, assessedAt: daysAgo(30), notes: '14 purchase orders settled, 13 on time. No write-offs. Limit raised to ETB 2.5M at the last review.' },
    { orgId: 'org_habesha', orgName: 'Habesha Retail Group', tier: 'cash_only', limit: 0, used: 0, available: 0, paymentHistoryScore: 58, ordersSettled: 4, avgDaysToPay: 44, assessedAt: daysAgo(21), notes: 'One overdue invoice at 12 days past due. Credit suspended until the balance clears and two more prepaid orders settle cleanly. Reassess in 30 days.' },
  ];

  const suppliers: Supplier[] = [
    { id: 'sup_1', sellerId: 'org_selam', name: 'Horizon Electronics FZE', contactName: 'Rashid Al Nuaimi', phone: '+971501234567', email: 'orders@horizon.ae', city: 'Dubai, UAE', paymentTerms: '30% advance, 70% against BOL', totalSpend: 184000000, openOrders: 2, rating: 4.6, since: daysAgo(430), itemsSupplied: ['Smartphones', 'Laptops', 'Audio'] },
    { id: 'sup_2', sellerId: 'org_selam', name: 'Addis Freight Forwarders', contactName: 'Mekonnen Taye', phone: '+251911000444', email: 'ops@addisfreight.et', city: 'Addis Ababa', paymentTerms: 'Net 15', totalSpend: 12400000, openOrders: 1, rating: 4.2, since: daysAgo(400), itemsSupplied: ['Air freight', 'Customs clearance'] },
    { id: 'sup_3', sellerId: 'org_habesha_home', name: 'Akaki Timber Works', contactName: 'Getachew Mengiste', phone: '+251911000555', email: 'sales@akakitimber.et', city: 'Akaki Kality', paymentTerms: 'Net 30', totalSpend: 42600000, openOrders: 1, rating: 4.8, since: daysAgo(380), itemsSupplied: ['Teak and hardwood', 'Veneer'] },
    { id: 'sup_4', sellerId: 'org_addis', name: 'Bule Hora Washing Station Cooperative', contactName: 'Temesgen Bekele', phone: '+251911000666', email: 'coop@buhhora.et', city: 'Bule Hora, Sidama', paymentTerms: 'On delivery', totalSpend: 68000000, openOrders: 3, rating: 4.9, since: daysAgo(270), itemsSupplied: ['Green coffee cherries', 'Natural process lots'] },
    { id: 'sup_5', sellerId: 'org_addis', name: 'Sidama Packaging Supplies', contactName: 'Alemu Garo', phone: '+251911000777', email: 'sales@sidamapack.et', city: 'Hawassa', paymentTerms: 'Net 30', totalSpend: 8200000, openOrders: 0, rating: 4.3, since: daysAgo(240), itemsSupplied: ['Valve bags', 'Export cartons'] },
    { id: 'sup_6', sellerId: 'org_glow', name: 'Seoul Beauty Group', contactName: 'Ji-woo Park', phone: '+821012345678', email: 'export@seoulbeauty.kr', city: 'Seoul, South Korea', paymentTerms: 'Irrevocable LC at sight', totalSpend: 31000000, openOrders: 1, rating: 4.4, since: daysAgo(150), itemsSupplied: ['Skincare', 'Haircare'] },
    { id: 'sup_7', sellerId: 'org_bulkmart', name: 'Habesha Millers PLC', contactName: 'Selam Kebede', phone: '+251911000888', email: 'sales@habeshamillers.et', city: 'Debre Libanos', paymentTerms: 'Net 45', totalSpend: 54000000, openOrders: 2, rating: 4.5, since: daysAgo(700), itemsSupplied: ['Flour', 'Teff products', 'Spices'] },
    { id: 'sup_8', sellerId: 'org_bulkmart', name: 'Eastern Packaging Industries', contactName: 'Chen Wei', phone: '+251911000333', email: 'export@easternpack.cn', city: 'Ningbo, China', paymentTerms: '30% deposit, 70% BOL', totalSpend: 22000000, openOrders: 1, rating: 3.9, since: daysAgo(500), itemsSupplied: ['Corrugated boxes', 'Bubble wrap', 'Tape'] },
    { id: 'sup_9', sellerId: 'org_kichen', name: 'Merkato Textiles PLC', contactName: 'Kidist Alemayehu', phone: '+251911000222', email: 'sales@merkatotextile.et', city: 'Addis Ababa', paymentTerms: 'Net 30', totalSpend: 18600000, openOrders: 0, rating: 4.1, since: daysAgo(340), itemsSupplied: ['Wax print fabric', 'Handloom cotton'] },
    { id: 'sup_10', sellerId: 'org_motors', name: 'Toyota Ethiopia Genuine Parts', contactName: 'Dawit Fikru', phone: '+251911000111', email: 'parts@toyota.et', city: 'Addis Ababa', paymentTerms: 'Net 15', totalSpend: 9600000, openOrders: 1, rating: 4.7, since: daysAgo(380), itemsSupplied: ['OEM brake pads', 'Filters', 'Belts'] },
  ];

  const procurementOrders: ProcurementOrder[] = [
    { id: 'pr_1', code: 'PP-0031', sellerId: 'org_selam', supplierId: 'sup_1', supplierName: 'Horizon Electronics FZE', status: 'issued', lines: [{ id: 'prl_1', description: 'Samsung Galaxy A55 5G — 500 units', qty: 500, unitCost: 2410000, receivedQty: 0 }, { id: 'prl_2', description: 'JBL Tune 770NC — 300 units', qty: 300, unitCost: 298000, receivedQty: 0 }], total: 1294000000, issuedAt: daysAgo(24), expectedAt: daysAhead(9), notes: 'Shipment AWB 774-992011. Awaiting Bill of Lading.' },
    { id: 'pr_2', code: 'PP-0033', sellerId: 'org_selam', supplierId: 'sup_1', supplierName: 'Horizon Electronics FZE', status: 'received', lines: [{ id: 'prl_3', description: 'HP EliteBook 840 G9 — 80 units', qty: 80, unitCost: 4180000, receivedQty: 80 }], total: 334400000, issuedAt: daysAgo(52), expectedAt: daysAgo(28), receivedAt: daysAgo(27), notes: 'All 80 units passed incoming QC. 2 units with screen defects returned via RMA.' },
    { id: 'pr_3', code: 'PP-0029', sellerId: 'org_addis', supplierId: 'sup_4', supplierName: 'Bule Hora Washing Station Cooperative', status: 'acknowledged', lines: [{ id: 'prl_4', description: 'Yirgacheffe G1 washed — 1,200 kg green', qty: 1200, unitCost: 42000, receivedQty: 0 }], total: 50400000, issuedAt: daysAgo(6), expectedAt: daysAhead(18), notes: 'Cooperative confirmed the lot. Prepayment sent against LC.' },
    { id: 'pr_4', code: 'PP-0027', sellerId: 'org_habesha_home', supplierId: 'sup_3', supplierName: 'Akaki Timber Works', status: 'partially_received', lines: [{ id: 'prl_5', description: 'Kiln-dried teak boards — 3 m³', qty: 3, unitCost: 420000, receivedQty: 2 }, { id: 'prl_6', description: 'Brass furniture fittings — 200 sets', qty: 200, unitCost: 1850, receivedQty: 200 }], total: 1637000, issuedAt: daysAgo(18), expectedAt: daysAhead(4), notes: 'Fittings fully received. One cubic metre of teff still at the workshop being kiln-dried.' },
    { id: 'pr_5', code: 'PP-0035', sellerId: 'org_bulkmart', supplierId: 'sup_8', supplierName: 'Eastern Packaging Industries', status: 'draft', lines: [{ id: 'prl_7', description: 'Corrugated boxes 40x30x30 — 5,000 pcs', qty: 5000, unitCost: 1150, receivedQty: 0 }, { id: 'prl_8', description: 'Bubble roll 1.2m x 100m — 200 rolls', qty: 200, unitCost: 2400, receivedQty: 0 }], total: 6230000, issuedAt: daysAhead(-3), expectedAt: daysAhead(32), notes: 'Waiting on revised unit cost from the supplier before issuing.' },
    { id: 'pr_6', code: 'PP-0024', sellerId: 'org_bulkmart', supplierId: 'sup_7', supplierName: 'Habesha Millers PLC', status: 'received', lines: [{ id: 'prl_9', description: 'Whole wheat flour 25kg — 400 sacks', qty: 400, unitCost: 158000, receivedQty: 400 }], total: 63200000, issuedAt: daysAgo(40), expectedAt: daysAgo(22), receivedAt: daysAgo(22) },
  ];

  const expenseCats: [Expense['category'], string, number, Expense['recurrence'], string][] = [
    ['rent', 'Shop rent — Bole', 4500000, 'monthly', 'Monthly, paid by the 5th'],
    ['rent', 'Warehouse rent — Akaki', 2200000, 'monthly', 'Monthly, paid by the 1st'],
    ['utilities', 'Electricity — commercial tariff', 185000, 'monthly', 'Monthly, metered'],
    ['utilities', 'Water and sanitation', 24000, 'monthly', 'Monthly'],
    ['salary', 'Sales staff payroll', 1680000, 'monthly', 'Monthly, 6 staff'],
    ['salary', 'Warehouse staff payroll', 940000, 'monthly', 'Monthly, 4 staff'],
    ['transport', 'Delivery van fuel and maintenance', 320000, 'monthly', 'Monthly'],
    ['marketing', 'HaniMarket sponsored listings', 180000, 'monthly', 'Monthly, prepaid'],
    ['packaging', 'Packaging and tape', 76000, 'monthly', 'Monthly'],
    ['subscription', 'HaniMarket seller subscription', 49900, 'monthly', 'Monthly, Professional plan'],
    ['subscription', 'Accounting software', 1400, 'monthly', 'Monthly'],
    ['tax', 'Quarterly turnover tax', 1240000, 'quarterly', 'Quarterly, ETA deadline'],
    ['marketing', 'Addis Fashion Fair booth', 850000, null, 'One-off, already paid'],
    ['other', 'Office supplies and printing', 18500, 'monthly', 'Monthly'],
  ];

  const expenses: Expense[] = expenseCats.map(([category, label, amount, recurrence, note], i) => ({
    id: `exp_${i + 1}`,
    sellerId: i % 3 === 0 ? 'org_selam' : i % 3 === 1 ? 'org_habesha_home' : 'org_addis',
    category,
    label: `${label} — ${note}`,
    amount,
    incurredAt: daysAgo((i * 3) % 28 + 1),
    recurring: recurrence !== null,
    recurrence,
    nextDueAt: recurrence !== null ? daysAhead(((i * 5) % 28) + 1) : undefined,
    status: i % 5 === 0 ? 'accrued' : i % 7 === 0 ? 'recorded' : 'paid',
    vendor: category === 'rent' ? 'Bole Properties PLC' : category === 'subscription' && label.startsWith('HaniMarket') ? 'HaniMarket' : undefined,
  }));

  const employees: Employee[] = [
    { id: 'emp_1', sellerId: 'org_selam', name: 'Meron Tadesse', role: 'Sales manager', phone: '+251911000211', monthlySalary: 42000, hiredAt: daysAgo(300), status: 'active', monthlyPayroll: 42000, department: 'sales' },
    { id: 'emp_2', sellerId: 'org_selam', name: 'Dawit Fikru', role: 'Store supervisor', phone: '+251911000212', monthlySalary: 28000, hiredAt: daysAgo(220), status: 'active', monthlyPayroll: 28000, department: 'sales' },
    { id: 'emp_3', sellerId: 'org_selam', name: 'Saron Alemu', role: 'Warehouse lead', phone: '+251911000213', monthlySalary: 26000, hiredAt: daysAgo(180), status: 'active', monthlyPayroll: 26000, department: 'warehouse' },
    { id: 'emp_4', sellerId: 'org_selam', name: 'Yonas Kassa', role: 'Logistics coordinator', phone: '+251911000214', monthlySalary: 24000, hiredAt: daysAgo(90), status: 'active', monthlyPayroll: 24000, department: 'operations' },
    { id: 'emp_5', sellerId: 'org_selam', name: 'Hana Mekonnen', role: 'Customer support', phone: '+251911000215', monthlySalary: 18000, hiredAt: daysAgo(40), status: 'active', monthlyPayroll: 18000, department: 'sales' },
    { id: 'emp_6', sellerId: 'org_selam', name: 'Nahom Girma', role: 'Accounts clerk', phone: '+251911000216', monthlySalary: 22000, hiredAt: daysAgo(310), status: 'on_leave', monthlyPayroll: 22000, department: 'admin' },
    { id: 'emp_7', sellerId: 'org_habesha_home', name: 'Getachew Mengiste', role: 'Workshop master', phone: '+251911000217', monthlySalary: 34000, hiredAt: daysAgo(280), status: 'active', monthlyPayroll: 34000, department: 'production' },
    { id: 'emp_8', sellerId: 'org_habesha_home', name: 'Tigist Haile', role: 'Showroom attendant', phone: '+251911000218', monthlySalary: 16000, hiredAt: daysAgo(150), status: 'active', monthlyPayroll: 16000, department: 'sales' },
    { id: 'emp_9', sellerId: 'org_addis', name: 'Temesgen Bekele', role: 'Quality manager', phone: '+251911000219', monthlySalary: 39000, hiredAt: daysAgo(250), status: 'active', monthlyPayroll: 39000, department: 'production' },
    { id: 'emp_10', sellerId: 'org_addis', name: 'Bethel Girma', role: 'Roaster', phone: '+251911000220', monthlySalary: 24000, hiredAt: daysAgo(120), status: 'active', monthlyPayroll: 24000, department: 'production' },
    { id: 'emp_11', sellerId: 'org_addis', name: 'Dawit Alemu', role: 'Dispatch', phone: '+251911000221', monthlySalary: 18000, hiredAt: daysAgo(60), status: 'active', monthlyPayroll: 18000, department: 'operations' },
    { id: 'emp_12', sellerId: 'org_bulkmart', name: 'Ashenafi Tefera', role: 'Procurement officer', phone: '+251911000223', monthlySalary: 33000, hiredAt: daysAgo(320), status: 'active', monthlyPayroll: 33000, department: 'admin' },
  ];

  const batches: ProductionBatch[] = [
    {
      id: 'bt_1', code: 'BATCH-CO-114', sellerId: 'org_addis', productId: 'p_013', productTitle: 'Yirgacheffe Washed Coffee Beans — 1kg',
      status: 'in_production', plannedQty: 400, producedQty: 260, scrappedQty: 12,
      bom: [{ id: 'b1', component: 'Green coffee, G1 washed', qtyPerUnit: 1000, unitCost: 42000 }, { id: 'b2', component: 'Valve bag + valve', qtyPerUnit: 1, unitCost: 380 }, { id: 'b3', component: 'Roasting (gas + labour)', qtyPerUnit: 1, unitCost: 1650 }],
      startedAt: daysAgo(3), yieldPct: 95.6, unitCost: 44030,
    },
    {
      id: 'bt_2', code: 'BATCH-CO-113', sellerId: 'org_addis', productId: 'p_012', productTitle: 'Buna Craft Pour-Over Coffee Set',
      status: 'quality_check', plannedQty: 250, producedQty: 250, scrappedQty: 9,
      bom: [{ id: 'b4', component: 'Borosilicate carafe', qtyPerUnit: 1, unitCost: 6200 }, { id: 'b5', component: 'Ceramic dripper', qtyPerUnit: 1, unitCost: 2400 }, { id: 'b6', component: 'Steel filter + packaging', qtyPerUnit: 1, unitCost: 1900 }],
      startedAt: daysAgo(9), yieldPct: 96.4, unitCost: 10500,
    },
    {
      id: 'bt_3', code: 'BATCH-HH-088', sellerId: 'org_habesha_home', productId: 'p_010', productTitle: 'Handwoven Ethiopian Cotton Throw Blanket (Qobo)',
      status: 'completed', plannedQty: 150, producedQty: 154, scrappedQty: 4,
      bom: [{ id: 'b7', component: 'Ethiopian cotton yarn, undyed', qtyPerUnit: 2.4, unitCost: 9600 }, { id: 'b8', component: 'Handloom labour', qtyPerUnit: 1, unitCost: 11500 }, { id: 'b9', component: 'Weaver cooperative fee', qtyPerUnit: 1, unitCost: 4000 }],
      startedAt: daysAgo(24), completedAt: daysAgo(4), yieldPct: 97.4, unitCost: 25100,
    },
    {
      id: 'bt_4', code: 'BATCH-HH-089', sellerId: 'org_habesha_home', productId: 'p_011', productTitle: 'Solid Teak Wood Dining Table — 6 seater',
      status: 'planned', plannedQty: 40, producedQty: 0, scrappedQty: 0,
      bom: [{ id: 'b10', component: 'Kiln-dried teak boards', qtyPerUnit: 1, unitCost: 168000 }, { id: 'b11', component: 'Joinery labour', qtyPerUnit: 1, unitCost: 42000 }, { id: 'b12', component: 'Brass fittings + oil finish', qtyPerUnit: 1, unitCost: 14000 }],
      startedAt: daysAhead(4), yieldPct: 0, unitCost: 224000,
    },
    {
      id: 'bt_5', code: 'BATCH-GB-041', sellerId: 'org_glow', productId: 'p_019', productTitle: 'Mineral Sunscreen SPF 50 — 75ml',
      status: 'completed', plannedQty: 1000, producedQty: 1000, scrappedQty: 22,
      bom: [{ id: 'b13', component: 'Zinc oxide + titanium dioxide blend', qtyPerUnit: 1, unitCost: 3100 }, { id: 'b14', component: 'Packaging, 75ml tube + carton', qtyPerUnit: 1, unitCost: 2200 }, { id: 'b15', component: 'Filling and capping', qtyPerUnit: 1, unitCost: 900 }],
      startedAt: daysAgo(16), completedAt: daysAgo(11), yieldPct: 97.8, unitCost: 6200,
    },
  ];

  return { rfqs, quotations, pos, invoices, creditAssessments, suppliers, procurementOrders, expenses, employees, batches };
}
