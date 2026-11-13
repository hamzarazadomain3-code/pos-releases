import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { logError } from './logger';
import { getSale } from './services/sales';
import { buildReceiptText } from './services/printing';
import { isWWebJsLost, describeWhatsAppFailure } from '../shared/whatsappRecovery';

let whatsappClient: any = null;
let qrDataUrl: string | null = null;
let readyPhone: string | null = null;
let connecting = false;
let lastError: string | null = null;
let healthTimer: NodeJS.Timeout | null = null;

/**
 * WhatsApp Web reloads its own page now and then, and a page reload wipes the
 * `window.WWebJS` object that whatsapp-web.js injects once at startup. Every
 * later call that needs it then dies with
 *   "Cannot read properties of undefined (reading 'getChat')".
 *
 * The session itself is fine — it lives in the LocalAuth folder — so the fix
 * is to re-inject (reconnect) rather than to ask the shop owner to scan again.
 * The detection and the owner-facing wording live in
 * `src/shared/whatsappRecovery.ts` (pure, unit-tested).
 */

/** Is the WhatsApp Web page still injected (window.WWebJS present)? */
async function isInjected(client: any): Promise<boolean> {
  try {
    return !!(await client.pupPage.evaluate('typeof window.WWebJS !== "undefined"'));
  } catch {
    return false;
  }
}

/**
 * Make sure the page is injected. If it is not (WhatsApp Web reloaded),
 * reconnect once — the saved session comes straight back, so the owner never
 * has to scan the QR a second time.
 */
async function ensureInjected(): Promise<boolean> {
  const client = whatsappClient;
  if (!client) return false;
  if (await isInjected(client)) return true;
  console.log('[WhatsApp] window.WWebJS is gone (WhatsApp Web reloaded) — reconnecting…');
  await restartWhatsAppGateway();
  return !!whatsappClient && (await isInjected(whatsappClient));
}

/**
 * Watch the injection in the background so the shop owner never hits the
 * error at all: the moment WhatsApp Web reloads, the gateway reconnects by
 * itself and the session comes back silently.
 */
function startHealthCheck(): void {
  if (healthTimer) return;
  healthTimer = setInterval(() => {
    if (!whatsappClient || connecting) return;
    void (async () => {
      try {
        await ensureInjected();
      } catch {
        // ignore transient failures; the next tick tries again
      }
    })();
  }, 60_000); // once a minute
  healthTimer.unref?.();
}

function stopHealthCheck(): void {
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

async function qrToDataUrl(qr: string): Promise<string | null> {
  try {
    const QRCode = await import('qrcode');
    return await QRCode.toDataURL(qr);
  } catch {
    return null;
  }
}

// Bundled Chrome for Testing (headless shell) shipped inside the installer.
function bundledCacheDir(): string | null {
  if (!app.isPackaged) return null;
  const dir = path.join(process.resourcesPath, 'puppeteer-cache');
  return fs.existsSync(dir) ? dir : null;
}

/**
 * Wait until the client is really usable (the page is injected and the
 * session is live). `client.initialize()` returns before the 'ready' event
 * fires, so sending immediately after a reconnect would race the injection.
 */
async function waitForReady(client: any, timeoutMs = 45_000): Promise<boolean> {
  if (!client || typeof client.on !== 'function') return false;
  if (client.info?.wid?.user || client.info?.me?.user) return true; // already ready
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { client.off?.('ready', onReady); } catch { /* ignore */ }
      resolve(ok);
    };
    const onReady = () => done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    client.on('ready', onReady);
  });
}

/**
 * Start (or re-start) the WhatsApp Web session. The whatsapp-web.js library is
 * loaded lazily so a missing/failed dependency never breaks the POS app.
 */
