/**
 * HaniMarket — shared domain contract.
 * Money is ALWAYS integer minor units (ETB santim, 1 ETB = 100). No floats.
 */

export type Id = string;
export type Minor = number;

export type Role = 'buyer' | 'business_buyer' | 'seller' | 'agent' | 'admin';

export interface User {
  id: Id;
  name: string;
  phone: string;
  email: string;
  role: Role;
  avatarHue: number;
  orgId?: Id;
  city?: string;
  createdAt: string;
  /**
   * A suspended account keeps every record it ever touched — its orders, its
   * reviews, its ledger lines — but can no longer sign in. Suspension is the
   * safe alternative to deletion, and it is reversible.
   */
  suspended?: boolean;
  suspendedAt?: string;
  suspendedReason?: string;
}

/* ------------------------------- Catalog ------------------------------- */

export type ProductCondition = 'new' | 'like_new' | 'refurbished' | 'used';
export type Fulfillment = 'seller_fulfilled' | 'fba' | 'pickup';
export type ListingStatus = 'draft' | 'pending_review' | 'live' | 'rejected' | 'paused';

export interface Category {
  id: Id;
  slug: string;
  name: string;
  nameAm: string;
  icon: string;
  parentId?: Id;
  blurb?: string;
  productCount: number;
  accent: string;
}

export interface Product {
  id: Id;
  slug: string;
  title: string;
  titleAm: string;
  description: string;
  categoryId: Id;
  brand?: string;
  attributes: Record<string, string>;
  images: string[];
  rating: number;
  reviewCount: number;
  soldCount: number;
  viewCount: number;
  tags: string[];
  createdAt: string;
  /** B2B minimum order quantity, null = not sold B2B */
  moq: number | null;
  specSheet?: { label: string; value: string }[];
}

export interface Offer {
  id: Id;
  productId: Id;
  sellerId: Id;
  price: Minor;
  compareAtPrice?: Minor;
  stock: number;
  condition: ProductCondition;
  fulfillment: Fulfillment;
  location: string;
  etaDays: [number, number];
  warranty?: string;
  buyBoxEligible: boolean;
  promoted?: boolean;
  tierPrices?: { minQty: number; price: Minor }[];
  status: ListingStatus;
  rating: number;
  createdAt: string;
}

export interface OfferView extends Offer {
  seller: Pick<Organization, 'id' | 'name' | 'nameAm' | 'slug' | 'city' | 'tier' | 'trustScore' | 'badge' | 'deliverySuccessRate' | 'cancellationRate' | 'responseTimeHours' | 'disputeRate' | 'sales30d'>;
  buyBox: boolean;
  buyBoxReason?: string;
}

export interface ProductView extends Product {
  category: Category;
  offers: OfferView[];
  buyBox: OfferView | null;
  buyBoxReason?: string;
  priceRange: [Minor, Minor];
  inStock: boolean;
  related: ProductSummary[];
}

export interface ProductSummary {
  id: Id;
  slug: string;
  title: string;
  titleAm: string;
  image: string;
  price: Minor;
  compareAtPrice?: Minor;
  rating: number;
  reviewCount: number;
  soldCount: number;
  categoryName: string;
  sellerName?: string;
  badge?: string;
  etaDays?: [number, number];
  promotion?: { label: string; kind: 'percent' | 'fixed'; value: Minor };
}

/* ---------------------------- Organizations ---------------------------- */

export type VerificationTier = 'none' | 'basic' | 'business' | 'trusted' | 'enterprise';

