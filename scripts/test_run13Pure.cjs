/**
 * Run 13 Item D — the PURE logic of Items 7-10.
 *
 *  - src/shared/escapeGesture.ts   (Esc = refresh, double Esc = Billing)
 *  - src/shared/billEdit.ts        (Pause / F4 bill-edit reducer)
 *  - src/shared/customerSearch.ts  (the F6 customer combobox filter)
 *  - src/shared/quickCustomer.ts   (the quick "New Customer" validation)
 *
 * Every case runs against the REAL compiled `dist/shared` code.
 */
const assert = require("node:assert/strict");

const {
  decideEscape,
  normalizeDoubleTapWindow,
  pageRefreshPlan,
  DEFAULT_DOUBLE_TAP_WINDOW_MS,
  MIN_DOUBLE_TAP_WINDOW_MS,
  MAX_DOUBLE_TAP_WINDOW_MS,
} = require("../dist/shared/escapeGesture.js");

const {
  billEditReducer,
  initialBillEditState,
  billEditKeyAction,
  isScannerBurst,
  priceForUnit,
  BILL_EDIT_HINT,
} = require("../dist/shared/billEdit.js");

const {
  filterCustomers,
  customerMatches,
  customerDiscountLabel,
  customerBalanceLabel,
  isOverCreditLimit,
} = require("../dist/shared/customerSearch.js");

const {
  validateQuickCustomer,
  isValidPkPhone,
  canonicalPhone,
} = require("../dist/shared/quickCustomer.js");

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

// ── escapeGesture ─────────────────────────────────────────────────────────

const CLEAN = {
  hasTopLayer: false,
  busy: false,
  composing: false,
  inUrduKeyboard: false,
  onLockScreen: false,
  onDesignerCanvas: false,
  unsavedChanges: false,
  onBilling: false,
  enabled: true,
};

test("a single Esc with nothing open refreshes", () => {
  const d = decideEscape({ now: 1000, state: { lastEscapeAt: null }, context: { ...CLEAN } });
  assert.equal(d.action, "refresh");
  assert.equal(d.consume, true);
  assert.equal(d.requiresDiscardPrompt, false);
  assert.equal(d.nextState.lastEscapeAt, 1000);
});

test("a modal open → close-top only (no refresh, no navigation)", () => {
  const d = decideEscape({
    now: 1000,
    state: { lastEscapeAt: null },
    context: { ...CLEAN, hasTopLayer: true },
  });
  assert.equal(d.action, "close-top");
  assert.equal(d.consume, true);
});

test("the bill-edit mode is a top layer → close-top only", () => {
  const d = decideEscape({
    now: 1000,
    state: { lastEscapeAt: null },
    context: { ...CLEAN, hasTopLayer: true },
  });
  assert.equal(d.action, "close-top");
});

test("two Esc within 400 ms → go-billing", () => {
  const first = decideEscape({ now: 1000, state: { lastEscapeAt: null }, context: { ...CLEAN } });
  const second = decideEscape({
    now: 1300,
    state: first.nextState,
    context: { ...CLEAN },
  });
  assert.equal(second.action, "go-billing");
  assert.equal(second.consume, true);
});

test("two Esc 600 ms apart → two refreshes (no navigation)", () => {
  const first = decideEscape({ now: 1000, state: { lastEscapeAt: null }, context: { ...CLEAN } });
  const second = decideEscape({
    now: 1600,
    state: first.nextState,
    context: { ...CLEAN },
  });
  assert.equal(second.action, "refresh");
});

test("the double-tap window is configurable (300-800 ms, default 400)", () => {
  assert.equal(normalizeDoubleTapWindow(500), 500);
  assert.equal(normalizeDoubleTapWindow(100), MIN_DOUBLE_TAP_WINDOW_MS);
  assert.equal(normalizeDoubleTapWindow(5000), MAX_DOUBLE_TAP_WINDOW_MS);
  assert.equal(normalizeDoubleTapWindow("x"), DEFAULT_DOUBLE_TAP_WINDOW_MS);
  const first = decideEscape({ now: 1000, state: { lastEscapeAt: null }, context: { ...CLEAN } });
  const second = decideEscape({
    now: 1350,
    state: first.nextState,
    context: { ...CLEAN },
    doubleTapWindowMs: 800,
  });
  assert.equal(second.action, "go-billing");
});

