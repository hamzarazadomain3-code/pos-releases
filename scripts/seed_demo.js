#!/usr/bin/env node
/**
 * Seed a throwaway database with realistic demo data for MARKETING SCREENSHOTS.
 *
 * This exists because the website needs pictures of the real product, and mockups
 * drawn in HTML are not the same thing as the actual UI. It boots nothing and
 * renders nothing on its own; `scripts/capture_screens.js` drives it.
 *
 * Everything is written through the REAL services (inventory/sales/purchases/
 * shifts), never raw INSERTs, so stock movements, customer ledgers and invoice
 * numbering are all consistent with what the app would have produced in real use.
 * The one exception is explained at backdate() below.
 *
 * Usage:
 *   POS_DB_PATH=<tmp>/demo.db node scripts/seed_demo.js      # standalone, for poking
 *   require('./scripts/seed_demo.js').seedDemo()             # from capture_screens.js
 *
 * ⚠ EVERYTHING HERE IS FICTIONAL. Shop, staff, customers, suppliers and figures
 * are invented. The website labels these screenshots "sample data"; keep that
 * label in place if you reuse them.
 */

const PROJECT_ROOT = require('path').resolve(__dirname, '..');

/**
 * Deterministic PRNG (mulberry32). Fixed seed so a re-run produces byte-identical
 * screenshots — otherwise every capture diff would show spurious changes.
 */
function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Valid EAN-13: builds the check digit so barcode scanners accept the label. */
function ean13(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return first12 + String((10 - (sum % 10)) % 10);
}

const SHOP = {
  name: 'Al-Madina General Store',
  address: 'Main Bazaar Road, Lahore',
  phone: '0300-0000000',
};

const CATEGORIES = [
  'Grocery',
  'Beverages',
  'Dairy',
  'Snacks',
  'Household',
  'Personal Care',
  'Stationery',
];

// name, category, cost, sale, opening stock, low-stock threshold, [expiry days]
// Thresholds on the fast movers are set high enough that a fortnight of trading
// pushes them under, so the Dashboard's stock-alert card has real rows in it
// rather than a single lonely line.
const PRODUCTS = [
  ['Tapal Danedar Tea 950g', 'Grocery', 1180, 1320, 24, 6],
  ['Shakoor Sugar 1kg', 'Grocery', 138, 152, 60, 15],
  ['Basmati Rice 5kg', 'Grocery', 1650, 1850, 18, 5],
  ['Chakkar Fresh Atta 10kg', 'Grocery', 1450, 1620, 14, 4],
  ['Cooking Oil 5L', 'Grocery', 3450, 3820, 11, 3],
  ['Imsli Water 1.5L', 'Beverages', 65, 80, 84, 40],
  ['Pakola 250ml', 'Beverages', 30, 40, 120, 58],
  ['Coca-Cola 1.5L', 'Beverages', 155, 180, 48, 22],
  ['Nestle Milk 1L', 'Dairy', 190, 215, 30, 10, 6],
  ['Margarine 250g', 'Dairy', 210, 235, 22, 8, 45],
  ['Lays Salt n Vinegar', 'Snacks', 60, 80, 96, 36],
  ['Bisconni Chocolatto', 'Snacks', 90, 110, 72, 30],
  ['Surf Excel 1kg', 'Household', 620, 700, 20, 5],
  ['Dishwashing Liquid 500ml', 'Household', 180, 215, 26, 8, 120],
  ['Colgate MaxFresh 150g', 'Personal Care', 320, 380, 17, 6],
  ['Lux Beauty Soap (pack of 4)', 'Personal Care', 145, 175, 40, 10],
  ['A4 Notebook 80 pages', 'Stationery', 55, 75, 64, 26],
  ['Ballpoint Pen (box of 12)', 'Stationery', 180, 240, 28, 8],
];

const CUSTOMERS = [
  ['Muhammad Bilal', '0300-1234501', 'Model Town, Lahore'],
  ['Hassan Raza', '0321-8876543', 'Shahdara, Lahore'],
  ['Adeel Khan', '0333-9988776', 'Gulberg, Lahore'],
  ['Shahid Mehmood', '0345-1122998', 'Raiwind Road, Lahore'],
  ['Imran Ali', '0301-4455667', 'Ferozepur Road, Lahore'],
  ['Waqar Ahmed', '0312-7788990', 'Iqbal Town, Lahore'],
  ['Sana Yousaf', '0334-2233445', 'Johar Town, Lahore'],
];

const SUPPLIERS = [
  ['Pak Distributors', '042-35661234', 'Lahore'],
  ['Sunrise Wholesale', '042-38991122', 'Lahore'],
  ['Metro Cash & Carry', '042-37778899', 'Lahore'],
  ['Local Trader', '0300-55554444', 'Kasur'],
];

const PAY_MODES = ['Cash', 'Easypaisa', 'JazzCash', 'Card'];

