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
  const labelStudio = require('../dist/main/services/labelStudioPrinting.js');
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

  // ── 3c. Label Studio custom templates (Phase 4) ──
  // The renderer's template (elements with mm coordinates) is serialized over
  // IPC, so the main process rebuilds it as HTML. Audit the SAME job the app
  // prints/exported so a layout slip cannot hide behind the preview canvas.
  console.log('\nLabel Studio custom templates');
  {
    const studioTemplate = {
      id: 'smoke-retail',
      name: 'Smoke Retail',
      size: '38x25',
      layout: 'roll',
      defaults: { copies: 1, barcodeOnly: false },
      elements: [
        { id: 'name', type: 'text', x: 2, y: 1, w: 34, h: 4, visible: true, locked: false, rotation: 0, content: '{name}', style: { fontSize: 6, bold: true, align: 'center' } },
        { id: 'line', type: 'line', x: 2, y: 5.5, w: 34, h: 0.2, visible: true, locked: false, rotation: 0, content: '', style: {} },
        { id: 'code', type: 'barcode', x: 4, y: 7, w: 30, h: 9, visible: true, locked: false, rotation: 0, content: '{barcode}', barcodeOptions: { height: 9, barWidth: 2, showText: true }, style: {} },
        { id: 'price', type: 'text', x: 2, y: 18, w: 20, h: 4, visible: true, locked: false, rotation: 0, content: '{price}', style: { fontSize: 7, bold: true, align: 'left' } },
        { id: 'qr', type: 'qr', x: 26, y: 16.5, w: 9, h: 6, visible: true, locked: false, rotation: 0, content: '{sku}', style: {} },
      ],
    };

    const job = await labelStudio.buildLabelStudioJob([productId], studioTemplate);
    const { data } = await printService.printJobToPdf(job);
    fs.writeFileSync(path.join(outDir, 'label-studio-retail-38x25.pdf'), data);
    const m = measurePdf(data);
    checkTrue('studio template produced a readable PDF', !!m);
    if (m) {
      check('studio template page width fits the label', m.widthMm, 38, 2);
      checkTrue('studio template page holds the label height', m.heightMm >= 24.5, `${m.heightMm.toFixed(1)}mm`);
    }

    // Offset / mirror / rotation must be injectable without breaking geometry.
    const off = await printService.printJobToPdf(
      await labelStudio.buildLabelStudioJob([productId], {
        ...studioTemplate,
        layout: 'sheet',
      })
    );
    checkTrue('studio sheet layout still renders', measurePdf(off.data)?.widthMm > 200, '');

    // Custom (object) size registers a one-off spec and lays out correctly.
    const customSpec = { w: 40, h: 30, gap: 1, margins: { t: 1, r: 1, b: 1, l: 1 } };
    const customJob = await labelStudio.buildLabelStudioJob(
      [productId],
      { ...studioTemplate, size: customSpec, name: 'Custom 40' },
      undefined,
      1
    );
    const customM = measurePdf((await printService.printJobToPdf(customJob)).data);
    if (customM) check('custom-size label page width matches the template', customM.widthMm, 40, 2);

    // Layout audit: nothing hangs off the right edge of the label cell.
    const auditStudio = async (name, j) => {
      const a = await printService.auditJobLayout(j);
      const clipped = a.offenders.filter((o) => o.overflowRight > 1);
      checkTrue(
        `${name}: nothing clipped on the right`,
        clipped.length === 0,
        clipped.slice(0, 2).map((o) => `<${o.tag}> "${o.text}" +${o.overflowRight}px`).join(' | ')
      );
    };
    await auditStudio('studio roll (2 copies)', await labelStudio.buildLabelStudioJob([productId], studioTemplate, undefined, 2));
    await auditStudio('studio sheet layout', await labelStudio.buildLabelStudioJob([productId], { ...studioTemplate, layout: 'sheet' }, undefined, 2));

    // Content audit: the placeholders must resolve to real fields.
    const text = await printService.readJobText(job);
    const flat = text.replace(/\s+/g, ' ');
    const p = inventory.getProduct(productId);
    checkTrue('studio label prints the product name', !!p && flat.includes(p.name), p ? p.name : '');
    checkTrue('studio label prints money with decimals', /\d+\.\d{2}/.test(flat), '');

    // ── Multi-across roll + per-run overrides (the "Al Bagdad Grocery" case) ──
    // A 38x28 template laid out two-across must widen the roll page to both
    // columns (2 x 38 + one 2mm gutter = 78mm) and a 6-label run must fill 3
    // rows. Per-run values (mfg/expiry/price/weight/start column/DPI) override
    // the product for that one run without touching the template.
    console.log('\nMulti-across roll + per-run overrides');
    const alBagdad = {
      id: 'smoke-al-bagdad',
      name: 'Al Bagdad Grocery (2-across)',
      size: '38x28',
      layout: 'roll',
      rollCols: 2,
      options: { autoShrinkName: true, showApprox: true, hideDatesWhenNoExpiry: true, barcodeDpi: 203, border: false },
      defaults: { copies: 1, barcodeOnly: false },
      elements: [
        { id: 'n', type: 'text', x: 1, y: 1, w: 36, h: 4, visible: true, locked: false, rotation: 0, content: '{name}', style: { fontSize: 7, bold: true, align: 'center', autoShrink: true, minFontSize: 4 } },
        { id: 'd', type: 'text', x: 1, y: 6, w: 36, h: 3, visible: true, locked: false, rotation: 0, content: 'Mfg {mfg:d/m/yy}  Exp {expiry:dd/mm/yyyy}', style: { fontSize: 6, align: 'center' } },
        { id: 'w', type: 'text', x: 1, y: 9.5, w: 36, h: 3, visible: true, locked: false, rotation: 0, content: '{weight}', style: { fontSize: 6, align: 'center' } },
        { id: 'bc', type: 'barcode', x: 2, y: 13, w: 34, h: 9, visible: true, locked: false, rotation: 0, content: '{barcode}', barcodeOptions: { height: 9, barWidth: 2, showText: true }, style: {} },
        { id: 'p', type: 'text', x: 1, y: 23, w: 36, h: 4, visible: true, locked: false, rotation: 0, content: '{price}', style: { fontSize: 8, bold: true, align: 'center' } },
      ],
    };
    const run = { mfgDate: '2026-10-02', expOverride: '2027-01-02', priceSource: 'custom', customPrice: 100, weight: '100g', startCol: 1, barcodeDpi: 300, rollCols: 2 };
    const multiJob = await labelStudio.buildLabelStudioJob([productId], alBagdad, undefined, 6, run);
    const multiPdf = await printService.printJobToPdf(multiJob);
    fs.writeFileSync(path.join(outDir, 'label-al-bagdad-2across.pdf'), multiPdf.data);
    const multi = measurePdf(multiPdf.data);
    checkTrue('2-across roll produced a readable PDF', !!multi);
    if (multi) check('2-across roll page width', multi.widthMm, 78, 3);
    const multiText = (await printService.readJobText(multiJob)).replace(/\s+/g, ' ');
    checkTrue('per-run custom price prints', multiText.includes('100'), '');
    checkTrue('per-run mfg date honours {mfg:d/m/yy}', multiText.includes('2/10/26'), '');
    checkTrue('per-run expiry honours {expiry:dd/mm/yyyy}', multiText.includes('02/01/2027'), '');
    checkTrue('per-run weight prints', multiText.includes('100g'), '');
    await auditStudio('2-across 6-label roll (3 rows)', multiJob);

    // A PNG of the exact 2-across roll so the layout can be eyeballed.
    const multiPng = path.join(outDir, 'shot-label-al-bagdad-2across.png');
    const multiGeo = await printService.printJobToPng(multiJob, multiPng);
    checkTrue('2-across roll renders to a PNG', multiGeo.widthMm > 70, `${multiGeo.widthMm.toFixed(1)}x${multiGeo.heightMm.toFixed(1)}mm`);

    // Start-at-column 2 must push the first row's first cell into column 2.
    const startJob = await labelStudio.buildLabelStudioJob([productId], alBagdad, undefined, 1, { ...run, startCol: 2 });
    checkTrue('start-at-column-2 inserts one leading blank cell', (startJob.html.match(/class="ls-fill"/g) || []).length === 1, '');
    const normalJob = await labelStudio.buildLabelStudioJob([productId], alBagdad, undefined, 1, { ...run, startCol: 1 });
    checkTrue('start-at-column-1 inserts no blank cell', (normalJob.html.match(/class="ls-fill"/g) || []).length === 0, '');

    // The ± approximation marker appears for a loose product (flag OR scale/PLU
    // barcode), and the dates hide when there is no expiry (per-template option).
    const smokeDb = require('../dist/main/db.js').getDb();
    const before = smokeDb.prepare('SELECT is_loose, net_weight, mfg_date, expiry_date, barcode FROM products WHERE id = ?').get(productId);
    if (before) {
      try {
        smokeDb.prepare("UPDATE products SET is_loose = 1, net_weight = '100g', mfg_date = NULL, expiry_date = NULL WHERE id = ?").run(productId);
        const looseJob = await labelStudio.buildLabelStudioJob([productId], alBagdad, undefined, 1, { priceSource: 'retail' });
        const looseText = (await printService.readJobText(looseJob)).replace(/\s+/g, ' ');
        checkTrue('a loose product prints the ± marker', looseText.includes('\u00b1100g'), looseText.slice(0, 60));
        checkTrue('dates hide when the product has no expiry', !/Mfg \d/.test(looseText), '');

        // Scale/PLU fallback: not flagged, but a 5-digit `1xxxx` barcode is weighed.
        smokeDb.prepare("UPDATE products SET is_loose = 0, barcode = '10001' WHERE id = ?").run(productId);
        const pluJob = await labelStudio.buildLabelStudioJob([productId], alBagdad, undefined, 1, { priceSource: 'retail' });
        const pluText = (await printService.readJobText(pluJob)).replace(/\s+/g, ' ');
        checkTrue('a scale/PLU product prints the ± marker', pluText.includes('\u00b1100g'), pluText.slice(0, 60));
      } finally {
        smokeDb.prepare('UPDATE products SET is_loose = ?, net_weight = ?, mfg_date = ?, expiry_date = ?, barcode = ? WHERE id = ?')
          .run(before.is_loose ?? 0, before.net_weight ?? null, before.mfg_date ?? null, before.expiry_date ?? null, before.barcode ?? null, productId);
      }
    }

    // ── Image elements (uploaded from the PC) must actually print ──────────
    // Before 2.16 the printer emitted the literal text "IMG" for an image
    // element, so an uploaded logo/photo silently vanished at print time.
    const TINY_PNG =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const withImage = (content) => ({
      ...studioTemplate,
      elements: [
        ...studioTemplate.elements,
        { id: 'photo', type: 'image', x: 2, y: 2, w: 12, h: 12, visible: true, locked: false, rotation: 0, content, style: {} },
      ],
    });
    const imageJob = await labelStudio.buildLabelStudioJob([productId], withImage(TINY_PNG));
    checkTrue(
      'an image element renders an <img> (not the old "IMG" placeholder)',
      /<img [^>]*src="data:image\/png;base64,/.test(imageJob.html) && !/>IMG</.test(imageJob.html),
      ''
    );
    await auditStudio('studio label with an uploaded image', imageJob);

    // `{image}` binds to the product's own photo; unsafe schemes are dropped.
    const db = require('../dist/main/db.js').getDb();
    const beforeImage = db.prepare('SELECT image FROM products WHERE id = ?').get(productId);
    db.prepare('UPDATE products SET image = ? WHERE id = ?').run(TINY_PNG, productId);
    try {
      const boundJob = await labelStudio.buildLabelStudioJob([productId], withImage('{image}'));
      checkTrue(
        'an image element resolves {image} to the product photo',
        /<img [^>]*src="data:image\/png;base64,/.test(boundJob.html),
        ''
      );
      const evilJob = await labelStudio.buildLabelStudioJob([productId], withImage('javascript:alert(1)'));
      checkTrue('a javascript: image src is dropped from the label markup', !/javascript:/i.test(evilJob.html), '');
    } finally {
      db.prepare('UPDATE products SET image = ? WHERE id = ?').run(beforeImage ? beforeImage.image : null, productId);
    }

    // Export entry points return real bytes (not a stub).
    const exported = await labelStudio.exportLabelBatchToPDF([productId], studioTemplate);
    checkTrue('exportLabelBatchToPDF returns PDF bytes', exported.ok && !!exported.data && exported.data.length > 1000, exported.message);
    if (exported.data) {
      const em = measurePdf(exported.data);
      checkTrue(
        'exported PDF is the label size',
        !!em && Math.abs(em.widthMm - 38) <= 2,
        em ? `${em.widthMm.toFixed(1)}mm` : 'no PDF'
      );
    }
    const pngOut = await labelStudio.exportLabelBatchToPNG([productId], studioTemplate);
    const pngOk = pngOut.ok && pngOut.data && pngOut.data.subarray(0, 8).toString('latin1') === '\x89PNG\r\n\x1a\n';
    checkTrue('exportLabelBatchToPNG returns a PNG', !!pngOk, pngOut.message);
    if (pngOk) {
      const pw = pngOut.data.readUInt32BE(16);
      const ph = pngOut.data.readUInt32BE(20);
      // One 38x25 label on a roll with a 1mm gap on both sides = 38x27mm page.
      checkTrue(
        'studio PNG aspect matches the label page',
        pw > 0 && ph > 0 && Math.abs(pw / ph - 38 / 27) < 0.12,
        `${pw}x${ph}`
      );
    }

    // Calibration sheet for a label size (not a receipt roll).
    const calJob = {
      html: labelStudio.buildCalibrationLabelHtml('50x30'),
      paper: '50x30',
      labelLayout: 'roll',
      labelRows: 1,
      printerKey: 'label',
      jobName: 'cal-label-smoke',
    };
    const calPdf = await printService.printJobToPdf(calJob);
    fs.writeFileSync(path.join(outDir, 'cal-label-50x30.pdf'), calPdf.data);
    const calM = measurePdf(calPdf.data);
    if (calM) check('calibration label page width', calM.widthMm, 50, 2);
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
  // entirely. Both roll widths now use the same fixed item table (58mm has no
  // DISC column and spells PARTICULARS as ITEM), so check the headers and the
  // invoice number survive the redesign.
  console.log('\nContent audit (fields present)');
  {
    const sale = saleId ? sales.getSale(saleId) : null;
    const item = sale && sale.items && sale.items.length ? sale.items[0] : null;
    if (item) {
      const name = item.product_name || '';
      // The receipts/invoices print money through toLocaleString, so a
      // four-figure amount carries a thousands separator ("1,000.00"). Format
      // the expectation the same way, and require a whole money token: a naive
      // `includes("0.00")` would otherwise "match" inside "1,000.00".
      const money = (n) =>
        Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const hasMoney = (haystack, n) => {
        const needle = money(n);
        for (let from = 0; ; ) {
          const i = haystack.indexOf(needle, from);
          if (i < 0) return false;
          const before = i > 0 ? haystack[i - 1] : '';
          const after = i + needle.length < haystack.length ? haystack[i + needle.length] : '';
          if (!/[\d,]/.test(before) && !/[\d,]/.test(after)) return true;
          from = i + 1;
        }
      };
      // The invoice number prints as `INV-MMDD-NNNN` when the full
      // `INV-YYYYMMDD-NNNN` is too long to ever wrap.
      const invMatch = (sale.invoice_no || '').match(/^([A-Za-z]+)-(\d{8})-(\d+)$/);
      const invTexts = invMatch
        ? [sale.invoice_no, `${invMatch[1]}-${invMatch[2].slice(4)}-${invMatch[3]}`]
        : [sale.invoice_no];

      for (const paper of ['thermal58', 'thermal80']) {
        const restore = setPrintSetting('receipt_paper', paper);
        try {
          const job = printing.buildReceiptJob(saleId, 'standard');
          const text = await printService.readJobText(job);
          const flat = text.replace(/\s+/g, ' ');
          checkTrue(`receipt ${paper}: product name is printed`, name ? flat.includes(name) : true, name);
          checkTrue(`receipt ${paper}: line total is printed`, hasMoney(flat, item.line_total), money(item.line_total));
          checkTrue(`receipt ${paper}: NET TOTAL is printed`, flat.includes('NET TOTAL'), '');
          if (paper === 'thermal58') {
            // 58mm uses the compact 5-column table (# | ITEM | QTY | RATE | AMOUNT).
            checkTrue(
              'receipt thermal58: 5-column item header is printed',
              flat.includes('ITEM') && flat.includes('QTY') && flat.includes('RATE') && flat.includes('AMOUNT'),
              ''
            );
          } else {
            // 80mm uses the 6-column fixed table. If a markup slip drops the
            // header row the columns collapse back into one run of text.
            checkTrue(
              'receipt thermal80: 6-column item header is printed',
              flat.includes('#') && flat.includes('PARTICULARS') && flat.includes('QTY') && flat.includes('RATE') && flat.includes('DISC') && flat.includes('AMOUNT'),
              ''
            );
          }
          checkTrue(
            `receipt ${paper}: invoice number is on the receipt`,
            invTexts.some((t) => t && flat.includes(t)),
            invTexts[0]
          );
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
          checkTrue(`invoice ${paper}: grand total is printed`, hasMoney(flat, sale.subtotal) || hasMoney(flat, sale.total_amount), '');
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
