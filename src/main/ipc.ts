import { ipcMain, BrowserWindow, dialog } from 'electron';
import {
  adjustStock,
  createCategory,
  createProduct,
  deleteProduct,
  getProduct,
  getProductByBarcode,
  getBatches,
  getUnits,
  listCategories,
  listLowStock,
  listMovements,
  listProducts,
  listUnits,
  updateProduct,
} from './services/inventory';
import { parseBayLanBarcode, isScaleBarcode, listPluMappings } from './services/scaleBarcode';
import { getInventoryReports } from './services/inventoryReports';
import { getProfitabilityService } from './services/profitability';
import { getAlertService } from './services/alertService';
import {
  createCustomer,
  createSale,
  customerLedger,
  deleteHeldBill,
  getHeldBill,
  getSale,
  holdBill,
  listCustomers,
  listHeldBills,
  listSales,
  nextInvoiceNo,
  receivePayment,
  setCreditLimit,
  voidSale,
} from './services/sales';
import { getAllSettings, setSetting } from './services/settings';
import { printLabel, printBarcodeLabel, printSale, previewReceipt, previewInvoice, printInvoice, openCashDrawer } from './services/printing';
import {
  addExpense,
  bestSellers,
  dashboard,
  deleteExpense,
  exportReportPDF,
  exportReportExcel,
  getCustomerAnalysis,
  getDailyClosing,
  getDailySalesTrend,
  getDailyStats,
  getFinancialReport,
  getInventoryAnalysis,
  getProductPerformance,
  getReceiptSettings,
  getSalesAnalysis,
  getTaxReport,
  getTopProducts,
  listExpenses,
  listExpiringSoon,
  profitLoss,
  salesReport,
  stockValuation,
  updateReceiptSetting,
} from './services/reports';
import { listActivity } from './services/activity';
import {
  createUser,
  currentUser,
  deleteUser,
  listUsers,
  login,
  loginWithPin,
  logout,
  refreshSession,
  updateUser,
  verifyCredentials,
  verifyForUser,
  can,
  defaultPasswordActive,
} from './services/auth';
import { runBackup } from './services/backup';
import { openShift, closeShift, forceCloseShift, currentShift, listShifts, getShift } from './services/shifts';
import { saveCsv, saveXlsx, exportProductsXlsx, exportSalesXlsx, exportCustomersXlsx, exportPurchaseOrdersXlsx, exportExpensesXlsx, downloadProductTemplate, importProductsFromExcel } from './services/export';
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  createSupplier,
  getPurchaseOrder,
  listPurchaseOrders,
  listSuppliers,
  paySupplier,
  purchasePriceHistory,
  receivePurchaseOrder,
  supplierLedger,
} from './services/purchases';
import { createReturn, createCashRefund, getReturn, listReturns, listCashRefunds } from './services/returns';
import {
  completeAudit,
  createAudit,
  getAudit,
  listAudits,
  saveCounts,
} from './services/audits';
import {
  createPromotion,
  deletePromotion,
  listPromotions,
  resolvePromotions,
  updatePromotion,
} from './services/promotions';
import { getWhatsAppStatus, restartWhatsAppGateway, sendSaleReceiptOnWhatsApp, sendWhatsAppReceipt } from './whatsapp-gateway';

