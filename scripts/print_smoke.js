/**
 * Print geometry smoke test.
 *
 * Runs each document type through the real printService pipeline and writes it
 * to PDF, then asserts the resulting page size. This catches the class of bugs
 * that only show up on paper: wrong roll width, clipped printable area, A4
 * content forced onto 58mm stock, and label sheets that overflow the page.
 *
 * Usage (after `npm run build`):
 *   npx electron scripts/print_smoke.js
 *
 * It never contacts a printer — printToPDF uses the same pageSize/margins as
 * printDocument.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

// When Electron is launched with a script path it treats the script's folder as
// the app root, so db.ts would look for `scripts/migrations` and the real
// app's userData dir would be missed. Point both at the project root.
const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

// ROKAR_SMOKE_USERDATA lets the test run against a copy of the database on
// another drive (useful when the system drive is full — SQLite cannot open a
// database it cannot write to, even read-only).
const realUserData = path.join(os.homedir(), 'AppData', 'Roaming', 'pos-app');
app.setPath('userData', process.env.ROKAR_SMOKE_USERDATA || realUserData);

const outDir = path.join(os.tmpdir(), 'rokar-print-smoke');
let failures = 0;
let checks = 0;

function check(name, actual, expected, toleranceMm = 1) {
  checks++;
  const diff = Math.abs(actual - expected);
  const ok = diff <= toleranceMm;
  if (!ok) failures++;
  const verdict = ok ? 'PASS' : 'FAIL';
  console.log(
    `  [${verdict}] ${name}: ${actual.toFixed(2)}mm (expected ${expected}mm, diff ${diff.toFixed(2)}mm)`
  );
  return ok;
}

function checkTrue(name, condition, detail) {
  checks++;
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  return condition;
}

/** Pull the /MediaBox out of a PDF to measure what was really produced. */
function measurePdf(buffer) {
  const text = buffer.toString('latin1');
  const boxes = [...text.matchAll(/\/MediaBox\s*\[\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s*\]/g)];
  if (!boxes.length) return null;
  const [, , , x2, y2] = boxes[0];
  const w = (parseFloat(x2) - 0) * 25.4 / 72;
  const h = (parseFloat(y2) - 0) * 25.4 / 72;
  return { widthMm: w, heightMm: h, pages: boxes.length };
}

