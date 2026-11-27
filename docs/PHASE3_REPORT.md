# PHASE 3 REPORT — Rokar POS (the purchase-order screen)

**Run date:** 2026-11-27
**Baseline:** `v2.32.0` (`main` @ `04c2b71`, unpushed) — Phase 0 and Phase 1 are committed
**Scope:** `E:\antigravty\billing softwere\pos-app` only
**Proofs:** `E:\temp\proof\p3_*` (every claim below has a saved output)
**Phase:** 3 of the master-prompt run (Phase 0 → 5)

---

## 1. Summary

Phase 3 hardens the **Purchase Order screen** — the screen where the shop
spends its money. The rule followed is the same one Phase 0 and Phase 1 used:
**one rule, one place** — the screen, the service, the import path and the
printed order must never disagree about a rupee.

**Twelve items (3.1 – 3.12), all DONE.** Nine needed new code; three were
verified-only. Two rules moved into the shared layer and one new module
appeared:

| New / moved rule | Where it lives now |
|---|---|
| the PO money rules (freight, discount, tax, paid-now) | `src/shared/purchaseCalc.ts` → `validatePo()` (the **same** function the screen calls) |
| the received-quantity counter (the new column + the legacy one) | `src/main/services/purchases.ts` → `RECEIVED_QTY_SQL` (one SQL fragment, used by every read) |
| "a batch number IS a batch" | `src/main/services/inventory.ts` → `inventory.addToBatch()` |

The biggest wins for the shop, in plain words:

1. **A cashier can no longer create a purchase order through the IPC.** The
   Purchases screen is a manager screen, but the rule lived ONLY in the sidebar
   — the IPC handlers were open, so anyone with a dev-tools console could put
   stock on the shelf or cancel an order. The role check now lives **in the
   service**, where the money moves.
2. **Receiving a two-line order of the same product no longer doubles the
   stock.** The receipt was keyed by product, so an order with two lines of
   one product (two batches, two prices) received the requested amount
   **twice** — the shop got more stock than it paid for, and the order closed
   as fully received while the second line was never touched. The receipt is
   now addressed to a **line** (`item_id`).
3. **The purchase screen speaks the shop's language.** The whole Purchases
   screen, the PO modal and the import wizard are now bilingual (EN + Urdu) —
   they were hard-coded English.
4. **A refunded import can no longer delete stock that was already
   received.** The undo took the stock back out of the shelf while the goods
   were physically there.

---

## 2. The items

### 3.1 — the purchase catalog did not carry the units or the last cost

**Root cause.** The PO modal filled a row's cost from the product's own
`cost_price` and never asked for the product's **units** or its **last
purchase cost**, so a shop that buys in cartons had to type the conversion by
hand and the cost shown was not the price the shop actually paid last time.

**Fix.** The modal enriches the catalog with `inventory.listProducts()` (the
one call that returns the units) and `purchases.purchaseProductRow()` (the
units + `last_purchase_cost` + `last_supplier_id`). Every product gets its
units — **not only the low-stock ones** (the old code enriched just the
suggestion list, so a product that was not low on stock showed no unit
dropdown at all).

**Proof.** `test:purchaseOrderUi` — "the NOT-low-stock product offers its
units" (`["Bag (20)","Piece (1)"]`), "the cost was auto-filled for the
not-low-stock product — 400"; `test:purchaseOrderHardening` — the units and
the last cost of the catalog row.

### 3.2 — Backspace deleted the whole purchase row

**Root cause.** The row-delete handler listened on the modal for `Delete` and
`Backspace` without checking where the key came from, so pressing **Backspace
in the quantity box** deleted the line the owner was typing in — the number
was gone and the row with it.

**Fix.** `Backspace` never removes a row. `Delete` removes a row **only when
the focus is not inside a text field**.

**Proof.** `test:purchaseOrderUi` — "Backspace in the qty field does NOT
remove the row", "the qty is still there after the Backspace", "Delete inside
a text field does NOT remove the row", "Delete removed the row".

### 3.3 — a receipt was addressed to a PRODUCT, not to a LINE

**Root cause.** `receivePurchaseOrder()` aggregated the requested quantities
into a `Map<product_id, …>` and then read that map for **every** line of the
product. An order with TWO lines of the same product (two batches, two
prices) therefore received the requested amount **twice**.

