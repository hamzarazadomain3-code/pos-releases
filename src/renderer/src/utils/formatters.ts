import { formatDateAdmin, formatTimeAdmin, formatDateTimeAdmin } from './dateUtils';

type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
type TimeFormat = '12h' | '24h';

let cachedDate: DateFormat | null = null;
let cachedTime: TimeFormat | null = null;

async function loadFormats(): Promise<void> {
  if (cachedDate !== null && cachedTime !== null) return;
  try {
    const dateVal = await window.api.admin.settings.get('date_format');
    const timeVal = await window.api.admin.settings.get('time_format');
    cachedDate = (dateVal as DateFormat) || 'DD/MM/YYYY';
    cachedTime = (timeVal as TimeFormat) || '24h';
  } catch {
    cachedDate = 'DD/MM/YYYY';
    cachedTime = '24h';
  }
}

export async function formatDate(input: string | Date | null | undefined): Promise<string> {
  if (!input) return '';
  await loadFormats();
  const d = typeof input === 'string' ? new Date(input) : input;
  if (isNaN(d.getTime())) return String(input);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  switch (cachedDate) {
    case 'MM/DD/YYYY': return `${mm}/${dd}/${yyyy}`;
    case 'YYYY-MM-DD': return `${yyyy}-${mm}-${dd}`;
    default: return `${dd}/${mm}/${yyyy}`;
  }
}

export async function formatTime(input: string | Date | null | undefined): Promise<string> {
  if (!input) return '';
  await loadFormats();
  const d = typeof input === 'string' ? new Date(input) : input;
  if (isNaN(d.getTime())) return String(input);
  if (cachedTime === '12h') {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  }
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export async function formatDateTime(input: string | Date | null | undefined): Promise<string> {
  if (!input) return '';
  const [dateStr, timeStr] = await Promise.all([formatDate(input), formatTime(input)]);
  return dateStr && timeStr ? `${dateStr} ${timeStr}` : dateStr || timeStr;
}

let cachedCurrency: string | null = null;
let cachedDecimalPlaces: number | null = null;

async function loadCurrency(): Promise<void> {
  if (cachedCurrency !== null) return;
  try {
    cachedCurrency = (await window.api.admin.settings.get('currency_symbol')) || 'Rs';
    const dp = await window.api.admin.settings.get('decimal_places');
    cachedDecimalPlaces = dp ? parseInt(dp, 10) : 2;
    if (isNaN(cachedDecimalPlaces)) cachedDecimalPlaces = 2;
  } catch {
    cachedCurrency = 'Rs';
    cachedDecimalPlaces = 2;
  }
}

export async function formatCurrency(amount: number): Promise<string> {
  await loadCurrency();
  return `${cachedCurrency} ${amount.toLocaleString(undefined, {
    minimumFractionDigits: cachedDecimalPlaces!,
    maximumFractionDigits: cachedDecimalPlaces!,
  })}`;
}

export function resetFormatCache(): void {
  cachedDate = null;
  cachedTime = null;
  cachedCurrency = null;
  cachedDecimalPlaces = null;
}
