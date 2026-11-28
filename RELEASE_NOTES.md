# Rokar POS v2.33.0 — release notes

**Released:** 2026-11-28
**Baseline:** v2.32.0
**Type:** a stabilization release. No new screens; the work is the master-prompt
run's Phase 0 → 4 (defects, data safety, printing) plus the release/deploy work
in Phase 5.

This release is the result of a full audit-and-fix run over the live app. Every
item below has a permanent regression test and a saved proof run; the details
are in `docs/PHASE0_REPORT.md` … `docs/PHASE5_REPORT.md` and in the `CHANGELOG`.

## The money path

- **A refused stock adjustment no longer destroys batch stock.** The FIFO
  deduction is all-or-nothing: if the adjustment is refused, the batch, the
  stock and the ledger stay exactly as they were.
- **A bill with the same product on two lines keeps its own FIFO allocation
  per line** — the ledger now names the right batch.
- **Expired stock is one rule everywhere:** a batch that expired yesterday is
  never sold; a batch expiring today is still sellable; a manager can override
  with a PIN and a reason, and the override is written to the activity log.
- **Returns release their FIFO allocation**, the shelf and the FIFO report
  agree, and a cash refund reaches the drawer once (not twice, and not into the
  customer's udhaar).
- **The "today" leak is closed.** The Dashboard, the Reports and the Drawer all
  use the shop's own business day, not the UTC day, so a sale at 00:30 no
  longer lands on "yesterday".

## The purchase order screen

- **Backspace in the quantity box no longer deletes the row.**
- **The supplier-switch guard**: changing the supplier on an order that already
  has items asks what to do and keeps naming the original supplier until the
  owner decides.
- **A receipt is addressed to a line**, so two lines of the same product are
  received one by one — the second line is not closed by the first receipt.
- **A received order cannot be cancelled**, and an import cannot be undone
  after the goods were received.
- **The purchases permission is enforced in the service**, not only on the
  screen: a cashier cannot create, receive, cancel or pay a purchase order.
- **The Purchases screen, the PO modal and the import wizard are fully
  bilingual** (English + Urdu).

## Printing

- **Printing from the receipt preview now behaves exactly like printing
  directly**: the sale is remembered for "Reprint last receipt" and the cash
  drawer pulses on a fresh receipt — it never did either from the preview
  before.
- **The printer choice is one tested rule.** A named printer prints silently;
  "ask every time" always asks; the app never silently substitutes the Windows
  default unless the owner explicitly picked "System default printer".
- **Documents go to the printer that can print them**: a roll (58/80 mm) goes
  to the receipt printer, a sheet (A4/A5) to the invoice printer. An A5
  purchase order no longer comes out of the till's thermal printer.
- **The "Print Test Page" button works** (it used to throw before printing),
  and the A4 calibration sheet goes to the invoice printer.
- **The label stock the shop configured is the page that prints** — every size
  the engine knows, not just three.
- **The udhaar entry slip follows the receipt paper** (a 58 mm shop no longer
  gets an 80 mm slip).
- **A successful print can now tell the owner something**: the "this layout
  did not fit your paper" note is shown instead of being thrown away.
- **Every preview toolbar speaks the shop's language** — receipt, invoice,
  labels, purchase order and udhaar statement.
- **The printer settings screen and the preview toolbar are bilingual**, and
  the receipt-template panel shows a real printable width instead of
  "Width: undefined".

## Security and settings

- **The credentials are encrypted at rest** (SMTP password, SMS keys, WhatsApp
  token) with the OS keystore; the secret fields show dots and keep working.
- **The password policy is enforced on create and update** through one shared
  module. A 4–10 digit PIN is exempt from the complexity rules.
- **A shift open for more than 24 hours is blocked**, and the forced
  "set a new owner password" screen can no longer race the app shell.
- **The admin settings and the shop profile agree** — one bridge owns the
  shared keys, so changing the currency symbol in one screen updates the other.

## Install

- Download `RokarPOS-Setup.exe` from the website (the version-less alias always
  points at the latest release) or `RokarPOS-Setup-2.33.0.exe` from the GitHub
  release.
- The updater checks `latest.yml` and verifies the installer's sha512; this
  release ships a manifest rebuilt from the installer's own bytes.
- **Take a backup before installing.** The migrations are additive, but a
  backup is still the only way back.

## Still open (owner decisions, not defects)

The full list is in `docs/OWNER_CHECKLIST.md` §9. The main ones:

- rotate the SMTP/SMS/WhatsApp credentials (the old app password was exposed
  in the source history);
- decide whether the strict password policy is acceptable for staff accounts;
- pick the shop's default receipt template (the library ships with no default
  on purpose);
- decide whether the currency policy should reach every printed document;
- decide whether the Receipt Designer should cover the invoice, purchase
  order and statement too;
- decide whether the legacy receipt-template dropdown is hidden or wired into
  the library.

Older release notes (v2.15.1 and earlier) remain in the git history and on the
GitHub releases page.