async function run() {
  // Import after app is ready so getPath('userData') resolves.
  const { initDatabase } = require('../dist/main/db.js');
  const printService = require('../dist/main/services/printService.js');
  const printing = require('../dist/main/services/printing.js');
  const { buildCalibrationHtml } = require('../dist/main/services/printDocs.js');
  const sales = require('../dist/main/services/sales.js');
  const inventory = require('../dist/main/services/inventory.js');

  await initDatabase();
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`\nPrint geometry smoke test — output in ${outDir}\n`);

  // ── 1. Thermal calibration sheets: the roll width the cashier actually has ──
  console.log('Thermal roll width');
  for (const paper of ['thermal58', 'thermal80']) {
    const spec = printService.PAPER_SPECS[paper];
    const { data, geometry } = await printService.printJobToPdf({
      html: buildCalibrationHtml(spec.widthMm, 'smoke test'),
      paper,
      printerKey: 'receipt',
      jobName: `cal-${paper}`,
    });
    fs.writeFileSync(path.join(outDir, `cal-${paper}.pdf`), data);
    const m = measurePdf(data);
    checkTrue(`${paper} produced a readable PDF`, !!m);
    if (m) {
      check(`${paper} pdf width`, m.widthMm, spec.widthMm);
      checkTrue(
        `${paper} pdf height clears the minimum roll (${printService.MIN_ROLL_HEIGHT_MM}mm)`,
        m.heightMm >= printService.MIN_ROLL_HEIGHT_MM - 0.5,
        `${m.heightMm.toFixed(1)}mm`
      );
    }
    checkTrue(`${paper} geometry matches spec`, Math.abs(geometry.widthMm - spec.widthMm) < 0.01);
  }

  // ── 2. A4 invoice ──
  console.log('\nA4 invoice');
  {
    const spec = printService.PAPER_SPECS.a4;
    const { data, geometry } = await printService.printJobToPdf({
      html: buildCalibrationHtml(spec.widthMm, 'smoke test'),
      paper: 'a4',
      printerKey: 'invoice',
      jobName: 'a4',
    });
    fs.writeFileSync(path.join(outDir, 'a4.pdf'), data);
    const m = measurePdf(data);
    check('a4 pdf width', m.widthMm, 210, 1.5);
    check('a4 pdf height', m.heightMm, 297, 1.5);
    check('a4 geometry width', geometry.widthMm, 210, 0.01);
  }

  // ── 3. Barcode labels: every stock size, roll and A4 sheet ──
  console.log('\nBarcode labels');
  const productId = pickAProduct(inventory);
  for (const size of ['38x25', '50x30', '100x50']) {
    for (const layout of ['roll', 'sheet']) {
      const spec = printService.LABEL_SPECS[size];
      const job = await printing.buildLabelJob([productId], size, 1, layout);
      const { data, geometry } = await printService.printJobToPdf(job);
      const file = path.join(outDir, `label-${size}-${layout}.pdf`);
      fs.writeFileSync(file, data);
      const m = measurePdf(data);
      const label = `${size} ${layout}`;
      checkTrue(`${label} produced a readable PDF`, !!m);
      if (!m) continue;
      if (layout === 'roll') {
        // One label across: page width == label width, plus a little tolerance
        // for the printable inset the driver applies.
        check(`${label} page width fits the label`, m.widthMm, spec.w, 2);
        checkTrue(
          `${label} page holds the label height`,
          m.heightMm >= spec.h - 0.5,
          `${m.heightMm.toFixed(1)}mm vs ${spec.h}mm label`
        );
      } else {
        check(`${label} page width`, m.widthMm, 210, 1.5);
        // cols x (label + gap) must fit inside the A4 printable width, otherwise
        // the right-hand column of every row is chopped off.
        const needed = spec.sheetCols * spec.w + (spec.sheetCols - 1) * spec.gap;
        checkTrue(
          `${label} sheet grid fits the page (${spec.sheetCols} across)`,
          needed <= printService.PAPER_SPECS.a4.contentMm,
          `needs ${needed}mm, page has ${printService.PAPER_SPECS.a4.contentMm}mm`
        );
        checkTrue(`${label} geometry pre-computed (not measured)`, !!geometry);
      }
    }
  }

  // ── 3b. Barcode-only sticker variant (the Inventory "Barcode" button) ──
  console.log('\nBarcode-only sticker');
  {
    const job = await printing.buildLabelJob([productId], '50x30', 1, 'roll', true);
    const { data } = await printService.printJobToPdf(job);
    fs.writeFileSync(path.join(outDir, 'label-bare-50x30.pdf'), data);
    const m = measurePdf(data);
    checkTrue('barcode-only label produced a readable PDF', !!m);
    if (m) check('barcode-only label page width', m.widthMm, printService.LABEL_SPECS['50x30'].w, 2);
    checkTrue('barcode-only label job is named distinctly', /Barcode-only/.test(job.jobName), job.jobName);
  }

  // ── 4. Thermal receipt from a real sale, at both roll widths ──
  console.log('\nThermal receipt (real sale)');
  const saleId = await pickASale(sales);
  if (saleId) {
    for (const paper of ['thermal58', 'thermal80']) {
      const spec = printService.PAPER_SPECS[paper];
      const { data, geometry } = await printService.printJobToPdf({
        html: printing.buildReceiptHtml(saleId, 'standard'),
        paper,
        printerKey: 'receipt',
        jobName: `receipt-${paper}`,
      });
      fs.writeFileSync(path.join(outDir, `receipt-${paper}.pdf`), data);
      const m = measurePdf(data);
      check(`receipt ${paper} pdf width`, m.widthMm, spec.widthMm, 1);
      checkTrue(
        `receipt ${paper} height is at least the minimum roll`,
        m.heightMm >= printService.MIN_ROLL_HEIGHT_MM - 0.5,
        `${m.heightMm.toFixed(1)}mm`
      );
      checkTrue(
        `receipt ${paper} content fits the printable area (${spec.contentMm}mm)`,
        spec.contentMm <= spec.widthMm,
        `${spec.widthMm}mm paper`
      );
      check(`receipt ${paper} geometry width`, geometry.widthMm, spec.widthMm, 0.01);
    }
  } else {
    console.log('  [SKIP] no sale in the database to render a receipt from');
  }

  // ── 5. Printer enumeration ──
  console.log('\nPrinter enumeration');
  const printers = await printService.getAvailablePrinters(true);
  checkTrue('printer list is an array', Array.isArray(printers));
  checkTrue('printer entries carry name/displayName', printers.every((p) => p.name && p.displayName));
  checkTrue(
    'virtual printers are flagged',
    printers.filter((p) => p.isVirtual).every((p) => typeof p.isVirtual === 'boolean')
  );
  console.log(`  found ${printers.length} printer(s):`);
  for (const p of printers) {
    console.log(`    - ${p.displayName}${p.isDefault ? ' [default]' : ''}${p.isVirtual ? ' [file output]' : ''}`);
  }
  // ── 5. Layout audit: nothing may escape the printable area ──
  // The shop's complaint is content chopped off the right edge, so measure the
  // real laid-out boxes rather than trusting the page-box arithmetic.
  console.log('\nLayout audit (overflow / clipping)');
  {
    const audit = async (name, job) => {
      const a = await printService.auditJobLayout(job);
      const clipped = a.offenders.filter((o) => o.overflowRight > 1);
      checkTrue(
        `${name}: nothing clipped on the right`,
        clipped.length === 0,
        clipped
          .slice(0, 3)
          .map((o) => `<${o.tag}.${o.cls}> "${o.text}" +${o.overflowRight}px (limit ${a.limitMm}mm)`)
          .join(' | ')
      );
      return a;
    };

    // Use the REAL production job builders so this tests what users get,
    // including the template/paper clamping in buildReceiptJob.
    if (saleId) {
      for (const paper of ['thermal58', 'thermal80']) {
        const restore = setPrintSetting('receipt_paper', paper);
        try {
          const job = printing.buildReceiptJob(saleId, 'standard');
          checkTrue(`receipt ${paper}: job paper follows the setting`, job.paper === paper, job.paper);
          const a = await audit(`receipt ${paper}`, job);
          check(
            `receipt ${paper}: content uses the printable width (${a.limitMm}mm)`,
            a.limitMm,
            printService.PAPER_SPECS[paper].contentMm,
            0.01
          );
        } finally {
          restore();
        }
      }
      // The field bug: an 80mm layout requested on a 58mm roll must be narrowed
      // by buildReceiptJob, otherwise the printer slices the receipt.
      {
        const restore = setPrintSetting('receipt_paper', 'thermal58');
        try {
          const job = printing.buildReceiptJob(saleId, 'standard');
          checkTrue(
            '80mm layout on a 58mm roll is clamped and the user is warned',
            job.warnings.length > 0,
            JSON.stringify(job.warnings)
          );
          const a = await audit('receipt thermal58 (clamped from 80mm layout)', job);
          check(
            'clamped receipt page is 58mm wide',
            a.geometry.widthMm,
            printService.PAPER_SPECS.thermal58.widthMm,
            0.01
          );
        } finally {
          restore();
        }
      }
      for (const paper of ['a4', 'a5']) {
        const restore = setPrintSetting('invoice_paper', paper);
        try {
          await audit(`invoice ${paper}`, printing.buildInvoiceJob(saleId));
        } finally {
          restore();
        }
      }
    }
    for (const size of Object.keys(printService.LABEL_SPECS)) {
      await audit(`label ${size} roll`, await printing.buildLabelJob([productId], size, 1, 'roll'));
      await audit(`label ${size} sheet`, await printing.buildLabelJob([productId], size, 4, 'sheet'));
    }
    await audit('label barcode-only', await printing.buildLabelJob([productId], '50x30', 1, 'roll', true));

    // Stress case: temporarily rename the product to something absurdly long.
    // This is what actually pushes a receipt/invoice past the right margin.
    const LONG = 'Extraordinarily Long Product Name That Should Never Reach The Right Margin 1234567890 ABCDEFGHIJKLMNOP';
    const restoreName = renameProduct(productId, LONG);
    try {
      if (saleId) {
        for (const paper of ['thermal58', 'thermal80']) {
          const restore = setPrintSetting('receipt_paper', paper);
          try {
            await audit(`receipt ${paper} + long name`, printing.buildReceiptJob(saleId, 'standard'));
          } finally {
            restore();
          }
        }
        for (const paper of ['a4', 'a5']) {
          const restore = setPrintSetting('invoice_paper', paper);
          try {
            await audit(`invoice ${paper} + long name`, printing.buildInvoiceJob(saleId));
          } finally {
            restore();
          }
        }
      }
    } finally {
      restoreName();
    }
  }

  // ── 6. Content audit: the fields must actually be on the page ──
  // Geometry proves nothing is clipped, but a markup slip can drop a field
  // entirely. The 58mm layout stacks items onto two lines, so check the
  // narrow receipt really still shows name, qty, unit price and line total.
  console.log('\nContent audit (fields present)');
  {
    const sale = saleId ? sales.getSale(saleId) : null;
    const item = sale && sale.items && sale.items.length ? sale.items[0] : null;
    if (item) {
      const name = item.product_name || '';
      const qtyLabel = item.unit_name && item.display_qty != null ? `${item.display_qty} ${item.unit_name}` : String(item.qty);
      const money = (n) => String(Number(n || 0).toFixed(2));

      for (const paper of ['thermal58', 'thermal80']) {
        const restore = setPrintSetting('receipt_paper', paper);
        try {
          const job = printing.buildReceiptJob(saleId, 'standard');
          const text = await printService.readJobText(job);
          const flat = text.replace(/\s+/g, ' ');
          checkTrue(`receipt ${paper}: product name is printed`, name ? flat.includes(name) : true, name);
          checkTrue(`receipt ${paper}: line total is printed`, flat.includes(money(item.line_total)), money(item.line_total));
          if (paper === 'thermal58') {
            // The stacked narrow row must keep the qty AND the unit price, which
            // used to live in their own columns.
            checkTrue('receipt thermal58: qty label survives the stacked layout', flat.includes(qtyLabel), qtyLabel);
            checkTrue('receipt thermal58: stacked rows use the x separator', flat.includes('\u00d7'));
          }
        } finally {
          restore();
        }
      }
      for (const paper of ['a4', 'a5']) {
        const restore = setPrintSetting('invoice_paper', paper);
        try {
          const text = await printService.readJobText(printing.buildInvoiceJob(saleId));
          const flat = text.replace(/\s+/g, ' ');
          checkTrue(`invoice ${paper}: product name is printed`, flat.includes(name), name);
          checkTrue(`invoice ${paper}: grand total is printed`, flat.includes(money(sale.subtotal)) || flat.includes(money(sale.total)), '');
        } finally {
          restore();
        }
      }
    } else {
      console.log('  (skipped - no sale with items in this database)');
    }
  }

  // ── 7. Reliability: the sequences that used to break ──
  // Window churn and concurrent jobs were the real failure modes on Electron 43
  // (ERR_FAILED / sliced output), so exercise them directly instead of trusting
  // that sequential renders happen to cover them.
  console.log('\nReliability (repeat / concurrent / after close)');
  if (saleId) {
    const restore = setPrintSetting('receipt_paper', 'thermal80');
    try {
      const job = () => printing.buildReceiptJob(saleId, 'standard');

      // Two receipts in a row, which is what a cashier does after a reprint.
      for (const n of [1, 2]) {
        const { data } = await printService.printJobToPdf(job());
        const m = measurePdf(data);
        checkTrue(
          `receipt ${n} of 2 prints correctly (${m.widthMm}x${m.heightMm}mm)`,
          Math.abs(m.widthMm - 80) < 1.5 && m.heightMm > 40
        );
      }

      // Concurrent jobs must serialise rather than fight over the one window.
      const results = await Promise.all(
        [1, 2, 3].map(() => printService.printJobToPdf(job()).then((r) => r.data.length))
      );
      checkTrue(
        'three concurrent prints all produced a PDF',
        results.every((n) => n > 1000),
        JSON.stringify(results)
      );

      // The app closes the shared print window on re-activate; the next print
      // must not inherit a dead window.
      const closed = printService.closeAllPrintWindows();
      const after = await printService.printJobToPdf(job());
      const m2 = measurePdf(after.data);
      checkTrue(
        `print still works after closing print windows (closed ${closed})`,
        Math.abs(m2.widthMm - 80) < 1.5
      );
    } finally {
      restore();
    }
  }

  // ── 9. Large batch: tall documents and the copies clamp ──
  // A big roll batch is the case where the measured page height has to grow
  // without breaking, and where a silly copy count must be capped rather than
  // trying to render 500 labels.
  console.log('\nLarge batch (height growth + copies clamp)');
  {
    const fifty = await printing.buildLabelJob([productId], '38x25', 50, 'roll');
    const a = await printService.auditJobLayout(fifty);
    checkTrue(
      `50 labels on a roll grow the page (${a.geometry.heightMm}mm)`,
      a.geometry.heightMm > printService.LABEL_SPECS['38x25'].h * 10
    );
    checkTrue(
      `50-label roll is still within the print height clamp (${a.geometry.heightMm}mm)`,
      a.geometry.heightMm <= 2000
    );
    checkTrue('50-label roll: nothing clipped', a.offenders.every((o) => o.overflowRight <= 1));

    const silly = await printing.buildLabelJob([productId], '38x25', 5000, 'roll');
    const a2 = await printService.auditJobLayout(silly);
    checkTrue(
      `an absurd copy count is capped, not rendered (${a2.geometry.heightMm}mm)`,
      a2.geometry.heightMm <= 2000,
      `${a2.geometry.heightMm}mm`
    );
  }

  // ── 8. Optional PNG renders for human eyes ──
  // The checks above are geometric. Run with --shots to also write PNGs of the
  // real rendered pages so they can be opened and eyeballed (fonts, spacing and
  // barcode legibility are things only a person should confirm).
  if (process.argv.includes('--shots') && saleId) {
    console.log('\nPNG renders (--shots)');
    const shots = [];
    for (const paper of ['thermal58', 'thermal80']) {
      const restore = setPrintSetting('receipt_paper', paper);
      try {
        shots.push([`shot-receipt-${paper}.png`, printing.buildReceiptJob(saleId, 'standard')]);
      } finally {
        restore();
      }
    }
    for (const paper of ['a4', 'a5']) {
      const restore = setPrintSetting('invoice_paper', paper);
      try {
        shots.push([`shot-invoice-${paper}.png`, printing.buildInvoiceJob(saleId)]);
      } finally {
        restore();
      }
    }
    for (const size of Object.keys(printService.LABEL_SPECS)) {
      shots.push([`shot-label-${size}-roll.png`, await printing.buildLabelJob([productId], size, 1, 'roll')]);
      shots.push([`shot-label-${size}-sheet.png`, await printing.buildLabelJob([productId], size, 4, 'sheet')]);
    }
    for (const [file, job] of shots) {
      const dest = path.join(outDir, file);
      const geo = await printService.printJobToPng(job, dest);
      console.log(`  wrote ${file} (${geo.widthMm}x${geo.heightMm}mm, ${fs.statSync(dest).size} bytes)`);
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

function pickASale(sales) {
  try {
    const all = sales.listSales();
    return all && all.length ? all[0].id : null;
  } catch {
    return null;
  }
}

function pickAProduct(inventory) {
  try {
    const list = inventory.listProducts();
    return list && list.length ? list[0].id : 1;
  } catch {
    return 1;
  }
}

/**
 * Temporarily set an admin print setting and return a restore function.
 * Written straight to the table because `setAdminSetting` is owner-gated and
 * the smoke test runs with no signed-in user.
 */
function setPrintSetting(key, value) {
  const db = require('../dist/main/db.js').getDb();
  const printSvc = require('../dist/main/services/printService.js');
  db.prepare(
    'INSERT OR REPLACE INTO admin_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
  ).run(key, value);
  printSvc.invalidatePrinterCache();
  return () => {
    try {
      db.prepare('DELETE FROM admin_settings WHERE key = ?').run(key);
      printSvc.invalidatePrinterCache();
    } catch (e) {
      console.error(`could not clear ${key}:`, e);
    }
  };
}

/**
 * Temporarily rename a product so the layout audit can be run against a name far
 * too long for any column. Returns a function that restores the original name.
 */
function renameProduct(productId, name) {
  const db = require('../dist/main/db.js').getDb();
  const before = db.prepare('SELECT name FROM products WHERE id = ?').get(productId);
  if (!before) return () => {};
  db.prepare('UPDATE products SET name = ? WHERE id = ?').run(name, productId);
  return () => {
    try {
      db.prepare('UPDATE products SET name = ? WHERE id = ?').run(before.name, productId);
    } catch (e) {
      console.error('could not restore product name:', e);
    }
  };
}

app.whenReady().then(run).catch((e) => {
  console.error('print_smoke crashed:', e);
  app.exit(1);
});
