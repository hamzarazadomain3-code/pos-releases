# CHANGELOG

Newest first. Phase 0 entries cite the master-prompt item number. A DONE entry
means code + a regression test + a saved proof run.

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
