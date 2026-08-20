export interface Category {
  id: number;
  name: string;
  created_at?: string;
}

export interface Unit {
  id: number;
  name: string;
  symbol: string;
}

export interface ProductUnit {
  id: number;
  product_id: number;
  level: 0 | 1 | 2;
  name: string;
  quantity_in_base_units: number;
  barcode: string | null;
  price: number | null;
  is_base: boolean;
  created_at?: string;
}

export interface Product {
  id: number;
  sku: string | null;
  barcode: string | null;
  name: string;
  category_id: number | null;
  unit_id: number | null;
  cost_price: number;
  sale_price: number;
  wholesale_price: number | null;
  shelf_location: string | null;
  stock_qty: number;
  low_stock_threshold: number;
  tax_rate: number;
  expiry_date: string | null;
  active: number;
  created_at?: string;
  updated_at?: string;
  category_name?: string | null;
  unit_name?: string | null;
  unit_symbol?: string | null;
  units_per_box: number | null;
  box_barcode: string | null;
  box_price: number | null;
  units?: ProductUnit[];
}

export interface ProductInput {
  sku?: string | null;
  barcode?: string | null;
  name: string;
  category_id?: number | null;
  unit_id?: number | null;
  cost_price?: number;
  sale_price?: number;
  wholesale_price?: number | null;
  shelf_location?: string | null;
  stock_qty?: number;
  low_stock_threshold?: number;
  tax_rate?: number;
  expiry_date?: string | null;
  units?: {
    level: 0 | 1 | 2;
    name: string;
    quantity_in_base_units: number;
    barcode?: string | null;
    price?: number | null;
    is_base: boolean;
  }[];
}

export interface ProductImportError {
  row: number;
  message: string;
}

export interface ProductImportResult {
  inserted: number;
  errors: ProductImportError[];
}

export interface ScaleBarcodeResult {
  plu: string;
  price: number;
  isValid: boolean;
  error?: string;
}

export interface ScalePluMapping {
  plu: string;
  product_id: number;
  product_name: string;
}

export interface StockMovement {
  id: number;
  product_id: number;
  change_qty: number;
  reason: string | null;
  ref_type: string | null;
  ref_id: number | null;
  created_at?: string;
  product_name?: string | null;
}

export type NavPage = 'dashboard' | 'billing' | 'inventory' | 'audits' | 'promotions' | 'purchases' | 'udhaar' | 'returns' | 'shifts' | 'reports' | 'settings' | 'users' | 'barcode';

export type UserRole = 'owner' | 'manager' | 'cashier';

export interface UserRow {
  id: number;
  username: string;
  role: UserRole;
  active: number;
  created_at?: string;
}

export interface LoginResult {
  ok: boolean;
  user?: UserRow | null;
  message?: string;
}

export interface UserInput {
  username: string;
  password?: string;
  pin?: string;
  role: UserRole;
}

export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  balance: number;
  credit_limit?: number;
  created_at?: string;
}

export interface Sale {
  id: number;
  invoice_no: string;
  customer_id: number | null;
  user_id: number | null;
  shift_id: number | null;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  status: string;
  notes: string | null;
  returned_amount?: number;
  created_at?: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  service_charge?: number;
  service_charge_type?: string;
  freight?: number;
}

export interface SaleItem {
  id: number;
  sale_id: number;
  product_id: number;
  qty: number;
  unit_price: number;
  discount: number;
  tax_rate: number;
  line_total: number;
  returned_qty?: number;
  promo_id?: number | null;
  promo_name?: string | null;
  product_name?: string | null;
  unit_name?: string | null;
  display_qty?: number | null;
}

export interface Payment {
  id: number;
  sale_id: number;
  mode: string;
  amount: number;
  reference: string | null;
  created_at?: string;
}

export interface BillLineInput {
  product_id: number;
  qty: number;
  price: number;
  line_discount: number;
  tax_rate: number;
  box_qty?: number;
  unit_name?: string | null;
  display_qty?: number | null;
}

