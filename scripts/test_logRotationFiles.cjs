#!/usr/bin/env node
/**
 * Log rotation / size cap — FILE suite (the real I/O).
 *
 * The pure suite (`npm run test:logRotation`) pins the RULES; this one drives
 * the REAL logger against a throwaway userData folder and proves:
 *
 *   - the live file is capped: writing past the cap rotates it
 *   - the rotated file keeps the old content and the live file starts fresh
 *   - a log file older than the retention window is deleted
 *   - a file that is NOT one of ours is never touched
 *
 * Usage (after `npm run build:main`):
 *   npx electron scripts/test_logRotationFiles.cjs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const PROJECT_ROOT = path.resolve(__dirname, '..');
app.getAppPath = () => PROJECT_ROOT;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rokar-log-rotation-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'log-rotation.db');
app.setPath('userData', path.join(tmpDir, 'userdata'));

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const { initDatabase } = require('../dist/main/db.js');
  const auth = require('../dist/main/services/auth.js');
  const admin = require('../dist/main/services/admin.js');
  const logger = require('../dist/main/logger.js');

  await initDatabase();

  // The Admin UI writes to `admin_settings`, so that is the table the logger
  // must read. setAdminSetting is owner-gated — sign in as the owner first.
  auth.setSessionUser(1);

  // A tiny cap so the rotation happens in the test, and a zero-day retention
  // so anything but today is considered old.
  admin.setAdminSetting('log_max_size_mb', '0.002');   // ~2 KB
  admin.setAdminSetting('log_keep_days', '0');
  admin.setAdminSetting('log_max_rotations', '3');

  const logsDir = path.join(app.getPath('userData'), 'logs');

  console.log('=== Rokar POS - Log rotation (files) ===');

  // ── The first line lands in today's file ────────────────────────────────
  section('The logger opens today\'s file');
  logger.initLogger();
  await sleep(150);
  const live = logger.getLogFilePath();
  check('the log file lives in <userData>/logs', live.startsWith(logsDir), live);
  check('the file is named for today', /app-\d{4}-\d{2}-\d{2}\.log$/.test(live), path.basename(live));
  check('the file exists', fs.existsSync(live));
  check('the start banner is in it', fs.readFileSync(live, 'utf8').includes('Rokar POS starting'));

  // ── Writing past the cap rotates the file ───────────────────────────────
  section('Writing past the size cap rotates the file');
  const filler = 'x'.repeat(200);
  for (let i = 0; i < 40; i++) logger.log(`filler line ${i} ${filler}`);
  await sleep(400);

  const rotated = live + '.1';
  check('a rotated file now exists', fs.existsSync(rotated), path.basename(rotated));
  const liveSize = fs.existsSync(live) ? fs.statSync(live).size : 0;
  const rotatedSize = fs.existsSync(rotated) ? fs.statSync(rotated).size : 0;
  check('the live file is back under the cap', liveSize < 2097, `${liveSize} bytes`);
  check('the rotated file holds the overflow', rotatedSize > 0, `${rotatedSize} bytes`);
  const rotatedText = fs.existsSync(rotated) ? fs.readFileSync(rotated, 'utf8') : '';
  check('the rotated file kept the earlier lines', rotatedText.includes('Rokar POS starting'));
  check('the live file carries the newest line', fs.readFileSync(live, 'utf8').includes('filler line 39'));

  // ── Retention deletes the old files, and only ours ──────────────────────
  section('Retention deletes old log files — and nothing else');
  const oldFile = path.join(logsDir, 'app-2020-01-01.log');
  const oldRotated = path.join(logsDir, 'app-2020-01-01.log.1');
  const foreign = path.join(logsDir, 'notes.txt');
  fs.writeFileSync(oldFile, 'an old log');
  fs.writeFileSync(oldRotated, 'an old rotated log');
  fs.writeFileSync(foreign, 'not ours');

  logger.closeLogger();
  logger.initLogger();   // init runs the retention pass
  await sleep(250);

  check('the old day\'s log is deleted', !fs.existsSync(oldFile));
  check('the old day\'s rotated log is deleted too', !fs.existsSync(oldRotated));
  check('a file that is not ours is untouched', fs.existsSync(foreign));
  check('today\'s live file survives', fs.existsSync(live));

  // ── The retention WINDOW comes from the setting, not the 30-day default ──
  section('The retention window comes from the settings');
  admin.setAdminSetting('log_keep_days', '365');
  const recent = path.join(logsDir, 'app-2026-01-01.log');   // ~325 days old
  const ancient = path.join(logsDir, 'app-2024-01-01.log');  // ~1000 days old
  fs.writeFileSync(recent, 'within a 365-day window');
  fs.writeFileSync(ancient, 'older than a 365-day window');
  logger.closeLogger();
  logger.initLogger();
  await sleep(250);
  check('a file inside the 365-day window survives', fs.existsSync(recent));
  check('a file outside the 365-day window is deleted', !fs.existsSync(ancient));
  admin.setAdminSetting('log_keep_days', '0');

  // ── A second rotation takes the next slot ───────────────────────────────
  section('A second rotation takes the next free slot');
  const before = fs.readdirSync(logsDir).filter((f) => f.startsWith(path.basename(live))).sort();
  for (let i = 0; i < 40; i++) logger.log(`second wave ${i} ${filler}`);
  await sleep(400);
  const after = fs.readdirSync(logsDir).filter((f) => f.startsWith(path.basename(live))).sort();
  check('a second rotated file exists', fs.existsSync(live + '.2'), JSON.stringify(after));
  check('the first rotated file still exists', fs.existsSync(live + '.1'), JSON.stringify(after));
  check('more files appeared than before', after.length > before.length, `${before.length} -> ${after.length}`);

  // ── The cap setting is honoured, not a hard-coded 5 MB ──────────────────
  section('The cap comes from the settings');
  admin.setAdminSetting('log_max_size_mb', '0.001');   // ~1 KB — tighter
  logger.closeLogger();
  logger.initLogger();
  await sleep(150);
  for (let i = 0; i < 40; i++) logger.log(`tight ${i} ${filler}`);
  await sleep(400);
  const tightLive = logger.getLogFilePath();
  const tightSize = fs.existsSync(tightLive) ? fs.statSync(tightLive).size : 0;
  check('the tighter cap is respected', tightSize < 1048, `${tightSize} bytes`);

  logger.closeLogger();

  console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILURES'}: ${checks - failures}/${checks} checks passed`);

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  app.exit(failures === 0 ? 0 : 1);
}

app.whenReady().then(run).catch((e) => {
  console.error('test_logRotationFiles crashed:', e);
  app.exit(1);
});

setTimeout(() => {
  console.error('WATCHDOG: the log-rotation suite did not finish in 120s');
  app.exit(2);
}, 120000);