export interface Organization {
  id: Id;
  slug: string;
  name: string;
  nameAm: string;
  type: 'seller' | 'buyer_org';
  city: string;
  region: string;
  tier: VerificationTier;
  trustScore: number;
  rating: number;
  reviewCount: number;
  badge?: 'Prime' | 'Verified' | 'Top Rated' | 'Pro Seller';
  logoText: string;
  hue: number;
  deliverySuccessRate: number;
  cancellationRate: number;
  disputeRate: number;
  responseTimeHours: number;
  sales30d: number;
  joinedAt: string;
  phone: string;
  email: string;
  categories: Id[];
  published: boolean;
  suspended: boolean;
  description: string;
  fulfillmentOwnsFleet?: boolean;
  kyc: {
    status: 'not_started' | 'pending' | 'approved' | 'rejected';
    submittedAt?: string;
    reviewedAt?: string;
    checks: { id: Id; name: string; status: 'pending' | 'pass' | 'fail' | 'waived'; note?: string }[];
    documents: { id: Id; kind: string; file: string; uploadedAt: string }[];
  };
}

/* --------------------------------- Cart -------------------------------- */

export interface CartLine {
  id: Id;
  offerId: Id;
  productId: Id;
  sellerId: Id;
  title: string;
  image: string;
  unitPrice: Minor;
  qty: number;
  stock: number;
  condition: ProductCondition;
  fulfillment: Fulfillment;
  sellerName: string;
  etaDays: [number, number];
  tierPrice?: { minQty: number; price: Minor };
}

export interface CartTotals {
  subtotal: Minor;
  delivery: Minor;
  tax: Minor;
  discount: Minor;
  total: Minor;
  itemCount: number;
  savings: Minor;
}

export interface CartView {
  lines: CartLine[];
  totals: CartTotals;
  deliveryEstimate: { min: number; max: number; fee: Minor };
  codFee: Minor;
}

/* -------------------------------- Orders ------------------------------- */

export type OrderStatus =
  | 'pending_payment'
  | 'confirmed'
  | 'packed'
  | 'shipped'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'refunded'
  | 'disputed';

export type PaymentMethod = 'telebirr' | 'cbe_birr' | 'awash' | 'bank_transfer' | 'cod' | 'credit_net30' | 'credit_net60';

export interface Address {
  id: Id;
  /** Owning account. Absent on seeded rows predating the field. */
  userId?: Id;
  label: string;
  recipient: string;
  phone: string;
  city: string;
  subcity: string;
  woreda: string;
  kebele: string;
  house: string;
  landmark?: string;
  note?: string;
  isDefault?: boolean;
}

export interface OrderLine {
  id: Id;
  productId: Id;
  offerId: Id;
  sellerId: Id;
  title: string;
  titleAm: string;
  image: string;
  qty: number;
  unitPrice: Minor;
  lineTotal: Minor;
  condition: ProductCondition;
  fulfillment: Fulfillment;
  sellerName: string;
}

export interface StatusEvent {
  status: OrderStatus;
  at: string;
  note?: string;
  actor: 'buyer' | 'seller' | 'agent' | 'system' | 'finance';
}

export interface Payment {
  id: Id;
  orderId: Id;
  /** Human-facing order code, denormalised so a provider callback can label the
   * ledger entry it books without a second lookup. */
  orderCode?: string;
  method: PaymentMethod;
  amount: Minor;
  state: 'pending' | 'created' | 'authorized' | 'captured' | 'released' | 'refunded' | 'failed';
  provider: string;
  providerRef: string;
  createdAt: string;
  capturedAt?: string;
  releasedAt?: string;
  idempotencyKey: string;
  fee: Minor;
  codAmount?: Minor;
  /** The ledger entry this payment posted, so a reversal can find it. */
  journalEntryId?: Id;
}

export interface ShipmentEvent {
  id: Id;
  status: string;
  at: string;
  note?: string;
  /** `carrier` means the scan came from the courier's webhook, not from us. */
  actor: 'seller' | 'agent' | 'system' | 'carrier';
  offlineCaptured?: boolean;
}

export interface ProofOfDelivery {
  id: Id;
  kind: 'photo' | 'signature' | 'otp' | 'none';
  capturedBy: string;
  capturedAt: string;
  recipientName?: string;
  photoUrl?: string;
  signatureUrl?: string;
  otpCode?: string;
  syncedFromOffline: boolean;
  geo?: { lat: number; lng: number };
}

