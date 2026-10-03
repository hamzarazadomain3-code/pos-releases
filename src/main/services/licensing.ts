import { BrowserWindow, ipcMain } from 'electron';
import { getAllSettings, setSetting } from './settings';
import { getDeviceId } from './recovery';

// Server URL is read at call time from the environment so it can be swapped without a rebuild
function serverUrl(): string {
  return process.env.SERVER_URL || 'https://license-server-2th8.onrender.com';
}

const GRACE_DAYS = 15;
const WARN_DAYS = 7;
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 h
const FETCH_TIMEOUT_MS = 5000; // 5 s — never let a network call block startup

/**
 * A perpetual licence is the product: bought once, never renewed. The server says
 * so on every validate response (`lifetime: true`) and we cache it locally, because
 * the app has to keep working for 12 hours without asking again — and it has to
 * keep working with no network at all.
 */
function isLifetime(settings: ReturnType<typeof getAllSettings>): boolean {
  return settings.license_lifetime === '1' || settings.license_lifetime === 'true';
}

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  return fetch(url, { ...init, signal: ac.signal }).finally(() => clearTimeout(timer));
}

/** Activate a license key (online validation) */
export async function activateLicense(key: string): Promise<void> {
  const shop = getAllSettings().shop_name || '';
  // device_id was never sent before, which is why the server's max_devices check
  // never ran and a single key validated from unlimited machines. Now that licences
  // no longer expire, this is the only thing tying a licence to a shop's hardware.
  const payload = { key, shop, device_id: getDeviceId() };
  const res = await fetchWithTimeout(`${serverUrl()}/api/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { ok: boolean; expires?: string | null; lifetime?: boolean; msg?: string };
  if (!data.ok) throw new Error(data.msg ?? 'Invalid license');
  const now = Date.now();
  setSetting('license_key', key);
  // A perpetual licence stores an empty expiry: there is no date to count down.
  setSetting('license_expires', data.expires ?? '');
  setSetting('license_lifetime', data.lifetime ? '1' : '0');
  setSetting('license_last_check', now.toString());
  // A fresh activation clears any previous revocation.
  setSetting('license_revoked', '0');
}

/** Internal helper to send a warning to the renderer (if a window exists). */
function sendWarning(daysLeft: number): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.send('licensing:expiry-warning', daysLeft);
  console.log('LICENSE_WARNING=' + daysLeft);
}

/** Perform an online check (if possible) and enforce grace/expiry rules */
export async function checkLicense(): Promise<void> {
  const settings = getAllSettings();
  const key = settings.license_key as string | undefined;
  if (!key) throw new Error('No license key set');
  const nowMs = Date.now();

  // If we haven't checked in a while, try online validation
  if (nowMs - Number(settings.license_last_check ?? 0) > CHECK_INTERVAL_MS) {
    // A rejection from the server must NOT be swallowed by the network-error
    // handler. It used to be: the `throw` sat inside the try block whose catch
    // said "network error", so a revoked or expired licence was silently ignored
    // and the shop carried on billing. With a perpetual licence, revocation is the
    // only way to switch a customer off, so losing that signal makes the whole
    // model unenforceable.
    let rejection: string | null = null;
    try {
      const payload = { key, shop: settings.shop_name || '', device_id: getDeviceId() };
      const res = await fetchWithTimeout(`${serverUrl()}/api/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok: boolean; expires?: string | null; lifetime?: boolean; msg?: string };
      if (data.ok) {
        setSetting('license_last_check', nowMs.toString());
        setSetting('license_lifetime', data.lifetime ? '1' : '0');
        // Only overwrite the expiry for a dated licence; a perpetual one stores an
        // empty string on purpose and must not have it filled in again.
        if (!data.lifetime) setSetting('license_expires', data.expires ?? '');
      } else {
        rejection = data.msg ?? 'License validation failed';
        // Remember a revocation locally. Without this, a perpetual licence can
        // never actually be switched off: checkLicense() only runs once at startup
        // and merely logs its error, and ensureLicenseValidSync() returns early for
        // a lifetime key. Recording it here is what makes the per-sale check able to
        // stop the shop.
        if (/revoked/i.test(data.msg ?? '')) setSetting('license_revoked', '1');
      }
    } catch {
      // Network error only — stay on the locally cached state.
    }
    if (rejection) throw new Error(rejection);
  }

  // Re-read: the online check may have just changed license_lifetime.
  const fresh = getAllSettings();
  if (isLifetime(fresh)) return;

  const expiresStr = fresh.license_expires as string | undefined;
  const expires = expiresStr ? new Date(expiresStr).getTime() : 0;
  if (expires) {
    const daysLeft = Math.ceil((expires - nowMs) / (1000 * 60 * 60 * 24));
    if (daysLeft <= WARN_DAYS) sendWarning(daysLeft);
    if (daysLeft < 0) {
      const graceEnd = expires + GRACE_DAYS * 24 * 60 * 60 * 1000;
      if (nowMs > graceEnd) {
        throw new Error('License expired – grace period over');
      }
    }
  }
}

/** Register IPC handlers for the renderer */
export function ensureLicenseValidSync(): void {
  const settings = getAllSettings();
  // A licence the server has revoked stops billing immediately, and is checked
  // before the lifetime shortcut below.
  if (settings.license_revoked === '1') {
    throw new Error('This licence has been revoked. Please contact support.');
  }
  // Called on every sale (sales.ts), so this is the hot path. A perpetual licence
  // returns immediately: there is no date to evaluate and no reason to make the
  // shop's cashier wait on a date comparison.
  if (isLifetime(settings)) return;
  const expiresStr = settings.license_expires as string | undefined;
  if (!expiresStr) return; // no expiry set, assume OK
  const expires = new Date(expiresStr).getTime();
  const nowMs = Date.now();
  const daysLeft = Math.ceil((expires - nowMs) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) {
    const graceEnd = expires + GRACE_DAYS * 24 * 60 * 60 * 1000;
    if (nowMs > graceEnd) {
      throw new Error('License expired – grace period over');
    }
  }
}

export function registerIpc(): void {
  ipcMain.handle('licensing:activate', async (_event, key: string) => {
    await activateLicense(key);
    return 'License activated';
  });
  ipcMain.handle('licensing:check', async () => {
    await checkLicense();
    return 'License OK';
  });
}
