## Rokar POS v2.15.1 — hotfix

**Label Studio crashed on opening for every user** ("Something went wrong — Cannot read
properties of undefined (reading 'size')"). The page read the *configured paper size*
(`labelPaper`, which defaults to `38x25`) as if it were a template id, found no template
with that name, and crashed before it could render.

- Opening the page no longer crashes, on any machine, with or without saved templates.
- A second, hidden defect is fixed too: all 7 Label Studio dialogs (Template Manager,
  Label Editor, Full Preview, Printer Settings, Calibration, Print History, Save As)
  were rendered unconditionally — one full-screen overlay stacked on top of the other,
  masked only by the crash. Each dialog now opens only when asked.
- Legacy/corrupt saved templates are repaired on load; a missing template id falls back
  to the default Retail template with a notice instead of a crash.
- Error logging added: page crashes now write the real error + component stack to the
  DevTools console instead of only the generic "Something went wrong" screen.
- `npm run test:keyboard` gains a Label Studio crash-regression section (mounts with a
  corrupt saved template + stale last-used id, no dialog stack on load, fallback notice,
  focusable search, Template Manager renders the legacy template): 59/59 checks.

---

## Rokar POS v2.15.0

### Label Studio — Design & Print Your Own Product Labels
A full label designer built into the app, so the shop can print retail labels that
match its own layout instead of a fixed template.

- **Draw the label yourself.** Add text, product name, price, barcode, QR code,
  image and line elements at millimetre positions, then drag, resize, align and
  rotate them on the canvas next to a live preview (with a mm ruler and zoom).
- **Placeholders fill themselves per product:** `{name}`, `{price}`, `{sku}`,
  `{barcode}`, `{expiry}`, `{shop}`, `{category}`, `{date}`, `{qty}`, `{unit}` and
  more. Price follows the shop currency and decimal setting; barcodes validate
  EAN-13 and fall back to Code 128 when the code is not a valid EAN.
- **Templates:** nine ready-made label templates plus save / duplicate / delete for
  the shop's own, and one-off custom sizes (any width × height) alongside the stock
  sizes (38×25, 40×30, 50×25, 50×30, 58×40, 60×40, 100×50).
- **Print options:** pick the label printer, nudge X/Y offset in mm, mirror, rotate,
  repeat copies, and choose roll or A4 sheet layout.
- **Export & calibration:** export the batch to PDF or PNG, and print a calibration
  sheet (outline + mm ruler + guides) to line the label stock up before a run.
- **Print history:** every batch is recorded; reprint any past batch exactly, or
  clear the history.

### Installer
Download `RokarPOS-Setup-2.15.0.exe`

## Rokar POS v2.14.0

### Keyboard-First Navigation — Every Screen
Whole-app keyboard operation. Every page and modal now shares one consistent
keyboard layer, so a shop can run the till without touching the mouse.

- **Global keys:** `Ctrl+K` page switcher, `F1` context help (shows only the keys
  valid on the current screen), `Ctrl+N` new record, `Ctrl+F` search, `Ctrl+S`
  save, `Ctrl+P` print. Combos are owner-rebindable from the existing shortcut
  settings; the essentials work out of the box.
- **Modals:** focus trap, `Esc` closes, `Enter` = next field (last field submits),
  `Shift+Enter` = previous, first field auto-focused, numeric fields select-all on
  focus.
- **Tables & lists:** `↑`/`↓` highlight (never scrolls the page), `Home`/`End`,
  `PageUp`/`PageDown`, `Enter` opens/selects, `Delete` deletes (with confirm),
  type-ahead jumps to the search box.
- **Editable grids:** `search → qty → price` Enter cycle, arrow cell navigation,
  `Ctrl+Enter` submit, `Delete` row.
- **Arrow keys never change numbers.** Price/qty fields use a purpose-built input
  that leaves `↑`/`↓` for navigation instead of stepping the value.
- **Applied everywhere:** Billing & Quick Sale (existing zones preserved), Quotations,
  Returns, Purchases, Transfers, Audits, Production/FIFO, Promotions, Expenses,
  Udhaar, Commissions, Inventory, Barcode Labels, Users & Roles, Settings, Shifts,
  Cash Drawer, Login (Enter submit + on-screen PIN pad for touch), Reports and
  Customers/Suppliers — plus every modal on those screens.
- **Safe coexistence:** the barcode scanner, F-keys and any admin-defined shortcuts
  keep working; the keyboard layer only acts on the screen that is on top.

### Installer
Download `RokarPOS-Setup-2.14.0.exe`

## Rokar POS v2.13.0

### Thermal Receipt Redesign
- **Fixed right-edge clipping:** receipts no longer slice off the right-hand columns on 58mm or 80mm rolls. The body is exactly the printable width (48mm / 72mm) with 4mm side padding.
- **One fixed item table on both rolls:** `# | PARTICULARS | QTY | RATE | DISC | AMOUNT` (58mm drops DISC and uses `ITEM`). Numeric columns are right-aligned and never run together; long product names wrap instead of overflowing.
- **Invoice number on one line:** `INV-YYYYMMDD-NNNN` now prints as the compact `INV-MMDD-NNNN` instead of wrapping.
- **NET TOTAL on one line:** 17px/900 with a solid rule; long amounts auto-shrink a step. Payments and totals print as full-width right-aligned rows (side-by-side overflowed on 80mm).
- **Decimal quantities + units:** e.g. `0.57` with the unit label under the product name (Piece is omitted). Discount and Udhaar/Balance rows appear only when applicable.
- **Editable receipt content** (Admin → System Settings → Billing): header lines, terms text, "software by" name, and a show/hide toggle for the item-number (`#`) column. Footer message defaults to "Come again soon!".
- **Preview Receipt** button on Settings → Receipt Template renders the exact same HTML the printer uses.

### Installer
Download `RokarPOS-Setup-2.13.0.exe`

## Rokar POS v2.0.0

### Fixes
- **Scanner Detection:** Buffer gap 80->150ms, suffix support, 3x retry, improved indicator
- **Session Persistence:** Remember Me checkbox, 24h localStorage session, 30-min lock timeout
- **UI Performance:** memoized lineTotals, debounced inventory search (250ms)
- **Reports Excel Export:** Multi-sheet XLSX for all 7 report types
- **Alerts WhatsApp Delivery:** Unread critical/warning alerts + daily sales summary
- **Time-based Triggers:** 7AM udhaar reminder, 6PM expiry check, 10PM daily report

### Installer
Download `RokarPOS-Setup-2.0.0.exe`
