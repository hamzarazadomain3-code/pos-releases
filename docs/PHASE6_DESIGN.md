# PHASE 6 — BILLTEN GAP IMPLEMENTATION DESIGN

Baseline: 2.33.0 (main @ 6629afc). Scope: Section 19-20 of PLAN.md (verified code map).
This doc is the build plan; each milestone = migration (additive, guarded) + service
+ IPC + UI + permanent suite, all behind `multi_branch`/new feature flags where they
change core billing.

## M6.A — Verify (in flight)
The 103-suite battery runs now; every suite is judged by its OWN output markers.
Proofs land in `E:\temp\proof\battery2\suite_*.txt` + `battery_final.txt`.

## M6.B — Report toolkit + Stock Transaction ledger
Target: every report tab gets the Billten toolkit (column picker, paper, export),
and a per-item stock ledger screen (KPI cards: opening, purchase, purchase-return,
sale, sale-return, adjustment +/-, current; type chips; running balance).

1. `migrations/092_report_toolkit.js` — nothing to migrate (report prefs can live in
   `admin_settings`/localStorage). Guarded no-op that seeds defaults.
2. `src/main/services/reportToolkit.ts` — pure serializer/column-picker model
   (`ReportColumnDef`, `defaultColumnsFor(tab)`, `visibleColumns`, applied in the
   renderer only — read-only).
3. `src/main/services/stockLedger.ts` — `getStockLedger(productId, {from,to,types})`
   over `stock_movements` + `sale_items`/`purchase_items` joins for per-movement
   refs; running balance in base units; 8 KPI cards computed in one pass.
4. `src/renderer/src/pages/StockLedger.tsx` — KPI cards, type chips, date range,
   paginated rows, Excel/PDF export via existing `downloadBytes`/`exportReportExcel`.
5. IPC: `stockLedger:get`, `stockLedger:kpis`. Preload + types.
6. Suite `scripts/test_stockLedger.cjs` — seeds a sale, a purchase, a return, an
   adjustment; asserts the ledger rows + the running balance + the KPI totals equal
   the DB sums (the 0.4 cross-screen numbering rule).
7. Column picker on `Reports.tsx` tabs (read-only presentation; no saved prefs).

## M6.C — Purchase Return + Payment Out + bulk Payment In
1. Migration `093_purchase_returns.js`:
   - `purchase_returns(id, purchase_order_id, supplier_id, invoice_no UNIQUE, total,
     reason, returned_at, user_id, branch_id, created_at)`
   - `purchase_return_items(id, purchase_return_id, purchase_item_id, product_id,
     qty, unit_price, cost_price, line_total)`
   - `payments` gains `ref_type` ('sale'|'purchase_return'|'payment_out'|
     'payment_in') + `ref_id` (additive; existing sale rows keep NULL → treated as
     'sale').
2. `src/main/services/purchaseReturns.ts` — create return over REVERSED FIFO
   (return the batch FIFO picked first), restock at cost, reduce supplier payable
   (ledger in `suppliers`/payments), refund to payment mode; `listPurchaseReturns`,
   `getPurchaseReturn`. Enforce: cannot return more than the received qty per line.
3. `src/main/services/paymentOut.ts` — supplier payment-out (cash/bank), records to
   `payments(ref_type='payment_out')`, updates supplier payable ledger.
4. `src/main/services/paymentIn.ts` — bulk payment-in by AREA (new `areas` master):
   `areas(id,name)`, `customers.area_id` (additive column); list customers of an
   area, apply one payment mode to all, one named batch.
5. IPC: `purchaseReturns:create|list|get`, `payments:out|bulkIn`. UI pages under
   Purchases (return tab) + Udhaar (bulk collect) + Transfers (payment out).
6. Suites: `test:purchaseReturns` (FIFO reversal, restock, over-return block),
   `test:bulkPaymentIn` (area → one mode → ledger moves), `test:paymentOut`
   (supplier payable drops, drawer/mode correct).

## M6.D — Product data model depth
1. Migration `094_product_dimensions.js` (additive) + master tables:
   - `companies(id,name)` ; `products.company_id`
   - `sub_categories(id,category_id,name)` ; `products.sub_category_id`
   - `product_groups(id,name,barcode)` + `product_group_items(group_id,product_id,
     qty)` — bundle barcode on sale expands to items.
   - extend `taxes` to a **Tax Group**: `tax_groups(id,name,rates_json =
     [{rate_name, rate, inclusive}])` ; `products.tax_group_id` (keeps legacy
     `tax_rate` as the primary; group overrides only when set).
   - `units` master richer UI (already have `units` table + `flexible_units`).
2. Inventory Add/Edit gains company, sub-category, group, tax-group pickers
   (existing themed components; no raw HTML).
3. Bundle sale expands to component lines (stock down on each), priced at group
   price; `promotions`/reports still see the bundle header.
4. Suites: `test:productDimensions` (masters + columns + bundle expansion + legacy
   rows keep working), `test:taxGroups` (group applied to a bill, inclusive vs
   exclusive, receipt line).

## M6.E — Warehouses (multi-stock) + IMEI/serial
1. Migration `095_warehouses.js`:
   - `warehouses(id,name,is_default)` ; `products` gets stock per warehouse via a
     new `product_warehouse_stock(product_id, warehouse_id, qty)` table; `stock_qty`
     stays the "available across all" rollup (SUM) for backward compatibility.
   - `warehouse_transfers(id, from_warehouse_id, to_warehouse_id, note, created_at,
     user_id)` + `items`.
   - `serial_numbers(serial, product_id, warehouse_id, status, sale_item_id NULL)`
     — IMEI/serial per unit; sold serials bind to the sale_item; returns release.
2. Services: `warehouses.ts` (CRUD + transfer + rollup), `serials.ts` (assign, sell,
   return, lookup report). Wire into Billing only when `multi_branch` (feature
   flag) — retail users see no change.
3. Suites: `test:warehouses` (transfer moves rollup, per-warehouse report ticks),
   `test:serials` (sell binds, return releases, duplicate serial refused).

## M6.F — Billing UX (sale-settings drawer + add-from-sale + shortcut coverage)
1. `src/renderer/src/components/SaleSettingsDrawer.tsx` — searchable toggles
   (10.1 #2 list), reading/writing ONE settings store (rule 0.8), per-user.
2. Add Product modal launchable from the Billing grid (barcode gen, company/
   category quick-add, base+primary unit + conversion, wholesale + min qty,
   tax inclusive/exclusive) — reuse the Inventory modal, portable.
3. Extend `src/shared/shortcuts.ts` registry: F2/F4..F10 + Alt+I/D/C/T/P/A/R,
   Ctrl+P pay-full, only when unbound, tooltips on buttons, a cheat-sheet screen.
4. Suites: `test:saleSettingsDrawer` (toggle hides column, persists per user),
   `test:billingAddFromSale` (modal from grid creates product, cart keeps line),
   `test:shortcuts` extended (new combos, no clash).

## M6.G — Smart PO quantity methods
1. `src/shared/purchaseCalc.ts` gains `suggestQuantity(line, method, history)`:
   Manual / By Sales (avg daily × lead time) / By Duration / By Min Stock /
   By Max Stock; `src/main/services/purchases.ts` `calculatePoQuantities(poId)`
   uses the real sale history + supplier purchase history.
2. PO modal shows "Calculate Qty" per method, preview, apply.
3. Suite `test:smartPo` (each method against seeded history, clamped ≥ 0).
