/**
 * Item 6 — the sidebar footer.
 *
 * Imports the REAL compiled code (dist/shared/sidebarFooter.js) and checks:
 *   - the language toggle offers the OTHER language (one button, never two)
 *   - the role label follows the ONE role list
 *   - the name in the user block is cleaned up
 *   - the avatar carries at most two letters (and never an empty circle)
 *   - the i18n files really carry the keys the footer asks for
 */
const fs = require('fs');
const path = require('path');
const {
  languageToggleTarget,
  languageToggleLabelKey,
  roleLabelKey,
  knownRole,
  userDisplayName,
  userInitials,
} = require('E:/antigravty/billing softwere/pos-app/dist/shared/sidebarFooter.js');

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

const ROOT = 'E:/antigravty/billing softwere/pos-app';

console.log('=== test_sidebarFooter (item 6) ===');

section('One language toggle, offering the other language');
check('English offers Urdu', languageToggleTarget('en') === 'ur');
check('Urdu offers English', languageToggleTarget('ur') === 'en');
check('an empty language offers Urdu', languageToggleTarget('') === 'ur');
check('a missing language offers Urdu', languageToggleTarget(null) === 'ur');
check('a strange language offers Urdu', languageToggleTarget('fr') === 'ur');
check('the target is never the same language', languageToggleTarget('en') !== 'en');
check('English shows the Urdu label', languageToggleLabelKey('en') === 'sidebar.switchToUrdu');
check('Urdu shows the English label', languageToggleLabelKey('ur') === 'sidebar.switchToEnglish');

section('The role label');
check('the owner is the owner', roleLabelKey('owner') === 'sidebar.roleOwner');
check('the manager is the manager', roleLabelKey('manager') === 'sidebar.roleManager');
check('the cashier is the cashier', roleLabelKey('cashier') === 'sidebar.roleCashier');
check('an unknown role is a plain user', roleLabelKey('auditor') === 'sidebar.roleUser');
check('a missing role is a plain user', roleLabelKey(null) === 'sidebar.roleUser');
check('the role is case-insensitive', roleLabelKey('OWNER') === 'sidebar.roleOwner');
check('a known role is recognised', knownRole('manager') === 'manager');
check('an unknown role is not one', knownRole('auditor') === '');

section('The user block');
check('the name is trimmed', userDisplayName('  Hamza  ') === 'Hamza');
check('the extra spaces are gone', userDisplayName('Hamza    Raza') === 'Hamza Raza');
check('an empty name is empty', userDisplayName('') === '');
check('a missing name is empty', userDisplayName(null) === '');
check('one word gives one letter', userInitials('Hamza') === 'H');
check('two words give two letters', userInitials('Hamza Raza') === 'HR');
check('three words still give two letters', userInitials('Hamza Raza Khan') === 'HR');
check('an empty name never gives an empty circle', userInitials('') === '?');
check('a missing name never gives an empty circle', userInitials(null) === '?');
check('a name that is only spaces is clean', userDisplayName('   ') === '' && userInitials('   ') === '?');

section('The i18n keys are really there');
const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/renderer/src/i18n/en.json'), 'utf8'));
const ur = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/renderer/src/i18n/ur.json'), 'utf8'));
const needed = [
  'switchToEnglish',
  'switchToUrdu',
  'roleOwner',
  'roleManager',
  'roleCashier',
  'roleUser',
  'signOut',
  'collapse',
  'expand',
  'signedInAs',
];
check(
  'English carries every footer label',
  needed.every((k) => typeof en.sidebar?.[k] === 'string' && en.sidebar[k].length > 0),
  needed.filter((k) => !en.sidebar?.[k]).join(', ') || 'all there'
);
check(
  'Urdu carries every footer label',
  needed.every((k) => typeof ur.sidebar?.[k] === 'string' && ur.sidebar[k].length > 0),
  needed.filter((k) => !ur.sidebar?.[k]).join(', ') || 'all there'
);
check(
  'the two languages really differ',
  en.sidebar.roleOwner !== ur.sidebar.roleOwner && en.sidebar.signOut !== ur.sidebar.signOut
);
check(
  'the English toggle really says English',
  en.sidebar.switchToEnglish === 'English' && ur.sidebar.switchToEnglish === 'English'
);

console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'}: ${passed}/${passed + failed} checks passed`);
if (failed > 0) process.exit(1);
