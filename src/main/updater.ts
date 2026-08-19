import { BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import { log, logError } from './logger';

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

let initialized = false;
let lastState: string = 'idle';

export type UpdaterState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error';

function sendStatus(state: UpdaterState, detail?: string): void {
  lastState = state;
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('updater:status', { state, detail });
  }
}

/** Set up autoUpdater events and IPC. Safe to call once. */
export function initUpdater(): void {
  if (initialized) return;
  initialized = true;

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
    autoUpdater.quitAndInstall();
    return 'ok';
  });

  ipcMain.handle('updater:getState', async () => lastState);
}

/**
 * Check for updates. On startup this runs in the background and never
 * blocks or crashes the app — all failures are caught and logged.
 */
export async function checkForUpdates(manual = false): Promise<void> {
  if (!initialized) initUpdater();
  try {
    if (process.env.POS_DISABLE_UPDATE === '1') {
      log('Updater: disabled via POS_DISABLE_UPDATE');
      if (manual) sendStatus('up-to-date');
      return;
    }
    log(`Updater: manual=${manual} starting check`);
    const result = await autoUpdater.checkForUpdates();
    if (result && !result.updateInfo) {
      sendStatus('up-to-date');
    }
  } catch (e) {
    logError('updater check', e);
    sendStatus('error', e instanceof Error ? e.message : String(e));
  }
}
