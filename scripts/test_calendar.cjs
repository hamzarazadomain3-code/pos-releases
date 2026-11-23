#!/usr/bin/env node
/**
 * The date picker's calendar — the PURE grid suite.
 *
 * It imports the REAL `src/shared/calendarGrid.ts` (built to
 * `dist/shared/calendarGrid.js`) and the REAL `src/shared/dateParse.ts`, so
 * every assertion covers the code the renderer draws the popup from.
 *
 * The rules that must never drift:
 *   - the month grid is ALWAYS 6 weeks x 7 days, whatever month is shown
 *     (so the popup never jumps in height while the owner pages through),
 *   - the leading / trailing cells are the neighbouring months, and exactly
 *     `daysInMonth` cells are marked `inMonth`,
 *   - the month arithmetic crosses year boundaries both ways (December -> +1
 *     is January of the next year; January -> -1 is December of the last),
 *   - "today" is the LOCAL date, never the UTC one (a shop at 23:30 local is
 *     still on today's date even when UTC has already rolled over),
 *   - arrow-key arithmetic crosses month and leap-year boundaries,
 *   - a date the owner CLICKS and the same date the owner TYPES land on the
 *     same ISO string in every one of the three admin date formats.
 *
 * Usage (after `npm run build:main`):
 *   node scripts/test_calendar.cjs
 */

const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

let checks = 0;
let failures = 0;

