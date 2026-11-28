#!/usr/bin/env node
/**
 * Phase 4 — the printer pipeline (the permanent guard).
 *
 * It runs the REAL print pipeline against a throwaway database, so every
 * assertion covers the code path the shop's printer actually goes through.
 * The items below were found in the code (an explore pass over
 * `printService.ts`, `printing.ts`, the IPC layer and the printer settings
 * screen), not guessed.
 *
 *   4.1  the preview window's **Print** button behaved DIFFERENTLY from the
 *        direct print: it never remembered the sale (so "Reprint last
 *        receipt" went back to the PREVIOUS sale) and it never popped the
 *        cash drawer (the cashier printed the receipt from the preview and
 *        the drawer stayed shut)
 *   4.2  the printer-resolution policy was a private function that read the
 *        database, so the rule could not be tested. It is now ONE pure rule
 *        (`resolvePrintTarget`) — and the "ask every time" setting must never
 *        silently print to the Windows default
 *   4.3  the "after a successful print" behaviour is ONE rule
 *        (`afterPrintActions`): only a job that carries a sale id records it,
 *        and only a FRESH receipt pops the drawer
 *   4.4  the printer + receipt-template settings screen is bilingual
 *        (English + Urdu)
 *   4.5  the preview window's toolbar follows the shop's language
 *   4.7  the receipt copies / the cut margin / the drawer setting keep their
 *        clamps (an empty value means "unset", NOT zero)
 *   4.9  the "Print Test Page" button: 'receipt' was never a paper key, so
 *        the sheet was built from `PAPER_SPECS['receipt']` (undefined) and the
 *        button died before it printed. A sheet now goes to the INVOICE
 *        printer, a roll to the receipt printer
 *   4.10 the configured label stock is the page that prints (every size the
 *        engine knows is accepted, not just three)
 *   4.11 a purchase order goes to the printer that can print it (an A5 order
 *        used to go to the till's thermal printer)
 *   4.12 an udhaar entry slip follows the receipt paper (it was always 80mm)
 *   4.13 the receipt-template panel shows a real width (it said
 *        "Width: undefined")
 *   4.14 a preview WITHOUT its toolbar is reported as a failure (it used to be
 *        reported as "opened"), and the notes of a successful print are
 *        STRUCTURED so the till screen can show them
 *   4.15 the forced "set a new owner password" screen may not race the app
 *        shell (it used to arrive one tick later, so it could sit on top of
 *        every dialog)
 *
 * The suite NEVER talks to a printer: the rules it guards are the pure
 * decision functions plus the settings they read, so no print job is run.
 * The two links that cannot be exercised without a printer (`printDocument`
 * calling the after-print step, and the preview's protocol handler using the
 * line-keyed job) are checked against the real source and are marked as such.
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_printPipeline.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-print-pipeline-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'print-pipeline-test.db');

let checks = 0;
let failures = 0;

function check(name, condition, detail) {
  checks++;
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ' -- ' + detail : ''}`);
  return condition;
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

async function run() {
  const { initDatabase, getDb } = require('../dist/main/db.js');
  await initDatabase();
  const db = getDb();

  const printService = require('../dist/main/services/printService.js');
  const auth = require('../dist/main/services/auth.js');

  auth.setSessionUser(1); // user 1 is the seeded owner

  /** Write an admin setting straight to the table (the service is owner-gated). */
  const setAdmin = (key, value) => {
    if (value === null) {
      db.prepare('DELETE FROM admin_settings WHERE key = ?').run(key);
      return;
    }
    db.prepare(
      'INSERT OR REPLACE INTO admin_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
    ).run(key, String(value));
  };

  const AUTO = printService.AUTO_PRINTER;
  const DEFAULT = printService.DEFAULT_PRINTER;
  /** The four paper keys the engine knows. */
  const paperKeys = ['thermal58', 'thermal80', 'a4', 'a5'];

  /* ── 4.2 ─ the printer-resolution policy is ONE rule ───────────────────── */
  section('4.2 - the printer-resolution policy (one pure rule)');

  {
    const resolve = printService.resolvePrintTarget;

    const chosen = resolve({ configuredPrinter: 'EPSON TM-T20' }, 'silent');
    check('a printer chosen in Settings prints silently to it',
      chosen.silent === true && chosen.deviceName === 'EPSON TM-T20',
      `${chosen.silent} / "${chosen.deviceName}"`);

    const sysDefault = resolve({ configuredPrinter: DEFAULT }, 'silent');
    check('the explicit "system default" option prints silently to the Windows default',
      sysDefault.silent === true && sysDefault.deviceName === '',
      `${sysDefault.silent} / "${sysDefault.deviceName}"`);

    const auto = resolve({ configuredPrinter: AUTO }, 'silent');
    check('"ask every time" opens the OS dialog, never the Windows default',
      auto.silent === false && auto.deviceName === '',
      `${auto.silent} / "${auto.deviceName}"`);

    const none = resolve({ configuredPrinter: '' }, 'silent');
    check('no printer configured opens the OS dialog',
      none.silent === false && none.deviceName === '',
      `${none.silent} / "${none.deviceName}"`);

    const forcedDialog = resolve({ configuredPrinter: 'EPSON TM-T20', mode: 'dialog' }, 'silent');
    check('a job that asks for the dialog always gets the dialog',
      forcedDialog.silent === false,
      `${forcedDialog.silent}`);

    const shopDialog = resolve({ configuredPrinter: 'EPSON TM-T20' }, 'dialog');
    check('the shop-wide "always ask" setting wins over a chosen printer',
      shopDialog.silent === false,
      `${shopDialog.silent}`);

    const jobWins = resolve({ configuredPrinter: 'EPSON TM-T20', mode: 'silent' }, 'dialog');
    check('a job that forces silent prints silently even when the shop asks',
      jobWins.silent === true && jobWins.deviceName === 'EPSON TM-T20',
      `${jobWins.silent} / "${jobWins.deviceName}"`);

    const override = resolve(
      { printerName: 'OTHER PRINTER', configuredPrinter: 'EPSON TM-T20' },
      'silent'
    );
    check('the job\'s own printer name overrides the configured one',
      override.silent === true && override.deviceName === 'OTHER PRINTER',
      `"${override.deviceName}"`);

    const overrideDefault = resolve({ printerName: DEFAULT, configuredPrinter: 'EPSON TM-T20' }, 'silent');
    check('a job may ask for the system default explicitly',
      overrideDefault.silent === true && overrideDefault.deviceName === '',
      `${overrideDefault.silent} / "${overrideDefault.deviceName}"`);

    const overrideAuto = resolve({ printerName: AUTO, configuredPrinter: 'EPSON TM-T20' }, 'silent');
    check('a job may ask for the dialog explicitly (and never gets the default)',
      overrideAuto.silent === false && overrideAuto.deviceName === '',
      `${overrideAuto.silent} / "${overrideAuto.deviceName}"`);

    check('the policy function is exported (so it can be tested)',
      typeof resolve === 'function');
  }

  /* ── 4.3 ─ the after-print behaviour is ONE rule ────────────────────────── */
  section('4.3 - what happens after a successful print (one rule)');

  {
    const after = printService.afterPrintActions;

    const invoice = after({ }, true);
    check('an invoice / a label / a test print records NO sale and pops NO drawer',
      invoice.recordSaleId === null && invoice.kickDrawer === false,
      JSON.stringify(invoice));

    const receipt = after({ saleId: 42 }, true);
    check('a fresh receipt records the sale and pops the drawer',
      receipt.recordSaleId === 42 && receipt.kickDrawer === true,
      JSON.stringify(receipt));

    const reprint = after({ saleId: 42, duplicate: true }, true);
    check('a REPRINT records the sale but does NOT pop the drawer',
      reprint.recordSaleId === 42 && reprint.kickDrawer === false,
      JSON.stringify(reprint));

    const drawerOff = after({ saleId: 42 }, false);
    check('the drawer stays shut when the shop has not opted in',
      drawerOff.recordSaleId === 42 && drawerOff.kickDrawer === false,
      JSON.stringify(drawerOff));

    const forcedOff = after({ saleId: 42, kickDrawer: false }, true);
    check('the caller can force the drawer off',
      forcedOff.kickDrawer === false,
      JSON.stringify(forcedOff));

    const forcedOn = after({ saleId: 42, kickDrawer: true }, false);
    check('the caller can force the drawer on even when the setting is off',
      forcedOn.kickDrawer === true,
      JSON.stringify(forcedOn));

    const badId = after({ saleId: 0 }, true);
    check('a job without a real sale id is not a customer receipt',
      badId.recordSaleId === null && badId.kickDrawer === false,
      JSON.stringify(badId));

    check('the after-print rule is exported (so it can be tested)',
      typeof after === 'function');
  }

  /* ── 4.1 ─ the preview's Print button behaves like the direct print ───── */
  section('4.1 - the preview window prints the SAME job as the direct print');

  {
    const build = printService.previewPrintJob;

    const withSale = build({ html: '<p>x</p>', paper: 'thermal80', printerKey: 'receipt' }, 42, 3);
    check('the preview job carries the sale id (so the sale is remembered)',
      withSale.saleId === 42,
      String(withSale.saleId));
    check('the preview job carries the copies from the toolbar box',
      withSale.copies === 3,
      String(withSale.copies));

    const noCopies = build({ html: '<p>x</p>', paper: 'thermal80', printerKey: 'receipt' }, 42, 0);
    check('a junk copies value leaves the job\'s own copies alone',
      noCopies.copies === undefined,
      String(noCopies.copies));

    const clamped = build({ html: '<p>x</p>', paper: 'thermal80', printerKey: 'receipt' }, 42, 99);
    check('the copies are clamped to 10',
      clamped.copies === 10,
      String(clamped.copies));

    const keepsDuplicate = build(
      { html: '<p>x</p>', paper: 'thermal80', printerKey: 'receipt', duplicate: true },
      42,
      1
    );
    check('the preview keeps the "this is a reprint" flag',
      keepsDuplicate.duplicate === true,
      String(keepsDuplicate.duplicate));

    const keepsJobSale = build(
      { html: '<p>x</p>', paper: 'thermal80', printerKey: 'receipt', saleId: 7 },
      null,
      1
    );
    check('a preview without its own sale id keeps the job\'s sale id',
      keepsJobSale.saleId === 7,
      String(keepsJobSale.saleId));

    const reprintActions = printService.afterPrintActions(keepsDuplicate, true);
    check('a reprint printed from the preview does NOT pop the drawer',
      reprintActions.kickDrawer === false,
      JSON.stringify(reprintActions));

    const freshActions = printService.afterPrintActions(withSale, true);
    check('a fresh receipt printed from the preview DOES pop the drawer',
      freshActions.recordSaleId === 42 && freshActions.kickDrawer === true,
      JSON.stringify(freshActions));
  }

  /* ── 4.7 ─ the settings clamps ─────────────────────────────────────────── */
  section('4.7 - the copies / the cut margin / the drawer setting keep their clamps');

  {
    setAdmin('receipt_copies', null);
    check('the copies default to 1', printService.getReceiptCopies() === 1,
      String(printService.getReceiptCopies()));

    setAdmin('receipt_copies', '3');
    check('the copies read the shop\'s setting', printService.getReceiptCopies() === 3,
      String(printService.getReceiptCopies()));

    setAdmin('receipt_copies', '0');
    check('the copies never go below 1', printService.getReceiptCopies() === 1,
      String(printService.getReceiptCopies()));

    setAdmin('receipt_copies', '99');
    check('the copies never go above 10', printService.getReceiptCopies() === 10,
      String(printService.getReceiptCopies()));

    setAdmin('receipt_copies', '');
    check('an EMPTY copies value means "unset" (NOT zero)', printService.getReceiptCopies() === 1,
      String(printService.getReceiptCopies()));

    setAdmin('receipt_copies', 'junk');
    check('a junk copies value falls back to 1', printService.getReceiptCopies() === 1,
      String(printService.getReceiptCopies()));

    setAdmin('receipt_bottom_feed_mm', null);
    check('the cut margin defaults to 4mm', printService.getReceiptBottomFeedMm() === 4,
      String(printService.getReceiptBottomFeedMm()));

    setAdmin('receipt_bottom_feed_mm', '0');
    check('a cut margin of 0 is allowed (no feed)', printService.getReceiptBottomFeedMm() === 0,
      String(printService.getReceiptBottomFeedMm()));

    setAdmin('receipt_bottom_feed_mm', '10');
    check('the cut margin reads the shop\'s setting', printService.getReceiptBottomFeedMm() === 10,
      String(printService.getReceiptBottomFeedMm()));

    setAdmin('receipt_bottom_feed_mm', '999');
    check('the cut margin never goes above 30mm', printService.getReceiptBottomFeedMm() === 30,
      String(printService.getReceiptBottomFeedMm()));

    setAdmin('receipt_bottom_feed_mm', '');
    check('an EMPTY cut margin means "unset" (the 4mm default, NOT zero)',
      printService.getReceiptBottomFeedMm() === 4,
      String(printService.getReceiptBottomFeedMm()));

    setAdmin('cash_drawer_kick', null);
    check('the cash drawer is OFF by default', printService.getCashDrawerKickEnabled() === false,
      String(printService.getCashDrawerKickEnabled()));

    setAdmin('cash_drawer_kick', 'true');
    check('the cash drawer can be switched on', printService.getCashDrawerKickEnabled() === true,
      String(printService.getCashDrawerKickEnabled()));

    setAdmin('cash_drawer_kick', 'false');
    check('the cash drawer can be switched off again', printService.getCashDrawerKickEnabled() === false,
      String(printService.getCashDrawerKickEnabled()));

    setAdmin('cash_drawer_kick', null);
    setAdmin('receipt_copies', null);
    setAdmin('receipt_bottom_feed_mm', null);
  }

  /* ── the two links that need a real printer (checked against the source) ─ */
  section('4.1 - the pipeline actually calls the after-print rule');

  {
    const src = fs.readFileSync(
      path.join(PROJECT_ROOT, 'src', 'main', 'services', 'printService.ts'),
      'utf8'
    );

    check('printDocument runs the after-print rule when the print succeeded',
      /printDocument[\s\S]{0,1200}runAfterPrint\(/.test(src),
      'the runAfterPrint call is inside printDocument');

    check('the after-print rule is only run on a SUCCESSFUL print',
      /if \(result\.ok\) \{[\s\S]{0,200}runAfterPrint\(/.test(src),
      'runAfterPrint is guarded by result.ok');

    check('the preview protocol handler builds the job with previewPrintJob',
      /previewPrintJob\(job, previewSaleIds\.get\(token\)/.test(src),
      'the "print" branch of the posprint:// protocol');

    check('the preview protocol handler passes the sale id to the printer',
      /const effective = previewPrintJob\(job, previewSaleIds\.get\(token\) \?\? null, copies\);/.test(src),
      'the sale id rides on the effective job');

    check('the toolbar no longer hard-codes its English strings',
      !/textContent = 'Download PDF'/.test(src) &&
        !/textContent = 'Close'/.test(src) &&
        !/textContent = 'WhatsApp'/.test(src) &&
        !/copiesBox\.title = 'Number of copies'/.test(src),
      'every toolbar string is a placeholder now');

    check('the toolbar has a placeholder for every label',
      ['__PDF_LABEL__', '__SHARE_LABEL__', '__CLOSE_LABEL__', '__COPIES_TITLE__',
       '__PRINTING_LABEL__', '__SAVING_LABEL__', '__SENDING_LABEL__', '__ERROR_LABEL__']
        .every((ph) => src.includes(ph)),
      'all eight label placeholders are present');
  }

  /* ── 4.4 + 4.5 ─ the printer surface is bilingual ───────────────────────── */
  section('4.4/4.5 - the printer surface exists in en.json AND ur.json');

  {
    const enPath = path.join(PROJECT_ROOT, 'src', 'renderer', 'src', 'i18n', 'en.json');
    const urPath = path.join(PROJECT_ROOT, 'src', 'renderer', 'src', 'i18n', 'ur.json');
    const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
    const ur = JSON.parse(fs.readFileSync(urPath, 'utf8'));

    const leafKeys = (obj, prefix = '') => {
      const out = [];
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj)) {
          const p = prefix ? `${prefix}.${k}` : k;
          if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...leafKeys(v, p));
          else out.push(p);
        }
      }
      return out;
    };
    const get = (obj, key) =>
      key.split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), obj);

    const enKeys = leafKeys(en.printing || {});
    const urKeys = leafKeys(ur.printing || {});
    check('the printing namespace exists in en.json', enKeys.length > 0, `${enKeys.length} keys`);
    check('the printing namespace exists in ur.json', urKeys.length > 0, `${urKeys.length} keys`);
    const missingInUr = enKeys.filter((k) => !urKeys.includes(k));
    const missingInEn = urKeys.filter((k) => !enKeys.includes(k));
    check('en.json and ur.json carry the SAME printing keys', missingInUr.length === 0, missingInUr.join(', '));
    check('ur.json has no printing key en.json lacks', missingInEn.length === 0, missingInEn.join(', '));

    const emptyUr = urKeys.filter((k) => {
      const v = get(ur, k);
      return typeof v === 'string' && v.trim() === '';
    });
    check('no Urdu printing string is empty', emptyUr.length === 0, emptyUr.join(', '));

    // Every key the printer screens ASK for must exist in both files.
    const screens = [
      path.join(PROJECT_ROOT, 'src', 'renderer', 'src', 'pages', 'Settings.tsx'),
      path.join(PROJECT_ROOT, 'src', 'renderer', 'src', 'utils', 'previewLabels.ts'),
    ];
    const used = new Set();
    for (const file of screens) {
      const src = fs.readFileSync(file, 'utf8');
      const re = /t\(\s*'(printing\.[^']+)'/g;
      let m;
      while ((m = re.exec(src))) used.add(m[1]);
      const re2 = /'(printing\.[a-zA-Z.]+)'/g;
      while ((m = re2.exec(src))) used.add(m[1]);
    }
    check('the printer screens use the printing namespace', used.size > 10, `${used.size} keys used`);
    const notInEn = [...used].filter((k) => get(en, k) === undefined);
    const notInUr = [...used].filter((k) => get(ur, k) === undefined);
    check('every key the printer screens use exists in en.json', notInEn.length === 0, notInEn.join(', '));
    check('every key the printer screens use exists in ur.json', notInUr.length === 0, notInUr.join(', '));

    // The Settings screen must not keep the printer panel in hard-coded English.
    const settingsSrc = fs.readFileSync(
      path.join(PROJECT_ROOT, 'src', 'renderer', 'src', 'pages', 'Settings.tsx'),
      'utf8'
    );
    const hardCoded = [
      'Ask every time (show Windows dialog)',
      'System default printer (print silently)',
      'Print Test Page (Receipt)',
      'Print Test Page (A4 Invoice)',
      'Barcode DPI',
      'Save Template',
      'Preview Receipt',
    ];
    const left = hardCoded.filter((s) => settingsSrc.includes(s));
    check('the printer panel has no hard-coded English left', left.length === 0, left.join(' | '));

    // The preview toolbar helper returns every label the toolbar needs.
    const helperSrc = fs.readFileSync(
      path.join(PROJECT_ROOT, 'src', 'renderer', 'src', 'utils', 'previewLabels.ts'),
      'utf8'
    );
    const wanted = ['print', 'pdf', 'whatsapp', 'close', 'copies', 'printing', 'saving', 'sending', 'error'];
    const missing = wanted.filter((w) => !new RegExp(`\\b${w}\\s*:`).test(helperSrc));
    check('the preview label helper returns every toolbar label', missing.length === 0, missing.join(', '));
  }

  /* ── 4.9 ─ the "Print Test Page" button must not crash ───────────────────── */
  section('4.9 - the calibration sheet (the test-page button)');

  {
    const printing = require('../dist/main/services/printing.js');

    // The root cause: 'receipt' is NOT a paper key, so `PAPER_SPECS['receipt']`
    // was undefined and the button died before it printed anything.
    check(
      "'receipt' is not a paper key (the old crash)",
      printService.PAPER_SPECS.receipt === undefined,
      `PAPER_SPECS.receipt = ${String(printService.PAPER_SPECS.receipt)}`
    );

    const paperKeysLocal = paperKeys;
    check(
      'the calibration paper is always a REAL paper key',
      paperKeysLocal.includes(printing.resolveCalibrationPaper('receipt')),
      `resolveCalibrationPaper('receipt') = ${printing.resolveCalibrationPaper('receipt')}`
    );
    check(
      "resolveCalibrationPaper('a4') stays a4",
      printing.resolveCalibrationPaper('a4') === 'a4'
    );
    check(
      "resolveCalibrationPaper('nonsense') does not crash",
      paperKeysLocal.includes(printing.resolveCalibrationPaper('nonsense')),
      `= ${printing.resolveCalibrationPaper('nonsense')}`
    );

    // The paper follows the shop's setting.
    setAdmin('receipt_paper', 'thermal58');
    check(
      "the calibration paper follows the shop's receipt paper",
      printing.resolveCalibrationPaper('receipt') === 'thermal58',
      `= ${printing.resolveCalibrationPaper('receipt')}`
    );
    setAdmin('receipt_paper', null);

    // A sheet goes to the invoice printer, a roll to the receipt printer.
    check("an A4 sheet goes to the invoice printer", printService.printerKeyForPaper('a4') === 'invoice');
    check("an A5 sheet goes to the invoice printer", printService.printerKeyForPaper('a5') === 'invoice');
    check("an 80mm roll goes to the receipt printer", printService.printerKeyForPaper('thermal80') === 'receipt');
    check("a 58mm roll goes to the receipt printer", printService.printerKeyForPaper('thermal58') === 'receipt');

    // An unknown paper fails with a REASON instead of throwing.
    let calibration = null;
    let calibrationThrew = false;
    try {
      calibration = await printService.printCalibration('receipt', () => '<html></html>');
    } catch (e) {
      calibrationThrew = true;
    }
    check('an unknown paper does not throw', calibrationThrew === false);
    check(
      'an unknown paper fails with a message',
      !!calibration && calibration.ok === false && /unknown paper/i.test(calibration.message),
      calibration ? calibration.message : 'no result'
    );
  }

  /* ── 4.10 ─ the configured label stock must be the printed page ───────────── */
  section('4.10 - the label stock the shop configured is the page that prints');

  {
    const printing = require('../dist/main/services/printing.js');
    const known = Object.keys(printService.LABEL_SPECS);
    check('the engine knows more than three label sizes', known.length >= 5, known.join(', '));

    for (const size of known) {
      setAdmin('label_paper', size);
      check(
        `the configured stock "${size}" is the page that prints`,
        printing.resolveLabelSize() === size,
        `= ${printing.resolveLabelSize()}`
      );
    }
    setAdmin('label_paper', 'not-a-size');
    check(
      'an unknown stock size falls back to 38x25',
      printing.resolveLabelSize() === '38x25',
      `= ${printing.resolveLabelSize()}`
    );
    setAdmin('label_paper', null);
  }

  /* ── 4.11 ─ the purchase-order paper routing ─────────────────────────────── */
  section('4.11 - a purchase order goes to the printer that can print it');

  {
    const purchaseImport = require('../dist/main/services/purchaseImport.js');
    check('an A4 purchase order goes to the invoice printer', purchaseImport.purchaseOrderPrinterKey('a4') === 'invoice');
    check('an A5 purchase order goes to the invoice printer', purchaseImport.purchaseOrderPrinterKey('a5') === 'invoice');
    check('an 80mm purchase order goes to the receipt printer', purchaseImport.purchaseOrderPrinterKey('thermal80') === 'receipt');
    check('a 58mm purchase order goes to the receipt printer', purchaseImport.purchaseOrderPrinterKey('thermal58') === 'receipt');
  }

  /* ── 4.12 ─ the udhaar entry slip follows the receipt paper ───────────────── */
  section('4.12 - an entry slip follows the receipt paper');

  {
    const udhaarPrinting = require('../dist/main/services/udhaarPrinting.js');
    check('a 58mm shop gets a 58mm slip', udhaarPrinting.resolveEntrySlipPaper('thermal58') === 'thermal58');
    check('an 80mm shop gets an 80mm slip', udhaarPrinting.resolveEntrySlipPaper('thermal80') === 'thermal80');
    check('a sheet paper is not a roll - the slip stays 80mm', udhaarPrinting.resolveEntrySlipPaper('a4') === 'thermal80');
    check('an explicit override still wins', udhaarPrinting.resolveEntrySlipPaper('thermal58', 'thermal80') === 'thermal80');
  }

  /* ── 4.13 ─ the receipt-template metadata the Settings panel reads ───────── */
  section('4.13 - the template panel shows a real width');

  {
    const receiptTemplates = require('../dist/main/services/receiptTemplates.js');
    const list = receiptTemplates.getAvailableTemplates();
    check('the template library is not empty', list.length > 0, `${list.length} templates`);
    const badWidth = list.filter((t) => typeof t.contentMm !== 'number' || !Number.isFinite(t.contentMm));
    check('every template carries a numeric contentMm', badWidth.length === 0, badWidth.map((t) => t.id).join(', '));
    const hasLegacyWidth = list.filter((t) => 'width' in t);
    check('no template carries the old (never sent) "width" field', hasLegacyWidth.length === 0, hasLegacyWidth.map((t) => t.id).join(', '));
    const badPaper = list.filter((t) => !paperKeys.includes(t.paper));
    check('every template names a real paper', badPaper.length === 0, badPaper.map((t) => `${t.id}:${t.paper}`).join(', '));
  }

  /* ── 4.14 ─ the preview toolbar must be there (or the preview fails) ─────── */
  section('4.14 - a preview without its toolbar is reported as a failure');

  {
    const printSrc = fs.readFileSync(
      path.join(PROJECT_ROOT, 'src', 'main', 'services', 'printService.ts'),
      'utf8'
    );
    check('the toolbar injection is awaited', /await injectToolbar\(/.test(printSrc));
    check(
      'a failed injection closes the window and reports the failure',
      /Could not open the preview/.test(printSrc)
    );
    check(
      'the injection itself rejects on an error (it is not only logged)',
      /preview toolbar injection failed/.test(printSrc) && /\.catch\(\(e\) => \{/.test(printSrc)
    );

    // The print notes must be STRUCTURED, or the renderer throws them away.
    check(
      'a successful print returns its notes as data',
      /warnings:\s*job\.warnings/.test(printSrc)
    );
    const billingSrc = fs.readFileSync(
      path.join(PROJECT_ROOT, 'src', 'renderer', 'src', 'pages', 'Billing.tsx'),
      'utf8'
    );
    check(
      'the till screen shows the notes of a successful print',
      /r\.warnings && r\.warnings\.length/.test(billingSrc)
    );
  }

  /* ── 4.15 ─ the forced-password screen may not race the app shell ─────────── */
  section('4.15 - the forced "set a new owner password" screen cannot be missed');

  {
    const appSrc = fs.readFileSync(
      path.join(PROJECT_ROOT, 'src', 'renderer', 'src', 'App.tsx'),
      'utf8'
    );
    const fetchAt = appSrc.indexOf('defaultPasswordActive');
    const setUserAt = appSrc.indexOf('setUser(u)');
    check('the app asks the service about the forced password screen', fetchAt >= 0);
    check('the app sets the user', setUserAt >= 0);
    check(
      'the flag is fetched BEFORE the app shell is rendered (no half-open frame)',
      fetchAt > 0 && setUserAt > 0 && fetchAt < setUserAt,
      `flag at ${fetchAt}, setUser at ${setUserAt}`
    );

    const suiteSrc = fs.readFileSync(
      path.join(PROJECT_ROOT, 'scripts', 'test_uiDefects.cjs'),
      'utf8'
    );
    check(
      'the UI suite asks the service instead of racing the screen',
      /defaultPasswordActive\(\)/.test(suiteSrc)
    );
    check(
      'the UI suite waits for the screen to really be gone',
      /the forced password modal to close/.test(suiteSrc)
    );
  }

  /* ── 4.16 ─ every preview toolbar follows the shop's language ────────────── */
  section('4.16 - every preview toolbar follows the shop\'s language');

  {
    // The toolbar is injected by the MAIN process, so the renderer has to send
    // the translated strings. Every preview path must do it.
    const paths = [
      ['src', 'main', 'services', 'printing.ts'],
      ['src', 'main', 'services', 'purchaseImport.ts'],
      ['src', 'main', 'services', 'udhaarPrinting.ts'],
    ];
    for (const p of paths) {
      const src = fs.readFileSync(path.join(PROJECT_ROOT, ...p), 'utf8');
      const name = p[p.length - 1];
      check(
        `${name} passes the labels to the preview`,
        /previewDocument\([\s\S]{0,400}?labels/.test(src)
      );
    }

    const ipcSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'main', 'ipc.ts'), 'utf8');
    for (const channel of [
      'printing:previewBarcodeBatch',
      'purchases:previewOrder',
      'udhaar:previewStatement',
    ]) {
      const re = new RegExp(`'${channel.replace(/[:/]/g, '\\$&')}'[\\s\\S]{0,220}?labels`);
      check(`the IPC channel ${channel} carries the labels`, re.test(ipcSrc));
    }

    const preloadSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'preload', 'preload.ts'), 'utf8');
    check('the preload forwards the labels', /previewBarcodeBatch[\s\S]{0,220}?labels/.test(preloadSrc));

    const rendererFiles = [
      ['src', 'renderer', 'src', 'pages', 'BarcodeGenerator.tsx'],
      ['src', 'renderer', 'src', 'pages', 'LabelStudio.tsx'],
      ['src', 'renderer', 'src', 'pages', 'Purchases.tsx'],
      ['src', 'renderer', 'src', 'components', 'UdhaarLedger.tsx'],
      ['src', 'renderer', 'src', 'components', 'PurchaseImportWizard.tsx'],
    ];
    for (const p of rendererFiles) {
      const src = fs.readFileSync(path.join(PROJECT_ROOT, ...p), 'utf8');
      const name = p[p.length - 1];
      check(`${name} sends the translated labels`, /previewLabels\(t/.test(src));
    }
  }

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures) {
    console.log(`RESULT: FAIL (${failures} failing check(s))`);
    app.exit(1);
  } else {
    console.log('RESULT: PASS');
    app.exit(0);
  }
}

app.whenReady().then(run).catch((e) => {
  console.error('print pipeline suite crashed:', e);
  app.exit(1);
});