export interface PaymentInput {
  mode: string;
  amount: number;
  reference?: string | null;
}

export interface SaleInput {
  items: BillLineInput[];
  customer_id?: number | null;
  bill_discount?: number;
  discount_type?: 'amount' | 'percent';
  price_floor_override?: boolean;
  price_overridden?: boolean;
  price_mode?: 'retail' | 'wholesale';
  service_charge?: number;
  service_charge_type?: 'amount' | 'percent';
  freight?: number;
  payments: PaymentInput[];
  notes?: string | null;
}

export interface SaleCreateResult {
  sale: Sale;
  items: SaleItem[];
  payments: Payment[];
  change: number;
  balance: number;
}

export interface HeldBill {
  id: number;
  kind: string;
  label: string | null;
  data: string;
  created_at?: string;
}

export interface SettingsMap {
  [key: string]: string;
}

export interface CustomerTransaction {
  id: number;
  customer_id: number;
  sale_id: number | null;
  payment_id: number | null;
  amount: number;
  type: string;
  created_at?: string;
  running: number;
}

export interface Expense {
  id: number;
  title: string;
  category: string;
  amount: number;
  expense_date: string;
  notes: string | null;
  created_at?: string;
}

export interface ExpiringRow {
  id: number;
  name: string;
  stock_qty: number;
  expiry_date: string;
  days_left: number;
  category_name?: string | null;
}

export interface ProductBatch {
  id: number;
  product_id: number;
  batch_number: string;
  quantity: number;
  cost_price: number;
  expiry_date: string | null;
  received_date: string;
  created_at: string;
}

export interface DashboardData {
  today_sales: number;
  today_bills: number;
  udhaar_due: number;
  low_stock: number;
  today_expenses: number;
  top_products: { name: string; qty: number; revenue: number }[];
  recent_sales: { id: number; invoice_no: string; customer_name: string | null; total_amount: number; created_at?: string }[];
  low_stock_items: { id: number; name: string; stock_qty: number; low_stock_threshold: number }[];
  expiring_soon: ExpiringRow[];
  expiry_warning_days: number;
}

export interface SalesDayRow {
  day: string;
  bills: number;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
}

export interface ProfitLoss {
  revenue: number;
  cogs: number;
  gross: number;
  expenses: number;
  net: number;
  udhaar_collected: number;
}

export interface BestSellerRow {
  name: string;
  qty: number;
  revenue: number;
}

export interface HourlyTrendRow {
  hour: string;
  amount: number;
}

export interface TopProductRow {
  id: number;
  name: string;
  qty_sold: number;
  revenue: number;
}

export interface DailyStats {
  total_sales: number;
  bill_count: number;
  avg_bill: number;
}

export type ReceiptSettings = Record<string, string>;

export interface WhatsAppStatus {
  connected: boolean;
  phone: string | null;
  qr: string | null;
  error: string | null;
}

export interface WhatsAppSendResult {
  ok: boolean;
  message: string;
}

export interface StockValuation {
  cost_value: number;
  retail_value: number;
  products: number;
  by_category: { name: string | null; cost: number; retail: number; products: number }[];
}

// ============ v1.6.0 Reports ============

export interface SalesAnalysisSummary {
  total_sales: number;
  bill_count: number;
  avg_bill: number;
  total_discount: number;
  total_tax: number;
}
export interface PaymentBreakdownRow {
  mode: string;
  bill_count: number;
  total: number;
  percentage: number;
}
export interface DailyTrendRow {
  date: string;
  bills: number;
  total: number;
}
export interface SalesAnalysisResult {
  summary: SalesAnalysisSummary;
  paymentBreakdown: PaymentBreakdownRow[];
  dailyTrend: DailyTrendRow[];
  generatedAt: string;
}

