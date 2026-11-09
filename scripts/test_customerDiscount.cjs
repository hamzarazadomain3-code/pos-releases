/**
 * Customer default-discount regression test.
 *
 * The bug: Billing's customer effect re-ran on cart changes and overwrote a
 * manually edited bill discount. The fix (a) parses the customer default in a
 * pure helper and (b) keeps the effect's dependency list to `[customerId]`.
 * These checks pin both halves so the regression cannot come back silently.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { defaultBillDiscount } = require("../dist/shared/customerDiscount.js");

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

test("numeric default 10 -> 10%", () => {
  assert.deepEqual(defaultBillDiscount({ default_discount_pct: 10 }), {
    value: "10",
    type: "percent",
  });
});

test("string default is preserved as typed", () => {
  assert.deepEqual(defaultBillDiscount({ default_discount_pct: "7.5" }), {
    value: "7.5",
    type: "percent",
  });
});

test("no/default zero never resets a manual discount", () => {
  assert.equal(defaultBillDiscount({ default_discount_pct: 0 }), null);
  assert.equal(defaultBillDiscount({ default_discount_pct: null }), null);
  assert.equal(defaultBillDiscount({}), null);
  assert.equal(defaultBillDiscount(null), null);
  assert.equal(defaultBillDiscount(undefined), null);
});

test("junk and negatives are ignored", () => {
  assert.equal(defaultBillDiscount({ default_discount_pct: "abc" }), null);
  assert.equal(defaultBillDiscount({ default_discount_pct: -5 }), null);
  assert.equal(defaultBillDiscount({ default_discount_pct: "" }), null);
});

test("Billing applies the helper and the effect depends ONLY on customerId", () => {
  const file = path.join(__dirname, "..", "src", "renderer", "src", "pages", "Billing.tsx");
  const src = fs.readFileSync(file, "utf8");
  assert.ok(
    src.includes("const defDisc = defaultBillDiscount(cust);"),
    "Billing must use the shared helper"
  );
  const marker = "// Load customer loyalty & auto-apply default discount when customer changes";
  const start = src.indexOf(marker);
  assert.ok(start >= 0, "customer-discount effect marker missing");
  const tail = src.slice(start, start + 2500);
  assert.ok(
    tail.includes("}, [customerId]);"),
    "the customer effect must depend only on [customerId]"
  );
  // If someone adds `items` or `billDiscount` to this dependency list, the
  // effect re-runs and fights the cashier's manual edit — the original bug.
  const deps = tail.slice(tail.indexOf("}, [") + 3, tail.indexOf("]);", tail.indexOf("}, [")) + 1);
  assert.equal(deps, "[customerId]", "effect dependency list drifted: " + deps);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
