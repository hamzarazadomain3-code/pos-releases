/**
 * Run 13 Item C — the customer discount model.
 *
 * Every case from the original Item 6 list, against the REAL compiled code:
 *  - 5% on 1000 -> 50
 *  - fixed 50 on 1000 -> 50
 *  - fixed 50 on a bill of 30 -> 30
 *  - min-bill 500 with 400 -> 0 and with 600 -> applies
 *  - 10% promo then 5% customer (stacking order)
 *  - manual line discount (stacking order)
 *  - clamp at max_discount_percent
 *  - clamp at cost
 *  - fixed split across 3 lines sums EXACTLY
 *  - clear only auto-applied
 *  - held-bill round trip
 *  - partial return share
 *  - NaN / negative -> 0
 *  - migration adds the columns once and old customers stay 'percent'
 *
 * The service round trip goes through the REAL customers service and the REAL
 * sales service (a sale written with a customer discount must save its source).
 */
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");

const dbModule = require("../dist/main/db.js");
const auth = require("../dist/main/services/auth.js");
const {
  applyCustomerDiscount,
  applyDiscountStack,
  computeCustomerDiscount,
  computeRefundShare,
  customerDiscountBadge,
  formatCustomerDiscount,
  hasCustomerDiscount,
  minBillHint,
  splitDiscountAcrossLines,
} = require("../dist/shared/customerDiscount.js");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("  ok  " + name);
    passed++;
  } catch (e) {
    console.error("FAIL  " + name);
    console.error("      " + (e && e.message ? e.message : String(e)));
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log("  ok  " + name);
    passed++;
  } catch (e) {
    console.error("FAIL  " + name);
    console.error("      " + (e && e.message ? e.message : String(e)));
    failed++;
  }
}

function closeTo(actual, expected, message) {
  assert.ok(
    Math.abs(Number(actual) - Number(expected)) < 0.005,
    `${message}: expected ${expected}, got ${actual}`
  );
}

// ── Pure amount rules ─────────────────────────────────────────────────────

test("5% on a 1000 bill is 50", () => {
  const r = computeCustomerDiscount({
    type: "percent",
    value: 5,
    minBill: 0,
    billAmount: 1000,
    maxDiscountPercent: 0,
    hasPermission: false,
  });
  assert.equal(r.amount, 50);
  assert.equal(r.percentEquivalent, 5);
  assert.equal(r.reason, "ok");
});

test("fixed 50 on a 1000 bill is 50", () => {
  const r = computeCustomerDiscount({
    type: "fixed",
    value: 50,
    minBill: 0,
    billAmount: 1000,
    maxDiscountPercent: 0,
    hasPermission: false,
  });
  assert.equal(r.amount, 50);
});

test("fixed 50 on a bill of 30 is 30 (never more than the bill)", () => {
  const r = computeCustomerDiscount({
    type: "fixed",
    value: 50,
    minBill: 0,
    billAmount: 30,
    maxDiscountPercent: 0,
    hasPermission: false,
  });
  assert.equal(r.amount, 30);
});

test("min bill 500 with a 400 bill applies nothing", () => {
  const r = computeCustomerDiscount({
    type: "fixed",
    value: 50,
    minBill: 500,
    billAmount: 400,
    maxDiscountPercent: 0,
    hasPermission: false,
  });
  assert.equal(r.amount, 0);
  assert.equal(r.reason, "below_min_bill");
});

test("min bill 500 with a 600 bill applies the discount", () => {
  const r = computeCustomerDiscount({
    type: "fixed",
    value: 50,
    minBill: 500,
    billAmount: 600,
    maxDiscountPercent: 0,
    hasPermission: false,
  });
  assert.equal(r.amount, 50);
  assert.equal(r.reason, "ok");
});

test("max_discount_percent clamps the discount", () => {
  const r = computeCustomerDiscount({
    type: "percent",
    value: 40,
    minBill: 0,
    billAmount: 1000,
    maxDiscountPercent: 10,
    hasPermission: false,
  });
  assert.equal(r.amount, 100);
  assert.equal(r.clamped, true);
  assert.equal(r.reason, "clamped_max_percent");
});