test("during a payment / print / save Esc is ignored", () => {
  const d = decideEscape({
    now: 1000,
    state: { lastEscapeAt: null },
    context: { ...CLEAN, busy: true },
  });
  assert.equal(d.action, "ignore");
  assert.equal(d.consume, false);
});

test("during IME composition Esc is ignored", () => {
  const d = decideEscape({
    now: 1000,
    state: { lastEscapeAt: null },
    context: { ...CLEAN, composing: true },
  });
  assert.equal(d.action, "ignore");
});

test("on the login/lock screen Esc is ignored", () => {
  const d = decideEscape({
    now: 1000,
    state: { lastEscapeAt: null },
    context: { ...CLEAN, onLockScreen: true },
  });
  assert.equal(d.action, "ignore");
});

test("on the designer canvas Esc is ignored", () => {
  const d = decideEscape({
    now: 1000,
    state: { lastEscapeAt: null },
    context: { ...CLEAN, onDesignerCanvas: true },
  });
  assert.equal(d.action, "ignore");
});

test("inside the Urdu keyboard Esc is ignored", () => {
  const d = decideEscape({
    now: 1000,
    state: { lastEscapeAt: null },
    context: { ...CLEAN, inUrduKeyboard: true },
  });
  assert.equal(d.action, "ignore");
});

test("the feature can be switched off in Settings", () => {
  const d = decideEscape({
    now: 1000,
    state: { lastEscapeAt: null },
    context: { ...CLEAN, enabled: false },
  });
  assert.equal(d.action, "ignore");
});

test("double Esc with unsaved edits asks to discard first", () => {
  const first = decideEscape({ now: 1000, state: { lastEscapeAt: null }, context: { ...CLEAN } });
  const second = decideEscape({
    now: 1200,
    state: first.nextState,
    context: { ...CLEAN, unsavedChanges: true },
  });
  assert.equal(second.action, "go-billing");
  assert.equal(second.requiresDiscardPrompt, true);
});

test("the refresh plan keeps the bill and touches the page", () => {
  const plan = pageRefreshPlan();
  assert.equal(plan.preserveBill, true);
  assert.equal(plan.reloadData, true);
  assert.equal(plan.clearSearch, true);
  assert.equal(plan.focusMainInput, true);
});

// ── billEdit ──────────────────────────────────────────────────────────────

function makeRows() {
  return [
    {
      id: "a",
      product_id: 1,
      name: "Tea",
      qty: 2,
      unitName: null,
      units: [],
      selectedUnitLevel: -1,
      price: 100,
      retail_price: 100,
      wholesale_price: 90,
      cost_price: 50,
      line_discount: 0,
      tax_rate: 0,
      note: "",
    },
    {
      id: "b",
      product_id: 2,
      name: "Sugar",
      qty: 1,
      unitName: "kg",
      units: [
        { name: "kg", quantity_in_base_units: 1 },
        { name: "gram", quantity_in_base_units: 0.001 },
      ],
      selectedUnitLevel: 0,
      price: 120,
      retail_price: 120,
      wholesale_price: 110,
      cost_price: 80,
      line_discount: 0,
      tax_rate: 0,
      note: "fresh",
      decimals: 3,
    },
    {
      id: "c",
      product_id: 3,
      name: "Boxed",
      qty: 1,
      unitName: "box",
      units: [
        { name: "box", quantity_in_base_units: 12 },
        { name: "piece", quantity_in_base_units: 1 },
      ],
      selectedUnitLevel: 0,
      price: 240,
      retail_price: 240,
      wholesale_price: null,
      cost_price: 100,
      line_discount: 0,
      tax_rate: 0,
      note: "",
    },
  ];
}

test("move clamps at both ends", () => {
  let s = initialBillEditState(makeRows());
  s = billEditReducer(s, { type: "move", to: "up" });
  assert.equal(s.selectedIndex, 0, "cannot go above the first row");
  s = billEditReducer(s, { type: "move", to: "down" });
  s = billEditReducer(s, { type: "move", to: "down" });
  s = billEditReducer(s, { type: "move", to: "down" });
  assert.equal(s.selectedIndex, 2, "cannot go below the last row");
  s = billEditReducer(s, { type: "move", to: "home" });
  assert.equal(s.selectedIndex, 0);
  s = billEditReducer(s, { type: "move", to: "end" });
  assert.equal(s.selectedIndex, 2);
});

