import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { logError } from './logger';
import { getSale } from './services/sales';
import { buildReceiptText } from './services/printing';

let whatsappClient: any = null;
let qrDataUrl: string | null = null;
let readyPhone: string | null = null;
let connecting = false;
let lastError: string | null = null;

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
      whatsappClient = null;
      connecting = false;
      lastError = reason;
      broadcast('whatsapp:status', { connected: false, error: reason });
    });

    await client.initialize();
    connecting = false;
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
  try {
    await whatsappClient.sendMessage(formatted + '@c.us', text);
    return { ok: true, message: `WhatsApp receipt sent to ${phoneNumber}` };
  } catch (e) {
    console.error('WhatsApp send error:', e);
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
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

/** Gracefully shutdown the WhatsApp gateway - for use during app quit. */
export async function shutdownWhatsAppGateway(): Promise<void> {
  if (whatsappClient && typeof whatsappClient.destroy === 'function') {
    try {
      await whatsappClient.destroy();
    } catch {
      // ignore teardown errors
    }
  }
  whatsappClient = null;
  qrDataUrl = null;
  readyPhone = null;
  connecting = false;
}
