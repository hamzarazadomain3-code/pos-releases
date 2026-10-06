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
 * Length of the free trial, in days.
 *
 * The website promises this number, so the two are cross-checked: the site's
 * `verify:industries` guard reads this file and fails the build if the promise and
 * the constant disagree. Change one, change the other in the same commit.
 *
 * Note this is a DIFFERENT 15 from GRACE_DAYS below. They are unrelated: GRACE_DAYS
 * forgives a *paid* licence that has lapsed, this one is how long a shop may use
 * the product before paying. A trial gets NO grace period at all, because nobody
 * paid and there is nothing to forgive -- otherwise "15-day trial" would quietly
 * mean 30 days of free use.
 */
const TRIAL_DAYS = 15;
const DAY_MS = 24 * 60 * 60 * 1000;

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

function isTrial(settings: ReturnType<typeof getAllSettings>): boolean {
  return settings.license_trial === '1' || settings.license_trial === 'true';
}

/** When the trial runs out. Local estimate until the server has confirmed it. */
function trialExpiry(settings: ReturnType<typeof getAllSettings>): number {
  const confirmed = settings.license_trial_expires as string | undefined;
  if (confirmed) return new Date(confirmed).getTime();
  const started = settings.license_trial_started as string | undefined;
  if (!started) return 0;
  return new Date(started).getTime() + TRIAL_DAYS * DAY_MS;
}

export function trialDaysLeft(): number {
  const settings = getAllSettings();
  if (!isTrial(settings)) return 0;
  const expiry = trialExpiry(settings);
  if (!expiry) return 0;
  return Math.max(0, Math.ceil((expiry - Date.now()) / DAY_MS));
}

/**
 * Start a trial with no server contact, so an offline install is never locked out.
 *
 * Written FIRST, before the network is attempted, on purpose: a shop that installs
 * on a machine with no internet must still be able to use the product for 15 days.
 * The server-issued key then replaces this local guess as soon as one is reachable,
 * and the local estimate is only ever shortened by that, never lengthened.
 */
function startLocalTrial(): void {
  const settings = getAllSettings();
  if (isTrial(settings)) return;
  const started = new Date().toISOString();
  setSetting('license_trial', '1');
  setSetting('license_trial_started', started);
  setSetting('license_trial_expires', new Date(Date.now() + TRIAL_DAYS * DAY_MS).toISOString());
  // '1' = not yet anchored to the server. Cleared once /api/trial answers.
  setSetting('license_trial_offline', '1');
  // Deliberately NOT logActivity(): that writes to the activity_log table, which
  // makes starting a trial depend on that table existing. The authoritative audit
  // trail for a trial is server-side anyway (logHistory 'trial_issued'), so this
  // line is only for the local log.
  console.log(`TRIAL_STARTED days=${TRIAL_DAYS}`);
}

/**
 * Ask the server for the trial key and anchor the countdown to the server's clock.
 *
 * This is what makes the trial honest. Locally there is nothing stopping a shop
 * from uninstalling, deleting its database and starting again, so the server keeps
 * `trial_devices` and answers with the ORIGINAL start date. The local expiry is
 * then replaced by whichever of the two is EARLIER, so a server answer can only
 * ever take time away, never hand back more.
 *
 * Returns false when it could not register (no network, no shop name yet). The
 * caller keeps the local trial in that case rather than blocking the shop.
 */
