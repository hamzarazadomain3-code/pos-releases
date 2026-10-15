// electron-browser — the browser stand-in for the `electron` module, so the REAL
// desktop preload (`src/preload/preload.ts`) runs unchanged in the web app and
// installs `window.api`. Every `ipcRenderer.invoke(channel, ...args)` then becomes
// a call to this worker's `/api/rpc`, which runs the identical desktop handler in
// the shop's Durable Object — i.e. the same services, the same return shapes.
//
// Auth is the single translation point: the desktop `auth:login` checks a local
// password hash and sets an in-process session, but a web shop authenticates
// against its ACCOUNTS row and receives a bearer token, so `auth:login` /
// `auth:logout` are handled here (POST /api/login) instead of via /api/rpc.

import JsBarcode from 'jsbarcode';

const LITE_SESSION_KEY = 'rokar_web_session'; // shared with the lite dashboard SPA at "/"
const RENDERER_SESSION_KEY = 'pos_session'; // read by src/renderer/src/App.tsx
const SHOP_KEY = 'rokar_web_shop';

// Injected at bundle time from the desktop package.json (see web/vite.config.mjs).
declare const __APP_VERSION__: string;
const WEB_VERSION = __APP_VERSION__;

interface LiteSession {
  token?: string;
  user?: { id: number; username: string; role: string };
  shop?: { slug?: string };
}

function readLite(): LiteSession | null {
  try {
    return JSON.parse(localStorage.getItem(LITE_SESSION_KEY) || 'null') as LiteSession | null;
  } catch {
    return null;
  }
}

function currentToken(): string | null {
  return readLite()?.token ?? null;
}

/** The shop this POS is bound to: `?shop=slug` in the URL, else the last one used. */
function resolveShopSlug(): string {
  try {
    const fromUrl = new URL(window.location.href).searchParams.get('shop');
    if (fromUrl) {
      localStorage.setItem(SHOP_KEY, fromUrl);
      return fromUrl;
    }
    return localStorage.getItem(SHOP_KEY) || readLite()?.shop?.slug || '';
  } catch {
    return '';
  }
}

async function rpc(channel: string, args: unknown[]): Promise<unknown> {
  const token = currentToken();
  if (!token) throw new Error('Not signed in');
  const res = await fetch('/api/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ channel, args }),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; data?: unknown; error?: string } | null;
  if (!body || !body.ok) throw new Error((body && body.error) || `Request failed (${res.status})`);
  return body.data;
}

async function currentUser(): Promise<unknown> {
  if (!currentToken()) return null;
  try {
    return await rpc('auth:currentUser', []);
  } catch {
    return null;
  }
}

async function webLogin(
  username: string,
  password: string
): Promise<{ ok: boolean; user?: unknown; message?: string }> {
  const shop = resolveShopSlug();
  if (!shop) {
    return { ok: false, message: 'Open Rokar POS from your shop dashboard so it knows which shop to sign in to.' };
  }
  let body: (Record<string, unknown> & { ok?: boolean; error?: string; token?: string; user?: unknown; shop?: unknown }) | null = null;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shop, username, password }),
    });
    body = (await res.json().catch(() => null)) as typeof body;
  } catch {
    body = null;
  }
  if (!body || !body.ok) {
    return { ok: false, message: (body && body.error) || 'Invalid username or password' };
  }
  // Keep the web session where the lite dashboard expects it, so signing in here
  // also signs in there (and vice versa).
  localStorage.setItem(LITE_SESSION_KEY, JSON.stringify({ token: body.token, user: body.user, shop: body.shop }));
  return { ok: true, user: body.user };
}

function clearAuth(): void {
  localStorage.removeItem(LITE_SESSION_KEY);
  localStorage.removeItem(RENDERER_SESSION_KEY);
}

/**
 * Seed the renderer's own session marker so `App.tsx`'s restore path runs and
 * calls `auth.refreshSession()`, which resolves the real POS user from the web
 * token. Without this the app would show its login screen even when signed in.
 */
export function seedRendererSession(): void {
  try {
    const lite = readLite();
    if (lite?.token && lite.user && !localStorage.getItem(RENDERER_SESSION_KEY)) {
      localStorage.setItem(RENDERER_SESSION_KEY, JSON.stringify({ user: lite.user, savedAt: Date.now() }));
    }
  } catch {
    /* private mode / storage disabled */
  }
}