export interface Shipment {
  id: Id;
  orderId: Id;
  agentId?: Id;
  partner: 'hanimarket_courier' | 'ethio_post' | 'dhl' | 'ekreta';
  /**
   * The courier's own tracking number. This is the only value that can match an
   * inbound carrier callback, so it is stored as soon as a label is bought and
   * is what `POST /api/webhooks/shipping` correlates on.
   */
  trackingRef?: string;
  zone: string;
  codAmount: Minor;
  status: 'pending' | 'assigned' | 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'failed' | 'returned';
  events: ShipmentEvent[];
  pod?: ProofOfDelivery;
  cashCollected?: Minor;
  cashRemitted?: Minor;
  expectedAt: string;
  deliveredAt?: string;
  attempt: number;
  failureReason?: string;
  codFee: Minor;
}

export interface Order {
  id: Id;
  code: string;
  buyerId: Id;
  buyerName: string;
  status: OrderStatus;
  lines: OrderLine[];
  address: Address;
  addressSnapshotNote?: string;
  subtotal: Minor;
  deliveryFee: Minor;
  tax: Minor;
  discount: Minor;
  total: Minor;
  paymentMethod: PaymentMethod;
  paymentState: Payment['state'];
  paymentId?: Id;
  paid: Minor;
  refunded: Minor;
  channel: 'b2c' | 'b2b';
  poId?: Id;
  settlementId?: Id;
  riskFlags: string[];
  riskScore: number;
  invoiceNo?: string;
  fiscalReceiptNo?: string;
  placedAt: string;
  etaFrom: string;
  etaTo: string;
  history: StatusEvent[];
  shipment?: Shipment;
  canCancel: boolean;
  canReview: boolean;
}

export interface SellerOrder extends Order {
  sellerName: string;
  needsAction: boolean;
}

/* ------------------------------ Promotions ----------------------------- */

export interface Promotion {
  id: Id;
  code: string;
  kind: 'percent' | 'fixed' | 'freeship';
  value: number;
  minSubtotal: Minor;
  startsAt: string;
  endsAt: string;
  appliesToSellerIds: Id[] | 'all';
  description: string;
  active: boolean;
  usedCount: number;
  budget: Minor;
  perUserLimit: number;
  minDeliveryDays?: number;
}

/* --------------------------------- B2B --------------------------------- */

export type RfqStatus = 'draft' | 'open' | 'quoting' | 'negotiating' | 'awarded' | 'closed' | 'expired';

export interface RfqLine {
  productId?: Id;
  description: string;
  targetQty: number;
  unit?: string;
  targetPrice?: Minor;
}

export interface Rfq {
  id: Id;
  code: string;
  buyerOrgId: Id;
  buyerOrgName: string;
  title: string;
  categoryId: Id;
  lines: RfqLine[];
  deliveryWindow: { from: string; to: string };
  destination: string;
  incoterm: 'exw' | 'fca' | 'cif' | 'd2d';
  terms: 'prepaid' | 'credit_net30' | 'credit_net60';
  status: RfqStatus;
  invitedSellerIds: Id[] | 'all';
  quotes: number;
  bestPrice?: Minor;
  expiresAt: string;
  createdAt: string;
  notes?: string;
  awardedQuoteId?: Id;
}

export interface QuotationLine {
  id: Id;
  description: string;
  qty: number;
  unitPrice: Minor;
  leadTimeDays: number;
  available: boolean;
}

export interface QuotationRevision {
  revision: number;
  at: string;
  author: string;
  note: string;
  total: Minor;
}

export interface Quotation {
  id: Id;
  code: string;
  rfqId: Id;
  sellerId: Id;
  sellerName: string;
  status: 'draft' | 'sent' | 'revising' | 'accepted' | 'rejected' | 'expired' | 'withdrawn';
  lines: QuotationLine[];
  subtotal: Minor;
  deliveryFee: Minor;
  tax: Minor;
  total: Minor;
  incoterm: string;
  validityDays: number;
  validUntil: string;
  paymentTerms: string;
  revisions: QuotationRevision[];
  leadTimeDays: number;
  message?: string;
  counterHistory: { at: string; by: 'buyer' | 'seller'; message: string; proposedTotal?: Minor }[];
  createdAt: string;
}

