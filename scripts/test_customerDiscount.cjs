/**
 * Customer default-discount regression test.
 *
 * Tests the pure `applyCustomerDiscount` function and the real customers
 * service (default_discount_pct round-trips through save + list).
 */
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");

const dbModule = require("../dist/main/db.js");
const { applyCustomerDiscount } = require("../dist/shared/customerDiscount.js");

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

// ── Pure function tests ──────────────────────────────────────────────────

test("customer with 5% discount sets it and marks autoApplied", () => {
  const result = applyCustomerDiscount({
    customer: { default_discount_pct: 5 },
    currentDiscount: "",
    autoApplied: false,
  });
  // Run 13: the result gained `source` (saved on the sale) and `pending`
  // (the customer's minimum bill is not reached yet).
  assert.deepEqual(result, {
    discount: "5",
    type: "percent",
    autoApplied: true,
    source: "customer_percent",
    pending: false,
  });
});

test("customer with 0% discount clears auto-applied discount", () => {
  const result = applyCustomerDiscount({
    customer: { default_discount_pct: 0 },
    currentDiscount: "5",
    autoApplied: true,
  });
  assert.deepEqual(result, {
    discount: "",
    type: "percent",
    autoApplied: false,
    source: "none",
    pending: false,
  });
});

test("typed discount is not overwritten by customer change", () => {
  const result = applyCustomerDiscount({
    customer: { default_discount_pct: 10 },
    currentDiscount: "3",
    autoApplied: false,
  });
  assert.deepEqual(result, {
    discount: "3",
    type: "percent",
    autoApplied: false,
    source: "manual",
    pending: false,
  });
});

test("walk-in clears auto-applied discount", () => {
  const result = applyCustomerDiscount({
    customer: null,
    currentDiscount: "5",
    autoApplied: true,
  });
  assert.deepEqual(result, {
    discount: "",
    type: "percent",
    autoApplied: false,
    source: "none",
    pending: false,
  });
});

test("walk-in does not clear typed discount", () => {
  const result = applyCustomerDiscount({
    customer: null,
    currentDiscount: "3",
    autoApplied: false,
  });
  assert.deepEqual(result, {
    discount: "3",
    type: "percent",
    autoApplied: false,
    source: "manual",
    pending: false,
  });
});

test("customer without discount field clears auto-applied", () => {
  const result = applyCustomerDiscount({
    customer: {},
    currentDiscount: "5",
    autoApplied: true,
  });
  assert.deepEqual(result, {
    discount: "",
    type: "percent",
    autoApplied: false,
    source: "none",
    pending: false,
  });
});

test("customer with NaN discount clears auto-applied", () => {
  const result = applyCustomerDiscount({
    customer: { default_discount_pct: "abc" },
    currentDiscount: "5",
    autoApplied: true,
  });
  assert.deepEqual(result, {
    discount: "",
    type: "percent",
    autoApplied: false,
    source: "none",
    pending: false,
  });
});

test("customer with negative discount clears auto-applied", () => {
  const result = applyCustomerDiscount({
    customer: { default_discount_pct: -5 },
    currentDiscount: "5",
    autoApplied: true,
  });
  assert.deepEqual(result, {
    discount: "",
    type: "percent",
    autoApplied: false,
    source: "none",
    pending: false,
  });
});

test("re-selecting customer with different discount updates auto-applied value", () => {
  const result = applyCustomerDiscount({
    customer: { default_discount_pct: 10 },
    currentDiscount: "5",
    autoApplied: true,
  });
  assert.deepEqual(result, {
    discount: "10",
    type: "percent",
    autoApplied: true,
    source: "customer_percent",
    pending: false,
  });
});

test("string discount is preserved", () => {
  const result = applyCustomerDiscount({
    customer: { default_discount_pct: "7.5" },
    currentDiscount: "",
    autoApplied: false,
  });
  assert.deepEqual(result, {
    discount: "7.5",
    type: "percent",
    autoApplied: true,
    source: "customer_percent",
    pending: false,
  });
});

// ── Real customers service test ───────────────────────────────────────────

async function main() {
  await testAsync("customer saved through real service returns default_discount_pct from list()", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = OFF;");
    const migrationsDir = path.join(__dirname, "..", "migrations");
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".js")).sort();
    for (const file of files) {
      const migration = require(path.join(migrationsDir, file));
      if (typeof migration.up === "function") await migration.up(db);
    }
    db.exec("PRAGMA foreign_keys = OFF;");
    dbModule.getDb = () => db;

    const customers = require("../dist/main/services/customers.js");
    const sales = require("../dist/main/services/sales.js");

    // Create a customer with default_discount_pct = 5 through the REAL service.
    // There is no SQL fallback: if the service does not persist it, the test fails.
    const result = customers.saveCustomer(
      { name: "Test Customer", phone: "03001234567", default_discount_pct: 5 },
      null
    );
    assert.ok(result.ok, "saveCustomer returned ok: " + (result.message ?? ""));
    assert.equal(result.customer.default_discount_pct, 5, "service returned the saved value");

    // List customers and check default_discount_pct
    const custList = sales.listCustomers();
    const found = custList.find((c) => c.name === "Test Customer");
    assert.ok(found, "customer found in list");
    assert.equal(found.default_discount_pct, 5, "default_discount_pct returned from list()");
  });

  test("QuickSaleGrid does not hard-code bill_discount: 0", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "renderer", "src", "pages", "QuickSaleGrid.tsx"),
      "utf8"
    );
    assert.ok(
      !src.includes("bill_discount: 0"),
      "QuickSaleGrid still contains hard-coded 'bill_discount: 0'"
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