export interface ProductPerformanceRow {
  id: number;
  name: string;
  category: string | null;
  qty_sold: number;
  times_sold: number;
  revenue: number;
  cost: number;
  profit: number;
  profit_margin_pct: number;
  revenue_pct: number;
}
export interface SlowMoverRow {
  id: number;
  name: string;
  category: string | null;
  stock_qty: number;
  cost_price: number;
  sale_price: number;
  last_sale_date: string | null;
  days_no_sale: number | null;
}
export interface CategorySalesRow {
  category: string | null;
  product_count: number;
  qty_sold: number;
  revenue: number;
  avg_price: number;
}
export interface ProductPerformanceResult {
  topProducts: ProductPerformanceRow[];
  slowMovers: SlowMoverRow[];
  categoryAnalysis: CategorySalesRow[];
  generatedAt: string;
}

export interface TopCustomerRow {
  id: number;
  name: string;
  phone: string | null;
  udhaar_balance: number;
  purchase_count: number;
  total_spent: number;
  avg_purchase: number;
  last_purchase: string | null;
  segment: 'VIP' | 'Regular' | 'Udhaar';
}
export interface UdhaarSummary {
  total_customers: number;
  with_balance: number;
  cleared: number;
  total_outstanding: number;
  avg_balance: number | null;
  max_balance: number;
}
export interface UdhaarOverdueRow {
  id: number;
  name: string;
  phone: string | null;
  balance: number;
  last_purchase: string | null;
  days_since_purchase: number | null;
}
export interface CustomerAnalysisResult {
  topCustomers: TopCustomerRow[];
  udhaarSummary: UdhaarSummary;
  udhaarOverdue: UdhaarOverdueRow[];
  generatedAt: string;
}

export interface StockSummary {
  total_skus: number;
  total_value: number;
  out_of_stock: number;
  below_minimum: number;
}
export interface ExpiryAlertRow {
  id: number;
  name: string;
  category: string | null;
  stock_qty: number;
  expiry_date: string;
  days_until_expiry: number;
  status: 'EXPIRED' | 'URGENT' | 'WARNING' | 'OK';
}
export interface TurnoverRow {
  id: number;
  name: string;
  stock_qty: number;
  velocity: 'Fast Mover' | 'Medium' | 'Slow' | 'Dead Stock';
  days_no_sale: number | null;
  last_sale_date: string | null;
}
export interface InventoryAnalysisResult {
  stockSummary: StockSummary;
  expiryAlert: ExpiryAlertRow[];
  turnoverAnalysis: TurnoverRow[];
  generatedAt: string;
}

export interface FinancialPnL {
  gross_sales: number;
  discounts: number;
  net_sales: number;
  cogs: number;
  gross_profit: number;
  tax_paid: number;
  net_profit: number;
  expenses: number;
}
export interface FinancialMargins {
  gross_margin_pct: number;
  net_margin_pct: number;
}
export interface FinancialReportResult {
  pnl: FinancialPnL;
  margins: FinancialMargins;
  generatedAt: string;
}

export interface TaxSummary {
  taxable_sales: number;
  tax_collected: number;
  transaction_count: number;
}
export interface TaxByCategoryRow {
  category: string | null;
  sales: number;
  estimated_gst_17pct: number;
}
export interface TaxReportResult {
  taxSummary: TaxSummary;
  taxByCategory: TaxByCategoryRow[];
  period: { startDate: string; endDate: string };
  generatedAt: string;
}

export interface DailyClosingRow {
  mode: string;
  total: number;
}
export interface DailyClosingResult {
  date: string;
  bill_count: number;
  total_sales: number;
  by_mode: DailyClosingRow[];
  expenses: number;
  expected_cash: number;
  generatedAt: string;
}

export interface ActivityRow {
  id: number;
  user_id: number | null;
  action: string;
  entity: string | null;
  entity_id: number | null;
  details: string | null;
  created_at?: string;
  username?: string | null;
}

