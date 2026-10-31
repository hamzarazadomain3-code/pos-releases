#!/usr/bin/env node
/**
 * Phase 2 guard — forbidden shop-content literals.
 *
 * Fails (exit 1) when a hardcoded shop identity or shop content string leaks
 * back into the app source. These values must live ONLY in the shop's own data
 * (settings / Shop Profile / “My receipt” template), never in code:
 *
 *   identity (never anywhere in src/):
 *     Faqirwali, Haroonabad, Chishtian, Dharanwala, Al Baghdad,
 *     03001234567, 03706863313
 *
 *   shop content that must resolve from settings only:
 *     “Come again soon”, “Thank you! Visit again” — nowhere in src/
 *     “SOFTWARE BY” — never in the receipt renderers
 *     `|| 'Rokar POS'` style defaults — never in src/main/services
 *
 * Tests and migrations are exempt (they may exercise the legacy values).
 *
 * Run standalone: node scripts/check-forbidden-strings.js
 * Wired into `npm run typecheck` so a violation fails CI.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const IDENTITY = ['Faqirwali', 'Haroonabad', 'Chishtian', 'Dharanwala', 'Al Baghdad', '03001234567', '03706863313'];
const SHOP_CONTENT = ['Come again soon', 'Thank you! Visit again'];
// Receipt/print renderers: the software name (and its "SOFTWARE BY" label) may
// only print when the OWNER configured it. (Email/SMS branding elsewhere has
// its own app-name fallbacks and is out of scope for this guard.)
const RECEIPT_RENDERER_FILES = [
  path.join('src', 'shared', 'renderDocument.ts'),
  path.join('src', 'main', 'services', 'receiptDesigner.ts'),
  path.join('src', 'main', 'services', 'receiptTemplates.ts'),
  path.join('src', 'main', 'services', 'printDocs.ts'),
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|js|jsx|css|html|json)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const violations = [];

for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file);
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);

  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    for (const lit of IDENTITY) {
      if (line.includes(lit)) violations.push(`${at}  identity literal "${lit}"`);
    }
    for (const lit of SHOP_CONTENT) {
      if (line.includes(lit)) violations.push(`${at}  shop-content literal "${lit}"`);
    }
    const inReceiptRenderer = RECEIPT_RENDERER_FILES.some((f) => rel === f);
    if (inReceiptRenderer && /(\|\||\?\?)\s*['"]Rokar POS['"]/.test(line)) {
      violations.push(`${at}  hardcoded software-name default (||/?? 'Rokar POS')`);
    }
    if (inReceiptRenderer && line.includes('SOFTWARE BY')) {
      violations.push(`${at}  hardcoded "SOFTWARE BY" label in a receipt renderer`);
    }
  });
}

if (violations.length) {
  console.error('Forbidden shop-content literals found (Phase 2 guard):');
  for (const v of violations) console.error('  ' + v);
  console.error('\nMove these values into shop settings / the receipt template, not code.');
  process.exit(1);
} else {
  console.log('[forbidden-strings] OK — no hardcoded shop identity/content literals in src/.');
}