export interface PurchaseOrder {
  id: Id;
  code: string;
  quotationId: Id;
  quoteCode: string;
  buyerOrgId: Id;
  buyerOrgName: string;
  sellerId: Id;
  sellerName: string;
  status: 'issued' | 'confirmed' | 'in_production' | 'partially_shipped' | 'shipped' | 'delivered' | 'invoiced' | 'settled' | 'cancelled';
  lines: QuotationLine[];
  subtotal: Minor;
  deliveryFee: Minor;
  tax: Minor;
  total: Minor;
  terms: string;
  deliveryWindow: { from: string; to: string };
  destination: string;
  incoterm: string;
  issuedAt: string;
  expectedAt: string;
  progressPct: number;
  invoiceId?: Id;
  receivableDueAt?: string;
}

export interface Invoice {
  id: Id;
  code: string;
  poId: Id;
  poCode: string;
  buyerOrgId: Id;
  sellerId: Id;
  sellerName: string;
  amount: Minor;
  tax: Minor;
  status: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'void';
  issuedAt: string;
  dueAt: string;
  paidAt?: string;
  term: string;
  fiscalReceiptNo?: string;
}

export interface CreditAssessment {
  orgId: Id;
  orgName: string;
  tier: 'none' | 'cash_only' | 'net15' | 'net30' | 'net60';
  limit: Minor;
  used: Minor;
  available: Minor;
  paymentHistoryScore: number;
  ordersSettled: number;
  avgDaysToPay: number;
  assessedAt: string;
  notes: string;
}

/* -------------------------- Seller mini-ERP ---------------------------- */

export interface Supplier {
  id: Id;
  sellerId: Id;
  name: string;
  contactName: string;
  phone: string;
  email?: string;
  city: string;
  paymentTerms: string;
  totalSpend: Minor;
  openOrders: number;
  rating: number;
  since: string;
  itemsSupplied: string[];
}

export interface ProcurementOrder {
  id: Id;
  code: string;
  sellerId: Id;
  supplierId: Id;
  supplierName: string;
  status: 'draft' | 'issued' | 'acknowledged' | 'partially_received' | 'received' | 'cancelled';
  lines: { id: Id; description: string; qty: number; unitCost: Minor; receivedQty: number }[];
  total: Minor;
  issuedAt: string;
  expectedAt: string;
  receivedAt?: string;
  notes?: string;
}

export interface Expense {
  id: Id;
  sellerId: Id;
  category: 'rent' | 'utilities' | 'salary' | 'transport' | 'marketing' | 'packaging' | 'subscription' | 'tax' | 'other';
  label: string;
  amount: Minor;
  incurredAt: string;
  recurring: boolean;
  recurrence: 'monthly' | 'weekly' | 'quarterly' | 'yearly' | null;
  nextDueAt?: string;
  status: 'recorded' | 'accrued' | 'paid';
  vendor?: string;
  attachment?: string;
}

export interface Employee {
  id: Id;
  sellerId: Id;
  name: string;
  role: string;
  phone: string;
  monthlySalary: Minor;
  hiredAt: string;
  status: 'active' | 'on_leave' | 'terminated';
  monthlyPayroll: Minor;
  department: 'sales' | 'operations' | 'warehouse' | 'admin' | 'production';
}

export interface ProductionBatch {
  id: Id;
  code: string;
  sellerId: Id;
  productId: Id;
  productTitle: string;
  status: 'planned' | 'in_production' | 'quality_check' | 'completed' | 'scrapped';
  plannedQty: number;
  producedQty: number;
  scrappedQty: number;
  bom: { id: Id; component: string; qtyPerUnit: number; unitCost: Minor }[];
  startedAt: string;
  completedAt?: string;
  yieldPct: number;
  unitCost: Minor;
}

