/**
 * The calendar grid — PURE date maths for the date picker.
 *
 * No window / DOM dependencies, so the renderer can draw the popup from it and
 * the test suite can assert it without a browser. Everything here works in
 * LOCAL time (the shop's clock), never in UTC: `new Date(y, m, d)` is local by
 * definition, which is what keeps "today" right for a shop in Karachi when the
 * machine is set to UTC+5.
 *
 * The rules the picker relies on:
 *   - the week starts on SUNDAY (the shop's printed calendars do),
 *   - the grid is ALWAYS 6 weeks tall, so the popup never changes its height
 *     while the owner moves from one month to the next,
 *   - a day is addressed by its ISO date (`yyyy-mm-dd`), the same string the
 *     app stores and the same string `parseInputDate()` accepts — the picker
 *     and the typed text can therefore never disagree about a date.
 */

export interface CalendarDay {
  /** The ISO date of the cell — `yyyy-mm-dd`. */
  iso: string;
  /** The day of the month — 1..31. */
  day: number;
  /** False for the leading / trailing days of the neighbouring months. */
  inMonth: boolean;
}

export interface MonthView {
  year: number;
  /** 1..12 */
  month: number;
}

export const DEFAULT_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const DEFAULT_MONTH_NAMES_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Sunday first. */
export const DEFAULT_WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `yyyy-mm-dd` from a year, a 1-based month and a day. */
export function toIso(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** How many days the month has (the leap years included). */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** The weekday of the 1st of the month — 0 = Sunday. */
export function firstWeekday(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

/**
 * The 6x7 grid of a month. The first cell is the Sunday on or before the 1st
 * and the last cell is the Saturday on or after the last day, so every month
 * is drawn in the same 42 cells.
 */
export function monthMatrix(year: number, month: number): CalendarDay[][] {
  const lead = firstWeekday(year, month);
  const start = new Date(year, month - 1, 1 - lead);
  const weeks: CalendarDay[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: CalendarDay[] = [];
    for (let d = 0; d < 7; d++) {
      const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      row.push({
        iso: toIso(cur.getFullYear(), cur.getMonth() + 1, cur.getDate()),
        day: cur.getDate(),
        inMonth: cur.getMonth() + 1 === month && cur.getFullYear() === year,
      });
    }
    weeks.push(row);
  }
  return weeks;
}

/** The month before / after — the month is always returned in 1..12. */
export function shiftMonth(year: number, month: number, delta: number): MonthView {
  const zero = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zero / 12), month: (((zero % 12) + 12) % 12) + 1 };
}

/** The view of the month a date belongs to. */
export function monthViewOf(iso: string): MonthView | null {
  const parts = isoParts(iso);
  if (!parts) return null;
  return { year: parts.year, month: parts.month };
}

/** The split of an ISO date — null when the string is not a real date. */
export function isoParts(iso: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function isValidIso(iso: string): boolean {
  return isoParts(iso) !== null;
}

/** The ISO date of `now` (or of the machine's today). */
export function todayIso(now?: Date): string {
  const d = now || new Date();
  return toIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** A day shifted by `delta` days — the keyboard's arrow keys use it. */
export function addDays(iso: string, delta: number): string {
  const parts = isoParts(iso);
  if (!parts) return todayIso();
  const d = new Date(parts.year, parts.month - 1, parts.day + delta);
  return toIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** The month label — "November 2026". */
export function monthLabel(year: number, month: number, monthNames?: string[]): string {
  const names = monthNames && monthNames.length === 12 ? monthNames : DEFAULT_MONTH_NAMES;
  const name = names[month - 1] || DEFAULT_MONTH_NAMES[month - 1];
  return `${name} ${year}`;
}
