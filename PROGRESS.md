# PROGRESS.md — Strict Build Run 13

One row per work item. Status is DONE only with code + a test that imports real `dist` code, a saved proof file, exit-0 typecheck/build, and a commit hash.

| Item | Status | Scope | File:line | Test / proof | Commit |
|------|--------|-------|-----------|--------------|--------|
| A — Item 4: shared "Today" | DONE | `resolveBusinessRange` in shared/salesHistory.ts:311 wired into reports.ts:154/419/443/471/488 and returns.ts:445/541; DST-safe bounds | `test:businessDay` 13/13; `test:dashboardPeriod` 11/11; `test:salesHistory` 22/22 | E:\temp\proof\a_today.txt | bf46148 |
| B — Item 5: roles, void rule, shortcuts | PARTIAL (server DONE; footer UI no test) | cashier tests for list/summary/counts/detail/print at salesHistory.ts:269/309/338/469/531; snapshot strip; `history` guard + footer Billing.tsx:1222/3929; owner decision pending REPORT | `test:historyRoles` 7/7, `test:salesHistory` 22/22 | E:\temp\proof\b_roles.txt | b28f7c6 |
| C — Item 6 gaps | DONE (UI pieces PARTIAL) | `src/shared/customerDiscount.ts` (compute/stack/split/badge/refund-share); `migrations/076_discount_source.js`; sales.ts:186 saves source; customers.ts:206 owner/manager gate + activity log; Billing badge/live re-eval; Udhaar Discount column + filter; receipt "Customer discount 5%" row | `test:customerDiscountModel` 29/29; `test:customerDiscount` 12/12; `test:salesHistory` 22/22; `test:return` 29/29; `test:receipt` 68/68 | E:\temp\proof\c_discount.txt | 5b1e002 |
| D — pure logic first | NOT STARTED | escapeGesture.ts, billEdit.ts, customer combobox filter, quick-customer validation/duplicate check + tests | src/shared/* | proof/d_pure.txt | — |
| E — Items 7–10 UI wiring | NOT STARTED | quick customer dialog, F6 combobox, Esc gesture/usePageRefresh, Pause/F4 bill edit; registry actions | src/renderer/src/*, src/shared/shortcuts.ts | proof/e_ui.txt | — |
| F — proof and honest report | NOT STARTED | dateparse 22→21 from git log -p; all suites with saved proof; real test:print error; REPORT.md | REPORT.md | proof/*.txt | — |
