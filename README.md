# ShopKeeper POS

Local Billing & Inventory Management System for small retail shops.

## Tech Stack

- **Electron** (desktop shell)
- **React + TypeScript** (renderer UI)
- **Vite** (bundler / dev server)
- **SQLite** (`node:sqlite`, built into Node 24 — no native compilation needed)
- Lightweight built-in migration runner (migrations in `migrations/`)
- **electron-builder** for packaging Windows installer

## Project Structure

```
pos-app/
├── src/
│   ├── main/          # Electron main process
│   │   ├── main.ts    # Window creation, IPC handlers
│   │   └── db.ts      # SQLite initialization & migrations
│   ├── preload/
│   │   └── preload.ts # contextBridge API for renderer
│   ├── renderer/      # React app
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       └── styles.css
│   └── shared/        # Shared types between main & renderer
├── migrations/        # SQL migrations (run by Umzug)
├── dist/              # Compiled output (main + renderer)
├── release/           # electron-builder output
├── package.json
├── tsconfig.json
├── tsconfig.main.json
├── tsconfig.renderer.json
└── vite.config.ts
```

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

This starts:
- Vite dev server (http://localhost:5173)
- TypeScript compiler in watch mode (compiles main process to `dist/main`)
- Electron app loading the dev server

## Build

```bash
npm run build
```

Outputs compiled main process (`dist/main`) and built renderer (`dist/renderer`).

## Package (Windows Installer)

```bash
npm run package
```

Creates an NSIS installer in `release/`.

## Database

- Stored at `%APPDATA%\ShopKeeper POS\pos.db` (Windows)
- Migrations live in `migrations/` and run automatically on app start.

## Roadmap (MVP)

1. Inventory & Stock CRUD
2. Barcode generation & scanning
3. Billing / POS screen
4. Udhaar (Credit) ledger
5. Tax configuration
6. Receipt printing

## License

Commercial – annual subscription.

## Changelog

### v1.5.7 (2026-08-19)
#### ✨ New Features
- **Decimal Quantity Support**: 0.78 kg, 1.5 liter — 6-digit decimal precision in Gram/Kilogram mode
- **BayLan RLS1100 Scale Integration**: Weight-embedded barcodes (`2PPPPPPWWWWWC`) scan & auto-calculate weight × rate
- **Visual Analytics Dashboard**: Hourly sales trend line chart, top-5 products bar/pie charts, daily summary cards
- **Barcode Sticker Printer**: 38×25mm / 50×30mm / 100×50mm thermal labels (JsBarcode, CODE128)
- **WhatsApp Receipt Alerts**: Customer receipts via WhatsApp (QR pairing in Settings, optional)
- **Receipt Customization**: `receipt_settings` table (shop name, address, footer, paper width) merged into printed receipts

#### 🐛 Fixes
- Gram mode integer forcing removed (decimals now supported everywhere in billing)
- Unit name always shown on receipt (base units included)
- Scale item handling improved (`setScannerLastSeen` on scale scans)
- whatsapp-web.js `Client` export resolution fixed; headless-shell browser bundled for packaged installs

#### 📦 Package Changes
- Added: `recharts`, `jsbarcode`, `whatsapp-web.js`, `qrcode`
- Installer: bundles Chrome for Testing (headless shell) for WhatsApp receipts