/**
 * Back-date rows the services just stamped with "now".
 *
 * The service layer always writes `datetime('now')`, so every sale would land on
 * today and Reports would show a single bar. Reports aggregate with
 * `date(s.created_at)` (services/sales.ts), so rewriting the timestamp is enough
 * — no aggregate table is denormalised on the sale path, which is the only reason
 * this is safe. Invoice numbers keep today's date prefix, which is realistic: a
 * shop's counter is a continuous roll and the number does not encode the day the
 * bill was rung up.
 */
function backdate(getDb, days = 14) {
  const db = getDb();
  const rows = db.prepare('SELECT id FROM sales ORDER BY id').all();
  const updateSale = db.prepare('UPDATE sales SET created_at = ? WHERE id = ?');
  const updatePay = db.prepare('UPDATE payments SET created_at = ? WHERE sale_id = ?');
  const updateCust = db.prepare('UPDATE customer_transactions SET created_at = ? WHERE sale_id = ?');

  const now = new Date();
  const total = rows.length;
  for (let i = 0; i < total; i += 1) {
    const id = rows[i].id;
    // Newest id is the most recent bill, so walk dayOffset backwards as i rises.
    // Getting this backwards makes the Dashboard's "recent sales" list show the
    // oldest bills, which looks broken in a screenshot even though the totals
    // are right.
    const dayOffset = Math.floor(((total - 1 - i) * days) / total);
    const d = new Date(now);
    d.setDate(d.getDate() - dayOffset);
    // Trading hours only (09:00–19:59), spread deterministically so the hourly
    // chart has the two-peak shape a real shop day has.
    d.setHours(9 + ((i * 7) % 11), (i * 13) % 60, 0, 0);
    const iso = d.toISOString();
    updateSale.run(iso, id);
    updatePay.run(iso, id);
    updateCust.run(iso, id);
  }
  return total;
}