test("max_discount_percent does not clamp with permission", () => {
  const r = computeCustomerDiscount({
    type: "percent",
    value: 40,
    minBill: 0,
    billAmount: 1000,
    maxDiscountPercent: 10,
    hasPermission: true,
  });
  assert.equal(r.amount, 400);
  assert.equal(r.clamped, false);
});

test("the discount is clamped at cost", () => {
  const r = computeCustomerDiscount({
    type: "percent",
    value: 50,
    minBill: 0,
    billAmount: 1000,
    maxDiscountPercent: 0,
    hasPermission: false,
    costTotal: 800,
  });
  assert.equal(r.amount, 200);
  assert.equal(r.clamped, true);
  assert.equal(r.reason, "clamped_cost");
});

test("NaN / negative values give 0", () => {
  for (const value of [Number.NaN, -5, 0, "abc"]) {
    const r = computeCustomerDiscount({
      type: "percent",
      value,
      minBill: 0,
      billAmount: 1000,
      maxDiscountPercent: 0,
      hasPermission: false,
    });
    assert.equal(r.amount, 0, `value ${value} -> 0`);
    assert.ok(Number.isFinite(r.amount), "never NaN");
  }
});

// ── Stacking order ────────────────────────────────────────────────────────

test("stacking: price level -> promotion -> manual line discount -> customer discount", () => {
  const stack = applyDiscountStack({
    lines: [
      // Retail 1000, a 10% promotion takes it to 900.
      { product_id: 1, qty: 1, price: 1000, promo_price: 900, cost_price: 400 },
      // A manual line discount of 100 on a 1000 line.
      { product_id: 2, qty: 1, price: 1000, manual_discount: 100, cost_price: 400 },
    ],
    customer: { type: "percent", value: 5 },
    maxDiscountPercent: 0,
    hasPermission: false,
  });
  // After promotions: 900 + 1000 = 1900
  assert.equal(stack.subtotal_after_promo, 1900);
  assert.equal(stack.promo_discount_total, 100);
  // After manual line discounts: 900 + 900 = 1800
  assert.equal(stack.manual_discount_total, 100);
  // The customer discount is 5% of the REMAINING 1800, not of 2000.
  assert.equal(stack.customer_discount_total, 90);
  assert.equal(stack.net_total, 1710);
});

test("stacking: a fixed customer discount is split across the lines and sums exactly", () => {
  const stack = applyDiscountStack({
    lines: [
      { product_id: 1, qty: 1, price: 100, cost_price: 10 },
      { product_id: 2, qty: 1, price: 200, cost_price: 10 },
      { product_id: 3, qty: 1, price: 300, cost_price: 10 },
    ],
    customer: { type: "fixed", value: 50 },
    maxDiscountPercent: 0,
    hasPermission: false,
  });
  assert.equal(stack.customer_discount_total, 50);
  const split = stack.lines.map((l) => l.customer_discount);
  closeTo(split.reduce((s, v) => s + v, 0), 50, "split sums to the amount");
  // Proportional: 100/600, 200/600, 300/600 of 50.
  closeTo(split[0], 100 / 600 * 50, "line 1 share");
  closeTo(split[1], 200 / 600 * 50, "line 2 share");
  closeTo(split[2], 300 / 600 * 50, "line 3 share");
  // The per-line net amounts add up to the net total.
  closeTo(
    stack.lines.reduce((s, l) => s + l.net_amount, 0),
    stack.net_total,
    "line nets add up"
  );
});

test("splitDiscountAcrossLines keeps the sum exact (awkward cents)", () => {
  const parts = splitDiscountAcrossLines(10, [1, 1, 1]);
  closeTo(parts.reduce((s, v) => s + v, 0), 10, "sum");
  const parts2 = splitDiscountAcrossLines(0.01, [1, 1, 1]);
  closeTo(parts2.reduce((s, v) => s + v, 0), 0.01, "one paisa split");
  const parts3 = splitDiscountAcrossLines(100, [0, 0, 0]);
  closeTo(parts3.reduce((s, v) => s + v, 0), 100, "zero weights still sum");
});

// ── applyCustomerDiscount ─────────────────────────────────────────────────