function check(name, condition, detail) {
  checks++;
  if (!condition) failures++;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ' -- ' + detail : ''}`);
  return condition;
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function run() {
  const grid = require(path.join(PROJECT_ROOT, 'dist', 'shared', 'calendarGrid.js'));
  const dateParse = require(path.join(PROJECT_ROOT, 'dist', 'shared', 'dateParse.js'));

  const {
    DEFAULT_MONTH_NAMES,
    DEFAULT_WEEKDAY_LABELS,
    addDays,
    daysInMonth,
    firstWeekday,
    isoParts,
    isValidIso,
    monthLabel,
    monthMatrix,
    monthViewOf,
    shiftMonth,
    toIso,
    todayIso,
  } = grid;

  console.log('=== Rokar POS - the date picker calendar (pure grid) ===');

  // ── The grid shape ───────────────────────────────────────────────────────
  section('The grid is always 6 weeks x 7 days');
  const nov2026 = monthMatrix(2026, 11);
  check('the grid has 6 weeks', nov2026.length === 6, String(nov2026.length));
  check('every week has 7 days', nov2026.every((w) => w.length === 7));
  check('the grid has 42 cells', nov2026.reduce((n, w) => n + w.length, 0) === 42);
  check('every cell is a real ISO date', nov2026.every((w) => w.every((d) => isValidIso(d.iso))));

  let everyMonthOk = true;
  let worst = '';
  for (let y = 2023; y <= 2028; y++) {
    for (let m = 1; m <= 12; m++) {
      const weeks = monthMatrix(y, m);
      const flat = weeks.flat();
      const inMonth = flat.filter((d) => d.inMonth);
      const ok =
        weeks.length === 6 &&
        weeks.every((w) => w.length === 7) &&
        flat.every((d) => isValidIso(d.iso)) &&
        inMonth.length === daysInMonth(y, m) &&
        inMonth[0].day === 1 &&
        inMonth[inMonth.length - 1].day === daysInMonth(y, m) &&
        inMonth.every((d, i) => d.day === i + 1) &&
        new Set(flat.map((d) => d.iso)).size === 42;
      if (!ok) {
        everyMonthOk = false;
        worst = `${y}-${m}`;
        break;
      }
    }
    if (!everyMonthOk) break;
  }
  check('all 72 months (2023..2028) lay out correctly', everyMonthOk, worst);

  // ── The month boundaries, with known months ──────────────────────────────
  section('The month boundaries (known months)');
  check('November 2026 starts on a Sunday', firstWeekday(2026, 11) === 0, String(firstWeekday(2026, 11)));
  check('the first cell of November 2026 is 2026-11-01', nov2026[0][0].iso === '2026-11-01', nov2026[0][0].iso);
  check('the first cell is marked "in month"', nov2026[0][0].inMonth === true);
  const novIn = nov2026.flat().filter((d) => d.inMonth);
  check('November 2026 has 30 in-month days', novIn.length === 30, String(novIn.length));
  check('its last in-month day is 2026-11-30', novIn[novIn.length - 1].iso === '2026-11-30', novIn[novIn.length - 1].iso);
  const novTail = nov2026.flat().filter((d) => !d.inMonth && d.iso > '2026-11-30');
  check(
    'the trailing cells start at 1 December and run to 12 December',
    novTail.length === 12 && novTail[0].iso === '2026-12-01' && novTail[11].iso === '2026-12-12',
    `${novTail.length} cells: ${novTail[0].iso}..${novTail[11].iso}`
  );
  check(
    'the last in-month week holds 29 and 30 November, then 1..5 December',
    same(nov2026[4].map((d) => d.iso), [
      '2026-11-29', '2026-11-30',
      '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05',
    ]),
    nov2026[4].map((d) => d.iso).join(',')
  );

  const aug2026 = monthMatrix(2026, 8);
  check('August 2026 starts on a Saturday', firstWeekday(2026, 8) === 6, String(firstWeekday(2026, 8)));
  const augLead = aug2026[0].filter((d) => !d.inMonth);
  check('it shows 6 leading days of July', augLead.length === 6, String(augLead.length));
  check('the leading cells are 2026-07-26..31', augLead[0].iso === '2026-07-26' && augLead[5].iso === '2026-07-31', `${augLead[0].iso}..${augLead[5].iso}`);
  check('its last in-month day is 2026-08-31', (() => {
    const inMonth = aug2026.flat().filter((d) => d.inMonth);
    return inMonth[inMonth.length - 1].iso === '2026-08-31';
  })(), aug2026.flat().filter((d) => d.inMonth).slice(-1)[0].iso);
  check('the month still fits in 6 weeks (6 + 31 = 37 cells)', aug2026.flat().filter((d) => d.inMonth).length === 31);

  const feb2024 = monthMatrix(2024, 2);
  check('February 2024 (leap) has 29 in-month days', feb2024.flat().filter((d) => d.inMonth).length === 29);
  check('the 29th cell is 2024-02-29', feb2024.flat().some((d) => d.iso === '2024-02-29' && d.inMonth));
  const feb2026 = monthMatrix(2026, 2);
  check('February 2026 has 28 in-month days', feb2026.flat().filter((d) => d.inMonth).length === 28);
  check('2026-02-29 is nowhere in the grid', !feb2026.flat().some((d) => d.iso === '2026-02-29'));

  // ── The month arithmetic ─────────────────────────────────────────────────
  section('The month arithmetic (across the year and the leap years)');
  check('daysInMonth(2024, 2) = 29', daysInMonth(2024, 2) === 29);
  check('daysInMonth(2026, 2) = 28', daysInMonth(2026, 2) === 28);
  check('daysInMonth(2026, 11) = 30', daysInMonth(2026, 11) === 30);
  check('daysInMonth(2000, 2) = 29 (the 400-year rule)', daysInMonth(2000, 2) === 29);
  check('daysInMonth(1900, 2) = 28 (the 100-year rule)', daysInMonth(1900, 2) === 28);
  check('December + 1 = January of the next year', same(shiftMonth(2026, 12, 1), { year: 2027, month: 1 }));
  check('January - 1 = December of the last year', same(shiftMonth(2026, 1, -1), { year: 2025, month: 12 }));
  check('November - 11 = December of the last year', same(shiftMonth(2026, 11, -11), { year: 2025, month: 12 }));
  check('November + 13 = December of the next year', same(shiftMonth(2026, 11, 13), { year: 2027, month: 12 }));
  const fwd = shiftMonth(2026, 11, 5);
  check('+5 then -5 returns to the same month', same(shiftMonth(fwd.year, fwd.month, -5), { year: 2026, month: 11 }));
  let allShiftsOk = true;
  for (let y = 2020; y <= 2030; y++) {
    for (let m = 1; m <= 12; m++) {
      for (const d of [-25, -13, -1, 1, 13, 25]) {
        const s = shiftMonth(y, m, d);
        if (s.month < 1 || s.month > 12 || !Number.isInteger(s.month) || !Number.isInteger(s.year)) allShiftsOk = false;
      }
    }
  }
  check('every shift keeps the month inside 1..12', allShiftsOk);

  // ── "Today" is LOCAL ─────────────────────────────────────────────────────
  section('"Today" is the LOCAL date (the UTC trap)');
  check('todayIso(2026-11-23) = 2026-11-23', todayIso(new Date(2026, 10, 23)) === '2026-11-23', todayIso(new Date(2026, 10, 23)));
  check(
    'a 23:30 local clock is still today (not tomorrow)',
    todayIso(new Date(2026, 10, 23, 23, 30, 0)) === '2026-11-23',
    todayIso(new Date(2026, 10, 23, 23, 30, 0))
  );
  check(
    'a 00:30 local clock is today (not yesterday)',
    todayIso(new Date(2026, 10, 23, 0, 30, 0)) === '2026-11-23',
    todayIso(new Date(2026, 10, 23, 0, 30, 0))
  );
  check('the single-digit month and day are padded', toIso(2026, 1, 5) === '2026-01-05', toIso(2026, 1, 5));

  // ── The day arithmetic (the arrow keys) ──────────────────────────────────
  section('The day arithmetic (the arrow keys)');
  check('30 Nov + 1 = 1 Dec', addDays('2026-11-30', 1) === '2026-12-01', addDays('2026-11-30', 1));
  check('1 Mar - 1 = 28 Feb (a non-leap year)', addDays('2026-03-01', -1) === '2026-02-28', addDays('2026-03-01', -1));
  check('28 Feb + 1 = 29 Feb (a leap year)', addDays('2024-02-28', 1) === '2024-02-29', addDays('2024-02-28', 1));
  check('1 Mar - 1 = 29 Feb (a leap year)', addDays('2024-03-01', -1) === '2024-02-29', addDays('2024-03-01', -1));
  check('31 Dec + 1 = 1 Jan of the next year', addDays('2026-12-31', 1) === '2027-01-01', addDays('2026-12-31', 1));
  check('1 Jan - 1 = 31 Dec of the last year', addDays('2026-01-01', -1) === '2025-12-31', addDays('2026-01-01', -1));
  check('+7 from a Monday is the next Monday', addDays('2026-11-23', 7) === '2026-11-30', addDays('2026-11-23', 7));
  check('a whole month of daily steps never skips a day', (() => {
    let iso = '2026-11-01';
    for (let i = 0; i < 29; i++) {
      const next = addDays(iso, 1);
      if (isoParts(next).day !== isoParts(iso).day + 1) return false;
      iso = next;
    }
    return iso === '2026-11-30';
  })());

  // ── The validation ───────────────────────────────────────────────────────
  section('The validation (never a fake date)');
  check('2026-02-29 is rejected', isValidIso('2026-02-29') === false);
  check('2024-02-29 is accepted', isValidIso('2024-02-29') === true);
  check('2026-13-01 is rejected', isValidIso('2026-13-01') === false);
  check('2026-00-10 is rejected', isValidIso('2026-00-10') === false);
  check('2026-11-00 is rejected', isValidIso('2026-11-00') === false);
  check('2026-11-31 is rejected', isValidIso('2026-11-31') === false);
  check('an unpadded date is rejected', isValidIso('2026-1-1') === false);
  check('junk is rejected', isValidIso('junk') === false && isValidIso('') === false && isValidIso(null) === false);
  check('isoParts splits a real date', same(isoParts('2026-11-23'), { year: 2026, month: 11, day: 23 }));
  check('isoParts rejects junk', isoParts('23/11/2026') === null);
  check('monthViewOf a date', same(monthViewOf('2026-11-23'), { year: 2026, month: 11 }));
  check('monthViewOf junk is null', monthViewOf('junk') === null);

  // ── The labels ───────────────────────────────────────────────────────────
  section('The labels');
  check('monthLabel(2026, 11) = "November 2026"', monthLabel(2026, 11) === 'November 2026', monthLabel(2026, 11));
  check('it has all 12 month names', DEFAULT_MONTH_NAMES.length === 12);
  check('the week starts on Sunday', DEFAULT_WEEKDAY_LABELS.length === 7 && DEFAULT_WEEKDAY_LABELS[0] === 'Su', DEFAULT_WEEKDAY_LABELS.join(','));
  check(
    'it takes Urdu month names',
    monthLabel(2026, 11, ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر']) === 'نومبر 2026',
    monthLabel(2026, 11, ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'])
  );
  check('a short month array falls back to English', monthLabel(2026, 11, ['x']) === 'November 2026', monthLabel(2026, 11, ['x']));

  // ── A clicked date === a typed date (the REAL input helpers) ─────────────
  section('A clicked date and a typed date are the SAME date');
  const formats = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];
  let formatsOk = true;
  let formatsDetail = '';
  for (const fmt of formats) {
    for (let y = 2023; y <= 2027; y++) {
      for (let m = 1; m <= 12; m++) {
        for (const cell of monthMatrix(y, m).flat()) {
          const text = dateParse.formatInputDate(cell.iso, fmt);
          const back = dateParse.parseInputDate(text, fmt);
          if (back !== cell.iso) {
            formatsOk = false;
            formatsDetail = `${fmt}: ${cell.iso} -> "${text}" -> ${back}`;
            break;
          }
        }
        if (!formatsOk) break;
      }
      if (!formatsOk) break;
    }
  }
  check('every cell of 2023..2027 round-trips in all three formats', formatsOk, formatsDetail);
  check(
    '23 Nov 2026 typed as 23/11/2026 is 2026-11-23',
    dateParse.parseInputDate('23/11/2026', 'DD/MM/YYYY') === '2026-11-23',
    dateParse.parseInputDate('23/11/2026', 'DD/MM/YYYY')
  );
  check(
    'a clicked 2026-11-23 displays as 23/11/2026',
    dateParse.formatInputDate('2026-11-23', 'DD/MM/YYYY') === '23/11/2026',
    dateParse.formatInputDate('2026-11-23', 'DD/MM/YYYY')
  );

  console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILED'}: ${checks - failures}/${checks} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

try {
  run();
} catch (e) {
  console.error('CRASH:', e && e.stack ? e.stack : e);
  process.exit(1);
}