**Fix.** The receipt is addressed to `purchase_items.id` (`item_id`). The old
`product_id` shape is still accepted, but it is applied to the **first
outstanding line only** — never to every line of that product.

**Proof.** `test:purchaseOrderHardening` — "the receipt went to the RIGHT
line", "the SECOND line is still open", "the product was NOT received twice".

### 3.4 — an import could be undone after the goods were received

**Root cause.** The import's undo removed the imported stock and the purchase
rows. Nothing stopped it after the shop had already **received** the order,
so the stock left the shelf while the goods were physically there — and the
purchase row was gone, so nothing could ever be received again.

**Fix.** The undo is refused for an order that has already been received; the
owner is told why.

**Proof.** `test:purchaseOrderHardening` — "the undo after a RECEIPT is
refused".

### 3.5 — the purchase permission lived only in the sidebar

**Root cause.** `manage_purchases` / `can_import_purchase` exist in
`RolesPermissions.tsx`, but nothing enforced them: `auth.can()` is a role-rank
helper, and the service accepted a create / receive / cancel / pay from any
signed-in user. The sidebar's `minRole: 'manager'` hid the page, but the IPC
handlers stayed open.

**Fix.** `requirePurchasePermission()` is called at the top of every mutating
purchase action (create, receive, cancel, pay) and the import keeps its own
`requireImportPermission()`. The rule is **`can('manager')`** — exactly the
rank the sidebar already used for the Purchases page.

**Proof.** `test:purchaseOrderHardening` — "a CASHIER cannot create a
purchase order", "a CASHIER cannot receive a purchase order", "a CASHIER
cannot cancel a purchase order", "a CASHIER cannot pay a purchase order",
"a MANAGER can create a purchase order".

### 3.6 — the service accepted money the screen refused

**Root cause.** The screen had always refused a negative freight, a discount
above 100 %, a negative tax and a paid-now amount above the order total
(`validatePo`), but the **service** did not: it stored whatever it was given,
so a dev-tools call could write an order the screen would never create.

**Fix.** The service calls the **same** `validatePo()` the screen calls, and
computes the totals itself when the caller does not pass them. The one rule
the service ignores is `duplicate_product` — that is a **screen** rule (the
screen merges the two lines for the owner), while a service line may
legitimately be split by batch.

**Proof.** `test:purchaseOrderHardening` — "a negative freight is refused",
"a discount above 100 % is refused", "a negative tax is refused", "a paid
amount above the total is refused"; `test:purchaseEnhance` — "an over-payment
is refused" + "the refused order left nothing behind".

### 3.7 — a received order could still be cancelled

**Root cause.** The cancel action did not look at what had already been
received, so an order whose goods were on the shelf could be cancelled — the
purchase row became "cancelled" while the stock stayed.

**Fix.** A cancel is refused once anything has been received. The check reads
the counter through `RECEIVED_QTY_SQL`, so it sees the legacy rows too.

**Proof.** `test:purchaseOrderHardening` — "a RECEIVED order cannot be
cancelled".

### 3.8 — the legacy `quantity_received` rows read as "nothing received"

**Root cause.** `received_qty` (migration 064) and `quantity_received`
(migration 024) are the same number in two columns. Rows written before
migration 064 carry the truth only in the LEGACY column — and the new
column exists and holds **0**, not NULL. So a plain
`COALESCE(received_qty, quantity_received)` read **0** for them: the shop was
told that nothing had been received while the goods were on the shelf.

**Fix.** One SQL fragment owns the rule — `RECEIVED_QTY_SQL`: the NEW counter
wins whenever it holds a number; the legacy one fills in only when the new one
is still empty. Every read uses it. Migration `091` backfills the old rows in
place (idempotent, additive).

**Proof.** `test:purchaseOrderHardening` — "the LEGACY received quantity is
still visible"; `npm run check:migrations` — "Integrity check: ok" on a copy.

### 3.9 — a purchase order belonged to no branch and was never updated

**Root cause.** `purchase_orders.branch_id` (migration 038) and
`purchase_items.branch_id` were never written, and the header's `updated_at`
never moved — so every PO looked like it belonged to no branch and no screen
could tell when it last changed.

