const { initDatabase } = require('../dist/main/db.js');
const svc = require('../dist/main/services/inventory.js');
const sales = require('../dist/main/services/sales.js');
const settings = require('../dist/main/services/settings.js');
const reports = require('../dist/main/services/reports.js');
const activity = require('../dist/main/services/activity.js');
const auth = require('../dist/main/services/auth.js');
const backup = require('../dist/main/services/backup.js');
// fetch is global in Node >= 18
const licensing = require('../dist/main/services/licensing.js');
async function runSmoke() {
   await initDatabase();

   // Reset licensing state for a clean test run
   settings.setSetting('license_key', '');
   settings.setSetting('license_expires', '');
   settings.setSetting('license_last_check', '0');

   // Mock license server is started externally before launching the app.

  const shifts = require('../dist/main/services/shifts.js');
  let shift0;
  try {
    shift0 = shifts.openShift(0);
  } catch (e) {
    // Close any existing open shift and open a fresh one
    const cur = shifts.currentShift();
    if (cur && !cur.closed_at) {
      try { shifts.closeShift(cur.id, cur.expected_preview ?? 0); } catch (_) {}
    }
    shift0 = shifts.openShift(0);
  }

  const p = svc.createProduct({ name: 'Test Product', sale_price: 100, cost_price: 80, stock_qty: 5, tax_rate: 3 });
  console.log('CREATED id=' + p.id + ' barcode=' + p.barcode + ' stock=' + p.stock_qty);

  const found = svc.getProductByBarcode(p.barcode);
  console.log('FOUND_BY_BARCODE=' + (found && found.id === p.id));

  const adj = svc.adjustStock(p.id, -2, 'damage');
  console.log('ADJ_STOCK=' + adj.stock_qty);

  const search = svc.listProducts('test');
  console.log('SEARCH_HITS=' + search.length);

  const mov = svc.listMovements(p.id);
  console.log('MOVEMENTS=' + mov.length);

  const low = svc.listLowStock();
  console.log('LOW_STOCK_COUNT=' + low.length);

  const updated = svc.updateProduct(p.id, { name: 'Test Product 2', sale_price: 150 });
  console.log('UPDATED name=' + updated.name + ' price=' + updated.sale_price);

  let cat;
  try {
    cat = svc.createCategory('Grocery');
    console.log('CATEGORY=' + cat.name);
  } catch (e) {
    console.log('CATEGORY_EXISTS=' + e.message);
    cat = { name: 'Grocery' };
  }

  svc.deleteProduct(p.id);
  console.log('DELETE_OK remaining=' + svc.listProducts().length);

  try {
    svc.adjustStock(p.id, -999, 'should fail');
    console.log('NEGATIVE_GUARD=FAILED');
  } catch (e) {
    console.log('NEGATIVE_GUARD=OK');
  }

  // ---- Sales ----
  const p2 = svc.createProduct({ name: 'Billing Test', sale_price: 100, cost_price: 60, stock_qty: 10, tax_rate: 5 });
  const cust = sales.createCustomer('Ahmed', '03001234567');
  console.log('CUSTOMER=' + cust.name);

  const res = sales.createSale({
    items: [{ product_id: p2.id, qty: 2, price: 100, line_discount: 0, tax_rate: 5 }],
    customer_id: cust.id,
    payments: [{ mode: 'cash', amount: 200 }],
  });
  console.log('SALE_TOTAL=' + res.sale.total_amount + ' INV=' + res.sale.invoice_no + ' BAL=' + res.balance);
  console.log('SALE_STOCK=' + svc.getProduct(p2.id).stock_qty);
  console.log('SALE_PAID=' + res.payments.reduce((s, x) => s + x.amount, 0));

  const zeroTax = sales.createSale({
    items: [{ product_id: p2.id, qty: 1, price: 100, line_discount: 10, tax_rate: 0 }],
    payments: [{ mode: 'cash', amount: 90 }],
  });
  console.log('LINE_DISCOUNT_TOTAL=' + zeroTax.sale.total_amount);

  const pct = sales.createSale({
    items: [{ product_id: p2.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
    bill_discount: 10,
    discount_type: 'percent',
    payments: [{ mode: 'cash', amount: 90 }],
  });
  console.log('PCT_DISCOUNT_TOTAL=' + pct.sale.total_amount);

  // --- Wholesale mode sale ---
  const wp = svc.createProduct({ name: 'Wholesale Test', sale_price: 100, wholesale_price: 80, cost_price: 50, stock_qty: 10, tax_rate: 0 });
  const whSale = sales.createSale({
    items: [{ product_id: wp.id, qty: 1, price: 80, line_discount: 0, tax_rate: 0 }],
    payments: [{ mode: 'cash', amount: 80 }],
    price_mode: 'wholesale',
  });
  const whFull = sales.getSale(whSale.sale.id);
  console.log('WHOLESALE_TOTAL=' + whFull.total_amount + ' OVERRIDDEN=' + whFull.price_overridden);

  // --- Box/Carton unit sale ---
  const bp = svc.createProduct({
    name: 'Box Test',
    sale_price: 10,
    cost_price: 5,
    stock_qty: 20,
    tax_rate: 0,
    units: [
      { level: 0, name: 'pcs', quantity_in_base_units: 1, price: 10, is_base: 1 },
      { level: 1, name: 'box', quantity_in_base_units: 10, price: 95, is_base: 0 },
    ],
  });
  const boxSale = sales.createSale({
    items: [{ product_id: bp.id, qty: 10, price: 95, line_discount: 0, tax_rate: 0, box_qty: 1 }],
    payments: [{ mode: 'cash', amount: 950 }],
  });
  console.log('BOX_SALE total=' + boxSale.sale.total_amount + ' box_qty=' + boxSale.items[0].box_qty + ' qty=' + boxSale.items[0].qty);

  // --- Bill discount (Rs amount) ---
  const amt = sales.createSale({
    items: [{ product_id: p2.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
    bill_discount: 10,
    discount_type: 'amount',
    payments: [{ mode: 'cash', amount: 90 }],
  });
  console.log('AMOUNT_DISCOUNT_TOTAL=' + amt.sale.total_amount);

  // --- Payment split (cash + card) ---
  const split = sales.createSale({
    items: [{ product_id: p2.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
    payments: [
      { mode: 'cash', amount: 60 },
      { mode: 'card', amount: 40 },
    ],
  });
  console.log(
    'SPLIT_PAYMENT pay_rows=' + split.payments.length + ' total=' + split.sale.total_amount + ' balance=' + split.balance
  );

  // --- Freight / Delivery charge ---
  const freightSale = sales.createSale({
    items: [{ product_id: p2.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
    service_charge: 20,
    service_charge_type: 'amount',
    freight: 50,
    payments: [{ mode: 'cash', amount: 170 }],
  });
  const freightFull = sales.getSale(freightSale.sale.id);
  console.log(
    'FREIGHT_TOTAL=' + freightFull.total_amount + ' (expect 170) freight=' + freightFull.freight + ' service=' + freightFull.service_charge
  );
  const freightReceipt = require('../dist/main/services/printing.js').buildReceiptHtml(freightSale.sale.id);
  console.log('FREIGHT_RECEIPT=' + freightReceipt.includes('Freight/Delivery'));

  try {
    sales.createSale({ items: [{ product_id: p2.id, qty: 999, price: 100, line_discount: 0, tax_rate: 0 }], payments: [{ mode: 'cash', amount: 999999 }] });
    console.log('STOCK_GUARD=FAILED');
  } catch (e) {
    console.log('STOCK_GUARD=' + (e.message.includes('Insufficient') ? 'OK' : 'FAILED'));
  }

  try {
    sales.createSale({ items: [{ product_id: p2.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }], payments: [{ mode: 'cash', amount: 50 }] });
    console.log('UDHAAR_GUARD=FAILED');
  } catch (e) {
    console.log('UDHAAR_GUARD=' + (e.message.includes('customer') ? 'OK' : 'FAILED'));
  }

  sales.voidSale(res.sale.id, 'test void');
  const v = sales.getSale(res.sale.id);
  console.log('VOID_STATUS=' + v.status + ' RESTOCK=' + svc.getProduct(p2.id).stock_qty);

  const held = sales.holdBill('held', 'test', { items: [{ a: 1 }] });
  console.log('HELD_ID=' + held.id);
  console.log('HELD_LIST=' + sales.listHeldBills('held').length);
  console.log('HELD_DELETE=' + sales.deleteHeldBill(held.id));

   console.log('INV_NEXT=' + sales.nextInvoiceNo());
   settings.setSetting('shop_name', 'Smoke Shop');
   settings.setSetting('shop_logo', 'data:image/png;base64,FAKE');
   console.log('SETTINGS=' + settings.getAllSettings().shop_name);

   // --- Licensing (mock server) ---
   const genRes = await fetch(`${process.env.SERVER_URL || 'http://localhost:4000'}/api/generate`, {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ shop: settings.getAllSettings().shop_name })
   }).then(r => r.json());
   const licenseKey = genRes.key;
   await licensing.activateLicense(licenseKey);
   console.log('LICENSE_ACTIVATED=' + licenseKey);
   await licensing.checkLicense();
   console.log('LICENSE_CHECK_ONLINE=OK');

  try {
    svc.deleteProduct(p2.id);
    console.log('DELETE_WITH_SALES=FAILED(no error)');
  } catch (e) {
    console.log('DELETE_WITH_SALES=' + (e.message.includes('FOREIGN KEY') ? 'OK(blocked)' : 'FAILED'));
  }
  console.log('SALES_DONE');

  // ---- Udhaar ----
  const uCust = sales.createCustomer('Udhaar Test', '0345');
  const uSale = sales.createSale({
    items: [{ product_id: p2.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
    customer_id: uCust.id,
    payments: [{ mode: 'cash', amount: 40 }],
  });
  console.log('UDHAAR_BALANCE=' + sales.listCustomers().find((c) => c.id === uCust.id).balance);

  const led1 = sales.customerLedger(uCust.id);
  console.log('LEDGER_ROWS=' + led1.length + ' RUNNING=' + led1[led1.length - 1].running);

sales.receivePayment(uCust.id, 30, 'cash', 'partial');
  const led2 = sales.customerLedger(uCust.id);
  console.log('LEDGER_AFTER_PAY=' + led2.length + ' RUNNING=' + led2[led2.length - 1].running);

  sales.receivePayment(uCust.id, 30, 'cash', 'full');
  console.log('FULL_PAYMENT_BALANCE=' + sales.listCustomers().find((c) => c.id === uCust.id).balance);

  try {
    sales.receivePayment(uCust.id, 999, 'cash');
    console.log('OVERPAY_GUARD=FAILED');
  } catch (e) {
    console.log('OVERPAY_GUARD=' + (e.message.includes('exceeds') ? 'OK' : 'FAILED'));
  }

  sales.voidSale(uSale.sale.id, 'udhaar test void');
  console.log('VOID_UDHAAR_BALANCE=' + sales.listCustomers().find((c) => c.id === uCust.id).balance);
  console.log('UDHAAR_DONE');

  // ---- Opening balance ----
  const obCust = sales.createCustomer('Opening Bal', '0333', 75);
  const obLedger = sales.customerLedger(obCust.id);
  console.log(
    'OPENING_BALANCE=' + obCust.balance + ' LEDGER=' + obLedger.length + ' TYPE=' + obLedger[0].type +
    ' RUNNING=' + obLedger[0].running
  );
  try {
    sales.createCustomer('Bad OB', '0334', -5);
    console.log('OB_GUARD=false');
  } catch (e) {
    console.log('OB_GUARD=' + e.message.includes('non-negative'));
  }

  // ---- Reports / Automation ----
  const exp = reports.addExpense({ title: 'Test Rent', category: 'Rent', amount: 500, expense_date: new Date().toISOString().slice(0, 10) });
  console.log('EXPENSE_ADDED=' + exp.id + ' AMOUNT=' + exp.amount);

  const dash = reports.dashboard();
  console.log('DASHBOARD today_sales=' + dash.today_sales + ' bills=' + dash.today_bills + ' udhaar=' + dash.udhaar_due + ' low=' + dash.low_stock);

  const sReport = reports.salesReport();
  console.log('SALES_REPORT_DAYS=' + sReport.length + ' LAST_TOTAL=' + (sReport.length ? sReport[sReport.length - 1].total : 0));

  const pl = reports.profitLoss();
  console.log('PL revenue=' + pl.revenue + ' cogs=' + pl.cogs + ' expenses=' + pl.expenses + ' net=' + pl.net);

  const sellers = reports.bestSellers(undefined, undefined, 5);
  console.log('BEST_SELLERS=' + sellers.length + ' TOP=' + (sellers[0] ? sellers[0].name : 'none'));

  const val = reports.stockValuation();
  console.log('VALUATION cost=' + val.cost_value + ' retail=' + val.retail_value + ' products=' + val.products);

  console.log('EXPENSES_LIST=' + reports.listExpenses().length);
  console.log('EXPENSE_DELETE=' + reports.deleteExpense(exp.id));

  console.log('ACTIVITY_ROWS=' + activity.listActivity().length);
  console.log('ACTIVITY_SALE_CREATED=' + activity.listActivity().some((a) => a.action === 'sale_created'));

  console.log('AUTH_OK=' + auth.verifyCredentials('admin', 'admin123') + ' AUTH_BAD=' + auth.verifyCredentials('admin', 'wrong'));

  const bPath = backup.runLocalBackup();
  console.log('BACKUP_OK=' + (bPath.length > 0) + ' SETTINGS_LAST=' + (settings.getAllSettings().last_backup.length > 0));

  sales.setCreditLimit(uCust.id, 50);
  console.log('CREDIT_LIMIT=' + sales.listCustomers().find((c) => c.id === uCust.id).credit_limit);

  try {
    sales.createSale({
      items: [{ product_id: p2.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
      customer_id: uCust.id,
      payments: [{ mode: 'cash', amount: 40 }],
    });
    console.log('CREDIT_LIMIT_BLOCK=false');
  } catch (e) {
    console.log('CREDIT_LIMIT_BLOCK=' + e.message.includes('Credit limit exceeded'));
  }

  console.log('REPORTS_DONE');

  // ---- Purchases & Suppliers ----
  const pur = require('../dist/main/services/purchases.js');
  const sup = pur.createSupplier('Test Supplier', '03001234567', 'Main Bazar');
  console.log('SUPPLIER=' + sup.name + ' balance=' + sup.balance);

  const purProd = svc.createProduct({ name: 'Purchase Product', sale_price: 90, cost_price: 60, stock_qty: 0, tax_rate: 0 });
  const stockBefore = purProd.stock_qty;
  const po = pur.createPurchaseOrder(sup.id, [
    { product_id: purProd.id, qty: 10, unit_cost: 60 },
    { product_id: purProd.id, qty: 5, unit_cost: 62 },
  ]);
  console.log(
    'PO_CREATED id=' + po.id + ' total=' + po.total_amount + ' supplier_balance=' + pur.listSuppliers().find((s) => s.id === sup.id).balance
  );

  const po2 = pur.createPurchaseOrder(sup.id, [{ product_id: purProd.id, qty: 2, unit_cost: 61 }]);
  console.log('PO2_TOTAL=' + po2.total_amount);

  const received = pur.receivePurchaseOrder(po.id);
  const after = svc.getProduct(purProd.id);
  console.log(
    'PO_RECEIVED status=' + received.status + ' stock_inc=' + (after.stock_qty === stockBefore + 15) + ' cost_updated=' + after.cost_price
  );
  console.log('PRICE_HISTORY=' + pur.purchasePriceHistory(purProd.id).length);

  try {
    pur.receivePurchaseOrder(po.id);
    console.log('PO_DOUBLE_RECEIVE_FAILED=false');
  } catch (e) {
    console.log('PO_DOUBLE_RECEIVE_GUARD=true');
  }

  const paid = pur.paySupplier(sup.id, 500, 'cash');
  console.log('PAY_BALANCE=' + paid.balance + ' LEDGER_ROWS=' + pur.supplierLedger(sup.id).length);

  try {
    pur.paySupplier(sup.id, 99999, 'cash');
    console.log('PAY_OVERPAY_GUARD=false');
  } catch (e) {
    console.log('PAY_OVERPAY_GUARD=true');
  }

  const cancelled = pur.cancelPurchaseOrder(po2.id);
  console.log(
    'PO_CANCELLED=' + cancelled + ' status=' + pur.getPurchaseOrder(po2.id).status + ' balance_after=' + pur.listSuppliers().find((s) => s.id === sup.id).balance
  );

  console.log('ACTIVITY_PURCHASE=' + activity.listActivity().some((a) => a.action === 'purchase_received'));

  console.log('PURCHASES_DONE');

  // ---- Returns ----
  const ret = require('../dist/main/services/returns.js');
  const rp = svc.createProduct({ name: 'Return Product', sale_price: 50, cost_price: 30, stock_qty: 10, tax_rate: 0 });
  const rCust = sales.createCustomer('Return Customer');
  const rSale = sales.createSale({
    items: [
      { product_id: rp.id, qty: 3, price: 50, line_discount: 0, tax_rate: 0 },
      { product_id: rp.id, qty: 2, price: 50, line_discount: 0, tax_rate: 0 },
    ],
    payments: [{ mode: 'cash', amount: 250 }],
    customer_id: rCust.id,
  });
  const rStockAfter = svc.getProduct(rp.id).stock_qty;

  const r1 = ret.createReturn({
    sale_id: rSale.sale.id,
    items: [{ sale_item_id: rSale.items[0].id, qty: 1, unit_price: 50 }],
    reason: 'wrong size',
    refund_mode: 'cash',
    restock: true,
  });
  const rSaleReloaded = sales.getSale(rSale.sale.id);
  console.log(
    'RETURN1 refund=' + r1.refund_amount + ' returns=' + ret.listReturns().length +
    ' stock_restored=' + (svc.getProduct(rp.id).stock_qty === rStockAfter + 1) +
    ' item_ret_qty=' + rSaleReloaded.items[0].returned_qty +
    ' sale_returned_amt=' + rSaleReloaded.returned_amount
  );

  try {
    ret.createReturn({
      sale_id: rSale.sale.id,
      items: [{ sale_item_id: rSale.items[0].id, qty: 99, unit_price: 50 }],
      refund_mode: 'cash',
      restock: true,
    });
    console.log('RETURN_QTY_GUARD=false');
  } catch (e) {
    console.log('RETURN_QTY_GUARD=true');
  }

  try {
    ret.createReturn({
      sale_id: rSale.sale.id,
      items: [{ sale_item_id: rSale.items[1].id, qty: 2, unit_price: 5000 }],
      refund_mode: 'cash',
      restock: true,
    });
    console.log('RETURN_TOTAL_GUARD=false');
  } catch (e) {
    console.log('RETURN_TOTAL_GUARD=true');
  }

  const uCust2 = sales.createCustomer('Return Udhaar Cust');
  const uSale2 = sales.createSale({
    items: [{ product_id: rp.id, qty: 2, price: 50, line_discount: 0, tax_rate: 0 }],
    payments: [],
    customer_id: uCust2.id,
  });
  const balBefore = sales.listCustomers().find((c) => c.id === uCust2.id).balance;
  ret.createReturn({
    sale_id: uSale2.sale.id,
    items: [{ sale_item_id: uSale2.items[0].id, qty: 1, unit_price: 50 }],
    refund_mode: 'cash',
    restock: true,
  });
  const balAfter = sales.listCustomers().find((c) => c.id === uCust2.id).balance;
  console.log('RETURN_UDHAAR_REVERSED=' + (balAfter === balBefore - 50));

  const rCust3 = sales.createCustomer('Return Credit Cust');
  const cSale3 = sales.createSale({
    items: [{ product_id: rp.id, qty: 1, price: 50, line_discount: 0, tax_rate: 0 }],
    payments: [{ mode: 'cash', amount: 50 }],
    customer_id: rCust3.id,
  });
  ret.createReturn({
    sale_id: cSale3.sale.id,
    items: [{ sale_item_id: cSale3.items[0].id, qty: 1, unit_price: 50 }],
    refund_mode: 'credit',
    restock: false,
  });
  const cBal = sales.listCustomers().find((c) => c.id === rCust3.id).balance;
  console.log('RETURN_CREDIT_BALANCE=' + cBal + ' (expect -50 = store credit)');

  console.log('ACTIVITY_RETURN=' + activity.listActivity().some((a) => a.action === 'return_created'));
  console.log('RETURNS_DONE');

  // ---- Users & Roles ----
  auth.logout();

  const lAdmin = auth.login('admin', 'admin123');
  console.log('LOGIN_ADMIN=' + lAdmin.ok + ' role=' + (lAdmin.user ? lAdmin.user.role : 'none') + ' current=' + (auth.currentUser() ? auth.currentUser().username : 'null'));
  const lBad = auth.login('admin', 'wrongpass');
  console.log('LOGIN_BAD=' + !lBad.ok);

  const cash = auth.createUser({ username: 'cash1', password: 'cash123', pin: '1234', role: 'cashier' });
  const mgr = auth.createUser({ username: 'mgr1', password: 'mgr123', role: 'manager' });
  console.log('USER_CREATED cash=' + cash.username + ' role=' + cash.role + ' total=' + auth.listUsers().length);

  try {
    auth.createUser({ username: 'bad', password: 'x', role: 'cashier' });
    console.log('CASHIER_NO_PIN_GUARD=false');
  } catch (e) {
    console.log('CASHIER_NO_PIN_GUARD=true');
  }

  const lPin = auth.loginWithPin('1234');
  console.log('LOGIN_PIN=' + lPin.ok + ' user=' + (lPin.user ? lPin.user.username : 'none') + ' current=' + (auth.currentUser() ? auth.currentUser().username : 'null'));
  const lPinBad = auth.loginWithPin('9999');
  console.log('PIN_BAD=' + !lPinBad.ok);

  let shift0b;
  try {
    shift0b = shifts.openShift(0);
  } catch (e) {
    // If a shift is already open, close it and then open a fresh one
    const curShift = shifts.currentShift();
    if (curShift && !curShift.closed_at) {
      // Close with expected preview if available
      const expected = curShift.expected_preview ?? 0;
      try { shifts.closeShift(curShift.id, expected); } catch (_) {}
    }
    shift0b = shifts.openShift(0);
  }
  console.log('SHIFT_OPEN_ATTEMPT_DONE');

  const cashSale = sales.createSale({
    items: [{ product_id: rp.id, qty: 1, price: 50, line_discount: 0, tax_rate: 0 }],
    payments: [{ mode: 'cash', amount: 50 }],
  });
  console.log('SALE_USER_ID=' + cashSale.sale.user_id + ' (expect ' + cash.id + ')');
  const act = activity.listActivity();
  const cashAct = act.find((a) => a.entity === 'sale' && a.entity_id === cashSale.sale.id);
  console.log('ACTIVITY_USER=' + cashAct.user_id + ' username=' + cashAct.username + ' (expect ' + cash.id + '/cash1)');

  console.log('UNLOCK_PIN=' + auth.verifyForUser(cash.id, '1234') + ' UNLOCK_PASS=' + auth.verifyForUser(cash.id, 'cash123') + ' UNLOCK_BAD=' + !auth.verifyForUser(cash.id, 'nope'));

  try {
    auth.createUser({ username: 'nope', password: 'x123', role: 'cashier' });
    console.log('CASHIER_CANNOT_MANAGE=false');
  } catch (e) {
    console.log('CASHIER_CANNOT_MANAGE=true');
  }
  console.log('CASHIER_REPORTS_ACCESS=' + auth.can('manager') + ' (expect false)');

  auth.logout();
  console.log('LOGOUT_CURRENT=' + (auth.currentUser() === null));

  const lNew = auth.login('cash1', 'cash123');
  console.log('LOGIN_CASH_PASS=' + lNew.ok);

  auth.login('admin', 'admin123');
  const updatedUser = auth.updateUser(cash.id, { password: 'cash999' });
  console.log('RESET_PASSWORD_OK=' + (updatedUser.id === cash.id));
  console.log('LOGIN_NEW_PASS=' + auth.login('cash1', 'cash999').ok + ' OLD_REJECTED=' + !auth.login('cash1', 'cash123').ok);
  auth.login('admin', 'admin123');
  const setPinMgr = auth.updateUser(mgr.id, { pin: '7777' });
  console.log('SET_MGR_PIN=OK');

  try {
    auth.deleteUser(1);
    console.log('DELETE_OWNER_GUARD=false');
  } catch (e) {
    console.log('DELETE_OWNER_GUARD=true');
  }
  const cashShiftOpen = shifts.listShifts().find((s) => s.user_id === cash.id && !s.closed_at);
  try {
    auth.deleteUser(cash.id);
    console.log('DELETE_OPEN_SHIFT_GUARD=false');
  } catch (e) {
    console.log('DELETE_OPEN_SHIFT_GUARD=' + e.message.toLowerCase().includes('shift'));
  }
  if (cashShiftOpen) shifts.forceCloseShift(cashShiftOpen.id);
  console.log('DELETE_CASHIER=' + auth.deleteUser(cash.id) + ' remaining=' + auth.listUsers().length);
  console.log('DELETE_GONE=' + !auth.listUsers().some((u) => u.username === 'cash1'));

  try {
    auth.deleteUser(mgr.id);
    console.log('DELETE_MANAGER_OK=true');
  } catch (e) {
    console.log('DELETE_MANAGER_OK=false');
  }

  auth.logout();
  console.log('USERS_DONE');

  // ---- Stock Audit ----
  const audits = require('../dist/main/services/audits.js');
  const ap1 = svc.createProduct({ name: 'Audit Item A', sale_price: 50, cost_price: 20, stock_qty: 10, tax_rate: 0 });
  const ap2 = svc.createProduct({ name: 'Audit Item B', sale_price: 30, cost_price: 15, stock_qty: 4, tax_rate: 0 });

  try {
    audits.createAudit();
    console.log('AUDIT_ROLE_GUARD=false');
  } catch (e) {
    console.log('AUDIT_ROLE_GUARD=' + e.message.includes('owner or manager'));
  }

  auth.login('admin', 'admin123');
  const a1 = audits.createAudit();
  console.log('AUDIT_CREATED id=' + a1.id + ' items=' + a1.total_items + ' status=' + a1.status);
  const a1Full = audits.getAudit(a1.id);
  console.log(
    'AUDIT_ITEMS=' + a1Full.items.length +
    ' hasA=' + a1Full.items.some((i) => i.product_name === 'Audit Item A') +
    ' sysA=' + a1Full.items.find((i) => i.product_name === 'Audit Item A').system_qty
  );

  audits.saveCounts(a1.id, [{ product_id: ap1.id, counted_qty: 8 }]);
  const resumed = audits.getAudit(a1.id);
  console.log(
    'AUDIT_SAVED countedA=' + resumed.items.find((i) => i.product_id === ap1.id).counted_qty +
    ' status=' + resumed.status + ' (resumable)'
  );

  audits.saveCounts(a1.id, [{ product_id: ap1.id, counted_qty: 8 }, { product_id: ap2.id, counted_qty: 7 }]);
  const done = audits.completeAudit(a1.id);
  console.log(
    'AUDIT_COMPLETED status=' + done.status + ' items=' + done.total_items + ' variance=' + done.total_variance +
    ' (expect 1)'
  );

  const stA = svc.getProduct(ap1.id).stock_qty;
  const stB = svc.getProduct(ap2.id).stock_qty;
  console.log('AUDIT_STOCK_ADJ A=' + stA + ' (expect 8) B=' + stB + ' (expect 7)');
  console.log(
    'AUDIT_MOVEMENT=' +
    svc.listMovements(ap1.id).some((m) => m.reason === 'Stock Audit Adjustment' && m.ref_type === 'audit' && m.ref_id === a1.id && m.change_qty === -2)
  );
  console.log(
    'AUDIT_ACTIVITY=' +
    activity.listActivity().some((x) => x.action === 'audit_completed' && x.entity_id === a1.id)
  );

  try {
    audits.completeAudit(a1.id);
    console.log('AUDIT_REOPEN_GUARD=false');
  } catch (e) {
    console.log('AUDIT_REOPEN_GUARD=true');
  }

  const hist = audits.listAudits();
  console.log(
    'AUDIT_HISTORY=' + hist.length + ' by=' + hist[0].username + ' overage=' + hist[0].overage + ' shortage=' + hist[0].shortage
  );
  console.log('AUDIT_DETAIL_ITEMS=' + audits.getAudit(a1.id).items.length);

  const uncounted = audits.getAudit(a1.id).items.find((i) => i.product_name === 'Billing Test');
  console.log('AUDIT_UNCOUNTED_UNTOUCHED=' + (uncounted === undefined || uncounted.counted_qty === null));
  console.log('AUDITS_DONE');

  // ---- Promotions ----
  const promos = require('../dist/main/services/promotions.js');

  auth.logout();
  try {
    promos.createPromotion({ name: 'x', type: 'percent', scope: 'product', product_id: 1, discount_value: 10 });
    console.log('PROMO_ROLE_GUARD=false');
  } catch (e) {
    console.log('PROMO_ROLE_GUARD=' + e.message.includes('owner or manager'));
  }

  auth.login('admin', 'admin123');
  let pCat;
  try {
    pCat = svc.createCategory('Promo Cat');
    console.log('CATEGORY_Promo=' + pCat.name);
  } catch (e) {
    console.log('CATEGORY_Promo_EXISTS=' + e.message);
    // Retrieve existing category by name
    const existing = svc.listCategories().find((c) => c.name === 'Promo Cat');
    pCat = existing ? existing : { name: 'Promo Cat' };
  }
  const pp1 = svc.createProduct({ name: 'Promo A', sale_price: 100, cost_price: 40, stock_qty: 50, tax_rate: 0 });
  const pp2 = svc.createProduct({ name: 'Promo B', sale_price: 100, cost_price: 40, stock_qty: 50, tax_rate: 0, category_id: pCat.id });
  const pp3 = svc.createProduct({ name: 'Promo C', sale_price: 50, cost_price: 20, stock_qty: 50, tax_rate: 0 });
  const pp4 = svc.createProduct({ name: 'Promo D', sale_price: 100, cost_price: 40, stock_qty: 50, tax_rate: 0, category_id: pCat.id });

  promos.createPromotion({ name: 'A 20% off', type: 'percent', scope: 'product', product_id: pp1.id, discount_value: 20 });
  const pctP2 = promos.createPromotion({ name: 'A 10% off', type: 'percent', scope: 'product', product_id: pp1.id, discount_value: 10 });
  promos.createPromotion({ name: 'Cat Rs10 off', type: 'fixed', scope: 'category', category_id: pCat.id, discount_value: 10 });
  const bogo = promos.createPromotion({ name: 'Buy2 Get1 Free', type: 'bogo', scope: 'product', product_id: pp2.id, discount_value: 100, buy_qty: 2, free_qty: 1 });
  promos.createPromotion({ name: 'Expired Deal', type: 'percent', scope: 'product', product_id: pp3.id, discount_value: 25, start_date: '2020-01-01', end_date: '2020-12-31' });
  promos.createPromotion({ name: 'D Prod 10 off', type: 'fixed', scope: 'product', product_id: pp4.id, discount_value: 10 });
  promos.createPromotion({ name: 'D Cat 10 off', type: 'fixed', scope: 'category', category_id: pCat.id, discount_value: 10 });
  console.log('PROMO_CREATED total=' + promos.listPromotions().length);

  const pr1 = promos.resolvePromotions([{ product_id: pp1.id, qty: 1, price: 100 }]);
  console.log('PROMO_BEST=' + (pr1[0].effective_price === 80 && pr1[0].promo_name === 'A 20% off'));

  const pr2 = promos.resolvePromotions([{ product_id: pp2.id, qty: 1, price: 100 }]);
  console.log('PROMO_CATEGORY=' + (pr2[0].effective_price === 90 && pr2[0].promo_name === 'Cat Rs10 off'));

  const pr3 = promos.resolvePromotions([{ product_id: pp2.id, qty: 3, price: 100 }]);
  console.log('PROMO_BOGO=' + (Math.abs(pr3[0].effective_price - 200 / 3) < 0.01 && pr3[0].promo_name === 'Buy2 Get1 Free'));

  const pr4 = promos.resolvePromotions([{ product_id: pp3.id, qty: 1, price: 50 }]);
  console.log('PROMO_DATE_RANGE=' + (pr4[0].promo_id === null && pr4[0].effective_price === 50));

  const pr7 = promos.resolvePromotions([{ product_id: pp4.id, qty: 1, price: 100 }]);
  console.log('PROMO_TIE_PRODUCT_WINS=' + (pr7[0].promo_name === 'D Prod 10 off' && pr7[0].effective_price === 90));

  const pSale = sales.createSale({
    items: [{ product_id: pp1.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
    payments: [{ mode: 'cash', amount: 80 }],
  });
  const pSaleFull = sales.getSale(pSale.sale.id);
  console.log(
    'PROMO_SALE total=' + pSale.sale.total_amount + ' (expect 80) unit=' + pSaleFull.items[0].unit_price +
    ' promo=' + pSaleFull.items[0].promo_name + ' (expect A 20% off)'
  );

  const bSale = sales.createSale({
    items: [{ product_id: pp2.id, qty: 3, price: 100, line_discount: 0, tax_rate: 0 }],
    payments: [{ mode: 'cash', amount: 200 }],
  });
  console.log(
    'PROMO_BOGO_SALE total=' + bSale.sale.total_amount + ' (expect 200) promo=' + sales.getSale(bSale.sale.id).items[0].promo_name
  );

  const pctP = promos.listPromotions().find((p) => p.name === 'A 20% off');
  promos.updatePromotion(pctP.id, { name: 'A 20% off', type: 'percent', scope: 'product', product_id: pp1.id, discount_value: 20, active: false });
  const pr5 = promos.resolvePromotions([{ product_id: pp1.id, qty: 1, price: 100 }]);
  console.log('PROMO_DISABLED=' + (pr5[0].promo_name !== 'A 20% off' && pr5[0].promo_name === 'A 10% off'));

  promos.updatePromotion(pctP.id, { name: 'A 30% off', type: 'percent', scope: 'product', product_id: pp1.id, discount_value: 30, active: true });
  const pr6 = promos.resolvePromotions([{ product_id: pp1.id, qty: 1, price: 100 }]);
  console.log('PROMO_UPDATE=' + (pr6[0].effective_price === 70 && pr6[0].promo_name === 'A 30% off'));

  console.log('PROMO_DELETE=' + promos.deletePromotion(pctP2.id));

  try {
    promos.createPromotion({ name: 'Bad Bogo', type: 'bogo', scope: 'category', category_id: pCat.id, discount_value: 100, buy_qty: 2, free_qty: 1 });
    console.log('BOGO_SCOPE_GUARD=false');
  } catch (e) {
    console.log('BOGO_SCOPE_GUARD=true');
  }

  const promoPrint = require('../dist/main/services/printing.js');
  console.log('PROMO_RECEIPT=' + promoPrint.buildReceiptHtml(pSale.sale.id).includes('Promo: A 20% off'));
  console.log('PROMO_ACTIVITY=' + activity.listActivity().some((a) => a.action === 'promo_created'));
  const invoiceHtml = promoPrint.buildInvoiceHtml(pSale.sale.id);
  console.log('INVOICE_LOGO=' + invoiceHtml.includes('data:image/png;base64,FAKE'));
  console.log('INVOICE_CASHIER=' + invoiceHtml.includes('Cashier'));
    console.log('INVOICE_PROMO=' + invoiceHtml.includes('Promo: A 20% off'));
    // Test preview invoice (opens a preview window, should not error)
    try {
      const printing = require('../dist/main/services/printing.js');
      printing.previewInvoice(pSale.sale.id);
      console.log('PREVIEW_INVOICE_OK=true');
    } catch (e) {
      console.log('PREVIEW_INVOICE_FAIL=' + e.message);
    }
  console.log('INVOICE_TOTAL=' + invoiceHtml.includes('Rs 80'));
  auth.logout();
   console.log('PROMOTIONS_DONE');
   // --- Offline license checks and expiry handling ---
   // Simulate offline by pointing Server URL to a dead endpoint
   process.env.SERVER_URL = 'http://127.0.0.1:9';
   // Offline check within grace period (should succeed)
   await licensing.checkLicense();
   console.log('LICENSE_CHECK_OFFLINE_GRACE=OK');
   // Set expiry to 6 days ahead to trigger warning
   const warnDate = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
   settings.setSetting('license_expires', warnDate.toISOString());
   await licensing.checkLicense(); // should log LICENSE_WARNING=6
   // Set expiry far in the past (beyond grace) to simulate full expiry
   const pastDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
   settings.setSetting('license_expires', pastDate.toISOString());
   // Ensure last check is old enough
   settings.setSetting('license_last_check', (Date.now() - 13 * 60 * 60 * 1000).toString());
   try {
     await licensing.checkLicense();
     console.log('LICENSE_CHECK_OFFLINE_EXPIRED=FAIL');
   } catch (e) {
     console.log('LICENSE_CHECK_OFFLINE_EXPIRED=OK');
   }
   // Attempt a new sale – should be blocked by license expiration
   try {
     sales.createSale({
       items: [{ product_id: pp1.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
       payments: [{ mode: 'cash', amount: 100 }],
     });
     console.log('SALE_AFTER_EXPIRED=FAIL');
   } catch (e) {
     console.log('SALE_AFTER_EXPIRED=' + (e.message.includes('License') ? 'OK' : 'FAIL'));
   }
   // Restore a valid license so the remaining smoke tests can run normally
   const restored = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
   settings.setSetting('license_expires', restored.toISOString());
   settings.setSetting('license_last_check', Date.now().toString());
   console.log('LICENSE_RESTORED');

  // ---- Packaging / logging / password-change ----
  const printing = require('../dist/main/services/printing.js');
  const labelHtml = await printing.buildLabelHtml(rp.id, 2);
  console.log(
    'LABEL_HTML=' + (labelHtml.includes('data:image/png;base64') && labelHtml.includes('Return Product') && labelHtml.includes('Rs 50')) +
    ' copies=' + (labelHtml.match(/class="label"/g) || []).length
  );

  const barcodeOnlyHtml = await printing.buildBarcodeLabelHtml(rp.id, 2);
  console.log(
    'BARCODE_LABEL_HTML=' + (barcodeOnlyHtml.includes('data:image/png;base64') && !barcodeOnlyHtml.includes('Return Product') && !barcodeOnlyHtml.includes('Rs 50')) +
    ' copies=' + (barcodeOnlyHtml.match(/class="label"/g) || []).length
  );

  let app;
  try {
    const electron = require('electron');
    app = electron.app;
  } catch (e) {
    app = undefined;
  }
  const fs = require('fs');
  const path = require('path');
  let logsDir = '';
  if (app && app.getPath && typeof app.getPath === 'function') {
    logsDir = path.join(app.getPath('userData'), 'logs');
  }
  let logFiles = [];
  if (logsDir) {
    logFiles = fs.existsSync(logsDir) ? fs.readdirSync(logsDir).filter((f) => f.endsWith('.log')) : [];
  }
  console.log('LOG_FILE=' + logFiles.length + (logsDir ? ' exists=' + (logFiles[0] ? fs.existsSync(path.join(logsDir, logFiles[0])) : false) : ''));

  console.log('DEFAULT_PW=' + auth.defaultPasswordActive());
  auth.login('admin', 'admin123');
  const pwAdmin = auth.listUsers().find((u) => u.username === 'admin');
  auth.updateUser(pwAdmin.id, { password: 'temp999' });
  console.log('DEFAULT_PW_AFTER_CHANGE=' + auth.defaultPasswordActive());
  auth.updateUser(pwAdmin.id, { password: 'admin123' });
  console.log('DEFAULT_PW_RESTORED=' + auth.defaultPasswordActive());
  auth.logout();

  console.log('PACKAGING_DONE');

  // ---- Cloud Backup ----
  const os = require('os');
  const cloudDir = path.join(os.tmpdir(), 'pos-cloud-test-' + Date.now());
  fs.mkdirSync(cloudDir, { recursive: true });
  settings.setSetting('cloud_backup_folder', cloudDir);
  const rb = backup.runBackup();
  console.log(
    'CLOUD_BACKUP_OK=' + (rb.cloudOk && rb.cloudPath !== null && fs.existsSync(rb.cloudPath)) +
    ' file=' + path.basename(rb.localPath)
  );
  console.log('CLOUD_LAST_TS=' + (settings.getAllSettings().last_cloud_backup.length > 0));

  settings.setSetting('cloud_backup_folder', path.join(os.tmpdir(), 'pos-missing-' + Date.now()));
  const rb2 = backup.runBackup();
  console.log(
    'CLOUD_MISSING_WARN=' + (!rb2.cloudOk && rb2.cloudError !== null && rb2.cloudError.length > 0 &&
      settings.getAllSettings().cloud_backup_status.length > 0 && rb2.cloudPath === null)
  );

  settings.setSetting('cloud_backup_folder', '');
  const rb3 = backup.runBackup();
  console.log(
    'CLOUD_DISABLED=' + (rb3.cloudOk && rb3.cloudPath === null && rb3.cloudError === null &&
      settings.getAllSettings().cloud_backup_status === '')
  );

  fs.rmSync(cloudDir, { recursive: true, force: true });
  console.log('CLOUD_BACKUP_DONE');

  // ---- Shifts ----
  const sp = svc.createProduct({ name: 'Shift Product', sale_price: 100, cost_price: 50, stock_qty: 200, tax_rate: 0 });
  const sp2 = svc.createProduct({ name: 'Shift Product 2', sale_price: 200, cost_price: 100, stock_qty: 200, tax_rate: 0 });

  auth.login('admin', 'admin123');
  const g0 = shifts.currentShift();
  console.log('SHIFT_CURRENT=' + (g0 !== null && g0.opened_at !== undefined));
  const pv0 = shifts.getShift(g0.id);
  shifts.closeShift(g0.id, pv0.expected_preview);
  const g0c = shifts.getShift(g0.id);
  console.log(
    'SHIFT_CLOSE_OK=' + (g0c.closed_at !== null && g0c.variance === 0 && g0c.expected_cash === pv0.expected_preview)
  );

  try {
    sales.createSale({
      items: [{ product_id: sp.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
      payments: [{ mode: 'cash', amount: 100 }],
    });
    console.log('SHIFT_REQUIRED=false');
  } catch (e) {
    console.log('SHIFT_REQUIRED=' + e.message.toLowerCase().includes('shift'));
  }

  const sh = shifts.openShift(500);
  console.log(
    'SHIFT_OPENED=' + (sh.start_cash === 500 && sh.closed_at === null) + ' current=' + (shifts.currentShift().id === sh.id)
  );
  try {
    shifts.openShift(100);
    console.log('SHIFT_SINGLE=false');
  } catch (e) {
    console.log('SHIFT_SINGLE=' + e.message.toLowerCase().includes('already'));
  }

  const ss1 = sales.createSale({
    items: [{ product_id: sp.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
    payments: [{ mode: 'cash', amount: 100 }],
  });
  const ss2 = sales.createSale({
    items: [{ product_id: sp2.id, qty: 1, price: 200, line_discount: 0, tax_rate: 0 }],
    payments: [{ mode: 'card', amount: 200 }],
  });
  console.log(
    'SHIFT_SALE_TAG=' + (sales.getSale(ss1.sale.id).shift_id === sh.id && sales.getSale(ss2.sale.id).shift_id === sh.id)
  );
  sales.voidSale(ss2.sale.id, 'shift test void');
  const ss3 = sales.createSale({
    items: [{ product_id: sp.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
    payments: [{ mode: 'cash', amount: 100 }],
  });
  const rt = ret.createReturn({
    sale_id: ss3.sale.id,
    items: [{ sale_item_id: ss3.items[0].id, qty: 1, unit_price: 100 }],
    refund_mode: 'cash',
    restock: true,
  });
  const pv = shifts.getShift(sh.id);
  console.log(
    'SHIFT_EXPECTED=' + (pv.expected_preview === 600) + ' cash_sales=' + pv.cash_sales + ' refunds=' + pv.cash_refunds
  );
  const cl1 = shifts.closeShift(sh.id, 600);
  console.log('SHIFT_CLOSE_VAR0=' + (cl1.variance === 0 && cl1.end_cash === 600 && cl1.expected_cash === 600));

  const sh2 = shifts.openShift(100);
  sales.createSale({
    items: [{ product_id: sp.id, qty: 1, price: 50, line_discount: 0, tax_rate: 0 }],
    payments: [{ mode: 'cash', amount: 50 }],
  });
  const cl2 = shifts.closeShift(sh2.id, 160);
  console.log('SHIFT_OVER=' + (cl2.variance === 10));

  const sh3 = shifts.openShift(100);
  sales.createSale({
    items: [{ product_id: sp.id, qty: 1, price: 30, line_discount: 0, tax_rate: 0 }],
    payments: [{ mode: 'cash', amount: 30 }],
    price_floor_override: true,
  });
  const cl3 = shifts.closeShift(sh3.id, 120);
  console.log('SHIFT_SHORT=' + (cl3.variance === -10));

  const sh4 = shifts.openShift(0);
  const fc = shifts.forceCloseShift(sh4.id);
  console.log('SHIFT_FORCE=' + (fc.forced === 1 && fc.variance === 0));

  const sh5 = shifts.openShift(100);
  const cf = ret.createCashRefund(25, 'petty refund');
  const g5 = shifts.getShift(sh5.id);
  console.log(
    'CASH_REFUND=' + (cf.amount === 25 && g5.cash_refunds === 25 && g5.expected_preview === 75) +
    ' list=' + ret.listCashRefunds().length
  );
  try {
    ret.createCashRefund(-5);
    console.log('CASH_REFUND_GUARD=false');
  } catch (e) {
    console.log('CASH_REFUND_GUARD=' + e.message.includes('positive'));
  }
  shifts.forceCloseShift(sh5.id);

  const shiftList = shifts.listShifts();
  console.log('SHIFT_HISTORY=' + (shiftList.length >= 5 && shiftList[0].username === 'admin'));
  const det = shifts.getShift(sh.id);
  console.log('SHIFT_DETAIL=' + det.sales.filter((x) => x.status === 'completed').length + ' completed sales');

  auth.logout();
  try {
    shifts.listShifts();
    console.log('SHIFT_ROLE_GUARD=false');
  } catch (e) {
    console.log('SHIFT_ROLE_GUARD=' + e.message.toLowerCase().includes('manager'));
  }
  console.log('SHIFTS_DONE');
}

module.exports = { runSmoke };

if (require.main === module) {
  runSmoke()
    .then(() => {
      console.log('SMOKE_PASS');
      process.exit(0);
    })
    .catch((e) => {
      console.log('FAIL=' + e.message);
      process.exit(1);
    });
}
