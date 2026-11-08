/**
 * Invoice-template config extraction regression (C9).
 *
 * The designer preview used to be an inline JSX block that ignored the
 * persisted TemplateConfig. The config now lives in
 * src/shared/invoiceTemplateConfig.ts and is shared by the main service and the
 * renderer preview. These checks pin the normalisation rules.
 */
const {
  DEFAULT_TEMPLATE_CONFIG,
  normalizeTemplateConfig,
  parseTemplateConfig,
} = require('../dist/shared/invoiceTemplateConfig.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error('Assertion failed: ' + message);
}

function test(name, fn) {
  try {
    fn();
    console.log('  ok  ' + name);
    passed++;
  } catch (e) {
    console.error('FAIL  ' + name);
    console.error('      ' + (e instanceof Error ? e.message : String(e)));
    failed++;
  }
}

console.log('\n=== invoice template config tests ===');

test('missing JSON falls back to complete defaults', () => {
  const cfg = normalizeTemplateConfig(null);
  for (const key of Object.keys(DEFAULT_TEMPLATE_CONFIG)) {
    if (key === 'headerLines' || key === 'customFields') continue;
    assert(cfg[key] === DEFAULT_TEMPLATE_CONFIG[key], key + ' should equal the default');
  }
  assert(Array.isArray(cfg.headerLines) && cfg.headerLines.length === 0, 'headerLines defaults to []');
  assert(typeof cfg.customFields === 'object', 'customFields defaults to {}');
});

test('explicit values override defaults', () => {
  const cfg = normalizeTemplateConfig({
    showShopName: false,
    showFooter: false,
    fontSize: 18,
    primaryColor: '#123456',
    footerText: 'Bye',
    boldInvoiceNo: false,
  });
  assert(cfg.showShopName === false, 'showShopName is honoured');
  assert(cfg.showFooter === false, 'showFooter is honoured');
  assert(cfg.fontSize === 18, 'fontSize is honoured');
  assert(cfg.primaryColor === '#123456', 'primaryColor is honoured');
  assert(cfg.footerText === 'Bye', 'footerText is honoured');
  assert(cfg.boldInvoiceNo === false, 'boldInvoiceNo is honoured');
  assert(cfg.showTotals === true, 'unspecified flags keep their default');
});

test('wrongly-typed values fall back instead of leaking through', () => {
  const cfg = normalizeTemplateConfig({
    showShopName: 'yes',
    fontSize: 'big',
    primaryColor: 42,
    headerLines: ['a', 3, null, 'b'],
  });
  assert(cfg.showShopName === true, 'non-boolean toggle falls back');
  assert(cfg.fontSize === DEFAULT_TEMPLATE_CONFIG.fontSize, 'non-number font size falls back');
  assert(cfg.primaryColor === DEFAULT_TEMPLATE_CONFIG.primaryColor, 'non-string colour falls back');
  assert(JSON.stringify(cfg.headerLines) === JSON.stringify(['a', 'b']), 'headerLines keeps only strings');
});

test('font size is clamped to a sane range', () => {
  assert(normalizeTemplateConfig({ fontSize: 2 }).fontSize === 6, 'minimum is 6');
  assert(normalizeTemplateConfig({ fontSize: 200 }).fontSize === 32, 'maximum is 32');
});

test('parseTemplateConfig never throws on corrupt JSON', () => {
  const broken = parseTemplateConfig('{not json');
  assert(broken.fontSize === DEFAULT_TEMPLATE_CONFIG.fontSize, 'corrupt JSON uses defaults');
  const empty = parseTemplateConfig('');
  assert(empty.primaryColor === DEFAULT_TEMPLATE_CONFIG.primaryColor, 'empty string uses defaults');
  const good = parseTemplateConfig(JSON.stringify({ fontSize: 15 }));
  assert(good.fontSize === 15, 'valid JSON is parsed');
});

test('unknown fields are dropped', () => {
  const cfg = normalizeTemplateConfig({ fontSize: 12, javascriptUrl: 'javascript:alert(1)' });
  assert(cfg.javascriptUrl === undefined, 'unknown keys are not copied through');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exitCode = 1;
else console.log('ALL PASSED');