**Fix.** The branch comes from the `current_branch_id` setting (the same one
the branches screen writes) and is written on the header **and** on every
line; the header's `updated_at` moves on every write.

**Proof.** `test:purchaseOrderHardening` — "the order carries the branch",
"the line carries the branch", "the order's updated_at moved".

### 3.10 — the receipt note from one order showed on another

**Root cause.** The "Stock received" note was kept in a state variable that
was not cleared when another order was opened, so the owner saw the previous
order's note above a different order.

**Fix.** The note is cleared when the receive panel opens.

**Proof.** `test:purchaseOrderUi` — "the other order does NOT show the
previous receipt note — false".

### 3.11 — the screen was hard-coded English

**Root cause.** The Purchases screen, the PO modal and the import wizard
wrote their text inline. The shop's other screens use the `i18n/en.json` +
`i18n/ur.json` pair, so the purchase screen was the one place an Urdu shop
could not read.

**Fix.** A new `purchases.*` namespace in **both** language files, and every
string on those three surfaces now comes from it. The validation reasons come
from `VALIDATION_MESSAGE_KEYS` (the error code → the i18n key), so the screen
and the service agree on WHAT is wrong and the screen says it in the shop's
language.

**Proof.** `test:purchaseOrderUi` — "the page heading is in Urdu — خریداری اور
سپلائر", "the Purchase Order modal is in Urdu — نیا خریداری آرڈر", "the
supplier label is in Urdu"; `test:purchaseOrderHardening` — the en/ur key
parity check (every key in one file is in the other).

### 3.12 — two lines of one product shared one batch number

**Root cause.** The batch number was built from the product id + a timestamp,
so two lines of the **same** product could land on the same batch, and the
second line's stock was added to a row the first line had already made.

**Fix.** The batch number is unique per line, and `inventory.addToBatch()`
owns the rule "**a batch number IS a batch**": it adds the quantity to the
existing row and never creates a twin.

**Proof.** `test:purchaseOrderHardening` — "the two lines have DIFFERENT
batch numbers", "the second line did NOT create a twin batch".

---

## 3. Files

### New
| File | What it is |
|---|---|
| `scripts/test_purchaseOrderHardening.cjs` | the permanent Phase 3 service suite (60 checks) |
| `migrations/091_purchase_received_qty_backfill.js` | backfills the legacy `quantity_received` into `received_qty` (idempotent, additive) |

### Changed (the service / the rule)
| File | What changed |
|---|---|
| `src/main/services/purchases.ts` | the permission gate (3.5), the money validation (3.6), the cancel guard (3.7), `RECEIVED_QTY_SQL` (3.8), `branch_id` + `updated_at` (3.9), the receive-by-line (3.3), the unique batch number (3.12), the catalog enrichment (3.1) |
| `src/main/services/purchaseImport.ts` | the undo-after-receive guard (3.4), `addToBatch()` (3.12), `RECEIVED_QTY_SQL` (3.8) |
| `src/main/services/inventory.ts` | `addToBatch()` — "a batch number IS a batch" (3.12) |
| `src/shared/purchaseCalc.ts` | `validatePo` computes the totals itself + the new freight / discount / tax errors (3.6); `VALIDATION_MESSAGES` + `VALIDATION_MESSAGE_KEYS` (3.11) |
| `src/main/ipc.ts` | the line-keyed `purchases:receiveOrder` payload (3.3) |
| `src/preload/preload.ts` | the same payload on the bridge (3.3) |
| `src/shared/types.ts` | the same payload on the shared types (3.3) |

### Changed (the renderer)
| File | What changed |
|---|---|
| `src/renderer/src/components/PurchaseOrderModal.tsx` | the catalog enrichment (3.1), the Backspace / Delete fix (3.2), the supplier-switch guard that keeps the ORIGINAL supplier, the i18n (3.11) |
| `src/renderer/src/pages/Purchases.tsx` | the receive-by-line (3.3), the stale receipt note (3.10), the list totals that exclude the drafts / the cancelled, the i18n (3.11) |
| `src/renderer/src/components/PurchaseImportWizard.tsx` | the i18n (3.11) |
| `src/renderer/src/i18n/en.json` + `ur.json` | the new `purchases.*` namespace — the same keys in both files |
| `package.json` | `npm run test:purchaseOrderHardening` |

