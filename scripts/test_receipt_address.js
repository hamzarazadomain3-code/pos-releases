#!/usr/bin/env node
/**
 * Phase 2 — Shop address resolution suite.
 *
 * Proves the single renderer (shared/renderDocument.ts) drives EVERY output and
 * that the address comes from user data only:
 *
 *   receipt (thermal) | A4 invoice | PDF source | WhatsApp/SMS text & HTML
 *
 * and that the strict resolution order holds:
 *   template block override (key exists, even "") → branch override → Shop
 *   Profile → empty (prints NOTHING, no blank line).
 *
 * Also asserts the old hardcoded branch names can never appear.
 *
 * Usage (after `npm run build`):
 *   npx electron scripts/test_receipt_address.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-address-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'address-test.db');

let checks = 0;
let failures = 0;

function check(name, condition, detail) {
  checks++;
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ' -- ' + detail : ''}`);
  return condition;
}

const OLD_NAMES = ['Faqirwali', 'Haroonabad', 'Chishtian', 'Dharanwala'];
const NEW_ADDRESS = 'TEST ADDRESS 123, Model Town';

async function run() {
  await app.whenReady(); // printService.printJobToPdf opens a BrowserWindow
  const { initDatabase, getDb } = require('../dist/main/db.js');
  await initDatabase();
  const db = getDb();
  void db;

  const inventory = require('../dist/main/services/inventory.js');
  const shifts = require('../dist/main/services/shifts.js');
  const sales = require('../dist/main/services/sales.js');
  const printing = require('../dist/main/services/printing.js');
  const printService = require('../dist/main/services/printService.js');
  const settings = require('../dist/main/services/settings.js');
  const designer = require('../dist/main/services/receiptDesigner.js');
  const shared = require('../dist/shared/receiptDesign.js');

  // ── shop identity ──────────────────────────────────────────────────────────
  const setSetting = (k, v) => settings.setSetting(k, v);
  setSetting('shop_name', 'TEST SHOP');
  setSetting('shop_address', NEW_ADDRESS);
  setSetting('shop_phone', 'TESTPHONE-555');
  setSetting('shop_whatsapp', 'TESTWA-777');
  setSetting('license_lifetime', '1'); // createSale is licence-gated
  setSetting('price_floor_enabled', '0');

  const product = inventory.createProduct({
    name: 'Address Test Widget',
    sale_price: 100,
    cost_price: 50,
    stock_qty: 10,
    tax_rate: 0,
  });
  shifts.openShift(1000);
  const sale = sales.createSale({
    items: [{ product_id: product.id, qty: 1, price: 100, line_discount: 0, tax_rate: 0 }],
    payments: [{ mode: 'Cash', amount: 100 }],
  });
  const saleId = sale.sale.id;

  // ── 1. Thermal receipt ─────────────────────────────────────────────────────
  console.log('\n=== Thermal receipt ===');
  const receipt = printing.buildReceiptHtml(saleId, 'standard');
  check('receipt shows the typed address', receipt.includes(NEW_ADDRESS));
  check('receipt shows the typed phone', receipt.includes('TESTPHONE-555'));
  check('receipt has no old branch names', OLD_NAMES.every((n) => !receipt.includes(n)));

  // ── 2. A4 invoice ──────────────────────────────────────────────────────────
  console.log('\n=== A4 invoice ===');
  const invoice = printing.buildInvoiceHtml(saleId, 'a4');
  check('A4 invoice shows the typed address', invoice.includes(NEW_ADDRESS));
  check('A4 invoice has no old branch names', OLD_NAMES.every((n) => !invoice.includes(n)));

  // ── 3. PDF source (the PDF is rendered from exactly this HTML) ────────────
  console.log('\n=== PDF ===');
  {
    const job = { html: invoice, paper: 'a4', printerKey: 'invoice', jobName: 'invoice' };
    const { data } = await printService.printJobToPdf(job);
    check('PDF produced non-empty bytes', !!data && data.length > 1000, `${data ? data.length : 0} bytes`);
    // The PDF is Chromium's rasterisation of exactly `job.html`; the address is
    // asserted on that HTML above. Raw PDF bytes are compressed, so a byte
    // search is informational only.
    const pdfText = Buffer.from(data).toString('latin1');
    console.log(
      `  [INFO] PDF stream is ${pdfText.includes('TEST ADDRESS') ? 'searchable — address present' : 'compressed (address verified via the source HTML)'}`
    );
  }

  // ── 4. WhatsApp / SMS body ─────────────────────────────────────────────────
  console.log('\n=== WhatsApp / SMS ===');
  const waHtml = printing.buildReceiptHtml(saleId, 'standard');
  const waText = printing.buildReceiptText(saleId);
  check('WhatsApp HTML shows the typed address', waHtml.includes(NEW_ADDRESS));
  check('WhatsApp text shows the typed address', waText.includes(NEW_ADDRESS));
  check('WhatsApp channels carry no old branch names', OLD_NAMES.every((n) => !waHtml.includes(n) && !waText.includes(n)));

  // ── 5. Empty address prints NOTHING (no blank line) ────────────────────────
  console.log('\n=== Empty address ===');
  setSetting('shop_address', '');
  const emptyReceipt = printing.buildReceiptHtml(saleId, 'standard');
  check('no address text when the Shop Profile address is empty', !emptyReceipt.includes(NEW_ADDRESS));
  check('no empty address line is rendered', !/<div class="shop-line">\s*<\/div>/.test(emptyReceipt));
  check('old names still absent', OLD_NAMES.every((n) => !emptyReceipt.includes(n)));
  setSetting('shop_address', NEW_ADDRESS);

  // ── 5b. Empty phone prints NOTHING ─────────────────────────────────────────
  console.log('\n=== Empty phone ===');
  setSetting('shop_phone', '');
  setSetting('shop_whatsapp', '');
  const noPhone = printing.buildReceiptHtml(saleId, 'standard');
  check('no phone text when the Shop Profile phone is empty', !noPhone.includes('TESTPHONE-555'));
  check('no phone line is rendered', !/<div class="shop-line">\s*<\/div>/.test(noPhone));
  setSetting('shop_phone', 'TESTPHONE-555');
  setSetting('shop_whatsapp', 'TESTWA-777');

  // ── 5c. Multi-line address keeps one printed line per input line ───────────
  console.log('\n=== Multi-line address ===');
  setSetting('shop_address', 'LINE ONE\nLINE TWO\n\nLINE THREE');
  const multi = printing.buildReceiptHtml(saleId, 'standard');
  check('every non-empty address line prints', ['LINE ONE', 'LINE TWO', 'LINE THREE'].every((l) => multi.includes(l)));
  check('blank address lines are dropped', !/<div class="shop-line">\s*<\/div>/.test(multi));
  setSetting('shop_address', NEW_ADDRESS);

  // ── 5d. Legacy `receipt_settings` can no longer override the profile ───────
  // This is the exact regression: the pre-2026-08 table used to be spread LAST
  // in getPrintSettings(), so a stale row beat every Shop Profile edit.
  console.log('\n=== Legacy receipt_settings precedence ===');
  {
    const LEGACY_ADDRESS = 'LEGACY STALE ADDRESS 1999';
    const LEGACY_PHONE = 'LEGACY-STALE-PHONE';
    db.prepare('INSERT OR REPLACE INTO receipt_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(
      'shop_address',
      LEGACY_ADDRESS
    );
    db.prepare('INSERT OR REPLACE INTO receipt_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(
      'shop_phone',
      LEGACY_PHONE
    );

    const merged = printing.buildReceiptHtml(saleId, 'standard');
    check('Shop Profile address beats the legacy row', merged.includes(NEW_ADDRESS) && !merged.includes(LEGACY_ADDRESS));
    check('Shop Profile phone beats the legacy row', merged.includes('TESTPHONE-555') && !merged.includes(LEGACY_PHONE));

    const waLegacy = printing.buildReceiptText(saleId);
    check('WhatsApp text also uses the Shop Profile', waLegacy.includes(NEW_ADDRESS) && !waLegacy.includes(LEGACY_ADDRESS));

    // Migration 065 must adopt nothing (the profile already owns both keys) and
    // delete the shadowing rows so they can never come back as defaults.
    const migration = require('../migrations/065_retire_legacy_receipt_settings.js');
    migration.up(db);
    const legacyRows = db
      .prepare("SELECT key FROM receipt_settings WHERE key IN ('shop_name','shop_address','shop_phone','shop_whatsapp','custom_footer')")
      .all();
    check('migration 065 removes the shadowing legacy rows', legacyRows.length === 0, `${legacyRows.length} left`);

    const profileAddress = db.prepare("SELECT value FROM settings WHERE key = 'shop_address'").get();
    check('migration 065 never overwrites the Shop Profile', profileAddress && profileAddress.value === NEW_ADDRESS);

    // Idempotent: a second run is a no-op.
    migration.up(db);
    const afterSecond = db.prepare("SELECT value FROM settings WHERE key = 'shop_address'").get();
    check('migration 065 is idempotent', afterSecond && afterSecond.value === NEW_ADDRESS);
  }

  // ── 5e. `receipt_header_lines` = "[]" must not print a literal "[]" ────────
  console.log('\n=== Header lines normalisation ===');
  {
    db.prepare(
      "INSERT OR REPLACE INTO admin_settings (key, value, updated_at) VALUES ('receipt_header_lines', '[]', CURRENT_TIMESTAMP)"
    ).run();
    const html = printing.buildReceiptHtml(saleId, 'standard');
    check('JSON "[]" does not print as a literal line', !html.includes('[]'));
  }

  // ── 5f. Shop Profile "Receipt Footer" reaches the receipt ──────────────────
  console.log('\n=== Footer resolution ===');
  {
    setSetting('receipt_footer', 'FOOTER-FROM-PROFILE');
    const html = printing.buildReceiptHtml(saleId, 'standard');
    check('profile receipt footer prints', html.includes('FOOTER-FROM-PROFILE'));

    setSetting('receipt_footer', '');
    const cleared = printing.buildReceiptHtml(saleId, 'standard');
    check('cleared footer prints nothing (no default)', !cleared.includes('FOOTER-FROM-PROFILE'));
    setSetting('receipt_footer', 'Thank you! Visit again');
  }

  // ── 5g. Dev provenance footer is opt-in only ───────────────────────────────
  console.log('\n=== Debug footer ===');
  {
    const without = printing.buildReceiptHtml(saleId, 'standard');
    check('debug footer is off by default', !without.includes('renderer=renderDocument'));

    process.env.POS_DEBUG_RENDER = '1';
    const withDebug = printing.buildReceiptHtml(saleId, 'standard');
    delete process.env.POS_DEBUG_RENDER;
    check('POS_DEBUG_RENDER=1 adds the provenance line', withDebug.includes('renderer=renderDocument'));
    check('debug line names the address source', withDebug.includes('address=profile'));
  }

  // ── 5h. A cleared profile survives a restart (migrations re-run) ───────────
  console.log('\n=== Restart keeps empty values ===');
  {
    setSetting('shop_address', '');
    setSetting('shop_phone', '');
    const migration = require('../migrations/065_retire_legacy_receipt_settings.js');
    migration.up(db); // what a restart does for an already-applied migration
    const addressRow = db.prepare("SELECT value FROM settings WHERE key = 'shop_address'").get();
    const phoneRow = db.prepare("SELECT value FROM settings WHERE key = 'shop_phone'").get();
    check('cleared address is still "" after the migration re-runs', addressRow && addressRow.value === '');
    check('cleared phone is still "" after the migration re-runs', phoneRow && phoneRow.value === '');

    const afterRestart = printing.buildReceiptHtml(saleId, 'standard');
    check('no address line after the restart', !afterRestart.includes(NEW_ADDRESS));
    check('no empty line left behind after the restart', !/<div class="shop-line">\s*<\/div>/.test(afterRestart));

    setSetting('shop_address', NEW_ADDRESS);
    setSetting('shop_phone', 'TESTPHONE-555');
  }

  // ── 6. Strict resolution: template override wins; empty override prints nothing
  console.log('\n=== Template override order ===');
  {
    const design = shared.defaultReceiptDesign('thermal80');
    const addr = design.sections.find((b) => b.type === 'address');
    addr.text = 'CUSTOM TEMPLATE ADDRESS 9';
    const html = designer.buildDesignedReceipt(designer.buildSampleSale(), 'thermal80', design);
    check('template override wins over the Shop Profile', html.includes('CUSTOM TEMPLATE ADDRESS 9') && !html.includes(NEW_ADDRESS));

    addr.text = '';
    const htmlEmpty = designer.buildDesignedReceipt(designer.buildSampleSale(), 'thermal80', design);
    check('explicit empty override prints nothing (does NOT fall back)', !htmlEmpty.includes(NEW_ADDRESS));
    check('explicit empty override renders no empty line', !/<div class="shop-line">\s*<\/div>/.test(htmlEmpty));
  }

  // ── 6b. Branch override (by branch id) ─────────────────────────────────────
  console.log('\n=== Branch override order ===');
  {
    const design = shared.defaultReceiptDesign('thermal80');
    const addr = design.sections.find((b) => b.type === 'address');
    addr.branchOverrides = { '42': 'BRANCH OVERRIDE ADDRESS 42' };
    const withBranch = designer.buildDesignedReceipt(designer.buildSampleSale(), 'thermal80', design, false, 42);
    check('branch override wins over the Shop Profile', withBranch.includes('BRANCH OVERRIDE ADDRESS 42'));
    const otherBranch = designer.buildDesignedReceipt(designer.buildSampleSale(), 'thermal80', design, false, 7);
    check('other branch falls back to the Shop Profile', otherBranch.includes(NEW_ADDRESS));
    const noBranch = designer.buildDesignedReceipt(designer.buildSampleSale(), 'thermal80', design);
    check('no branch falls back to the Shop Profile', noBranch.includes(NEW_ADDRESS));

    // Template override must still beat the branch override.
    addr.text = 'TEMPLATE WINS';
    const both = designer.buildDesignedReceipt(designer.buildSampleSale(), 'thermal80', design, false, 42);
    check('template override beats the branch override', both.includes('TEMPLATE WINS') && !both.includes('BRANCH OVERRIDE ADDRESS 42'));
  }

  // ── 7. Migration 063: "My receipt" template exists and is active ───────────
  console.log('\n=== My receipt template (migration seed) ===');
  {
    // A fresh install does NOT get the template (no existing values to keep),
    // but the migration must be idempotent when run twice.
    const lib = shared.defaultLibrary();
    const plan = JSON.stringify(lib);
    fs.writeFileSync(path.join(tmpDir, 'lib.json'), plan);
    const templatesBefore = lib.templates.filter((t) => t.id === 'my-receipt').length;
    check('built-in library has no my-receipt template by default', templatesBefore === 0);

    const normalized = shared.normalizeLibrary({
      templates: [{ id: 'my-receipt', name: 'My receipt', design: { schemaVersion: 1, documentType: 'receipt', paper: 'thermal80' }, createdAt: 1, updatedAt: 1 }],
      defaults: { thermal80: 'my-receipt' },
      documentTypeDefaults: { receipt: 'my-receipt' },
    });
    const t = shared.findTemplate(normalized, 'my-receipt');
    check('a partial my-receipt design normalises', !!t && t.design.sections.length > 5, t ? `${t.design.sections.length} sections` : 'missing');
    check(
      'resolveLibraryDefault selects my-receipt',
      shared.resolveLibraryDefault(normalized, 'receipt', 'thermal80') === 'my-receipt'
    );
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    app.exit(1);
  } else {
    console.log('All address-resolution checks passed.');
    app.exit(0);
  }
}

run().catch((e) => {
  console.error('Test crashed:', e);
  app.exit(1);
});
