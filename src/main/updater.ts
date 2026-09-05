import { BrowserWindow, ipcMain, app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { log, logError } from './logger';
import { shutdownWhatsAppGateway, isWhatsAppInitialized } from './whatsapp-gateway';

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
  | 'error'
  | 'restarting';

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

  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'hamzarazadomain3-code',
    repo: 'pos-releases',
  });

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
    // Send 'restarting' status to show modal in renderer
    sendStatus('restarting');
    log('Updater: shutting down before install');

    // Gracefully shut down WhatsApp gateway so the Chrome/Puppeteer
    // process tree exits *before* quitAndInstall runs.  This prevents
    // the NSIS "Failed to uninstall old application files" error.
    if (isWhatsAppInitialized()) {
      try {
        await shutdownWhatsAppGateway();
        log('Updater: WhatsApp gateway shut down cleanly');
      } catch (e) {
        logError('updater shutdown', e);
      }
    }

    // Additional cleanup: ensure all intervals are cleared
    // This is handled in main.ts before-quit handler

    // wait 500ms for any async cleanup to complete
    await new Promise(r => setTimeout(r, 500));

    // quitAndInstall(isSilent, isForceRunAfter)
    autoUpdater.quitAndInstall(true, true);
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