export async function initWhatsAppGateway(): Promise<boolean> {
  if (whatsappClient || connecting) return !!whatsappClient;
  connecting = true;
  lastError = null;
  console.log('WhatsApp gateway: starting…');
  try {
    const cacheDir = bundledCacheDir();
    if (cacheDir) process.env.PUPPETEER_CACHE_DIR = cacheDir;
    const { Client, LocalAuth } = await import('whatsapp-web.js');

    const client = new Client({
      authStrategy: new LocalAuth({
        dataPath: path.join(app.getPath('userData'), '.wwebjs_auth'),
      }),
      puppeteer: {
        headless: 'shell',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      },
    });

    whatsappClient = client;

    client.on('qr', async (qr: string) => {
      console.log('WhatsApp QR received — broadcast to renderer');
      qrDataUrl = (await qrToDataUrl(qr)) ?? qr;
      readyPhone = null;
      broadcast('whatsapp:qr', qrDataUrl);
    });

    client.on('ready', () => {
      qrDataUrl = null;
      readyPhone = client.info?.wid?.user ?? client.info?.me?.user ?? 'connected';
      broadcast('whatsapp:status', { connected: true, phone: readyPhone });
    });

    client.on('authenticated', () => {
      qrDataUrl = null;
    });

    client.on('auth_failure', (msg: string) => {
      lastError = msg;
      broadcast('whatsapp:status', { connected: false, error: msg });
    });

    client.on('disconnected', (reason: string) => {
      // Only the CURRENT client may clear the state. A teardown of the OLD
      // client (during a reconnect) fires this too, and it must not wipe the
      // fresh client that has already replaced it.
      if (whatsappClient !== client) return;
      whatsappClient = null;
      connecting = false;
      lastError = reason;
      broadcast('whatsapp:status', { connected: false, error: reason });
    });

    await client.initialize();
    // The page must be injected before anything can be sent through it.
    const ready = await waitForReady(client);
    if (!ready) {
      console.warn('[WhatsApp] client did not become ready in time');
    }
    connecting = false;
    startHealthCheck();
    return true;
  } catch (e) {
    whatsappClient = null;
    connecting = false;
    lastError = e instanceof Error ? e.message : String(e);
    console.error('WhatsApp init error:', e);
    logError('WhatsApp init', e);
    return false;
  }
}

/** Force a full restart of the WhatsApp gateway (used by the Rescan button). */
export async function restartWhatsAppGateway(): Promise<boolean> {
  const existing = whatsappClient;
  whatsappClient = null;
  qrDataUrl = null;
  readyPhone = null;
  connecting = false;
  if (existing && typeof existing.destroy === 'function') {
    try {
      await existing.destroy();
    } catch {
      // ignore teardown errors
    }
  }
  broadcast('whatsapp:status', { connected: false, error: null });
  return initWhatsAppGateway();
}

export function getWhatsAppStatus(): {
  connected: boolean;
  phone: string | null;
  qr: string | null;
  error: string | null;
} {
  return {
    connected: !!whatsappClient,
    phone: readyPhone,
    qr: qrDataUrl,
    error: lastError,
  };
}

function formatPhoneNumber(phoneNumber: string): string | null {
  let digits = phoneNumber.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = '92' + digits.slice(1);
  if (!digits.startsWith('92')) digits = '92' + digits;
  return digits;
}

export async function sendWhatsAppReceipt(phoneNumber: string, text: string): Promise<{ ok: boolean; message: string }> {
  if (!whatsappClient) {
    return { ok: false, message: 'WhatsApp not connected. Open Settings → WhatsApp and scan the QR code first.' };
  }
  const formatted = formatPhoneNumber(phoneNumber);
  if (!formatted) {
    return { ok: false, message: 'Invalid phone number.' };
  }
  const target = formatted + '@c.us';
  try {
    await whatsappClient.sendMessage(target, text);
    return { ok: true, message: `WhatsApp receipt sent to ${phoneNumber}` };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    console.error('WhatsApp send error:', e);

    // The page reloaded and window.WWebJS is gone: reconnect once (the saved
    // session comes straight back — no new QR scan) and retry the send.
    if (isWWebJsLost(raw)) {
      console.log('[WhatsApp] send failed because the page was reloaded — reconnecting and retrying…');
      try {
        await restartWhatsAppGateway();
        if (whatsappClient) {
          await whatsappClient.sendMessage(target, text);
          return { ok: true, message: `WhatsApp receipt sent to ${phoneNumber}` };
        }
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        console.error('WhatsApp send retry error:', retryErr);
        return { ok: false, message: describeWhatsAppFailure(retryMsg) };
      }
    }

    return { ok: false, message: describeWhatsAppFailure(raw) };
  }
}

