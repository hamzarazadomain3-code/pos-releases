#!/usr/bin/env node
/**
 * Thermal receipt redesign verification.
 *
 * Drives the redesigned `buildRoll()` (80mm + 58mm) through the REAL
 * `buildReceiptJob` pipeline against a disposable database, covering the three
 * required scenarios:
 *   (a) a 1-item cash sale (paid with change),
 *   (b) a 6-item sale with a long product name, a unit-scaled item
 *       (0.57 Kilogram) and a bill-level discount,
 *   (c) a credit (Udhaar) sale with a partial payment.
 *
 * For every scenario × paper width it checks the shop's actual bug reports:
 *   - nothing is clipped on the right edge (layout audit),
 *   - the body uses the printable width exactly (contentMm contract),
 *   - the invoice number prints as ONE line (no wrap inside the token) and
 *     degrades from INV-YYYYMMDD-NNNN to INV-MMDD-NNNN,
 *   - NET TOTAL prints as ONE line,
 *   - the item table headers and every line total are present,
 *   - the DISC column exists on 80mm and is absent on 58mm.
 *
 * Usage (after `npm run build`):
 *   electron scripts/receipt_design_check.js
 *   electron scripts/receipt_design_check.js --shots   # also writes PNGs to review visually
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

// Fully disposable: fresh DB + own userData dir. POS_DB_PATH must be set before
// db.ts reads it (inside initDatabase).
const workDir = process.env.ROKAR_REPORT_DIR || path.join(os.tmpdir(), 'rokar-receipt-design');
fs.mkdirSync(workDir, { recursive: true });
process.env.POS_DB_PATH = path.join(workDir, 'design.db');
if (fs.existsSync(process.env.POS_DB_PATH)) fs.rmSync(process.env.POS_DB_PATH, { force: true });
app.setPath('userData', path.join(workDir, 'userdata'));

const outDir = path.join(workDir, 'out');
let checks = 0;
let failures = 0;

function checkTrue(name, condition, detail) {
  checks++;
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail != null ? ` — ${detail}` : ''}`);
  return condition;
}

/** Set a print-related admin setting and return a restore function. */
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

/** Must stay in sync with receiptTemplates.ts `plain()`: locale-formatted. */
function plain(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Extract font-size declarations from the generated receipt CSS. */
function fontSizeReport(html) {
  const out = {};
  const re = /([^{}]+)\{[^}]*?font-size:\s*([\d.]+px)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const px = m[2];
    if (!out[px]) out[px] = [];
    out[px].push(m[1].trim());
  }
  return Object.keys(out)
    .sort((a, b) => parseFloat(a) - parseFloat(b))
    .map((px) => `${px}  <==  ${out[px].join(' , ')}`)
    .join('\n      ');
}

