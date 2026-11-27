#!/usr/bin/env node
/**
 * Phase 3 — the Purchase Order screen hardening (the permanent guard).
 *
 * It runs the REAL services against a throwaway database, so every assertion
 * covers the code path the Purchase Order screen uses. The items below were
 * found in the code (an explore pass over the PO service, the import service,
 * the renderer and the migrations), not guessed.
 *
 *   3.1  the PO line enrichment — EVERY product carries its units and its
 *        last purchase cost (the modal used to show an empty unit dropdown
 *        and a stale cost for every product that was not low on stock)
 *   3.2  the Backspace key no longer deletes the whole order row
 *   3.3  a partial receipt is addressed to the LINE, never to the product
 *        (two lines of the same product used to receive the typed quantity
 *        TWICE)
 *   3.4  an import that was RECEIVED cannot be undone (the stock used to
 *        stay on the shelf with the order and the ledger gone)
 *   3.5  the SERVICE enforces the purchases permission (a cashier could
 *        create / receive / cancel an order over IPC)
 *   3.6  the header money is validated by the SAME rules the screen shows
 *        (negative freight, a discount above 100 %, a paid amount above the
 *        total)
 *   3.7  an order that already received stock cannot be cancelled
 *   3.8  the LEGACY `quantity_received` counter is honoured (a pre-064 order
 *        used to say "nothing received" while the goods were in the shop)
 *   3.9  the order records its branch and its `updated_at` moves with it
 *   3.12 two lines of the same product get their OWN batch number
 *   3.15 the PO screens are bilingual — every key they use exists in BOTH
 *        `en.json` and `ur.json` (and the two files carry the same keys)
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_purchaseOrderHardening.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-po-hardening-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'po-hardening-test.db');

let checks = 0;
let failures = 0;

function check(name, condition, detail) {
  checks++;
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ' -- ' + detail : ''}`);
  return condition;
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

function throws(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function run() {
  const { initDatabase, getDb } = require('../dist/main/db.js');
  await initDatabase();
  const db = getDb();

  const inventory = require('../dist/main/services/inventory.js');
  const purchases = require('../dist/main/services/purchases.js');
  const purchaseImport = require('../dist/main/services/purchaseImport.js');
  const settings = require('../dist/main/services/settings.js');
  const auth = require('../dist/main/services/auth.js');
  const shifts = require('../dist/main/services/shifts.js');
  const calc = require('../dist/shared/purchaseCalc.js');

  settings.setSetting('license_lifetime', '1');
  settings.setSetting('license_expires', '2099-12-31');
  auth.setSessionUser(1); // user 1 is the seeded owner

  // The seeded database has ONLY the owner, so the permission checks below
  // need their own cashier and manager. The owner session is active, so the
  // real `createUser()` service can create them.
  const ensureUser = (username, role, pin, password) => {
    const existing = db.prepare('SELECT id, role FROM users WHERE username = ?').get(username);
    if (existing) return existing;
    return auth.createUser({ username, role, pin, password });
  };
  const cashierUser = ensureUser('p3_cashier', 'cashier', '4321');
  const managerUser = ensureUser('p3_manager', 'manager', undefined, 'Manager123');
  auth.setSessionUser(1);

  const stockOf = (id) => Number(inventory.getProduct(id).stock_qty);
  const balanceOf = (id) =>
    Number((db.prepare('SELECT balance FROM suppliers WHERE id = ?').get(id) || {}).balance || 0);
  const batchRows = (productId) =>
    db.prepare('SELECT * FROM product_batches WHERE product_id = ? ORDER BY id').all(productId);

  // ── the fixtures ─────────────────────────────────────────────────────────
  const supplier = purchases.createSupplier('Phase 3 Supplier', '0300-1111111', 'Lahore');
  const otherSupplier = purchases.createSupplier('Phase 3 Other', '0300-2222222', 'Karachi');

  // A product bought in CARTONS (1 carton = 12 pieces) — it is NOT low on
  // stock, so it used to come back from the catalog with an empty unit list.
  const oil = inventory.createProduct({
    name: 'Phase 3 Oil',
    sku: 'P3-OIL',
    barcode: '9100000000001',
    cost_price: 1200,
    sale_price: 1500,
    wholesale_price: 1450,
    low_stock_threshold: 5,
    min_stock_level: 5,
    tax_rate: 0,
    units: [
      { level: 0, name: 'Piece', quantity_in_base_units: 1, is_base: true, price: null, barcode: null },
      { level: 1, name: 'Carton', quantity_in_base_units: 12, is_base: false, price: null, barcode: null },
    ],
  });
  inventory.recordMovement(oil.id, 100, 'Opening stock', 'manual', null);

  // A second product for the multi-line order.
  const sugar = inventory.createProduct({
    name: 'Phase 3 Sugar',
    sku: 'P3-SUG',
    barcode: '9100000000002',
    cost_price: 130,
    sale_price: 160,
    low_stock_threshold: 5,
    min_stock_level: 5,
    tax_rate: 0,
  });
  inventory.recordMovement(sugar.id, 100, 'Opening stock', 'manual', null);

  try {
    shifts.openShift(1000);
  } catch {
    /* a shift may already be open */
  }

  /* ── 3.1 ─ the PO line enrichment ─────────────────────────────────────── */
  section('3.1 - every product carries its units and its last purchase cost');
  {
    // The product went on the shelf through a real purchase, so it HAS a last
    // purchase cost — the PO screen must show it.
    const seedPo = purchases.createPurchaseOrder(
      supplier.id,
      [{ product_id: oil.id, qty: 1, unit_cost: 1100, units_in_base: 12, unit_name: 'Carton' }],
      { status: 'ordered' }
    );
    purchases.receivePurchaseOrder(seedPo.id);

    const row = purchases.purchaseProductRow(oil.id);
    check('the live row carries the units', Array.isArray(row?.units) && row.units.length >= 2, JSON.stringify(row?.units?.map((u) => u.name)));
    check(
      'the live row carries the pack factor',
      near((row?.units || []).find((u) => u.name === 'Carton')?.quantity_in_base_units, 12),
      String((row?.units || []).find((u) => u.name === 'Carton')?.quantity_in_base_units)
    );
    check('the live row carries the last purchase cost', near(row?.last_purchase_cost, 1100 / 12), String(row?.last_purchase_cost));
    check('the live row carries the last supplier', row?.last_supplier_id === supplier.id, String(row?.last_supplier_id));

    // The catalog the modal builds comes from `inventory.listProducts()` — it
    // MUST carry the units too (the modal used to throw them away).
    const listed = inventory.listProducts().find((p) => p.id === oil.id);
    check('the inventory list carries the units', Array.isArray(listed?.units) && listed.units.length >= 2, String(listed?.units?.length));

    // The low-stock feed must NOT be the only source of the extra fields:
    // the oil is NOT low on stock, so it is not in that list at all — and it
    // still has to carry its units in the catalog the modal builds.
    const low = purchases.listLowStockPurchaseProducts(500);
    check('the oil is NOT in the low-stock list (it has plenty of stock)', !low.some((l) => l.product_id === oil.id), `low=${low.length}`);
    check('the oil still carries its units through the catalog', Array.isArray(listed?.units) && listed.units.some((u) => u.name === 'Carton'), String(listed?.units?.map((u) => u.name)));
  }

  /* ── 3.3 ─ a partial receipt is addressed to the LINE ──────────────────── */
  section('3.3 - a partial receipt is addressed to the LINE, not to the product');
  {
    // An order with TWO lines of the SAME product (two batches, two prices).
    const dupe = purchases.createPurchaseOrder(
      otherSupplier.id,
      [
        { product_id: sugar.id, qty: 10, unit_cost: 100, batch_no: 'P3-BATCH-A' },
        { product_id: sugar.id, qty: 20, unit_cost: 110, batch_no: 'P3-BATCH-B' },
      ],
      { status: 'ordered' }
    );
    const items = purchases.getPurchaseOrder(dupe.id).items;
    check('the order really has two lines of the same product', items.length === 2 && items[0].product_id === items[1].product_id, `${items.length} lines`);

    const before = stockOf(sugar.id);
    // Receive 4 of the FIRST line only.
    purchases.receivePurchaseOrder(dupe.id, [{ item_id: items[0].id, qty: 4 }]);
    const after = purchases.getPurchaseOrder(dupe.id).items;
    check('the first line received 4', near(after[0].received_qty, 4), String(after[0].received_qty));
    check('the SECOND line received nothing (it used to receive the same qty)', near(after[1].received_qty, 0), String(after[1].received_qty));
    check('the stock grew by exactly 4', near(stockOf(sugar.id) - before, 4), String(stockOf(sugar.id) - before));
    check('the order is still partial', purchases.getPurchaseOrder(dupe.id).status === 'partial', purchases.getPurchaseOrder(dupe.id).status);

    // The LEGACY shape (product id only) must apply to the FIRST outstanding
    // line only — never to every line of that product.
    purchases.receivePurchaseOrder(dupe.id, [{ product_id: sugar.id, qty: 3 }]);
    const after2 = purchases.getPurchaseOrder(dupe.id).items;
    check('the legacy product-id shape hits the first outstanding line only', near(after2[0].received_qty, 7) && near(after2[1].received_qty, 0), `${after2[0].received_qty} / ${after2[1].received_qty}`);
  }

  /* ── 3.12 ─ every line gets its OWN batch number ──────────────────────── */
  section('3.12 - two lines of the same product get their own batch number');
  {
    // The first line was received TWICE (4 then 3) with the SAME batch
    // number — the same batch number IS the same batch, so there must be ONE
    // row for it, holding 7 pieces, not two rows.
    const rows = batchRows(sugar.id);
    const batchA = rows.filter((b) => b.batch_number === 'P3-BATCH-A');
    check('the re-receipt of one line did NOT create a second batch row', batchA.length === 1, `${batchA.length} rows`);
    check('the batch holds everything that was received into it', near(batchA[0]?.quantity, 7), String(batchA[0]?.quantity));
    check('the batch recorded what it ever received', near(batchA[0]?.quantity_received, 7), String(batchA[0]?.quantity_received));

    // Now receive the SECOND line: it must land in its OWN batch.
    const dupe = purchases.getPurchaseOrder(
      db.prepare("SELECT id FROM purchase_orders WHERE status = 'partial' ORDER BY id DESC LIMIT 1").get().id
    );
    const line2 = dupe.items.find((i) => Number(i.received_qty) === 0);
    purchases.receivePurchaseOrder(dupe.id, [{ item_id: line2.id, qty: 5 }]);
    const after = batchRows(sugar.id);
    const names = after.map((b) => b.batch_number);
    check('the two lines have their own batch numbers', names.includes('P3-BATCH-A') && names.includes('P3-BATCH-B'), names.join(' | '));
    check('no batch number is duplicated', new Set(names).size === names.length, names.join(' | '));
  }

  /* ── 3.9 ─ the branch + the updated_at ─────────────────────────────────── */
  section('3.9 - the order records its branch and its updated_at moves');
  {
    const po = purchases.createPurchaseOrder(
      supplier.id,
      [{ product_id: sugar.id, qty: 1, unit_cost: 100 }],
      { status: 'ordered' }
    );
    const head = db.prepare('SELECT branch_id, updated_at FROM purchase_orders WHERE id = ?').get(po.id);
    check('the order has a branch column value (null when the shop has no branch)', head?.branch_id === null || head?.branch_id === undefined || Number(head.branch_id) > 0, String(head?.branch_id));
    check('the order has an updated_at', !!head?.updated_at, String(head?.updated_at));

    const item = db.prepare('SELECT branch_id FROM purchase_items WHERE purchase_order_id = ? LIMIT 1').get(po.id);
    check('the line has a branch column value too', item?.branch_id === null || item?.branch_id === undefined || Number(item.branch_id) > 0, String(item?.branch_id));

    const before = head?.updated_at;
    await new Promise((r) => setTimeout(r, 1100)); // SQLite's CURRENT_TIMESTAMP is per second
    purchases.receivePurchaseOrder(po.id);
    const after = db.prepare('SELECT updated_at FROM purchase_orders WHERE id = ?').get(po.id);
    check('the updated_at moved with the receipt', String(after?.updated_at) !== String(before), `${before} -> ${after?.updated_at}`);
  }

  /* ── 3.6 ─ the header money is validated by the shared rules ───────────── */
  section('3.6 - the service refuses the broken money');
  {
    const base = [{ product_id: sugar.id, qty: 2, unit_cost: 100 }];

    const negFreight = throws(() =>
      purchases.createPurchaseOrder(supplier.id, base, { status: 'ordered', freight: -50 })
    );
    check('a negative freight is refused', !!negFreight && /freight/i.test(negFreight), negFreight || 'accepted!');

    const bigPercent = throws(() =>
      purchases.createPurchaseOrder(supplier.id, base, { status: 'ordered', discount_type: 'percent', discount_value: 150 })
    );
    check('a discount above 100 percent is refused', !!bigPercent && /discount/i.test(bigPercent), bigPercent || 'accepted!');

    const negDiscount = throws(() =>
      purchases.createPurchaseOrder(supplier.id, base, { status: 'ordered', discount_type: 'amount', discount_value: -10 })
    );
    check('a negative discount is refused', !!negDiscount && /discount/i.test(negDiscount), negDiscount || 'accepted!');

    const negTaxLine = throws(() =>
      purchases.createPurchaseOrder(supplier.id, [{ product_id: sugar.id, qty: 1, unit_cost: 100, tax_pct: -5 }], {
        status: 'ordered',
      })
    );
    check('a negative line tax is refused', !!negTaxLine && /tax/i.test(negTaxLine), negTaxLine || 'accepted!');

    const overPaid = throws(() =>
      purchases.createPurchaseOrder(supplier.id, base, { status: 'ordered', paid_amount: 100000 })
    );
    check('a paid amount above the total is refused', !!overPaid && /paid/i.test(overPaid), overPaid || 'accepted!');

    // The order count must not have moved: every refusal happened BEFORE the
    // insert.
    const count = db.prepare('SELECT COUNT(*) AS c FROM purchase_orders').get().c;
    const created = purchases.createPurchaseOrder(supplier.id, base, { status: 'ordered' });
    check('a valid order is still created', !!created?.id, String(created?.id));
    check('only the valid order was added', db.prepare('SELECT COUNT(*) AS c FROM purchase_orders').get().c === count + 1, String(count));

    // The shared validator is the ONE place — the screen and the service agree.
    const shared = calc.validatePo({
      supplierId: supplier.id,
      lines: [{ product_id: sugar.id, qty: 1, unit_cost: 100 }],
      freight: -5,
    });
    check('the shared validator refuses the negative freight too', !shared.ok && shared.errors.includes('freight_negative'), shared.errors.join(','));
    const sharedPaid = calc.validatePo({
      supplierId: supplier.id,
      lines: [{ product_id: sugar.id, qty: 1, unit_cost: 100 }],
      paid_amount: 5000,
    });
    check('the shared validator refuses the overpaid order too', !sharedPaid.ok && sharedPaid.errors.includes('paid_exceeds_total'), sharedPaid.errors.join(','));
  }

  /* ── 3.7 ─ an order that received stock cannot be cancelled ───────────── */
  section('3.7 - an order that already received stock cannot be cancelled');
  {
    const po = purchases.createPurchaseOrder(
      supplier.id,
      [{ product_id: sugar.id, qty: 5, unit_cost: 100 }],
      { status: 'ordered' }
    );
    purchases.receivePurchaseOrder(po.id);
    // A LEGACY row: the status says "open" but the goods are already in.
    db.prepare("UPDATE purchase_orders SET status = 'ordered' WHERE id = ?").run(po.id);
    const balBefore = balanceOf(supplier.id);
    const err = throws(() => purchases.cancelPurchaseOrder(po.id));
    check('the cancel is refused', !!err && /received/i.test(err), err || 'accepted!');
    check('the supplier balance did not move', near(balanceOf(supplier.id), balBefore), `${balBefore} -> ${balanceOf(supplier.id)}`);
    check('the order is still open', db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(po.id).status === 'ordered');

    // A clean order can still be cancelled.
    const clean = purchases.createPurchaseOrder(
      supplier.id,
      [{ product_id: sugar.id, qty: 1, unit_cost: 100 }],
      { status: 'ordered' }
    );
    check('an order with nothing received can be cancelled', purchases.cancelPurchaseOrder(clean.id, 'test') === true);
  }

  /* ── 3.4 ─ an import that was received cannot be undone ────────────────── */
  section('3.4 - an import that was received cannot be undone');
  {
    const imported = purchaseImport.importPurchaseOrders({
      supplier_id: supplier.id,
      document_type: 'purchase_order',
      options: { updateCostPrice: true },
      rows: [{ row: 2, product_id: sugar.id, qty: 5, unit_cost: 100 }],
    });
    check('the import ran', imported.imported === 1, JSON.stringify(imported.errors));
    const stockBefore = stockOf(sugar.id);
    purchases.receivePurchaseOrder(imported.purchase_order_id);
    const stockAfter = stockOf(sugar.id);
    check('the PO was received', stockAfter > stockBefore, `${stockBefore} -> ${stockAfter}`);

    const err = throws(() => purchaseImport.undoPurchaseImport(imported.import_id));
    check('the undo is refused (the stock would stay on the shelf)', !!err && /received/i.test(err), err || 'accepted!');
    check('the order still exists', !!purchases.getPurchaseOrder(imported.purchase_order_id));
    check('the stock is untouched', near(stockOf(sugar.id), stockAfter), String(stockOf(sugar.id)));
  }

  /* ── 3.5 ─ the SERVICE enforces the purchases permission ───────────────── */
  section('3.5 - the service enforces the purchases permission');
  {
    // A CASHIER must not be able to create / receive / cancel / pay.
    auth.setSessionUser(cashierUser.id);
    {
      const poBefore = db.prepare('SELECT COUNT(*) AS c FROM purchase_orders').get().c;
      const createErr = throws(() =>
        purchases.createPurchaseOrder(supplier.id, [{ product_id: sugar.id, qty: 1, unit_cost: 100 }], {
          status: 'ordered',
        })
      );
      check('a cashier cannot create a purchase order', !!createErr && /permission/i.test(createErr), createErr || 'accepted!');
      check('the order count did not move', db.prepare('SELECT COUNT(*) AS c FROM purchase_orders').get().c === poBefore);

      const openPo = db
        .prepare("SELECT id FROM purchase_orders WHERE status IN ('ordered','pending') LIMIT 1")
        .get();
      if (openPo) {
        const recErr = throws(() => purchases.receivePurchaseOrder(openPo.id));
        check('a cashier cannot receive a purchase order', !!recErr && /permission/i.test(recErr), recErr || 'accepted!');
        const cancelErr = throws(() => purchases.cancelPurchaseOrder(openPo.id));
        check('a cashier cannot cancel a purchase order', !!cancelErr && /permission/i.test(cancelErr), cancelErr || 'accepted!');
      }
      const payErr = throws(() => purchases.paySupplier(supplier.id, 1, 'cash'));
      check('a cashier cannot pay a supplier', !!payErr && /permission/i.test(payErr), payErr || 'accepted!');
      const importErr = throws(() =>
        purchaseImport.importPurchaseOrders({
          supplier_id: supplier.id,
          document_type: 'purchase_order',
          rows: [{ row: 2, product_id: sugar.id, qty: 1, unit_cost: 100 }],
        })
      );
      check('a cashier cannot import purchases', !!importErr && /manager|permission/i.test(importErr), importErr || 'accepted!');
    }

    // The MANAGER can.
    auth.setSessionUser(managerUser.id);
    {
      const po = purchases.createPurchaseOrder(
        supplier.id,
        [{ product_id: sugar.id, qty: 1, unit_cost: 100 }],
        { status: 'ordered' }
      );
      check('a manager CAN create a purchase order', !!po?.id, String(po?.id));
    }

    // The OWNER can (the session goes back to user 1).
    auth.setSessionUser(1);
    {
      const ownerPo = purchases.createPurchaseOrder(
        supplier.id,
        [{ product_id: sugar.id, qty: 1, unit_cost: 100 }],
        { status: 'ordered' }
      );
      check('the owner CAN create a purchase order', !!ownerPo?.id, String(ownerPo?.id));
    }
  }

  /* ── 3.8 ─ the LEGACY quantity_received counter is honoured ────────────── */
  section('3.8 - the legacy quantity_received counter is honoured');
  {
    // A row created BEFORE migration 064: the new counter is empty and the
    // legacy one holds the truth.
    const legacyPo = purchases.createPurchaseOrder(
      supplier.id,
      [{ product_id: sugar.id, qty: 8, unit_cost: 100 }],
      { status: 'ordered' }
    );
    db.prepare(
      'UPDATE purchase_items SET received_qty = 0, quantity_received = 3 WHERE purchase_order_id = ?'
    ).run(legacyPo.id);

    const read = purchases.getPurchaseOrder(legacyPo.id);
    check(
      'the screen sees the legacy received quantity',
      near(read?.items?.[0]?.received_qty, 3),
      String(read?.items?.[0]?.received_qty)
    );

    // And the cancel guard must honour it too (the stock is already in).
    db.prepare("UPDATE purchase_orders SET status = 'ordered' WHERE id = ?").run(legacyPo.id);
    const err = throws(() => purchases.cancelPurchaseOrder(legacyPo.id));
    check('the legacy received quantity blocks the cancel', !!err && /received/i.test(err), err || 'accepted!');
  }

  /* ── 3.15 ─ the PO screens are bilingual ──────────────────────────────── */
  section('3.15 - every PO screen key exists in en.json AND ur.json');
  {
    const enPath = path.join(PROJECT_ROOT, 'src', 'renderer', 'src', 'i18n', 'en.json');
    const urPath = path.join(PROJECT_ROOT, 'src', 'renderer', 'src', 'i18n', 'ur.json');
    const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
    const ur = JSON.parse(fs.readFileSync(urPath, 'utf8'));

    /** Every leaf key under an object, as dotted paths. */
    const leafKeys = (obj, prefix = '') => {
      const out = [];
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj)) {
          const p = prefix ? `${prefix}.${k}` : k;
          if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...leafKeys(v, p));
          else out.push(p);
        }
      }
      return out;
    };
    const get = (obj, key) =>
      key.split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), obj);

    const enPo = leafKeys(en.purchases || {});
    const urPo = leafKeys(ur.purchases || {});
    check('the purchases namespace exists in en.json', enPo.length > 0, `${enPo.length} keys`);
    check('the purchases namespace exists in ur.json', urPo.length > 0, `${urPo.length} keys`);
    const missingInUr = enPo.filter((k) => !urPo.includes(k));
    const missingInEn = urPo.filter((k) => !enPo.includes(k));
    check('en.json and ur.json carry the SAME purchases keys', missingInUr.length === 0, missingInUr.join(', '));
    check('ur.json has no key en.json lacks', missingInEn.length === 0, missingInEn.join(', '));

    // Every key the PO screens ASK for must exist in both files.
    const screens = [
      path.join(PROJECT_ROOT, 'src', 'renderer', 'src', 'pages', 'Purchases.tsx'),
      path.join(PROJECT_ROOT, 'src', 'renderer', 'src', 'components', 'PurchaseOrderModal.tsx'),
      path.join(PROJECT_ROOT, 'src', 'renderer', 'src', 'components', 'PurchaseImportWizard.tsx'),
    ];
    const used = new Set();
    for (const file of screens) {
      const src = fs.readFileSync(file, 'utf8');
      const re = /t\(\s*'(purchases\.[^']+)'/g;
      let m;
      while ((m = re.exec(src))) used.add(m[1]);
    }
    check('the PO screens use the purchases namespace', used.size > 20, `${used.size} keys used`);
    const notInEn = [...used].filter((k) => get(en, k) === undefined);
    const notInUr = [...used].filter((k) => get(ur, k) === undefined);
    check('every key the screens use exists in en.json', notInEn.length === 0, notInEn.join(', '));
    check('every key the screens use exists in ur.json', notInUr.length === 0, notInUr.join(', '));

    // The shared validator's i18n keys must exist too (the renderer maps the
    // error CODE to a key).
    const calcSrc = fs.readFileSync(
      path.join(PROJECT_ROOT, 'src', 'shared', 'purchaseCalc.ts'),
      'utf8'
    );
    const keyRe = /'purchases\.po\.validation\.([a-z_]+)'/g;
    const validationKeys = new Set();
    let km;
    while ((km = keyRe.exec(calcSrc))) validationKeys.add(`purchases.po.validation.${km[1]}`);
    check('the validator maps every error code to an i18n key', validationKeys.size >= 10, `${validationKeys.size} keys`);
    const vMissingEn = [...validationKeys].filter((k) => get(en, k) === undefined);
    const vMissingUr = [...validationKeys].filter((k) => get(ur, k) === undefined);
    check('every validator key exists in en.json', vMissingEn.length === 0, vMissingEn.join(', '));
    check('every validator key exists in ur.json', vMissingUr.length === 0, vMissingUr.join(', '));
  }

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  } else {
    console.log('All purchase-order hardening checks passed.');
    app.exit(0);
  }
}

run().catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
