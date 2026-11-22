#!/usr/bin/env node
/**
 * Log rotation / size cap — PURE rules test suite.
 *
 * Tests the retention and rotation rules in `src/shared/logRotation.ts` using
 * the REAL built dist code.
 *
 * Usage: npm run test:logRotation
 * Exit code 0 = all checks passed.
 */

const path = require('path');

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

const {
  DEFAULT_KEEP_DAYS,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_ROTATIONS,
  dailyLogName,
  rotatedLogName,
  logFileDay,
  isAppLogFile,
  logFileIndex,
  shouldRotate,
  exceedsCap,
  daysBetween,
  planLogRetention,
  planRotation,
} = require('../dist/shared/logRotation.js');

console.log('=== Log rotation / size cap — pure rules ===');

section('File names');
check('the daily name is app-<day>.log', dailyLogName('2026-11-22') === 'app-2026-11-22.log', dailyLogName('2026-11-22'));
check('a rotated name carries the index', rotatedLogName('2026-11-22', 2) === 'app-2026-11-22.log.2', rotatedLogName('2026-11-22', 2));
check('the day is read back', logFileDay('app-2026-11-22.log') === '2026-11-22');
check('the day is read back from a rotated file', logFileDay('app-2026-11-22.log.3') === '2026-11-22');
check('a foreign file has no day', logFileDay('notes.txt') === null);
check('a foreign file is not ours', isAppLogFile('notes.txt') === false);
check('a lookalike file is not ours', isAppLogFile('app-2026-11-22.log.bak') === false);
check('our file is ours', isAppLogFile('app-2026-11-22.log') === true);
check('the live file is index 0', logFileIndex('app-2026-11-22.log') === 0);
check('a rotated file carries its index', logFileIndex('app-2026-11-22.log.4') === 4);

section('The size cap');
check('a file below the cap is not rotated', shouldRotate(100, 1000) === false);
check('a file at the cap IS rotated', shouldRotate(1000, 1000) === true);
check('a file over the cap IS rotated', shouldRotate(5000, 1000) === true);
check('a cap of 0 disables rotation', shouldRotate(5000, 0) === false);
check('a negative cap disables rotation', shouldRotate(5000, -1) === false);
check('a NaN size does not rotate', shouldRotate(Number.NaN, 1000) === false);
check('the default cap is 5 MB', DEFAULT_MAX_BYTES === 5 * 1024 * 1024, String(DEFAULT_MAX_BYTES));
check('the default retention is 30 days', DEFAULT_KEEP_DAYS === 30, String(DEFAULT_KEEP_DAYS));
check('the default rotation count is 3', DEFAULT_MAX_ROTATIONS === 3, String(DEFAULT_MAX_ROTATIONS));

section('The cap is never exceeded');
check('a line that fits is allowed', exceedsCap(100, 200, 1000) === false);
check('a line that would overflow is refused', exceedsCap(900, 200, 1000) === true);
check('a line that exactly fills the cap is allowed', exceedsCap(800, 200, 1000) === false);
check('an already-full file refuses any line', exceedsCap(1000, 1, 1000) === true);
check('an empty file allows a normal line', exceedsCap(0, 100, 1000) === false);
check('a cap of 0 never rotates', exceedsCap(500, 100, 0) === false);
check('a negative cap never rotates', exceedsCap(500, 100, -1) === false);
check('a NaN size is treated as 0', exceedsCap(Number.NaN, 100, 1000) === false);

section('Days between');
check('today to today is 0', daysBetween('2026-11-22', '2026-11-22') === 0);
check('yesterday is 1 day', daysBetween('2026-11-21', '2026-11-22') === 1);
check('a month back is 30 days', daysBetween('2026-10-23', '2026-11-22') === 30);
check('a future day is negative', daysBetween('2026-11-23', '2026-11-22') === -1);
check('a garbage day is 0', daysBetween('nope', '2026-11-22') === 0);

section('Retention');
const today = '2026-11-22';
const files = [
  'app-2026-11-22.log',      // today — live
  'app-2026-11-22.log.1',    // today — rotation 1
  'app-2026-11-22.log.2',    // today — rotation 2
  'app-2026-11-22.log.3',    // today — rotation 3
  'app-2026-11-22.log.4',    // today — rotation 4 (over the limit)
  'app-2026-11-21.log',      // yesterday
  'app-2026-10-01.log',      // old
  'app-2026-10-01.log.1',    // old, rotated
  'notes.txt',               // not ours
];
const plan = planLogRetention(files, today, 30, 3);
check('the old day is deleted', plan.delete.includes('app-2026-10-01.log'));
check('the old day\'s rotation is deleted too', plan.delete.includes('app-2026-10-01.log.1'));
check('today is kept', plan.keep.includes('app-2026-11-22.log'));
check('rotation 1 is kept', plan.keep.includes('app-2026-11-22.log.1'));
check('rotation 3 is kept', plan.keep.includes('app-2026-11-22.log.3'));
check('rotation 4 is deleted (over the cap)', plan.delete.includes('app-2026-11-22.log.4'));
check('yesterday is kept', plan.keep.includes('app-2026-11-21.log'));
check('a foreign file is never in the delete list', !plan.delete.includes('notes.txt'));
check('a foreign file is never in the keep list', !plan.keep.includes('notes.txt'));
check('every file is accounted for', plan.delete.length + plan.keep.length === files.length - 1,
  `${plan.delete.length}+${plan.keep.length} of ${files.length - 1}`);

section('Retention edge cases');
const future = planLogRetention(['app-2027-01-01.log'], today, 30, 3);
check('a future day is never deleted', future.delete.length === 0, JSON.stringify(future.delete));
check('a future day is kept', future.keep.includes('app-2027-01-01.log'));

const boundary = planLogRetention(['app-2026-10-23.log', 'app-2026-10-22.log'], today, 30, 3);
check('the day exactly keepDays old is kept', boundary.keep.includes('app-2026-10-23.log'), JSON.stringify(boundary));
check('the day one older is deleted', boundary.delete.includes('app-2026-10-22.log'), JSON.stringify(boundary));

const zeroKeep = planLogRetention(['app-2026-11-22.log', 'app-2026-11-21.log'], today, 0, 3);
check('keepDays=0 keeps only today', zeroKeep.keep.includes('app-2026-11-22.log'));
check('keepDays=0 deletes yesterday', zeroKeep.delete.includes('app-2026-11-21.log'));

const noRotations = planLogRetention(['app-2026-11-22.log', 'app-2026-11-22.log.1'], today, 30, 0);
check('maxRotations=0 keeps only the live file', noRotations.keep.includes('app-2026-11-22.log'));
check('maxRotations=0 deletes the rotation', noRotations.delete.includes('app-2026-11-22.log.1'));

const empty = planLogRetention([], today, 30, 3);
check('an empty folder plans nothing', empty.delete.length === 0 && empty.keep.length === 0);

section('Rotation slots');
check('the first free slot is 1', planRotation('2026-11-22', ['app-2026-11-22.log'])[0] === 'app-2026-11-22.log.1');
check('slot 2 is taken next', planRotation('2026-11-22', ['app-2026-11-22.log', 'app-2026-11-22.log.1'])[0] === 'app-2026-11-22.log.2');
check('a gap is filled first', planRotation('2026-11-22', ['app-2026-11-22.log', 'app-2026-11-22.log.2'])[0] === 'app-2026-11-22.log.1');
check('another day does not take a slot', planRotation('2026-11-22', ['app-2026-11-21.log.1'])[0] === 'app-2026-11-22.log.1');

console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILURES'}: ${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
