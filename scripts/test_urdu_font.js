#!/usr/bin/env node
/**
 * Urdu font availability test.
 *
 *  1. The bundled font file exists on disk (source + packaged path).
 *  2. package.json ships resources/fonts as an extraResource -> fonts.
 *  3. The rendered receipt HTML contains an @font-face referencing it.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-urdu-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'urdu-test.db');

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
  const shared = require('../dist/shared/receiptDesign.js');
  const pkg = require('../package.json');

  console.log('\nUrdu font test\n');

  // 1. Font file exists in the source tree
  const fontPath = path.join(PROJECT_ROOT, 'resources', 'fonts', 'NotoNastaliqUrdu-Regular.ttf');
  check('NotoNastaliqUrdu-Regular.ttf exists', fs.existsSync(fontPath),
    fontPath);
  check('OFL licence file exists',
    fs.existsSync(path.join(PROJECT_ROOT, 'resources', 'fonts', 'OFL-1.1.txt')));

  // 2. extraResources config ships the fonts folder
  const extra = pkg.build.extraResources || [];
  const fontsEntry = extra.find((e) => String(e.from || '').includes('fonts') || String(e.to || '') === 'fonts');
  check('package.json extraResources ships resources/fonts', !!fontsEntry,
    JSON.stringify(fontsEntry));

  // 3. Rendered receipt HTML references the font
  const sample = designer.buildSampleSale();
  const design = shared.defaultDocumentDesign('receipt', 'thermal80');
  // Add an Urdu block (using the urdu block type if present, otherwise a text block with Urdu)
  if (Array.isArray(design.sections)) {
    design.sections.unshift({
      id: 'urdu-test',
      type: 'text',
      enabled: true,
      text: 'شکریہ',
      style: { fontFamily: "'Noto Nastaliq Urdu', serif" },
    });
  }
  const html = designer.buildDesignedReceipt(sample, 'thermal80', design);
  check('HTML uses the @font-face directive',
    /@font-face/.test(html) && /Noto Nastaliq Urdu/i.test(html),
    'font-face/Noto present');
  check('HTML references the font file',
    /NotoNastaliqUrdu-Regular\.ttf/.test(html),
    'filename present');

  console.log(`\n${checks - failures}/${checks} urdu-font checks passed.`);
  if (failures) { console.error('URDU FONT TEST FAILED'); process.exit(1); }
  else { console.log('ALL URDU FONT CHECKS PASSED'); process.exit(0); }
}

run().catch(e => { console.error('Test crashed:', e); process.exit(1); });