/* ------------------------------ Delivery -------------------------------- */

export interface DeliveryLeg {
  id: Id;
  kind: 'pickup' | 'hub' | 'linehaul' | 'last_mile' | 'return';
  partner: string;
  status: 'pending' | 'in_transit' | 'completed' | 'exception';
  from: string;
  to: string;
  at?: string;
  note?: string;
}

export interface AgentStop {
  id: Id;
  shipmentId: Id;
  orderCode: string;
  sequence: number;
  customer: string;
  phone: string;
  address: string;
  city: string;
  zone: string;
  codAmount: Minor;
  status: 'pending' | 'arrived' | 'delivered' | 'failed';
  attempts: number;
  window: string;
  note?: string;
  parcelCount: number;
  productTitles: string[];
  promisedBy: string;
}

export interface AgentRoute {
  id: Id;
  agentId: Id;
  agentName: string;
  date: string;
  zone: string;
  status: 'planned' | 'in_progress' | 'completed';
  stops: AgentStop[];
  stats: { total: number; delivered: number; failed: number; collected: Minor; expected: Minor };
  online: boolean;
  offlineSince?: string;
  pendingSyncCount: number;
}

/* ------------------------- Delivery operations ------------------------- */

export interface DeliveryAgent {
  id: Id;
  userId: Id;
  name: string;
  phone: string;
  city: string;
  zones: string[];
  vehicle: 'motorbike' | 'bicycle' | 'van' | 'on_foot';
  status: 'active' | 'on_leave' | 'suspended';
  rating: number;
  joinedAt: string;
  /** Maximum cash an agent may hold before a remittance is mandatory. */
  floatLimit: Minor;
  cashHeld: Minor;
  delivered30d: number;
  onTimeRate: number;
  podsToday: number;
  offlineCapable: boolean;
}

/**
 * Append-only delivery timeline. Kept separate from Shipment.events because the
 * agent app writes here while offline and syncs later, so entries can arrive out
 * of order and can carry a capture that predates the sync.
 */
export interface DeliveryEvent {
  id: Id;
  shipmentId: Id;
  orderCode: string;
  agentId: Id;
  agentName: string;
  at: string;
  kind: 'status_change' | 'pod_captured' | 'cash_collected' | 'note';
  status: Shipment['status'];
  detail: string;
  podKind?: ProofOfDelivery['kind'];
  cash?: Minor;
  offlineCaptured: boolean;
  syncedAt?: string;
  geo?: { lat: number; lng: number };
}

export interface CodDeposit {
  id: Id;
  agentId: Id;
  agentName: string;
  routeId: Id;
  expected: Minor;
  received: Minor;
  fee: Minor;
  net: Minor;
  method: 'CBE Birr' | 'Telebirr' | 'Awash Bank' | 'Dashen Bank';
  reference: string;
  dueAt: string;
  receivedAt?: string;
  /** expected - received. Negative means the agent is short and payouts hold. */
  variance: Minor;
  status: 'pending' | 'submitted' | 'confirmed' | 'late' | 'short';
  note?: string;
}

export interface SyncQueueItem {
  id: Id;
  agentId: Id;
  kind: 'pod' | 'status' | 'cash';
  refId: Id;
  label: string;
  capturedAt: string;
  bytes: number;
  attempts: number;
  status: 'queued' | 'syncing' | 'synced' | 'failed';
  lastError?: string;
}

/* ---------------------------- Platform config -------------------------- */

export interface PlatformSettings {
  vatRate: number;
  withholdingRate: number;
  codFeeBands: { upto: Minor; fee: Minor }[];
  payoutSchedule: 'weekly' | 'biweekly' | 'monthly';
  settlementHoldDays: number;
  disputeSlaHours: number;
  vatRegistrationThreshold: Minor;
  subscriptionPlans: { id: string; name: string; monthly: Minor; features: string[] }[];
  deliveryFlat: Minor;
  freeDeliveryThreshold: Minor;
  supportPhone: string;
  updatedAt: string;
  updatedBy: string;
}

