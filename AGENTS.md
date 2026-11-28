# Rokar POS — Agent Guide

## Version
**v2.33.0** (Perpetual one-time licence: no expiry, device-locked, revocable)

## Environment
- Node.js v24.18.0 (portable at `C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64`)
- Shell: PowerShell 5.1
- Platform: Windows 10/11 (`win32`)

## Key Commands

### Typecheck
```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npx.cmd tsc -p tsconfig.main.json --noEmit
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npx.cmd tsc -p tsconfig.renderer.json --noEmit
```

### Build
```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npm run build
```

### Test
```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; node scripts/test_inventoryReports.js
```

### Billing / shortcut unit tests (pure Node, no Electron)
```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npm run test:holdresume
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npm run test:shortcuts
```
`test:holdresume` (26 checks) round-trips a 3-item mixed-unit cart through the
real `serializeCartLine`/`rehydrateCartLines` (in `src/shared/cartMath.ts`) and
asserts pre-hold totals equal post-resume totals — the v2.15.1 Hold→Resume bug
lost `name`/prices and produced NaN. It also covers legacy held payloads and
garbage input, plus `summarizeHeldBill()` — the pure summary (line count, subtotal,
discount, tax, total incl. service charge/freight, customer id) the Held/Quotation
list now renders. `test:shortcuts` (22 checks) asserts the shared registry
invariants (unique combos per screen, DB-seed exclusions, `resolveCombo`
precedence, `screens` scoping, billing hint rows). Both need `npm run build:main`
first, which the npm scripts do for you.

### Cart Return / Refund test (Electron + throwaway DB)
```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npm run test:return
```
29 checks over the real `returns.createReturnBill` — the service behind Billing's
**Return / Refund** button. A cart return is recorded as its own **negative sale**
(`status = 'returned'`, `invoice_no = RET-YYYYMMDD-NNNN`, `total_amount < 0`), not as
a line against an old invoice, so the suite pins the three things that would break
quietly: the negative sale must **never** surface in `listSales()` (every report and
the cash drawer filter `status = 'completed'`, and the refund reaches the drawer once
via `returns.refund_amount` where `refund_mode = 'cash'`); stock must go back up by
the returned qty (with one `stock_movements` row) unless `restock: false`; and a
**credit** refund must move the customer ledger while a **cash** refund does not. It
also covers the validation gates (empty cart, negative price, zero refund), the
owner-only-above-`refund_manager_threshold` rule (read from `admin_settings`, the same
table the Admin UI writes), and the "open a shift first" refusal.

### Phase 0 test suites (the master-prompt run, 2026-11-26)

```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"
npm run test:ipcError        # 38/38 - the IPC error boundary (src/main/ipcError.ts)
npm run test:timezone        # 16/16 - no UTC "today" leak + the Karachi business-day maths
npm run test:unified         # 11/11 - one business-day resolver (the daily closing / sales list / expenses)
npm run test:shifts          # 14/14 - the >24 h shift block + the shift_long_open audit row
npm run test:utf8            # the permanent mojibake scan (src/ must be real UTF-8)
npm run test:settingsbridge  # 16/16 - the one settings bridge
npm run test:expired         # 15/15 - the expired-stock block + the manager override
npm run test:audits          # 13/13 - audits:discard (owner only)
npm run test:security        # 24/24 - the secret vault + the enforced password policy
npm run test:ui              # 30/30 - the four UI defects, in the REAL renderer (+ 6 screenshots)
npm run test:billingSmoke    # 46/46 - the phase's billing smoke test
npm run test:inventoryModel  # 70/70 - the Phase 1 product/inventory data model
```

### Phase 1 suite (the master-prompt run, 2026-11-27)

`npm run test:inventoryModel` (70 checks) is the permanent guard for the
product / inventory data model. It runs the REAL services against a throwaway
DB and covers: the FIFO deduction being all-or-nothing (a refused adjustment
leaves the batch, the stock and the ledger untouched), two lines of the SAME
product keeping their own FIFO allocations, `quantity_received` being written
(the FIFO Stock Report used to be empty), a return releasing its allocation,
the ONE expiry rule (expired = before today; the till and the report agree),
an expired batch never being sold (and the bill amendment refusing it), a
quotation conversion obeying the stock policy, the ledger recording the user +
the branch, the two inventory-report queries that used to select a column that
never existed, the complete purchase line snapshot, and the import converting a
pack into base units (and its undo taking all of it off again).

**Two rules now live in shared modules — use them, do not write a third copy:**

- `src/shared/expiry.ts` — `isExpiredOn(date, today)`, `daysUntilExpiry()`,
  `expiryBucket()`. **Expired means BEFORE today** (a date that falls on today
  is still sellable). An unreadable date is never expired. Use it in the main
  process AND in the renderer.
- `src/shared/units.ts` — `unitsInBase()`, `baseQty()`, `costPerBaseUnit()`,
  `roundQty()`. The stock is kept in BASE units and rounded to 3 decimals.
  `purchaseCalc.ts` re-exports the first three, so the purchase maths and the
  stock can never drift apart.

One more gotcha for this area: **the FIFO allocations are per LINE, never per
product.** A `Map<product_id, …>` silently gives two lines of the same product
the same batch — the ledger then names the wrong batch (Phase 1, item 1.2).

### Phase 2 + Phase 3 suites (the master-prompt run, 2026-11-27)

```powershell
npm run test:receiptdesigner    # 73/73 - the receipt designer + the template library
npm run test:receipt            # 68/68 - the thermal redesign scenarios
npm run test:print              # 138/138 - the print geometry + the layout audit
npm run test:purchaseOrderHardening  # 60/60 - the Phase 3 purchase-order hardening
npm run test:purchaseOrderUi         # 81/81 - the Phase 3 purchase-order screen (the real renderer)
```

`npm run test:purchaseOrderHardening` (60 checks) is the permanent guard for
the Phase 3 purchase-order work. It runs the REAL services against a
throwaway DB and covers: the catalog carrying the units and the last purchase
cost for **every** product (not only the low-stock ones), a receipt addressed
to a **line** (`item_id`) instead of a product, the undo of an import that
was already received, the purchase permission enforced **in the service**
(a cashier cannot create / receive / cancel / pay), the money validation
(the same `validatePo` the screen uses), the cancel-after-receive guard, the
legacy `quantity_received` counter, the branch + `updated_at` on the order,
the unique batch number per line, and the en/ur i18n key parity.

`npm run test:purchaseOrderUi` (81 checks) drives the REAL renderer: the
Backspace/Delete behaviour, the units of a product that is NOT low on stock,
the supplier-switch guard (A -> B -> C still names A), the stale receipt note
and the Urdu toggle.

**Three rules that moved into one place — use them, do not write a fourth
copy:**

- **The PO money rules** live in `validatePo()` (`src/shared/purchaseCalc.ts`).
  The **service** calls it now (not just the screen), so a direct IPC call
  cannot store an order the screen would refuse. The validator computes the
  totals itself when the caller does not pass them. The one error the
  service ignores is `duplicate_product` — that is a screen rule (the screen
  merges the lines; a service line may be split by batch).
- **The received counter** is read through `RECEIVED_QTY_SQL`
  (`src/main/services/purchases.ts`): the NEW column (`received_qty`,
  migration 064) wins whenever it holds a number; the LEGACY one
  (`quantity_received`, migration 024) fills in only when the new one is
  still empty. **Do not use a plain `COALESCE(received_qty, quantity_received)`
  anywhere** — the new column exists and holds 0, so that expression reads 0
  for every row written before migration 064.
- **"A batch number IS a batch"** lives in `inventory.addToBatch()`: it adds
  the quantity to the existing row and never creates a twin. Use it instead
  of `createBatch()` when the batch number may already exist.

**Two gotchas for the purchase area:**

- **A receipt is addressed to a LINE.** `receivePurchaseOrder(id, lines)`
  takes `{ item_id?, product_id?, qty }`. The old `product_id` shape is
  accepted, but it is applied to the **FIRST outstanding line only** — never
  to every line of that product. The old code applied the requested qty to
  every line of the product, so an order with two lines of one product
  received the quantity twice.
- **`inventory.listProducts()` is the call that returns the `units`.**
  `inventory.list()` does not. `purchases.purchaseProductRow(id)` returns
  the units + `last_purchase_cost` + `last_supplier_id`.

`test:utf8` runs in **pure Node** (no Electron) - keep it that way, it is the
cheapest permanent guard in the repo. Every other suite runs under Electron and
prints Electron's stderr banner, so **PowerShell can report exit 1 on success**:
trust the `ALL PASSED` line and `$LASTEXITCODE`, not the pipeline status. The
Electron ones need `npm run build:main` first (the npm scripts do it for you);
the two renderer suites (`test:ui`, `test:keyboard`) need the full
`npm run build` because they load `dist/renderer`.

Two gotchas that cost real time - do not repeat them:

- **Every Electron suite must call `app.exit(0)` on success.** Without it the
  Electron process stays alive, the `npm run` script never returns and the
  build HANGS on a suite that already printed "all checks passed". Four suites
  had this bug (the Phase 0 `test:unified`, `test:shifts`, `test:audits` and
  `test:security`); it was found when the close-out batch stopped dead after
  a green suite. The batch script now also kills any suite that runs longer
  than 300 s, so a hang can never stall the whole battery again.