export function registerIpcHandlers(): void {
  ipcMain.handle('inventory:list', (_e, search?: string, includeInactive?: boolean) =>
    listProducts(search, includeInactive)
  );
  ipcMain.handle('inventory:get', (_e, id: number) => getProduct(id));
  ipcMain.handle('inventory:getByBarcode', (_e, barcode: string) => getProductByBarcode(barcode));
  ipcMain.handle('inventory:create', (_e, input) => createProduct(input));
  ipcMain.handle('inventory:update', (_e, id: number, input) => updateProduct(id, input));
  ipcMain.handle('inventory:remove', (_e, id: number) => deleteProduct(id));
  ipcMain.handle('inventory:adjustStock', (_e, productId: number, changeQty: number, reason: string, refType?: string | null, refId?: number | null) =>
    adjustStock(productId, changeQty, reason, refType, refId)
  );
  ipcMain.handle('inventory:movements', (_e, productId?: number) => listMovements(productId));
  ipcMain.handle('inventory:getBatches', (_e, productId: number) => getBatches(productId));
  ipcMain.handle('inventory:getUnits', (_e, productId: number) => getUnits(productId));
  ipcMain.handle('inventory:lowStock', () => listLowStock());
  ipcMain.handle('inventory:categories', () => listCategories());
  ipcMain.handle('inventory:createCategory', (_e, name: string) => createCategory(name));
  ipcMain.handle('inventory:units', () => listUnits());

  ipcMain.handle('sales:create', (_e, input) => createSale(input));
  ipcMain.handle('sales:get', (_e, id: number) => getSale(id));
  ipcMain.handle('sales:list', (_e, from?: string, to?: string, includeVoided?: boolean, customerId?: number, userId?: number, paymentMode?: string, productId?: number, minAmount?: number, maxAmount?: number, saleNo?: string, sortBy?: 'date' | 'amount' | 'saleNo', sortOrder?: 'asc' | 'desc', onlyMySales?: boolean, status?: 'completed' | 'voided' | 'held') => listSales(from, to, includeVoided, customerId, userId, paymentMode, productId, minAmount, maxAmount, saleNo, sortBy, sortOrder, onlyMySales, status));
  ipcMain.handle('sales:void', (_e, id: number, reason: string) => voidSale(id, reason));
  ipcMain.handle('sales:nextInvoiceNo', () => nextInvoiceNo());
  ipcMain.handle('sales:hold', (_e, kind: string, label: string, data) => holdBill(kind as 'held' | 'quotation', label, data));
  ipcMain.handle('sales:heldBills', (_e, kind?: string) => listHeldBills(kind as 'held' | 'quotation' | undefined));
  ipcMain.handle('sales:getHeld', (_e, id: number) => getHeldBill(id));
  ipcMain.handle('sales:deleteHeld', (_e, id: number) => deleteHeldBill(id));

  ipcMain.handle('customers:list', () => listCustomers());
  ipcMain.handle('customers:create', (_e, name: string, phone?: string) => createCustomer(name, phone));
  ipcMain.handle('customers:ledger', (_e, customerId: number) => customerLedger(customerId));
  ipcMain.handle('customers:receivePayment', (_e, customerId: number, amount: number, mode: string, note?: string) =>
    receivePayment(customerId, amount, mode, note)
  );
  ipcMain.handle('customers:setCreditLimit', (_e, customerId: number, limit: number) => setCreditLimit(customerId, limit));

  ipcMain.handle('settings:getAll', () => getAllSettings());
  ipcMain.handle('settings:set', (_e, key: string, value: string) => {
    if (!can('owner')) throw new Error('Only the owner can change settings');
    return setSetting(key, value);
  });
  ipcMain.handle('settings:chooseCloudFolder', async () => {
    if (!can('owner')) throw new Error('Only the owner can change settings');
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win ?? BrowserWindow.getAllWindows()[0], {
      title: 'Select your OneDrive or Google Drive sync folder',
      properties: ['openDirectory'],
    });
     return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });

  // --- BayLan Label Scale barcode handlers ---
  ipcMain.handle('scaleBarcode:parse', (_e, barcode: string) => parseBayLanBarcode(barcode));
  ipcMain.handle('scaleBarcode:isScaleItem', (_e, barcode: string) => isScaleBarcode(barcode));
  ipcMain.handle('scaleBarcode:listPluMappings', () => listPluMappings());

  ipcMain.handle('printing:printSale', (_e, saleId: number) => {
    printSale(saleId);
    return true;
  });
  ipcMain.handle('printing:previewReceipt', (_e, saleId: number) => {
    previewReceipt(saleId);
    return true;
  });
  ipcMain.handle('printing:previewInvoice', (_e, saleId: number) => {
    previewInvoice(saleId);
    return true;
  });
  ipcMain.handle('printing:printLabel', (_e, productId: number, copies?: number) => printLabel(productId, copies ?? 1));
  ipcMain.handle('printing:printBarcodeLabel', (_e, productId: number, copies?: number) => printBarcodeLabel(productId, copies ?? 1));
  ipcMain.handle('printing:openCashDrawer', () => openCashDrawer());
  ipcMain.handle('printing:printInvoice', (_e, saleId: number) => {
    printInvoice(saleId);
    return true;
  });

  ipcMain.handle('reports:dashboard', () => dashboard());
  ipcMain.handle('reports:expiringSoon', (_e, days?: number) => listExpiringSoon(days));
  ipcMain.handle('reports:salesReport', (_e, from?: string, to?: string) => salesReport(from, to));
  ipcMain.handle('reports:profitLoss', (_e, from?: string, to?: string) => profitLoss(from, to));
  ipcMain.handle('reports:bestSellers', (_e, from?: string, to?: string, limit?: number) => bestSellers(from, to, limit));
  ipcMain.handle('reports:stockValuation', () => stockValuation());
  ipcMain.handle('reports:expenses', (_e, from?: string, to?: string) => listExpenses(from, to));
  ipcMain.handle('reports:addExpense', (_e, input) => addExpense(input));
  ipcMain.handle('reports:deleteExpense', (_e, id: number) => deleteExpense(id));

  ipcMain.handle('reports:getDailySalesTrend', () => getDailySalesTrend());
  ipcMain.handle('reports:getTopProducts', (_e, limit?: number) => getTopProducts(limit ?? 5));
  ipcMain.handle('reports:getDailyStats', () => getDailyStats());
  ipcMain.handle('reports:getReceiptSettings', () => getReceiptSettings());
  ipcMain.handle('reports:updateReceiptSetting', (_e, key: string, value: string) => {
    updateReceiptSetting(key, value);
    return true;
  });

  ipcMain.handle('reports:getSalesAnalysis', (_e, from?: string, to?: string) => getSalesAnalysis(from, to));
  ipcMain.handle('reports:getProductPerformance', (_e, from?: string, to?: string) => getProductPerformance(from, to));
  ipcMain.handle('reports:getCustomerAnalysis', () => getCustomerAnalysis());
  ipcMain.handle('reports:getInventoryAnalysis', () => getInventoryAnalysis());
  ipcMain.handle('reports:getFinancialReport', (_e, from?: string, to?: string) => getFinancialReport(from, to));
  ipcMain.handle('reports:getTaxReport', (_e, from?: string, to?: string) => getTaxReport(from, to));
  ipcMain.handle('reports:getDailyClosing', (_e, date: string) => getDailyClosing(date));
  ipcMain.handle('reports:exportReportPDF', (_e, reportType: string, data: unknown) => exportReportPDF(reportType, data));
  ipcMain.handle('reports:exportReportExcel', (_e, reportType: string, data: unknown) => exportReportExcel(reportType, data));

  ipcMain.handle('whatsapp:status', () => getWhatsAppStatus());
  ipcMain.handle('whatsapp:start', async () => {
    await restartWhatsAppGateway();
    return getWhatsAppStatus();
  });
  ipcMain.handle('whatsapp:send', (_e, phone: string, text: string) => sendWhatsAppReceipt(phone, text));
  ipcMain.handle('whatsapp:sendSaleReceipt', (_e, saleId: number, phone?: string) =>
    sendSaleReceiptOnWhatsApp(saleId, phone)
  );

  ipcMain.handle('activity:list', (_e, limit?: number) => listActivity(limit));

  ipcMain.handle('auth:verify', (_e, username: string, password: string) => verifyCredentials(username, password));
  ipcMain.handle('auth:login', (_e, username: string, password: string) => login(username, password));
  ipcMain.handle('auth:loginWithPin', (_e, pin: string) => loginWithPin(pin));
  ipcMain.handle('auth:logout', () => {
    logout();
    return true;
  });
  ipcMain.handle('auth:currentUser', () => currentUser());
  ipcMain.handle('auth:refreshSession', () => refreshSession());
  ipcMain.handle('auth:verifyForUser', (_e, userId: number, secret: string) => verifyForUser(userId, secret));
  ipcMain.handle('auth:defaultPasswordActive', () => defaultPasswordActive());

  ipcMain.handle('users:list', () => listUsers());
  ipcMain.handle('users:create', (_e, input) => createUser(input));
  ipcMain.handle('users:update', (_e, id: number, input) => updateUser(id, input));
  ipcMain.handle('users:remove', (_e, id: number) => deleteUser(id));

  ipcMain.handle('shifts:open', (_e, openingCash: number) => openShift(openingCash));
  ipcMain.handle('shifts:close', (_e, id: number, countedCash: number, notes?: string) => closeShift(id, countedCash, notes));
  ipcMain.handle('shifts:forceClose', (_e, id: number, countedCash?: number, notes?: string) =>
    forceCloseShift(id, countedCash, notes)
  );
  ipcMain.handle('shifts:current', () => currentShift());
  ipcMain.handle('shifts:list', () => listShifts());
  ipcMain.handle('shifts:get', (_e, id: number) => getShift(id));

  ipcMain.handle('backup:run', () => {
    if (!can('owner')) throw new Error('Only the owner can run backups');
    return runBackup();
  });

  ipcMain.handle('export:saveCsv', (_e, defaultName: string, headers: string[], rows: (string | number)[][]) =>
    saveCsv(BrowserWindow.getFocusedWindow(), defaultName, headers, rows)
  );
  ipcMain.handle('export:saveXlsx', (_e, defaultName: string, sheets) =>
    saveXlsx(BrowserWindow.getFocusedWindow(), defaultName, sheets)
  );

  ipcMain.handle('excel:exportProducts', (_e, filters?: { search?: string; includeInactive?: boolean; categoryId?: number; stockStatus?: 'in_stock' | 'low_stock' | 'out_of_stock'; supplierId?: number; expiryFrom?: string; expiryTo?: string }) => exportProductsXlsx(BrowserWindow.getFocusedWindow(), filters?.search, filters?.includeInactive, filters?.categoryId, filters?.stockStatus, filters?.supplierId, filters?.expiryFrom, filters?.expiryTo));
  ipcMain.handle('excel:exportSales', (_e, from?: string, to?: string) => exportSalesXlsx(BrowserWindow.getFocusedWindow(), from, to));
  ipcMain.handle('excel:exportCustomers', (_e, filters?: { status?: 'paid' | 'pending' | 'all'; from?: string; to?: string }) => exportCustomersXlsx(BrowserWindow.getFocusedWindow(), filters?.status, filters?.from, filters?.to));
  ipcMain.handle('excel:exportPurchaseOrders', (_e, filters?: { status?: string; from?: string; to?: string; supplierId?: number }) => exportPurchaseOrdersXlsx(BrowserWindow.getFocusedWindow(), filters?.status, filters?.from, filters?.to, filters?.supplierId));
  ipcMain.handle('excel:exportExpenses', (_e, from?: string, to?: string) => exportExpensesXlsx(BrowserWindow.getFocusedWindow(), from, to));
  ipcMain.handle('excel:downloadTemplate', () => downloadProductTemplate(BrowserWindow.getFocusedWindow()));
  ipcMain.handle('excel:importProducts', () => importProductsFromExcel(BrowserWindow.getFocusedWindow()));

  ipcMain.handle('purchases:suppliers', () => listSuppliers());
  ipcMain.handle('purchases:createSupplier', (_e, name: string, phone?: string, address?: string) =>
    createSupplier(name, phone, address)
  );
  ipcMain.handle('purchases:orders', (_e, status?: string) => listPurchaseOrders(status));
  ipcMain.handle('purchases:getOrder', (_e, id: number) => getPurchaseOrder(id));
  ipcMain.handle('purchases:createOrder', (_e, supplierId: number, items) => createPurchaseOrder(supplierId, items));
  ipcMain.handle('purchases:receiveOrder', (_e, id: number) => receivePurchaseOrder(id));
  ipcMain.handle('purchases:cancelOrder', (_e, id: number) => cancelPurchaseOrder(id));
  ipcMain.handle('purchases:ledger', (_e, supplierId: number) => supplierLedger(supplierId));
  ipcMain.handle('purchases:paySupplier', (_e, supplierId: number, amount: number, mode: string, note?: string) =>
    paySupplier(supplierId, amount, mode, note)
  );
  ipcMain.handle('purchases:priceHistory', (_e, productId: number) => purchasePriceHistory(productId));

  ipcMain.handle('returns:create', (_e, input) => createReturn(input));
  ipcMain.handle('returns:list', (_e, from?: string, to?: string) => listReturns(from, to));
  ipcMain.handle('returns:get', (_e, id: number) => getReturn(id));
  ipcMain.handle('returns:createCashRefund', (_e, amount: number, reason?: string, mode?: string) =>
    createCashRefund(amount, reason, mode)
  );
  ipcMain.handle('returns:listCashRefunds', (_e, from?: string, to?: string) => listCashRefunds(from, to));

  ipcMain.handle('audits:create', () => createAudit());
  ipcMain.handle('audits:list', () => listAudits());
  ipcMain.handle('audits:get', (_e, id: number) => getAudit(id));
  ipcMain.handle('audits:saveCounts', (_e, auditId: number, counts) => saveCounts(auditId, counts));
  ipcMain.handle('audits:complete', (_e, id: number) => completeAudit(id));

  ipcMain.handle('promotions:list', () => listPromotions());
  ipcMain.handle('promotions:create', (_e, input) => createPromotion(input));
  ipcMain.handle('promotions:update', (_e, id: number, input) => updatePromotion(id, input));
  ipcMain.handle('promotions:remove', (_e, id: number) => deletePromotion(id));
   ipcMain.handle('promotions:resolve', (_e, items) => resolvePromotions(items));

  // ── v1.8.0 Advanced Reports ──
  // Inventory Reports
  const inventoryReports = getInventoryReports();
  ipcMain.handle('inventoryReports:purchaseHistory', (_e, productId?: number, dateRange?: { start: string; end: string }) =>
    inventoryReports.getPurchaseHistory(productId, dateRange)
  );
  ipcMain.handle('inventoryReports:dailyInventory', (_e, date: string) => inventoryReports.computeDailyInventory(date));
  ipcMain.handle('inventoryReports:weeklyInventory', (_e, weekStart: string, weekEnd: string) => inventoryReports.getWeeklyInventory(weekStart, weekEnd));
  ipcMain.handle('inventoryReports:monthlyInventory', (_e, year: number, month: number) => inventoryReports.getMonthlyInventory(year, month));
  ipcMain.handle('inventoryReports:supplierMetrics', (_e, supplierId?: number) => inventoryReports.getSupplierMetrics(supplierId));
  ipcMain.handle('inventoryReports:productPurchaseSummary', (_e, productId: number, months?: number) => inventoryReports.getProductPurchaseSummary(productId, months));
  ipcMain.handle('inventoryReports:createDailySnapshot', (_e, date: string) => inventoryReports.createDailySnapshot(date));
  ipcMain.handle('inventoryReports:addPurchaseOrder', (_e, supplierId: number, items: any[], notes?: string) => inventoryReports.addPurchaseOrder(supplierId, items, notes));

  // Profitability
  const profitabilityService = getProfitabilityService();
  ipcMain.handle('profitability:daily', (_e, date: string) => profitabilityService.getDailyProfitability(date));
  ipcMain.handle('profitability:weekly', (_e, start: string, end: string) => profitabilityService.getWeeklyProfitability(start, end));
  ipcMain.handle('profitability:monthly', (_e, year: number, month: number) => profitabilityService.getMonthlyProfitability(year, month));
  ipcMain.handle('profitability:category', (_e, start: string, end: string) => profitabilityService.getCategoryProfitability(start, end));
  ipcMain.handle('profitability:lowProfit', (_e, threshold?: number) => profitabilityService.getLowProfitProducts(threshold));
  ipcMain.handle('profitability:topProfit', (_e, limit?: number, days?: number) => profitabilityService.getTopProfitProducts(limit, days));
  ipcMain.handle('profitability:worstPerforming', (_e, limit?: number, days?: number) => profitabilityService.getWorstPerformingProducts(limit, days));
  ipcMain.handle('profitability:breakEven', () => profitabilityService.getBreakEvenAnalysis());
  ipcMain.handle('profitability:computePeriod', (_e, date: string) => profitabilityService.computePeriodProfitability(date));

  // Alerts
  const alertService = getAlertService();
  ipcMain.handle('alerts:getAll', () => alertService.getAll());
  ipcMain.handle('alerts:getUnread', () => alertService.getUnread());
  ipcMain.handle('alerts:markAsRead', (_e, id: number) => alertService.markAsRead(id));
  ipcMain.handle('alerts:resolve', (_e, id: number, action: string) => alertService.resolve(id, action));
  ipcMain.handle('alerts:checkNow', () => alertService.checkAndCreateAlerts());
  ipcMain.handle('alerts:sendWhatsApp', () => alertService.sendAlertsWhatsApp());
  ipcMain.handle('alerts:sendDailySummary', () => alertService.sendDailySalesSummary());
}