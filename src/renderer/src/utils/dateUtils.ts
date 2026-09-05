/**
 * Robust timestamp parsing for display.
 * Handles malformed timestamps that may have:
 * - Missing 'Z' suffix (assumes UTC)
 * - Space instead of 'T' separator
 * - Already correct ISO format
 * - Various edge cases
 */

const PAKISTAN_TZ = 'Asia/Karachi';

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
  // Force Pakistan timezone for display
  return date.toLocaleString('Asia/Karachi', options);
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
  return date.toLocaleDateString('Asia/Karachi', options);
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
  return date.toLocaleTimeString('Asia/Karachi', options);
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
    return d.toLocaleTimeString('Asia/Karachi', { hour: '2-digit', minute: '2-digit', hour12: true });
  }
  return d.toLocaleTimeString('Asia/Karachi', { hour: '2-digit', minute: '2-digit', hour12: false });
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