- **`test:billingSmoke` must point the backup folder at its own temp dir.** The
  backup service's default is the shop's real
  `Documents\ShopKeeper POS\backups`, and the retention cleanup there deletes
  the owner's own old `pos-*.db` files. The suite therefore writes the
  `backup_folder` admin setting into its throwaway DB before it runs a backup.
- **`test:ui` screenshots need an ON-SCREEN window.** A window parked
  off-screen (`x: -2400`) is treated as occluded, so `capturePage()` hands back
  a **stale** frame from an earlier screen - the screenshot silently shows the
  wrong page. The suite keeps the window on screen and takes the LAST of two
  captures.

### Image-upload helper test (pure Node, no Electron)
```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npm run test:imageupload
```
23 checks over `src/shared/imageMath.ts` — the gate every "upload an image from
this PC" control runs through: allowed MIME types (SVG rejected), the byte ceiling,
the empty-type passthrough, and `fitWithin()` downscale maths (landscape/portrait/
square, 1px floor, never enlarged). The decode + canvas downscale lives in
`utils/imageUpload.ts` and is covered end-to-end by `test:keyboard`, which fakes a
real file pick via `DataTransfer` and asserts the preview.

### Keyboard navigation test
```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npm run test:keyboard
# follows the same Electron pattern as test_recovery:ui — it needs a full build
# first (it loads dist/renderer), and PowerShell reports exit code 1 even on
# success because of the Electron stderr banner. Trust the "ALL PASSED" line.
```
`scripts/keyboard_smoke.js` (93 checks) drives the real renderer with synthetic
`keydown` events: it signs in, seeds a product and the default shortcut bindings,
then asserts the global layer (Ctrl+K palette, F1 help, Escape), that Ctrl+N opens
each migrated page's primary modal and Escape closes it, that Ctrl+F focuses the
page search box, that the merged **Labels** page opens in Designer mode and switches
to Quick Labels (the former Barcode page) and back, that a dialog's header exposes
minimize + maximize + close and
that maximizing/minimizing/restoring behaves (the docked dialog hands Ctrl+F back
to the page), that ArrowDown highlights an Inventory row and Enter opens its
Edit modal, that the Add Product form accepts an image picked from the PC and
shows a preview, that Ctrl+N on Audits starts an audit with focusable count cells,
that the Billing **Held Bills** list identifies each bill by customer and value, and
that Enter on the login username advances to the password field and submits. It
also runs a **Label Studio crash regression**: with a corrupt saved template and a
stale last-used id it must still mount, show a fallback notice, keep the dialog
stack closed on load (all 7 dialogs were unconditional until 2.15.1) and open the
Template Manager on demand.

## Keyboard navigation

Keyboard-first operation is shared infrastructure, not per-page code. The pieces:

- `keyboard/KeyboardProvider.tsx` — one **bubble-phase** `window.keydown` listener,
  mounted in `App.tsx`. It ignores anything already `preventDefault()`'d (so the
  barcode scanner and any typing win), handles the built-ins Ctrl+K / F1, blocks
  everything else while a palette/help overlay is open, and routes every other
  admin combo to the **active scope**.
- `keyboard/scopeRegistry.ts` + `hooks/useKeyboardScope.ts` — a scope stack. Modal
  scopes rank above page scopes, so an open modal masks the page. `active()` is the
  highest-id modal, else the highest-id page. When no scope is registered the
  provider does nothing, so un-migrated screens keep owning their own keys.
- `shared/shortcuts.ts` — **the single source of truth for every combo.** Each row
  is `{ id, label, defaultKey, screens }` (plus `global` / `dbBacked` / `hint`).
  The main process seeds the admin `shortcuts` table from `DEFAULT_SHORTCUTS`, the
  renderer resolves combos with `resolveCombo()` (admin binding → registry default),
  lookups are **scoped by `screens`** (`isActionAllowedOn`) so F5 means "New bill" on
  Billing but "Add product" on Inventory, and Billing's footer strip + F1 overlay are
  generated from `hintRows('billing')`. Adding a shortcut is one row here.
- `keyboard/shortcuts.ts` — thin re-export of the shared registry for the renderer;
  `GLOBAL_SHORTCUTS` (Ctrl+K palette, F1 help) always work; `BUILTIN_DEFAULTS` only
  carries `new_record` (Ctrl+N) for the provider fallback. Verify the invariants with
  `npm run test:shortcuts`.
- `src/main/main.ts` — the application-menu `reload` / `forceReload` /
  `toggleDevTools` roles carry default accelerators (Ctrl+R, **Ctrl+Shift+R**,
  Ctrl+Shift+I) that would shadow the app's own keys. They are **dev-only** now
  (`app.isPackaged ? [] : [...]`), so a packaged build exposes no Electron
  accelerator that can steal a billing keystroke. Support Recovery
  (Ctrl+Shift+Alt+R) is registered explicitly and kept in both.
- `hooks/useFormKeyboard.ts` — inside a modal: Enter = next field (last = submit),
  Shift+Enter = previous, Escape = close, first control autofocused, numeric fields
  select-all on focus, focus trap. It early-returns on `defaultPrevented`, so a
  field that handles its own Enter (staged search, qty box, line-item cell) wins.
- `hooks/useListKeyboard.ts` — any table/list: ↑/↓/Home/End/PageUp/PageDown
  highlight, Enter opens, Delete deletes (caller confirms), type-to-filter focuses
  the search box. Ignored while a row button/input has focus.
- `hooks/useLineItemKeyboard.ts` — editable grids: `search → qty → price` cycle,
  arrow cells, Ctrl+Enter submit, Delete row, Escape cancel.
- `components/Modal.tsx` — the shared shell every migrated page uses: registers the
  modal scope, wires `useFormKeyboard`, renders `modal-header`/`modal-footer`, and
  carries **window-style min / max / close controls** in the header. Maximize fills
  the viewport (`data-maximized`); minimize docks the panel to a corner bar
  (`data-minimized`) and withdraws the modal scope + form keyboard
  (`useKeyboardScope`/`useFormKeyboard` `enabled: false`) so the page underneath keeps
  working — the form stays mounted, so nothing typed is lost, and clicking the bar
  restores focus. The controls follow `showClose`: a mandatory decision dialog
  (`showClose={false}`) hides them so it cannot be deferred or covered.
- `components/KeyboardInput.tsx` / `QtyInput.tsx` — text inputs that never step on
  ArrowUp/ArrowDown and select on focus.