export interface Supplier {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  balance: number;
  created_at?: string;
}

export interface SupplierTransaction {
  id: number;
  supplier_id: number;
  purchase_order_id: number | null;
  amount: number;
  type: string;
  created_at?: string;
  running: number;
}

export interface PurchaseOrder {
  id: number;
  supplier_id: number;
  status: string;
  total_amount: number;
  created_at?: string;
  supplier_name?: string | null;
}

export interface PurchaseItem {
  id: number;
  purchase_order_id: number;
  product_id: number;
  qty: number;
  unit_cost: number;
  product_name?: string | null;
}

export interface PurchaseLineInput {
  product_id: number;
  qty: number;
  unit_cost: number;
}

export interface PurchasePriceRow {
  id: number;
  unit_cost: number;
  created_at?: string;
  product_name?: string | null;
}

export interface ReturnRow {
  id: number;
  sale_id: number;
  reason: string | null;
  refund_amount: number;
  refund_mode: string;
  restock: number;
  created_at?: string;
  invoice_no?: string | null;
  customer_name?: string | null;
}

export interface ReturnItemRow {
  id: number;
  return_id: number;
  sale_item_id: number;
  product_id: number;
  qty: number;
  unit_price: number;
  product_name?: string | null;
}

export interface ReturnInputItem {
  sale_item_id: number;
  qty: number;
  unit_price: number;
}

export interface CashRefundRow {
  id: number;
  amount: number;
  reason: string | null;
  mode: string;
  user_id: number | null;
  shift_id: number | null;
  created_at?: string;
  username?: string | null;
}

export interface AuditRow {
  id: number;
  user_id: number;
  status: 'in_progress' | 'completed';
  total_items: number;
  total_variance: number;
  notes: string | null;
  completed_at?: string;
  created_at?: string;
  username?: string | null;
  overage?: number;
  shortage?: number;
}

export interface AuditItemRow {
  id: number;
  audit_id: number;
  product_id: number;
  system_qty: number;
  counted_qty: number | null;
  variance: number;
  product_name?: string | null;
  barcode?: string | null;
  category_name?: string | null;
  unit_symbol?: string | null;
}

export interface AuditCountInput {
  product_id: number;
  counted_qty: number;
}

export type PromotionType = 'percent' | 'fixed' | 'bogo';
export type PromotionScope = 'product' | 'category';

export interface PromotionRow {
  id: number;
  name: string;
  type: PromotionType;
  scope: PromotionScope;
  product_id: number | null;
  category_id: number | null;
  discount_value: number;
  buy_qty: number;
  free_qty: number;
  start_date: string | null;
  end_date: string | null;
  active: number;
  created_at?: string;
  product_name?: string | null;
  category_name?: string | null;
}

export interface PromotionInput {
  name: string;
  type: PromotionType;
  scope: PromotionScope;
  product_id?: number | null;
  category_id?: number | null;
  discount_value: number;
  buy_qty?: number;
  free_qty?: number;
  start_date?: string | null;
  end_date?: string | null;
  active?: boolean;
}

export interface ResolvedPromotion {
  product_id: number;
  base_price: number;
  effective_price: number;
  saved: number;
  promo_id: number | null;
  promo_name: string | null;
  promo_type: PromotionType | null;
}

export interface ShiftRow {
  id: number;
  user_id: number;
  username?: string;
  start_cash: number;
  end_cash: number | null;
  expected_cash: number | null;
  variance: number | null;
  forced: number;
  opened_at: string;
  closed_at: string | null;
  notes: string | null;
}

export interface ShiftDetail extends ShiftRow {
  sales: { id: number; invoice_no: string; total_amount: number; status: string; created_at: string }[];
  cash_sales: number;
  cash_refunds: number;
  expected_preview: number;
}

export interface BackupResult {
  localPath: string;
  cloudPath: string | null;
  cloudOk: boolean;
  cloudError: string | null;
}

