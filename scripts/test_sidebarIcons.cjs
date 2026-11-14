/**
 * Item 5 — the icon set.
 *
 * Imports the REAL compiled code (dist/shared/sidebarIcons.js and
 * dist/shared/sidebarMenu.js) and checks:
 *   - every page in the ONE menu has an icon in the ONE icon set
 *   - no two pages wear the SAME icon (the STEP 0 duplicate-icon finding)
 *   - the three pairs that used to share a picture are now different
 *   - every shape is a real SVG shape with attributes, and no shape tries to
 *     set its own stroke/fill (the wrapper owns the colours)
 */
const {
  SIDEBAR_ICON_SHAPES,
  SIDEBAR_ICON_IDS,
  sidebarIconShapes,
  iconShapeKey,
  iconKeyFor,
} = require('E:/antigravty/billing softwere/pos-app/dist/shared/sidebarIcons.js');
const {
  SIDEBAR_ITEMS,
  SIDEBAR_GROUPS,
} = require('E:/antigravty/billing softwere/pos-app/dist/shared/sidebarMenu.js');

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  [PASS] ${name}${detail ? ' — ' + detail : ''}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

const ALLOWED_TAGS = ['path', 'rect', 'circle', 'line', 'polyline', 'polygon', 'ellipse'];

console.log('=== test_sidebarIcons (item 5) ===');

section('The menu and the icon set');
check('the menu has 23 pages', SIDEBAR_ITEMS.length === 23, `${SIDEBAR_ITEMS.length} pages`);
check(
  'every page asks for an icon that exists',
  SIDEBAR_ITEMS.every((item) => Array.isArray(SIDEBAR_ICON_SHAPES[item.iconId])),
  SIDEBAR_ITEMS.filter((i) => !SIDEBAR_ICON_SHAPES[i.iconId]).map((i) => i.iconId).join(', ') || 'none missing'
);
check(
  'every page asks for a DIFFERENT icon',
  new Set(SIDEBAR_ITEMS.map((i) => i.iconId)).size === SIDEBAR_ITEMS.length,
  `${new Set(SIDEBAR_ITEMS.map((i) => i.iconId)).size} icons for ${SIDEBAR_ITEMS.length} pages`
);
check(
  'the icon set holds exactly the menu pages',
  SIDEBAR_ICON_IDS.length === SIDEBAR_ITEMS.length,
  `${SIDEBAR_ICON_IDS.length} icons in the set`
);
check(
  'no icon is left over from another page',
  SIDEBAR_ICON_IDS.every((id) => SIDEBAR_ITEMS.some((i) => i.iconId === id)),
  SIDEBAR_ICON_IDS.filter((id) => !SIDEBAR_ITEMS.some((i) => i.iconId === id)).join(', ') || 'none extra'
);

section('No two icons are the same picture');
const keys = SIDEBAR_ICON_IDS.map((id) => iconKeyFor(id));
const duplicates = SIDEBAR_ICON_IDS.filter((id, i) => keys.indexOf(keys[i]) !== i);
check('every icon draws something different', duplicates.length === 0, duplicates.join(', ') || 'all different');
check(
  'the icon key is stable',
  iconKeyFor('billing') === iconKeyFor('billing') && iconKeyFor('billing') !== iconKeyFor('reports')
);

// The pairs STEP 0 found wearing the same picture.
check(
  'the quotation bubble is not the invoice sheet',
  iconKeyFor('quotations') !== iconKeyFor('invoiceAdmin')
);
check(
  'the commission coins are not the users',
  iconKeyFor('commissions') !== iconKeyFor('users')
);
check(
  'the custom-report funnel is not the promotion percent',
  iconKeyFor('customReports') !== iconKeyFor('promotions')
);
check(
  'the return arrow is not the transfer arrows',
  iconKeyFor('returns') !== iconKeyFor('transfers')
);
check(
  'the shift clock is not the dashboard',
  iconKeyFor('shifts') !== iconKeyFor('dashboard')
);

section('Every shape is a real SVG shape');
let badTag = [];
let noAttrs = [];
let ownColour = [];
let handler = [];
for (const id of SIDEBAR_ICON_IDS) {
  for (const shape of sidebarIconShapes(id)) {
    if (!ALLOWED_TAGS.includes(shape.tag)) badTag.push(`${id}:${shape.tag}`);
    if (!shape.attrs || Object.keys(shape.attrs).length === 0) noAttrs.push(id);
    for (const key of Object.keys(shape.attrs)) {
      if (['stroke', 'fill', 'strokeWidth', 'style', 'class'].includes(key)) ownColour.push(`${id}:${key}`);
      if (/^on/i.test(key)) handler.push(`${id}:${key}`);
    }
  }
}
check('every shape uses a known SVG tag', badTag.length === 0, badTag.join(', ') || 'all known');
check('every shape carries attributes', noAttrs.length === 0, noAttrs.join(', ') || 'all carry attributes');
check('no shape sets its own colour', ownColour.length === 0, ownColour.join(', ') || 'the wrapper owns the colours');
check('no shape carries an event handler', handler.length === 0, handler.join(', ') || 'none');
check(
  'every icon has at least one shape',
  SIDEBAR_ICON_IDS.every((id) => sidebarIconShapes(id).length > 0)
);
check(
  'an unknown icon id draws nothing',
  sidebarIconShapes('no-such-icon').length === 0 && iconKeyFor('no-such-icon') === ''
);
check(
  'the key of an icon lists its shapes',
  iconShapeKey(sidebarIconShapes('billing')).includes('rect') &&
    iconShapeKey(sidebarIconShapes('billing')).includes('circle')
);

section('The groups still line up');
check('there are five groups', SIDEBAR_GROUPS.length === 5);
check(
  'the Setup group is the separated one',
  SIDEBAR_GROUPS.filter((g) => g.separated).length === 1 &&
    SIDEBAR_GROUPS.find((g) => g.separated).id === 'setup'
);

console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'}: ${passed}/${passed + failed} checks passed`);
if (failed > 0) process.exit(1);
