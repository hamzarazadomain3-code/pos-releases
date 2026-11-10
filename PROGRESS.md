# PROGRESS.md — Strict Build Run 13

One row per work item. Status is DONE only with code + a test that imports real `dist` code, a saved proof file, exit-0 typecheck/build, and a commit hash.

| Item | Status | Scope | File:line | Test / proof | Commit |
|------|--------|-------|-----------|--------------|--------|
| A — Item 4: shared "Today" | PARTIAL | businessDayBounds in getDailyStats, getDailySalesTrend, getTopProducts, dashboard(), Reports, Returns; fixed-instant tests | src/main/services/reports.ts, returns.ts | proof/a_today.txt | — |
| B — Item 5: roles, void rule, shortcuts | PARTIAL | cashier-session tests for all 5 history reads; void footer; remove F5/Ctrl+R; OWNER DECISION | src/main/services/salesHistory.ts, Billing.tsx | proof/b_roles.txt | — |
| C — Item 6 gaps | PARTIAL | live re-evaluation/badge, stacking, fixed split, saved source, History/Detail/receipt, customer list/filter, activity log, owner-only edit, full test set | src/shared/customerDiscount.ts, Billing.tsx, customers.ts | proof/c_discount.txt | — |
| D — pure logic first | NOT STARTED | escapeGesture.ts, billEdit.ts, customer combobox filter, quick-customer validation/duplicate check + tests | src/shared/* | proof/d_pure.txt | — |
| E — Items 7–10 UI wiring | NOT STARTED | quick customer dialog, F6 combobox, Esc gesture/usePageRefresh, Pause/F4 bill edit; registry actions | src/renderer/src/*, src/shared/shortcuts.ts | proof/e_ui.txt | — |
| F — proof and honest report | NOT STARTED | dateparse 22→21 from git log -p; all suites with saved proof; real test:print error; REPORT.md | REPORT.md | proof/*.txt | — |
