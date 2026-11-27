# CHANGELOG

Newest first. Phase 0 entries cite the master-prompt item number; the Phase 1
entries cite the phase item number. A DONE entry means code + a regression test
+ a saved proof run.

## Phase 3 — the purchase-order screen (2026-11-27, baseline v2.32.0)

- **3.1** The purchase catalog now carries the **units** and the **last
  purchase cost** — and it carries them for EVERY product, not only the
  low-stock ones (a product that was not low on stock showed no unit
  dropdown at all).
- **3.2** **Backspace no longer deletes a purchase row.** It used to wipe the
  line the owner was typing in; `Delete` removes a row only when the focus is
  not inside a text field.
- **3.3** A receipt is addressed to a **LINE** (`item_id`), never to a
  product — an order with two lines of the same product used to receive the
  requested quantity **twice** (more stock than the shop paid for).
- **3.4** An import can no longer be **undone after the goods were
  received** — the undo used to take the stock back off the shelf while the
  goods were physically there.
- **3.5** The purchase permission is enforced **in the service** — a cashier
  can no longer create, receive, cancel or pay a purchase order through the
  IPC, even though the sidebar already hid the page from them.
- **3.6** The service now applies the **same money rules the screen always
  had** (a negative freight, a discount above 100 %, a negative tax and a
  paid-now amount above the order total are refused) — and a refused order
  leaves nothing behind.
- **3.7** A **received** order can no longer be cancelled — the purchase row
  used to become "cancelled" while the stock stayed on the shelf.
- **3.8** The legacy `quantity_received` rows are read correctly again — the
  new `received_qty` column exists and holds 0, so the old rows used to read
  as "nothing received" while the goods were on the shelf. Migration `091`
  backfills them in place.
- **3.9** A purchase order now carries the **branch** it was made at (header
  and every line) and its `updated_at` moves on every write.
- **3.10** The "Stock received" note belongs to its own order — it no longer
  shows above a different order.
- **3.11** The **Purchases screen, the PO modal and the import wizard are
  bilingual** (English + Urdu) — they were hard-coded English.
- **3.12** A **batch number IS a batch**: two lines of the same product can
  no longer land on one batch, and a second receipt adds to the existing
  batch instead of creating a twin.
  `npm run test:purchaseOrderHardening` **60/60** and
  `npm run test:purchaseOrderUi` **81/81**. Proof:
  `E:\temp\proof\p3_regr_purchaseOrderHardening.txt`,
  `E:\temp\proof\p3_purchaseOrderUi.txt`.

## Phase 2 — the receipt designer + the template library (2026-11-27, baseline v2.32.0)

**Verified phase — no source file changed.** The designer, the library, the
migrations and the permanent suites were already in the tree; this phase
checked every promise of the phase against the real code and re-ran the
suites.

- The receipt design stays **opt-in** (`receipt_design_enabled = 'false'`):
  an install that never opens the designer prints byte-identical receipts,
  and the **first apply is a visual no-op**.
- The **preview and the paper** are built by the same builder, so they cannot
  disagree; the **money is printed once** (no `Rs Rs`, no currency prefix in
  the item cells).
- The **58 mm roll drops the DISC column** (the DISCOUNT totals row stays),
  and the layout audit proves that **nothing escapes the printable width** on
  either roll.