export interface PosBridge {
  app: {
    getVersion: () => Promise<string>;
  };
  scaleBarcode: {
    parse: (barcode: string) => Promise<ScaleBarcodeResult>;
    isScaleItem: (barcode: string) => Promise<boolean>;
    listPluMappings: () => Promise<ScalePluMapping[]>;
  };
  updater: {
    check: () => Promise<string>;
    install: () => Promise<string>;
    getState: () => Promise<string>;
    onStatus: (callback: (status: { state: string; detail?: string }) => void) => () => void;
  };
  inventory: {
    list: (search?: string, includeInactive?: boolean) => Promise<Product[]>;
    get: (id: number) => Promise<Product | null>;
    getByBarcode: (barcode: string) => Promise<Product | null>;
    create: (input: ProductInput) => Promise<Product>;
    update: (id: number, input: ProductInput) => Promise<Product>;
    remove: (id: number) => Promise<boolean>;
    adjustStock: (
      productId: number,
      changeQty: number,
      reason: string,
      refType?: string | null,
      refId?: number | null
    ) => Promise<Product>;
    movements: (productId?: number) => Promise<StockMovement[]>;
    getBatches: (productId: number) => Promise<ProductBatch[]>;
    getUnits: (productId: number) => Promise<ProductUnit[]>;
    lowStock: () => Promise<Product[]>;
    categories: () => Promise<Category[]>;
    createCategory: (name: string) => Promise<Category>;
    units: () => Promise<Unit[]>;
    generateBarcode: () => Promise<string>;
  };
  sales: {
    create: (input: SaleInput) => Promise<SaleCreateResult>;
    get: (id: number) => Promise<(Sale & { items: SaleItem[]; payments: Payment[] }) | null>;
    list: (from?: string, to?: string) => Promise<Sale[]>;
    void: (id: number, reason: string) => Promise<boolean>;
    nextInvoiceNo: () => Promise<string>;
    hold: (kind: 'held' | 'quotation', label: string, data: unknown) => Promise<HeldBill>;
    heldBills: (kind?: 'held' | 'quotation') => Promise<HeldBill[]>;
    getHeld: (id: number) => Promise<HeldBill | null>;
    deleteHeld: (id: number) => Promise<boolean>;
  };
  customers: {
    list: () => Promise<Customer[]>;
    create: (name: string, phone?: string, openingBalance?: number) => Promise<Customer>;
    ledger: (customerId: number) => Promise<CustomerTransaction[]>;
    receivePayment: (customerId: number, amount: number, mode: string, note?: string) => Promise<Customer>;
    setCreditLimit: (customerId: number, limit: number) => Promise<Customer>;
  };
  settings: {
    getAll: () => Promise<SettingsMap>;
    set: (key: string, value: string) => Promise<void>;
    chooseCloudFolder: () => Promise<string | null>;
  };
  printing: {
    printSale: (saleId: number) => Promise<boolean>;
    printLabel: (productId: number, copies?: number) => Promise<boolean>;
    printBarcodeLabel: (productId: number, copies?: number) => Promise<boolean>;
    openCashDrawer: () => Promise<{ ok: boolean; message: string }>;
    previewReceipt: (saleId: number) => Promise<boolean>;
    previewInvoice: (saleId: number) => Promise<boolean>;
    printInvoice: (saleId: number) => Promise<boolean>;
  };
  licensing: {
    activate: (key: string) => Promise<string>;
    check: () => Promise<string>;
  };
  reports: {
    dashboard: () => Promise<DashboardData>;
    expiringSoon: (days?: number) => Promise<ExpiringRow[]>;
    salesReport: (from?: string, to?: string) => Promise<SalesDayRow[]>;
    profitLoss: (from?: string, to?: string) => Promise<ProfitLoss>;
    bestSellers: (from?: string, to?: string, limit?: number) => Promise<BestSellerRow[]>;
    stockValuation: () => Promise<StockValuation>;
    expenses: (from?: string, to?: string) => Promise<Expense[]>;
    addExpense: (input: { title: string; category: string; amount: number; expense_date?: string; notes?: string }) => Promise<Expense>;
    deleteExpense: (id: number) => Promise<boolean>;
    getDailySalesTrend: () => Promise<HourlyTrendRow[]>;
    getTopProducts: (limit?: number) => Promise<TopProductRow[]>;
    getDailyStats: () => Promise<DailyStats>;
    getReceiptSettings: () => Promise<ReceiptSettings>;
    updateReceiptSetting: (key: string, value: string) => Promise<boolean>;
    getSalesAnalysis: (from?: string, to?: string) => Promise<SalesAnalysisResult>;
    getProductPerformance: (from?: string, to?: string) => Promise<ProductPerformanceResult>;
    getCustomerAnalysis: () => Promise<CustomerAnalysisResult>;
    getInventoryAnalysis: () => Promise<InventoryAnalysisResult>;
    getFinancialReport: (from?: string, to?: string) => Promise<FinancialReportResult>;
    getTaxReport: (from?: string, to?: string) => Promise<TaxReportResult>;
    getDailyClosing: (date: string) => Promise<DailyClosingResult>;
    exportReportPDF: (reportType: string, data: unknown) => Promise<string | null>;
  };
  whatsapp: {
    getStatus: () => Promise<WhatsAppStatus>;
    send: (phone: string, text: string) => Promise<WhatsAppSendResult>;
    sendSaleReceipt: (saleId: number, phone?: string) => Promise<WhatsAppSendResult>;
    onQr: (callback: (qr: string | null) => void) => () => void;
    onStatus: (callback: (status: { connected: boolean; phone?: string | null; error?: string | null }) => void) => () => void;
  };
  activity: {
    list: (limit?: number) => Promise<ActivityRow[]>;
  };
  auth: {
    verify: (username: string, password: string) => Promise<boolean>;
    login: (username: string, password: string) => Promise<LoginResult>;
    loginWithPin: (pin: string) => Promise<LoginResult>;
    logout: () => Promise<boolean>;
    currentUser: () => Promise<UserRow | null>;
    verifyForUser: (userId: number, secret: string) => Promise<boolean>;
    defaultPasswordActive: () => Promise<boolean>;
  };
  users: {
    list: () => Promise<UserRow[]>;
    create: (input: UserInput) => Promise<UserRow>;
    update: (id: number, input: { password?: string; pin?: string; role?: UserRole; active?: boolean }) => Promise<UserRow>;
    remove: (id: number) => Promise<boolean>;
  };
  shifts: {
    open: (openingCash: number) => Promise<ShiftRow>;
    close: (id: number, countedCash: number, notes?: string) => Promise<ShiftRow>;
    forceClose: (id: number, countedCash?: number, notes?: string) => Promise<ShiftRow>;
    current: () => Promise<ShiftRow | null>;
    list: () => Promise<ShiftRow[]>;
    get: (id: number) => Promise<ShiftDetail>;
  };

