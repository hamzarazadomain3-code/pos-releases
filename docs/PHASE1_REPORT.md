# PHASE 1 REPORT — Rokar POS (the product / inventory data model)

**Run date:** 2026-11-27
**Baseline:** `v2.32.0` (`main` @ `4578947`, unpushed) — Phase 0 is committed
**Scope:** `E:\antigravty\billing softwere\pos-app` only
**Proofs:** `E:\temp\proof\p1_*` (every claim below has a saved output)
**Phase:** 1 of the master-prompt run (Phase 0 → 5)

---

## 1. Summary

Phase 1 makes the **product / inventory data model** honest: the units, the
batch & expiry rules and the stock ledger. It follows the same rule the
settings bridge already follows — **one rule, one place** — and it is written
the same way Phase 0 was: every item is a defect that was found in the code,
a smallest-possible fix, a permanent regression test and a saved proof.

**Twelve items (1.1 – 1.12), all DONE.** Nine needed new code; three were
verified-only. Two new shared modules carry the rules that used to be copied
into four places each:

| New module | The rule it now owns |
|---|---|
| `src/shared/expiry.ts` | "Is this stock expired?" — expired means **before** today |
| `src/shared/units.ts` | "How many base units is this?" — the factor, the rounding |

The biggest wins for the shop, in plain words:

1. **A refused stock adjustment no longer eats the stock.** The FIFO deduction
   wrote the batches short *before* it checked whether there was enough, and
   the manual adjustment had no transaction — so a correction the system
   refused could still leave the batch stock gone.
2. **The stock ledger tells the truth.** Two lines of the same product on one
   bill used to be written against the *wrong* batch, a return never released
   its allocation, and every movement was anonymous.
3. **The FIFO Stock Report is no longer empty.** Every real batch had
   `quantity_received = 0`, and the report filters on that column.
4. **Expired stock can no longer leave the shelf by the back door.** The sale
   checked the product's date, never the batch it actually consumed.
5. **A supplier invoice in boxes now puts the right number on the shelf.**
   "2 box" of a 12-piece box used to add **2** pieces; it now adds **24** —
   and the undo takes all 24 off again.

---

## 2. The items

### 1.1 — a refused stock adjustment destroyed the batch stock

**Root cause.** `deductStockFIFO()` wrote `product_batches.quantity -= take`
for every batch it touched and only *then* checked whether it had enough. The
error was thrown with the batches already short. `adjustStock()` has no
transaction of its own, so the refused correction left the batch stock gone
while `products.stock_qty` and the ledger stayed untouched.

**Fix.** The deduction is all-or-nothing: what was taken is given back before
the error is thrown, and the manual adjustment runs inside a **SAVEPOINT**
(not `BEGIN` — the udhaar write-off already owns a transaction).

**Proof.** `test:inventoryModel` — "the batch quantity is STILL 10", "the
product stock is still 10", "no movement row was written".

### 1.2 — a bill with two lines of the same product wrote the wrong allocations

**Root cause.** `sales.ts` kept the FIFO allocations in a
`Map<product_id, …>`. A second line of the same product **overwrote** the
first, so both `sale_items` rows were written with the last allocation and the
`fifo_allocations` rows pointed at the wrong sale items. The ledger said a
different batch had been consumed than the one that really was.

**Fix.** The allocations are kept **per line** and the allocation rows are
written per line.

**Proof.** "the first line took batch A", "the second line took batch B",
"BOTH allocations were recorded (the old bug wrote one)".

### 1.3 — the FIFO Stock Report was empty for every real batch

**Root cause.** `createBatch()` inserted without `quantity_received`, and the
separate FIFO engine (`fifoEngine.ts`) filters on `quantity_received > 0`. So
the initial stock, every manual adjustment and every purchase receipt showed
up with **zero** available in the FIFO Stock Report.

**Fix.** `createBatch()` writes `quantity_received = quantity`. The column
means "how much did we ever receive"; `quantity` stays "how much is on the
shelf right now".

**Proof.** "the batch remembers what it received", "the FIFO stock report shows
the batch (it used to be empty)".

### 1.4 — a return never released its FIFO allocation

**Root cause.** `returns.ts` put the batch quantity and the product stock back
but left the `fifo_allocations` row, so the FIFO engine (which works from the
allocations) kept showing the returned stock as consumed.