test("clearing the customer removes ONLY an auto-applied discount", () => {
  const auto = applyCustomerDiscount({
    customer: { default_discount_pct: 5 },
    currentDiscount: "",
    autoApplied: false,
  });
  assert.equal(auto.discount, "5");
  assert.equal(auto.autoApplied, true);
  assert.equal(auto.source, "customer_percent");

  const cleared = applyCustomerDiscount({
    customer: null,
    currentDiscount: auto.discount,
    autoApplied: auto.autoApplied,
  });
  assert.equal(cleared.discount, "");
  assert.equal(cleared.autoApplied, false);

  const typed = applyCustomerDiscount({
    customer: null,
    currentDiscount: "3",
    autoApplied: false,
  });
  assert.equal(typed.discount, "3", "a typed discount survives");
  assert.equal(typed.source, "manual");
});

test("a fixed customer discount fills the currency field", () => {
  const r = applyCustomerDiscount({
    customer: { default_discount_pct: 50, discount_type: "fixed" },
    currentDiscount: "",
    autoApplied: false,
  });
  assert.equal(r.discount, "50");
  assert.equal(r.type, "amount");
  assert.equal(r.source, "customer_fixed");
});

test("a fixed discount below the minimum bill stays pending", () => {
  const r = applyCustomerDiscount({
    customer: { default_discount_pct: 50, discount_type: "fixed", discount_min_bill: 500 },
    currentDiscount: "",
    autoApplied: false,
    billAmount: 400,
  });
  assert.equal(r.discount, "");
  assert.equal(r.pending, true);
  assert.equal(r.autoApplied, true, "still auto, so it applies later");
});

test("the min-bill hint reads 'Add Rs X more to get the Rs 50 discount'", () => {
  assert.equal(minBillHint(500, 400), "Add Rs 100 more to get the Rs 500 discount");
  assert.equal(minBillHint(0, 100), "");
  assert.equal(minBillHint(500, 600), "");
});

test("the badge reads 'Customer discount 5% applied' / 'Customer discount Rs 50 applied'", () => {
  assert.equal(customerDiscountBadge("percent", 5), "Customer discount 5% applied");
  assert.equal(customerDiscountBadge("fixed", 50), "Customer discount Rs 50 applied");
});

test("the customer list column formats the discount", () => {
  assert.equal(formatCustomerDiscount({ default_discount_pct: 5 }), "5%");
  assert.equal(formatCustomerDiscount({ default_discount_pct: 50, discount_type: "fixed" }), "Rs 50 off");
  assert.equal(formatCustomerDiscount({ default_discount_pct: 0 }), "—");
  assert.equal(formatCustomerDiscount(null), "—");
  assert.equal(hasCustomerDiscount({ default_discount_pct: 5 }), true);
  assert.equal(hasCustomerDiscount({ default_discount_pct: 0 }), false);
});

// ── Refunds ───────────────────────────────────────────────────────────────

test("a partial return refunds the price actually paid (proportional share)", () => {
  // 1000 gross, 50 off at bill level -> 95% of the list price is refunded.
  const share = computeRefundShare({
    unitPrice: 100,
    qty: 1,
    grossTotal: 1000,
    billDiscountAmount: 50,
  });
  closeTo(share, 95, "proportional refund");
  // No discount -> the full list price.
  closeTo(
    computeRefundShare({ unitPrice: 100, qty: 2, grossTotal: 1000, billDiscountAmount: 0 }),
    200,
    "no discount"
  );
});

// ── Real services ─────────────────────────────────────────────────────────

async function makeMigratedDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec(
    "CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
  );
  const dir = path.join(__dirname, "..", "migrations");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort()) {
    const migration = require(path.join(dir, file));
    if (typeof migration.up === "function") await migration.up(db);
    db.prepare("INSERT INTO migrations (name) VALUES (?)").run(file);
  }
  db.exec("PRAGMA foreign_keys = OFF;");
  return db;
}

