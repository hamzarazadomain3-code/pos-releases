# ShopKeeper POS — Manual Test Checklist

Release: v1.5.0 (from v1.0) — covers everything shipped since v1.0, including this release's new features.

---

## 1. App Startup & Licensing

- [ ] Fresh install launches without errors
- [ ] No license → app shows activation screen; activation with a valid key works
- [ ] Offline: app still opens within 30-day grace after last online check
- [ ] Expired license blocks new sales (sale attempt shows license message)
- [ ] Settings persist after restart (shop name, logo, printer settings)

## 2. Login / Users / Roles

- [ ] Default admin/admin123 exists on first run; prompt to change password shows
- [ ] Manager can create cashier (PIN required), cashier cannot create users
- [ ] Cashier cannot view Reports/Shifts/Audits/Promotions
- [ ] PIN login works; wrong PIN rejected
- [ ] Delete cashier with an open shift is blocked

## 3. Billing — Core Sale

- [ ] Search product by name / SKU / barcode; Enter adds to cart
- [ ] Scanner: barcode scan adds item; **Scanner indicator shows "Connected" after a scan and "Not detected" ~30s later**
- [ ] Qty + / − works; unit selector works for multi-unit products (pcs/box/carton); **selling a full box stores box_qty=1 with qty in base units**
- [ ] Retail ↔ Wholesale toggle updates prices (owner/manager only); **wholesale sale uses wholesale price and does not flag it as overridden**
- [ ] **Per-item discount: type discount on a cart row — total, receipt and invoice reflect it; discount cannot exceed line value**
- [ ] Bill discount (Rs / %) works alongside line discounts
- [ ] Promotions auto-apply (product %, category fixed, BOGO, expired disabled)
- [ ] Expired product adds with warning; confirm dialog before charging
- [ ] **Freight/Delivery charge: enter in Summary → totals, receipt ("Freight/Delivery" line), invoice and Excel export all include it**
- [ ] **Cash Drawer button opens the drawer (or shows "no printer" message)**
- [ ] Payment modal: Cash/Card/Easypaisa/JazzCash, **split payment (cash + card) with correct change**, partial payments
- [ ] Udhaar: selling on credit without customer is blocked; with customer creates balance
- [ ] Sale completes; success modal shows; Print Receipt / Print Invoice / Preview Receipt all work
- [ ] New Bill clears cart

## 4. Hold / Quotation / History / Void

- [ ] Hold saves bill incl. line discounts, bill discount, service charge, freight; Resume restores everything
- [ ] Quotation saved; listable under Quotes; loads back correctly
- [ ] History shows completed/voided; void with reason restores stock and batch
- [ ] Voids reflected in reports and customer balance

## 5. Inventory

- [ ] Add product with initial stock creates a batch (INIT-…) and stock movement
- [ ] Edit product name/price; barcode unique check
- [ ] Delete product without sales works (cleans batches/movements); delete with sales is blocked without side effects
- [ ] Adjust stock + / − / damage; negative below zero blocked; movements recorded per batch (FIFO)
- [ ] Purchase order receive adds batch (PO-…) and updates cost
- [ ] **Print Label prints name+price+barcode sticker; Print Barcode prints barcode-only sticker**
- [ ] Low-stock list shows items below threshold
- [ ] **Stock Received log lists batches newest-first across all products**

## 6. Udhaar / Customers

- [ ] **Add customer with Opening Balance → balance appears and ledger shows "opening_balance" row**
- [ ] Sale on credit increases balance; **partial payment reduces it; full payment brings balance to 0**
- [ ] Over-payment blocked; **sale that exceeds credit limit is blocked** ("Credit limit exceeded")
- [ ] Ledger running totals correct after sale/payment/void/return
- [ ] Credit refund return creates store credit (negative balance)

## 7. Returns / Refunds

- [ ] Return from invoice: select items, qty limits enforced, refund ≤ unreturned amount
- [ ] Cash refund restores stock to the original batch; refund modes cash/credit
- [ ] **Cash Refund (no invoice): amount+reason recorded, counted against current shift cash, shown in Cash Refunds History**
- [ ] Shift expected cash = start + cash sales − refunds (invoice and plain)

## 8. Purchases / Suppliers

- [ ] Supplier create; purchase order with multiple lines, totals correct
- [ ] Receive order: stock in per batch, cost updated, double-receive blocked
- [ ] Pay supplier / overpay blocked; cancel order restores balance
- [ ] Price history per product shows received unit costs

## 9. Shifts

- [ ] Open shift with opening cash; only one open shift per user
- [ ] Sale without open shift is blocked
- [ ] Close shift: counted cash vs expected (variance +10 / −10 cases), forced close
- [ ] Shift history lists past shifts with cash sales, refunds, variance

## 10. Reports / Excel Export

- [ ] Dashboard: today's sales/bills/udhaar/low stock correct
- [ ] Sales report by day; Profit & Loss (revenue − COGS − expenses)
- [ ] Best sellers; stock valuation (cost/retail)
- [ ] Expenses add/delete
- [ ] Export sales report to Excel/CSV includes Freight column
- [ ] Export customers/products to Excel

## 11. Stock Audits

- [ ] Create audit snapshots all products with system qty
- [ ] Save counts mid-audit and resume; complete applies variance adjustments + movements
- [ ] Audit history shows shortage/overage; re-complete blocked

## 12. Promotions

- [ ] Create percent/fixed/bogo; BOGO restricted to product scope
- [ ] Best promo wins (product beats category); date range respected; disable works
- [ ] Receipt shows "Promo: …" line; sale items carry promo name

## 13. Activity Log / Backup / Logs

- [ ] Activity log records sale/return/audit/promo/user actions with usernames
- [ ] Local backup runs daily; cloud backup folder copies file; missing folder warns
- [ ] Log files exist under userData/logs

## 14. Regression — Smoke Suite

- [ ] `POS_SMOKE=1` run against a copied DB finishes with `SMOKE_PASS` (freight total 170, barcode-only label, stock/batch consistency, opening balance, cash refund, shift math)