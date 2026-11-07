/**
 * Pure date parsing and formatting module.
 * No window/dom dependencies - can be used in tests and shared code.
 */

export type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';

function monthDays(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function parseParts(text: string): { year: number; month: number; day: number } | null {
  // Try ISO yyyy-mm-dd first
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) {
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    if (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(day)
        && year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1
        && day <= monthDays(month, year)) {
      return { year, month, day };
    }
    return null;
  }
  // Try dd/mm/yyyy or mm/dd/yyyy
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(text);
  if (m) {
    const year = parseInt(m[3], 10);
    const month = parseInt(m[2], 10);
    const day = parseInt(m[1], 10);
    if (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(day)
        && year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1
        && day <= monthDays(month, year)) {
      return { year, month, day };
    }
    return null;
  }
  return null;
}

/**
 * Parse a date string into ISO format (yyyy-mm-dd).
 * Supports: yyyy-mm-dd, dd/mm/yyyy, mm/dd/yyyy (depending on format).
 * Returns null for invalid dates (e.g., 31/02, 45/13, 29/02/2027).
 */
export function parseInputDate(text: string, dateFormat: DateFormat = 'DD/MM/YYYY'): string | null {
  const value = String(text ?? '').trim();
  if (!value) return null;

  // ISO yyyy-mm-dd: split strictly.
  const isoM = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (isoM) {
    const year = parseInt(isoM[1], 10);
    const month = parseInt(isoM[2], 10);
    const day = parseInt(isoM[3], 10);
    if (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(day)
        && year >= 1900 && year <= 9999 && month >= 1 && month <= 12 && day >= 1
        && day <= monthDays(month, year)) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // Slash/dot/dash separator: two 1-2 digit parts + 4-digit year.
  const sepM = /^(?:(\d{1,2})[\/.\-])?(\d{1,2})[\/.\-](\d{4})$/.exec(value);
  if (sepM) {
    const candidateMonth = dateFormat === 'MM/DD/YYYY' ? parseInt(sepM[1], 10) : parseInt(sepM[2], 10);
    const candidateDay = dateFormat === 'MM/DD/YYYY' ? parseInt(sepM[2], 10) : parseInt(sepM[1], 10);
    const candidateYear = parseInt(sepM[3], 10);
    if (!Number.isNaN(candidateMonth) && !Number.isNaN(candidateDay) && !Number.isNaN(candidateYear)
        && candidateYear >= 1900 && candidateYear <= 9999 && candidateMonth >= 1 && candidateMonth <= 12
        && candidateDay >= 1 && candidateDay <= monthDays(candidateMonth, candidateYear)) {
      return `${candidateYear}-${String(candidateMonth).padStart(2, '0')}-${String(candidateDay).padStart(2, '0')}`;
    }
  }

  // No generic Date fallback - reject unrecognized formats to avoid rollover.
  return null;
}

/**
 * Format an ISO date string (yyyy-mm-dd) for display using the configured format.
 * Returns empty string for falsy input.
 */
export function formatInputDate(iso: string | null | undefined, dateFormat: DateFormat = 'DD/MM/YYYY'): string {
  if (!iso || String(iso).trim() === '') return '';
  const text = String(iso).trim();
  const parts = parseParts(text);
  if (!parts) return text;
  const dd = String(parts.day).padStart(2, '0');
  const mm = String(parts.month).padStart(2, '0');
  const yyyy = parts.year;
  switch (dateFormat) {
    case 'MM/DD/YYYY': return `${mm}/${dd}/${yyyy}`;
    case 'YYYY-MM-DD': return `${yyyy}-${mm}-${dd}`;
    default: return `${dd}/${mm}/${yyyy}`;
  }
}

export { monthDays, isLeap };