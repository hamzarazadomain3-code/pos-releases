import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { todayLocal, formatLocalString } from './utils/timezone';
import {
  DEFAULT_KEEP_DAYS,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_ROTATIONS,
  dailyLogName,
  exceedsCap,
  isAppLogFile,
  planLogRetention,
  planRotation,
  shouldRotate,
} from '../shared/logRotation';

let logFile: string | null = null;
/** The day the live file belongs to — a run past midnight rolls over. */
let currentDay: string | null = null;
/** Bytes already written to the live file (the size cap watches this). */
let currentBytes = 0;

interface LogLimits {
  maxBytes: number;
  keepDays: number;
  maxRotations: number;
}

/**
 * Read one setting. The Admin UI writes to `admin_settings`; the legacy
 * `settings` table is the fallback. The query is done here rather than through
 * a service import because the logger sits BELOW the services in the
 * dependency graph — pulling the admin service in would drag auth + activity
 * along and risk a cycle.
 */
function readSetting(key: string): string | null {
  try {
    const { getDb } = require('./db');
    const db = getDb();
    const admin = db.prepare('SELECT value FROM admin_settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    if (admin && admin.value !== undefined && admin.value !== null && admin.value !== '') {
      return String(admin.value);
    }
    const legacy = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    if (legacy && legacy.value !== undefined && legacy.value !== null) return String(legacy.value);
    return null;
  } catch {
    return null;
  }
}

/**
 * The rotation limits. The defaults are sensible for a shop; the owner can
 * tighten them with three admin settings. The settings read is defensive —
 * the logger is initialised before the database is necessarily open, and a
 * logger that throws on start-up is worse than a logger with defaults.
 */
function readLimits(): LogLimits {
  const limits: LogLimits = {
    maxBytes: DEFAULT_MAX_BYTES,
    keepDays: DEFAULT_KEEP_DAYS,
    maxRotations: DEFAULT_MAX_ROTATIONS,
  };
  const mb = Number(readSetting('log_max_size_mb'));
  if (Number.isFinite(mb) && mb > 0) limits.maxBytes = Math.floor(mb * 1024 * 1024);
  const days = Number(readSetting('log_keep_days'));
  if (Number.isFinite(days) && days >= 0) limits.keepDays = Math.floor(days);
  const rotations = Number(readSetting('log_max_rotations'));
  if (Number.isFinite(rotations) && rotations >= 0) limits.maxRotations = Math.floor(rotations);
  return limits;
}

function logsDir(): string {
  return path.join(app.getPath('userData'), 'logs');
}

/** Delete the log files the retention plan says are too old. */
function applyRetention(dir: string, today: string): void {
  const limits = readLimits();
  try {
    const names = fs.readdirSync(dir);
    const plan = planLogRetention(names, today, limits.keepDays, limits.maxRotations);
    for (const name of plan.delete) {
      // Only ever touch our own log files.
      if (!isAppLogFile(name)) continue;
      try {
        fs.unlinkSync(path.join(dir, name));
      } catch {
        /* best effort — a locked file stays until the next run */
      }
    }
  } catch {
    /* the folder may not exist yet */
  }
}

/**
 * Point the logger at the live file for `day`.
 *
 * The file is opened and closed for every line (appendFileSync) rather than
 * held open in a WriteStream: a long-lived handle makes the rotation rename
 * fail on Windows (the file cannot be moved while it is open), which is how
 * the cap silently stopped working after the first rotation.
 */
function openLogFile(dir: string, day: string): void {
  logFile = path.join(dir, dailyLogName(day));
  currentDay = day;
  try {
    currentBytes = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
  } catch {
    currentBytes = 0;
  }
}

/**
 * Rotate the live file: the current contents move to the next free slot
 * (`app-DAY.log.1`, `.2`, …) and a fresh live file is opened.
 */
function rotateLogFile(dir: string, day: string): void {
  const live = logFile ?? path.join(dir, dailyLogName(day));
  try {
    const existing = fs.readdirSync(dir).filter((f) => isAppLogFile(f));
    const [slot] = planRotation(day, existing);
    const target = path.join(dir, slot);
    try {
      if (fs.existsSync(target)) fs.unlinkSync(target);
    } catch {
      /* ignore */
    }
    fs.renameSync(live, target);
  } catch {
    // The rename can fail (a file locked by another program). Copy the
    // content over and truncate the live file instead — the cap still holds
    // and nothing is lost.
    try {
      const existing = fs.readdirSync(dir).filter((f) => isAppLogFile(f));
      const [slot] = planRotation(day, existing);
      fs.copyFileSync(live, path.join(dir, slot));
      fs.writeFileSync(live, '');
    } catch {
      /* best effort — if this fails too, keep appending */
    }
  }
  currentBytes = 0;
  openLogFile(dir, day);
}

export function initLogger(): void {
  const dir = logsDir();
  fs.mkdirSync(dir, { recursive: true });
  const day = todayLocal();
  openLogFile(dir, day);
  applyRetention(dir, day);
  log('=== Rokar POS starting ===');
}

/**
 * Write one line. Handles the size cap (rotate when the live file is full)
 * and the midnight rollover (a new day means a new file).
 */
function writeLine(line: string): void {
  try {
    const dir = logsDir();
    const day = todayLocal();
    if (currentDay !== day) {
      // The app ran past midnight — close the old file and start the new day.
      openLogFile(dir, day);
      applyRetention(dir, day);
    }
    const limits = readLimits();
    const text = line + '\n';
    const size = Buffer.byteLength(text, 'utf8');
    // Rotate BEFORE the write when the file is full, or when this line would
    // push it past the cap — the live file then never exceeds the cap.
    if (shouldRotate(currentBytes, limits.maxBytes) || exceedsCap(currentBytes, size, limits.maxBytes)) {
      rotateLogFile(dir, day);
    }
    fs.appendFileSync(logFile ?? path.join(dir, dailyLogName(day)), text, 'utf8');
    currentBytes += size;
  } catch {
    /* a log write must never take the app down */
  }
}

export function log(message: string): void {
  const line = `[${formatLocalString(new Date())}] ${message}`;
  try {
    console.log(line);
  } catch {
    /* ignore */
  }
  writeLine(line);
}

export function logError(context: string, err: unknown): void {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  const line = `[${formatLocalString(new Date())}] ERROR ${context}: ${msg}`;
  try {
    console.error(line);
  } catch {
    /* ignore */
  }
  writeLine(line);
}

export function getLogFilePath(): string {
  return logFile ?? '';
}

export function closeLogger(): void {
  // Nothing to close — every line opens and closes the file itself.
  currentBytes = 0;
}