export interface FeatureFlags {
  assistedListing: boolean;
  pricingCopilot: boolean;
  demandForecast: boolean;
  b2bCredit: boolean;
  cod: boolean;
  promotions: boolean;
  referralProgram: boolean;
  /** Shadow evaluation only — never serving buyer traffic. */
  shadowRecommendations: boolean;
  updatedAt: string;
}

export interface BuyBoxOverride {
  id: Id;
  productId: Id;
  offerId: Id;
  reason: string;
  by: string;
  at: string;
  expiresAt?: string;
}

/* ------------------------------- Finance ------------------------------- */

export type AccountCode =
  | 'cash_psp'
  | 'cash_cod_in_transit'
  | 'receivable_buyer'
  | 'receivable_b2b'
  | 'escrow_seller_payable'
  | 'seller_payable'
  | 'revenue_commission'
  | 'revenue_delivery'
  | 'tax_payable_vat'
  | 'tax_payable_withholding'
  | 'refund_payable'
  | 'discount_expense'
  | 'expense_psp'
  | 'platform_cash'
  | 'suspense';

export interface JournalLine {
  account: AccountCode;
  debit: Minor;
  credit: Minor;
  memo?: string;
  partyType?: 'seller' | 'buyer' | 'platform';
  partyId?: Id;
}

export interface JournalEntry {
  id: Id;
  journal: 'sales' | 'settlement' | 'refund' | 'accrual' | 'reconciliation' | 'tax';
  refType: 'order' | 'settlement' | 'refund' | 'invoice' | 'payout' | 'adjustment';
  refId: Id;
  refLabel: string;
  at: string;
  lines: JournalLine[];
  total: Minor;
  description: string;
  postedBy: 'system' | 'finance' | 'auto';
  reversalOf?: Id;
  attachments: string[];
}

export interface Settlement {
  id: Id;
  code: string;
  sellerId: Id;
  sellerName: string;
  periodFrom: string;
  periodTo: string;
  orderCount: number;
  grossSales: Minor;
  commission: Minor;
  deliveryFees: Minor;
  refunds: Minor;
  adjustments: Minor;
  withholdingTax: Minor;
  netPayable: Minor;
  status: 'accruing' | 'ready' | 'approved' | 'paying' | 'paid' | 'blocked' | 'on_hold';
  blockedReason?: string;
  payoutRef?: string;
  payoutMethod?: string;
  createdAt: string;
  paidAt?: string;
  journalEntryId?: Id;
  holdFlag: boolean;
  note?: string;
  /** Set when the seller asks finance to release this. It does not approve the payout. */
  payoutRequestedAt?: string;
}

export interface ReconciliationRun {
  id: Id;
  at: string;
  scope: 'psp' | 'cod_remittance' | 'payouts' | 'bank';
  counterparty: string;
  records: number;
  matched: number;
  mismatched: number;
  missing: number;
  netDifference: Minor;
  status: 'clean' | 'exceptions' | 'blocked';
  payoutBlocked: boolean;
  exceptions: {
    id: Id;
    kind: 'amount' | 'missing_payout' | 'unmatched_charge' | 'duplicate' | 'late_remittance';
    detail: string;
    amount: Minor;
    ref: string;
    at: string;
    resolution: 'open' | 'investigating' | 'resolved';
  }[];
}

export interface PayoutAccount {
  id: Id;
  sellerId: Id;
  bank: string;
  accountName: string;
  accountNumber: string;
  verified: boolean;
  isDefault: boolean;
}

export interface TaxReceipt {
  id: Id;
  orderCode: string;
  buyerName: string;
  at: string;
  gross: Minor;
  tax: Minor;
  net: Minor;
  fiscalCode: string;
  fiscalReceiptNo: string;
  status: 'issued' | 'pending_sync' | 'reported';
  buyerTin?: string;
}

