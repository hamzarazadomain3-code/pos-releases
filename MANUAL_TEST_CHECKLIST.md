# Rokar POS — manual test checklist (v2.33.0)

This is the short, printable smoke test for the release. The **full** owner
checklist — every item the automated tests cannot prove, including the open
owner decisions — is `docs/OWNER_CHECKLIST.md`.

Do this on a **test machine** first, never on the live till as the first place
you try it. **Take a backup** before you install (Admin → System Settings →
Backups, or the backup folder in the shop's Documents) and keep a copy on a USB
stick.

## 1. Install and sign in

- [ ] Install `RokarPOS-Setup-2.33.0.exe` (or the website's
      `RokarPOS-Setup.exe`). The app opens and the login screen appears.
- [ ] Sign in as the owner. If you still use the default password, the app
      forces you to set a new one **before** you can use the till.
- [ ] The shop name, logo, wallpaper and currency are the ones you chose, and
      they survive a restart.
- [ ] The licence is active. It is a one-time purchase and never expires.
- [ ] Open a shift.

## 2. One sale, one return (the money path)

- [ ] Sell two products: search by name, by SKU and by barcode.
- [ ] Sell one **carton** of a multi-unit product; the stock goes down by the
      **base quantity** (1 carton of 12 = 12 pieces).
- [ ] Take a **split payment** (cash + card); the change is right.
- [ ] Print the receipt. It is not sliced, the currency appears once (on NET
      TOTAL), and a **reprint** is stamped DUPLICATE COPY.
- [ ] Open the receipt preview and press **Print** there: the receipt prints,
      the cash drawer pulses (if you turned it on), and **Reprint last
      receipt** reprints **this** sale — not the previous one.
- [ ] Make a **return**: the stock goes back, and a cash refund reaches the
      drawer **once**.
- [ ] Close the shift; the drawer numbers match what you counted.

## 3. Stock and expiry

- [ ] A stock adjustment that is refused (not enough stock) leaves the stock
      exactly as it was.
- [ ] The FIFO Stock Report is **not empty** and agrees with the shelf.
- [ ] A product expiring **today** is sellable; one that expired **yesterday**
      is blocked, and a manager can override with a PIN + reason.

## 4. Purchase order

- [ ] Create a purchase order with two lines of the **same product**; receive
      them one by one and confirm each line goes to its own batch.
- [ ] **Backspace** in the quantity box does not delete the row.
- [ ] Change the supplier on an order with items: the app asks, and keeps the
      original supplier until you decide.
- [ ] Print an **A5** order: it comes out of the **invoice** printer, not the
      till's thermal printer.
- [ ] Sign in as a cashier: the Purchases page is hidden and the actions are
      refused.

## 5. Printer setup (do this once per till)

- [ ] Settings → Printers: the printer and the paper size (58 mm / 80 mm)
      match the roll you actually load.
- [ ] **Print Test Page (Receipt)** prints a calibration sheet (a millimetre
      ruler + black bars).
- [ ] **Print Test Page (A4 Invoice)** comes out of the invoice printer.
- [ ] Print one label at the stock size you buy (e.g. 58×40): the page is that
      size.
- [ ] Switch the app to Urdu: the printer settings and every preview toolbar
      (receipt, invoice, labels, purchase order, statement) are in Urdu.
- [ ] The receipt-template panel shows a real width ("Printable width: 72mm"),
      not "Width: undefined".

## 6. Users, settings and the web app

- [ ] Add a cashier: a 4–10 digit PIN is required; the complexity rules do not
      apply to a PIN.
- [ ] Add a manager: the password rules apply.
- [ ] The SMTP password / SMS keys / WhatsApp token fields show dots, never the
      real value, and still work after saving an unrelated setting.
- [ ] Change the currency symbol in Admin and confirm the shop profile and a
      printed receipt follow.
- [ ] Open the web app as owner and as cashier; both log in and the secrets
      stay masked.

## 7. Update

- [ ] The in-app update check finds **2.33.0** and the download verifies (no
      "Cannot find channel latest.yml" error).
- [ ] After updating, open a sale and print a receipt once more.

If anything fails, note the version (Settings → About), the screen, and what
you did, and report it with the log file. Do **not** try to fix the database by
hand.
