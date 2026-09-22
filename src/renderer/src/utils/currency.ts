let cachedSymbol = 'Rs';
let cachedPlaces = 2;

let initPromise: Promise<void> | null = null;

async function load(): Promise<void> {
  try {
    const sym = await window.api.admin.settings.get('currency_symbol');
    if (sym) cachedSymbol = String(sym);
    const dp = await window.api.admin.settings.get('decimal_places');
    const parsed = parseInt(String(dp ?? ''), 10);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 4) cachedPlaces = parsed;
  } catch {
    /* keep defaults */
  }
}

export function getCurrencySymbol(): string {
  return cachedSymbol;
}

export function initCurrency(): Promise<void> {
  if (!initPromise) initPromise = load();
  return initPromise;
}

export function formatMoney(amount: number): string {
  return `${cachedSymbol} ${amount.toLocaleString(undefined, {
    minimumFractionDigits: cachedPlaces,
    maximumFractionDigits: cachedPlaces,
  })}`;
}

export function resetCurrencyCache(): void {
  cachedSymbol = 'Rs';
  cachedPlaces = 2;
}