const noop = (): void => {};

// ── Printing ────────────────────────────────────────────────────────────────
// A browser cannot do Electron's hidden-print-window trick, but it can print an
// HTML document. These channels are handled here: the worker builds the exact
// document the desktop would (`cloud:print` → src/print-bridge.ts) and we render
// it into a hidden iframe and call the browser's own print dialog. Channels that
// genuinely need desktop hardware (cash drawer, file export, printer list) fall
// through to the worker, which answers with a helpful message.
const PRINT_DOC_CHANNELS = new Set<string>([
  'printing:printSale',
  'printing:previewReceipt',
  'printing:printInvoice',
  'printing:previewInvoice',
  'printing:printLabel',
  'printing:printBarcodeLabel',
  'printing:printBarcodeBatch',
  'printing:previewBarcodeBatch',
  'printing:printBarcodeBatchWithOptions',
  'printing:printCalibrationLabel',
  'printing:printDrawerSummary',
  'printing:printTestSheet',
]);

interface WebPrintDocument {
  ok?: boolean;
  html?: string;
  title?: string;
  paper?: string;
  message?: string;
}

/** A document that declares a fully fixed paper size needs no measuring. */
const FIXED_PAGE_RE = /@page\s*\{[^}]*\bsize\s*:\s*[\d.]+mm\s+[\d.]+mm/i;
/** A width declared by a document, e.g. `@page { size: 80mm auto }`. */
const DECLARED_WIDTH_RE = /@page\s*\{[^}]*\bsize\s*:\s*([\d.]+)mm/i;

/**
 * Stamp `@page { size: Wmm Hmm }` onto a document whose own CSS does not fix a
 * page size (thermal receipts, drawer summaries, labels). The desktop measures
 * the rendered DOM for exactly this reason — the roll height must come from the
 * laid-out content, never a guess.
 */
function stampPageSize(doc: Document, source: string): void {
  const root = doc.documentElement;
  const body = doc.body;
  if (!root || !body) return;
  const pxToMm = (px: number): number => (px * 25.4) / 96;
  const declared = DECLARED_WIDTH_RE.exec(source);
  const contentWidthPx = Math.max(
    root.scrollWidth,
    body.scrollWidth,
    Math.ceil(body.getBoundingClientRect().width)
  );
  const widthMm = declared ? Number(declared[1]) : Math.round(pxToMm(contentWidthPx));
  const heightMm = Math.round(pxToMm(Math.max(root.scrollHeight, body.scrollHeight)));
  const w = Math.min(400, Math.max(20, widthMm || 80));
  const h = Math.min(2000, Math.max(20, heightMm || 100));
  const style = doc.createElement('style');
  style.textContent = `@page { size: ${w}mm ${h}mm; margin: 0; }`;
  doc.head.appendChild(style);
}

/**
 * The worker builds label documents with bwip-js stubbed out (no rasteriser in a
 * Worker), so their barcode images come back empty. The browser CAN draw them, so
 * fill each label's barcode from the human-readable number the template already
 * prints. EAN-13 when the text is a checksum-valid 13-digit code, else CODE128 —
 * mirroring `symbologyFor()` on the desktop.
 */
