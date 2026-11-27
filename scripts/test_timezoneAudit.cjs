#!/usr/bin/env node
/**
 * Phase 0 item 0.3 — timezone / business-day audit.
 *
 * Two layers:
 *  1. a STATIC guard: no source file may use `new Date().toISOString()` as a
 *     "today" value (that is UTC, not the shop's local date). Timestamps are
 *     still allowed — only the date-slicing patterns are banned.
 *  2. boundary maths on the ONE shared resolver: a 04:00 business-day anchor
 *     must include the evening sales and exclude the small hours of the next
 *     calendar day (the old Z-report window used UTC midnight).
 *
 * Run: npm run test:timezone
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { resolveBusinessRange, businessDayBounds, presetRange } = require(
  path.join(ROOT, 'dist', 'shared', 'salesHistory.js')
);

let checks = 0;
let failures = 0;

function check(name, condition, detail) {
  checks++;
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ' -- ' + detail : ''}`);
}

const BANNED = [
  /new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/,
  /new Date\(\)\.toISOString\(\)\.substring\(0,\s*10\)/,
  /new Date\(\)\.toISOString\(\)\.split\(['"]T['"]\)\[0\]/,
];

function scan() {
  const hits = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', '.git'].includes(entry.name)) walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, 'utf8');
      const rel = path.relative(ROOT, full);
      text.split(/\r?\n/).forEach((line, i) => {
        for (const re of BANNED) {
          if (re.test(line)) hits.push(`${rel}:${i + 1}  ${line.trim()}`);
        }
      });
    }
  }
  walk(path.join(ROOT, 'src'));
  return hits;
}

function utc(sql) {
  return Date.parse(sql.replace(' ', 'T') + 'Z');
}

function run() {
  console.log('=== static guard: no UTC "today" ===');
  const hits = scan();
  check('no new Date().toISOString() date slices in src/', hits.length === 0, hits.slice(0, 5).join(' | '));

  console.log('\n=== business day at midnight anchor (Asia/Karachi, UTC+5) ===');
  // 23:00 PKT on 26 Nov = 18:00 UTC.
  const night = resolveBusinessRange(null, null, 0, 'Asia/Karachi', new Date('2026-11-26T18:00:00Z'));
  check('business date is the local date', night.businessDate === '2026-11-26', night.businessDate);
  check('day starts at local midnight', night.fromUtc === '2026-11-25 19:00:00', night.fromUtc);
  check('day ends at next local midnight', night.toUtc === '2026-11-26 19:00:00', night.toUtc);

  console.log('\n=== 04:00 anchor: evening sales stay in the business day ===');
  // 01:00 PKT on 27 Nov = 20:00 UTC on 26 Nov — still business day 26 Nov.
  const early = resolveBusinessRange(null, null, 4, 'Asia/Karachi', new Date('2026-11-26T20:00:00Z'));
  check('01:00 local belongs to the previous business date', early.businessDate === '2026-11-26', early.businessDate);
  check('04:00 anchor start is 23:00 UTC the day before', early.fromUtc === '2026-11-25 23:00:00', early.fromUtc);
  check('04:00 anchor end is 23:00 UTC', early.toUtc === '2026-11-26 23:00:00', early.toUtc);

  // The Z-report window is [fromUtc, toUtc). String comparison is what SQL does.
  const eveningSale = '2026-11-26 17:00:00'; // 22:00 PKT
  const smallHours = '2026-11-25 21:00:00'; // 02:00 PKT on the 26th → previous business day
  const nextMorning = '2026-11-26 23:30:00'; // 04:30 PKT on the 27th → next business day
  check(
    '22:00 sale is inside the Z window',
    eveningSale >= early.fromUtc && eveningSale < early.toUtc,
    `${early.fromUtc} <= ${eveningSale} < ${early.toUtc}`
  );
  check('02:00 sale is outside the Z window', !(smallHours >= early.fromUtc && smallHours < early.toUtc), smallHours);
  check('04:30 next-day sale is outside the Z window', !(nextMorning >= early.fromUtc && nextMorning < early.toUtc), nextMorning);

  console.log('\n=== shared preset + bounds agree ===');
  const bounds = businessDayBounds('2026-11-26', '2026-11-26', 4, 'Asia/Karachi');
  check('businessDayBounds matches resolveBusinessRange', bounds.fromUtc === early.fromUtc && bounds.toUtc === early.toUtc);
  const preset = presetRange('today', 4, new Date('2026-11-26T20:00:00Z'), 'Asia/Karachi');
  check('presetRange(today) uses the business date', preset.from === '2026-11-26' && preset.to === '2026-11-26', JSON.stringify(preset));
  check('bounds are real UTC instants', Number.isFinite(utc(early.fromUtc)) && Number.isFinite(utc(early.toUtc)));

  console.log('\n=== multi-day range is inclusive of both local dates ===');
  const week = resolveBusinessRange('2026-11-20', '2026-11-26', 4, 'Asia/Karachi', new Date('2026-11-26T20:00:00Z'));
  check('week start is 20 Nov 04:00 PKT', week.fromUtc === '2026-11-19 23:00:00', week.fromUtc);
  check('week end is 27 Nov 04:00 PKT', week.toUtc === '2026-11-26 23:00:00', week.toUtc);
  check('range echoes the requested local dates', week.from === '2026-11-20' && week.to === '2026-11-26');

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('All timezone / business-day checks passed.');
}

run();