export async function sendSaleReceiptOnWhatsApp(
  saleId: number,
  phone?: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const sale = getSale(saleId);
    if (!sale) throw new Error('Sale not found');
    const to = phone ?? sale.customer_phone ?? sale.customer_name;
    if (!to) {
      return { ok: false, message: 'No phone number available for this customer.' };
    }
    return await sendWhatsAppReceipt(String(to), buildReceiptText(saleId));
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Check if the WhatsApp gateway is initialized and active.
 */
export function isWhatsAppInitialized(): boolean {
  return !!whatsappClient;
}

/**
 * Get the underlying browser process ID if available (for debugging).
 */
function getBrowserProcessId(): number | null {
  try {
    // @ts-ignore - accessing internal puppeteer browser/process
    const browser = whatsappClient?.pupBrowser;
    if (browser?.process) {
      const proc = browser.process();
      if (proc) return proc.pid;
    }
    // @ts-ignore
    if (whatsappClient?.browser?.process) {
      // @ts-ignore
      const proc = whatsappClient.browser.process();
      if (proc) return proc.pid;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Kill a child process tree (process + all children) on Windows.
 * Uses taskkill to ensure the full Puppeteer Chrome process tree exits.
 */
function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    try {
      const { execSync } = require('node:child_process');
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'pipe' });
    } catch {
      // process may already be dead
    }
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // ignore
    }
  }
}

/** Gracefully shutdown the WhatsApp gateway — for use during app quit.
 *
 * Returns a Promise that resolves only after the underlying Chrome/Puppeteer
 * process has fully exited, or after a 3-second timeout (after which we
 * force-kill the process tree).
 *
 * If the gateway was never initialised (client is null) the Promise resolves
 * immediately.
 */
export async function shutdownWhatsAppGateway(): Promise<void> {
  stopHealthCheck();
  if (!whatsappClient) return;

  const pid = getBrowserProcessId();
  let destroyed = false;

  // 1. Ask whatsapp-web.js to destroy the client (async, non-blocking)
  if (typeof whatsappClient.destroy === 'function') {
    try {
      await whatsappClient.destroy();
      destroyed = true;
    } catch {
      // ignore teardown errors
    }
  }

  // 2. Wait for Chrome process to exit, with a 5-second timeout
  if (pid) {
    const startTime = Date.now();
    const timeout = 5000;
    while (Date.now() - startTime < timeout) {
      if (!isProcessAlive(pid)) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // 3. If still alive after timeout, force-kill the process tree
    if (isProcessAlive(pid)) {
      try {
        const { execSync } = require('node:child_process');
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'pipe' });
      } catch {
        // force-kill may have already succeeded
      }
      // Give it a moment to die
      const forceStart = Date.now();
      while (Date.now() - forceStart < 2000) {
        if (!isProcessAlive(pid)) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  } else if (destroyed) {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  whatsappClient = null;
  qrDataUrl = null;
  readyPhone = null;
  connecting = false;
}

/** Check if a process is still alive (Windows uses tasklist). */
function isProcessAlive(pid: number): boolean {
  if (process.platform === 'win32') {
    try {
      const { execSync } = require('node:child_process');
      execSync(`tasklist /fi "PID eq ${pid}" /fo csv`, { stdio: 'pipe' });
      return true;
    } catch {
      // tasklist returns non-zero when the process doesn't exist
      return false;
    }
  } else {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