async function registerTrialWithServer(): Promise<boolean> {
  const settings = getAllSettings();
  const shop = String(settings.shop_name || '').trim();
  // The server keys the trial by shop name (it is what /api/validate matches on),
  // so registration is deferred until the shop has actually been named.
  if (!shop) return false;
  if (settings.license_trial_offline !== '1') return true;
  try {
    const res = await fetchWithTimeout(`${serverUrl()}/api/trial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop, device_id: getDeviceId() }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      key?: string;
      expires?: string | null;
      trial_start?: string;
      msg?: string;
    };
    if (!data.ok || !data.key) return false;

    const localExpiry = trialExpiry(settings);
    const serverExpiry = data.expires ? new Date(data.expires).getTime() : 0;
    // min(), deliberately: the server can shorten a trial but must never extend it.
    const expiry = Math.min(localExpiry || serverExpiry || Infinity, serverExpiry || Infinity);

    setSetting('license_key', data.key);
    setSetting('license_expires', data.expires ?? '');
    setSetting('license_trial_started', data.trial_start ?? settings.license_trial_started);
    setSetting('license_trial_expires', Number.isFinite(expiry) ? new Date(expiry).toISOString() : '');
    setSetting('license_trial_offline', '0');
    setSetting('license_last_check', Date.now().toString());
    return true;
  } catch {
    return false; // offline — the local trial stands
  }
}

/**
 * Trial state for the Settings screen.
 *
 * Deliberately never throws. The one moment the shop most needs this on screen is
 * after the trial has ended -- that is exactly the state a throwing function would
 * refuse to render. Read-only, and reads no network.
 */
export function trialStatus(): {
  isTrial: boolean;
  active: boolean;
  daysLeft: number;
  totalDays: number;
  startedAt: string;
  expiresAt: string;
  serverAnchored: boolean;
} {
  const settings = getAllSettings();
  const expiry = trialExpiry(settings);
  const trial = isTrial(settings);
  return {
    isTrial: trial,
    active: trial && !!expiry && Date.now() <= expiry,
    daysLeft: trialDaysLeft(),
    totalDays: TRIAL_DAYS,
    startedAt: String(settings.license_trial_started ?? ''),
    expiresAt: expiry ? new Date(expiry).toISOString() : '',
    // False while the countdown is still a local guess. Worth showing: it is the
    // difference between "your trial is safe" and "this will be confirmed next time
    // the shop is online".
    serverAnchored: settings.license_trial_offline !== '1',
  };
}

/** Shared expiry message so the sale path and the startup path read identically. */
function assertTrialActive(): void {
  const settings = getAllSettings();
  const expiry = trialExpiry(settings);
  if (expiry && Date.now() > expiry) {
    throw new Error(
      `Your ${TRIAL_DAYS}-day free trial has ended. Enter your licence key in Settings to keep billing.`,
    );
  }
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
  const data = (await res.json()) as { ok: boolean; expires?: string | null; lifetime?: boolean; trial?: boolean; msg?: string };
  if (!data.ok) throw new Error(data.msg ?? 'Invalid license');
  const now = Date.now();
  setSetting('license_key', key);
  // A perpetual licence stores an empty expiry: there is no date to count down.
  setSetting('license_expires', data.expires ?? '');
  setSetting('license_lifetime', data.lifetime ? '1' : '0');
  // The trial flag must be corrected in BOTH directions here, not just set. A shop
  // that trials for 15 days and then buys a real key keeps the `license_trial` row,
  // and without this the stale trial expiry would go on blocking their sales
  // forever -- a paying customer locked out by a setting they cannot see or edit.
  if (data.trial) {
    setSetting('license_trial', '1');
    if (data.expires) setSetting('license_trial_expires', data.expires);
  } else {
    setSetting('license_trial', '0');
    setSetting('license_trial_expires', '');
    setSetting('license_trial_offline', '0');
  }
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
  let settings = getAllSettings();

  // First run: no licence at all. Start the free trial instead of refusing to open.
  //
  // This branch is the whole reason the trial exists. Previously this function threw
  // 'No license key set' -- and main.ts only LOGGED that error, while the per-sale
  // check returned early because there was no expiry to evaluate. So an unlicensed
  // install was not refused anything: it opened and billed, indefinitely and for
  // free. Throwing here was theatre.
  if (!settings.license_key && !isTrial(settings)) startLocalTrial();
  settings = getAllSettings();

  // A trial that has not yet reached the server tries now, so the countdown becomes
  // server-anchored and a reinstall cannot buy a second 15 days. Failure is not
  // fatal: a shop that is offline keeps its local trial rather than being locked out.
  if (isTrial(settings) && settings.license_trial_offline === '1') {
    await registerTrialWithServer();
    settings = getAllSettings();
  }

  const key = settings.license_key as string | undefined;
  if (!key) {
    // No key even after trying: the trial is running offline. That is legitimate as
    // long as it has not run out, so this is where a trial-expiry error belongs.
    assertTrialActive();
    return;
  }
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
      const data = (await res.json()) as { ok: boolean; expires?: string | null; lifetime?: boolean; trial?: boolean; msg?: string };
      if (data.ok) {
        setSetting('license_last_check', nowMs.toString());
        setSetting('license_lifetime', data.lifetime ? '1' : '0');
        if (data.lifetime) {
          // A perpetual key is never a trial, whatever the row used to be.
          setSetting('license_trial', '0');
        } else if (data.trial) {
          // The shop pasted a trial key in by hand. Record it as a trial so the paid
          // grace period below is skipped -- otherwise a trial would quietly be worth
          // TRIAL_DAYS + GRACE_DAYS days of free use.
          setSetting('license_trial', '1');
          if (data.expires) setSetting('license_trial_expires', data.expires);
        }
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
        // The server is the authority on when a trial ended, so pull the local
        // countdown down to it. Guarded on `trial` because a PAID licence that has
        // lapsed is still entitled to its grace period, and marking that one as a
        // trial would deny a customer the 15 days they already paid for.
        if (/expired/i.test(data.msg ?? '') && (data.trial || isTrial(getAllSettings()))) {
          setSetting('license_trial', '1');
          setSetting('license_trial_expires', new Date(nowMs).toISOString());
        }
      }
    } catch {
      // Network error only — stay on the locally cached state.
    }
    if (rejection) throw new Error(rejection);
  }

  // Re-read: the online check may have just changed license_lifetime.
  const fresh = getAllSettings();
  if (isLifetime(fresh)) return;

  // A trial gets NO grace period. Nobody has paid, so there is nothing to forgive,
  // and falling through to the paid path below would make the advertised 15 days
  // silently mean 30.
  if (isTrial(fresh)) {
    const left = trialDaysLeft();
    if (left <= WARN_DAYS) sendWarning(left);
    assertTrialActive();
    return;
  }

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

  // A trial is evaluated here too, and deliberately without any grace period.
  if (isTrial(settings)) {
    assertTrialActive();
    return;
  }

  // No licence and no trial.
  //
  // This used to fall through to `if (!expiresStr) return; // no expiry set, assume
  // OK` further down, which is exactly what an install that had never entered a key
  // looked like. So an unlicensed app was allowed to ring up sales indefinitely, for
  // free. Nothing blocked it: checkLicense() threw at startup but main.ts only logged
  // the error, and the renderer has no licence gate at all.
  //
  // That state is now refused, which is what gives the advertised 15-day trial
  // something to be free *instead of*. The blast radius stays narrow on purpose --
  // this function runs only from the sale path (sales.ts), so the app still opens,
  // still reads reports and still exports data; it just cannot take money without
  // either a licence or a live trial. Entering the key in Settings always clears it.
  if (!(settings.license_key as string | undefined)) {
    throw new Error(
      `No licence. Start the ${TRIAL_DAYS}-day free trial or enter your licence key in Settings.`,
    );
  }

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
  // Read-only trial state for the Settings screen. Separate from licensing:check so
  // that rendering the badge can never itself throw 'trial ended' at the shop.
  ipcMain.handle('licensing:trialStatus', async () => trialStatus());
}
