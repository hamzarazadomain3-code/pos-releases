# Phase 1: Remove Hardcoded Defaults - TODO

## Hardcoded Strings to Remove

### In receiptDesigner.ts:
- [ ] 'Al-Bagdad Special Bakery Rusk Family Pack (large loaf)' - sample data (line 126)
- [ ] 'Come again soon!' - default footer text (line 477)
- [ ] 'Rokar POS' - software credit default (line 481)
- [ ] 'Thank you for your visit!' - default thank you (line 517)
- [ ] 'BEST BEFORE: see pack date' - bakery template (line 539)
- [ ] 'Loyalty points earned: {loyalty_points}' - default loyalty text (line 498)
- [ ] 'You saved {savings}' - default savings text (line 505)
- [ ] 'RETURN / REFUND' - return banner text (line 489)
- [ ] 'Come again soon!' - default footer (line 477)
- [ ] 'Rokar POS' - software credit default (line 481)
- [ ] 'Thank you for your visit!' - default thanks (line 517)
- [ ] Table column labels: #, Item, Unit, Qty, Rate, Disc, Tax, Amount (should be customizable)
- [ ] Meta labels: CUSTOMER, CASHIER, etc.
- [ ] 'SUB TOTAL', 'DISCOUNT', 'TAX', 'SERVICE CHARGE', 'FREIGHT', 'NET TOTAL', 'PAID', 'CHANGE', 'UDHAAR/BALANCE', 'RETURN'
- [ ] 'CUSTOMER', 'CASHIER', 'INVOICE', 'DATE', 'TIME'
- [ ] 'PARTICULARS' / 'ITEM' for narrow receipts
- [ ] 'QTY', 'RATE', 'DISC', 'TAX', 'AMOUNT', 'UNIT'

### In receiptTemplates.ts:
- [ ] 'Come again soon!' - default footer text (line 147)
- [ ] 'Rokar POS' - software credit default (line 148)
- [ ] 'Come again soon!' - footer message (line 147)
- [ ] 'Rokar POS' - software by (line 148)

### In labelTemplates.ts:
- [ ] 'Al Bagdad Grocery (2-across)' - label template name (line 116)
- [ ] 'Al Bagdad Grocery (2-across, 50 × 30)' - label template name (line 155)

### In printDocs.ts (need to check):
- [ ] Check for any hardcoded strings

### Sample data:
- [ ] 'Al-Bagdad Special Bakery Rusk Family Pack (large loaf)' - sample product (line 126)
- [ ] 'Faqirwali, Haroonabad, Chishtian, Dharanwala' - branch names in sample
- [ ] 'Al Baghdad Sweets & Bakers' - shop name in sample

## Tasks:
1. [ ] Create neutral default template that only uses settings (no footer slogan, no software credit by default)
2. [ ] Move all hardcoded strings to template JSON or settings
3. [ ] Make table column labels customizable via template
6. [ ] Make meta labels customizable via template
7. [ ] Create neutral default template (no footer slogan, no software credit)
7. [ ] Migration script for existing installs: create "My receipt" template from current settings
8. [ ] Update defaultReceiptDesign() to use neutral defaults
9. [ ] Update defaultSections() to not include hardcoded text
10. [ ] Update builtinTemplates() to use neutral defaults
11. [ ] Run typecheck + build after each change