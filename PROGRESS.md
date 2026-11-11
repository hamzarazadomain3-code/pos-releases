# PROGRESS.md — Strict Build Run 13

One row per work item. Status is DONE only with code + a test that imports real `dist` code, a saved proof file, exit-0 typecheck/build, and a commit hash.

| Item | Status | Scope | File:line | Test / proof | Commit |
|------|--------|-------|-----------|--------------|--------|
| A — Item 4: shared "Today" | DONE | `resolveBusinessRange` in shared/salesHistory.ts:311 wired into reports.ts:154/419/443/471/488 and returns.ts:445/541; DST-safe bounds | `test:businessDay` 13/13; `test:dashboardPeriod` 11/11; `test:salesHistory` 22/22 | E:\temp\proof\a_today.txt | bf46148 |
| B — Item 5: roles, void rule, shortcuts | PARTIAL (server DONE; footer UI no test) | cashier tests for list/summary/counts/detail/print at salesHistory.ts:269/309/338/469/531; snapshot strip; `history` guard + footer Billing.tsx:1222/3929; owner decision pending REPORT | `test:historyRoles` 7/7, `test:salesHistory` 22/22 | E:\temp\proof\b_roles.txt | b28f7c6 |
| C — Item 6 gaps | DONE (UI pieces PARTIAL) | `src/shared/customerDiscount.ts` (compute/stack/split/badge/refund-share); `migrations/076_discount_source.js`; sales.ts:186 saves source; customers.ts:206 owner/manager gate + activity log; Billing badge/live re-eval; Udhaar Discount column + filter; receipt "Customer discount 5%" row | `test:customerDiscountModel` 29/29; `test:customerDiscount` 12/12; `test:salesHistory` 22/22; `test:return` 29/29; `test:receipt` 68/68 | E:\temp\proof\c_discount.txt | 5b1e002 |
| D — pure logic first | DONE | `src/shared/escapeGesture.ts`, `billEdit.ts`, `customerSearch.ts`, `quickCustomer.ts` | `test:run13Pure` 39/39 | E:\temp\proof\d_pure.txt | 5fa73e4 |
| E — Items 7–10 UI wiring | PARTIAL (logic DONE, rendering no test: UI) | CustomerCombobox.tsx, QuickCustomerDialog.tsx, escapeRefresh.ts + KeyboardProvider.tsx Esc, Billing.tsx Pause mode, Settings.tsx Esc toggle, registry `customer_search`=F6 / `bill_focus`=Pause+F4 | `test:shortcuts` 37/37; `test:run13Pure` 39/39 | E:\temp\proof\d_shortcuts.txt | 5fa73e4, bb330a0 |
| F — proof and honest report | DONE | `REPORT.md` "Strict run 13"; `scripts/print_smoke.js:303` PLU fixture no longer collides | 32 suites, all exit 0 (dateparse 22, print 138/138); typecheck+build exit 0 | E:\temp\proof\suite_*.txt | (commit below) |