async function serviceTests() {
  const db = await makeMigratedDb();
  const original = dbModule.getDb;
  dbModule.getDb = () => db;

  const customers = require("../dist/main/services/customers.js");
  const sales = require("../dist/main/services/sales.js");
  const activity = require("../dist/main/services/activity.js");

  db.prepare(
    "INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (1, 'owner', 'x', 'owner')"
  ).run();
  db.prepare(
    "INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (2, 'cashier2', 'x', 'cashier')"
  ).run();
  db.prepare(
    "INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (3, 'manager1', 'x', 'manager')"
  ).run();
  db.prepare(
    "INSERT OR IGNORE INTO products (id, name, sale_price, cost_price, stock_qty, active) VALUES (1, 'Tea', 100, 50, 500, 1)"
  ).run();
  db.prepare("DELETE FROM shifts").run();
  // The sale path checks the licence; a perpetual key short-circuits it.
  db.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('license_lifetime', '1')"
  ).run();
  auth.setSessionUser(1);
  const shifts = require("../dist/main/services/shifts.js");
  shifts.openShift(0);

  await testAsync("customers service saves a FIXED discount and returns it", async () => {
    const res = customers.saveCustomer({
      name: "Fixed Shop",
      phone: "03001111111",
      default_discount_pct: 50,
      discount_type: "fixed",
      discount_min_bill: 500,
    });
    assert.equal(res.ok, true, `save failed: ${res.message}`);
    const found = res.customer;
    assert.equal(found.discount_type, "fixed");
    assert.equal(found.default_discount_pct, 50);
    assert.equal(found.discount_min_bill, 500);
  });

  await testAsync("a fixed discount above 100 rupees is NOT clamped to 100", async () => {
    const res = customers.saveCustomer({
      name: "Big Fixed",
      phone: "03002222222",
      default_discount_pct: 250,
      discount_type: "fixed",
    });
    assert.equal(res.ok, true);
    assert.equal(res.customer.default_discount_pct, 250);
  });

  await testAsync("old customers stay 'percent' after the migration", async () => {
    const cols = db.prepare("PRAGMA table_info(customers)").all();
    const names = cols.map((c) => c.name);
    assert.ok(names.includes("discount_type"), "discount_type exists");
    assert.ok(names.includes("discount_min_bill"), "discount_min_bill exists");
    const fixed = db.prepare("SELECT discount_type FROM customers WHERE name = 'Big Fixed'").get();
    assert.equal(fixed.discount_type, "fixed");
    // The default for a row inserted without the column is 'percent'.
    const row = db
      .prepare("INSERT INTO customers (name, status, balance) VALUES ('Legacy Row', 'active', 0)")
      .run();
    const legacy = db
      .prepare("SELECT discount_type, discount_min_bill FROM customers WHERE id = ?")
      .get(Number(row.lastInsertRowid));
    assert.equal(legacy.discount_type, "percent");
    assert.equal(legacy.discount_min_bill, 0);
  });

  await testAsync("re-running the migration does not add the columns twice", async () => {
    const migration = require("../migrations/075_customer_discount_type.js");
    const migration2 = require("../migrations/076_discount_source.js");
    await migration.up(db);
    await migration2.up(db);
    const names = db.prepare("PRAGMA table_info(customers)").all().map((c) => c.name);
    assert.equal(names.filter((n) => n === "discount_type").length, 1);
    assert.equal(names.filter((n) => n === "discount_min_bill").length, 1);
  });

  await testAsync("only an owner or manager may change a customer's saved discount", async () => {
    const before = db.prepare("SELECT id FROM customers WHERE name = 'Fixed Shop'").get();
    const id = Number(before.id);

    auth.setSessionUser(2); // cashier
    const denied = customers.saveCustomer(
      { name: "Fixed Shop", phone: "03001111111", default_discount_pct: 60, discount_type: "fixed" },
      id
    );
    assert.equal(denied.ok, false, "a cashier cannot change the discount");
    assert.match(String(denied.message), /owner or manager/i);
    const unchanged = db
      .prepare("SELECT default_discount_pct FROM customers WHERE id = ?")
      .get(id);
    assert.equal(unchanged.default_discount_pct, 50, "the value did not change");

    auth.setSessionUser(3); // manager
    const allowed = customers.saveCustomer(
      { name: "Fixed Shop", phone: "03001111111", default_discount_pct: 60, discount_type: "fixed" },
      id
    );
    assert.equal(allowed.ok, true, `manager should be allowed: ${allowed.message}`);
    const changed = db
      .prepare("SELECT default_discount_pct FROM customers WHERE id = ?")
      .get(id);
    assert.equal(changed.default_discount_pct, 60);
  });

  await testAsync("a discount change writes an activity-log entry (who, old, new)", async () => {
    const rows = activity
      .listActivity(200)
      .filter((r) => r.action === "customer_discount_changed");
    assert.ok(rows.length >= 1, "an activity entry was written");
    const row = rows[0];
    assert.match(String(row.details), /old=/, "old value in the details");
    assert.match(String(row.details), /new=/, "new value in the details");
    assert.match(String(row.details), /by=/, "who changed it");
  });

  await testAsync("a sale with a customer discount saves its source", async () => {
    auth.setSessionUser(1); // the shift belongs to the owner
    const res = sales.createSale({
      items: [{ product_id: 1, qty: 10, price: 100, line_discount: 0, tax_rate: 0 }],
      customer_id: db.prepare("SELECT id FROM customers WHERE name = 'Fixed Shop'").get().id,
      bill_discount: 50,
      discount_type: "amount",
      discount_source: "customer_fixed",
      price_mode: "retail",
      payments: [{ mode: "Cash", amount: 950 }],
    });
    assert.ok(res.sale, "sale created");
    assert.equal(res.sale.discount_source, "customer_fixed");
    assert.equal(res.sale.bill_discount, 50);
    assert.equal(res.sale.discount_type, "amount");
    assert.equal(res.sale.customer_discount_amount, 50);
    assert.equal(res.sale.total_amount, 950);
  });

  await testAsync("a manual discount is saved as 'manual'", async () => {
    auth.setSessionUser(1);
    const res = sales.createSale({
      items: [{ product_id: 1, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
      bill_discount: 10,
      discount_type: "amount",
      discount_source: "manual",
      payments: [{ mode: "Cash", amount: 90 }],
    });
    assert.ok(res.sale);
    assert.equal(res.sale.discount_source, "manual");
    assert.equal(res.sale.customer_discount_amount, 0);
  });

  await testAsync("held bill round trip keeps the discount", async () => {
    const held = sales.holdBill("held", "3 items", {
      items: [{ product_id: 1, qty: 3, price: 100, line_discount: 0, tax_rate: 0 }],
      customer_id: null,
      bill_discount: 50,
      discount_type: "amount",
      discount_source: "customer_fixed",
      price_mode: "retail",
    });
    assert.ok(held && held.id > 0, "held bill written");
    const list = sales.listHeldBills("held");
    const row = list.find((h) => h.id === held.id);
    const data = JSON.parse(row.data);
    assert.equal(data.bill_discount, 50);
    assert.equal(data.discount_type, "amount");
    assert.equal(data.discount_source, "customer_fixed");
  });

  await testAsync("a return on a discounted bill refunds the price actually paid", async () => {
    auth.setSessionUser(1);
    const created = sales.createSale({
      items: [{ product_id: 1, qty: 10, price: 100, line_discount: 0, tax_rate: 0 }],
      bill_discount: 100,
      discount_type: "amount",
      discount_source: "customer_fixed",
      payments: [{ mode: "Cash", amount: 900 }],
    });
    const returns = require("../dist/main/services/returns.js");
    const sale = sales.getSale(created.sale.id);
    const item = sale.items[0];
    const ret = returns.createReturn({
      sale_id: sale.id,
      items: [{ sale_item_id: item.id, qty: 1, unit_price: 100 }],
      reason: "test",
      refund_mode: "cash",
      restock: false,
    });
    // 1000 gross - 100 discount -> 90% of the list price.
    closeTo(ret.refund_amount, 90, "refund is the price actually paid");
  });

  auth.setSessionUser(null);
  dbModule.getDb = original;
  db.close();
}

console.log("\n=== Run 13 · customer discount model ===");

serviceTests()
  .then(() => {
    console.log("\n" + passed + " passed, " + failed + " failed");
    if (failed > 0 || passed === 0) process.exitCode = 1;
    else console.log("ALL PASSED");
  })
  .catch((e) => {
    console.error("FATAL", e);
    process.exitCode = 1;
  });