**Fix.** The allocation is shortened by the returned quantity, or deleted when
the whole line comes back.

**Proof.** "the FIFO allocation was RELEASED", "the batch quantity is back to 4".

### 1.5 — the expiry rule was answered in four places with two answers

**Root cause.** The sale, `Billing.tsx` and `cartMath.ts` used `date < today`
(same-day = sellable) while `reports.ts` used `days_until_expiry <= 0`
(same-day = EXPIRED). The till could sell what the report called expired.

**Fix.** The rule lives in `src/shared/expiry.ts` and nowhere else.
**THE RULE:** expired means **before** today; a date that falls on today is
still sellable; a missing or unreadable date is never expired (we never block
a sale on a value we do not understand).

**Proof.** The seven rule checks + "the report does NOT call a same-day expiry
EXPIRED" + "the report DOES call a past expiry EXPIRED".

### 1.6 — an expired batch could leave the shelf

**Root cause.** The sale looked at the product's own `expiry_date` only. The
batch FIFO actually consumed was never checked, so a batch past its expiry
could be sold silently — and a product whose product-level date was past was
blocked even when a fresh batch was sitting there.

**Fix.** The batch decides: FIFO **skips** the expired batches, a line that
only expired stock could cover is blocked as expired (the existing manager
override still applies, and an approved line is sold from the expired batch as
asked), and the bill amendment — which had **no** expiry check at all — now
refuses to add expired stock too.

**Proof.** "selling the expired batch is refused", "the mixed product sells
from its FRESH batch", "the expired batch still has its stock", "the amendment
refuses to add expired stock".

### 1.7 — a quotation conversion ignored the stock rules

**Root cause.** `quotations.ts` decremented `products.stock_qty` directly: no
negative-stock refusal, no FIFO, no expiry check. A quotation could drive the
stock negative even when the shop's policy says "never", and it could sell
expired stock without an approval.

**Fix.** A quotation is a sale the moment it is converted, so it obeys the same
rules: the negative-stock policy, the `max_negative_qty` cap, the expiry rule,
and the same FIFO.

**Proof.** "the conversion is REFUSED (the policy caps the negative stock)",
"the stock is unchanged".

### 1.8 — the stock ledger did not say who moved the stock

**Root cause.** `recordMovement()` could not write `user_id` or `branch_id` at
all, so every sale, purchase, return, void, audit correction and manual
adjustment was an anonymous line and the branch columns were dead.

**Fix.** The one writer of `stock_movements` takes the user and the branch, and
every caller passes them. The branch is read from the `current_branch_id`
setting — the ledger never depends on the branches service (an import cycle).

**Proof.** "the movement records the USER", "the movement records the branch".

### 1.9 — two inventory-report queries selected a column that never existed

**Root cause.** `inventoryReports.ts` selected `pi.quantity_ordered`, but
`purchase_items` has no such column — SQLite fails at prepare time, so the
**Purchase History** and the **Product Purchase Summary** panels were dead.

**Fix.** The queries read the columns that exist (`pi.qty`,
`COALESCE(received_qty, quantity_received, 0)`, `COALESCE(batch_no,
batch_number)`), and the permanent test calls both of them.

**Proof.** "the purchase history query runs (it used to select a missing
column)", "the product purchase summary query runs".

### 1.10 — the purchase line snapshot was incomplete

**Root cause.** The canonical purchase wrote `batch_no` + `received_qty` only.
The **legacy** twins (`batch_number`, `quantity_received`) stayed null — and
the purchase-expiry alert reads the legacy pair, so every normal purchase was
invisible to the "this batch expires soon" alert. The same insert also dropped
`unit_name` and `total_cost`.

**Fix.** The canonical purchase writes both pairs plus the unit and the line
total; the reports read the columns that exist.

**Proof.** "the unit name was stored", "the line total was stored", "the
purchase expiry alert sees the purchase (it used to be invisible)".

### 1.11 — the import's undo removed nothing and reversed the wrong amount

**Root cause.** The import generated a batch name (`IMP-…`) and never stored
it, so the undo's `DELETE … WHERE batch_number = ?` matched nothing and the
batch survived the undo. The undo also reversed the *purchase* quantity while
the stock had been added in *base* units — "2 boxes of 12" left 22 of the 24
pieces on the shelf.