- The **template library** ships with 8 built-ins and **no default set** (the
  owner's choice), the branch default beats the global one, junk in a
  hand-edited library is dropped instead of breaking the print, and
  export → import round-trips exactly.
  `npm run test:receiptdesigner` **73/73**, `npm run test:receipt` **68/68**,
  `npm run test:print` **138/138**. Proof: `E:\temp\proof\p2_*.txt`.

## Phase 1 — the product / inventory data model (2026-11-27, baseline v2.32.0)


- **1.1** A refused stock adjustment no longer destroys the batch stock — the
  FIFO deduction is all-or-nothing (the batches are given back before the
  error) and the manual adjustment runs inside a savepoint.
- **1.2** A bill with two lines of the SAME product now records its OWN FIFO
  allocations — the allocations used to live in a map keyed by product, so the
  second line overwrote the first and the ledger named the wrong batch.
- **1.3** The batches remember what they received (`quantity_received`) — it
  stayed 0, so the FIFO Stock Report showed every real batch as empty.
- **1.4** Returning a line RELEASES its FIFO allocation — the shelf and the
  FIFO report now agree.
- **1.5** The expiry rule is ONE rule (`src/shared/expiry.ts`): expired means
  BEFORE today, so the till and the inventory report can no longer disagree
  about a product that expires today.
- **1.6** An expired BATCH is never sold — FIFO skips it, a line that only
  expired stock could cover is blocked (a manager may still approve it), and
  the bill amendment refuses to add expired stock too.
- **1.7** A quotation conversion obeys the stock rules — it used to decrement
  the stock directly, with no negative-stock refusal, no FIFO and no expiry
  check.
- **1.8** The stock ledger records WHO moved the stock and from WHICH branch —
  every sale, purchase, return, void, audit correction and manual adjustment
  used to be an anonymous line.
- **1.9** The two inventory-report queries that selected a column which never
  existed (`pi.quantity_ordered`) run again — the Purchase History and the
  Product Purchase Summary panels were dead.
- **1.10** The purchase line snapshot is COMPLETE — the unit name, the line
  total and the legacy batch/received columns are written, so the
  purchase-expiry alert sees a normal purchase.
- **1.11** The purchase import writes `quantity_received` and stores the batch
  number it generated — the undo used to delete nothing (the batch survived)
  and took off only the purchase quantity instead of the base quantity.
- **1.12** ONE unit-conversion rule (`src/shared/units.ts`, base units, the
  app's 3-decimal stock precision): the import wizard resolves the file's
  `unit` column against the product's own units, so "2 box" of a 12-piece box
  puts 24 pieces on the shelf — and the undo takes all 24 off again.
  `npm run test:inventoryModel` **70/70**. Proof:
  `E:\temp\proof\p1_inventoryModel_out.txt`.

## Phase 0 — Stabilize (2026-11-26, baseline v2.32.0)

- **0.1** Reports ▸ Profitability (all sub-tabs) and Inventory ▸ Monthly —
  verified green: every query uses `sale_items.unit_price` (no `si.price`
  remains anywhere in `src/`); `npm run test:audit` 48/48 (includes the schema
  assertions) and `scripts/test_inventoryReports.js` 12/12 (revenue 150,
  COGS 90, gross profit 60). No code change was needed — the A6 fix is already
  in the tree. Proof: `E:\temp\proof\p0_0.1_audit.txt`,
  `E:\temp\proof\p0_0.1_inventoryReports.txt`.
- **0.2** Raw IPC errors no longer reach the user — every one of the 384
  `ipcMain.handle` calls goes through the new `src/main/ipcError.ts` boundary:
  a validation message is passed through unchanged, an internal failure
  (SQLite / TypeError / network) becomes a bilingual friendly message plus an
  `errorId` (`E-YYMMDDHHMMSS-XXXX`) and a full stack in a log file.
  `npm run test:ipcError` **38/38**. Proof: `E:\temp\proof\p0_0.2_ipcError.txt`.
- **0.3** The "today" leak is closed — no screen uses `new Date().toISOString()`
  for a business date any more; the local helpers own it and the Z-report runs
  on the business-day range (start hour + timezone).
  `npm run test:timezone` **16/16**. Proof: `E:\temp\proof\p0_0.3_timezone.txt`.
- **0.4** One resolver for the business day — the new shared
  `businessDayWhere()` drives the daily closing, the sales list and the expense
  summary, so the three screens can no longer disagree.
  `npm run test:unified` **11/11**. Proof: `E:\temp\proof\p0_0.4_unified.txt`.
- **0.5** A shift that has been open for more than 24 hours is blocked, and a
  20-hour shift writes a `shift_long_open` audit row (a forced close still
  needs a manager and a reason). `npm run test:shifts` **14/14**.
  Proof: `E:\temp\proof\p0_0.5_out.txt`.
- **0.6** The mojibake is gone — 50 broken sequences in the reports, the
  inventory and the shared types are real UTF-8 again, and a permanent scan
  (`npm run test:utf8`) keeps them out. Proof: `E:\temp\proof\p0_0.6_utf8.txt`.
- **0.7** Negative stock stays blocked — the rule is enforced in BOTH sale
  paths (the normal sale and the bill amendment); re-verified, no code change.
  `scripts/test_negative_stock.js` **31/31**. Proof: `E:\temp\proof\p0_0.7_out.txt`.
- **0.8** The one settings bridge holds — the shared rules own the 10
  duplicated keys (newest explicit value wins, the write is logged) and the
  regression test pins them; re-verified, no code change.
  `npm run test:settingsbridge` **16/16**.
  Proof: `E:\temp\proof\p0_0.8_settingsbridge.txt`.
- **0.9** Expired stock can no longer be sold by accident — an expired line is
  blocked, a manager (owner/manager) can override it with a PIN and a reason,
  and every override is written to the activity log.
  `npm run test:expired` **15/15**. Proof: `E:\temp\proof\p0_0.9_expired.txt`.
- **0.10** The receipt columns and the totals are unchanged and still correct —
  re-verified, no code change. `npm run test:receipt` **68/68** and
  `npm run test:receiptdesigner` **73/73**. Proofs:
  `E:\temp\proof\p0_0.10_receipt.txt`, `E:\temp\proof\p0_0.10_designer.txt`.
- **0.11** Every date field shows one format — the themed calendar and the one
  formatter are used on every screen; re-verified, no code change.
  `npm run test:calendar` **64/64** and `npm run test:dateCalendarUi` **38/38**.
  Proofs: `E:\temp\proof\p0_0.11_calendar.txt`,
  `E:\temp\proof\p0_0.11_dateCalendarUi.txt`.
- **0.12** An abandoned audit can be thrown away — the owner-only
  `audits:discard` deletes the audit and its items and writes the
  `audit_discarded` log row; the screen got the Discard button.
  `npm run test:audits` **13/13**. Proof: `E:\temp\proof\p0_0.12_out.txt`.
- **0.13** The duplicate alerts stay away — re-verified, no code change.
  `npm run test:alerts` **5/5**. Proof: `E:\temp\proof\p0_0.13_alerts.txt`.
- **0.14** The four UI defects are fixed in the real renderer — an empty cart
  no longer shows a live-looking "Pay & Save" (it says the cart is empty and
  is dimmed), the PO supplier dropdown asks what to do with the lines that
  belong to the old supplier, the same product can never sit on two rows (the
  cart's Undo and the PO's per-row cell both merge the quantity), and the
  minimized card stays above the assistant drawer instead of hiding behind it.
  `npm run test:ui` **30/30** (+ 6 screenshots). Proof:
  `E:\temp\proof\p0_0.14_out.txt`.
- **0.15** The credentials are encrypted at rest — the new
  `src/main/services/secretVault.ts` stores the 5 SMTP/SMS/WhatsApp secrets
  through the OS key store (`safeStorage`, `enc:v1:` marker) and decrypts them
  only where a service needs them; the legacy plain values are migrated on the
  first read, and a value that cannot be decrypted reads as empty (never the
  cipher text). The password policy is now ENFORCED (length + uppercase +
  numbers + special, with the PIN exempt), not only read.
  `npm run test:security` **24/24**. Proof: `E:\temp\proof\p0_0.15_out.txt`.
