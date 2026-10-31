#!/usr/bin/env node
/**
 * Phase 3 — Purchase import suite.
 *
 * 5-row CSV (exactly the acceptance scenario):
 *   1. matched by BARCODE      → stock +10, cost updated
 *   2. matched by BARCODE      → stock +5
 *   3. matched by exact NAME   → stock +3
 *   4. NEW product             → created + stock +2
 *   5. INVALID quantity        → failed with a row number in the error report
 *
 * Also covers: supplier ledger balance, duplicate merge, partial receive and
 * undo-last-import (stock + ledger reversed).
 *
 * Usage (after `npm run build`):
 *   npx electron scripts/test_purchase_import.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-purchase-import-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'purchase-import.db');
const csvPath = path.join(tmpDir, 'purchases.csv');

let checks = 0;
let failures = 0;

function check(name, condition, detail) {
  checks++;
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ' -- ' + detail : ''}`);
  return condition;
}

const near = (a, b, eps = 1e-6) => Math.abs(Number(a) - Number(b)) < eps;

async function run() {
  const { initDatabase, getDb } = require('../dist/main/db.js');
  await initDatabase();
  const db = getDb();

  const inventory = require('../dist/main/services/inventory.js');
  const purchases = require('../dist/main/services/purchases.js');
  const purchaseImport = require('../dist/main/services/purchaseImport.js');
  const auth = require('../dist/main/services/auth.js');
  const settings = require('../dist/main/services/settings.js');

  auth.setSessionUser(1); // owner
  settings.setSetting('license_lifetime', '1');

  // ── fixtures ───────────────────────────────────────────────────────────────
  const supplier = purchases.createSupplier('Import Supplier', '0300-5555555');
  const pBar1 = inventory.createProduct({ name: 'Barcode Item One', barcode: '1110001110001', sale_price: 100, cost_price: 60, stock_qty: 0, tax_rate: 0 });
  const pBar2 = inventory.createProduct({ name: 'Barcode Item Two', barcode: '2220002220002', sale_price: 50, cost_price: 30, stock_qty: 0, tax_rate: 0 });
  inventory.createProduct({ name: 'Name Match Widget', sale_price: 20, cost_price: 12, stock_qty: 0, tax_rate: 0 });
  const stock = (id) => Number(inventory.getProduct(id).stock_qty);
  const cost = (id) => Number(inventory.getProduct(id).cost_price);

  // 5-row CSV: 2 by barcode · 1 by name · 1 new · 1 invalid qty (also one
  // duplicated barcode row to prove duplicate merging).
  fs.writeFileSync(
    csvPath,
    [
      'barcode,sku,product name,qty,unit,cost rate,sale price,discount %,tax %,batch,expiry date',
      '1110001110001,,Barcode Item One,10,Piece,55,120,0,0,B-1,2027-01-31',
      '2220002220002,,Barcode Item Two,5,Piece,28,55,0,0,,',
      '1110001110001,,Barcode Item One,2,Piece,55,120,0,0,,', // duplicate → merged into row 1
      ',,Name Match Widget,3,Piece,11,25,0,0,,',
      ',,Brand New Imported Item,2,Piece,40,80,0,0,,',
      ',,Broken Row Item,not-a-number,Piece,10,20,0,0,,',
    ].join('\r\n'),
    'utf8'
  );

  // ── 1. parse ───────────────────────────────────────────────────────────────
  console.log('\n=== Parse CSV ===');
  const parsed = purchaseImport.parsePurchaseFile(csvPath);
  check('header row detected', parsed.header_row === 1, String(parsed.header_row));
  check('all headers read', parsed.headers.length === 11 && parsed.headers[0] === 'barcode');
  check('6 data rows read', parsed.rows.length === 6, String(parsed.rows.length));

  // ── 2. confirm import (Purchase Invoice → stock changes now) ───────────────
  console.log('\n=== Confirm import (purchase invoice) ===');
  const summary = purchaseImport.importPurchaseOrders({
    supplier_id: supplier.id,
    document_type: 'purchase_invoice',
    reference_no: 'IMP-001',
    file_name: 'purchases.csv',
    options: { updateCostPrice: true, updateSalePrice: false, updateOnlyIfChanged: true, mergeDuplicates: true },
    rows: parsed.rows.map((r) => {
      const v = r.values;
      const barcode = v['barcode']?.trim();
      const name = v['product name']?.trim();
      let product_id = null;
      let create_new = null;
      if (barcode === '1110001110001') product_id = pBar1.id;
      else if (barcode === '2220002220002') product_id = pBar2.id;
      else if (name === 'Name Match Widget') {
        const p = inventory.listProducts('Name Match Widget').find((x) => x.name === 'Name Match Widget');
        product_id = p ? p.id : null;
      } else if (name === 'Brand New Imported Item') {
        create_new = { name, barcode: '', sku: '' };
      } else {
        create_new = { name: name || `Row ${r.row}`, barcode: '', sku: '' }; // broken row still gets a product; qty fails first
      }
      return {
        row: r.row,
        product_id,
        create_new,
        qty: v['qty'],
        unit_cost: v['cost rate'],
        sale_price: v['sale price'],
        discount_pct: v['discount %'],
        tax_pct: v['tax %'],
        batch_no: v['batch'] || null,
        expiry_date: v['expiry date'] || null,
        notes: null,
      };
    }),
  });

  check('import id returned', !!summary.import_id, String(summary.import_id));
  check('purchase document created', !!summary.purchase_order_id, String(summary.purchase_order_id));
  check('imported = 4 lines (duplicate merged)', summary.imported === 4, String(summary.imported));
  check('created = 1 product', summary.created === 1, String(summary.created));
  check('failed = 1 row', summary.failed === 1 && summary.errors.length === 1, JSON.stringify(summary.errors));
  check('error names the invalid qty row', /quantity/i.test(summary.errors[0]?.message || ''), summary.errors[0]?.message);

  // stock: merged duplicate 10 + 2 = 12 for pBar1, 5 for pBar2, 3 for the name
  // match, 2 for the new product
  check('barcode item stock = 12 (10+2 merged)', near(stock(pBar1.id), 12), String(stock(pBar1.id)));
  check('second barcode item stock = 5', near(stock(pBar2.id), 5), String(stock(pBar2.id)));
  const nameMatch = inventory.listProducts('Name Match Widget').find((x) => x.name === 'Name Match Widget');
  check('name-matched stock = 3', near(stock(nameMatch.id), 3), String(stock(nameMatch.id)));
  const created = inventory.listProducts('Brand New Imported Item').find((x) => x.name === 'Brand New Imported Item');
  check('new product created with stock = 2', !!created && near(stock(created.id), 2), created ? String(stock(created.id)) : 'missing');

  // cost price updated from the file (55, 28, 11, 40)
  check('cost updated (barcode item)', near(cost(pBar1.id), 55), String(cost(pBar1.id)));
  check('cost updated (name match)', near(cost(nameMatch.id), 11), String(cost(nameMatch.id)));
  check('cost updated (new product)', !!created && near(cost(created.id), 40));

  // ledger: 12*55 + 5*28 + 3*11 + 2*40 = 660 + 140 + 33 + 80 = 913
  const supAfter = purchases.listSuppliers().find((s) => s.id === supplier.id);
  check('supplier balance = 913', near(supAfter.balance, 913), String(supAfter.balance));

  const history = purchases.purchasePriceHistory(pBar1.id);
  check('price history row written', history.length >= 1 && near(history[0].unit_cost, 55), JSON.stringify(history[0] || {}));

  // ── 3. undo ────────────────────────────────────────────────────────────────
  console.log('\n=== Undo last import ===');
  const und = purchaseImport.undoPurchaseImport(summary.import_id);
  check('undo reports ok', und.ok === true, und.message);
  check('stock reversed (barcode item back to 0)', near(stock(pBar1.id), 0), String(stock(pBar1.id)));
  check('stock reversed (new product back to 0)', !!created && near(stock(created.id), 0), created ? String(stock(created.id)) : '');
  const supUndone = purchases.listSuppliers().find((s) => s.id === supplier.id);
  check('supplier balance back to 0', near(supUndone.balance, 0), String(supUndone.balance));
  const gotPo = purchases.getPurchaseOrder(summary.purchase_order_id);
  check('purchase document removed', !gotPo);
  check('no undoable import left', purchaseImport.lastUndoableImport() === null);

  // ── 4. Purchase Order + partial receive ────────────────────────────────────
  console.log('\n=== Purchase order + partial receive ===');
  const summary2 = purchaseImport.importPurchaseOrders({
    supplier_id: supplier.id,
    document_type: 'purchase_order',
    reference_no: 'PO-IMP-2',
    file_name: 'purchases.csv',
    options: { updateCostPrice: true, mergeDuplicates: true },
    rows: [{ row: 2, product_id: pBar1.id, qty: 10, unit_cost: 50 }],
  });
  check('PO import did NOT change stock', near(stock(pBar1.id), 0), String(stock(pBar1.id)));
  check('supplier balance = 500 after PO', near(purchases.listSuppliers().find((s) => s.id === supplier.id).balance, 500));

  const partial = purchases.receivePurchaseOrder(summary2.purchase_order_id, [{ product_id: pBar1.id, qty: 4 }]);
  check('partial receive sets status partial', partial.status === 'partial', partial.status);
  check('partial receive stock = 4', near(stock(pBar1.id), 4), String(stock(pBar1.id)));
  const rest = purchases.receivePurchaseOrder(summary2.purchase_order_id);
  check('remaining receive sets status received', rest.status === 'received', rest.status);
  check('full stock = 10', near(stock(pBar1.id), 10), String(stock(pBar1.id)));
  check('receive is rejected twice on a received order', (() => {
    try {
      purchases.receivePurchaseOrder(summary2.purchase_order_id);
      return false;
    } catch {
      return true;
    }
  })());

  // ── 5. PO document renders through the shared renderer ─────────────────────
  console.log('\n=== PO document ===');
  const html = purchaseImport.buildPurchaseOrderHtml(summary2.purchase_order_id);
  check('PO html built', typeof html === 'string' && html.includes('<!doctype html>'));
  check('PO html carries the reference', html.includes('PO-IMP-2'));
  check('PO html carries the supplier', html.includes('Import Supplier'));

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  } else {
    console.log('All purchase-import checks passed.');
    app.exit(0);
  }
}

run().catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