- `components/KeyboardHelp.tsx` / `CommandPalette.tsx` — the F1 overlay (lists the
  active scope's shortcuts) and the Ctrl+K page switcher.

### Adding keyboard support to a new page

1. Replace each `modal-overlay` block with `<Modal onClose=… onSubmit=… title=… shortcuts=[…]>`.
2. Add `useListKeyboard({ count, onOpen, onDelete })` and spread
   `getContainerProps()`/`getRowProps(i)` on the table wrapper and rows.
3. Add `useKeyboardScope({ kind: 'page', label, actions: { new_record, search, save }, shortcuts: [...] })`.
4. Swap price/qty `<input type="number">` for `<KeyboardInput decimals>`.
5. Add a row to the checklist below and extend `scripts/keyboard_smoke.js`.

### Verification checklist

`A` = asserted by `npm run test:keyboard` (automated). `M` = verified by hand.
Anything not yet migrated is listed under the table.

| Page / Modal | Flow | A | M |
| --- | --- | --- | --- |
| Global | Ctrl+K opens the page palette; Esc closes | ✓ | |
| Global | F1 opens shortcut help; Esc closes | ✓ | |
| Global | F1 lists only the keys valid on the current page | | ✓ |
| Login | Enter on username → password; Enter submits | ✓ | |
| Login | PIN pad tap entry | | ✓ |
| Inventory | Ctrl+F focuses search; ↑/↓ highlight; Enter opens Edit | ✓ | |
| Inventory | Delete removes highlighted product (with confirm) | | ✓ |
| Inventory | Ctrl+N opens Add Product; Esc closes; Enter saves | ✓ | |
| Inventory | Add Product: Upload from PC previews a picked image | ✓ | |
| Any dialog | header has min / max / close; maximize toggles; minimize docks + hands the keyboard back; restoring refocuses | ✓ | |
| Inventory | Barcode scan found → highlight + auto-edit | | ✓ |
| Purchases | Ctrl+N opens Add Supplier; Esc closes | ✓ | |
| Purchases | ↑/↓ rows; Enter opens the row's ledger/PO | | ✓ |
| Purchases PO modal | staged search → qty → add; scanner increments a line | | ✓ |
| Expenses | Ctrl+N opens Add Expense; Esc closes | ✓ | |
| Expenses | ↑/↓ rows; Enter edits; Delete deletes | | ✓ |
| Udhaar | Ctrl+N opens Add Customer; ledger modal Esc closes | ✓ | |
| Udhaar | ↑/↓ customers and ledger rows | | ✓ |
| Transfers | Ctrl+N opens new transfer; Esc closes | ✓ | |
| Transfers | ↑/↓ party/bank/account tables | | ✓ |
| Returns | Ctrl+F focuses search; ↑/↓ sale rows | ✓ | |
| Returns | qty→price Enter cycle; Ctrl+Enter submits | | ✓ |
| Audits | Ctrl+N starts an audit; count cells are focusable | ✓ | |
| Audits | type count → Enter saves and moves to next product | | ✓ |
| Audits | Ctrl+Enter saves progress | | ✓ |
| Promotions / Commissions / Branches | Ctrl+N opens the primary modal; Esc closes | ✓ | |
| Quotations / Users / Custom Reports / Invoice Designer | Ctrl+N opens the primary modal; Esc closes | ✓ | |
| Labels (Quick) | single nav entry (Label Studio); opens in Designer; Quick Labels mode = former Barcode Labels page; Ctrl+F focuses its search; ↑/↓ highlight | ✓ | ✓ |
| Labels | mode switch Quick ↔ Designer | ✓ | |
| Label Studio | Crash regression: mounts with corrupt saved template; no dialog stack on load | ✓ | |
| Label Studio | Ctrl+F focuses the product search (asserted post-mount); ↑/↓ navigates products; Space toggles | ✓ | ✓ |
| Label Studio | image element: Upload from PC, or `{image}` binds the product photo; prints as a real image | | ✓ |
| Reports / FIFO Stock Report | page scope registers (F1 shows the page heading) | ✓ | |
| Reports | ↑/↓ across the analytics tables | | ✓ |
| FIFO Stock Report | ↑/↓ across the per-product batch tables | | ✓ |
| Cash Drawer | focus trap; Esc closes; opening/closing cash don't step | | ✓ |
| Billing | Ctrl+F / F2 focus the search box; footer hints come from the registry | ✓ | |
| Billing | Ctrl+Shift+F opens Return / Refund; Esc closes | ✓ | |
| Billing | Ctrl+S = save, Ctrl+Shift+S = save+print, Ctrl+P = print last — on ANY keyboard layout | ✓ | |
| Billing | Hold then resume restores a full cart (no NaN) | ✓* | ✓ |
| Billing | Held Bills list shows customer + value; Esc closes | ✓ | |
| Billing payment modal | Enter from **any** field completes the sale (legacy semantics) | | ✓ |

\* the hold→resume round-trip is asserted by `npm run test:holdresume` (pure cart
maths), because the failure mode was a data-loss bug rather than a keydown one.

**Migration status.** Every nav page's modals now use the shared `<Modal>` shell and
`<KeyboardInput>`; `useListKeyboard` runs on the tables and `useKeyboardScope` on the
page. Two things are deliberately still bespoke:

- **`Billing.tsx` / `QuickSaleGrid.tsx` page-level keyboard.** Their window `keydown`
  handlers, scanner and F-/chord shortcuts are left in charge (they register **no**
  page scope, so the global provider does nothing on those screens). Only their modals
  migrated. `<Modal onKeyDown={…}>` runs before the form-keyboard logic and the payment
  modal uses it to keep the legacy "Enter anywhere completes the sale" rule — it must
  also `stopPropagation()` or the window handler fires `completeSale()` a second time.
  Give the payment modal `onSubmit` only if you also keep that guard; the built-in
  Enter→next-field behavior would otherwise make the cashier Tab to "Complete Sale".
- **`App.tsx`'s "Installing update" spinner** and `components/WallpaperEditor.tsx` stay
  as inline overlays — they are non-interactive progress/editor surfaces, not forms.

### Billing's Ctrl+S / Ctrl+Shift+S / Ctrl+P (layout- and browser-proof)

Billing's window handler is bespoke (above), so its three money chords are **hard-coded**
rather than read from the registry. Two rules keep them working everywhere:

- **Resolve the physical key, never `e.key`.** The chord checks compare
  `keyFromEvent(e)` (which falls back to `e.code`), so a non-Latin layout — where
  Ctrl+Shift+S arrives as `key='س', code='KeyS'` — still fires. Comparing `e.key`
  directly is how a shipped build silently degraded to the toast
  `Shortcut "Ctrl+Shift+S" is not available on the billing screen`: only `save_print`
  and `print` had no `dispatchAction` case, and `save_print` now has one too.
- **Every hard-coded chord is `!e.altKey`**, so `Ctrl+Alt+…` falls through to the
  admin/registry bindings at step 4. That is what lets the **web** build offer a
  different save+print chord.

`save_print` is the only chord a browser can steal. Edge reserves `Ctrl+Shift+S` for
"Web capture" and Firefox for "Take screenshot" — the `keydown` never reaches the page,
so no script can rescue it. `cloud/web/electron-browser.ts` therefore answers
`admin:shortcuts:getAll` with `save_print = Ctrl+Alt+S` **only while the row still holds
the seeded default** (an owner's own binding is left alone), and the normal registry
path then runs it. One more piece of `src/utils/shortcutKeys.ts` matters here:
`MODIFIER_ORDER` must match the order `eventCombo()` emits (`ctrl`→`alt`→`shift`); the
old `['alt','ctrl','shift']` order meant *any* `Ctrl+Alt+X` binding could never match.
`scripts/test_shortcutKeys.js`
mirrors the module and covers it; `npm run test:keyboard` asserts the native and
layout-proof chords, and `npm run smoke:web` asserts the served binding, the footer hint
and that the combo is consumed.

### Licensing (perpetual, since 2026-10-03)

**The licence is a one-time purchase and never expires.** This replaced a 1-year
subscription that the marketing site had been contradicting all along (the site said
"No annual lock-in" while `server.js` stamped every key `expires = now + 365 days`).

How it works:
- `license-server` has a `lifetime INTEGER` column. A lifetime key stores
  `LIFETIME_SENTINEL` (`2999-12-31`) in `expires_at` **purely to satisfy that
  column's NOT NULL** — rewriting it would mean a table rebuild. Every expiry
  decision goes through `isLifetime(row)`, so the sentinel is never read.
- `/api/generate` defaults to `lifetime: true`. Pass `lifetime: false` for a dated
  key (rentals, evaluation).
- The client caches this in the `license_lifetime` setting. `ensureLicenseValidSync()`
  runs on **every sale** (`sales.ts`) and returns immediately for a lifetime key, so
  the hot path is one string compare.

Three defects were fixed at the same time. Each looked correct in isolation:
1. **`device_id` was never sent**, so the server's `max_devices` check was dead code
   and one key validated from unlimited machines. With no expiry left, that made a
   perpetual licence trivially shareable, so `/api/validate` now *refuses* a request
   without a `device_id` rather than skipping the check.
2. **A server rejection was swallowed.** `throw new Error(data.msg)` sat inside the
   `try` whose `catch` said "network error", so a `Revoked` or `Expired` response was
   ignored and the shop carried on billing. Rejections are now captured in a variable
   and re-thrown after the `try`. Network failures are still tolerated.
3. **Revocation was unenforceable.** `checkLicense()` runs once at startup and only
   logs its error, and the lifetime shortcut skips the per-sale check. A revoked
   lifetime key is now recorded in `license_revoked` and blocks the next sale.
   `activateLicense()` clears that flag.

`scripts/test_licensing.js` (`npm run test:licensing`) covers all of this with a
stubbed server — 19 checks, including that a perpetual licence passes with the
network down and that a revoked one blocks the next sale. Add a case there rather
than reasoning about the logic by hand.

Keys already issued keep their 365-day expiry and are **not** converted
automatically. To convert them, call `/api/renew` per key (it returns
`{ok:true, lifetime:true}` and changes nothing for a lifetime key, so it is safe to
run against every key), or run `UPDATE licenses SET lifetime = 1` in Turso.

## Password recovery test
```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npm run test:recovery
```
48 checks over the real `recovery.ts` against a throwaway DB: hash domain separation, answer
normalisation, lockout at 5 failures, CLI/service code parity, cross-device + single-use
rejection, and that one shop can be recovered repeatedly.

```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npm run test:recovery:ui
```
26 end-to-end checks that drive the REAL renderer in a hidden `BrowserWindow` with the real
preload and real IPC handlers, so it also proves the `recovery:*` channel names line up
end-to-end and the `Ctrl+Shift+Alt+R` chord is armed. Needs a full `npm run build` first
(it loads `dist/renderer`), hence it does not reuse `build:main`.

Two gotchas if you extend it:
- **`.lock-box` is not unique.** The login screen, the auto-lock screen and the forced
  "Set a new owner password" modal all use it. Scope queries to the LAST box in DOM order
  (`window.__t.top()`), never `querySelector('.lock-box')` — the first match is the login
  screen and will silently keep matching "Rokar POS".
- **Injected page helpers are wiped by `window.location.reload()`.** Re-inject via
  `ensureHelpers()` after any navigation.
- PowerShell reports `Exited with code 1` for these Electron runs even on success, because
  Electron prints a `Network service crashed` banner to stderr. Trust the summary line and
  `$LASTEXITCODE`, not the pipeline's exit status.

### Print geometry smoke test
```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npm run test:print
# Add --shots to also write PNGs of every rendered page for visual review:
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; electron scripts/print_smoke.js --shots
```
Three layers of checking, because page dimensions alone hide real defects:
- **Page box** — every generated PDF's actual width/height is measured against the paper spec.
- **Layout audit** (`auditJobLayout`) — measures real element boxes in the loaded page against the PRINTABLE width and fails if anything is clipped. This is what catches receipts arriving sliced. Includes a stress case that renames a product to a 97-character name and restores it afterwards.
- **Content audit** (`readJobText`) — reads back the laid-out text and asserts the expected fields are present, so a markup slip cannot silently drop a column.

The audit runs the *production* job builders (`buildReceiptJob`/`buildInvoiceJob`), so it also covers the template/paper clamping. If `C:` is full, point the DB elsewhere first: `$env:TEMP="E:\tmp-opencode"; $env:ROKAR_SMOKE_USERDATA="E:\tmp-opencode\smokedata"`.

### Marketing screenshots (capture_screens.js)
```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npm run capture:screens -- --out E:/tmp-opencode/site/public/screens
```
Boots the real renderer against a seeded demo database and writes WebP screenshots
of Dashboard / Billing / Inventory / Udhaar / Purchases / Reports, plus a
`manifest.json`. The website's ProductTour section uses these instead of hand-drawn
mockups, so **every screenshot shows fictional data from `scripts/seed_demo.js`** —
the website must keep labelling them "sample data".

Seeding is separate (`scripts/seed_demo.js`, also `npm run seed:demo` with
`POS_DB_PATH` pointing somewhere disposable) and goes through the real
`sales`/`inventory`/`purchases` services, so stock movements and customer ledgers
are consistent with real use. It then back-dates the bills across 14 days by
rewriting `sales.created_at`, which is safe only because nothing on the sale path
denormalises a timestamp into an aggregate table.

Four Electron gotchas cost most of the debugging time here. All four fail
*silently* — you get a plausible-looking wrong file rather than an error:
- **`backgroundThrottling: false` is mandatory.** The capture window is parked
  off-screen, so Chromium treats it as occluded and throttles the lazy `import()`
  that loads each page. Navigation silently never completes and every screenshot
  comes out as the *previous* page. Three screenshots came out byte-identical
  before this was found.
- **Wait for the page to render, not for a timer.** Clicking a nav item flips
  `active` synchronously but the component is still loading. Each screen declares a
  `ready` expression (`.page-header h1` text, `.sale-invoice-title`, …) that is
  polled before capturing.
- **The first `capturePage()` after the window is shown throws `UnknownVizError`.**
  Transient — the compositor frame does not exist yet. Retry rather than abort.
- **A dark capture is not necessarily a blank capture.** Rokar's Dashboard is
  genuinely ~42% dark pixels. Detect an unpainted buffer by *uniformity*
  (low standard deviation, >80% dark), not by overall brightness.
- Also: never `await` a `requestAnimationFrame` in this window — it is occluded, so
  rAF is throttled to zero and the promise never resolves. Use a timer.

### Release
```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npm run release
# After it finishes (exit code 1 is EXPECTED when FINALIZE_FAIL: GH_TOKEN not set), publish the draft:
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; $line = Get-Content -LiteralPath ".env" | Where-Object { $_ -match '^(?:GH_TOKEN|GITHUB_TOKEN)=' } | Select-Object -First 1; $p = $line -split '=', 2; Set-Item -Path "env:$($p[0])" -Value ($p[1].Trim().Trim('"', "'")); node scripts/finalize-release.js
```
Note: `npm run release` = build + electron-builder publish + `node scripts/finalize-release.js`. The finalize step does NOT inherit `.env` (dotenv only wraps electron-builder), so it fails with `FINALIZE_FAIL: GH_TOKEN not set` and leaves the GitHub release as a DRAFT — run the second command above to create the tag and publish it (the auto-updater only sees published releases).

**Every release also needs a version-less asset.** Finalize uploads the installer a second time as `RokarPOS-Setup.exe` (no version in the name). The marketing site downloads from `/releases/latest/download/RokarPOS-Setup.exe`, so that name has to exist on every release — otherwise the site's download button silently keeps serving the *previous* installer. If finalize prints `WARN: installer not found`, the alias was skipped and you must upload it by hand (`gh` is installed and reads `GH_TOKEN`):
```powershell
Copy-Item "dist_release\RokarPOS-Setup-<version>.exe" "dist_release\RokarPOS-Setup.exe" -Force
gh release upload v<version> "dist_release\RokarPOS-Setup.exe" --repo hamzarazadomain3-code/pos-releases --clobber
```
GitHub's upload endpoint takes the **raw file bytes** (`Content-Type: application/octet-stream`, asset name in the `?name=` query string) — it is *not* a `multipart/form-data` upload. If `uploadAsset()` in `finalize-release.js` ever sends multipart, GitHub stores the whole encoded body as the asset: the file becomes ~274 bytes too big and starts with `--<boundary>` instead of `MZ`, so every download is corrupt while the API still reports a plausible size. After any release, sanity-check the alias:
```powershell
curl.exe -sL -r 0-1 "https://github.com/hamzarazadomain3-code/pos-releases/releases/latest/download/RokarPOS-Setup.exe"   # first two bytes must be "MZ"
```
This costs ~120 MB of extra release storage per release. It is the price of never editing the website again; do not "optimise" it away without also pinning the site back to a versioned URL.

### `latest.yml` — the asset that silently breaks every update

**A release without a correct `latest.yml` breaks EVERY client**, and the error
the shop owner sees is:

```
Update check failed: Cannot find channel "latest.yml" update info: HttpError: 404
"method: GET url: https://github.com/hamzarazadomain3-code/pos-releases/releases/download/v2.25.0/latest.yml"
```

Two ways it happens, both seen in the wild on v2.25.0:

1. **It was never uploaded.** `electron-builder --publish always` was interrupted
   mid-upload (the 120 MB installer over a slow link), so the release went out
   with the `.exe` but without the manifest. The finalize step then found the
   release "already published" and skipped the upload.
2. **It describes the WRONG build.** NSIS embeds a build timestamp, so every
   rebuild produces different bytes. `latest.yml` written by an earlier run now
   carries a stale `sha512`/`size`; electron-updater downloads the file and then
   rejects it with a checksum error. The local `dist_release/latest.yml` can be
   stale even when the release's copy is fine — always derive it from the file
   you are shipping.

`scripts/finalize-release.js` now prevents both: it **rebuilds `latest.yml` from
the installer's actual bytes** (sha512 + size computed from the file), deletes any
stale copy already on the release, uploads the fresh one, and then **verifies the
release carries every asset the updater needs** (`latest.yml`, the versioned
installer, its `.blockmap`, and the version-less alias) — failing loudly instead
of shipping a broken release.

Verify a published release the way the updater sees it (downloads the installer
and checks the sha512 byte for byte):

```powershell
$env:PATH = "C:\Users\Hamza PC\Downloads\node-v24.18.0-win-x64\node-v24.18.0-win-x64;$env:PATH"; npm run verify:release -- v2.25.0
```

If the publish step is ever interrupted, re-run `node scripts/finalize-release.js`
(it is idempotent) or `node scripts/publish-latest-yml.cjs` (manifest only).

### App icon (why `signAndEditExecutable` is false)

`build.win.signAndEditExecutable` is `false` on purpose. electron-builder's built-in
executable editor shells out to `app-builder rcedit`, which unpacks the winCodeSign
bundle with `7za` — and `7za` is not on PATH on these build machines, so leaving it on
makes the whole build abort with `exec: "7za": executable file not found`. Turning it
off kept the build green but silently dropped our icon from `Rokar POS.exe` (Explorer
and the taskbar showed the stock Electron atom), while the NSIS installer/uninstaller
looked correct because NSIS embeds `installerIcon`/`uninstallerIcon` itself.

The icon is now applied by the `afterPack` hook (`scripts/after-pack.js`) using a
vendored `build/tools/rcedit-x64.exe` (needs no external extractor). It sets the icon
plus ProductName/FileDescription/CompanyName/version on the packaged executable. Do not
delete `build/tools/` or the hook, and do not "simplify" it back to `signAndEditExecutable: true`
unless `7za` is guaranteed on PATH. Verify a build with:
```powershell
python <pe-icon-parser> "dist_release\win-unpacked\Rokar POS.exe"   # expect 6 sizes, pixel-exact
```
`build/icon.ico` must stay a **square** multi-resolution ICO (16/24/32/48/64/128/256).
The canonical source is `build/icon-source.png` (the supplied 1024×1024 app icon,
transparent corners). The raw mark `src/renderer/src/assets/rokar-sidebar-icon.png`
is a 256×256 copy of the same artwork. Both are generated by
`build/build_branding.py` — do not hand-edit the PNGs, re-run the script:

```powershell
python build\build_branding.py --site "E:\antigravty\rokar-site"
```

The script crops the supplied artwork (`assets/branding/source/`), floods the
near-white page background out to transparency and writes every format (the
multi-res ICO, the light + white lockups, the white mark, the favicons and the
website's `public/` icons). **The artwork is never redrawn or recoloured.**

### The default wallpaper

`build/build_wallpaper.py` turns the supplied artwork
(`assets/wallpaper/source/Isometric Fintech Workspace with POS Terminal.png`,
a portrait 1086×1448 illustration) into `src/renderer/src/assets/wallpaper-default.webp`
— a 1920×1080 canvas painted in the artwork's own edge colour with the
illustration scaled to the full canvas height and centred, so **nothing is
cropped** ("cover" on a landscape till would cut both the laptop and the POS
terminal away).

It is the app's **DEFAULT wallpaper**: `App.tsx` applies it to the document body
whenever the shop has not chosen one, on every screen (login card included).
`applyWallpaper()` lives at module scope in `App.tsx` so the admin-settings
change listener can re-apply it live. Admin → System Settings → Background
Wallpaper now shows the default in the preview and its button reads
"Reset to default" (it falls back to the default, it never leaves a blank
background). `npm run test:wallpaper` drives the real renderer and asserts all
of it (13 checks).

## Architecture Notes
- **Database**: `node:sqlite` with `DatabaseSync` (via `src/main/db.ts` `getDb()`)
- **Migrations**: `migrations/0XX_*.js` — always use `PRAGMA table_info()` guard pattern
- **Services**: `src/main/services/` — each exports a singleton (e.g., `export const inventoryReports = new InventoryReportsService()`)
- **IPC**: Handlers in `src/main/ipc.ts` under `registerIpcHandlers()`, bridge in `src/preload/preload.ts`
- **Version bump**: Update `package.json` `version` field

## Components
- `migrations/024_inventory_advanced.js` — schema for advanced reports
- `src/main/services/inventoryReports.ts` — purchase history, daily/weekly/monthly inventory, supplier metrics
- `src/main/services/profitability.ts` — daily/weekly/monthly profitability, category analysis, break-even
- `src/main/services/alertService.ts` — low stock, expiry, low profit, slow mover alerts
- `src/main/main.ts` — scheduler (midnight snapshot, hourly alerts)
- `src/main/services/backup.ts` — `runBackup()`/`restoreBackup()` (restore validates the file, checkpoints WAL, swaps the db, re-runs migrations)
- `src/renderer/src/utils/currency.ts` — cached currency symbol + `formatMoney()`/`getCurrencySymbol()` (driven by admin `currency_symbol`/`decimal_places`); use these instead of hardcoded "Rs" in new UI
- `src/renderer/src/components/LiveClock.tsx` — timezone-aware header clock (`clock_timezone` setting)
- `src/shared/imageMath.ts` + `src/renderer/src/utils/imageUpload.ts` + `src/renderer/src/components/ImageField.tsx` — the "upload an image from this PC" stack. `imageMath` (pure, tested by `test:imageupload`) validates MIME/size and computes the downscale; `readImageFile()` decodes, resizes via canvas (PNG for alpha sources, JPEG for photos) and returns a data URL so a phone photo never bloats a SQLite row or the localStorage quota Label Studio templates live in; `ImageField` is the shared control (Upload from PC + optional URL box + thumbnail + Remove + inline error). Used by the Label Studio image element, Inventory product photo, Settings shop logo and (validation only) the Admin wallpaper.
- `src/renderer/src/pages/Billing.tsx` — the till screen. The Held / Quotation list identifies each bill by **customer + line count + value**, computed from the saved payload by the pure `summarizeHeldBill()` in `src/shared/cartMath.ts` (so one corrupt row degrades to zeros instead of blanking the modal), and the cart's − / + / × controls keep a ≥34px hit area (42px on coarse pointers) for touch terminals.
- `src/renderer/src/hooks/useBarcodeScan.ts` — shared barcode scanner window keydown hook (`{ onScan, minLength=8, scanTimeout=50, enabled=true }`); used in QuickSaleGrid (refactored), Purchases PO modal (new), Inventory (new, always enabled). Scan flush = Enter with buffer >= minLength; capture-phase + preventDefault so it never also triggers staged-search Enter.
- `src/renderer/src/pages/QuickSaleGrid.tsx` — staged search Enter flow (1× select, 2× qty box, 3× add) + shared scanner hook; mirrors Billing keyboard nav / qty dialog
- `src/renderer/src/pages/Purchases.tsx` — the Purchases & Suppliers screen (the suppliers tab + the purchase orders tab: the status chips, the filtered totals and the quick actions — View / Receive / Cancel / Print / Duplicate).
- `src/renderer/src/components/PurchaseOrderModal.tsx` — the **New Purchase Order** modal (the whole PO screen): the header (the supplier, the expected date, the ref no, the notes, the discount / freight / tax / paid-now), the staged search (Enter 1x select, 2x qty, 3x add) + the barcode scanner, the **per-row searchable product cell** (the shared `matchProducts`), the live inventory on every row (the stock, the last purchase cost, the unit + the pack conversion, the margin, the cost-change warning), the suggestion list (the low-stock / the supplier's products), the totals block, the sticky footer (`Save draft` / `Create` / `Cancel`) and the keyboard (`Ctrl+Enter` = create, `Ctrl+S` = draft, `Delete` = remove the row + undo). The body scrolls and the footer never clips (`.modal-scroll-body` + `.modal-po`).
- `src/renderer/src/components/DateInput.tsx` — the date field EVERY screen uses (30 call sites). Clicking it opens a themed **calendar** (not the browser's OS widget) drawn from the pure `src/shared/calendarGrid.ts`; the popup is portalled to `document.body` with `position: fixed`, so a modal's scrolling body can never clip it, and it flips above the field when there is no room below. The typed `dd/mm/yyyy` path is unchanged (Enter still commits and still advances the form), ArrowDown/arrows/Enter are the keyboard path, Esc closes the calendar (`stopPropagation`, so the modal stays open), and the admin's `date_format` setting still decides how the date is displayed. Month/weekday names come from the `calendar` section of `i18n/en.json` + `ur.json`. Covered by `npm run test:calendar` (the pure grid) and `npm run test:dateCalendarUi` (the real renderer).
- `src/shared/purchaseCalc.ts` — the **ONE** purchase maths (the line money, the unit conversion, the suggested qty, the cost-change %, the margin %, the header totals, the validation). The service, the screen and the printed order all call it, so they can never disagree.
- `npm run test:purchaseEnhance` / `test:purchaseInventoryLink` / `test:purchaseOrderUi` — the three permanent Purchase Order suites (the services + the pure maths, the Inventory <-> Purchase live link, and the REAL renderer driven end to end).
- `src/renderer/src/pages/Inventory.tsx` — staged search (1× select highlight, 2× open Edit) + always-enabled barcode scan (found → highlight + auto-edit; not found → prompt "add new product with barcode")
- `src/renderer/src/pages/Labels.tsx` — one sidebar entry ("Label Studio") for all label printing: a **Quick Labels / Designer** mode switch. Quick renders `pages/BarcodeGenerator.tsx` (the former standalone Barcode Labels page); Designer renders `pages/LabelStudio.tsx`. The legacy `barcode` nav key still routes here in Quick mode, so old shortcuts/deep links keep working; the separate Barcode nav entry is gone.
- `src/renderer/src/pages/LabelStudio/` — the Designer: `types.ts` (sizes, built-ins incl. the 2-across Al Bagdad templates, `normalizeTemplate`), `PreviewCanvas.tsx` (multi-column live preview), `format.ts` (renderer mirror of the main-process token/date/price resolver), `PrintRunModal.tsx` (per-run overrides), `LabelThumbnail.tsx` (schematic SVG used by the template picker + manager), `PropertiesPanel.tsx` / `TemplateManager.tsx` / `LabelEditorCanvas.tsx`
- `src/renderer/src/components/filters/SearchInput.tsx` — optional `onKeyDown` prop (used for staged search in Inventory)
- `scripts/finalize-release.js` — finalizes GitHub release (needs GH_TOKEN — see Release above). Also uploads `RokarPOS-Setup.exe`, the version-less asset the website's `/releases/latest/download/` link depends on.
- `scripts/after-pack.js` — electron-builder `afterPack` hook that embeds `build/icon.ico` + version metadata into the packaged `Rokar POS.exe` with vendored `build/tools/rcedit-x64.exe` (see "App icon" above)
- `build/build_branding.py` — turns the supplied brand artwork into every format (multi-res ICO, light/white lockups, white mark, favicons, the website's `public/` icons). Never redraws or recolours the artwork.
- `build/build_wallpaper.py` — builds the app's DEFAULT wallpaper (the supplied isometric artwork) as a 1920×1080 WebP; nothing is cropped.
- `scripts/billing_keys_check.js` — the end-to-end demo check for the run-13 features (F6 customer search, the customer discount, the quick customer dialog, Pause/F4 bill editing, the Esc refresh, the void-rule sentence): `npm run test:billingKeys` (26 checks).
- `scripts/test_default_wallpaper.js` — the end-to-end check for the DEFAULT wallpaper: the built asset, the login screen, the app screens, a shop wallpaper overriding it and the fallback: `npm run test:wallpaper` (13 checks).
- `build/icon.ico` — the app/installer icon. Must be a square multi-resolution ICO (16/24/32/48/64/128/256); regenerate with `python build\build_branding.py` and verify the directory frames are exact squares
- `build/icon-source.png` — the supplied 1024×1024 app icon with transparent corners, kept so the ICO can be regenerated correctly
- `scripts/seed_demo.js` — seeds a disposable DB with fictional shop data through the real services, for screenshots and for poking at the app without touching a real shop's numbers
- `scripts/capture_screens.js` — captures real WebP screenshots of the app for the marketing site (see Marketing screenshots above)
- `scripts/test_inventoryReports.js` — 12-test verification suite
- `src/main/services/printService.ts` — the printing engine (geometry, shared print window, previews, PDF export)
- `src/main/services/labelStudioPrinting.ts` — Label Studio's main-process half: rebuilds a renderer serialized template into HTML (mm-coordinate elements + `{placeholders}`, barcode/QR via `printDocs.toDataUrl`) and exposes `printBarcodeBatchWithOptions` / `exportLabelBatchToPDF` / `exportLabelBatchToPNG` / `printCalibrationLabel` / `buildLabelStudioJob` / `buildCalibrationLabelHtml`
- `scripts/print_smoke.js` — Print geometry/enumeration suite (page box + layout audit + content audit), run with `npm run test:print`
- `scripts/receipt_design_check.js` — thermal redesign scenario suite (1 item / 6 items + discount + 0.57kg unit / udhaar) against a disposable DB, `npm run test:receipt`
- `scripts/test_return_bill.js` — cart Return / Refund suite against a throwaway DB (`npm run test:return`); asserts the negative-sale write, restock, cash-drawer vs customer-credit split, the manager threshold and the validation gates (see "Cart Return / Refund test" above)
- `src/main/services/recovery.ts` — password recovery: Option A (security question + owner recovery
  code) and Option B (developer-issued support code). Recovery answers are salted with
  `pos-recovery-salt`, NOT the password salt `pos-salt` — a shared app-wide salt would put answers
  and passwords in one hash domain. Support codes are `HMAC-SHA256(secret, "rokar-recover-v1|device|owner|epoch")`
  truncated to 40 bits and encoded as Crockford base32; `epoch` (`admin_settings.support_epoch`) makes
  each code single-use without needing a clock. Full spec incl. the key: `RECOVERY_CODE_SPEC.md`.
- `migrations/049_password_recovery.js` — `security_question`/`security_answer_hash` on users,
  `recovery_lockout`, `support_recovery_codes`, seeds `device_uuid` + `support_epoch`
- `tools/recovery-code-cli.js` — developer's code generator, run locally, NOT packaged (`build.files`
  excludes `tools/`). `node tools/recovery-code-cli.js <device-id> <request-number> [owner]`
- `src/renderer/src/pages/LoginRecovery.tsx` — login-screen recovery flow (both modes)
- `src/renderer/src/pages/Users.tsx` — "Recovery & Security" card (owner-gated)

## Printing Gotchas (Electron 43.4.0 on Windows)
- **Never pass `pageSize` to `printToPDF`.** Any explicit size fails with `Failed to generate PDF: Printing failed`. Page size comes from the document's own CSS `@page` rule, passed with `preferCSSPageSize: true`.
- **Page size is in microns**, `INCH`/`MM` constants — `MM * 1000`. Printable margin in inches: use `marginType: 'none'`.
- **Do not `destroy()` a `BrowserWindow` and immediately reuse the name.** Either call strands later `loadURL` calls (`ERR_FAILED (-2)`). `printService` keeps one hidden window, closes it (never destroys) and loads each job from a temp file, serialising every job through a queue. If a load still fails it recycles the window and retries once.
- **A `close()`d window is not yet `isDestroyed()`.** `disposeWindow` must also null `sharedPrintWindow`, otherwise the next job reuses a window that is shutting down and burns a failed load + retry every time the app is re-activated.
- **Thermal height is measured from the rendered DOM**, not guessed: narrow the window to the printable width, read `scrollHeight`, then stamp a final `@page { size: <w>mm <h>mm }` rule. Measuring at the wide default viewport yields a wrong height because line wrapping changes.
- **Auto-print must not resolve silently.** The `'auto'` printer setting means "ask every time" — it opens the OS dialog and is never substituted with the Windows default.
- **Hidden windows must not block app quit.** `hasUserFacingWindows()` in `main.ts` excludes the print window from the quit check.
- Printable widths are 48mm on 58mm paper and 72mm on 80mm paper (the physical print-head widths of Epson-class 57.5mm / 79.5mm rolls). The shop mixes both — the paper size is a per-slot setting, not an app-wide constant.
- **58mm uses the same item table as 80mm, minus the DISC column.** The redesigned
  thermal receipt (migration 050, `receiptTemplates.ts` `buildRoll`) prints a real
  fixed-width `<table>` on both rolls, never stacked rows. 80mm is
  `# | PARTICULARS | QTY | RATE | DISC | AMOUNT`; 58mm drops DISC (merged into the
  totals block) and spells the second column `ITEM` because PARTICULARS cannot fit
  in 48mm. The DISC column is the only one that can exceed the printable width on a
  narrow roll, which is why it is physically absent there. Columns are explicit
  `<colgroup>` percentages with `table-layout: fixed`; nothing below 58mm content
  is measured.
- **Totals stack on BOTH rolls, never side-by-side.** Measuring the 80mm layout
  found the two-column totals (`CASH … | SUB TOTAL …`) putting the right table
  +11..+18px past the printable edge once a wide payment mode (EASYPAYSA /
  JAZZCASH) met a long NET TOTAL: flexbox `min-width:0` lets the item shrink below
  its table, and the table then bleeds off the page. `buildRoll` emits the payments
  block then the SUB TOTAL / DISCOUNT / NET block as full-width rows with
  right-aligned values. Verify with `npm run test:receipt`, whose layout audit would
  catch a regression.
- **Roll pages must stay portrait.** `resolveGeometry` floors the measured page height at `widthMm + 2`; if the height were ever shorter than the width the driver treats the page as landscape and rotates the receipt 90°.
- `setAdminSetting` is owner-gated, so background timers (auto-backup) must not use it — write system-managed keys directly.

### Label Studio labels (custom per-element templates)

Label Studio lets the owner draw a template (elements at mm coordinates) and print
it, but the renderer cannot print — `window.print()` is dead in Electron. The
template is therefore serialized over IPC and **rebuilt as HTML in the main
process** by `src/main/services/labelStudioPrinting.ts`:

- `printing:printBarcodeBatchWithOptions(ids, size, copies, options)` prints the
  per-element design when `options.template` is supplied, otherwise the stock
  `buildLabelJob` layout (Inventory / Barcode Generator quick labels). `options`
  also carries `printer`, `xOffset`/`yOffset` (mm), `mirror` and `rotation`.
- `{placeholders}` mirror the renderer preview: `{name} {price} {price_plain}
  {sku} {barcode} {expiry} {mfg} {batch} {weight} {approx} {shop} {category}
  {date} {qty} {unit} {image}`. `{mfg}`/`{batch}`/`{weight}` now resolve from the
  product's own `mfg_date`/`batch_no`/`net_weight` columns (migration 053) with a
  per-run override on top; price uses `printCurrency()` + the `decimal_places`
  setting. Barcodes reject a bogus EAN-13 and fall back to Code 128.
- **Image elements print a real image.** An `image` element carries either an
  uploaded data URL (picked from the PC via `ImageField`) or `{image}`, which binds
  to the product's own photo. Until 2.16 the printer emitted the literal text
  `IMG`, so a logo/photo silently vanished. Only safe sources are emitted
  (`data:image/*`, `http(s)`, `file:`, paths); anything else — e.g. `javascript:` —
  is dropped. `print_smoke` audits the job HTML for both.
- **`LABEL_SPECS` now carries the renderer's other stock sizes** (`40x30`, `50x25`,
  `58x40`, `60x40`) so they no longer silently fall back to 38x25, and an arbitrary
  "custom" size registers a one-off spec via `registerLabelSpec()` so the shared
  `geometryFromSpec` can lay out its roll page. The layout audit iterates
  `Object.keys(LABEL_SPECS)`, so every size is measured automatically.
- **Offsets / mirror / rotation are CSS, not driver options.** `webContents.print()`
  has no alignment controls, so offsets become `body{margin:…mm}` and mirror/rotation
  become a `transform`. A 90° rotation turns the *content* within the label, not the
  physical page — a true landscape label needs the printer driver to rotate.
- **PDF/PNG export returns a Node `Buffer`, which crosses IPC as a `Uint8Array`**
  (not a `Blob`). The renderer wraps it: `new Blob([new Uint8Array(result.data)])`.
  The shared type is `data?: Blob | Uint8Array`.
- `printCalibrationLabel(size)` prints one label-sized sheet (outline + mm ruler +
  TOP/LEFT/CENTER guides) so the owner can line the label stock up before a run.
- Verification: `npm run test:print` now audits the custom-template job too
  (`buildLabelStudioJob`) — page box, clipping, placeholder resolution, the
  image element (`<img>` + `{image}` + the `javascript:` guard), the
  PDF/PNG export bytes and the calibration sheet.

#### Multi-across rolls, per-run overrides, and the "Al Bagdad Grocery" template

A shop that buys a **2-across roll** (two labels side by side on one liner) needs
the printed page to be the combined width, not one label. The engine models this
with `PrintJob.labelCols`; `rollPageWidthMm()` returns `w*cols + gap*(cols-1)` and
`jobWidthMm()` uses it, so a 2-across 38mm roll gets a **78mm** page and the two
columns land where the stock expects. `rollColsFor()` caps it at 6 and ignores it
for sheet media. A half-used row is finished by starting at **column 2**
(`labelStartPos` / `template.startPos`); the builder emits empty `ls-fill` cells so
the first real label lands in column 2.

Two built-ins ship for this stock: `builtin-al-bagdad-38x28` ("Al Bagdad Grocery
(2-across)", `38x28`, `rollCols: 2`) and `builtin-al-bagdad-50x30`. The `38x28`
size is in `LABEL_SPECS` (`{w:38,h:28,sheetCols:4,gap:2}`) and in the renderer's
`PRESET_SIZES`; a custom template's `rollCols`/`startPos`/`options` round-trip
through `normalizeTemplate()`, and changing any layout control in the properties
panel persists onto the active template (cloning a built-in to a `custom-*` first).

- **Per-run overrides** live in `run` on the print options (`LabelRunOptions`), never
  on the template — `PrintRunModal` collects mfg date, expiry override, price source
  (retail / wholesale / custom), custom price, weight, barcode DPI, columns-across
  and start column; `doPrint()` forwards it as `options.run`, and the live preview
  reads the same object so preview and paper agree. The dialog's columns-across is
  applied by cloning the template in `doPrint` (built-ins are never mutated).
- **Date tokens** are per-element: `{mfg:d/m/yy}` vs `{expiry:dd/mm/yyyy}` on the
  same line are formatted independently. Tokens: `yyyy yy mm m dd d M` (short month).
  The resolver lives in the main process and is mirrored in the renderer
  (`pages/LabelStudio/format.ts`) so the preview is byte-for-byte the same string.
- **Product fields** back the placeholders: migration `053_label_product_fields.js`
  adds `products.net_weight`, `is_loose`, `mfg_date`, `batch_no` (surfaced in
  Inventory → Add/Edit Product). `{weight}` prints a `±` prefix when `is_loose` is
  set (or when the product is a scale/PLU item — a 5-digit `1xxxx` barcode, the same
  rule `scaleBarcode.listPluMappings()` uses) and the template option `showApprox` is
  on. When a product has no expiry and
  `hideDatesWhenNoExpiry` is on, a line carrying `{mfg}`/`{expiry}` is omitted
  entirely rather than printing a dangling "Mfg".
- **Barcode DPI** is a per-run value AND an admin setting (`barcode_dpi`, default
  203, in Settings → Printers & Paper → Barcode Labels). It only changes the raster
  `scale` fed to bwip-js; the element renders at a fixed height with `width:auto`, so
  changing DPI never stretches the bars.
- Template-picker / Template-Manager thumbnails come from `LabelThumbnail` (a cheap
  schematic SVG — bars for barcodes, rules for text — that never rasterises a real
  barcode).
- `print_smoke` covers all of it: a 6-label **2-across roll** (page 78×92mm = 3
  rows), per-run price/date/weight resolution, `start-at-column-2` filling, the `±`
  marker, date hiding, and a PNG of the exact roll for eyeballing.

### WhatsApp gateway (the `getChat` crash)

`whatsapp-web.js` injects the `window.WWebJS` object into the WhatsApp Web page
**once**, at startup. **WhatsApp Web reloads its own page now and then**, and a
reload wipes that object. Every later call that needs it dies — `sendMessage()`
evaluates `window.WWebJS.getChat(chatId, …)` inside the page, so with
`window.WWebJS` gone it throws:

```
Cannot read properties of undefined (reading 'getChat')
```

The **session is never broken** (it lives in `.wwebjs_auth` under `userData`),
which is why Settings still said "Connected" while every send failed. The cure is
to **re-inject, not to re-scan**: the shop owner must NOT have to scan the QR a
second time.

`src/main/whatsapp-gateway.ts` handles this:

- `isInjected(client)` — `typeof window.WWebJS !== "undefined"` in the live page.
- `ensureInjected()` — reconnects when the injection is gone (the saved session
  comes straight back, no QR).
- A **background health check** every 60 s re-links by itself after a reload, so
  the owner never hits the error at all.
- A **send retry**: a send that fails with the wiped-injection error reconnects
  once and retries — silently successful.
- `waitForReady(client)` — a reconnect waits for the page to be injected before
  anything is sent through it (`client.initialize()` returns *before* the
  `ready` event, so sending straight after a reconnect races the injection).
- The `disconnected` handler only clears state for the **current** client, so
  tearing down an old client during a reconnect cannot wipe the fresh one.
- Owner-facing errors go through `describeWhatsAppFailure()` in
  `src/shared/whatsappRecovery.ts` (pure, unit-tested by
  `npm run test:whatsappRecovery`).

Do **not** "fix" this by asking the owner to scan again — the session is fine.

### Receipt typography (thermal darkness / readability)

Thermal receipts were printing faint and smaller than competing POS receipts. The
rendering pipeline is Chromium → Windows printer driver (`webContents.print`), so
there is **no ESC/POS `setDensity`/heat command and no DPI/quality option** — the
head's darkness is a driver setting (Printer properties → Darkness/Heat = High,
economy off). The only levers in code are glyph weight, size and colour, because a
1-bit thermal head drops the grey anti-aliased edges of thin glyphs.

`buildRoll()` in `receiptTemplates.ts` prints with:
- A per-paper type scale in **px** (the render pipeline is a fixed 96dpi CSS space,
  so px is as deterministic as pt; geometry stays mm/pt): shop name 22px, address /
  contact / header lines 14px, meta + totals 13px, item rows 13px, column headers
  12px, NET TOTAL 17px, unit/promo 10px, footer 11px. The 58mm layout subtracts 2px
  from every size.
- `font-weight: 700` on all body text (800 for shop name / serial / money / NET
  TOTAL, 900 for NET TOTAL).
- pure `#000` everywhere (no `#333` greys, no green promo).
- `-webkit-text-stroke: 0.15pt #000` to thicken strokes on the thermal head.
- `Arial, Tahoma` first (solid bold) plus Urdu-capable fallbacks.

The `receipt_font_size` setting (Settings → Billing: small/normal/large) now actually
does something — it applies a `-2px / 0 / +2px` delta to that scale, so a shop can
tune the print without a rebuild.

The item table prints **money without the currency prefix** (the `Rs` is shown once, on
NET TOTAL): several `Rs ` prefixes plus the numeric columns do not fit the printable
width. The bug where QTY/RATE/AMOUNT ran together (`1 Piece Rs 550.00Rs 550.00`) is
prevented by `table-layout: fixed` + an explicit `<colgroup>`; the smoke test asserts
the column header is present and the layout audit asserts nothing crosses the
printable width. Both rolls now use that table (58mm drops DISC, see above). A money
string longer than 7 characters gets the `lg` class and drops one font step so a large
amount stays on one line, and `INV-YYYYMMDD-NNNN` degrades to `INV-MMDD-NNNN` rather
than wrapping.

Editable receipt content lives in migration `050_receipt_design.js`
(`receipt_header_lines` JSON array, `receipt_terms_text`, `receipt_software_by`,
`receipt_show_serial_number`), surfaced in Admin → System Settings → Billing. The old
`receipt_header_text` is no longer rendered at the top; the footer message is
`receipt_footer_text` (default "Come again soon!").

Run `npm run test:print` after any typography change; it measures real element boxes
against the printable width.

### Receipt Designer (phases 2–3)

Settings → **Receipt Designer** edits a JSON `ReceiptDesign` and previews it live.
The design is **opt-in**: `buildReceiptHtml` keeps using the shipped `buildRoll`
until `receipt_design_enabled` is true, so an existing install's receipts are
byte-identical until the owner clicks **Save & apply**. `defaultReceiptDesign()`
reproduces the shipped section order, so the first apply is a visual no-op.

- `src/shared/receiptDesign.ts` — the pure (dependency-free) model: `ReceiptDesign`
  (ordered `sections` + `global` + `table` + `branchOverrides`), block types
  (built-in sections incl. `return_banner`, custom
  `text`/`divider`/`image`/`barcode`/`spacer`/`two_col`/`banner`),
  `defaultReceiptDesign()`, `normalizeReceiptDesign()` (forward-compatible, drops
  unknown fields), `blockStyleCss()` and `applyTokens()`. **Phase 3** adds the
  template library: `ReceiptTemplateEntry` / `ReceiptLibrary`, `builtinTemplates()`
  (six shipped starting points), `defaultLibrary()` (built-ins, **no defaults set**),
  `normalizeLibrary()` (built-ins canonical, customs kept, junk dropped),
  `resolveLibraryDefault()` and `templateDesign()`. Imported by BOTH processes.
- `src/main/services/receiptDesigner.ts` — renders FROM a design.
  `buildDesignedReceiptAsync(sale, paper, design)` resolves QR/barcode data URLs
  (bwip-js via `printDocs.toDataUrl`) then renders; `buildSampleSale(settings, kind)`
  is the representative sample (long name + Kilogram unit + a discounted line; `kind:
  'return'` gives the negative return sample). Preview and print share this one
  builder, so they agree by construction. It reuses the shipped roll CSS/classes
  (`.lg` long-money shrink; 58mm removing the DISC **column** while the DISCOUNT
  **totals row** stays; one-line `.meta-dt`). Money is printed **plain** (no currency
  prefix) in the items/totals and the currency appears **once** on NET TOTAL — via
  `makePlainMoney()`, mirroring `buildRoll`'s `plain()`; the earlier double prefix
  (`Rs Rs …`) is fixed. `resolveAppliedDesign(paper, branchId?)` picks branch
  default → global default → the phase-2 applied design, and `renderAppliedReceipt`
  is what the print path uses.
- `migrations/055_receipt_designer.js` — seeds `receipt_design_enabled = 'false'`
  (the safety switch). `migrations/056_receipt_library.js` seeds an empty
  `receipt_design_library_json`; absent ⇒ built-ins with no defaults, so the phase-2
  applied design still drives printing until the owner sets a default.
- `src/renderer/src/pages/ReceiptDesigner.tsx` — the editor: section list
  (show/hide, ↑/↓ reorder, add/remove custom blocks), per-block properties
  (font size/bold/italic/align/uppercase/line-height/margins + the token list),
  items-table column toggles + widths, global options (base font, margins,
  currency symbol/position/decimals, date format, Urdu font), and a **live preview
  iframe** fed by `receipt:design:preview` (debounced) with a **Normal / Return
  sample** switch. **Phase 3** adds the template toolbar: pick a template, Save /
  Save As / Rename / Duplicate / Delete / Reset, **Set default** per paper (All
  branches or a specific branch), Import / Export JSON, **Undo / Redo**
  (Ctrl+Z / Ctrl+Y; also buttons — the keys are skipped while a field is focused so
  text inputs keep native undo), an **autosaved draft** (`localStorage`, restored
  with a notice), an **unsaved-changes prompt** on close/switch, and an
  **owner/admin-only gate** (`window.api.auth.currentUser().role !== 'cashier'`;
  a cashier sees a read-only notice and a disabled `<fieldset>`).
- IPC: `receipt:design:get|set|reset|preview` plus `receipt:library:get|set`
  (Phase 3) in `src/main/ipc.ts`, bridged in `preload.ts`
  (`window.api.receipt.*Design` / `getLibrary` / `setLibrary`). Saving goes through
  `setAdminSetting` (owner-gated) in both the design and the library paths.

Verify with `npm run test:receiptdesigner` (needs `build:main`): it renders the
designed receipt for 80mm and 58mm, reads the text back and measures every element
against the printable width (the same audit `print_smoke` runs), and covers the
conditional DISC column, hidden software credit, a custom text/divider block,
reordering, a QR block and the global options. Phase-3 checks add: currency printed
once (no double prefix, no prefix in item cells), the six built-ins, the
Return/Refund banner (only on a negative sale) + negative NET TOTAL, a custom
`banner` block, library normalisation/resolution, export→import round-trip, and that
a **library default drives the real print path** (`buildReceiptJobAsync`) only while
`receipt_design_enabled` is true.

### Receipt printing (phase 4)

Phase 4 turns the designer's output into a printer the shop can run a till on. Everything
is opt-in with a safe code default, so an install that never touches these controls keeps
the phase-3 behaviour.

- **The preview window** (`previewDocument`, `printService.ts`) is widened to
  `max(paperPx + 56, 480)` so the roll reads as a centred white sheet on a grey backdrop
  (`TOOLBAR_CSS` re-declares `html`/`body` backgrounds *after* the document CSS, so it wins
  on equal specificity), titled exactly **"Receipt preview"** — `win.setTitle()` is called
  *after* `loadDocument`, because the receipt's own `<title>Receipt</title>` otherwise
  overwrites it. The toolbar (injected with `executeJavaScript`, no preload needed) offers a
  copies box, **Print**, **Download PDF**, **WhatsApp** and **Close**; Enter = print and
  Esc = close unless a field/button already has focus. Print and Download PDF both run the
  *same* job (`printDocument` / `printJobToPdf`), so preview, paper and PDF cannot diverge.
  The WhatsApp button is only shown for a receipt preview (it needs the sale id) and calls
  `sendSaleReceiptOnWhatsApp` through a **dynamic `import()`** — the gateway pulls in the
  client + print stack, and `printing.ts` imports `printService`, so a static import would
  close a cycle.
- **`printing:printSale` / `printing:previewReceipt` now take `PrintSaleOptions`**
  (`{ copies?, duplicate?, kickDrawer? }`, declared once in `shared/types.ts` and re-exported
  from `printing.ts`). `previewReceipt` also sets the window title the spec pins.
- **Reprints are stamped.** `buildReceiptJobAsync(saleId, template, { duplicate: true })`
  threads a `duplicate` flag into both builders: `buildReceiptHtml(…, { duplicate })` renders
  a `.duplicate-banner` in `buildRoll`, and the designed path renders
  `<div class="duplicate-banner">DUPLICATE COPY</div>` from `renderDocument` (outside the
  design's own sections, so a stripped-down design still shows it). The stamp is gated by
  `receipt_duplicate_label` (default **on**; only an explicit `'false'` hides it). History
  reprints (`Billing.tsx` sale-detail "Reprint Receipt", the Ctrl+P "print last" action) pass
  `duplicate: true`; the immediate post-sale print never does.
- **"Reprint last receipt"**: `reprintLastReceipt()` reprints `admin_settings.last_printed_sale_id`,
  written **directly via `getDb()`** by `recordLastPrintedSale()` (not `setAdminSetting`,
  which is owner-gated — a cashier must be able to print). A **Reprint Last** button sits in
  the sale-success modal.
- **Copies**: `receipt_copies` (default 1, clamped 1–10) via `getReceiptCopies()`; a per-job
  `copies` override rides on the preview toolbar's copies box (`?copies=N`) and on
  `PrintSaleOptions`.
- **Cash-drawer kick**: `cash_drawer_kick` (default **off**, opt-in) via `cashDrawerKickEnabled()`.
  `printSale` kicks only on a successful **fresh** print (`kick = opts.kickDrawer ?? (!opts.duplicate && setting)`),
  never on a reprint, fire-and-forget so an unwired drawer cannot fail the print.
- **"Silent print to the system default printer"** is the `DEFAULT_PRINTER = 'default'`
  sentinel the owner picks in Settings → Printers. This deliberately does **not** change
  `AUTO_PRINTER = 'auto'` ("ask every time"): the app still never substitutes the Windows
  default for `auto` (file-output/`nul:`-port defaults caused save prompts and vanished jobs).
  `resolveTarget` prints silently with `deviceName: ''` only for the explicit sentinel.
- **"Cut command at end"** cannot be an ESC/POS cut: the pipeline is
  Chromium → Windows driver (`webContents.print`), which exposes no raw cut bytes. The safe
  substitute is that the roll page ends exactly at the measured content height (the driver's
  auto-cutter then fires at the page boundary) plus a configurable cut margin
  `receipt_bottom_feed_mm` (default **4**, clamped 0–30) read by `getReceiptBottomFeedMm()`.
  `getReceiptCopies`/`getReceiptBottomFeedMm` treat `safeAdminSetting`'s `''`-for-missing as
  "unset" — `Number('')` is `0`, which would silently turn the 4mm default into no feed.
- **Test print** from the designer: `receipt:design:test` → `printDesignSample(design, paper, copies)`
  prints the representative **sample** bill with the design currently on screen (including
  unsaved edits), so the owner can hold the roll next to the preview before saving.
- `migrations/059_receipt_print_settings.js` seeds `receipt_copies`, `cash_drawer_kick`,
  `receipt_duplicate_label`, `receipt_bottom_feed_mm`. Admin → System Settings → Billing
  exposes all four; Settings → Printers adds the "System default printer" option.
- `npm run test:receiptdesigner` now also covers: the shipped + designed duplicate stamp
  (present on a reprint, absent on an original, hidden by the toggle), and the copies/bottom-feed
  defaults and clamps. `npm run test:print` (138) and `npm run test:receipt` (68) still pass.

#### The printer pipeline's own rules (phase 4, items 4.9 - 4.16)

`npm run test:printPipeline` (**112 checks**) is the permanent guard. The rules it
pins — use these, do not write a second copy:

- **Which printer slot does a paper belong to?** `printerKeyForPaper(paper)` in
  `src/main/services/printService.ts`: a **ROLL** (58/80mm) → the **receipt**
  printer, a **SHEET** (A4/A5) → the **invoice** printer. The purchase-order
  service has its own `purchaseOrderPrinterKey()` (a different module, so it
  cannot import the engine's helper without a cycle). The old rules were
  `paper === 'a4' ? 'invoice' : 'receipt'`, so an **A5** order and the **A4
  calibration sheet** both went to the till's thermal printer.
- **The paper of a calibration sheet** is `resolveCalibrationPaper(paper?)`
  (`printing.ts`). **`'receipt'` is NOT a paper key** — the paper keys are
  `thermal58` / `thermal80` / `a4` / `a5` — so `'receipt'` means *"the receipt
  paper this shop uses"*. An unknown key must NEVER reach `PAPER_SPECS`
  (`PAPER_SPECS['receipt']` is `undefined`, and reading `spec.widthMm` threw
  the "Print Test Page" button away).
- **The label stock the shop configured IS the page that prints.**
  `resolveLabelSize()` accepts **every** size in `LABEL_SPECS` (eight of them),
  not three — anything else falls back to `38x25`.
- **The notes of a successful print are DATA.** `PrintResult.warnings?: string[]`.
  The engine used to glue them onto the success message, and the till screen
  only read the failure messages, so the owner never saw them.
- **A preview whose toolbar failed to inject is a FAILURE.** `injectToolbar()`
  rejects and `previewDocument()` awaits it — a preview with no Print / PDF /
  Close button is not a preview. Do not "just log it".
- **Every preview toolbar speaks the shop's language.** The labels are plumbed
  through the service → the IPC channel → the preload → the shared type → the
  renderer call site for the receipt, the invoice, the labels, the purchase
  order and the udhaar statement. English is the fallback for an old caller.
- **The forced "set a new owner password" screen may not race the app shell.**
  `App.tsx`'s `handleLogin()` fetches the flag **and** the landing page
  **before** `setUser()`, so the shell and the forced screen render in the
  same commit. A suite that must clear the screen **asks the service**
  (`window.api.auth.defaultPasswordActive()`) and waits for the screen to
  really be gone — "the login screen is gone" is true while the forced screen
  is still up. This cost `test:ui` two checks on a loaded machine.
- **The receipt-template metadata is `paper` + `contentMm`** (the printable
  width in mm). There has **never** been a `width` field — asking for one
  printed "Width: undefined" on the owner's screen.