/* ------------------------------ Trust/Safety --------------------------- */

export type RiskRuleId =
  | 'velocity_24h'
  | 'new_account_high_value_cod'
  | 'destination_changed'
  | 'impossible_delivery_combination'
  | 'cod_amount_anomaly'
  | 'device_fingerprint_repeat'
  | 'b2b_credit_over_limit';

export interface RiskRule {
  id: RiskRuleId;
  label: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  enabled: boolean;
  action: 'flag' | 'hold' | 'block' | 'require_otp';
  hits30d: number;
  falsePositiveRate: number;
  params: Record<string, number | string | boolean>;
}

export interface RiskEvaluation {
  orderId?: Id;
  at: string;
  score: number;
  decision: 'allow' | 'review' | 'block';
  triggered: { rule: RiskRuleId; label: string; severity: string; detail: string }[];
  signals: { label: string; value: string }[];
}

export type DisputeStatus = 'open' | 'seller_response' | 'mediation' | 'resolved_buyer' | 'resolved_seller' | 'closed';
export type DisputeReason =
  | 'not_received'
  | 'damaged'
  | 'wrong_item'
  | 'missing_parts'
  | 'not_as_described'
  | 'late_delivery'
  | 'counterfeit'
  | 'other';

export interface Dispute {
  id: Id;
  code: string;
  orderId: Id;
  orderCode: string;
  buyerId: Id;
  buyerName: string;
  sellerId: Id;
  sellerName: string;
  reason: DisputeReason;
  summary: string;
  status: DisputeStatus;
  amount: Minor;
  evidence: { id: Id; kind: 'photo' | 'document' | 'message'; url: string; uploadedBy: 'buyer' | 'seller' | 'system' }[];
  structuredThread: { id: Id; by: 'buyer' | 'seller' | 'mediator'; at: string; reasonCode: string; body: string; attachments: string[] }[];
  resolution?: { outcome: 'refund_full' | 'refund_partial' | 'return_and_refund' | 'release_to_seller'; amount: Minor; note: string; at: string };
  createdAt: string;
  slaHours: number;
  dueAt: string;
}

export interface Review {
  id: Id;
  productId: Id;
  orderId: Id;
  authorName: string;
  rating: number;
  title: string;
  body: string;
  status: 'pending' | 'published' | 'flagged' | 'removed';
  moderation: { flagged: boolean; reasons: string[]; reviewedBy?: string; at?: string };
  verifiedPurchase: boolean;
  helpfulCount: number;
  createdAt: string;
  lang: 'en' | 'am';
  photos: string[];
}

export interface VerificationCase {
  id: Id;
  orgId: Id;
  orgName: string;
  orgType: 'seller' | 'buyer_org';
  submittedTier: VerificationTier;
  currentTier: VerificationTier;
  status: 'queued' | 'in_review' | 'needs_info' | 'approved' | 'rejected' | 'suspended';
  submittedAt: string;
  slaHours: number;
  checks: { id: string; name: string; status: 'pending' | 'pass' | 'fail' | 'waived'; note: string; weight: number }[];
  documents: { id: string; kind: string; file: string; uploadedAt: string }[];
  score: number;
  blocking: { id: string; reason: string }[];
  reviewer?: string;
  reviewedAt?: string;
}

/* --------------------------------- AI ---------------------------------- */

export type AiCapability =
  | 'buyer_assistant'
  | 'listing_generation'
  | 'pricing_guidance'
  | 'demand_forecast'
  | 'recommendations'
  | 'translation_am_en';

export interface AiSuggestion {
  id: string;
  capability: AiCapability;
  at: string;
  model: string;
  inputSummary: string;
  output: string;
  tokensIn: number;
  tokensOut: number;
  costMinor: Minor;
  latencyMs: number;
  guardrail: {
    decision: 'allowed' | 'blocked' | 'flagged';
    checks: { id: string; name: string; result: 'pass' | 'fail' | 'warn' }[];
    reason?: string;
  };
  applied: boolean;
  surface: 'buyer_web' | 'seller_portal' | 'agent_app' | 'admin';
  actor: string;
}