**Fix.** The batch number is stored on the line (both column pairs), and the
undo reverses the **base** quantity.

**Proof.** "the batch number was stored on the line (the undo needs it)", "the
stock is back to 0", "the generated batch was removed (it used to survive the
undo)".

### 1.12 — one unit-conversion rule

**Root cause.** The conversion lived in `purchaseCalc.ts` and rounded to FOUR
decimals while the stock rounds to THREE, so a batch quantity and
`products.stock_qty` could drift apart by 0.0001. The import added the raw
file quantity to the stock, ignoring the pack completely.

**Fix.** `src/shared/units.ts` owns the rule (`baseQty = qty × factor`,
`costPerBase = cost ÷ factor`, the quantity at the app's 3-decimal stock
precision; a missing or zero factor means 1, never zero). The import wizard
resolves the file's `unit` column against the product's own units and sends
the factor, so the stock comes on in base units. An unknown unit name is
**never guessed** — the line stays in base units.

**Proof.** "the stock is in BASE units (2 boxes of 12 = 24 pieces)", "the cost
per base unit is 1200 / 12 = 100", "the receipt put 18 pieces on the shelf",
"the batch quantity equals the product stock (no rounding drift)".

---

## 3. Files

### New
| File | What it is |
|---|---|
| `src/shared/expiry.ts` | **THE** expiry rule (expired = before today) |
| `src/shared/units.ts` | **THE** unit-conversion rule (base units, the stock precision) |
| `scripts/test_inventoryModel.cjs` | the permanent Phase 1 suite (70 checks) |

### Changed (the service / the rule)
| File | What changed |
|---|---|
| `src/main/services/inventory.ts` | the FIFO rollback (1.1), `quantity_received` (1.3), the expiry skip (1.6), the ledger user + branch (1.8), the atomic adjustment, `batchStockState()` |
| `src/main/services/sales.ts` | the per-line allocations (1.2), the shared expiry rule + the batch rule (1.5, 1.6), the ledger user + branch (1.8) |
| `src/main/services/returns.ts` | the FIFO allocation release (1.4), the ledger user + branch (1.8) |
| `src/main/services/quotations.ts` | the stock rules + the FIFO on a conversion (1.7) |
| `src/main/services/billAmendments.ts` | the expiry gate + the expiry skip (1.6) |
| `src/main/services/purchases.ts` | the complete line snapshot + the legacy received column (1.10) |
| `src/main/services/purchaseImport.ts` | `quantity_received`, the stored batch number, the base-unit stock-in and the base-unit undo (1.11, 1.12) |
| `src/main/services/inventoryReports.ts` | the two queries that selected a missing column (1.9) |
| `src/main/services/reports.ts` | the shared expiry rule (1.5) |

### Changed (the shared / the renderer)
| File | What changed |
|---|---|
| `src/shared/purchaseCalc.ts` | the conversion delegates to `shared/units.ts` (1.12) |
| `src/shared/cartMath.ts` | the shared expiry rule (1.5) |
| `src/shared/types.ts` | `units_in_base` + `unit_name` on the import row (1.12) |
| `src/renderer/src/pages/Billing.tsx` | the shared expiry rule (1.5) |
| `src/renderer/src/components/PurchaseImportWizard.tsx` | the file's `unit` column is resolved against the product's units (1.12) |
| `package.json` | `npm run test:inventoryModel` |

---

## 4. Test evidence

### The new permanent suite
`npm run test:inventoryModel` → **70/70** — `E:\temp\proof\p1_inventoryModel_out.txt`

| Item | Checks | What it proves |
|---|---|---|
| 1.1 | 4 | a refused adjustment leaves the batch, the stock and the ledger untouched |
| 1.2 | 8 | two lines of one product keep their own batches and allocations |
| 1.3 | 2 | the batch remembers what it received; the FIFO report is not empty |
| 1.4 | 4 | a return releases the allocation and restores the batch |
| 1.5 | 9 | the expiry rule (7) + the report agrees with the till (2) |
| 1.6 | 7 | an expired batch is not sold; the fresh batch is; the amendment refuses |
| 1.7 | 3 | a quotation conversion obeys the stock policy |
| 1.8 | 3 | the ledger records the user and the branch |
| 1.9 | 3 | the two broken report queries run |
| 1.10 | 5 | the purchase line snapshot is complete; the expiry alert sees it |
| 1.11 + 1.12 | 9 | the import converts the pack, stores the batch, and the undo takes all 24 off |
| 1.12 | 6 | one conversion rule (the factor, the rounding, the cost, the receipt) |

