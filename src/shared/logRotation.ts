/**
 * Log rotation / size cap — the PURE rules.
 *
 * The app writes one log file per day (`app-YYYY-MM-DD.log`) into
 * `<userData>/logs`. Without a cap a noisy day can grow without bound, and
 * without a retention pass the folder grows forever — a shop that never
 * clears it ends up with gigabytes of old logs.
 *
 * These functions decide WHAT should happen; the main process does the I/O.
 * Keeping the rules pure is what makes them testable without Electron.
 */

/** How many days of logs to keep by default. */
export const DEFAULT_KEEP_DAYS = 30;
/** The size at which the live daily file is rotated by default (5 MB). */
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
/** How many rotated files are kept per day by default. */
export const DEFAULT_MAX_ROTATIONS = 3;

/** The log file name for a day (YYYY-MM-DD). */
export function dailyLogName(day: string): string {
  return `app-${day}.log`;
}

/**
 * The name of the Nth rotated file for a day.
 * Index 1 is the most recent rotation, 2 the one before it.
 */
export function rotatedLogName(day: string, index: number): string {
  return `${dailyLogName(day)}.${index}`;
}

/**
 * The day (YYYY-MM-DD) a log file name belongs to, or null when the name is
 * not one of ours. A foreign file in the logs folder is never touched.
 */
export function logFileDay(fileName: string): string | null {
  const m = /^app-(\d{4}-\d{2}-\d{2})\.log(?:\.(\d+))?$/.exec(fileName);
  return m ? m[1] : null;
}

/** Is this file one of the app's own log files? */
export function isAppLogFile(fileName: string): boolean {
  return logFileDay(fileName) !== null;
}

/** The rotation index of a file name (0 = the live daily file). */
export function logFileIndex(fileName: string): number {
  const m = /\.(\d+)$/.exec(fileName);
  return m && m[1] ? Number(m[1]) : 0;
}

/** Should the live file be rotated before more is written to it? */
export function shouldRotate(sizeBytes: number, maxBytes: number): boolean {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return false;
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return false;
  return sizeBytes >= maxBytes;
}

/**
 * Would writing `incomingBytes` more push the live file past the cap?
 *
 * This is the check the logger uses: rotating BEFORE the write (rather than
 * after) is what keeps the file from ever growing past the cap.
 */
export function exceedsCap(
  currentBytes: number,
  incomingBytes: number,
  maxBytes: number
): boolean {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return false;
  const cur = Number.isFinite(currentBytes) && currentBytes > 0 ? currentBytes : 0;
  const inc = Number.isFinite(incomingBytes) && incomingBytes > 0 ? incomingBytes : 0;
  return cur + inc > maxBytes;
}

/** Whole days from `day` to `today` (today - day). */
export function daysBetween(day: string, today: string): number {
  const a = Date.parse(`${day}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/**
 * Which log files to delete, and which to keep.
 *
 *  - a day older than `keepDays` is deleted (its rotated files included)
 *  - for a kept day only the newest `maxRotations` rotated files survive
 *  - a day in the FUTURE is never deleted (the clock may have moved back)
 *  - a file that is not one of ours is never touched
 */
export function planLogRetention(
  files: string[],
  today: string,
  keepDays: number = DEFAULT_KEEP_DAYS,
  maxRotations: number = DEFAULT_MAX_ROTATIONS
): { delete: string[]; keep: string[] } {
  const toDelete: string[] = [];
  const toKeep: string[] = [];

  // Group our own files by day.
  const days = new Map<string, string[]>();
  for (const f of files) {
    const day = logFileDay(f);
    if (!day) continue;
    const list = days.get(day) ?? [];
    list.push(f);
    days.set(day, list);
  }

  for (const [day, dayFiles] of days) {
    const age = daysBetween(day, today);
    if (age > keepDays) {
      // Too old — the whole day goes, rotated files included.
      toDelete.push(...dayFiles);
      continue;
    }
    for (const f of dayFiles) {
      // Index 0 is the live file; it always survives. Anything above
      // maxRotations is a stale extra rotation.
      if (logFileIndex(f) <= maxRotations) toKeep.push(f);
      else toDelete.push(f);
    }
  }

  return { delete: toDelete, keep: toKeep };
}

/**
 * The rotation plan for a day: which existing rotated file each new index
 * takes over from. Index 1 is the most recent, so the old `.1` shifts to `.2`.
 *
 * Returns the new file names to write, from the oldest slot to the newest.
 */
export function planRotation(day: string, existingFiles: string[]): string[] {
  const taken = new Set<number>();
  for (const f of existingFiles) {
    if (logFileDay(f) !== day) continue;
    const idx = logFileIndex(f);
    if (idx > 0) taken.add(idx);
  }
  // Find the first free slot at or above 1 (the live file is always slot 0).
  let slot = 1;
  while (taken.has(slot)) slot++;
  return [rotatedLogName(day, slot)];
}
