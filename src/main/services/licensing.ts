import { BrowserWindow, ipcMain } from 'electron';
import { getAllSettings, setSetting } from './settings';

// Server URL is read at call time from the environment so it can be swapped without a rebuild
function serverUrl(): string {
  return process.env.SERVER_URL || 'https://license-server-2th8.onrender.com';
}

const GRACE_DAYS = 15;
const WARN_DAYS = 7;
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 h
const FETCH_TIMEOUT_MS = 5000; // 5 s — never let a network call block startup

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  return fetch(url, { ...init, signal: ac.signal }).finally(() => clearTimeout(timer));
}

/** Activate a license key (online validation) */
export async function activateLicense(key: string): Promise<void> {
  const shop = getAllSettings().shop_name || '';
  const payload = { key, shop };
  const res = await fetchWithTimeout(`${serverUrl()}/api/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { ok: boolean; expires?: string; msg?: string };
  if (!data.ok) throw new Error(data.msg ?? 'Invalid license');
  const now = Date.now();
  setSetting('license_key', key);
  setSetting('license_expires', data.expires ?? '');
  setSetting('license_last_check', now.toString());
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
  const lastCheck = Number(settings.license_last_check ?? 0);
  const expiresStr = settings.license_expires as string | undefined;
  const expires = expiresStr ? new Date(expiresStr).getTime() : 0;

  // If we haven't checked in a while, try online validation
  if (nowMs - lastCheck > CHECK_INTERVAL_MS) {
    try {
      const shop = settings.shop_name || '';
      const payload = { key, shop };
      const res = await fetchWithTimeout(`${serverUrl()}/api/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok: boolean; expires?: string; msg?: string };
      if (data.ok) {
        setSetting('license_last_check', nowMs.toString());
        if (data.expires) setSetting('license_expires', data.expires);
      } else {
        throw new Error(data.msg ?? 'License validation failed');
      }
    } catch (e) {
      // Network error – fallback to offline handling
    }
  }

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