function isEan13(text: string): boolean {
  if (!/^\d{13}$/.test(text)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(text[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(text[12]);
}

function augmentLabelBarcodes(doc: Document): void {
  const cells = doc.querySelectorAll('.label .code');
  for (const code of Array.from(cells)) {
    if (code.querySelector('img')) continue; // a real image was already emitted
    const num = code.querySelector('.num');
    const value = (num?.textContent || '').trim();
    if (!value) continue;
    try {
      const canvas = document.createElement('canvas');
      JsBarcode(canvas, value, {
        format: isEan13(value) ? 'EAN13' : 'CODE128',
        displayValue: false,
        margin: 0,
        width: 2,
        height: 40,
      });
      const img = doc.createElement('img');
      img.src = canvas.toDataURL('image/png');
      img.alt = '';
      // The label CSS sizes `.code img` to the right height for the roll.
      code.insertBefore(img, num);
    } catch {
      /* an unencodable value just prints as text */
    }
  }
}

/** Print an HTML document with the browser's own dialog, via a hidden iframe. */
function printHtmlInBrowser(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText =
      'position:fixed;left:-10000px;top:0;width:10px;height:600px;border:0;';
    document.body.appendChild(frame);

    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      try {
        frame.remove();
      } catch {
        /* ignore */
      }
      resolve();
    };
    // Never leave the caller hanging if onload never fires.
    const guard = setTimeout(finish, 15000);

    frame.onload = () => {
      const win = frame.contentWindow;
      const doc = frame.contentDocument;
      if (!win || !doc) return finish();

      const doPrint = (): void => {
        try {
          if (!FIXED_PAGE_RE.test(html)) stampPageSize(doc, html);
          win.focus();
          win.print();
        } catch {
          /* ignore — the app keeps working, only the dialog is skipped */
        }
        // Chrome's print() blocks until the dialog closes; keep the frame a beat
        // longer so the print engine has finished rendering it.
        setTimeout(finish, 1000);
      };

      try {
        augmentLabelBarcodes(doc);
      } catch {
        /* ignore */
      }
      // Let any injected barcode images decode before the page is measured.
      setTimeout(doPrint, 80);
    };

    frame.srcdoc = html;
  });
}

async function webPrint(channel: string, args: unknown[]): Promise<unknown> {
  let doc: WebPrintDocument | null = null;
  try {
    doc = (await rpc('cloud:print', [channel, args])) as WebPrintDocument | null;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  if (!doc || !doc.ok || !doc.html) {
    return {
      ok: false,
      message: (doc && doc.message) || 'Could not prepare the document for printing.',
    };
  }
  await printHtmlInBrowser(doc.html);
  return { ok: true, message: 'Print dialog opened.' };
}

/**
 * Browsers the shop's staff actually use reserve Ctrl+Shift+S (Edge → "Web
 * capture", Firefox → "Take screenshot") and deliver no keydown at all, so the
 * desktop chord is unusable in the web build. Rewrite ONLY the seeded default,
 * leaving any owner-customised binding untouched.
 */
const BROWSER_SAFE_SAVE_PRINT = 'Ctrl+Alt+S';
const DEFAULT_SAVE_PRINT = 'ctrl+shift+s';

function patchBrowserShortcuts(rows: unknown): unknown {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const r = row as { action?: string; shortcut_key?: string };
    if (
      r.action === 'save_print' &&
      String(r.shortcut_key ?? '').toLowerCase() === DEFAULT_SAVE_PRINT
    ) {
      return { ...r, shortcut_key: BROWSER_SAFE_SAVE_PRINT };
    }
    return row;
  });
}

async function webInvoke(channel: string, ...args: unknown[]): Promise<unknown> {
  if (PRINT_DOC_CHANNELS.has(channel)) return webPrint(channel, args);
  switch (channel) {
    // Handled in the browser: there is no Electron main process here.
    case 'app:get-version':
      return WEB_VERSION;
    case 'app:getLogPath':
      return '';
    case 'app:quit':
      return undefined;
    case 'updater:check':
    case 'updater:install':
      return undefined;
    case 'updater:getState':
      return { state: 'idle' };
    case 'auth:login':
      return webLogin(String(args[0] ?? ''), String(args[1] ?? ''));
    case 'auth:logout':
      clearAuth();
      return undefined;
    case 'auth:refreshSession':
    case 'auth:currentUser':
      return currentUser();
    // A browser cannot receive Ctrl+Shift+S (Edge claims it for "Web capture",
    // Firefox for "Take screenshot") — the keydown never reaches the page, so no
    // script can rescue it. Serve the browser-safe chord instead, keeping the
    // footer hint, the F1 overlay and the billing handler in agreement. Only the
    // untouched default is rewritten, so an owner's own binding is respected.
    case 'admin:shortcuts:getAll':
      return patchBrowserShortcuts(await rpc(channel, args));
    default:
      // Everything else is the real desktop channel, run server-side.
      return rpc(channel, args);
  }
}

export const contextBridge = {
  exposeInMainWorld: (name: string, value: unknown): void => {
    (window as unknown as Record<string, unknown>)[name] = value;
  },
};

export const ipcRenderer = {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> => webInvoke(channel, ...args),
  send: noop,
  on: (_channel: string, _listener: unknown): void => {},
  once: noop,
  removeListener: noop,
};

export default { contextBridge, ipcRenderer };