  backup: {
    run: () => Promise<BackupResult>;
  };
  exportData: {
    saveCsv: (defaultName: string, headers: string[], rows: (string | number)[][]) => Promise<boolean>;
    saveXlsx: (
      defaultName: string,
      sheets: { name: string; headers: string[]; rows: (string | number | null)[][] }[]
    ) => Promise<boolean>;
  };
  excel: {
    exportProducts: () => Promise<boolean>;
    exportSales: (from?: string, to?: string) => Promise<boolean>;
    exportCustomers: () => Promise<boolean>;
    exportPurchaseOrders: () => Promise<boolean>;
    exportExpenses: (from?: string, to?: string) => Promise<boolean>;
    downloadTemplate: () => Promise<boolean>;
    importProducts: () => Promise<ProductImportResult | null>;
  };
  purchases: {
    suppliers: () => Promise<Supplier[]>;
    createSupplier: (name: string, phone?: string, address?: string) => Promise<Supplier>;
    listOrders: (status?: string) => Promise<PurchaseOrder[]>;
    getOrder: (id: number) => Promise<(PurchaseOrder & { items: PurchaseItem[] }) | null>;
    createOrder: (supplierId: number, items: PurchaseLineInput[]) => Promise<PurchaseOrder>;
    receiveOrder: (id: number) => Promise<PurchaseOrder>;
    cancelOrder: (id: number) => Promise<boolean>;
    ledger: (supplierId: number) => Promise<SupplierTransaction[]>;
    paySupplier: (supplierId: number, amount: number, mode: string, note?: string) => Promise<Supplier>;
    priceHistory: (productId: number) => Promise<PurchasePriceRow[]>;
  };
  returns: {
    create: (
      input: { sale_id: number; items: ReturnInputItem[]; reason?: string; refund_mode: 'cash' | 'credit'; restock: boolean }
    ) => Promise<ReturnRow & { items: ReturnItemRow[] }>;
    list: (from?: string, to?: string) => Promise<ReturnRow[]>;
    get: (id: number) => Promise<(ReturnRow & { items: ReturnItemRow[] }) | null>;
    createCashRefund: (amount: number, reason?: string, mode?: string) => Promise<CashRefundRow>;
    listCashRefunds: (from?: string, to?: string) => Promise<CashRefundRow[]>;
  };
  audits: {
    create: () => Promise<AuditRow & { items: AuditItemRow[] }>;
    list: () => Promise<AuditRow[]>;
    get: (id: number) => Promise<(AuditRow & { items: AuditItemRow[] }) | null>;
    saveCounts: (auditId: number, counts: AuditCountInput[]) => Promise<boolean>;
    complete: (auditId: number) => Promise<AuditRow & { items: AuditItemRow[] }>;
  };
  promotions: {
    list: () => Promise<PromotionRow[]>;
    create: (input: PromotionInput) => Promise<PromotionRow>;
    update: (id: number, input: PromotionInput) => Promise<PromotionRow>;
    remove: (id: number) => Promise<boolean>;
    resolve: (items: { product_id: number; qty: number; price: number }[]) => Promise<ResolvedPromotion[]>;
  };
  inventoryReports: {
    purchaseHistory: (
      productId?: number,
      dateRange?: { start: string; end: string }
    ) => Promise<InventoryReportRow[]>;
    dailyInventory: (date: string) => Promise<DailyInventoryRow[]>;
    weeklyInventory: (weekStart: string, weekEnd: string) => Promise<WeeklyInventoryRow[]>;
    monthlyInventory: (year: number, month: number) => Promise<MonthlyInventoryRow[]>;
    supplierMetrics: (supplierId?: number) => Promise<SupplierMetricRow[]>;
    productPurchaseSummary: (productId: number, months?: number) => Promise<ProductPurchaseSummaryRow[]>;
    createDailySnapshot: (date: string) => Promise<{ created: number; date: string }>;
    addPurchaseOrder: (
      supplierId: number,
      items: Array<{ product_id: number; qty: number; unit_cost: number; unit_name?: string; quantity_received?: number; expiry_date?: string | null; batch_number?: string | null }>,
      notes?: string
    ) => Promise<{ success: boolean; po_id: number; total: number }>;
  };
  profitability: {
    daily: (date: string) => Promise<ProductProfitRow[]>;
    weekly: (start: string, end: string) => Promise<ProductProfitRow[]>;
    monthly: (year: number, month: number) => Promise<ProductProfitRow[]>;
    category: (start: string, end: string) => Promise<CategoryProfitRow[]>;
    lowProfit: (threshold?: number) => Promise<LowProfitRow[]>;
    topProfit: (limit?: number, days?: number) => Promise<ProductProfitRow[]>;
    worstPerforming: (limit?: number, days?: number) => Promise<WorstProductRow[]>;
    breakEven: () => Promise<BreakEvenRow[]>;
    computePeriod: (date: string) => Promise<void>;
  };
  alerts: {
    getAll: () => Promise<AlertRow[]>;
    getUnread: () => Promise<AlertRow[]>;
    markAsRead: (id: number) => Promise<boolean>;
    resolve: (id: number, action: string) => Promise<boolean>;
    checkNow: () => Promise<number>;
  };
};

