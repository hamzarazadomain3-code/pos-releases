/**
 * Robust timestamp parsing for display.
 * Handles malformed timestamps that may have:
 * - Missing 'Z' suffix (assumes UTC)
 * - Space instead of 'T' separator
 * - Already correct ISO format
 * - Various edge cases
 */

const PAKISTAN_TZ = 'Asia/Karachi';

/** Convert Date to local YYYY-MM-DD string (avoids UTC offset issues of toISOString). */
export function toLocalDateString(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Parse a timestamp string that may be malformed.
 * Returns a Date object (in local time) or null if unparseable.
 */
export function parseTimestamp(ts: string | null | undefined): Date | null {
  if (!ts) return null;
  
  let fixed = ts.trim();
  if (!fixed) return null;
  
  try {
    // First try parsing as-is
    const direct = new Date(fixed);
    if (!isNaN(direct.getTime())) {
      // Check if it's already a valid ISO with Z or offset
      if (fixed.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(fixed)) {
        return direct;
      }
    }
    
    // Handle space separator instead of 'T'
    if (fixed.includes(' ') && !fixed.includes('T')) {
      fixed = fixed.replace(' ', 'T');
    }
    
    // Ensure UTC suffix if missing (no Z, no +HH:MM, no -HH:MM after time part)
    const hasOffset = /([+-]\d{2}:?\d{2})$/.test(fixed) || fixed.endsWith('Z');
    const looksLikeISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(fixed);
    
    if (!hasOffset && looksLikeISO) {
      fixed += 'Z';
    } else if (!hasOffset && fixed.includes('T')) {
      // Has T but no offset - assume UTC
      fixed += 'Z';
    }
    
    const parsed = new Date(fixed);
    return isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
}

/**
 * Format timestamp for display with Pakistan timezone (UTC+5).
 * Returns formatted string or '—' if unparseable.
 */
export function formatTimestamp(
  ts: string | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  const date = parseTimestamp(ts);
  if (!date) return '—';
  return date.toLocaleString(undefined, { timeZone: PAKISTAN_TZ, ...options });
}

/**
 * Format timestamp as date only (Pakistan timezone).
 */
export function formatDateOnly(
  ts: string | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  const date = parseTimestamp(ts);
  if (!date) return '—';
  return date.toLocaleDateString(undefined, { timeZone: PAKISTAN_TZ, ...options });
}

/**
 * Format timestamp as time only (Pakistan timezone).
 */
export function formatTimeOnly(
  ts: string | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  const date = parseTimestamp(ts);
  if (!date) return '—';
  return date.toLocaleTimeString(undefined, { timeZone: PAKISTAN_TZ, ...options });
}

// ── Sync formatting functions that respect admin-configured formats ──

type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
type TimeFormat = '12h' | '24h';

/** Cached format settings (populated by initDateUtils). */
let _dateFormat: DateFormat = 'DD/MM/YYYY';
let _timeFormat: TimeFormat = '24h';
let _initialized = false;

/**
 * Initialize date format settings from admin config.
 * Call once on app startup (or when settings change).
 */
export async function initDateUtils(): Promise<void> {
  try {
    const [df, tf] = await Promise.all([
      window.api.admin.settings.get('date_format'),
      window.api.admin.settings.get('time_format'),
    ]);
    _dateFormat = (df as DateFormat) || 'DD/MM/YYYY';
    _timeFormat = (tf as TimeFormat) || '24h';
  } catch {
    _dateFormat = 'DD/MM/YYYY';
    _timeFormat = '24h';
  }
  _initialized = true;
}

/** Force re-read of format settings (call when admin settings change). */
export function resetDateUtils(): void {
  _initialized = false;
}

function formatDateSync(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  switch (_dateFormat) {
    case 'MM/DD/YYYY': return `${mm}/${dd}/${yyyy}`;
    case 'YYYY-MM-DD': return `${yyyy}-${mm}-${dd}`;
    default: return `${dd}/${mm}/${yyyy}`;
  }
}

function formatTimeSync(d: Date): string {
  if (_timeFormat === '12h') {
    return d.toLocaleTimeString(undefined, { timeZone: PAKISTAN_TZ, hour: '2-digit', minute: '2-digit', hour12: true });
  }
  return d.toLocaleTimeString(undefined, { timeZone: PAKISTAN_TZ, hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Format a timestamp using admin-configured date + time formats.
 * Returns formatted string or '—' if unparseable.
 */
export function formatDateTimeAdmin(ts: string | null | undefined): string {
  if (!_initialized) {
    // Fallback: use default toLocaleString with Pakistan timezone
    return formatTimestamp(ts);
  }
  const date = parseTimestamp(ts);
  if (!date) return '—';
  return `${formatDateSync(date)} ${formatTimeSync(date)}`;
}

/**
 * Format a timestamp as date-only using admin-configured date format.
 * Returns formatted string or '—' if unparseable.
 */
export function formatDateAdmin(ts: string | null | undefined): string {
  if (!_initialized) {
    return formatDateOnly(ts);
  }
  const date = parseTimestamp(ts);
  if (!date) return '—';
  return formatDateSync(date);
}

/**
 * Format a timestamp as time-only using admin-configured time format.
 * Returns formatted string or '—' if unparseable.
 */
export function formatTimeAdmin(ts: string | null | undefined): string {
  if (!_initialized) {
    return formatTimeOnly(ts);
  }
  const date = parseTimestamp(ts);
  if (!date) return '—';
  return formatTimeSync(date);
}
export function formatInputDate(iso: any): string {
  if (!iso || String(iso).trim() === '') return '';
  const text = String(iso).trim();
  const parts = parseParts(text);
  if (!parts) return text;
  const dd = String(parts.day).padStart(2, '0');
  const mm = String(parts.month).padStart(2, '0');
  const yyyy = parts.year;
  switch (_dateFormat) {
    case 'MM/DD/YYYY': return `${mm}/${dd}/${yyyy}`;
    case 'YYYY-MM-DD': return `${yyyy}-${mm}-${dd}`;
    default: return `${dd}/${mm}/${yyyy}`;
  }
}

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

export function parseInputDate(text: any): string | null {
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
    const candidateMonth = _dateFormat === 'MM/DD/YYYY' ? parseInt(sepM[1], 10) : parseInt(sepM[2], 10);
    const candidateDay = _dateFormat === 'MM/DD/YYYY' ? parseInt(sepM[2], 10) : parseInt(sepM[1], 10);
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