test("an empty cart does not change", () => {
  const s = initialBillEditState([]);
  const after = billEditReducer(s, { type: "move", to: "down" });
  assert.equal(after.selectedIndex, -1);
  assert.equal(after.rows.length, 0);
  const afterQty = billEditReducer(after, { type: "qty-step", delta: 1 });
  assert.equal(afterQty.rows.length, 0);
});

test("qty +1 / -1 never goes below the minimum", () => {
  let s = initialBillEditState(makeRows());
  s = billEditReducer(s, { type: "qty-step", delta: 1 });
  assert.equal(s.rows[0].qty, 3);
  s = billEditReducer(s, { type: "qty-step", delta: -1 });
  s = billEditReducer(s, { type: "qty-step", delta: -1 });
  s = billEditReducer(s, { type: "qty-step", delta: -1 });
  assert.equal(s.rows[0].qty, 1, "never below the minimum of 1");
});

test("a typed quantity with decimals is accepted", () => {
  let s = initialBillEditState(makeRows());
  s = billEditReducer(s, { type: "move", to: "down" });
  s = billEditReducer(s, { type: "qty-text", text: "2.5" });
  assert.equal(s.mode, "qty");
  s = billEditReducer(s, { type: "commit" });
  assert.equal(s.rows[1].qty, 2.5);
  assert.equal(s.mode, "idle");
});

test("remove then undo restores the same position, qty, unit, discount and note", () => {
  let s = initialBillEditState(makeRows());
  s = billEditReducer(s, { type: "move", to: "down" });
  s = billEditReducer(s, { type: "qty-text", text: "3" });
  s = billEditReducer(s, { type: "commit" });
  s = billEditReducer(s, { type: "discount-text", text: "15" });
  s = billEditReducer(s, { type: "commit" });
  s = billEditReducer(s, { type: "note-text", text: "fresh bag" });
  s = billEditReducer(s, { type: "commit" });
  const before = s.rows[1];

  s = billEditReducer(s, { type: "remove" });
  assert.equal(s.rows.length, 2);
  assert.equal(s.rows[1].id, "c", "the third row moved up");
  assert.ok(s.undo, "an undo entry exists");

  s = billEditReducer(s, { type: "undo" });
  assert.equal(s.rows.length, 3);
  assert.equal(s.rows[1].id, "b", "restored in the same position");
  assert.equal(s.rows[1].qty, before.qty);
  assert.equal(s.rows[1].unitName, before.unitName);
  assert.equal(s.rows[1].line_discount, before.line_discount);
  assert.equal(s.rows[1].note, before.note);
});

test("switching unit recomputes the price and keeps the number", () => {
  let s = initialBillEditState(makeRows());
  s = billEditReducer(s, { type: "move", to: "down" });
  s = billEditReducer(s, { type: "unit" });
  assert.equal(s.rows[1].unitName, "gram");
  assert.equal(s.rows[1].qty, 1, "the typed number stays");
  // The gram holds 0.001 of the base unit (kg), so its price is 120 x 0.001.
  assert.equal(s.rows[1].price, 0.12, "base price x quantity_in_base_units");
});

test("with convert ON: 1 kg -> 1000 g and 500 g -> 0.5 kg", () => {
  let s = initialBillEditState(makeRows(), { convertOnUnitSwitch: true });
  s = billEditReducer(s, { type: "move", to: "down" });
  s = billEditReducer(s, { type: "unit" });
  assert.equal(s.rows[1].unitName, "gram");
  assert.equal(s.rows[1].qty, 1000, "1 kg -> 1000 g");

  // Now switch back: 1000 g -> 1 kg.
  s = billEditReducer(s, { type: "unit" });
  assert.equal(s.rows[1].unitName, "kg");
  assert.equal(s.rows[1].qty, 1, "1000 g -> 1 kg");
});

test("a single-unit product cannot switch units", () => {
  const rows = makeRows();
  rows[2].units = [{ name: "box", quantity_in_base_units: 12 }];
  let s = initialBillEditState(rows);
  s = billEditReducer(s, { type: "move", to: "end" });
  s = billEditReducer(s, { type: "unit" });
  assert.match(String(s.warning), /Only one unit/i);
  assert.equal(s.rows[2].selectedUnitLevel, 0, "the unit did not change");
});

