const PAKISTAN_TZ = 'Asia/Karachi';

/** Get today as local YYYY-MM-DD string (Pakistan time). */
export function todayLocal(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: PAKISTAN_TZ }); // en-CA gives YYYY-MM-DD
}

/** Format a Date or ISO string for Pakistan timezone. */
export function formatLocalString(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('en-US', { timeZone: PAKISTAN_TZ });
}

/** Format a Date or ISO string as date only for Pakistan timezone. */
export function formatLocalDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-US', { timeZone: PAKISTAN_TZ });
}

/** Format a Date as YYYY-MM-DD in Pakistan timezone. */
export function formatDateYMD(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: PAKISTAN_TZ });
}

/** Get a date N days ago as YYYY-MM-DD in Pakistan timezone. */
export function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86400000);
  return d.toLocaleDateString('en-CA', { timeZone: PAKISTAN_TZ });
}

/** Get a date N days from now as YYYY-MM-DD in Pakistan timezone. */
export function daysFromNow(n: number): string {
  const d = new Date(Date.now() + n * 86400000);
  return d.toLocaleDateString('en-CA', { timeZone: PAKISTAN_TZ });
}
