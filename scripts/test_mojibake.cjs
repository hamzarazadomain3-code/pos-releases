#!/usr/bin/env node
/**
 * UTF-8 / mojibake guard (Phase 0 item 0.6).
 *
 * Fails if any source, migration or i18n file contains
 *   - U+FFFD (the "replacement character" — a decode failure), or
 *   - one of the known double-encoded sequences (`â€"`, `Ã—`, `Â—`, …).
 *
 * `scripts/phase_b_counts.js` is excluded on purpose: it is a diagnostic that
 * SEARCHES the database for mojibake, so it contains the patterns as data.
 *
 * Run: npm run test:utf8
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ROOTS = ['src', 'migrations'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist_release', '.git', 'release']);
const SKIP_FILES = new Set([path.join('scripts', 'phase_b_counts.js')]);
const EXT = /\.(ts|tsx|js|cjs|mjs|json|css|html|md)$/;

// The exact sequences produced by UTF-8 bytes read as Windows-1252.
const MOJIBAKE = [
  '\u00E2\u20AC\u201D', // —
  '\u00E2\u20AC\u201C', // “
  '\u00E2\u20AC\u009D', // ”
  '\u00E2\u20AC\u00A2', // •
  '\u00E2\u20AC\u00A6', // …
  '\u00E2\u20AC\u2122', // ’
  '\u00E2\u20AC\u2018', // ‘
  '\u00E2\u20AC\u2019', // ’
  '\u00E2\u2020\u2019', // →
  '\u00E2\u02C6\u2019', // −
  '\u00E2\u201C\u20AC', // ─
  '\u00E2\u201D\u20AC', // ─
  '\u00C3\u2014', // ×
  '\u00C3\u00A9', // é
  '\u00C3\u00A2', // â
  '\u00C2\u00B0', // °
  '\u00C2\u00B7', // ·
];

const hits = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full);
      continue;
    }
    if (!EXT.test(entry.name)) continue;
    if (SKIP_FILES.has(path.relative(ROOT, full))) continue;
    const text = fs.readFileSync(full, 'utf8');
    const rel = path.relative(ROOT, full);
    text.split(/\r?\n/).forEach((line, i) => {
      if (line.includes('\uFFFD')) {
        hits.push(`${rel}:${i + 1}  U+FFFD replacement character`);
      }
      for (const seq of MOJIBAKE) {
        if (line.includes(seq)) {
          hits.push(`${rel}:${i + 1}  ${JSON.stringify(seq)}`);
        }
      }
    });
  }
}

for (const root of ROOTS) {
  const full = path.join(ROOT, root);
  if (fs.existsSync(full)) walk(full);
}

if (hits.length > 0) {
  console.error(`MOJIBAKE / UTF-8 FAILED — ${hits.length} hit(s):`);
  for (const h of hits.slice(0, 50)) console.error('  ' + h);
  if (hits.length > 50) console.error(`  … and ${hits.length - 50} more`);
  process.exit(1);
}

console.log('UTF-8 scan: clean (0 mojibake sequences, 0 U+FFFD)');
console.log(`Scanned: ${ROOTS.join(', ')}`);
