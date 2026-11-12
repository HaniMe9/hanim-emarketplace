import type {
  Address,
  AgentRoute,
  AiSuggestion,
  B2BDashboard,
  BuyBoxOverride,
  Category,
  CodDeposit,
  CreditAssessment,
  DeliveryAgent,
  DeliveryEvent,
  Dispute,
  Employee,
  Expense,
  FeatureFlags,
  Invoice,
  JournalEntry,
  NotificationItem,
  Offer,
  Order,
  Organization,
  Payment,
  PayoutAccount,
  PlatformMetrics,
  PlatformSettings,
  Product,
  ProductSummary,
  ProductionBatch,
  Promotion,
  ProcurementOrder,
  PurchaseOrder,
  Quotation,
  ReconciliationRun,
  ReorderSuggestion,
  Review,
  Rfq,
  RiskEvaluation,
  RiskRule,
  SellerMetrics,
  Settlement,
  Shipment,
  Supplier,
  SyncQueueItem,
  TaxReceipt,
  User,
  VerificationCase,
} from '../shared/types.ts';

/** A password hash, stored as `saltHex:hashHex`. Never leaves the server. */
export interface Credential {
  userId: string;
  hash: string;
  updatedAt: string;
}

export interface Db {
  version: number;
  users: User[];
  credentials: Credential[];
  addresses: Address[];
  categories: Category[];
  products: Product[];
  offers: Offer[];
  orgs: Organization[];
  orders: Order[];
  payments: Payment[];
  shipments: Shipment[];
  reviews: Review[];
  promotions: Promotion[];
  couponsUsed: { code: string; userId: string; at: string }[];
  rfqs: Rfq[];
  quotations: Quotation[];
  purchaseOrders: PurchaseOrder[];
  invoices: Invoice[];
  creditAssessments: CreditAssessment[];
  suppliers: Supplier[];
  procurementOrders: ProcurementOrder[];
  expenses: Expense[];
  employees: Employee[];
  productionBatches: ProductionBatch[];
  agentRoutes: AgentRoute[];
  agents: DeliveryAgent[];
  deliveryEvents: DeliveryEvent[];
  codDeposits: CodDeposit[];
  syncQueue: SyncQueueItem[];
  ledger: JournalEntry[];
  settlements: Settlement[];
  reconciliations: ReconciliationRun[];
  payoutAccounts: PayoutAccount[];
  taxReceipts: TaxReceipt[];
  riskRules: RiskRule[];
  riskEvaluations: RiskEvaluation[];
  disputes: Dispute[];
  verificationCases: VerificationCase[];
  aiSuggestions: AiSuggestion[];
  reorderSuggestions: ReorderSuggestion[];
  notifications: NotificationItem[];
  settings: PlatformSettings;
  featureFlags: FeatureFlags;
  buyBoxOverrides: BuyBoxOverride[];
  sellerMetrics: SellerMetrics;
  platformMetrics: PlatformMetrics;
  b2bDashboards: B2BDashboard[];
  /**
   * Baskets are per account. A single shared `cart` meant every signed-in user
   * was looking at — and checking out — the previous user's basket.
   * `userId: null` is the guest basket, kept so anonymous browsing still has one.
   */
  carts: { userId: string | null; lines: { offerId: string; qty: number }[] }[];
  /** Saved products, per account. Previously one global list for every user. */
  favoritesByUser: { userId: string | null; productIds: string[] }[];
  activity: { id: string; at: string; actor: string; action: string; entity: string; entityId: string; detail: string }[];
  searchLog: { q: string; at: string; results: number }[];
  auditLog: { id: string; at: string; actor: string; action: string; target: string; before?: string; after?: string; ip: string }[];
}

export type { Db as Database };
export type { ProductSummary };