export interface ReorderSuggestion {
  productId: Id;
  title: string;
  sku: string;
  onHand: number;
  reorderLevel: number;
  avgDailySales: number;
  daysOfCover: number;
  suggestedQty: number;
  supplierName?: string;
  unitCost: Minor;
  forecastMethod: 'moving_average_28d' | 'seasonal_naive' | 'trend_linear';
  confidence: number;
  reasoning: string[];
  baselineOnly: boolean;
}

/* -------------------------------- Search ------------------------------- */

export interface SearchFacet {
  key: string;
  label: string;
  /** Absent on range facets — a slider has no discrete bucket list. */
  values?: { value: string; label: string; count: number; selected?: boolean }[];
  type: 'checkbox' | 'range' | 'radio';
  min?: number;
  max?: number;
}

export interface SearchResult {
  items: ProductSummary[];
  total: number;
  page: number;
  pageSize: number;
  took: number;
  facets: SearchFacet[];
  suggestions: string[];
  engine: 'opensearch' | 'meilisearch' | 'postgres_fts';
  applied: { sort: string; sponsored: boolean; a9: boolean };
  rankingSignals: { name: string; weight: number; note: string }[];
}

export type SortKey = 'relevance' | 'price_asc' | 'price_desc' | 'rating' | 'newest' | 'sales' | 'eta';

/* ------------------------------ Dashboard ------------------------------ */

export interface SellerMetrics {
  gmv30d: Minor;
  gmvDeltaPct: number;
  orders30d: number;
  ordersDeltaPct: number;
  conversionRate: number;
  conversionDeltaPct: number;
  views30d: number;
  avgOrderValue: Minor;
  cancelRate: number;
  lateShipRate: number;
  activeListings: number;
  pendingModeration: number;
  lowStockCount: number;
  unpaidBalance: Minor;
  nextSettlementAt?: string;
  topProducts: { id: Id; title: string; units: number; revenue: Minor; image: string }[];
  series: { date: string; revenue: Minor; orders: number; visitors: number }[];
  funnel: { stage: string; value: number; rate: number }[];
  lowStock: { offerId: Id; title: string; stock: number; reorderLevel: number; image: string }[];
  actionQueue: { id: Id; type: string; label: string; detail: string; dueAt?: string; severity: 'low' | 'medium' | 'high' }[];
}

export interface PlatformMetrics {
  gmv30d: Minor;
  orders30d: number;
  activeSellers: number;
  activeBuyers: number;
  deliveredOrders30d: number;
  avgDeliveryDays: number;
  codRatio: number;
  disputeRate: number;
  commissionRevenue30d: Minor;
  escrowBalance: Minor;
  openDisputes: number;
  pendingVerifications: number;
  series: { date: string; gmv: Minor; orders: number; sellers: number; buyers: number }[];
  categoryMix: { name: string; gmv: Minor; share: number }[];
  cities: { name: string; orders: number }[];
}

export interface NotificationItem {
  id: Id;
  at: string;
  channel: 'in_app' | 'sms' | 'push' | 'email';
  audience: Role;
  title: string;
  body: string;
  severity: 'info' | 'success' | 'warn' | 'critical';
  read: boolean;
  link?: string;
  entityType?: string;
  entityId?: string;
  dedupeKey: string;
}

export interface B2BDashboard {
  openRfqs: number;
  quotesReceived: number;
  negotiationPending: number;
  activePos: number;
  committedSpend: Minor;
  creditLimit: Minor;
  creditUsed: Minor;
  creditAvailable: Minor;
  savingsVsRetail: number;
  recent: Rfq[];
  dueInvoices: Invoice[];
  topSuppliers: { id: Id; name: string; spend: Minor; onTimePct: number; orders: number }[];
}
