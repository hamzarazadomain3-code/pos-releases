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