// ── v1.8.0 Advanced Reports types ──

export interface InventoryReportRow {
  id: number;
  product_id: number;
  product_name: string;
  supplier_name: string;
  supplier_id: number;
  quantity_ordered: number;
  quantity_received: number | null;
  unit_name: string | null;
  cost_per_unit: number;
  total_cost: number;
  order_date: string;
  delivery_date: string | null;
  delivery_status: string;
  batch_number: string | null;
  expiry_date: string | null;
}

export interface DailyInventoryRow {
  product_id: number;
  product_name: string;
  unit_name: string | null;
  opening_qty: number;
  purchases_qty: number;
  sales_qty: number;
  closing_qty: number;
  variance_qty: number;
  stock_qty: number;
}

export interface WeeklyInventoryRow {
  product_id: number;
  product_name: string;
  unit_name: string | null;
  opening_qty: number;
  purchases_qty: number;
  sales_qty: number;
  variance_qty: number;
  days_tracked: number;
}

export interface MonthlyInventoryRow {
  product_id: number;
  product_name: string;
  category_name: string | null;
  total_purchased: number;
  total_sold: number;
  supplier_count: number;
  avg_cost: number;
  avg_selling_price: number;
  current_stock: number;
  unit_name: string | null;
}

export interface SupplierMetricRow {
  supplier_id: number;
  supplier_name: string;
  total_orders: number;
  total_spent: number;
  on_time_pct: number;
  average_cost: number;
  reliability_score: number;
  last_order_date: string | null;
  first_order_date: string | null;
  is_active: number;
}

