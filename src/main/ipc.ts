import { ipcMain, BrowserWindow, dialog } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { wrapIpcHandler } from './ipcError';
import {
  SECRET_MASK,
  SECRET_ADMIN_KEYS,
  SECRET_SETTING_KEYS,
  isMaskedSecret,
  maskSecrets,
} from './utils/secrets';
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
import { getSidebarBadges } from './services/sidebarBadges';
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
  resumeHeldBill,
  setCreditLimit,
  voidSale,
} from './services/sales';
import {
  getHistoryDetail,
  historyDefaults,
  historyOpenHeldCount,
  historySummary,
  historyTypeCounts,
  historyPresetRange,
  listHistoryEvents,
  printHistoryReport,
} from './services/salesHistory';
import { getAllSettings, setSetting } from './services/settings';
import {
  amendCustomer,
  amendItems,
  amendNotes,
  amendPayments,
  getBillAmendView,
  listAmendments,
} from './services/billAmendments';
import {
  getAssistantSettingsView,
  saveAssistantSettings,
  setAssistantApiKey,
  setAssistantOptOut,
  assistantOptedOut,
} from './services/assistant/settings';
import { createProviderForSettings, testAssistantConnection } from './services/assistant/runtime';
import { ProviderError } from './services/assistant/provider';
import { resolveAssistantApiKey } from './services/assistant/settings';
import { listAssistantActivity } from './services/assistant/activity';
import { cancelAssistantTurn, confirmAssistantAction, cancelAssistantAction, assistantPendingActions, runAssistantTurn } from './services/assistant/agent';
import { getProactiveSuggestions } from './services/assistant/proactive';
import { transcribeWav, voiceSupport } from './services/assistant/voice';
import {
  printLabel,
  printBarcodeLabel,
  printBarcodeBatch,
  previewBarcodeBatch,
  printBarcodeBatchWithOptions,
  exportLabelBatchToPDF,
  exportLabelBatchToPNG,
  printCalibrationLabel,
  printSale,
  previewReceipt,
  previewInvoice,
  printInvoice,
  printDrawerSummary,
  printTestSheet,
  printDesignSample,
  reprintLastReceipt,
  printReport,
  previewReport,
  openCashDrawer,
  AUTO_PRINTER,
  type ReceiptTemplate,
  type LabelSize,
  type PaperKind,
  type LabelRunOptions,
  type PrintSaleOptions,
} from './services/printing';
import { getAvailableTemplates } from './services/receiptTemplates';
import {
  buildDesignedReceiptAsync,
  buildSampleSale,
  getReceiptDesign,
  getReceiptLibrary,
  isReceiptDesignEnabled,
  RECEIPT_DESIGN_ENABLED_KEY,
  RECEIPT_DESIGN_KEY,
  saveReceiptLibrary,
} from './services/receiptDesigner';
import {
  normalizeReceiptDesign,
  type ReceiptDesign,
  type ReceiptPaper,
} from '../shared/receiptDesign';
import {
  getAvailablePrinters,
  getConfiguredPrinter,
  getConfiguredPaper,
  getLabelLayout,
  getPrintMode,
  invalidatePrinterCache,
  getBarcodeDpi,
  PAPER_SPECS,
  LABEL_SPECS,
} from './services/printService';
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
  getDailySalesTrendDaily,
  getDailyStats,
  getFinancialReport,
  getInventoryAnalysis,
  getProductPerformance,
  getReceiptSettings,
  getSalesAnalysis,
  getTaxReport,
  getTopProducts,
  listExpenses,
  listBelowCostProducts,
  listExpiringSoon,
  listOversoldItems,
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
  getSecurityPolicy,
} from './services/auth';
import {
  clearSecurityQuestion,
  getRecoveryQuestion,
  getRecoveryStatus,
  getSupportInfo,
  ownerRecoveryCode,
  rotateRecoverySalt,
  setRecoveredPassword,
  setSecurityQuestion,
  verifySecurityAnswer,
  verifySupportCode,
} from './services/recovery';
import { runBackup, restoreBackup } from './services/backup';
import { openShift, closeShift, forceCloseShift, currentShift, listShifts, getShift } from './services/shifts';
import { saveCsv, saveXlsx, exportProductsXlsx, exportSalesXlsx, exportCustomersXlsx, exportUdhaarStatementXlsx, exportPurchaseOrdersXlsx, exportExpensesXlsx, downloadProductTemplate, importProductsFromExcel, importProductsFromBuffer, exportUdhaarCatalogCsv, importUdhaarCatalogCsv, importUdhaarCatalogCsvFromData } from './services/export';
import { getUdhaarLedger, getUdhaarAging, writeOffUdhaar, lookupUdhaarItem, searchUdhaarItems, createUdhaarEntry, getUdhaarEntry, listUdhaarCatalog, upsertUdhaarCatalog, deleteUdhaarCatalog } from './services/udhaar';
import { printStatement, previewStatement, exportStatementPdf, statementText, printEntrySlip, entrySlipText, reminderText } from './services/udhaarPrinting';
import { getCustomer, saveCustomer, findCustomerDuplicates, setCustomerStatus, deleteCustomer, mergeCustomers } from './services/customers';
import type { UdhaarEntryInput, CustomerInput } from '../shared/types';
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  createSupplier,
  getPurchaseOrder,
  listLowStockPurchaseProducts,
  listPurchaseOrders,
  listSupplierPurchaseProducts,
  listSuppliers,
  lastPurchaseInfo,
  paySupplier,
  poAutoSuggestLowStock,
  poCostChangeWarnPct,
  poCostingUpdatesCostPrice,
  poDefaultPaymentMethod,
  poMinMarginPct,
  purchasePriceHistory,
  purchaseProductRow,
  receivePurchaseOrder,
  supplierLedger,
} from './services/purchases';
import {
  buildPurchaseOrderHtml,
  importPurchaseOrders,
  lastUndoableImport,
  listPurchaseImports,
  parsePurchaseFile,
  parsePurchaseData,
  pickPurchaseImportFile,
  previewPurchaseOrder,
  printPurchaseOrder,
  savePurchaseImportTemplate,
  savePurchaseOrderText,
  undoPurchaseImport,
} from './services/purchaseImport';
import {
  createReturn,
  createReturnBill,
  createCashRefund,
  getReturn,
  listReturns,
  listCashRefunds,
} from './services/returns';
import {
  cancelAudit,
  completeAudit,
  createAudit,
  discardAudit,
  getAudit,
  listAudits,
  listAuditsPaginated,
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
import {
  openDrawer,
  closeDrawer,
  getCurrentDrawer,
  getBreakdown,
  getDrawerHistory,
} from './services/cashDrawer';
import {
  getAllShortcuts,
  updateShortcut,
  resetShortcuts,
  createShortcut,
  getAllFeatures,
  toggleFeature,
  isFeatureEnabled,
  getAllRoles,
  createRole,
  updateRole,
  deleteRole,
  getRolePermissions,
  setRolePermissions,
  getAllAdminSettings,
  setAdminSetting,
  setAdminSettingsBatch,
  resetAdminSettings,
  listActivityLogs,
  clearOldActivityLogs,
  listAllUsers,
  resetUserPassword,
  getSystemHealth,
} from './services/admin';
import { previewTestData, removeTestData } from './services/testData';
import { is2FAEnabled, get2FAMethod, generateOtp, verifyOtp } from './services/twoFactorAuth';
import { sendEmail, sendDailySalesReportEmail } from './services/emailService';
import { sendSmsReceipt, sendEmailReceipt } from './services/smsService';
import { quotationsService } from './services/quotations';
import { invoiceTemplatesService } from './services/invoiceTemplates';
import { variantsService } from './services/variants';
import { creditLimitsService } from './services/creditLimits';
import { branchesService } from './services/branches';
import { transfersService } from './services/transfers';
import { fifoEngine } from './services/fifoEngine';
import { commissionsService } from './services/commissions';
import { expensesService } from './services/expenses';
import { customReportsService } from './services/customReports';

/**
 * Item 0.2 — the ONE registration helper. Every business handler is wrapped so
 * internal faults are logged with an id instead of leaking a stack trace into
 * a toast. Expected validation errors are rethrown unchanged.
 */
function handle(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown
): void {
  ipcMain.handle(channel, wrapIpcHandler(channel, listener));
}

export function registerIpcHandlers(): void {
  handle('inventory:list', (_e, search?: string, includeInactive?: boolean, categoryId?: number, stockStatus?: 'in_stock' | 'low_stock' | 'out_of_stock' | 'negative_stock', supplierId?: number, expiryFrom?: string, expiryTo?: string) =>
    listProducts(search, includeInactive, categoryId, stockStatus, supplierId, expiryFrom, expiryTo)
  );
  handle('inventory:get', (_e, id: number) => getProduct(id));
  handle('inventory:getByBarcode', (_e, barcode: string) => getProductByBarcode(barcode));
  handle('inventory:create', (_e, input) => createProduct(input));
  handle('inventory:update', (_e, id: number, input) => updateProduct(id, input));
  handle('inventory:remove', (_e, id: number) => deleteProduct(id));
  handle('inventory:adjustStock', (_e, productId: number, changeQty: number, reason: string, refType?: string | null, refId?: number | null) =>
    adjustStock(productId, changeQty, reason, refType, refId)
  );
  handle('inventory:movements', (_e, productId?: number) => listMovements(productId));
  handle('inventory:getBatches', (_e, productId: number) => getBatches(productId));
  handle('inventory:getUnits', (_e, productId: number) => getUnits(productId));
  handle('inventory:lowStock', () => listLowStock());
  handle('inventory:categories', () => listCategories());
  handle('inventory:createCategory', (_e, name: string) => createCategory(name));
  handle('inventory:units', () => listUnits());

  handle('sales:create', (_e, input) => createSale(input));
  handle('sales:get', (_e, id: number) => getSale(id));
  handle('sales:list', (_e, from?: string, to?: string, includeVoided?: boolean, customerId?: number, userId?: number, paymentMode?: string, productId?: number, minAmount?: number, maxAmount?: number, saleNo?: string, sortBy?: 'date' | 'amount' | 'saleNo', sortOrder?: 'asc' | 'desc', onlyMySales?: boolean, status?: 'completed' | 'voided' | 'held' | 'returned' | 'all') => listSales(from, to, includeVoided, customerId, userId, paymentMode, productId, minAmount, maxAmount, saleNo, sortBy, sortOrder, onlyMySales, status));
  handle('sales:void', (_e, id: number, reason: string) => voidSale(id, reason));
  handle('sales:nextInvoiceNo', () => nextInvoiceNo());
  handle('sales:hold', (_e, kind: string, label: string, data) => holdBill(kind as 'held' | 'quotation', label, data));
  handle('sales:heldBills', (_e, kind?: string) => listHeldBills(kind as 'held' | 'quotation' | undefined));
  handle('sales:getHeld', (_e, id: number) => getHeldBill(id));
  handle('sales:deleteHeld', (_e, id: number, reason?: string) => deleteHeldBill(id, reason));
  handle('sales:resumeHeld', (_e, id: number) => resumeHeldBill(id));

  // PHASE 3d — one timeline service for every event type.
  handle('history:defaults', () => historyDefaults());
  handle('history:list', (_e, filters, page?: number, pageSize?: number) =>
    listHistoryEvents(filters ?? {}, page, pageSize)
  );
  handle('history:counts', (_e, filters) => historyTypeCounts(filters ?? {}));
  handle('history:summary', (_e, filters) => historySummary(filters ?? {}));
  handle('history:openHeld', () => historyOpenHeldCount());
  handle('history:detail', (_e, eventId: number) => getHistoryDetail(eventId));
  handle('history:print', (_e, filters) => printHistoryReport(filters ?? {}));
  handle('history:presetRange', (_e, preset: string) => historyPresetRange(preset ?? 'today'));

  handle('customers:list', () => listCustomers());
  handle('customers:create', (_e, name: string, phone?: string, openingBalance?: number) =>
    createCustomer(name, phone, openingBalance ?? 0)
  );
  handle('customers:ledger', (_e, customerId: number) => customerLedger(customerId));
  handle('customers:receivePayment', (_e, customerId: number, amount: number, mode: string, note?: string) =>
    receivePayment(customerId, amount, mode, note)
  );
  handle('customers:setCreditLimit', (_e, customerId: number, limit: number) => setCreditLimit(customerId, limit));
  handle('customers:get', (_e, id: number) => getCustomer(id));
  handle('customers:save', (_e, input: CustomerInput, id?: number | null) => saveCustomer(input, id ?? null));
  handle('customers:deactivate', (_e, id: number) => setCustomerStatus(id, 'inactive'));
  handle('customers:reactivate', (_e, id: number) => setCustomerStatus(id, 'active'));
  handle('customers:remove', (_e, id: number) => deleteCustomer(id));
  handle('customers:merge', (_e, sourceId: number, targetId: number) => {
    if (!can('owner')) return { ok: false, message: 'Only the owner can merge customers' };
    return mergeCustomers(sourceId, targetId);
  });
  handle('customers:findDuplicates', (_e, opts: { phone?: string | null; name?: string; excludeId?: number | null }) =>
    findCustomerDuplicates(opts)
  );

  handle('udhaar:ledger', (_e, customerId: number) => getUdhaarLedger(customerId));
  handle('udhaar:printStatement', (_e, customerId: number, from?: string, to?: string, paper?: 'a4' | 'thermal80' | 'thermal58') =>
    printStatement(customerId, from, to, paper)
  );
  handle('udhaar:previewStatement', (_e, customerId: number, from?: string, to?: string, paper?: 'a4' | 'thermal80' | 'thermal58') =>
    previewStatement(customerId, from, to, paper)
  );
  handle('udhaar:exportStatementPdf', (_e, customerId: number, from?: string, to?: string, paper?: 'a4' | 'thermal80' | 'thermal58') =>
    exportStatementPdf(customerId, from, to, paper)
  );
  handle('udhaar:shareStatement', async (_e, customerId: number, from?: string, to?: string, phone?: string) => {
    const ledger = getUdhaarLedger(customerId);
    const target = (phone && phone.trim()) || ledger.customer.phone || '';
    if (!target) return { ok: false, message: 'This customer has no phone number to share to.' };
    return sendWhatsAppReceipt(target, statementText(customerId, from, to));
  });

  // ── Phase 4: receivables aging, reminders, write-off ────────────────
  handle('udhaar:aging', () => getUdhaarAging());
  handle('udhaar:remind', async (_e, customerId: number, phone?: string) => {
    const ledger = getUdhaarLedger(customerId);
    if (ledger.summary.outstanding <= 0) {
      return { ok: false, message: 'This customer has no outstanding balance.' };
    }
    const target = (phone && phone.trim()) || ledger.customer.phone || '';
    if (!target) return { ok: false, message: 'This customer has no phone number to send the reminder to.' };
    return sendWhatsAppReceipt(target, reminderText(customerId));
  });
  handle('udhaar:writeOff', (_e, customerId: number, amount: number, note?: string) => {
    if (!can('owner')) return { ok: false, message: 'Only the owner can write off debt' };
    return writeOffUdhaar(customerId, amount, note);
  });

  // ── Phase 2: manual item entries + the Udhaar item catalog ──────────
  handle('udhaar:lookupItem', (_e, code: string) => lookupUdhaarItem(code));
  handle('udhaar:searchItems', (_e, term: string) => searchUdhaarItems(term));
  handle('udhaar:createEntry', (_e, input: UdhaarEntryInput) => createUdhaarEntry(input));
  handle('udhaar:catalogList', () => listUdhaarCatalog());
  handle('udhaar:catalogUpsert', (_e, item: { id?: number; barcode?: string | null; name: string; price: number; unit?: string | null }) =>
    upsertUdhaarCatalog(item)
  );
  handle('udhaar:catalogDelete', (_e, id: number) => deleteUdhaarCatalog(id));
  handle('udhaar:catalogExport', () => exportUdhaarCatalogCsv(BrowserWindow.getFocusedWindow()));
  handle('udhaar:catalogImport', () => importUdhaarCatalogCsv(BrowserWindow.getFocusedWindow()));
  handle('udhaar:catalogImportFromData', (_e, text: string) => importUdhaarCatalogCsvFromData(text));
  handle('udhaar:catalogExportData', () => exportUdhaarCatalogCsv(null));
  handle('udhaar:printEntrySlip', (_e, transactionId: number, paper?: 'thermal80' | 'thermal58') =>
    printEntrySlip(transactionId, paper)
  );
  handle('udhaar:shareEntrySlip', async (_e, transactionId: number, phone?: string) => {
    const entry = getUdhaarEntry(transactionId);
    if (!entry) return { ok: false, message: 'Entry not found.' };
    const target = (phone && phone.trim()) || entry.customer.phone || '';
    if (!target) return { ok: false, message: 'This customer has no phone number to share to.' };
    return sendWhatsAppReceipt(target, entrySlipText(transactionId));
  });

  handle('settings:getAll', () => maskSecrets(getAllSettings(), SECRET_SETTING_KEYS));
  handle('settings:set', (_e, key: string, value: string) => {
    if (!can('owner')) throw new Error('Only the owner can change settings');
    // A masked value means "the renderer never saw the real secret" — keep the
    // stored one instead of overwriting it with the placeholder.
    if (isMaskedSecret(value)) return;
    return setSetting(key, value);
  });
  handle('settings:chooseCloudFolder', async () => {
    if (!can('owner')) throw new Error('Only the owner can change settings');
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win ?? BrowserWindow.getAllWindows()[0], {
      title: 'Select your OneDrive or Google Drive sync folder',
      properties: ['openDirectory'],
    });
     return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });

  // ── Assistant ────────────────────────────────────────────────────────────
  // The API key never crosses this boundary: `getAssistantSettingsView` returns
  // only whether a key is set and its last four characters.
  handle('assistant:getSettings', () => {
    // The renderer learns WHETHER a key was found and its last four characters —
    // never the key itself, and never the environment variable's value.
    return getAssistantSettingsView();
  });
  handle('assistant:saveSettings', (_e, patch) => {
    saveAssistantSettings(patch ?? {});
    // The VIEW comes back (not the raw settings), so the screen keeps the key
    // hint and the cost after a save.
    return getAssistantSettingsView();
  });
  handle('assistant:setKey', (_e, key: string) => setAssistantApiKey(String(key ?? '')));
  handle('assistant:activity', () => listAssistantActivity(50));
  handle('assistant:send', (_e, request) => runAssistantTurn(request ?? { message: '' }));
  handle('assistant:cancel', () => cancelAssistantTurn());
  handle('assistant:pendingList', () => assistantPendingActions());
  handle('assistant:pendingConfirm', (_e, id) => confirmAssistantAction(Number(id)));
  handle('assistant:pendingCancel', (_e, id) => cancelAssistantAction(Number(id)));
  handle('assistant:proactive', () => getProactiveSuggestions());
  handle('assistant:optOut', (_e, optedOut: unknown) => {
    // A user decides for THEMSELVES — never for anybody else.
    const user = currentUser();
    if (!user) throw new Error('Sign in again.');
    if (optedOut === undefined || optedOut === null) {
      return { optedOut: assistantOptedOut(user.id), userId: user.id };
    }
    return setAssistantOptOut(optedOut === true);
  });
  handle('assistant:testConnection', async () => {
    if (!can('owner')) throw new Error('Only the owner can test the assistant connection');
    const view = getAssistantSettingsView();
    if (!view.enabled) return { ok: false, message: 'The assistant is turned off.' };
    if (!view.keySet) return { ok: false, message: 'Add an API key first.' };
    if (!view.model) return { ok: false, message: 'Choose a model first.' };
    // The key may live in the shop's own store OR in the provider's environment
    // variable — the resolver knows, the renderer never sees it.
    return testAssistantConnection(resolveAssistantApiKey(view.provider), view.model, { provider: view.provider });
  });
  // The voice: the recorded WAV goes to the app's own OFFLINE recogniser on
  // this computer. The audio never leaves the PC and no key is needed.
  handle('assistant:transcribe', (_e, wavBase64: unknown) =>
    transcribeWav(String(wavBase64 ?? ''))
  );
  handle('assistant:voiceSupport', () => voiceSupport());

  // --- BayLan Label Scale barcode handlers ---
  handle('scaleBarcode:parse', (_e, barcode: string) => parseBayLanBarcode(barcode));
  handle('scaleBarcode:isScaleItem', (_e, barcode: string) => isScaleBarcode(barcode));
  handle('scaleBarcode:listPluMappings', () => listPluMappings());

  // ── Printing ────────────────────────────────────────────────────────────
  // All printing funnels through printService, the only module that calls
  // webContents.print(). Every handler resolves to a PrintResult so the renderer
  // always gets a reason on failure instead of a silent hang.
  handle('printing:printSale', async (_e, saleId: number, template?: ReceiptTemplate, opts?: PrintSaleOptions) => {
    try {
      return await printSale(saleId, template, opts);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('printing:previewReceipt', async (_e, saleId: number, template?: ReceiptTemplate, opts?: PrintSaleOptions) => {
    try {
      return await previewReceipt(saleId, template, opts);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('printing:reprintLastReceipt', async () => {
    try {
      return await reprintLastReceipt();
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
  // Phase 5: X/Z reports
  handle('printing:printXReport', async (_e, shiftId?: number) => {
    try {
      return await printReport('x', shiftId);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('printing:printZReport', async () => {
    try {
      return await printReport('z');
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('printing:previewXReport', async (_e, shiftId?: number) => {
    try {
      return await previewReport('x', shiftId);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('printing:previewZReport', async () => {
    try {
      return await previewReport('z');
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('printing:previewInvoice', async (_e, saleId: number) => {
    try {
      return await previewInvoice(saleId);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('printing:printLabel', async (_e, productId: number, copies?: number) => {
    try {
      return await printLabel(productId, copies ?? 1);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('printing:printBarcodeLabel', async (_e, productId: number, copies?: number) => {
    try {
      return await printBarcodeLabel(productId, copies ?? 1);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('printing:printBarcodeBatch', async (_e, productIds: number[], size?: LabelSize, copies?: number) => {
    try {
      return await printBarcodeBatch(Array.isArray(productIds) ? productIds : [], size, copies ?? 1);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('printing:previewBarcodeBatch', async (_e, productIds: number[], size?: LabelSize, copies?: number) => {
    try {
      return await previewBarcodeBatch(Array.isArray(productIds) ? productIds : [], size, copies ?? 1);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('printing:printBarcodeBatchWithOptions', async (_e, productIds: number[], size: LabelSize | undefined, copies: number, options: { printer?: string; xOffset?: number; yOffset?: number; mirror?: boolean; rotation?: number; template?: unknown; run?: LabelRunOptions }) => {
    try {
      return await printBarcodeBatchWithOptions(Array.isArray(productIds) ? productIds : [], size, copies, options);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('printing:exportLabelBatchToPDF', async (_e, productIds: number[], template: any, size: LabelSize | undefined, copies: number, run?: LabelRunOptions) => {
    try {
      return await exportLabelBatchToPDF(Array.isArray(productIds) ? productIds : [], template, size, copies, run);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('printing:exportLabelBatchToPNG', async (_e, productIds: number[], template: any, size: LabelSize | undefined, copies: number, run?: LabelRunOptions) => {
    try {
      return await exportLabelBatchToPNG(Array.isArray(productIds) ? productIds : [], template, size, copies, run);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('printing:printCalibrationLabel', async (_e, size: LabelSize) => {
    try {
      return await printCalibrationLabel(size);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('printing:openCashDrawer', () => openCashDrawer());
  handle('printing:printInvoice', async (_e, saleId: number) => {
    try {
      return await printInvoice(saleId);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('printing:printDrawerSummary', async (_e, data: Parameters<typeof printDrawerSummary>[0]) => {
    try {
      return await printDrawerSummary(data);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });

  handle('receipt:getTemplates', () => {
    return getAvailableTemplates();
  });

  // ── Receipt Designer (phase 2) ──────────────────────────────────────────
  handle('receipt:design:get', () => {
    return { design: getReceiptDesign(), enabled: isReceiptDesignEnabled() };
  });

  handle('receipt:design:set', (_e, design: ReceiptDesign, enabled?: boolean) => {
    const clean = normalizeReceiptDesign(design);
    setAdminSetting(RECEIPT_DESIGN_KEY, JSON.stringify(clean));
    if (enabled !== undefined) setAdminSetting(RECEIPT_DESIGN_ENABLED_KEY, enabled ? 'true' : 'false');
    return { ok: true, message: 'Receipt design saved' };
  });

  handle('receipt:design:reset', () => {
    setAdminSetting(RECEIPT_DESIGN_KEY, '');
    setAdminSetting(RECEIPT_DESIGN_ENABLED_KEY, 'false');
    return { ok: true, message: 'Receipt design reset to the built-in layout' };
  });

  handle('receipt:design:preview', async (_e, design: ReceiptDesign, paper: ReceiptPaper, sample?: string) => {
    const s = buildSampleSale(undefined, sample === 'return' ? 'return' : 'sale');
    return buildDesignedReceiptAsync(s, paper, normalizeReceiptDesign(design));
  });

  // Phase 4 — print the sample sale with the on-screen (possibly unsaved) design.
  handle('receipt:design:test', async (_e, design: ReceiptDesign, paper: ReceiptPaper, copies?: number, draft?: boolean) => {
    try {
      return await printDesignSample(design, paper, copies, draft === true);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Receipt template library (phase 3) ──────────────────────────────────────
  handle('receipt:library:get', () => getReceiptLibrary());

  handle('receipt:library:set', (_e, library: unknown) => {
    saveReceiptLibrary(library);
    return { ok: true, message: 'Receipt templates saved' };
  });

  // ── Printer selection ───────────────────────────────────────────────────
  handle('printing:getPrinters', async () => {
    try {
      return await getAvailablePrinters(true);
    } catch {
      return [];
    }
  });
  handle('printing:getPrinterSettings', () => {
    const fallback = {
      receiptPrinter: AUTO_PRINTER,
      invoicePrinter: AUTO_PRINTER,
      labelPrinter: AUTO_PRINTER,
      receiptPaper: 'thermal80',
      invoicePaper: 'a4',
      labelPaper: '38x25',
      labelLayout: 'roll',
      printMode: 'silent',
      barcodeDpi: 203,
      papers: PAPER_SPECS,
      labelSizes: LABEL_SPECS,
    };
    try {
      return {
        receiptPrinter: getConfiguredPrinter('receipt') || AUTO_PRINTER,
        invoicePrinter: getConfiguredPrinter('invoice') || AUTO_PRINTER,
        labelPrinter: getConfiguredPrinter('label') || AUTO_PRINTER,
        receiptPaper: getConfiguredPaper('receipt') || 'thermal80',
        invoicePaper: getConfiguredPaper('invoice') || 'a4',
        labelPaper: getConfiguredPaper('label') || '38x25',
        labelLayout: getLabelLayout(),
        printMode: getPrintMode(),
        barcodeDpi: getBarcodeDpi(),
        papers: PAPER_SPECS,
        labelSizes: LABEL_SPECS,
      };
    } catch {
      return fallback;
    }
  });
  handle('printing:setPrinter', (_e, key: string, printer: string) => {
    try {
      if (!['receipt', 'invoice', 'label', 'drawer'].includes(key)) {
        return { ok: false, message: 'Unknown printer slot.' };
      }
      setAdminSetting(`${key}_printer`, printer || AUTO_PRINTER);
      invalidatePrinterCache();
      return { ok: true, message: 'Printer saved.' };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('printing:setPaper', (_e, key: string, paper: string) => {
    try {
      if (!['receipt', 'invoice', 'label'].includes(key)) {
        return { ok: false, message: 'Unknown paper slot.' };
      }
      setAdminSetting(`${key}_paper`, paper);
      return { ok: true, message: 'Paper size saved.' };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('printing:setLabelLayout', (_e, layout: string) => {
    try {
      setAdminSetting('label_layout', layout === 'sheet' ? 'sheet' : 'roll');
      return { ok: true, message: 'Label layout saved.' };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('printing:printTestSheet', async (_e, paper?: PaperKind) => {
    try {
      return await printTestSheet(paper);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });

  handle('reports:dashboard', () => dashboard());
  handle('reports:expiringSoon', (_e, days?: number) => listExpiringSoon(days));
  handle('reports:salesReport', (_e, from?: string, to?: string) => salesReport(from, to));
  handle('reports:profitLoss', (_e, from?: string, to?: string) => profitLoss(from, to));
  handle('reports:bestSellers', (_e, from?: string, to?: string, limit?: number) => bestSellers(from, to, limit));
  handle('reports:stockValuation', () => stockValuation());
  handle('reports:oversoldItems', () => listOversoldItems());
  handle('reports:belowCostItems', () => listBelowCostProducts());
  handle('reports:expenses', (_e, from?: string, to?: string) => listExpenses(from, to));
  handle('reports:addExpense', (_e, input) => addExpense(input));
  handle('reports:deleteExpense', (_e, id: number) => deleteExpense(id));

  handle('reports:getDailySalesTrend', (_e, from?: string, to?: string) => getDailySalesTrend(from, to));
  handle('reports:getDailySalesTrendDaily', (_e, from?: string, to?: string) => getDailySalesTrendDaily(from, to));
  handle('reports:getTopProducts', (_e, limit?: number, from?: string, to?: string) => getTopProducts(limit ?? 5, from, to));
  handle('reports:getDailyStats', (_e, from?: string, to?: string) => getDailyStats(from, to));
  handle('reports:getReceiptSettings', () => getReceiptSettings());
  handle('reports:updateReceiptSetting', (_e, key: string, value: string) => {
    updateReceiptSetting(key, value);
    return true;
  });

  handle('reports:getSalesAnalysis', (_e, from?: string, to?: string) => getSalesAnalysis(from, to));
  handle('reports:getProductPerformance', (_e, from?: string, to?: string) => getProductPerformance(from, to));
  handle('reports:getCustomerAnalysis', () => getCustomerAnalysis());
  handle('reports:getInventoryAnalysis', () => getInventoryAnalysis());
  handle('reports:getFinancialReport', (_e, from?: string, to?: string) => getFinancialReport(from, to));
  handle('reports:getTaxReport', (_e, from?: string, to?: string) => getTaxReport(from, to));
  handle('reports:getDailyClosing', (_e, date: string) => getDailyClosing(date));
  handle('reports:exportReportPDF', (_e, reportType: string, data: unknown) => exportReportPDF(reportType, data));
  handle('reports:exportReportExcel', (_e, reportType: string, data: unknown) => exportReportExcel(reportType, data));

  handle('whatsapp:status', () => getWhatsAppStatus());
  handle('whatsapp:start', async () => {
    if (!can('owner')) throw new Error('Only the owner can link WhatsApp');
    await restartWhatsAppGateway();
    return getWhatsAppStatus();
  });
  handle('whatsapp:send', (_e, phone: string, text: string) => {
    if (!can('owner')) throw new Error('Only the owner can send WhatsApp messages');
    return sendWhatsAppReceipt(phone, text);
  });
  handle('whatsapp:sendSaleReceipt', (_e, saleId: number, phone?: string) =>
    sendSaleReceiptOnWhatsApp(saleId, phone)
  );

  handle('activity:list', (_e, limit?: number) => listActivity(limit));

  handle('auth:verify', (_e, username: string, password: string) => verifyCredentials(username, password));
  handle('auth:login', (_e, username: string, password: string) => login(username, password));
  handle('auth:loginWithPin', (_e, pin: string) => loginWithPin(pin));
  handle('auth:logout', () => {
    logout();
    return true;
  });
  handle('auth:currentUser', () => currentUser());
  handle('auth:refreshSession', () => refreshSession());
  handle('auth:getSecurityPolicy', () => getSecurityPolicy());
  handle('auth:defaultPasswordActive', () => defaultPasswordActive());

  // Password recovery — Option A (security answer) + Option B (support code)
  handle('recovery:getStatus', (_e, userId: number) => getRecoveryStatus(userId));
  handle('recovery:setSecurity', (_e, userId: number, question: string, answer: string) =>
    setSecurityQuestion(userId, question, answer)
  );
  handle('recovery:clearSecurity', (_e, userId: number) => clearSecurityQuestion(userId));
  handle('recovery:ownerCode', () => ownerRecoveryCode());
  handle('recovery:rotateCode', () => rotateRecoverySalt());
  handle('recovery:getQuestion', (_e, username: string) => getRecoveryQuestion(username));
  handle('recovery:verifyAnswer', (_e, username: string, answer: string) =>
    verifySecurityAnswer(username, answer)
  );
  handle('recovery:supportInfo', () => getSupportInfo());
  handle('recovery:verifySupportCode', (_e, code: string) => verifySupportCode(code));
  handle('recovery:setNewPassword', (_e, username: string, newPassword: string) =>
    setRecoveredPassword(username, newPassword)
  );

  handle('users:list', () => listUsers());
  handle('users:create', (_e, input) => createUser(input));
  handle('users:update', (_e, id: number, input) => updateUser(id, input));
  handle('users:remove', (_e, id: number) => deleteUser(id));

  handle('shifts:open', (_e, openingCash: number) => openShift(openingCash));
  handle('shifts:close', (_e, id: number, countedCash: number, notes?: string) => closeShift(id, countedCash, notes));
  handle('shifts:forceClose', (_e, id: number, countedCash?: number, notes?: string) =>
    forceCloseShift(id, countedCash, notes)
  );
  handle('shifts:current', () => currentShift());
  handle('shifts:list', () => listShifts());
  handle('shifts:get', (_e, id: number) => getShift(id));

  handle('backup:run', () => {
    if (!can('owner')) throw new Error('Only the owner can run backups');
    return runBackup();
  });

  handle('backup:restore', async () => {
    if (!can('owner')) throw new Error('Only the owner can restore backups');
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const picked = await dialog.showOpenDialog(win, {
      title: 'Select a backup to restore',
      properties: ['openFile'],
      filters: [{ name: 'SQLite Database', extensions: ['db'] }, { name: 'All Files', extensions: ['*'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false, message: 'Restore cancelled.' };
    const filePath = picked.filePaths[0];
    const confirm = await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'Restore backup?',
      message: 'Restore will replace ALL current data with the backup contents.',
      detail: `${filePath}\n\nThis cannot be undone. Make sure you have a fresh backup of the current data first.`,
      buttons: ['Cancel', 'Restore'],
      defaultId: 0,
      cancelId: 0,
    });
    if (confirm.response !== 1) return { ok: false, message: 'Restore cancelled.' };
    return restoreBackup(filePath);
  });

  handle('export:saveCsv', (_e, defaultName: string, headers: string[], rows: (string | number)[][]) =>
    saveCsv(BrowserWindow.getFocusedWindow(), defaultName, headers, rows)
  );
  handle('export:saveXlsx', (_e, defaultName: string, sheets) =>
    saveXlsx(BrowserWindow.getFocusedWindow(), defaultName, sheets)
  );

  handle('excel:exportProducts', (_e, filters?: { search?: string; includeInactive?: boolean; categoryId?: number; stockStatus?: 'in_stock' | 'low_stock' | 'out_of_stock' | 'negative_stock'; supplierId?: number; expiryFrom?: string; expiryTo?: string }) => exportProductsXlsx(BrowserWindow.getFocusedWindow(), filters?.search, filters?.includeInactive, filters?.categoryId, filters?.stockStatus, filters?.supplierId, filters?.expiryFrom, filters?.expiryTo));
  handle('excel:exportSales', (_e, from?: string, to?: string) => exportSalesXlsx(BrowserWindow.getFocusedWindow(), from, to));
  handle('excel:exportCustomers', (_e, filters?: { status?: 'paid' | 'pending' | 'all'; from?: string; to?: string }) => exportCustomersXlsx(BrowserWindow.getFocusedWindow(), filters?.status, filters?.from, filters?.to));
  handle('excel:exportUdhaarStatement', (_e, customerId: number, from?: string, to?: string) => exportUdhaarStatementXlsx(BrowserWindow.getFocusedWindow(), customerId, from, to));
  handle('excel:exportPurchaseOrders', (_e, filters?: { status?: string; from?: string; to?: string; supplierId?: number }) => exportPurchaseOrdersXlsx(BrowserWindow.getFocusedWindow(), filters?.status, filters?.from, filters?.to, filters?.supplierId));
  handle('excel:exportExpenses', (_e, from?: string, to?: string) => exportExpensesXlsx(BrowserWindow.getFocusedWindow(), from, to));
  handle('excel:downloadTemplate', () => downloadProductTemplate(BrowserWindow.getFocusedWindow()));
  handle('excel:importProducts', () => importProductsFromExcel(BrowserWindow.getFocusedWindow()));
  handle('excel:importProductsFromData', (_e, data: unknown) => importProductsFromBuffer(data));

  handle('purchases:suppliers', () => listSuppliers());
  handle('purchases:createSupplier', (_e, name: string, phone?: string, address?: string) =>
    createSupplier(name, phone, address)
  );
  handle('purchases:orders', (_e, status?: string) => listPurchaseOrders(status));
  handle('purchases:getOrder', (_e, id: number) => getPurchaseOrder(id));
  handle('purchases:createOrder', (_e, supplierId: number, items, options) =>
    createPurchaseOrder(supplierId, items, options)
  );
  handle('purchases:receiveOrder', (_e, id: number, lines?: { product_id: number; qty: number }[]) =>
    receivePurchaseOrder(id, lines)
  );
  handle('purchases:cancelOrder', (_e, id: number, reason?: string) => cancelPurchaseOrder(id, reason));
  handle('purchases:ledger', (_e, supplierId: number) => supplierLedger(supplierId));
  handle('purchases:paySupplier', (_e, supplierId: number, amount: number, mode: string, note?: string) =>
    paySupplier(supplierId, amount, mode, note)
  );
  handle('purchases:priceHistory', (_e, productId: number) => purchasePriceHistory(productId));
  // ── the Purchase Order screen: the LIVE inventory master data ──
  handle('purchases:productRow', (_e, productId: number) => purchaseProductRow(productId));
  handle('purchases:lowStockProducts', (_e, limit?: number) => listLowStockPurchaseProducts(limit));
  handle('purchases:supplierProducts', (_e, supplierId: number, limit?: number) =>
    listSupplierPurchaseProducts(supplierId, limit)
  );
  handle('purchases:lastPurchase', (_e, productId: number) => lastPurchaseInfo(productId));
  handle('purchases:poSettings', () => ({
    cost_change_warn_pct: poCostChangeWarnPct(),
    min_margin_pct: poMinMarginPct(),
    auto_suggest_low_stock: poAutoSuggestLowStock(),
    default_payment_method: poDefaultPaymentMethod(),
    update_cost_price: poCostingUpdatesCostPrice(),
  }));

  // ── Phase 3: purchase import (Excel / CSV) ──
  handle('purchases:importPickFile', () => pickPurchaseImportFile(BrowserWindow.getFocusedWindow()));
  handle('purchases:importParse', (_e, filePath: string) => parsePurchaseFile(filePath));
  // The web build has no file system: the renderer sends the picked file's
  // bytes (base64) instead of a path.
  handle('purchases:importParseData', (_e, fileName: string, payload: unknown) => parsePurchaseData(fileName, payload));
  handle('purchases:importTemplate', () => savePurchaseImportTemplate(BrowserWindow.getFocusedWindow()));
  handle('purchases:importConfirm', (_e, payload) => importPurchaseOrders(payload));
  handle('purchases:importUndo', (_e, importId?: number) => undoPurchaseImport(importId));
  handle('purchases:importLast', () => lastUndoableImport());
  handle('purchases:importLog', (_e, limit?: number) => listPurchaseImports(limit));
  handle('purchases:printOrder', (_e, id: number, paper?: 'a4' | 'a5' | 'thermal80' | 'thermal58') =>
    printPurchaseOrder(id, paper ?? 'a4')
  );
  handle('purchases:previewOrder', (_e, id: number, paper?: 'a4' | 'a5' | 'thermal80' | 'thermal58') =>
    previewPurchaseOrder(id, paper ?? 'a4')
  );
  handle('purchases:shareOrder', (_e, id: number) => buildPurchaseOrderHtml(id));
  handle('purchases:saveOrderText', (_e, id: number) => savePurchaseOrderText(id));

  handle('returns:create', (_e, input) => createReturn(input));
  handle('returns:createBill', (_e, input) => createReturnBill(input));
  handle('returns:list', (_e, from?: string, to?: string) => listReturns(from, to));
  handle('returns:get', (_e, id: number) => getReturn(id));
  handle('returns:createCashRefund', (_e, amount: number, reason?: string, mode?: string) =>
    createCashRefund(amount, reason, mode)
  );
  handle('returns:listCashRefunds', (_e, from?: string, to?: string) => listCashRefunds(from, to));

  // ── Amending a finished bill ───────────────────────────────────────────────
  // The permissions live in the SERVICE (a cashier is refused there, a manager
  // needs their PIN re-entered), not in the UI.
  handle('billAmend:getView', (_e, saleId: number) => getBillAmendView(Number(saleId)));
  handle('billAmend:list', (_e, saleId: number) => listAmendments(Number(saleId)));
  handle('billAmend:customer', (_e, input) => amendCustomer(input));
  handle('billAmend:payments', (_e, input) => amendPayments(input));
  handle('billAmend:notes', (_e, input) => amendNotes(input));
  handle('billAmend:items', (_e, input) => amendItems(input));

  handle('audits:create', () => createAudit());
  handle('audits:list', () => listAudits());
  handle('audits:listPaginated', (_e, page?: number, pageSize?: number, from?: string, to?: string, userId?: number, status?: 'in_progress' | 'completed') =>
    listAuditsPaginated(page, pageSize, from, to, userId, status)
  );
  handle('audits:get', (_e, id: number) => getAudit(id));
  handle('audits:saveCounts', (_e, auditId: number, counts) => saveCounts(auditId, counts));
  handle('audits:complete', (_e, id: number) => completeAudit(id));
  handle('audits:cancel', (_e, id: number) => cancelAudit(id));
  handle('audits:discard', (_e, id: number) => discardAudit(id));

  handle('promotions:list', () => listPromotions());
  handle('promotions:create', (_e, input) => createPromotion(input));
  handle('promotions:update', (_e, id: number, input) => updatePromotion(id, input));
  handle('promotions:remove', (_e, id: number) => deletePromotion(id));
   handle('promotions:resolve', (_e, items) => resolvePromotions(items));

  // ── v1.8.0 Advanced Reports ──
  // Inventory Reports
  const inventoryReports = getInventoryReports();
  handle('inventoryReports:purchaseHistory', (_e, productId?: number, dateRange?: { start: string; end: string }) =>
    inventoryReports.getPurchaseHistory(productId, dateRange)
  );
  handle('inventoryReports:dailyInventory', (_e, date: string) => inventoryReports.computeDailyInventory(date));
  handle('inventoryReports:weeklyInventory', (_e, weekStart: string, weekEnd: string) => inventoryReports.getWeeklyInventory(weekStart, weekEnd));
  handle('inventoryReports:monthlyInventory', (_e, year: number, month: number) => inventoryReports.getMonthlyInventory(year, month));
  handle('inventoryReports:supplierMetrics', (_e, supplierId?: number) => inventoryReports.getSupplierMetrics(supplierId));
  handle('inventoryReports:productPurchaseSummary', (_e, productId: number, months?: number) => inventoryReports.getProductPurchaseSummary(productId, months));
  handle('inventoryReports:createDailySnapshot', (_e, date: string) => inventoryReports.createDailySnapshot(date));
  handle('inventoryReports:addPurchaseOrder', (_e, supplierId: number, items: any[], notes?: string) => inventoryReports.addPurchaseOrder(supplierId, items, notes));

  // Profitability
  const profitabilityService = getProfitabilityService();
  handle('profitability:daily', (_e, date: string) => profitabilityService.getDailyProfitability(date));
  handle('profitability:weekly', (_e, start: string, end: string) => profitabilityService.getWeeklyProfitability(start, end));
  handle('profitability:monthly', (_e, year: number, month: number) => profitabilityService.getMonthlyProfitability(year, month));
  handle('profitability:category', (_e, start: string, end: string) => profitabilityService.getCategoryProfitability(start, end));
  handle('profitability:lowProfit', (_e, threshold?: number) => profitabilityService.getLowProfitProducts(threshold));
  handle('profitability:topProfit', (_e, limit?: number, days?: number) => profitabilityService.getTopProfitProducts(limit, days));
  handle('profitability:worstPerforming', (_e, limit?: number, days?: number) => profitabilityService.getWorstPerformingProducts(limit, days));
  handle('profitability:breakEven', () => profitabilityService.getBreakEvenAnalysis());
  handle('profitability:computePeriod', (_e, date: string) => profitabilityService.computePeriodProfitability(date));

  // The sidebar badges — the small numbers next to a page in the menu.
  // The role is taken from the SESSION (never from the renderer), so a cashier
  // can never ask for the owner's numbers. The service keeps the numbers for
  // a minute, so a shop that opens the menu often does not query again.
  handle('sidebar:badges', () => getSidebarBadges(currentUser()?.role));

  // Alerts
  const alertService = getAlertService();
  handle('alerts:getAll', () => alertService.getAll());
  handle('alerts:getUnread', () => alertService.getUnread());
  handle('alerts:markAsRead', (_e, id: number) => alertService.markAsRead(id));
  handle('alerts:resolve', (_e, id: number, action: string) => alertService.resolve(id, action));
  handle('alerts:checkNow', () => alertService.checkAndCreateAlerts());
  handle('alerts:sendWhatsApp', () => alertService.sendAlertsWhatsApp());
  handle('alerts:sendDailySummary', () => alertService.sendDailySalesSummary());

  // ── Cash Drawer Sessions ──
  handle('cashDrawer:open', (_e, shiftId: number, openingCash: number) => openDrawer(shiftId, openingCash));
  handle('cashDrawer:close', (_e, shiftId: number, closingCash: number, notes?: string) => closeDrawer(shiftId, closingCash, notes));
  handle('cashDrawer:getCurrent', (_e, shiftId: number) => getCurrentDrawer(shiftId));
  handle('cashDrawer:getBreakdown', (_e, shiftId: number) => getBreakdown(shiftId));
  handle('cashDrawer:history', (_e, shiftId?: number) => getDrawerHistory(shiftId));

  // ── Admin: Shortcuts ──
  handle('admin:shortcuts:getAll', () => getAllShortcuts());
  handle('admin:shortcuts:update', (_e, action: string, key: string) => updateShortcut(action, key));
  handle('admin:shortcuts:add', (_e, action: string, key: string) => createShortcut(action, key));
  handle('admin:shortcuts:reset', () => { resetShortcuts(); return true; });

  // ── Admin: Feature Toggles ──
  handle('admin:features:getAll', () => getAllFeatures());
  handle('admin:features:toggle', (_e, name: string) => toggleFeature(name));
  handle('admin:features:isEnabled', (_e, name: string) => isFeatureEnabled(name));

  // ── Admin: Roles & Permissions ──
  handle('admin:roles:getAll', () => getAllRoles());
  handle('admin:roles:create', (_e, name: string, description?: string) => createRole(name, description));
  handle('admin:roles:update', (_e, id: number, data: { name?: string; description?: string }) => updateRole(id, data));
  handle('admin:roles:delete', (_e, id: number) => deleteRole(id));
  handle('admin:roles:getPermissions', (_e, roleId: number) => getRolePermissions(roleId));
  handle('admin:roles:setPermissions', (_e, roleId: number, permissions: { permission_name: string; is_allowed: boolean }[]) => {
    setRolePermissions(roleId, permissions);
    return true;
  });

  // ── Admin: Settings ──
  handle('admin:settings:getAll', () =>
    maskSecrets(getAllAdminSettings(), SECRET_ADMIN_KEYS)
  );
  handle('admin:settings:get', (_e, key: string) => {
    const all = getAllAdminSettings();
    const value = all[key] ?? null;
    if (value && SECRET_ADMIN_KEYS.has(key)) return SECRET_MASK;
    return value;
  });
  handle('admin:settings:set', (_e, key: string, value: string) => {
    if (!isMaskedSecret(value)) setAdminSetting(key, value);
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('admin:settings:changed'));
    return true;
  });
  handle('admin:settings:setBatch', (_e, settings: Record<string, string>) => {
    const real: Record<string, string> = {};
    for (const [key, value] of Object.entries(settings)) {
      if (!isMaskedSecret(value)) real[key] = value;
    }
    if (Object.keys(real).length) setAdminSettingsBatch(real);
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('admin:settings:changed'));
    return true;
  });
  handle('admin:settings:resetDefaults', () => {
    resetAdminSettings();
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('admin:settings:changed'));
    return true;
  });

  // ── Admin: Activity Log ──
  handle('admin:activity:getAll', (_e, filters?: { from?: string; to?: string; user_id?: number; action?: string; limit?: number; offset?: number }) =>
    listActivityLogs(filters ?? {})
  );
  handle('admin:activity:clear', (_e, retentionDays: number) => clearOldActivityLogs(retentionDays));

  // ── Admin: User Management ──
  handle('admin:users:getAll', () => listAllUsers());
  handle('admin:users:resetPassword', (_e, userId: number, newPassword: string) => resetUserPassword(userId, newPassword));

  // ── Admin: System Health ──
  handle('admin:systemHealth', () => getSystemHealth());

  // ── Admin: Test-data cleanup ──
  handle('admin:testData:preview', () => {
    if (!can('owner')) throw new Error('Only the owner can review test data');
    return previewTestData();
  });
  handle('admin:testData:remove', (_e, confirmText: string) => {
    if (!can('owner')) throw new Error('Only the owner can remove test data');
    return removeTestData(confirmText);
  });

  // ── 2FA ──
  handle('2fa:isEnabled', () => is2FAEnabled());
  handle('2fa:method', () => get2FAMethod());
  handle('2fa:generateOtp', (_e, userId: number) => generateOtp(userId));
  handle('2fa:verifyOtp', (_e, userId: number, code: string) => verifyOtp(userId, code));

  // ── Email ──
  // `email:send` is a raw relay: the caller supplies recipient, subject and HTML.
  // It is not used by the till (receipts go through receipt:sendEmail), so keep
  // it owner-only — an authenticated cashier must not be able to send arbitrary
  // mail from the shop's SMTP account.
  handle('email:send', (_e, options: { to: string | string[]; subject: string; text?: string; html?: string }) => {
    if (!can('owner')) throw new Error('Only the owner can send email');
    if (!options || typeof options !== 'object') throw new Error('Invalid email options');
    const recipients = Array.isArray(options.to) ? options.to : [options.to];
    if (recipients.length === 0 || recipients.some((r) => typeof r !== 'string' || !r.includes('@'))) {
      throw new Error('A valid recipient email is required');
    }
    if (typeof options.subject !== 'string' || !options.subject.trim()) {
      throw new Error('An email subject is required');
    }
    return sendEmail(options);
  });
  handle('email:sendDailyReport', () => {
    if (!can('owner')) throw new Error('Only the owner can send the daily report');
    return sendDailySalesReportEmail();
  });

  // ── Quotation Module ──
  handle('quotations:list', (_e, filters?: { status?: string; customer_id?: number; from_date?: string; to_date?: string; search?: string }) =>
    quotationsService.list(filters || {})
  );
  handle('quotations:get', (_e, id: number) => quotationsService.get(id));
  handle('quotations:create', (_e, input) => quotationsService.create(input));
  handle('quotations:updateStatus', (_e, id: number, status: string) => quotationsService.updateStatus(id, status));
  handle('quotations:delete', (_e, id: number) => quotationsService.delete(id));
  handle('quotations:convertToSale', (_e, id: number, actorUserId: number) => quotationsService.convertToSale(id, actorUserId));
  handle('quotations:expireOld', () => ({ count: quotationsService.expireOld() }));

  // ── Invoice Templates ──
  handle('templates:list', (_e, type?: string) => invoiceTemplatesService.list(type));
  handle('templates:get', (_e, id: number) => invoiceTemplatesService.get(id));
  handle('templates:getDefault', (_e, type: string) => invoiceTemplatesService.getDefault(type));
  handle('templates:create', (_e, input) => invoiceTemplatesService.create(input));
  handle('templates:update', (_e, id: number, input) => invoiceTemplatesService.update(id, input));
  handle('templates:delete', (_e, id: number) => invoiceTemplatesService.delete(id));
  handle('templates:duplicate', (_e, id: number, newName: string) => invoiceTemplatesService.duplicate(id, newName));

  // ── Products / Variants ──
  handle('variants:list', (_e, productId: number) => variantsService.listVariantsForProduct(productId));
  handle('variants:get', (_e, id: number) => variantsService.getVariant(id));
  handle('variants:findByBarcode', (_e, barcode: string) => variantsService.findVariantByBarcode(barcode));
  handle('variants:create', (_e, input) => variantsService.createVariant(input));
  handle('variants:update', (_e, id: number, input) => variantsService.updateVariant(id, input));
  handle('variants:delete', (_e, id: number) => variantsService.deleteVariant(id));
  handle('variants:autoGenerate', (_e, input) => variantsService.autoGenerateVariants(input));

  // ── Attributes ──
  handle('attributes:list', () => variantsService.listAttributes());
  handle('attributes:getValues', (_e, attributeId: number) => variantsService.getAttributeValues(attributeId));
  handle('attributes:create', (_e, name: string) => variantsService.createAttribute(name));
  handle('attributes:addValue', (_e, attributeId: number, value: string) => variantsService.addAttributeValue(attributeId, value));

  // ── Credit Limits ──
  handle('credits:check', (_e, customerId: number, additionalAmount?: number) =>
    creditLimitsService.check(customerId, additionalAmount || 0)
  );
  handle('credits:setCustomerLimit', (_e, customerId: number, limit: number, blockOnExceed: boolean, reason?: string, warningThresholdPct?: number) =>
    creditLimitsService.setCustomerLimit(customerId, limit, blockOnExceed, 1, reason, warningThresholdPct)
  );
  handle('credits:setSupplierLimit', (_e, supplierId: number, limit: number, blockOnExceed: boolean, warningThresholdPct?: number) =>
    creditLimitsService.setSupplierLimit(supplierId, limit, blockOnExceed, warningThresholdPct)
  );
  handle('credits:history', (_e, customerId: number, limit?: number) => creditLimitsService.getHistory(customerId, limit));
  handle('credits:listRisks', () => creditLimitsService.listRisks());

  // ── Branches ──
  handle('branches:list', () => branchesService.list());
  handle('branches:get', (_e, id: number) => branchesService.get(id));
  handle('branches:getDefault', () => branchesService.getDefault());
  handle('branches:getCurrent', () => branchesService.getCurrent());
  handle('branches:create', (_e, input) => branchesService.create(input));
  handle('branches:update', (_e, id: number, input) => branchesService.update(id, input));
  handle('branches:delete', (_e, id: number) => branchesService.delete(id));
  handle('branches:setCurrent', (_e, branchId: number) => branchesService.setCurrent(branchId));

  // ── Transfers ──
  handle('transfers:party:list', () => transfersService.listPartyTransfers());
  handle('transfers:party:create', (_e, input) => transfersService.createPartyTransfer(input));
  handle('transfers:bank:accounts', () => transfersService.listBankAccounts());
  handle('transfers:bank:createAccount', (_e, input) => transfersService.createBankAccount(input));
  handle('transfers:bank:list', () => transfersService.listBankTransfers());
  handle('transfers:bank:create', (_e, input) => transfersService.createBankTransfer(input));

  // ── FIFO Stock Engine ──
  handle('fifo:isEnabled', () => fifoEngine.isEnabled());
  handle('fifo:isStrict', () => fifoEngine.isStrict());
  handle('fifo:availableBatches', (_e, productId: number) => fifoEngine.getAvailableBatches(productId));
  handle('fifo:allocate', (_e, productId: number, qty: number) => fifoEngine.allocateFIFO(productId, qty));
  handle('fifo:stockReport', (_e, productId?: number) => fifoEngine.getFIFOStockReport(productId));

  // ── Salesman Commissions ──
  handle('commissions:rules', () => commissionsService.listRules());
  handle('commissions:createRule', (_e, input) => commissionsService.createRule(input));
  handle('commissions:updateRule', (_e, id: number, input) => commissionsService.updateRule(id, input));
  handle('commissions:deleteRule', (_e, id: number) => commissionsService.deleteRule(id));
  handle('commissions:salesmen', () => commissionsService.listSalesmen());
  handle('commissions:calculate', (_e, saleId: number) => commissionsService.calculateCommissions(saleId));
  handle('commissions:list', (_e, filters?: { salesman_id?: number; status?: string; from?: string; to?: string }) => commissionsService.listCommissions(filters || {}));
  handle('commissions:updateStatus', (_e, id: number, status: string, userId: number) => commissionsService.updateCommissionStatus(id, status, userId));
  handle('commissions:summary', (_e, salesmanId: number, from?: string, to?: string) => commissionsService.getSalesmanSummary(salesmanId, from, to));

  // ── Expenses ──
  handle('expenses:categories', () => expensesService.listCategories());
  handle('expenses:createCategory', (_e, input) => expensesService.createCategory(input));
  handle('expenses:updateCategory', (_e, id: number, input) => expensesService.updateCategory(id, input));
  handle('expenses:deleteCategory', (_e, id: number) => expensesService.deleteCategory(id));
  handle('expenses:list', (_e, filters?: { category_id?: number; user_id?: number; from?: string; to?: string; status?: string }) => expensesService.listExpenses(filters || {}));
  handle('expenses:create', (_e, input) => expensesService.createExpense(input));
  handle('expenses:get', (_e, id: number) => expensesService.getExpense(id));
  handle('expenses:update', (_e, id: number, input) => expensesService.updateExpense(id, input));
  handle('expenses:delete', (_e, id: number) => expensesService.deleteExpense(id));
  handle('expenses:summary', (_e, from?: string, to?: string) => expensesService.getExpenseSummary(from, to));

  // ── Custom Reports ──
  handle('reports:custom:list', (_e, userId?: number) => customReportsService.list(userId));
  handle('reports:custom:get', (_e, id: number) => customReportsService.get(id));
  handle('reports:custom:create', (_e, input) => customReportsService.create(input));
  handle('reports:custom:update', (_e, id: number, input) => customReportsService.update(id, input));
  handle('reports:custom:delete', (_e, id: number) => customReportsService.delete(id));
  handle('reports:custom:tables', () => customReportsService.listTables());
  handle('reports:custom:schema', (_e, table: string) => customReportsService.getTableSchema(table));
  handle('reports:custom:execute', (_e, id: number, limit?: number) => customReportsService.execute(id, limit));
  handle('reports:custom:schedules', () => customReportsService.listSchedules());
  handle('reports:custom:createSchedule', (_e, input) => customReportsService.createSchedule(input));
  handle('reports:custom:updateSchedule', (_e, id: number, input) => customReportsService.updateSchedule(id, input));
  handle('reports:custom:deleteSchedule', (_e, id: number) => customReportsService.deleteSchedule(id));

  // ── Receipt: Email & SMS ──
  handle('receipt:sendSms', (_e, saleId: number, phone: string) => sendSmsReceipt(saleId, phone));
  handle('receipt:sendEmail', (_e, saleId: number, email: string) => sendEmailReceipt(saleId, email));
}