test("a scale item refuses a unit switch", () => {
  const rows = makeRows();
  rows[1].isScale = true;
  let s = initialBillEditState(rows);
  s = billEditReducer(s, { type: "move", to: "down" });
  s = billEditReducer(s, { type: "unit" });
  assert.match(String(s.warning), /Scale/i);
  assert.equal(s.rows[1].selectedUnitLevel, 0);
});

test("a below-cost unit raises the warning flag", () => {
  const rows = makeRows();
  rows[1].cost_price = 500000; // the gram price is below this
  let s = initialBillEditState(rows);
  s = billEditReducer(s, { type: "move", to: "down" });
  s = billEditReducer(s, { type: "unit" });
  assert.match(String(s.warning), /below/i);
});

test("the price level changes the unit price", () => {
  const rows = makeRows();
  rows[1].units[1].price = 1;
  assert.equal(priceForUnit(rows[1], 1, "retail"), 1, "the unit's own price wins");
  assert.equal(priceForUnit(rows[1], 1, "wholesale"), 1, "the unit's own price wins");
  const rows2 = makeRows();
  assert.equal(priceForUnit(rows2[1], 1, "wholesale"), 0.11, "wholesale base price x 0.001");
  assert.equal(priceForUnit(rows2[1], 1, "retail"), 0.12, "retail base price x 0.001");
});

test("the key map routes the documented keys", () => {
  assert.equal(billEditKeyAction({ key: "ArrowUp" }), "move-up");
  assert.equal(billEditKeyAction({ key: "ArrowDown" }), "move-down");
  assert.equal(billEditKeyAction({ key: "+" }), "qty-up");
  assert.equal(billEditKeyAction({ key: "=" }), "qty-up");
  assert.equal(billEditKeyAction({ key: "-" }), "qty-down");
  assert.equal(billEditKeyAction({ key: "Enter" }), "remove");
  assert.equal(billEditKeyAction({ key: "5" }), "qty-edit");
  assert.equal(billEditKeyAction({ key: "u" }), "unit");
  assert.equal(billEditKeyAction({ key: "U" }), "unit");
  assert.equal(billEditKeyAction({ key: "p" }), "price-edit");
  assert.equal(billEditKeyAction({ key: "d" }), "discount-edit");
  assert.equal(billEditKeyAction({ key: "n" }), "note-edit");
  assert.equal(billEditKeyAction({ key: "Delete" }), "remove");
  assert.equal(billEditKeyAction({ key: "z", ctrlKey: true }), "undo");
  assert.equal(billEditKeyAction({ key: "q" }), "exit", "an unknown letter leaves the mode");
});

test("a scanner burst is recognised and never swallowed", () => {
  assert.equal(isScannerBurst([1000, 1010, 1020, 1030]), true);
  assert.equal(isScannerBurst([1000, 2000]), false);
});

test("the hint bar names every key", () => {
  assert.match(BILL_EDIT_HINT, /Up\/Down row/);
  assert.match(BILL_EDIT_HINT, /Del remove/);
});

// ── customerSearch ────────────────────────────────────────────────────────

const CUSTOMERS = [
  { id: 1, name: "Ali Khan", phone: "03001234567", customer_code: "C-001", balance: 120, credit_limit: 100, discount_type: "percent", default_discount_pct: 5 },
  { id: 2, name: "Test Shop 2", phone: "03009998888", customer_code: "C-002", balance: 0, credit_limit: 0, discount_type: "fixed", default_discount_pct: 50 },
  { id: 3, name: "Bakir Sons", urdu_name: "باقر سons", phone: "03111222333", balance: 40, credit_limit: 0 },
];

test("the combobox filters by name, phone or customer code", () => {
  assert.equal(filterCustomers(CUSTOMERS, "ali").length, 1);
  assert.equal(filterCustomers(CUSTOMERS, "ALI KHAN").length, 1);
  assert.equal(filterCustomers(CUSTOMERS, "0300").length, 2, "phone digits");
  assert.equal(filterCustomers(CUSTOMERS, "c-002").length, 1, "customer code");
  assert.equal(filterCustomers(CUSTOMERS, "").length, 3, "an empty query shows all");
  assert.equal(filterCustomers(CUSTOMERS, "zzz").length, 0);
});

test("an Urdu name is matched", () => {
  assert.equal(customerMatches(CUSTOMERS[2], "باقر"), true);
});

