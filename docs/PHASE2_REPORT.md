# PHASE 2 REPORT — Rokar POS (the receipt designer + the template library)

**Run date:** 2026-11-27
**Baseline:** `v2.32.0` (`main` @ `04c2b71`, unpushed) — Phase 0 and Phase 1 are committed
**Scope:** `E:\antigravty\billing softwere\pos-app` only
**Proofs:** `E:\temp\proof\p2_*` (every claim below has a saved output)
**Phase:** 2 of the master-prompt run (Phase 0 → 5)

---

## 1. Summary

Phase 2 is the **receipt designer** — the screen where the shop decides what
its receipt looks like — and the **template library** that lets the owner
keep more than one design (a compact 80 mm roll for the bakery counter, a
detailed invoice for the month-end, a return slip, and so on).

**The honest headline: Phase 2 needed NO new code.** The designer, the
library, the migrations, the IPC surface and the permanent suites were
**already in the tree** from the earlier runs (the receipt redesign, the
"Receipt Designer (phases 2–3)" work recorded in `AGENTS.md`). This phase
therefore did exactly what a phase must do before it can be called DONE:
it **verified every promise of the phase against the real code**, re-ran the
permanent suites, and wrote the evidence down.

**Eight promises, all verified:**

| # | The promise | Verified by |
|---|---|---|
| 2.1 | the design is **opt-in** — an install that never touches it prints byte-identical receipts | `receipt_design_enabled = 'false'` (migration 055) + the print-path test |
| 2.2 | the **first apply is a visual no-op** — the default design reproduces the shipped receipt | `defaultReceiptDesign()` + the section-order test |
| 2.3 | **one model, two processes** — the renderer and the main process share the same pure module | `src/shared/receiptDesign.ts` is imported by both |
| 2.4 | the **preview and the paper agree** — they share one builder | `buildDesignedReceiptAsync()` serves both |
| 2.5 | the **money is printed once** — no `Rs Rs`, no currency prefix in the item cells | the NET TOTAL assertion |
| 2.6 | the **58 mm roll drops the DISC column** but keeps the DISCOUNT totals row | the 58 mm layout audit |
| 2.7 | the **library is a library** — 8 built-ins, **no default set**, the branch default beats the global one, the junk is dropped, export → import round-trips | the library checks |
| 2.8 | **nothing escapes the printable width** — on the 80 mm AND the 58 mm roll | the layout audit (the same audit `test:print` runs) |

---

## 2. The items

### 2.1 — the design is opt-in (the safety switch)

**Root cause (found).** The designer replaces the shipped receipt, so if it
were on by default every existing shop's receipts would change the day the
app updated. The tree already had the safe answer: migration
`055_receipt_designer.js` seeds `receipt_design_enabled = 'false'`, and
`buildReceiptHtml()` keeps using the shipped `buildRoll` until the owner
clicks **Save & apply**.

**Verification.** The print path reads the switch; the designer's suite
proves that a **library default drives the real print path** only while the
switch is on. An install that never opens the designer is untouched.

### 2.2 — the first apply is a visual no-op

**Root cause (found).** A designer whose default layout differs from the
shipped receipt would make the owner's first click a surprise — the receipts
would change without the owner asking.

**Verification.** `defaultReceiptDesign()` reproduces the shipped section
order, and the suite asserts the section list the default carries.

### 2.3 — one model, two processes

**Root cause (found).** A design is edited in the renderer and printed in the
main process. Two copies of the model would drift, and the preview would stop
matching the paper.

**Verification.** The model lives in `src/shared/receiptDesign.ts` (pure, no
Electron import) and is imported by **both** processes:
`defaultReceiptDesign()`, `normalizeReceiptDesign()` (forward-compatible —
it drops unknown fields), `blockStyleCss()` and `applyTokens()`.

### 2.4 — the preview and the paper agree

**Root cause (found).** A preview built by one code path and the paper built
by another can disagree — the classic "it looked right on screen" bug.