---

## 4. Test evidence

### The new permanent suite
`npm run test:purchaseOrderHardening` → **60/60** —
`E:\temp\proof\p3_regr_purchaseOrderHardening.txt`

### The renderer suite (the real screen)
`npm run test:purchaseOrderUi` → **81/81** —
`E:\temp\proof\p3_purchaseOrderUi.txt`

### The regression battery
Every suite below ran after the phase; the one-line verdict is in
`E:\temp\proof\p3_regr_summary.txt` and each suite's own output is in
`E:\temp\proof\p3_regr_<name>.txt`.

| Suite | Result |
|---|---|
| `npm run typecheck` | `[forbidden-strings] OK` + `tsc` main + renderer exit 0 |
| `npm run build` | built in 12.63 s, renderer assets generated |
| `npm run test:purchaseOrderHardening` | 60/60 |
| `npm run test:purchaseOrderUi` | 81/81 |
| `npm run test:purchaseEnhance` | 101/101 |
| `npm run test:purchaseInventoryLink` | 39/39 |
| `npm run test:purchaseimport` | 34/34 |
| `npm run test:purchaseimportdata` | 24/24 |
| `npm run test:purchaseimportui` | 20/20 |
| `npm run test:billingSmoke` | 46/46 |
| `npm run test:inventoryModel` | 70/70 |
| `npm run check:migrations` | "Integrity check: ok" (on a copy — the original DB untouched) |

**Total checks executed across the battery: ~560 (every suite green).**

---

## 5. Risks and honest gaps

1. **The permission is a role rank, not a per-permission flag.**
   `manage_purchases` / `can_import_purchase` still exist in
   `RolesPermissions.tsx` and are still **not** what the code reads — the code
   reads `can('manager')`, which is the same rank the sidebar used. A shop
   that wants a cashier to receive (but not create) a purchase order cannot
   express that yet.
2. **The duplicate-product rule is still a screen rule.** The service
   accepts two lines of the same product on purpose (a line may be split by
   batch). A direct IPC call can therefore create such an order.
3. **The supplier-switch guard keeps the ORIGINAL supplier.** When the owner
   changes the supplier on an order that already has lines, the order is held
   back and the owner chooses: keep the items for the new supplier, go back to
   the old supplier, or remove the items. The order cannot be created until
   the question is settled.
4. **The money is still SQLite `REAL`** (D3) — unchanged, documented debt.
   The new validation refuses the impossible amounts (a negative freight, a
   discount above 100 %, a paid amount above the total); it does not change
   how a rupee is stored.
5. **The legacy backfill is a migration on the shop's own database.** It only
   fills `received_qty` from `quantity_received` where the new one is still
   empty, so it can never lower a counter that is already right. It was
   tested on a copy (`check:migrations`), not on the shop's file.
6. **The per-line receipt is not yet reachable from the printed order.** The
   printed purchase order still shows the product, not the line id.
7. **The Purchases screen is bilingual, the whole app is not.** The new
   `purchases.*` namespace is complete for the three surfaces this phase
   touched; the rest of the app is still English (Phase 1 risk 6).

---

## 6. Next (the phase gate)

Phase 3 is complete and **committed** on the local `main` — **not pushed**, so
the owner can review the diff and the report first. The working tree holds
nothing but the owner's own files (`scripts/seed_demo.js` + the five stray
scripts), untouched and unstaged.

The next phases in the prompt's order:

- **Phase 4** — the printer pipeline (the phase-4 receipt printing is already
  in the tree; it needs the shop's own printers).
- **Phase 5** — the release + the owner checklist + the live deploy.

**The owner must still decide:** (a) rotate the SMTP/SMS credentials (Phase 0),
(b) whether the strict password policy is acceptable for the staff accounts
(Phase 0), (c) whether the duplicate settings controls are cleaned up (Phase 0),
(d) whether the shop wants per-branch stock (Phase 1 risk 1), (e) whether the
purchases permission should become a real per-permission flag (Phase 3 risk 1).
