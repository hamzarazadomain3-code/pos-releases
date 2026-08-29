import { contextBridge, ipcRenderer } from 'electron';
import type { PosBridge } from '../shared/types';

const bridge: PosBridge = {
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
  },
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.invoke('updater:install'),
    getState: () => ipcRenderer.invoke('updater:getState'),
    onStatus: (callback: (status: { state: string; detail?: string }) => void) => {
      const listener = (_e: unknown, status: { state: string; detail?: string }) => callback(status);
      ipcRenderer.on('updater:status', listener);
      return () => ipcRenderer.removeListener('updater:status', listener);
    },
  },
  inventory: {
    list: (search?: string, includeInactive?: boolean, categoryId?: number, stockStatus?: 'in_stock' | 'low_stock' | 'out_of_stock', supplierId?: number, expiryFrom?: string, expiryTo?: string) =>
      ipcRenderer.invoke('inventory:list', search, includeInactive, categoryId, stockStatus, supplierId, expiryFrom, expiryTo),
    get: (id: number) => ipcRenderer.invoke('inventory:get', id),
    getByBarcode: (barcode: string) => ipcRenderer.invoke('inventory:getByBarcode', barcode),
    create: (input) => ipcRenderer.invoke('inventory:create', input),
    update: (id: number, input) => ipcRenderer.invoke('inventory:update', id, input),
    remove: (id: number) => ipcRenderer.invoke('inventory:remove', id),
    adjustStock: (productId: number, changeQty: number, reason: string, refType?: string | null, refId?: number | null) =>
      ipcRenderer.invoke('inventory:adjustStock', productId, changeQty, reason, refType, refId),
    movements: (productId?: number) => ipcRenderer.invoke('inventory:movements', productId),
    getBatches: (productId: number) => ipcRenderer.invoke('inventory:getBatches', productId),
    getUnits: (productId: number) => ipcRenderer.invoke('inventory:getUnits', productId),
    lowStock: () => ipcRenderer.invoke('inventory:lowStock'),
    categories: () => ipcRenderer.invoke('inventory:categories'),
    createCategory: (name: string) => ipcRenderer.invoke('inventory:createCategory', name),
    units: () => ipcRenderer.invoke('inventory:units'),
    generateBarcode: () => Promise.resolve(generateEan13Local()),
  },
  sales: {
    create: (input) => ipcRenderer.invoke('sales:create', input),
    get: (id: number) => ipcRenderer.invoke('sales:get', id),
    list: (from?: string, to?: string, includeVoided?: boolean, customerId?: number, userId?: number, paymentMode?: string, productId?: number, minAmount?: number, maxAmount?: number, saleNo?: string, sortBy?: 'date' | 'amount' | 'saleNo', sortOrder?: 'asc' | 'desc', onlyMySales?: boolean, status?: 'completed' | 'voided' | 'held') => ipcRenderer.invoke('sales:list', from, to, includeVoided, customerId, userId, paymentMode, productId, minAmount, maxAmount, saleNo, sortBy, sortOrder, onlyMySales, status),
    void: (id: number, reason: string) => ipcRenderer.invoke('sales:void', id, reason),
    nextInvoiceNo: () => ipcRenderer.invoke('sales:nextInvoiceNo'),
    hold: (kind: 'held' | 'quotation', label: string, data: unknown) =>
      ipcRenderer.invoke('sales:hold', kind, label, data),
    heldBills: (kind?: 'held' | 'quotation') => ipcRenderer.invoke('sales:heldBills', kind),
    getHeld: (id: number) => ipcRenderer.invoke('sales:getHeld', id),
    deleteHeld: (id: number) => ipcRenderer.invoke('sales:deleteHeld', id),
  },
  customers: {
    list: () => ipcRenderer.invoke('customers:list'),
    create: (name: string, phone?: string) => ipcRenderer.invoke('customers:create', name, phone),
    ledger: (customerId: number) => ipcRenderer.invoke('customers:ledger', customerId),
    receivePayment: (customerId: number, amount: number, mode: string, note?: string) =>
      ipcRenderer.invoke('customers:receivePayment', customerId, amount, mode, note),
    setCreditLimit: (customerId: number, limit: number) =>
      ipcRenderer.invoke('customers:setCreditLimit', customerId, limit),
  },
  // BayLan Label Scale barcode handlers
  scaleBarcode: {
    parse: (barcode: string) => ipcRenderer.invoke('scaleBarcode:parse', barcode),
    isScaleItem: (barcode: string) => ipcRenderer.invoke('scaleBarcode:isScaleItem', barcode),
    listPluMappings: () => ipcRenderer.invoke('scaleBarcode:listPluMappings'),
  },
  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
    chooseCloudFolder: () => ipcRenderer.invoke('settings:chooseCloudFolder'),
  },
  printing: {
    // existing printing methods
    printSale: (saleId: number) => ipcRenderer.invoke('printing:printSale', saleId),
    printLabel: (productId: number, copies?: number) => ipcRenderer.invoke('printing:printLabel', productId, copies),
    printBarcodeLabel: (productId: number, copies?: number) => ipcRenderer.invoke('printing:printBarcodeLabel', productId, copies),
    openCashDrawer: () => ipcRenderer.invoke('printing:openCashDrawer'),
    previewReceipt: (saleId: number) => ipcRenderer.invoke('printing:previewReceipt', saleId),
    previewInvoice: (saleId: number) => ipcRenderer.invoke('printing:previewInvoice', saleId),
    printInvoice: (saleId: number) => ipcRenderer.invoke('printing:printInvoice', saleId),
    printDrawerSummary: (data: { opening_cash: number; closing_cash: number; cash_sales: number; card_sales: number; udhaar_sales: number; other_payments: number; cash_refunds: number; cash_in: number; cash_out: number; expected_cash: number; actual_cash: number; variance: number; opened_at: string; closed_at: string; cashier: string; notes?: string }) => ipcRenderer.invoke('printing:printDrawerSummary', data),
  },
  licensing: {
    activate: (key: string) => ipcRenderer.invoke('licensing:activate', key),
    check: () => ipcRenderer.invoke('licensing:check')
  },
  reports: {
    dashboard: () => ipcRenderer.invoke('reports:dashboard'),
    expiringSoon: (days?: number) => ipcRenderer.invoke('reports:expiringSoon', days),
    salesReport: (from?: string, to?: string) => ipcRenderer.invoke('reports:salesReport', from, to),
    profitLoss: (from?: string, to?: string) => ipcRenderer.invoke('reports:profitLoss', from, to),
    bestSellers: (from?: string, to?: string, limit?: number) => ipcRenderer.invoke('reports:bestSellers', from, to, limit),
    stockValuation: () => ipcRenderer.invoke('reports:stockValuation'),
    expenses: (from?: string, to?: string) => ipcRenderer.invoke('reports:expenses', from, to),
    addExpense: (input) => ipcRenderer.invoke('reports:addExpense', input),
    deleteExpense: (id: number) => ipcRenderer.invoke('reports:deleteExpense', id),
    getDailySalesTrend: () => ipcRenderer.invoke('reports:getDailySalesTrend'),
    getTopProducts: (limit?: number) => ipcRenderer.invoke('reports:getTopProducts', limit),
    getDailyStats: () => ipcRenderer.invoke('reports:getDailyStats'),
    getReceiptSettings: () => ipcRenderer.invoke('reports:getReceiptSettings'),
    updateReceiptSetting: (key: string, value: string) => ipcRenderer.invoke('reports:updateReceiptSetting', key, value),
    getSalesAnalysis: (from?: string, to?: string) => ipcRenderer.invoke('reports:getSalesAnalysis', from, to),
    getProductPerformance: (from?: string, to?: string) => ipcRenderer.invoke('reports:getProductPerformance', from, to),
    getCustomerAnalysis: () => ipcRenderer.invoke('reports:getCustomerAnalysis'),
    getInventoryAnalysis: () => ipcRenderer.invoke('reports:getInventoryAnalysis'),
    getFinancialReport: (from?: string, to?: string) => ipcRenderer.invoke('reports:getFinancialReport', from, to),
    getTaxReport: (from?: string, to?: string) => ipcRenderer.invoke('reports:getTaxReport', from, to),
    getDailyClosing: (date: string) => ipcRenderer.invoke('reports:getDailyClosing', date),
    exportReportPDF: (reportType: string, data: unknown) => ipcRenderer.invoke('reports:exportReportPDF', reportType, data),
    exportReportExcel: (reportType: string, data: unknown) => ipcRenderer.invoke('reports:exportReportExcel', reportType, data),
  },
  whatsapp: {
    getStatus: () => ipcRenderer.invoke('whatsapp:status'),
    start: () => ipcRenderer.invoke('whatsapp:start'),
    send: (phone: string, text: string) => ipcRenderer.invoke('whatsapp:send', phone, text),
    sendSaleReceipt: (saleId: number, phone?: string) => ipcRenderer.invoke('whatsapp:sendSaleReceipt', saleId, phone),
    onQr: (callback: (qr: string | null) => void) => {
      const listener = (_e: unknown, qr: string | null) => callback(qr);
      ipcRenderer.on('whatsapp:qr', listener);
      return () => ipcRenderer.removeListener('whatsapp:qr', listener);
    },
    onStatus: (callback: (status: { connected: boolean; phone?: string | null; error?: string | null }) => void) => {
      const listener = (_e: unknown, status: { connected: boolean; phone?: string | null; error?: string | null }) => callback(status);
      ipcRenderer.on('whatsapp:status', listener);
      return () => ipcRenderer.removeListener('whatsapp:status', listener);
    },
  },
  activity: {
    list: (limit?: number) => ipcRenderer.invoke('activity:list', limit),
  },
  auth: {
    verify: (username: string, password: string) => ipcRenderer.invoke('auth:verify', username, password),
    login: (username: string, password: string) => ipcRenderer.invoke('auth:login', username, password),
    loginWithPin: (pin: string) => ipcRenderer.invoke('auth:loginWithPin', pin),
    logout: () => ipcRenderer.invoke('auth:logout'),
    currentUser: () => ipcRenderer.invoke('auth:currentUser'),
    refreshSession: () => ipcRenderer.invoke('auth:refreshSession'),
    verifyForUser: (userId: number, secret: string) => ipcRenderer.invoke('auth:verifyForUser', userId, secret),
    defaultPasswordActive: () => ipcRenderer.invoke('auth:defaultPasswordActive'),
  },
  users: {
    list: () => ipcRenderer.invoke('users:list'),
    create: (input) => ipcRenderer.invoke('users:create', input),
    update: (id: number, input) => ipcRenderer.invoke('users:update', id, input),
    remove: (id: number) => ipcRenderer.invoke('users:remove', id),
  },
  shifts: {
    open: (openingCash: number) => ipcRenderer.invoke('shifts:open', openingCash),
    close: (id: number, countedCash: number, notes?: string) => ipcRenderer.invoke('shifts:close', id, countedCash, notes),
    forceClose: (id: number, countedCash?: number, notes?: string) =>
      ipcRenderer.invoke('shifts:forceClose', id, countedCash, notes),
    current: () => ipcRenderer.invoke('shifts:current'),
    list: () => ipcRenderer.invoke('shifts:list'),
    get: (id: number) => ipcRenderer.invoke('shifts:get', id),
  },

  backup: {
    run: () => ipcRenderer.invoke('backup:run'),
  },
  exportData: {
    saveCsv: (defaultName: string, headers: string[], rows: (string | number)[][]) =>
      ipcRenderer.invoke('export:saveCsv', defaultName, headers, rows),
    saveXlsx: (defaultName: string, sheets: { name: string; headers: string[]; rows: (string | number | null)[][] }[]) =>
      ipcRenderer.invoke('export:saveXlsx', defaultName, sheets),
  },
  excel: {
    exportProducts: (filters?: { search?: string; includeInactive?: boolean; categoryId?: number; stockStatus?: 'in_stock' | 'low_stock' | 'out_of_stock'; supplierId?: number; expiryFrom?: string; expiryTo?: string }) => ipcRenderer.invoke('excel:exportProducts', filters),
    exportSales: (from?: string, to?: string) => ipcRenderer.invoke('excel:exportSales', from, to),
    exportCustomers: (filters?: { status?: 'paid' | 'pending' | 'all'; from?: string; to?: string }) => ipcRenderer.invoke('excel:exportCustomers', filters),
    exportPurchaseOrders: (filters?: { status?: string; from?: string; to?: string; supplierId?: number }) => ipcRenderer.invoke('excel:exportPurchaseOrders', filters),
    exportExpenses: (from?: string, to?: string) => ipcRenderer.invoke('excel:exportExpenses', from, to),
    downloadTemplate: () => ipcRenderer.invoke('excel:downloadTemplate'),
    importProducts: () => ipcRenderer.invoke('excel:importProducts'),
  },
  purchases: {
    suppliers: () => ipcRenderer.invoke('purchases:suppliers'),
    createSupplier: (name: string, phone?: string, address?: string) =>
      ipcRenderer.invoke('purchases:createSupplier', name, phone, address),
    listOrders: (status?: string, from?: string, to?: string, supplierId?: number) => ipcRenderer.invoke('purchases:orders', status, from, to, supplierId),
    getOrder: (id: number) => ipcRenderer.invoke('purchases:getOrder', id),
    createOrder: (supplierId: number, items) => ipcRenderer.invoke('purchases:createOrder', supplierId, items),
    receiveOrder: (id: number) => ipcRenderer.invoke('purchases:receiveOrder', id),
    cancelOrder: (id: number) => ipcRenderer.invoke('purchases:cancelOrder', id),
    ledger: (supplierId: number) => ipcRenderer.invoke('purchases:ledger', supplierId),
    paySupplier: (supplierId: number, amount: number, mode: string, note?: string) =>
      ipcRenderer.invoke('purchases:paySupplier', supplierId, amount, mode, note),
    priceHistory: (productId: number) => ipcRenderer.invoke('purchases:priceHistory', productId),
  },
  returns: {
    create: (input) => ipcRenderer.invoke('returns:create', input),
    list: (from?: string, to?: string, customerId?: number, productId?: number) => ipcRenderer.invoke('returns:list', from, to, customerId, productId),
    get: (id: number) => ipcRenderer.invoke('returns:get', id),
    createCashRefund: (amount: number, reason?: string, mode?: string) =>
      ipcRenderer.invoke('returns:createCashRefund', amount, reason, mode),
    listCashRefunds: (from?: string, to?: string) => ipcRenderer.invoke('returns:listCashRefunds', from, to),
  },
  audits: {
    create: () => ipcRenderer.invoke('audits:create'),
    list: () => ipcRenderer.invoke('audits:list'),
    listPaginated: (page?: number, pageSize?: number, from?: string, to?: string, userId?: number, status?: 'in_progress' | 'completed') =>
      ipcRenderer.invoke('audits:listPaginated', page, pageSize, from, to, userId, status),
    get: (id: number) => ipcRenderer.invoke('audits:get', id),
    saveCounts: (auditId: number, counts) => ipcRenderer.invoke('audits:saveCounts', auditId, counts),
    complete: (auditId: number) => ipcRenderer.invoke('audits:complete', auditId),
  },
   promotions: {
    list: () => ipcRenderer.invoke('promotions:list'),
    create: (input) => ipcRenderer.invoke('promotions:create', input),
    update: (id: number, input) => ipcRenderer.invoke('promotions:update', id, input),
    remove: (id: number) => ipcRenderer.invoke('promotions:remove', id),
    resolve: (items) => ipcRenderer.invoke('promotions:resolve', items),
  },
  inventoryReports: {
    purchaseHistory: (productId?: number, dateRange?: { start: string; end: string }) =>
      ipcRenderer.invoke('inventoryReports:purchaseHistory', productId, dateRange),
    dailyInventory: (date: string) => ipcRenderer.invoke('inventoryReports:dailyInventory', date),
    weeklyInventory: (weekStart: string, weekEnd: string) =>
      ipcRenderer.invoke('inventoryReports:weeklyInventory', weekStart, weekEnd),
    monthlyInventory: (year: number, month: number) =>
      ipcRenderer.invoke('inventoryReports:monthlyInventory', year, month),
    supplierMetrics: (supplierId?: number) => ipcRenderer.invoke('inventoryReports:supplierMetrics', supplierId),
    productPurchaseSummary: (productId: number, months?: number) =>
      ipcRenderer.invoke('inventoryReports:productPurchaseSummary', productId, months),
    createDailySnapshot: (date: string) => ipcRenderer.invoke('inventoryReports:createDailySnapshot', date),
    addPurchaseOrder: (supplierId: number, items: any[], notes?: string) =>
      ipcRenderer.invoke('inventoryReports:addPurchaseOrder', supplierId, items, notes),
  },
  profitability: {
    daily: (date: string) => ipcRenderer.invoke('profitability:daily', date),
    weekly: (start: string, end: string) => ipcRenderer.invoke('profitability:weekly', start, end),
    monthly: (year: number, month: number) => ipcRenderer.invoke('profitability:monthly', year, month),
    category: (start: string, end: string) => ipcRenderer.invoke('profitability:category', start, end),
    lowProfit: (threshold?: number) => ipcRenderer.invoke('profitability:lowProfit', threshold),
    topProfit: (limit?: number, days?: number) => ipcRenderer.invoke('profitability:topProfit', limit, days),
    worstPerforming: (limit?: number, days?: number) =>
      ipcRenderer.invoke('profitability:worstPerforming', limit, days),
    breakEven: () => ipcRenderer.invoke('profitability:breakEven'),
    computePeriod: (date: string) => ipcRenderer.invoke('profitability:computePeriod', date),
  },
  alerts: {
    getAll: () => ipcRenderer.invoke('alerts:getAll'),
    getUnread: () => ipcRenderer.invoke('alerts:getUnread'),
    markAsRead: (id: number) => ipcRenderer.invoke('alerts:markAsRead', id),
    resolve: (id: number, action: string) => ipcRenderer.invoke('alerts:resolve', id, action),
    checkNow: () => ipcRenderer.invoke('alerts:checkNow'),
    sendWhatsApp: () => ipcRenderer.invoke('alerts:sendWhatsApp'),
    sendDailySummary: () => ipcRenderer.invoke('alerts:sendDailySummary'),
  },
  cashDrawer: {
    open: (shiftId: number, openingCash: number) => ipcRenderer.invoke('cashDrawer:open', shiftId, openingCash),
    close: (shiftId: number, closingCash: number, notes?: string) => ipcRenderer.invoke('cashDrawer:close', shiftId, closingCash, notes),
    getCurrent: (shiftId: number) => ipcRenderer.invoke('cashDrawer:getCurrent', shiftId),
    getBreakdown: (shiftId: number) => ipcRenderer.invoke('cashDrawer:getBreakdown', shiftId),
    history: (shiftId?: number) => ipcRenderer.invoke('cashDrawer:history', shiftId),
  },
  admin: {
    shortcuts: {
      getAll: () => ipcRenderer.invoke('admin:shortcuts:getAll'),
      update: (action: string, key: string) => ipcRenderer.invoke('admin:shortcuts:update', action, key),
      reset: () => ipcRenderer.invoke('admin:shortcuts:reset'),
    },
    features: {
      getAll: () => ipcRenderer.invoke('admin:features:getAll'),
      toggle: (name: string) => ipcRenderer.invoke('admin:features:toggle', name),
      isEnabled: (name: string) => ipcRenderer.invoke('admin:features:isEnabled', name),
    },
    roles: {
      getAll: () => ipcRenderer.invoke('admin:roles:getAll'),
      create: (name: string, description?: string) => ipcRenderer.invoke('admin:roles:create', name, description),
      update: (id: number, data: { name?: string; description?: string }) => ipcRenderer.invoke('admin:roles:update', id, data),
      delete: (id: number) => ipcRenderer.invoke('admin:roles:delete', id),
      getPermissions: (roleId: number) => ipcRenderer.invoke('admin:roles:getPermissions', roleId),
      setPermissions: (roleId: number, permissions: { permission_name: string; is_allowed: boolean }[]) => ipcRenderer.invoke('admin:roles:setPermissions', roleId, permissions),
    },
    settings: {
      getAll: () => ipcRenderer.invoke('admin:settings:getAll'),
      get: (key: string) => ipcRenderer.invoke('admin:settings:get', key),
      set: (key: string, value: string) => ipcRenderer.invoke('admin:settings:set', key, value),
      setBatch: (settings: Record<string, string>) => ipcRenderer.invoke('admin:settings:setBatch', settings),
      resetDefaults: () => ipcRenderer.invoke('admin:settings:resetDefaults'),
      onChange: (cb: () => void) => {
        const handler = () => cb();
        ipcRenderer.on('admin:settings:changed', handler);
        return () => { ipcRenderer.removeListener('admin:settings:changed', handler); };
      },
    },
    activity: {
      getAll: (filters?: { from?: string; to?: string; user_id?: number; action?: string; limit?: number; offset?: number }) => ipcRenderer.invoke('admin:activity:getAll', filters),
      clear: (retentionDays: number) => ipcRenderer.invoke('admin:activity:clear', retentionDays),
    },
    users: {
      getAll: () => ipcRenderer.invoke('admin:users:getAll'),
      resetPassword: (userId: number, newPassword: string) => ipcRenderer.invoke('admin:users:resetPassword', userId, newPassword),
    },
    systemHealth: () => ipcRenderer.invoke('admin:systemHealth'),
  },
  twoFactor: {
    isEnabled: () => ipcRenderer.invoke('2fa:isEnabled'),
    method: () => ipcRenderer.invoke('2fa:method'),
    generateOtp: (userId: number) => ipcRenderer.invoke('2fa:generateOtp', userId),
    verifyOtp: (userId: number, code: string) => ipcRenderer.invoke('2fa:verifyOtp', userId, code),
  },
  email: {
    send: (options: { to: string | string[]; subject: string; text?: string; html?: string }) => ipcRenderer.invoke('email:send', options),
    sendDailyReport: () => ipcRenderer.invoke('email:sendDailyReport'),
  },
};

function generateEan13Local(): string {
  const digits = '2' + String(Date.now()).slice(-4) + Array.from({ length: 7 }, (_, i) => (i + Date.now()) % 10).join('');
  return digits.slice(0, 12);
}

contextBridge.exposeInMainWorld('api', bridge);