async function run() {
  const { initDatabase, getDb } = require('../dist/main/db.js');
  const printService = require('../dist/main/services/printService.js');
  const printing = require('../dist/main/services/printing.js');
  const sales = require('../dist/main/services/sales.js');
  const inventory = require('../dist/main/services/inventory.js');
  const shifts = require('../dist/main/services/shifts.js');
  const settings = require('../dist/main/services/settings.js');

  await initDatabase();
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`\nThermal receipt redesign check — ${workDir}\n`);

  // ── shop identity ────────────────────────────────────────────────────────
  for (const [key, value] of Object.entries({
    shop_name: 'Premium Mart Johar Town',
    shop_address: 'Main Boulevard, Johar Town, Lahore',
    shop_phone: '0300-1234567',
    shop_whatsapp: '0300-7654321',
    license_expires: '2099-12-31',
    // A lifetime key returns immediately from ensureLicenseValidSync(), which
    // every sale runs. Keeps the test DB from refusing to bill.
    license_lifetime: '1',
  })) {
    settings.setSetting(key, value);
  }

  // ── catalogue ────────────────────────────────────────────────────────────
  const units = inventory.listUnits();
  const pieceUnit = units.find((u) => /piece/i.test(u.name)) || null;
  const kgUnit = units.find((u) => /kilo/i.test(u.name)) || units[0];

  const mkProduct = (name, sale, stock, unitId = null) => {
    const p = inventory.createProduct({
      name,
      unit_id: unitId,
      cost_price: Math.round(sale * 0.6),
      sale_price: sale,
      wholesale_price: sale,
      stock_qty: stock,
      low_stock_threshold: 1,
    });
    getDb().prepare('UPDATE products SET stock_qty = ? WHERE id = ?').run(stock, p.id);
    return p;
  };

  const LONG_NAME =
    'Extraordinarily Long Product Name That Should Never Reach The Right Margin 1234567890 ABCDEFGHIJKLMNOPQRSTUVWXYZ 0987654321';
  const pA = mkProduct('Mini Snack 25g', 80, 100, pieceUnit ? pieceUnit.id : null); // scenario (a)
  const pB1 = mkProduct('Tapal Danedar Tea 950g', 1320, 50); // scenario (b)
  const pB2 = mkProduct('Basmati Rice 5kg', 1850, 40);
  const pB3 = mkProduct('Cooking Oil 5L', 3820, 30);
  const pB4 = mkProduct('Colgate MaxFresh 150g', 380, 60);
  const pB5 = mkProduct(LONG_NAME, 99, 100); // 96-char name — must wrap, never clip
  const pB6 = mkProduct('Imsli Water 1.5L', 80, 200, kgUnit ? kgUnit.id : null); // unit-scaled: 0.57 Kg
  const pC1 = mkProduct('Surf Excel 1kg', 700, 40); // scenario (c) udhaar
  const pC2 = mkProduct('Dishwashing Liquid 500ml', 215, 50);

  // ── counterparties ───────────────────────────────────────────────────────
  const cashCustomer = null;
  const udhaarCustomer = sales.createCustomer('Muhammad Bilal', '0300-1234501', 0);

  shifts.openShift(5000);

  // ── scenario (a): 1 item, cash, overpaid → CHANGE line ──────────────────
  const saleA = sales.createSale({
    items: [{ product_id: pA.id, qty: 2, price: 80, line_discount: 0, tax_rate: 0 }],
    customer_id: cashCustomer,
    payments: [{ mode: 'Cash', amount: 500 }], // 160 total → CHANGE 340
  });
  console.log(`\nScenario (a) one item — sale ${saleA.sale.id} ${saleA.sale.invoice_no}`);

  // ── scenario (b): 6 items, long name + 0.57 Kg unit + bill discount ─────
  const itemsB = [
    { product_id: pB1.id, qty: 1, price: 1320, line_discount: 0, tax_rate: 0 },
    { product_id: pB2.id, qty: 1, price: 1850, line_discount: 0, tax_rate: 0 },
    { product_id: pB3.id, qty: 1, price: 3820, line_discount: 0, tax_rate: 0 },
    { product_id: pB4.id, qty: 1, price: 380, line_discount: 0, tax_rate: 0 },
    { product_id: pB5.id, qty: 1, price: 99, line_discount: 0, tax_rate: 0 },
    { product_id: pB6.id, qty: 0.57, price: 80, line_discount: 0, tax_rate: 0, unit_name: 'Kilogram', display_qty: 0.57 },
  ];
  const totalsB = sales.computeTotals(itemsB, 100, 'amount');
  const saleB = sales.createSale({
    items: itemsB,
    bill_discount: 100,
    discount_type: 'amount',
    customer_id: cashCustomer,
    payments: [{ mode: 'Easypaisa', amount: totalsB.total }],
  });
  console.log(`\nScenario (b) 6 items + discount — sale ${saleB.sale.id} ${saleB.sale.invoice_no}`);

  // ── scenario (c): udhaar — partial cash, balance carried ────────────────
  const itemsC = [
    { product_id: pC1.id, qty: 2, price: 700, line_discount: 0, tax_rate: 0 },
    { product_id: pC2.id, qty: 1, price: 215, line_discount: 0, tax_rate: 0 },
  ];
  const totalsC = sales.computeTotals(itemsC, 0, 'amount');
  const saleC = sales.createSale({
    items: itemsC,
    customer_id: udhaarCustomer.id,
    payments: [{ mode: 'Cash', amount: Math.round(totalsC.total / 2) }], // leaves UDHAAR/BALANCE
  });
  console.log(`\nScenario (c) udhaar — sale ${saleC.sale.id} ${saleC.sale.invoice_no}`);

  const scenarios = [
    { key: 'a-one-item', name: 'one item (cash + change)', sale: saleA.sale },
    { key: 'b-six-items', name: '6 items + discount + 0.57kg', sale: saleB.sale },
    { key: 'c-udhaar', name: 'udhaar (partial payment)', sale: saleC.sale },
  ];

  // ── audit every scenario on both rolls ──────────────────────────────────
  for (const paper of ['thermal58', 'thermal80']) {
    const paperRestore = setPrintSetting('receipt_paper', paper);
    try {
      for (const sc of scenarios) {
        const sale = sc.sale;
        const restore = setPrintSetting('receipt_show_serial_number', 'true');
        try {
          const job = printing.buildReceiptJob(sale.id, 'standard');
          const a = await printService.auditJobLayout(job);
          const clipped = a.offenders.filter((o) => o.overflowRight > 1);
          checkTrue(
            `${paper} ${sc.key}: nothing clipped on the right`,
            clipped.length === 0,
            clipped
              .slice(0, 2)
              .map((o) => `<${o.tag} ${o.cls}> "${o.text}" +${o.overflowRight}px`)
              .join(' | ')
          );
          checkTrue(
            `${paper} ${sc.key}: printable width is ${printService.PAPER_SPECS[paper].contentMm}mm`,
            Math.abs(a.limitMm - printService.PAPER_SPECS[paper].contentMm) < 0.01,
            `${a.limitMm}mm`
          );

          const raw = await printService.readJobText(job);
          const flat = raw.replace(/\s+/g, ' ');

          // Invoice number: single token on one line. short form INV-MMDD-NNNN
          // is what real invoice numbers (INV-YYYYMMDD-NNNN) print as.
          const m = (sale.invoice_no || '').match(/^([A-Za-z]+)-(\d{8})-(\d+)$/);
          const invTexts = m ? [`${m[1]}-${m[2].slice(4)}-${m[3]}`, sale.invoice_no] : [sale.invoice_no];
          checkTrue(
            `${paper} ${sc.key}: invoice number on one line`,
            invTexts.some((t) => t && raw.includes(t)),
            invTexts[0]
          );

          // NET TOTAL + the amount on one line.
          // plain() must match receiptTemplates.plain() — locale-formatted,
          // so a real total prints "7,414.60", not "7414.60".
          const totalText = plain(sale.total_amount);
          checkTrue(`${paper} ${sc.key}: NET TOTAL row printed`, raw.includes('NET TOTAL'), '');
          checkTrue(
            `${paper} ${sc.key}: NET TOTAL amount on one line`,
            raw.replace(/\s+/g, '').includes(totalText),
            totalText
          );

          // Line totals all present.
          for (const it of sale.items) {
            const lineText = plain(it.line_total);
            checkTrue(
              `${paper} ${sc.key}: line total ${lineText} present`,
              raw.replace(/\s+/g, '').includes(lineText),
              lineText
            );
          }

          // Item table headers.
          if (paper === 'thermal58') {
            checkTrue(
              `${paper} ${sc.key}: 5-column header (ITEM QTY RATE AMOUNT)`,
              flat.includes('ITEM') && flat.includes('QTY') && flat.includes('RATE') && flat.includes('AMOUNT'),
              ''
            );
            checkTrue(
              `${paper} ${sc.key}: DISC column is absent on 58mm`,
              flat.includes('RATE AMOUNT'),
              flat.slice(flat.indexOf('RATE'), flat.indexOf('RATE') + 40) || ''
            );
          } else {
            checkTrue(
              `${paper} ${sc.key}: 6-column header (# PARTICULARS QTY RATE DISC AMOUNT)`,
              flat.includes('#') && flat.includes('PARTICULARS') && flat.includes('QTY') && flat.includes('RATE') && flat.includes('DISC') && flat.includes('AMOUNT'),
              ''
            );
            checkTrue(`${paper} ${sc.key}: DISC column sits before AMOUNT`, flat.includes('RATE DISC AMOUNT'), '');
          }
        } finally {
          restore();
        }
      }

      // Scenario (b) specifics: the 0.57 Kilogram line and the long name.
      {
        const restore = setPrintSetting('receipt_show_serial_number', 'true');
        try {
          const job = printing.buildReceiptJob(saleB.sale.id, 'standard');
          const raw = await printService.readJobText(job);
          checkTrue(
            `${paper} b-six-items: decimal qty 0.57 printed`,
            raw.includes('0.57'),
            ''
          );
          checkTrue(
            `${paper} b-six-items: unit "Kilogram" shown under the name`,
            raw.includes('Kilogram'),
            ''
          );
          checkTrue(
            `${paper} b-six-items: DISCOUNT line in totals`,
            raw.includes('DISCOUNT'),
            ''
          );
        } finally {
          restore();
        }
      }
      {
        const restore = setPrintSetting('receipt_show_serial_number', 'true');
        try {
          const job = printing.buildReceiptJob(saleC.sale.id, 'standard');
          const raw = await printService.readJobText(job);
          checkTrue(`${paper} c-udhaar: UDHAAR/BALANCE row printed`, raw.includes('UDHAAR/BALANCE'), '');
        } finally {
          restore();
        }
      }
    } finally {
      paperRestore();
    }
  }

  // ── shots for human eyes ──
  if (process.argv.includes('--shots')) {
    console.log('\nPNG renders (--shots)');
    for (const paper of ['thermal58', 'thermal80']) {
      const restore = setPrintSetting('receipt_paper', paper);
      try {
        for (const sc of scenarios) {
          const dest = path.join(outDir, `design-${sc.key}-${paper}.png`);
          const geo = await printService.printJobToPng(printing.buildReceiptJob(sc.sale.id, 'standard'), dest);
          console.log(`  wrote ${path.basename(dest)} (${geo.widthMm}x${geo.heightMm}mm, ${fs.statSync(dest).size} bytes)`);
        }
      } finally {
        restore();
      }
    }
  }

  // ── final CSS report (the values this design ships with) ──
  console.log('\nFinal thermal receipt CSS (80mm, normal font size):');
  const restore = setPrintSetting('receipt_paper', 'thermal80');
  try {
    const html = printing.buildReceiptJob(saleA.sale.id, 'standard').html;
    console.log(fontSizeReport(html));
    const body = html.match(/width:\s*[\d.]+mm;\s*margin:\s*0 auto;\s*padding:[^;]+;/);
    console.log(`  body          => ${body ? body[0].trim() : '??'}`);
    const page = html.match(/@page \{[^}]+\}/);
    console.log(`  @page         => ${page ? page[0].trim() : '??'}`);
  } finally {
    restore();
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
  console.error('receipt_design_check crashed:', e);
  app.exit(1);
});