async function seedDemo(opts = {}) {
  const { verbose = true } = opts;
  const log = (...a) => verbose && console.log('   ' + a.join(' '));

  const dbPath = require('path').join(PROJECT_ROOT, 'dist', 'main', 'db.js');
  const { initDatabase, getDb } = require(dbPath);
  const inventory = require(require('path').join(PROJECT_ROOT, 'dist', 'main', 'services', 'inventory.js'));
  const sales = require(require('path').join(PROJECT_ROOT, 'dist', 'main', 'services', 'sales.js'));
  const purchases = require(require('path').join(PROJECT_ROOT, 'dist', 'main', 'services', 'purchases.js'));
  const shifts = require(require('path').join(PROJECT_ROOT, 'dist', 'main', 'services', 'shifts.js'));
  const settings = require(require('path').join(PROJECT_ROOT, 'dist', 'main', 'services', 'settings.js'));

  await initDatabase();

  // Refuse to double-seed: a second run would double every figure and quietly
  // produce screenshots that no longer match what a fresh shop sees.
  const existing = getDb().prepare('SELECT COUNT(*) AS c FROM products').get().c;
  if (existing > 0) {
    throw new Error(`refusing to seed: products already has ${existing} rows (use a fresh POS_DB_PATH)`);
  }

  // ── shop identity ────────────────────────────────────────────────────────────
  for (const [key, value] of Object.entries({
    shop_name: SHOP.name,
    shop_address: SHOP.address,
    shop_phone: SHOP.phone,
    // The renderer consults this before showing an expiry banner. Left unset the
    // screenshots would carry a licence warning across the top of every page,
    // which is noise for a demo database and nothing else. Demo DB only.
    license_expires: '2099-12-31',
  })) {
    settings.setSetting(key, value);
  }

  // ── catalogue ───────────────────────────────────────────────────────────────
  const catIds = new Map();
  for (const name of CATEGORIES) {
    const cat = inventory.createCategory(name);
    catIds.set(name, cat.id);
  }

  const units = inventory.listUnits();
  const pieceUnit = units.find((u) => /piece/i.test(u.name));

  let barcodeSeq = 896400000001;
  const productIds = [];
  for (const [name, cat, cost, sale, stock, low, expiryDays] of PRODUCTS) {
    const p = inventory.createProduct({
      name,
      barcode: ean13(String(barcodeSeq++)),
      sku: 'SKU-' + String(1000 + productIds.length),
      category_id: catIds.get(cat),
      unit_id: pieceUnit ? pieceUnit.id : null,
      cost_price: cost,
      sale_price: sale,
      wholesale_price: Math.round(sale * 0.94),
      stock_qty: stock,
      low_stock_threshold: low,
      shelf_location: null,
      expiry_date: expiryDays
        ? new Date(Date.now() + expiryDays * 86400000).toISOString().slice(0, 10)
        : null,
    });
    productIds.push(p.id);
  }
  log(`products: ${productIds.length}`);

  // ── counterparties ──────────────────────────────────────────────────────────
  const customerIds = CUSTOMERS.map(([n, ph, addr]) => sales.createCustomer(n, ph, 0).id);
  const supplierIds = SUPPLIERS.map(([n, ph, city]) =>
    purchases.createSupplier(n, ph, city).id,
  );
  log(`customers: ${customerIds.length}  suppliers: ${supplierIds.length}`);

  // ── purchases, so cost prices and stock history are real ────────────────────
  const received = 3;
  for (let i = 0; i < received; i += 1) {
    const items = [];
    for (let k = 0; k < 4; k += 1) {
      const idx = (i * 4 + k) % PRODUCTS.length;
      items.push({
        product_id: productIds[idx],
        qty: 12 + ((i * 5 + k * 3) % 18),
        unit_cost: PRODUCTS[idx][2],
      });
    }
    const po = purchases.createPurchaseOrder(supplierIds[i % supplierIds.length], items);
    purchases.receivePurchaseOrder(po.id);
  }
  log(`purchase orders received: ${received}`);

  // ── trading ─────────────────────────────────────────────────────────────────
  shifts.openShift(5000);

  const rng = makeRng(20240607);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  let saleCount = 0;
  let udhaarCount = 0;
  // ~46 bills, several lines each. Two in five are on credit so the Udhaar page
  // has real balances and the dashboard's receivable figure is not zero.
  for (let n = 0; n < 46; n += 1) {
    const lineCount = 1 + Math.floor(rng() * 4);
    const chosen = new Set();
    const items = [];
    for (let k = 0; k < lineCount; k += 1) {
      const idx = Math.floor(rng() * PRODUCTS.length);
      if (chosen.has(idx)) continue;
      chosen.add(idx);
      items.push({
        product_id: productIds[idx],
        qty: 1 + Math.floor(rng() * 3),
        price: PRODUCTS[idx][3],
        line_discount: 0,
        tax_rate: 0,
      });
    }
    if (!items.length) continue;

    const onCredit = rng() < 0.4;
    const customerId = onCredit ? pick(customerIds) : null;
    const { total } = sales.computeTotals(items, 0, 'amount');

    let payments;
    if (onCredit) {
      // Part paid now, balance carried as udhaar.
      const paid = Math.round(total * 0.5);
      payments = [{ mode: 'Cash', amount: paid }];
      udhaarCount += 1;
    } else {
      payments = [{ mode: pick(PAY_MODES), amount: total }];
    }

    sales.createSale({ items, customer_id: customerId, payments });
    saleCount += 1;
  }
  log(`sales: ${saleCount} (on credit: ${udhaarCount})`);

  // A couple of settled ledgers, so the Udhaar screen is not all overdue.
  sales.receivePayment(customerIds[2], 1500, 'Cash', 'sample settlement');
  sales.receivePayment(customerIds[6], 900, 'Easypaisa', 'sample settlement');

  // ── reorder levels ──────────────────────────────────────────────────────────
  // Three deliveries plus a fortnight of selling leaves almost nothing sitting
  // under its reorder point, so the Dashboard's stock-alert card renders a single
  // lonely row. Any real shop has a handful of lines waiting to be reordered, so
  // put the trigger just above the shelf quantity on the five thinnest lines.
  //
  // This is demo *configuration* of the shop's own reorder point — every stock
  // figure on screen is still whatever the real sale and purchase services left
  // behind. Nothing about the trading history is faked.
  const thin = getDb()
    .prepare('SELECT id, stock_qty FROM products ORDER BY stock_qty ASC LIMIT 5')
    .all();
  for (const row of thin) {
    const current = inventory.getProduct(row.id);
    inventory.updateProduct(row.id, {
      ...current,
      low_stock_threshold: Math.ceil(row.stock_qty) + 2,
    });
  }
  log(`reorder levels raised on ${thin.length} thin lines`);

  const spread = backdate(getDb);
  log(`back-dated ${spread} bills across 14 days`);

  return {
    products: productIds.length,
    customers: customerIds.length,
    suppliers: supplierIds.length,
    sales: saleCount,
    udhaar: udhaarCount,
    productIds,
    customerIds,
  };
}

module.exports = { seedDemo, ean13, SHOP, PRODUCTS, CUSTOMERS, SUPPLIERS };

// Standalone: POS_DB_PATH must already point somewhere disposable.
if (require.main === module) {
  if (!process.env.POS_DB_PATH) {
    console.error('POS_DB_PATH is not set — point it at a disposable directory first.');
    process.exit(1);
  }
  seedDemo()
    .then((r) => {
      console.log('seed_demo OK', JSON.stringify({ ...r, productIds: undefined, customerIds: undefined }));
    })
    .catch((e) => {
      console.error('seed_demo FAILED:', e.message);
      process.exit(1);
    });
}