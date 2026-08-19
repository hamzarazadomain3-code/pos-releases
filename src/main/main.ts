import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'path';
import { initDatabase } from './db';
import { registerIpcHandlers } from './ipc';
import * as licensing from './services/licensing';
import { runBackup } from './services/backup';
import { getAllSettings } from './services/settings';
import { closeLogger, initLogger, log, logError } from './logger';
import { initUpdater, checkForUpdates } from './updater';
import { initWhatsAppGateway } from './whatsapp-gateway';

const isDev = process.env.NODE_ENV === 'development';

function appIcon(): string | null {
  if (app.isPackaged) {
    const p = path.join(process.resourcesPath, 'icon.ico');
    return p;
  }
  return path.join(app.getAppPath(), 'build', 'icon.ico');
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    show: false,
    icon: appIcon() ?? undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  win.webContents.on('render-process-gone', (_e, details) => {
    logError('render-process-gone', new Error(`${details.reason}`));
  });
  win.webContents.on('unresponsive', () => {
    logError('window unresponsive', new Error('renderer unresponsive'));
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

process.on('uncaughtException', (err) => {
  logError('uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
  logError('unhandledRejection', reason);
});
app.on('before-quit', () => {
  closeLogger();
});

app.whenReady().then(async () => {
  initLogger();
  log(`App ready. packaged=${app.isPackaged} version=${app.getVersion()}`);
  try {
    await initDatabase();
    log('Database initialized + migrations applied');
      registerIpcHandlers();
      licensing.registerIpc();
      try {
        await licensing.checkLicense();
      } catch (e) {
        logError('license check', e);
      }
  } catch (err) {
    logError('startup (db/ipc)', err);
    dialog.showErrorBox('ShopKeeper POS — Startup Error', String(err));
    app.exit(1);
    return;
  }

  try {
    const settings = getAllSettings();
    const today = new Date().toISOString().slice(0, 10);
    if (!settings.last_backup || !settings.last_backup.startsWith(today)) {
      const res = runBackup();
      log(`Daily backup done${res.cloudOk ? (res.cloudPath ? ' + cloud copy' : ' (cloud not configured)') : ` + cloud FAILED: ${res.cloudError}`}`);
    }
  } catch (err) {
    logError('auto backup', err);
  }

  if (process.env.POS_SMOKE === '1') {
    try {
      const { runSmoke } = require(path.join(app.getAppPath(), 'scripts', 'smoke.js'));
      await runSmoke();
      console.log('SMOKE_PASS');
      app.exit(0);
    } catch (err) {
      console.log('FAIL=' + (err instanceof Error ? err.message : String(err)));
      app.exit(1);
    }
    return;
  }

  createWindow();
  log('Window created');

  // WhatsApp gateway: lazy, non-blocking, fully independent of licensing.
  initWhatsAppGateway()
    .then((ok) => log(ok ? 'WhatsApp gateway initialized' : 'WhatsApp gateway unavailable'))
    .catch((err) => logError('whatsapp init', err));

  // Auto-update: background, non-blocking, fully independent of licensing.
  try {
    initUpdater();
    setTimeout(() => {
      checkForUpdates(false).catch(() => undefined);
    }, 10000);
    log('Updater initialized, background check scheduled');
  } catch (err) {
    logError('updater init', err);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.handle('app:getLogPath', () => require('./logger').getLogFilePath());