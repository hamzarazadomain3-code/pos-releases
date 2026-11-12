import { BrowserWindow, ipcMain, app, powerMonitor } from 'electron';
import { autoUpdater } from 'electron-updater';
import { log, logError } from './logger';
import { shutdownWhatsAppGateway, isWhatsAppInitialized } from './whatsapp-gateway';

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

let initialized = false;
let lastState: string = 'idle';
let checkTimer: NodeJS.Timeout | null = null;
let focusListenerAttached = false;

export type UpdaterState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error'
  | 'restarting';

function sendStatus(state: UpdaterState, detail?: string): void {
  lastState = state;
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('updater:status', { state, detail });
  }
}

/** Primary feed: generic provider pointing at GitHub's CDN redirect (no API rate limit). */
const GENERIC_FEED_URL = 'https://github.com/hamzarazadomain3-code/pos-releases/releases/latest/download/';

/** Fallback feed: GitHub provider (uses .atom feed + releases/latest JSON, no API for public repos). */
const GITHUB_FEED_CONFIG = {
  provider: 'github' as const,
  owner: 'hamzarazadomain3-code',
  repo: 'pos-releases',
};

/** Configure autoUpdater with the primary generic feed. */
function configurePrimaryFeed(): void {
  autoUpdater.setFeedURL(GENERIC_FEED_URL);
}

/** Fallback to GitHub provider if generic fails. */
function configureFallbackFeed(): void {
  autoUpdater.setFeedURL(GITHUB_FEED_CONFIG);
}

/** Set up autoUpdater events and IPC. Safe to call once. */
export function initUpdater(): void {
  if (initialized) return;
  initialized = true;

  // Primary: generic provider (CDN, no GitHub API rate limit)
  configurePrimaryFeed();

  autoUpdater.on('checking-for-update', () => {
    log('Updater: checking for updates');
    sendStatus('checking');
  });

  autoUpdater.on('update-available', (info) => {
    log(`Updater: update available v${info.version}`);
    sendStatus('available', info.version);
  });

  autoUpdater.on('update-not-available', () => {
    log('Updater: up to date');
    sendStatus('up-to-date');
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent);
    sendStatus('downloading', String(percent));
  });

  autoUpdater.on('update-downloaded', (info) => {
    log(`Updater: update downloaded v${info.version}`);
    sendStatus('downloaded', info.version);
  });

  autoUpdater.on('error', (err) => {
    logError('updater', err);
    sendStatus('error', err.message);
  });

  ipcMain.handle('updater:check', async () => {
    try {
      await checkForUpdates(true);
      return 'ok';
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  });

  ipcMain.handle('updater:install', async () => {
    sendStatus('restarting');
    log('Updater: shutting down before install');

    if (isWhatsAppInitialized()) {
      try {
        await shutdownWhatsAppGateway();
        log('Updater: WhatsApp gateway shut down cleanly');
      } catch (e) {
        logError('updater shutdown', e);
      }
    }

    await new Promise(r => setTimeout(r, 500));
    autoUpdater.quitAndInstall(true, true);
    return 'ok';
  });

  ipcMain.handle('updater:getState', async () => lastState);

  // Start periodic background checks (every 6 hours)
  startPeriodicChecks();

  // Check on app focus (user returns to app)
  attachFocusListener();
}

/** Check for updates with retry + fallback. Never blocks/crashes the app. */
export async function checkForUpdates(manual = false): Promise<void> {
  if (!initialized) initUpdater();
  try {
    if (process.env.POS_DISABLE_UPDATE === '1') {
      log('Updater: disabled via POS_DISABLE_UPDATE');
      if (manual) sendStatus('up-to-date');
      return;
    }
    log(`Updater: manual=${manual} starting check`);

    // Try primary (generic) first
    let result = await checkWithRetry(autoUpdater, 3, 1000);
    if (result && !result.updateInfo) {
      sendStatus('up-to-date');
      return;
    }
    if (result?.updateInfo) return; // update available/downloading/downloaded

    // If primary failed or returned nothing, try fallback (GitHub provider)
    log('Updater: primary check returned no update, trying fallback provider');
    configureFallbackFeed();
    result = await checkWithRetry(autoUpdater, 2, 1500);
    if (result && !result.updateInfo) {
      sendStatus('up-to-date');
    }
    // Restore primary feed for next check
    configurePrimaryFeed();
  } catch (e) {
    logError('updater check', e);
    sendStatus('error', e instanceof Error ? e.message : String(e));
    // Ensure primary feed is restored even on error
    try { configurePrimaryFeed(); } catch {}
  }
}

/** Check for updates with retry + exponential backoff. */
async function checkWithRetry(
  updater: typeof autoUpdater,
  maxAttempts: number,
  baseDelayMs: number
): Promise<Awaited<ReturnType<typeof updater.checkForUpdates>> | null> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await updater.checkForUpdates();
      if (result) return result;
      return null;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      log(`Updater: check attempt ${attempt + 1}/${maxAttempts} failed: ${msg}`);
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, baseDelayMs * (attempt + 1)));
      }
    }
  }
  logError(`Updater: all ${maxAttempts} attempts failed`, lastErr);
  throw lastErr;
}

/** Start periodic background update checks (every 6 hours). */
function startPeriodicChecks(): void {
  if (checkTimer) clearInterval(checkTimer);
  checkTimer = setInterval(() => {
    checkForUpdates(false).catch(() => undefined);
  }, 6 * 60 * 60 * 1000); // 6 hours
  // Don't prevent app exit
  checkTimer.unref?.();
}

/** Attach listener to check for updates when app gains focus. */
function attachFocusListener(): void {
  if (focusListenerAttached) return;
  focusListenerAttached = true;
  powerMonitor.on('resume', () => {
    log('Updater: system resume, checking for updates');
    checkForUpdates(false).catch(() => undefined);
  });
  app.on('browser-window-focus', () => {
    // Throttle: only check if last check was > 30 min ago
    // (simple approach: just check, electron-updater dedupes concurrent checks)
    checkForUpdates(false).catch(() => undefined);
  });
}

/** Cleanup on app quit. */
export function stopUpdater(): void {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
  powerMonitor.removeAllListeners('resume');
  app.removeAllListeners('browser-window-focus');
  initialized = false;
}