**Verification.** `buildDesignedReceiptAsync(sale, paper, design)` resolves
the QR / barcode data URLs and then renders; the preview and the print job
both call it, so they agree by construction. The print path resolves the
design through `resolveAppliedDesign(paper, branchId?)` — **branch default →
global default → the applied design**.

### 2.5 — the money is printed once

**Root cause (found).** The earlier shipped roll prints the money **plain**
in the item rows and shows the currency **once**, on NET TOTAL. The designed
path used to prefix every cell, which produced `Rs Rs …` and a line that did
not fit the roll.

**Verification.** The designed path uses `makePlainMoney()` (the same rule as
`buildRoll`'s `plain()`), and the suite asserts the currency appears exactly
once in the NET TOTAL row and never in the item cells.

### 2.6 — the 58 mm roll drops the DISC column

**Root cause (found).** 58 mm paper has a 48 mm printable width; the DISC
column does not fit there. It is physically absent on that roll — but the
**DISCOUNT totals row stays** (the discount is still in the totals block).

**Verification.** The layout audit measures every element against the
printable width of **both** rolls: "no element escapes the 80 mm printable
width" and "no element escapes the 58 mm printable width".

### 2.7 — the template library

**Root cause (found).** A single design is not enough for a shop that prints
a roll at the counter and an invoice at the month end. The library has to
survive a restart, a hand-edited JSON file and a round-trip through a file.

**Verification.** The library is a plain JSON document in
`admin_settings` (migration `056_receipt_library.js` seeds it empty, so
**absent ⇒ the built-ins with NO default set** — the opt-in rule again):

- **8 built-in templates**, each flagged `builtin`.
- **No default is set** in the shipped library — the owner chooses one.
- `normalizeLibrary()` keeps the built-ins canonical, keeps a valid custom
  template, **drops a spoofed built-in id**, **drops a default that points at
  a missing template**, and keeps a default that points at a valid custom.
- `resolveLibraryDefault()` — the **branch** default wins over the **global**
  default; with no branch default the global one is used; with nothing set
  the answer is `undefined` (no default — the applied design drives the print).
- **Export → import round-trips** the template ids and the defaults exactly.
- The built-ins cover the real shop needs: a compact 80 mm (the header note
  hidden), a detailed 80 mm (the TAX column enabled), the **return / refund**
  slip (the banner + the negative NET TOTAL, and it fits the 80 mm width),
  the **bakery** design, and the rest.

### 2.8 — nothing escapes the printable width

**Root cause (found).** A receipt that arrives sliced is the single most
visible print defect, and a page-size check alone cannot see it.

**Verification.** The designer suite runs the **same layout audit** the
`test:print` geometry suite runs: it measures every real element box in the
laid-out page against the printable width and fails when anything crosses
it — on the 80 mm roll, on the 58 mm roll, on the return slip and on the
bakery design.

---

## 3. Files

### Phase 2 changed no source file

The phase was a **verification** phase: the code was already in the tree and
correctly guarded. The files below are the ones the phase *proves*, not the
ones the phase wrote:

| File | What it is |
|---|---|
| `src/shared/receiptDesign.ts` | the pure design model + the library model (imported by both processes) |
| `src/main/services/receiptDesigner.ts` | renders **from** a design; `resolveAppliedDesign()`; the sample bill |
| `src/renderer/src/pages/ReceiptDesigner.tsx` | the editor + the template toolbar (Save / Save As / Rename / Duplicate / Delete / Reset, Set default per paper, Import / Export, Undo / Redo, the autosaved draft, the owner/admin gate) |
| `migrations/055_receipt_designer.js` | seeds `receipt_design_enabled = 'false'` — the safety switch |
| `migrations/056_receipt_library.js` | seeds an empty library — absent ⇒ built-ins, no default |
| `src/main/ipc.ts` / `src/preload/preload.ts` | `receipt:design:get|set|reset|preview|test`, `receipt:library:get|set` |

---

## 4. Test evidence

### The permanent suites (re-run in this phase)

| Suite | Result | Proof |
|---|---|---|
| `npm run test:receiptdesigner` | **73/73** | `E:\temp\proof\p2_receiptdesigner.txt` |
| `npm run test:receipt` | **68/68** | `E:\temp\proof\p2_receipt.txt` |

### What the two suites between them prove

| Promise | The checks that carry it |
|---|---|
| 2.1 the opt-in switch | the library default drives the real print path **only** while `receipt_design_enabled` is on |
| 2.2 the no-op first apply | the default design's section order matches the shipped receipt |
| 2.3 one model, two processes | the pure module is imported by both processes; `normalizeReceiptDesign()` drops the unknown fields |
| 2.4 preview = paper | one builder (`buildDesignedReceiptAsync`) serves both |
| 2.5 the money is printed once | "NET TOTAL prints the currency exactly once"; no prefix in the item cells |
| 2.6 the 58 mm roll | "no element escapes the 58 mm printable width"; the DISC column is gone, the DISCOUNT totals row stays |
| 2.7 the library | 8 built-ins; no default set; the normalisation checks; the branch-beats-global resolution; the export → import round-trip |
| 2.8 the layout audit | the 80 mm, the 58 mm, the return slip and the bakery design all measured against their printable width |

### The regression battery

Phase 2 touched no source file, so the battery is a **baseline** for the
phases that follow (Phase 3 changed the purchase screens; the receipt path
is untouched by it).

| Suite | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 |
| `npm run test:receiptdesigner` | 73/73 |
| `npm run test:receipt` | 68/68 |
| `npm run test:print` | 138 checks (the geometry suite) |

---

## 5. Risks and honest gaps

1. **The designer is verified by its suites, not by a shop's paper.** The
   layout audit measures the real boxes in Chromium, but the shop's actual
   printer driver (darkness, heat, the auto-cutter) can only be judged on a
   real roll. The **test print** button (`receipt:design:test`) prints the
   sample bill with the design currently on screen for exactly this reason.
2. **The built-in templates are eight starting points, not eight shop
   designs.** The owner is expected to adjust them; the library never
   overwrites a custom template.
3. **The library lives in `admin_settings` as JSON.** A hand-edited file can
   be malformed — `normalizeLibrary()` drops the junk instead of throwing,
   and a default that points at a missing template is dropped rather than
   breaking the print.
4. **The preview is not a screenshot of the paper.** It is the same HTML the
   print job uses, rendered in a window — the paper size, the margins and the
   driver's own scaling are the driver's business.
5. **The designer is bilingual only where the app is bilingual.** The
   designer screen's own labels follow the app's language files; the
   **document content** (the section labels the owner types) is whatever the
   owner writes — it is their receipt, in their words.

---

## 6. Next (the phase gate)

Phase 2 is **verified and complete**. The working tree holds nothing but the
owner's own files (`scripts/seed_demo.js` + the five stray scripts),
untouched and unstaged.

The next phases in the prompt's order:

- **Phase 3** — the purchase-order screen hardening (done — see
  `docs/PHASE3_REPORT.md`).
- **Phase 4** — the printer pipeline (the phase-4 receipt printing is already
  in the tree; it needs the shop's own printers).
- **Phase 5** — the release + the owner checklist + the live deploy.

**The owner must still decide:** (a) rotate the SMTP/SMS credentials (Phase 0),
(b) whether the strict password policy is acceptable for the staff accounts
(Phase 0), (c) which built-in template becomes the shop's default (Phase 2 —
the library ships with **no** default on purpose), (d) whether the duplicate
settings controls are cleaned up (Phase 0), (e) whether the shop wants
per-branch stock (Phase 1 risk 1), (f) whether the purchases permission
should become a real per-permission flag (Phase 3 risk 1).
