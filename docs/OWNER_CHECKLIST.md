# OWNER CHECKLIST — Rokar POS (the master-prompt run, v2.32.0 → next)

**For the shop owner.** Every box below is something the automated tests
**cannot** prove — a real printer, a real till, a real customer's money.
The automated evidence for the same run lives in `docs/PHASE0_REPORT.md` …
`docs/PHASE5_REPORT.md` and in `E:\temp\proof\`.

**How to use it:** do it on a **test machine** first, never on the live till
as the first place you try it. Take a **backup** before you install
(Admin → System Settings → Backups, or the backup folder in the shop's
Documents).

---

## 0. Before you install

- [ ] **Take a backup** of the shop database and put a copy somewhere else
      (a USB stick). If anything below goes wrong, this is your way back.
- [ ] Note the **current version** (Settings → About) so you know what you
      installed and what to roll back to.
- [ ] Install on a **test machine** first, or on the till after the shop
      closes.

---

## 1. First launch (the things a new install can get wrong)

- [ ] The app opens, the login screen appears, and the **shop logo and the
      wallpaper** are the ones you chose.
- [ ] Sign in as the owner with your password. The app **does not** ask you to
      use `admin/admin123` any more — change the owner password if you still
      use the old one.
- [ ] **Settings persist after a restart**: change the shop name, the
      currency symbol and the receipt footer, restart the app, and confirm the
      values are still there.
- [ ] The **licence** is active (Settings → Licence). The licence is a
      **one-time purchase and never expires** — there is no renewal to do.
- [ ] Open a **shift** before you try to sell anything (the till refuses a
      cash sale without an open shift — that is intended).

---

## 2. Billing (the money path — the most important page)

- [ ] Search a product by **name**, by **SKU** and by **barcode**; Enter adds
      it to the cart.
- [ ] A **multi-unit product** (pcs / box / carton): selling one carton stores
      the **base quantity** (1 carton of 12 = 12 pieces), not 1.
- [ ] The **unit price** is the sale price; the **cost price** is not shown to
      a cashier.
- [ ] A **per-item discount**, a **bill discount**, a **freight** and a **tax**
      all show up in the totals, on the **receipt**, on the **invoice** and in
      the **Excel export** — the same number in all four.
- [ ] **Split payment** (cash + card) gives the right **change**.
- [ ] **Udhaar (credit)**: selling on credit **without** a customer is
      refused; with a customer, the balance moves.
- [ ] A **return** puts the stock back and the refund reaches the cash drawer
      **once** (not twice, and not into the customer's udhaar when you took
      cash back).
- [ ] The **shift closes** and the drawer numbers match what you counted.
- [ ] Cross-screen: the Dashboard's "today", the Reports' "today" and the
      Drawer's "today" show **the same numbers** (they used to disagree when
      the date rolled over at UTC midnight).

---

## 3. Stock, batches and expiry (Phase 1)

- [ ] A **stock adjustment** that the app **refuses** (not enough stock) leaves
      the stock **exactly as it was** — the old version silently removed the
      batch stock.
- [ ] The **FIFO Stock Report** is **not empty** — every real batch shows its
      received quantity (it used to show 0 for everything).
- [ ] A **return** releases the batch it came from, and the FIFO report agrees
      with the shelf.
- [ ] A product **expiring today** is still sellable; a product that expired
      **yesterday** is blocked, and a **manager** can approve it with a PIN
      and a reason (the approval is written to the activity log).
- [ ] A bill with the **same product on two lines** takes the stock from two
      different batches, and the ledger names the right batches.
- [ ] A **quotation converted to a bill** obeys the same stock rules (no
      negative stock, no expired stock).

---

## 4. The Purchase Order screen (Phase 3)

- [ ] The Purchases screen and the Purchase Order modal **switch to Urdu**
      with the footer language toggle — and the whole screen (including the
      import wizard) is Urdu, not half Urdu.
- [ ] **Backspace in the quantity box** does **not** delete the row (it used
      to). **Delete** outside a text field does.
- [ ] A product that is **not** low on stock still shows its **unit dropdown**
      (it used to show none).
- [ ] Change the **supplier** on an order that already has items: the app
      **asks** what to do and keeps naming the **original** supplier until you
      decide.
- [ ] Sign in as a **cashier**: the Purchases page is hidden **and** the
      purchase actions are refused (they used to be reachable).
- [ ] **Paying more than the order total** is refused; a **negative freight**
      and a **discount above 100 %** are refused.
- [ ] An order with **two lines of the same product** (two batches, two
      prices): receive them one by one — each line's quantity goes to **its own**
      batch, and the second line is not closed by the first receipt.
- [ ] A **received** order cannot be **cancelled**, and an import cannot be
      **undone** after the goods were received.
- [ ] The **"Stock received" note** on one order does not show up on another.
- [ ] The Purchases list's totals **exclude** the drafts and the cancelled
      orders.

---

## 5. Printing (Phase 4)

- [ ] **Settings → Printers**: your printer is selected and the **paper size**
      (58 mm / 80 mm) matches the roll you actually load. The shop mixes both.
- [ ] The **system default printer** option prints **silently** (no dialog);
      the **"ask every time"** option always asks. The app never silently
      substitutes the Windows default for "ask every time".
- [ ] **Receipt preview** opens with the title **"Receipt preview"**, shows the
      roll as a white sheet on a grey background, and the **Print** and
      **Download PDF** buttons produce the **same** receipt.
- [ ] The receipt is **not sliced**: every column fits inside the printable
      width on **both** the 58 mm and the 80 mm roll.
- [ ] The **currency appears once** on the receipt (on NET TOTAL) — not on
      every line, and never `Rs Rs`.
- [ ] A **reprint** is stamped **DUPLICATE COPY**; the original print is not.
- [ ] **Copies**: print 3 copies and the roll prints 3 times.
- [ ] The **cash drawer** kicks only on a **fresh** print (not on a reprint),
      and only if you turned it on.
- [ ] The **bottom feed / cut** looks right on your printer — the roll ends
      cleanly and the driver cuts it.
- [ ] The **Receipt Designer**'s **Test print** prints the sample bill with
      your unsaved design — hold it against the roll before you save.
- [ ] **Reprint last receipt** (the button in the sale-success modal) prints
      the receipt you actually want.
- [ ] Turn the designer **on** (Save & apply) and print one receipt: the
      layout is what the preview showed. Turn it **off** and the old receipt
      comes back.
- [ ] **"Print Test Page (Receipt)"** prints a calibration sheet (a
      millimetre ruler + black bars) — it used to **throw and print
      nothing**. The sheet comes out of the **receipt** printer.
- [ ] **"Print Test Page (A4 Invoice)"** prints an A4 calibration sheet — it
      must come out of the **invoice** printer, not the till's thermal one.
- [ ] The Settings receipt-template panel shows a **real width** ("Printable
      width: 72mm"), not **"Width: undefined"**.
- [ ] **Barcode labels**: set the label stock to the size you actually buy
      (e.g. `58x40`) and print one — the page must be that size. (Before the
      fix every size except three printed on a 38×25 page.)
- [ ] A **purchase order on A5** comes out of the **invoice** printer; an
      80mm order comes out of the **receipt** printer.
- [ ] An **udhaar entry slip** on a 58mm shop fits the 58mm roll (it used to
      always be 80mm).
- [ ] Print a receipt on the **wrong paper** for your roll (e.g. pick 80mm
      while 58mm is loaded): the app tells you the layout did not fit and
      which one it used instead. (The note was dropped before the fix.)
- [ ] Every **preview** — the receipt, the invoice, the labels, the purchase
      order, the udhaar statement — shows its toolbar in **Urdu** when the
      shop's language is Urdu.
- [ ] A **preview always has its buttons**. If a preview ever opens with no
      Print / PDF / Close button, that is a bug — report it (the app now says
      so instead of pretending it opened).
- [ ] The **forced "set a new owner password"** screen appears the moment you
      sign in as the owner with the default password, and you cannot use the
      app until you set one.

---

## 6. Users, roles and the security work (Phase 0)

- [ ] **Add a cashier**: a 4–10 digit PIN is required, and the complexity
      rules do **not** apply to a PIN.
- [ ] **Add a manager**: the password rules apply (the shared policy).
- [ ] The **secret fields** (the SMTP password, the SMS keys, the WhatsApp
      token) show **dots**, never the real value — and they still work after
      saving an unrelated setting.
- [ ] A **revoked** licence blocks the next sale; an **expired recovery code**
      cannot be used twice.
- [ ] A **failed recovery** locks out after 5 tries.
- [ ] The **admin settings** and the **shop profile** no longer disagree —
      change the currency symbol in one and confirm the other follows.

---

## 7. The web app (the same code in a browser)

- [ ] Open the web app as **owner** and as **cashier**: both log in, the
      settings load and the **secrets stay masked**.
- [ ] The web **cashier cannot** call the raw email / WhatsApp relays.
- [ ] The web app says **plainly** that the WhatsApp sending needs the
      Windows app — it does not pretend to work.

---

## 8. Deploy / release

- [ ] The **installer** downloads from the website's button
      (`RokarPOS-Setup.exe`) and the file starts with `MZ` (a real
      executable, not an HTML error page).
- [ ] The **update check** inside the app finds the new version and the
      download verifies (no "Cannot find channel latest.yml" error).
- [ ] The **Worker** (the web app's backend) is deployed and the web smoke
      test passes.

---

## 9. The decisions the owner still has to make

These are **not** bugs — they are choices only you can make. Each one is
recorded in `docs/DECISIONS.md` and in the phase reports.

| # | The decision | Where |
|---|---|---|
| 1 | **Rotate the SMTP / SMS / WhatsApp credentials.** The old Gmail app password was exposed in the source history — no code can un-leak it. | Phase 0, D7 |
| 2 | Is the **strict password policy** acceptable for your staff accounts? | Phase 0, D13 |
| 3 | Should the **duplicate settings controls** be cleaned up? | Phase 0 risk |
| 4 | Do you want **per-branch stock** (today the stock is one number per product)? | Phase 1 risk 1 |
| 5 | Which **built-in receipt template** becomes your default? (The library ships with **no** default on purpose.) | Phase 2, D23 |
| 6 | Should the **purchases permission** become a real per-permission flag (e.g. "the cashier may receive but not create")? | Phase 3, D24 |
| 7 | Should the **purchase import's strict unit resolution** stay strict? (An unknown unit name is never guessed — the line stays in base units.) | Phase 1 risk 3 |
| 8 | Should the **WhatsApp receipt** become the designed document (an image / PDF) instead of plain text? It changes what the customer receives. | Phase 4 risk 6 |
| 9 | Should the **currency policy** (symbol, position, decimals) reach **every** printed document — the invoice, the purchase order, the udhaar statement — or only the designed receipt? | Phase 4 risk 1 |
| 10 | Should the **Receipt Designer** cover the other document types (invoice, purchase order, statement, credit slip), or stay receipt-only? | Phase 4 risk 2 |
| 11 | The **legacy receipt-template dropdown** (Settings + the till) is ignored by the printer on a fresh install, because the designer drives the layout. Should it be **hidden**, or wired into the template library? | Phase 4 risk 3 |