test("each row shows the balance, the discount and the over-limit warning", () => {
  const rows = filterCustomers(CUSTOMERS, "");
  assert.equal(rows[0].balanceLabel, "due 120");
  assert.equal(rows[0].discountLabel, "5%");
  assert.equal(rows[0].overLimit, true, "120 over a 100 limit");
  assert.equal(rows[1].discountLabel, "Rs 50 off");
  assert.equal(rows[1].balanceLabel, "no due");
  assert.equal(rows[1].overLimit, false);
  assert.equal(rows[2].discountLabel, "");
  assert.equal(customerBalanceLabel({ id: 9, name: "x", balance: 0 }), "no due");
  assert.equal(isOverCreditLimit({ id: 9, name: "x", balance: 5, credit_limit: 0 }), false);
  assert.equal(customerDiscountLabel({ id: 9, name: "x", default_discount_pct: 0 }), "");
});

// ── quickCustomer ────────────────────────────────────────────────────────

test("the quick customer form requires a name", () => {
  const v = validateQuickCustomer({ name: "  ", phone: "" });
  assert.equal(v.ok, false);
  assert.match(v.error, /Name is required/i);
});

test("the phone must be a Pakistani mobile", () => {
  assert.equal(isValidPkPhone("03001234567"), true);
  assert.equal(isValidPkPhone("0300-123-4567"), true);
  assert.equal(isValidPkPhone("+923001234567"), true);
  assert.equal(isValidPkPhone("12345"), false);
  const v = validateQuickCustomer({ name: "Ali", phone: "12345" });
  assert.equal(v.ok, false);
  assert.match(v.fieldErrors.phone, /03XXXXXXXXX/);
});

test("a duplicate phone is a WARNING with 'use the existing customer'", () => {
  const v = validateQuickCustomer(
    { name: "Someone Else", phone: "03001234567" },
    [{ id: 1, name: "Ali Khan", phone: "03001234567" }]
  );
  assert.equal(v.ok, true, "a duplicate is not a hard error");
  assert.ok(v.duplicate, "the duplicate is reported");
  assert.equal(v.duplicate.kind, "phone");
  assert.match(v.duplicate.message, /Use the existing customer/i);
  assert.equal(v.duplicate.customer.id, 1);
});

test("a duplicate name is a WARNING", () => {
  const v = validateQuickCustomer(
    { name: "ali khan", phone: "03009998888" },
    [{ id: 1, name: "Ali Khan", phone: "03001234567" }]
  );
  assert.ok(v.duplicate);
  assert.equal(v.duplicate.kind, "name");
});

test("the numbers are guarded", () => {
  const v = validateQuickCustomer({
    name: "Ali",
    phone: "03001234567",
    discount_type: "percent",
    discount_value: "150",
    discount_min_bill: "-5",
    credit_limit: "-1",
    credit_days: "-2",
    opening_balance: "abc",
  });
  assert.equal(v.ok, false);
  assert.match(v.fieldErrors.discount_value, /between 0 and 100/i);
  assert.match(v.fieldErrors.discount_min_bill, /negative/i);
  assert.match(v.fieldErrors.credit_limit, /negative/i);
  assert.match(v.fieldErrors.credit_days, /negative/i);
  assert.equal(v.cleaned.opening_balance, 0, "a garbage number becomes 0, never NaN");
});

test("a fixed discount may exceed 100", () => {
  const v = validateQuickCustomer({
    name: "Ali",
    phone: "03001234567",
    discount_type: "fixed",
    discount_value: "250",
  });
  assert.equal(v.ok, true);
  assert.equal(v.cleaned.discount_value, 250);
});

test("a positive opening balance means the customer owes the shop", () => {
  const v = validateQuickCustomer({ name: "Ali", phone: "", opening_balance: "500" });
  assert.equal(v.cleaned.opening_balance, 500);
});

test("canonicalPhone normalises the typed forms", () => {
  assert.equal(canonicalPhone("0300-123-4567"), "03001234567");
  assert.equal(canonicalPhone("+923001234567"), "03001234567");
  assert.equal(canonicalPhone("3001234567"), "03001234567");
});

console.log("\n=== Run 13 · pure logic (escape gesture, bill edit, customer search, quick customer) ===");
console.log("\n" + passed + " passed, " + failed + " failed");
if (failed > 0 || passed === 0) process.exitCode = 1;
else console.log("ALL PASSED");