### The regression battery
Every suite below ran after the phase; the one-line verdict is in
`E:\temp\proof\p1_regr_summary.txt` and each suite's own output is in
`E:\temp\proof\p1_regr_<name>.txt`.

| Suite | Result |
|---|---|
| `npm run typecheck` | `[forbidden-strings] OK` — no hardcoded shop identity/content literals |
| `npm run build` | built in 49.77 s, renderer assets generated |
| `npm run test:inventoryModel` | 70/70 |
| `npm run test:expired` | 15/15 |
| `npm run test:negstock` | 31/31 |
| `npm run test:return` | 29/29 |
| `npm run test:billingSmoke` | 46/46 |
| `npm run test:purchaseEnhance` | 99/99 |
| `npm run test:purchaseimport` | 34/34 |
| `npm run test:purchaseimportdata` | 24/24 |
| `npm run test:purchaseimportui` | 20/20 |
| `npm run test:purchaseInventoryLink` | 39/39 |
| `npm run test:purchaseOrderUi` | 60/60 |
| `npm run test:billAmend` | 89/89 |
| `npm run test:billAmendItems` | 115/115 |
| `npm run test:billAmendUi` | 38/38 |
| `npm run test:billAmendItemsUi` | 27/27 |
| `npm run test:audit` | 48/48 |
| `npm run test:alerts` | 5/5 |
| `npm run test:unified` | 11/11 |
| `npm run test:shifts` | 14/14 |
| `npm run test:ui` | 30/30 |
| `npm run test:keyboard` | 93/93 |
| `npm run check:migrations` | "Integrity check: ok" (on a copy — the original DB untouched) |

**Total checks executed across the battery: ~1,000+ (every suite green).**

---

## 5. Risks and honest gaps

1. **The stock is still one number per product.** A batch-aware *valuation* is
   there (the FIFO engine), but `products.stock_qty` is still a single running
   total, so the shop still cannot run two branches with separate stock. The
   branch is now RECORDED on every movement, which is the first step.
2. **Money is still SQLite `REAL`** (D3) — unchanged, documented debt.
3. **The import's unit resolution is strict.** A file whose `unit` cell says
   something the product does not know ("dozen", "carton") keeps the line in
   base units — the old behaviour. It is never guessed.
4. **`product_units` still has no database constraint** on "exactly one base
   unit per product" or on `(product_id, level)`. The app enforces it in code;
   a hand-edited database could still break it.
5. **The variant stock is still outside the canonical model.** `product_variants`
   has its own `stock_qty` that the sale path never touches.
6. **The renderer is still largely hard-coded English** — the Phase 1 items
   touched no user-facing text, so nothing new had to be translated.
7. **A product's own expiry still blocks the whole product**, even when a
   fresh batch exists. That is the pre-Phase-1 behaviour, kept on purpose so
   no existing install changes what it may sell; the batch rule only ever
   ADDS a block.

---

## 6. Next (the phase gate)

Phase 1 is complete and **committed** on the local `main` — **not pushed**, so
the owner can review the diff and the report first. The working tree holds
nothing but the owner's own files (`scripts/seed_demo.js` + the five stray
scripts), untouched and unstaged.

The next phases in the prompt's order:

- **Phase 2** — the receipt / designer template library (the library code is
  already in the tree; Phase 2 hardens it: the branch defaults, the export /
  import round-trip, the "one design, one owner" rule).
- **Phase 3** — the purchase-order screen hardening (the supplier guard and
  the merge rule from 0.14 are the template for the rest).
- **Phase 4** — the printer pipeline (the phase-4 receipt printing is already
  in the tree; it needs the shop's own printers).
- **Phase 5** — the release + the owner checklist + the live deploy.

**The owner must still decide:** (a) rotate the SMTP/SMS credentials (Phase 0),
(b) whether the strict password policy is acceptable for the staff accounts
(Phase 0), (c) whether the duplicate settings controls are cleaned up (Phase 0),
(d) whether the shop wants per-branch stock (Risk 1 above).