export interface ProductPurchaseSummaryRow {
  id: number;
  order_date: string;
  supplier_name: string;
  quantity: number;
  cost_per_unit: number;
  total_cost: number;
  delivery_status: string;
  expiry_date: string | null;
  batch_number: string | null;
  qty_sold_since: number;
}

export interface ProductProfitRow {
  product_id: number;
  product_name: string;
  category: string | null;
  period: string;
  units_sold: number;
  cost_of_goods: number;
  revenue: number;
  gross_profit: number;
  profit_margin_pct: number;
  avg_cost: number;
  avg_selling_price: number;
}

export interface CategoryProfitRow {
  category_name: string | null;
  product_count: number;
  units_sold: number;
  revenue: number;
  cost_of_goods: number;
  gross_profit: number;
  profit_margin_pct: number;
}

export interface LowProfitRow {
  product_id: number;
  product_name: string;
  cost_price: number;
  sale_price: number;
  profit_per_unit: number;
  margin_pct: number;
  sold_last_30days: number;
  stock_qty: number;
}

export interface WorstProductRow {
  product_id: number;
  product_name: string;
  category: string | null;
  units_sold: number;
  revenue: number;
  cogs: number;
  total_profit: number;
  profit_margin_pct: number | null;
  stock_qty: number;
  days_no_sale: number | null;
}

export interface BreakEvenRow {
  product_id: number;
  product_name: string;
  cost_price: number;
  sale_price: number;
  break_even_price: number;
  units_to_breakeven: number | null;
  status: string;
}

export interface AlertRow {
  id: number;
  alert_type: string;
  product_id: number | null;
  supplier_id: number | null;
  product_name?: string | null;
  supplier_name?: string | null;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  is_read: boolean;
  action_taken: string | null;
  created_at: string;
  resolved_at: string | null;
}
