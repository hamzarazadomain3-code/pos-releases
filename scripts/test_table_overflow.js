#!/usr/bin/env node
/**
 * Items table overflow test.
 *
 * Verifies that large amounts (1,234,567.00) and a 3-digit qty (999) do not
 * cause column overlap on both 80mm and 58mm rolls.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-overflow-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'overflow-test.db');

let checks = 0;
let failures = 0;

function check(name, condition, detail) {
  checks++;
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ' -- ' + detail : ''}`);
  return condition;
}

async function run() {
  await app.whenReady();
  const { initDatabase } = require('../dist/main/db.js');
  await initDatabase();
  const designer = require('../dist/main/services/receiptDesigner.js');
  const printService = require('../dist/main/services/printService.js');
  const shared = require('../dist/shared/receiptDesign.js');

  console.log('\nItems table overflow test\n');

  const sample = designer.buildSampleSale();
  // Make the total exactly 1,234,567 so the large-amount formatter gets exercised.
  sample.items = [
    { product_name: 'Big Bag of Everything Extra Large', unit_name: 'Piece', qty: 999, unit_price: 1235.76, discount: 0, tax_rate: 5, line_total: 999 * 1235.76 },
  ];
  sample.total_amount = 999 * 1235.76 + (0.12 * (999 * 1235.76));
  sample.subtotal = 999 * 1235.76;
  sample.discount_amount = 0;
  sample.paid = sample.total_amount;
  sample.tax_amount = 0.12 * (999 * 1235.76);

  const design = shared.defaultReceiptDesign('receipt');

  for (const paper of ['thermal80', 'thermal58']) {
    console.log(`\n${paper}:`);
    const html = designer.buildDesignedReceipt(sample, paper, design);
    const text = await printService.readJobText({ html, paper });
    const audit = await printService.auditJobLayout({ html, paper });

    check(`${paper}: no elements overflow the roll`, audit.offenders.length === 0,
      audit.offenders.map(o => `${o.tag}.${o.cls} "${o.text}" +${o.overflowRight}px`).join(', '));

    check(`${paper}: contains the 3-digit qty 999`, text.includes('999'));
  }

  // With-discount items (80mm)
  console.log('\nWith-discount items (80mm):');
  const discSample = JSON.parse(JSON.stringify(sample));
  discSample.items[0].discount = 50;
  const discHtml = designer.buildDesignedReceipt(discSample, 'thermal80', design);
  const discAudit = await printService.auditJobLayout({ html: discHtml, paper: 'thermal80' });
  check('with-discount: no overflow', discAudit.offenders.length === 0,
    discAudit.offenders.map(o => `${o.tag}.${o.cls}`).join(', '));

  console.log(`\n${checks - failures}/${checks} overflow checks passed.`);
  if (failures) {
    console.error('OVERFLOW TEST FAILED');
    process.exit(1);
  } else {
    console.log('ALL OVERFLOW CHECKS PASSED');
  }
}

run().catch(e => {
  console.error('Test crashed:', e);
  process.exit(1);
});