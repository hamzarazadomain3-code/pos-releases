# Phase 2: First-Run Setup + Shop Profile - TODO

## Tasks

### 2.1 First-Run Wizard
- [ ] Add `FirstRunWizard` component to App.tsx
- [ ] Check for first-run flag in localStorage (or absence of shop_name in settings)
- [ ] Show wizard before main app renders (before session restore)
- [ ] Step 1: Shop Profile - shop name, Urdu name, logo upload, address (multi-line), phones, WhatsApp, email, website, NTN/STRN, currency symbol/position, date format, language, branch list
- [ ] Step 2: Choose a receipt style - gallery of 6+ starter templates with live preview
- [ ] Step 3: Confirmation and save
- [ ] Store first-run complete flag in localStorage/settings

### 2.2 Shop Profile Page (Settings > Shop Profile)
- [ ] Add Shop Profile section to Settings page
- [ ] Fields: shop name, Urdu name, logo upload, address (multi-line), phones, WhatsApp, email, website, NTN/STRN, currency symbol/position, date format, language, branch list with per-branch overrides
- [ ] Pre-fill from existing settings
- [ ] Save to settings table

### 2.3 Starter Templates Gallery
- [ ] Create 6+ starter templates in receiptDesign.ts:
  - Minimal 80mm
  - Detailed 80mm with tax
  - 58mm Mini
  - A4 Invoice
  - Bakery/Grocery
  - Pharmacy/Medical
  - Garment/Boutique
- [ ] Add template preview using live preview with shop profile
- [ ] "Duplicate & edit" functionality
- [ ] Read-only starter templates (never overwritten on update)

### 2.4 Template Selection in Wizard
- [ ] Gallery view with live preview using entered shop profile
- [ ] "Duplicate & edit" creates customer's own copy
- [ ] Starter templates are read-only
- [ ] Customer templates never overwritten on app update

### 2.5 First-Run Detection
- [ ] Check for first-run flag in localStorage/settings
- [ ] Show wizard before main app renders
- [ ] Store completion flag

## Files to Modify/Create
- [ ] src/renderer/src/App.tsx - Add first-run wizard logic
- [ ] src/renderer/src/pages/Settings.tsx - Add Shop Profile section
- [ ] src/renderer/src/components/FirstRunWizard.tsx (new)
- [ ] src/renderer/src/components/ShopProfile.tsx (new)
- [ ] src/renderer/src/components/StarterTemplatesGallery.tsx (new)
- [ ] src/shared/receiptDesign.ts - Add starter templates
- [ ] src/main/services/receiptDesigner.ts - Add starter templates

## Starter Templates to Create
1. Minimal 80mm - Clean, minimal receipt
2. Detailed 80mm with tax - Full tax breakdown
3. 58mm Mini - Compact for small rolls
4. A4 Invoice - Full page invoice
5. Bakery/Grocery - With best-before, savings
6. Pharmacy/Medical - With batch/expiry
7. Garment/Boutique - With size/color variants

## Files to Modify/Create
1. src/renderer/src/App.tsx - Add first-run wizard logic
2. src/renderer/src/pages/Settings.tsx - Add Shop Profile section
3. src/renderer/src/components/FirstRunWizard.tsx (new)
4. src/renderer/src/components/ShopProfile.tsx (new)
5. src/renderer/src/components/StarterTemplatesGallery.tsx (new)
5. src/shared/receiptDesign.ts - Add starter templates
6. src/main/services/receiptDesigner.ts - Add starter templates