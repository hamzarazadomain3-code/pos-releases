/**
 * Shared print infrastructure — the single code path every printable document
 * in the app goes through (receipts, invoices, barcode labels, drawer summary,
 * calibration sheet).
 *
 * ── Why this module exists ────────────────────────────────────────────────
 * The app previously had THREE unrelated print implementations, all broken:
 *
 *  1. Barcode labels called `window.print()` in the renderer. Electron does not
 *     implement Chromium's in-app print preview, so this died with "This app
 *     doesn't support print preview" and never reached the spooler.
 *  2. Receipts/invoices/labels called `webContents.print()` but never passed
 *     `pageSize` or `margins`. The `webContents.print()` pageSize OPTION is the
 *     only thing that sets paper size — a `@page` CSS rule is ignored. So an
 *     80mm receipt was laid out on whatever paper the printer was loaded with.
 *  3. Preview windows printed via `window.print()` in a sandboxed window (same
 *     dead end) and were never tracked, so a leaked preview window permanently
 *     blocked main-window recreation.
 *
 * Everything is funnelled through `printDocument()` / `previewDocument()` here
 * so a fix lands everywhere at once.
 *
 * ── Geometry rules ────────────────────────────────────────────────────────
 *  - `pageSize` is ALWAYS passed explicitly. Never rely on `@page` CSS.
 *  - `margins: { marginType: 'none' }` always; margins are baked into the CSS as
 *    padding so the result is deterministic. Chromium's own default margins on
 *    top of a thermal roll's hardware margin push content off the paper.
 *  - Document CSS uses `mm`/`pt`, never `px` (px is DPI-dependent).
 *  - Content width is the PRINTABLE width (paper minus the printer's hardware
 *    margin), not the paper width.
 *  - Thermal page height is MEASURED from the rendered DOM, then converted
 *    px -> microns, so the roll cuts to exactly one page with no blank tail.
 */
import { BrowserWindow, app, dialog, protocol } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAllAdminSettings } from './admin';
import { log } from '../logger';

// ═══════════════════════════════════════════════════════════════════
//  UNITS
// ═══════════════════════════════════════════════════════════════════

/** 1 mm = 1000 microns. Electron's `pageSize` is always in microns. */
export const mmToMicrons = (mm: number): number => Math.max(1, Math.round(mm * 1000));
/** CSS px -> mm at the CSS reference resolution of 96dpi. */
export const pxToMm = (px: number): number => (px * 25.4) / 96;
export const mmToPx = (mm: number): number => (mm * 96) / 25.4;

// ═══════════════════════════════════════════════════════════════════
//  PAPER TABLE
// ═══════════════════════════════════════════════════════════════════

export type PaperKind = 'thermal58' | 'thermal80' | 'a4' | 'a5';
export type LabelSize = '38x25' | '38x28' | '50x30' | '100x50';
export type PaperOrLabel = PaperKind | LabelSize;
export type LabelLayout = 'roll' | 'sheet';

export interface PaperSpec {
  kind: PaperKind;
  label: string;
  /** Physical paper width in mm. */
  widthMm: number;
  /** Usable content width in mm (paper minus the printer's hardware margin). */
  contentMm: number;
  /** CSS body padding in mm. */
  padMm: number;
  /** Fixed page height, or null = measure the rendered content (roll media). */
  fixedHeightMm: number | null;
}

export const PAPER_SPECS: Record<PaperKind, PaperSpec> = {
  // 58mm paper has a 48mm print head width (the standard 57.5mm roll / 48mm
  // print width of Epson-class thermal printers). The old 52mm budget was wider
  // than the head and the right-hand columns were being cut off.
  thermal58: { kind: 'thermal58', label: 'Thermal roll 58mm', widthMm: 58, contentMm: 48, padMm: 0, fixedHeightMm: null },
  // 80mm paper has a 72mm print head width (79.5mm roll / 72mm print width).
  thermal80: { kind: 'thermal80', label: 'Thermal roll 80mm', widthMm: 80, contentMm: 72, padMm: 0, fixedHeightMm: null },
  a4: { kind: 'a4', label: 'A4 (210 x 297mm)', widthMm: 210, contentMm: 190, padMm: 10, fixedHeightMm: 297 },
  a5: { kind: 'a5', label: 'A5 (148 x 210mm)', widthMm: 148, contentMm: 134, padMm: 7, fixedHeightMm: 210 },
};

export interface LabelSpec {
  kind: LabelSize;
  label: string;
  w: number;
  h: number;
  /** Columns when printing onto A4 label sheets. */
  sheetCols: number;
  /** Gap between labels in mm (roll pitch gap). */
  gap: number;
  /** Barcode image height in mm. */
  barH: number;
  /** Base font size in pt. */
  fontPt: number;
}

export const LABEL_SPECS: Record<LabelSize, LabelSpec> = {
  // `sheetCols` is what actually fits across A4's 190mm printable width
  // (floor((190 + gap) / (w + gap))). The old template hard-coded 8 columns of
  // 38mm = 304mm, which is wider than A4 and got sliced by the print pipeline.
  '38x25': { kind: '38x25', label: '38 x 25mm', w: 38, h: 25, sheetCols: 4, gap: 1, barH: 8, fontPt: 5.5 },
  // 2-across grocery roll (gap 2mm); sheetCols fits A4's 190mm printable width.
  '38x28': { kind: '38x28', label: '38 x 28mm', w: 38, h: 28, sheetCols: 4, gap: 2, barH: 10, fontPt: 7 },
  '50x30': { kind: '50x30', label: '50 x 30mm', w: 50, h: 30, sheetCols: 3, gap: 1, barH: 10, fontPt: 7 },
  '100x50': { kind: '100x50', label: '100 x 50mm', w: 100, h: 50, sheetCols: 1, gap: 1.5, barH: 15, fontPt: 9 },
};
// The renderer's Label Studio offers more sizes than the bare 3 above. They are
// fixed stock sizes, so they get the same treatment as the original three
// instead of falling back to 38x25. `sheetCols` follows the same A4-fit rule.
const EXTRA_LABEL_SPECS: Array<Omit<LabelSpec, 'kind'> & { kind: string }> = [
  { kind: '40x30', label: '40 x 30mm', w: 40, h: 30, sheetCols: 4, gap: 1, barH: 8, fontPt: 6 },
  { kind: '50x25', label: '50 x 25mm', w: 50, h: 25, sheetCols: 3, gap: 1, barH: 9, fontPt: 6 },
  { kind: '58x40', label: '58 x 40mm', w: 58, h: 40, sheetCols: 3, gap: 1.5, barH: 11, fontPt: 7.5 },
  { kind: '60x40', label: '60 x 40mm', w: 60, h: 40, sheetCols: 3, gap: 1.5, barH: 11, fontPt: 7.5 },
];
for (const spec of EXTRA_LABEL_SPECS) {
  (LABEL_SPECS as Record<string, LabelSpec>)[spec.kind] = spec as LabelSpec;
}

/**
 * Register a one-off label spec (e.g. Label Studio's arbitrary "custom" size)
 * so the shared geometry code can lay out a roll page for it. Idempotent: an
 * existing spec for the same key is never overwritten.
 */
export function registerLabelSpec(spec: LabelSpec): void {
  (LABEL_SPECS as Record<string, LabelSpec>)[spec.kind] = spec;
}

export function isLabelSize(p: PaperOrLabel): p is LabelSize {
  return p in LABEL_SPECS;
}

export function isPaperKind(p: PaperOrLabel): p is PaperKind {
  return p in PAPER_SPECS;
}

/** Page width in mm for any paper/label. */
function widthMmFor(paper: PaperOrLabel): number {
  return isLabelSize(paper) ? LABEL_SPECS[paper].w : PAPER_SPECS[paper].widthMm;
}

/**
 * Columns laid across a label ROLL. A 2-across roll carries two labels side by
 * side on one physical page, so the printed page width is
 * `cols * labelW + (cols - 1) * gap` — not one label. `labelCols` defaults to 1
 * (the historical single-across roll) and is ignored for sheet media.
 */
function rollColsFor(job: PrintJob): number {
  if (job.labelLayout === 'sheet') return 1;
  const n = Math.floor(Number(job.labelCols));
  return Number.isFinite(n) && n >= 1 ? Math.min(6, n) : 1;
}

/** Printed page width for a label roll, accounting for multi-across media. */
function rollPageWidthMm(paper: LabelSize, cols: number): number {
  const spec = LABEL_SPECS[paper];
  const gap = Number.isFinite(spec.gap) ? spec.gap : 0;
  return spec.w * cols + gap * (cols - 1);
}

/**
 * Printed page width for a job. A label batch on A4 sheets is a 210mm page
 * carrying a grid, not a page as wide as one label — the page size and the CSS
 * @page rule must both say A4 or the sheet is cut to a single label column. A
 * multi-across ROLL is the combined label width.
 */
function jobWidthMm(job: PrintJob): number {
  if (isLabelSize(job.paper)) {
    if (job.labelLayout === 'sheet') return PAPER_SPECS.a4.widthMm;
    return rollPageWidthMm(job.paper, rollColsFor(job));
  }
  return widthMmFor(job.paper);
}

// ═══════════════════════════════════════════════════════════════════
//  WINDOW LIFECYCLE
// ═══════════════════════════════════════════════════════════════════

/** Every window this module creates is tracked so none can be orphaned. */
const liveWindows = new Set<BrowserWindow>();

function trackWindow(win: BrowserWindow): BrowserWindow {
  liveWindows.add(win);
  win.once('closed', () => liveWindows.delete(win));
  return win;
}

/**
 * True if any window the user can actually see is still open.
 *
 * The shared hidden print window is deliberately long-lived, so it suppresses
 * `window-all-closed` forever after the first print — the app would sit in the
 * taskbar with no window and the database still open. Callers use this to
 * decide whether closing the main window should really end the process.
 */
export function hasUserFacingWindows(): boolean {
  return BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w !== sharedPrintWindow);
}

/**
 * Close a window WITHOUT `destroy()`.
 *
 * On Electron 43 / Windows, calling `BrowserWindow.destroy()` poisons the
 * renderer: every subsequent navigation in any newly created window fails with
 * `ERR_FAILED (-2)`. Reproduced in isolation — create+load+destroy, then
 * create+load again, and the second load always fails. Since printing creates a
 * throwaway window per job, that made the *first* print work and every later
 * one fail with "could not render the document". `close()` runs the normal
 * shutdown path and does not trigger it.
 */
function disposeWindow(win: BrowserWindow): void {
  liveWindows.delete(win);
  // Drop the shared-window cache too. A window that has been `close()`d is not
  // yet `isDestroyed()`, so without this the next job would reuse a window that
  // is shutting down and its load would fail with ERR_FAILED before the retry
  // recovered it.
  if (sharedPrintWindow === win) sharedPrintWindow = null;
  if (win.isDestroyed()) return;
  win.close();
}

export function closeAllPrintWindows(): number {
  const n = liveWindows.size;
  for (const w of Array.from(liveWindows)) disposeWindow(w);
  return n;
}

// ═══════════════════════════════════════════════════════════════════
//  PRINTERS
// ═══════════════════════════════════════════════════════════════════

export type PrinterKey = 'receipt' | 'invoice' | 'label' | 'drawer';

export const PRINTER_SETTING_KEYS: Record<PrinterKey, string> = {
  receipt: 'receipt_printer',
  invoice: 'invoice_printer',
  label: 'label_printer',
  drawer: 'drawer_printer',
};

/** Physical paper actually loaded in each printer — this is a machine fact, not a template choice. */
export const PAPER_SETTING_KEYS: Record<'receipt' | 'invoice' | 'label', string> = {
  receipt: 'receipt_paper',
  invoice: 'invoice_paper',
  label: 'label_paper',
};

export const AUTO_PRINTER = 'auto';

/**
 * Explicit "print to whatever Windows currently has set as the default printer"
 * sentinel, resolved SILENTLY.
 *
 * `AUTO_PRINTER` still means "ask every time" (see `resolveTarget`), which is a
 * deliberate decision — auto-print must never silently hijack an unrelated
 * default device (a PDF printer, OneNote, …). This value is the owner opting IN
 * to the default device, chosen from Settings → Printers, so a till loaded with
 * one thermal printer can print with no dialog and no per-device config.
 */
export const DEFAULT_PRINTER = 'default';

export interface PrinterInfo {
  name: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  /** File-output / OneNote / fax-style software printers — they never print to paper. */
  isVirtual: boolean;
}

const VIRTUAL_NAME_RE =
  /xps|onedemo|onenote|print to pdf|microsoft pdf|one note|generic\s|class driver|fax\b|document writer/i;
const VIRTUAL_PORT_RE = /nul:|file:|portprompt:|local port/i;

let defaultPrinterCache = { name: '', at: 0 };
const DEFAULT_PRINTER_TTL_MS = 30_000;

/**
 * Windows' default printer via PowerShell. Cached, and only used to annotate the
 * Settings list — printing never silently targets it (see resolveTarget).
 */
async function getSystemDefaultPrinter(): Promise<string> {
  const now = Date.now();
  if (now - defaultPrinterCache.at < DEFAULT_PRINTER_TTL_MS) return defaultPrinterCache.name;
  return new Promise((resolve) => {
    const script = `Get-CimInstance Win32_Printer | Where-Object { $_.Default -eq $true } | Select-Object -First 1 -ExpandProperty Name`;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 10000, windowsHide: true },
      (err, stdout) => {
        const name = err ? '' : String(stdout || '').trim();
        if (name) defaultPrinterCache = { name, at: Date.now() };
        resolve(name);
      }
    );
  });
}

let printerListCache: { list: PrinterInfo[]; at: number } = { list: [], at: 0 };
const PRINTER_LIST_TTL_MS = 15_000;

/** All installed printers, annotated. Used by the Settings UI and the calibration sheet. */
export async function getAvailablePrinters(force = false): Promise<PrinterInfo[]> {
  if (!force && Date.now() - printerListCache.at < PRINTER_LIST_TTL_MS && printerListCache.list.length) {
    return printerListCache.list;
  }
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    const raw = await win.webContents.getPrintersAsync();
    const sysDefault = await getSystemDefaultPrinter();
    const list = raw.map((p) => {
      const haystack = `${p.name} ${p.displayName ?? ''} ${p.description ?? ''}`;
      return {
        name: p.name,
        displayName: p.displayName || p.name,
        description: p.description || '',
        isDefault: !!sysDefault && p.name === sysDefault,
        isVirtual: VIRTUAL_NAME_RE.test(haystack) || VIRTUAL_PORT_RE.test(haystack),
      };
    });
    list.sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });
    printerListCache = { list, at: Date.now() };
    return list;
  } finally {
    disposeWindow(win);
  }
}

export function invalidatePrinterCache(): void {
  printerListCache = { list: [], at: 0 };
  defaultPrinterCache = { name: '', at: 0 };
}

function safeAdminSetting(key: string): string {
  try {
    return (getAllAdminSettings()[key] || '').trim();
  } catch {
    return '';
  }
}

export function getConfiguredPrinter(key: PrinterKey): string {
  return safeAdminSetting(PRINTER_SETTING_KEYS[key]);
}

export function getConfiguredPaper(key: 'receipt' | 'invoice' | 'label'): string {
  return safeAdminSetting(PAPER_SETTING_KEYS[key]);
}

export function getLabelLayout(): LabelLayout {
  return safeAdminSetting('label_layout') === 'sheet' ? 'sheet' : 'roll';
}

export function getPrintMode(): 'silent' | 'dialog' {
  return safeAdminSetting('print_mode') === 'dialog' ? 'dialog' : 'silent';
}

/**
 * Label-printer head resolution used to make barcode bars land on whole dots.
 * 203dpi (8 dots/mm) is the common thermal label head; 300dpi is the other one
 * in the field. Stored as an admin setting so it can be set once per shop.
 */
export function getBarcodeDpi(): 203 | 300 {
  return Number(safeAdminSetting('barcode_dpi')) === 300 ? 300 : 203;
}

/** How many copies a receipt prints. 1 by default; clamped to a sane range. */
export function getReceiptCopies(): number {
  const raw = safeAdminSetting('receipt_copies');
  const n = raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.min(10, Math.floor(n)) : 1;
}

/**
 * Extra roll feed (mm) appended below the last line before the page — the
 * "cut margin". A thermal roll page IS the cut (the driver/cutter fires at the
 * page boundary), so this is the only place the pipeline can guarantee the
 * cutter never slices through the footer. `4` keeps the historical behaviour.
 */
export function getReceiptBottomFeedMm(): number {
  // NB: `safeAdminSetting` returns '' for a missing key, and Number('') is 0 —
  // treat an empty value as "unset" so the 4mm default actually applies.
  const raw = safeAdminSetting('receipt_bottom_feed_mm');
  const n = raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.min(30, n) : 4;
}

interface Target {
  silent: boolean;
  deviceName: string;
  reason: string;
}

/**
 * Printer resolution policy:
 *
 *  - `mode: 'dialog'` (or the admin `print_mode` = dialog) always shows the OS
 *    dialog, even when a printer is configured.
 *  - A printer explicitly chosen in Settings -> silent, straight to that printer.
 *  - No printer configured -> OS dialog, so the user always picks a real target.
 *
 * The app NEVER silently prints to the Windows default. On machines where that
 * default is a file-output printer (Microsoft XPS Document Writer, Print to PDF,
 * OneNote) silent printing produced a save-file prompt instead of a receipt —
 * and where the default was a `nul:`-port software printer the job vanished
 * entirely, which is what surfaced as random applications being opened.
 */
function resolveTarget(job: PrintJob): Target {
  const configured = (job.printerName || (job.printerKey ? getConfiguredPrinter(job.printerKey) : '') || '').trim();

  if (job.mode === 'dialog' || (job.mode !== 'silent' && getPrintMode() === 'dialog')) {
    return { silent: false, deviceName: '', reason: 'print mode set to show the print dialog' };
  }
  // Explicit opt-in to the OS default printer: silent, deviceName '' tells
  // Chromium to use the system default. Distinct from AUTO_PRINTER ("ask").
  if (configured === DEFAULT_PRINTER) {
    return { silent: true, deviceName: '', reason: 'printing to the system default printer' };
  }
  if (configured && configured !== AUTO_PRINTER) {
    return { silent: true, deviceName: configured, reason: `printing to "${configured}"` };
  }
  return {
    silent: false,
    deviceName: '',
    reason: 'no printer configured — choose one in Settings, or pick one in the print dialog',
  };
}

// ═══════════════════════════════════════════════════════════════════
//  PRINT JOB
// ═══════════════════════════════════════════════════════════════════

export interface PrintJob {
  html: string;
  paper: PaperOrLabel;
  /** Label batches only. */
  labelLayout?: LabelLayout;
  /** Label batches only: columns laid across a ROLL (default 1). */
  labelCols?: number;
  /** Label batches only: 1-based cell where the first label starts (skip a half-used row). */
  labelStartPos?: number;
  /** Label batches only: how many rows the roll must hold. */
  labelRows?: number;
  copies?: number;
  mode?: 'auto' | 'dialog' | 'silent';
  /** Which configured printer to use. */
  printerKey?: PrinterKey;
  /** Overrides the configured printer for this job only. */
  printerName?: string;
  jobName?: string;
  /** Non-fatal problems worth surfacing to the user. */
  warnings?: string[];
}

export interface PrintResult {
  ok: boolean;
  message: string;
}

/** On-screen width (px) that matches the real printed content width. */
function previewWidthPx(job: PrintJob): number {
  if (isLabelSize(job.paper)) {
    return job.labelLayout === 'sheet'
      ? mmToPx(190)
      : mmToPx(rollPageWidthMm(job.paper, rollColsFor(job)));
  }
  return mmToPx(PAPER_SPECS[job.paper].contentMm);
}

function newPrintWindow(widthPx: number, heightPx: number): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    // The floor must stay at or below the narrowest printable width (48mm ≈
    // 181px): the hidden measuring window has to be EXACTLY as wide as the
    // receipt body, or the body's `margin:0 auto` shifts and the layout audit
    // (which compares against an absolute contentMm limit) reports a false
    // clip. 120px is just a sane minimum for the empty window.
    width: Math.max(120, Math.round(widthPx)),
    height: Math.max(200, Math.round(heightPx)),
    useContentSize: true,
    webPreferences: { sandbox: true, javascript: true },
  });
  win.webContents.setBackgroundThrottling(false);
  return trackWindow(win);
}

/**
 * A single hidden window is reused for every silent print and PDF render.
 *
 * Creating a throwaway BrowserWindow per job looks tidy but is broken on
 * Electron 43 / Windows: once the previous window is gone, the next
 * `loadFile` fails with `ERR_FAILED (-2)`. Verified in isolation —
 * create+load, then create+load again, and the second load always fails,
 * whether the first window was `destroy()`ed or `close()`d. Reusing one window
 * never reproduced it, and it also avoids the window churn per sale.
 */
let sharedPrintWindow: BrowserWindow | null = null;
let printQueue: Promise<unknown> = Promise.resolve();

function getPrintWindow(widthPx: number, heightPx: number): BrowserWindow {
  if (sharedPrintWindow && !sharedPrintWindow.isDestroyed()) {
    try {
      // Stays hidden: only setContentSize, never show(). Must mirror
      // newPrintWindow's floor (120) so the measuring viewport stays the exact
      // printable width — see newPrintWindow above.
      sharedPrintWindow.setContentSize(
        Math.max(120, Math.round(widthPx)),
        Math.max(200, Math.round(heightPx))
      );
      return sharedPrintWindow;
    } catch {
      sharedPrintWindow = null;
    }
  }
  sharedPrintWindow = newPrintWindow(widthPx, heightPx);
  return sharedPrintWindow;
}

/** Serialise render+print so two jobs can never fight over the shared window. */
function withPrintWindow<T>(widthPx: number, heightPx: number, fn: (win: BrowserWindow) => Promise<T>): Promise<T> {
  const run = printQueue.then(
    () => fn(getPrintWindow(widthPx, heightPx)),
    () => fn(getPrintWindow(widthPx, heightPx))
  );
  printQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** Re-stamp the page rule so preview and print agree, then load. */
function withPageRule(html: string, widthMm: number, heightMm: number): string {
  const rule = `@page { size: ${widthMm}mm ${Math.max(10, Math.round(heightMm))}mm; margin: 0; }`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `<style id="__pos-page">${rule}</style></head>`);
  return `<style id="__pos-page">${rule}</style>` + html;
}

/**
 * Chromium refuses to navigate to a `data:` URL past a few hundred KB, and a
 * real receipt/invoice/label batch can exceed that — it fails with
 * `ERR_FAILED (-2)`, which surfaced as an intermittent "could not render the
 * document" print failure. Writing to a temp file and using loadFile() removes
 * the ceiling entirely.
 */
let docSeq = 0;
const docDir = path.join(os.tmpdir(), 'rokar-print-docs');
const docFiles: string[] = [];
let docCleanupHooked = false;

/** Remove the scratch files on the way out; a crash just leaves them in temp. */
function hookDocCleanup(): void {
  if (docCleanupHooked) return;
  docCleanupHooked = true;
  const sweep = () => {
    while (docFiles.length) {
      const f = docFiles.pop();
      if (f) fs.promises.unlink(f).catch(() => undefined);
    }
  };
  process.once('exit', sweep);
  app.once('will-quit', sweep);
}

async function loadDocument(win: BrowserWindow, job: PrintJob, heightMm: number): Promise<void> {
  const doc = withPageRule(job.html, jobWidthMm(job), heightMm);
  hookDocCleanup();
  const file = path.join(docDir, `doc-${process.pid}-${++docSeq}.html`);
  fs.mkdirSync(docDir, { recursive: true });
  fs.writeFileSync(file, doc, 'utf8');
  docFiles.push(file);
  // Deliberately NOT deleted here: unlinking straight after loadFile() races
  // Chromium's own file read and makes the next load fail with ERR_FAILED.
  try {
    await win.loadFile(file);
  } catch (e) {
    // Last-resort recovery: a poisoned renderer only heals with a fresh
    // process, so throw the window away and let the caller retry once.
    if (sharedPrintWindow === win) {
      log('print window load failed; recycling the hidden print window');
      sharedPrintWindow = null;
      disposeWindow(win);
    }
    throw e;
  }
  // Make sure any barcode/logo <img> has decoded before we measure or print.
  await win.webContents
    .executeJavaScript(
      `Promise.all(Array.from(document.images).map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })))`
    )
    .catch(() => undefined);
}

/**
 * Replace the page rule with the final measured size. The rule seeded before
 * load is only a placeholder for roll media, and drivers that honour CSS over
 * the `pageSize` option (and every printToPDF path) would otherwise cut the
 * receipt at the placeholder height.
 */
async function stampPageSize(win: BrowserWindow, job: PrintJob, heightMm: number): Promise<void> {
  const rule = `@page { size: ${jobWidthMm(job)}mm ${Math.max(10, Math.round(heightMm))}mm; margin: 0; }`;
  await win.webContents
    .executeJavaScript(
      `(() => {
         const s = document.getElementById('__pos-page') || document.createElement('style');
         s.id = '__pos-page';
         s.textContent = ${JSON.stringify(rule)};
         if (!s.parentNode) document.head.appendChild(s);
       })()`
    )
    .catch(() => undefined);
}

/**
 * Read the rendered content height in CSS px.
 *
 * Deliberately NOT documentElement.scrollHeight: the root element is at least
 * as tall as the viewport, so that measurement just returns the window height
 * and every receipt would ask the printer for a full window of blank paper.
 * body's border box is its content height in normal flow, which is what the
 * cutter needs to know.
 */
async function measureContentHeightPx(win: BrowserWindow): Promise<number> {
  try {
    const px = await win.webContents.executeJavaScript(
      `(() => {
         const b = document.body;
         if (!b) return 0;
         const r = b.getBoundingClientRect();
         const cs = getComputedStyle(b);
         const m = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
         return r.height + m(cs.marginTop) + m(cs.marginBottom);
       })()`
    );
    return typeof px === 'number' && Number.isFinite(px) && px > 0 ? px : 0;
  } catch {
    return 0;
  }
}

export const MIN_ROLL_HEIGHT_MM = 40;
const MAX_ROLL_HEIGHT_MM = 2000;

export interface PageGeometry {
  pageSize: { width: number; height: number };
  widthMm: number;
  heightMm: number;
}

/**
 * Geometry for papers whose size is fully known up front (all sheet media and
 * every label layout). No window access, no round trip.
 */
function geometryFromSpec(job: PrintJob): PageGeometry | null {
  const paper = job.paper;

  if (isLabelSize(paper)) {
    const spec = LABEL_SPECS[paper];
    if (job.labelLayout === 'sheet') {
      const heightMm = PAPER_SPECS.a4.fixedHeightMm ?? 297;
      return { pageSize: { width: mmToMicrons(210), height: mmToMicrons(heightMm) }, widthMm: 210, heightMm };
    }
    // Roll media: page height must be an exact multiple of the label pitch or
    // the printer mis-feeds between labels. A multi-across roll widens the page.
    const rows = Math.max(1, Math.floor(job.labelRows || 1));
    const heightMm = rows * spec.h + (rows + 1) * spec.gap;
    const widthMm = rollPageWidthMm(paper, rollColsFor(job));
    return { pageSize: { width: mmToMicrons(widthMm), height: mmToMicrons(heightMm) }, widthMm, heightMm };
  }

  const spec = PAPER_SPECS[paper];
  if (spec.fixedHeightMm) {
    return {
      pageSize: { width: mmToMicrons(spec.widthMm), height: mmToMicrons(spec.fixedHeightMm) },
      widthMm: spec.widthMm,
      heightMm: spec.fixedHeightMm,
    };
  }
  return null; // roll media — must be measured
}

async function resolveGeometry(win: BrowserWindow, job: PrintJob): Promise<PageGeometry> {
  const known = geometryFromSpec(job);
  if (known) return known;

  // geometryFromSpec only returns null for roll media.
  const paper = job.paper;
  if (isLabelSize(paper)) throw new Error(`Label geometry should have been pre-computed for ${paper}`);
  const spec = PAPER_SPECS[paper];
  // Roll media: measure so the cut lands right after the last line of text.
  const px = await measureContentHeightPx(win);
  const measured = px > 0 ? pxToMm(px) : MIN_ROLL_HEIGHT_MM;
  // Keep the page PORTRAIT. If the measured height were ever shorter than the
  // paper width, the driver treats the page as landscape and rotates it 90° on
  // the roll. A one-item receipt can be ~70mm tall, so the floor is width + 2mm
  // (a real receipt is always taller than this, so it costs no blank paper).
  const portraitFloor = spec.widthMm + 2;
  // The trailing feed is the cut margin: the page ends here, and the printer's
  // auto-cutter fires at the page boundary. `receipt_bottom_feed_mm` (default 4)
  // gives the cutter room so it never slices the footer.
  const heightMm = Math.min(
    MAX_ROLL_HEIGHT_MM,
    Math.max(MIN_ROLL_HEIGHT_MM, portraitFloor, Math.ceil(measured) + getReceiptBottomFeedMm())
  );
  return {
    pageSize: { width: mmToMicrons(spec.widthMm), height: mmToMicrons(heightMm) },
    widthMm: spec.widthMm,
    heightMm,
  };
}

const SILENT_PRINT_TIMEOUT_MS = 30_000;

function runPrint(win: BrowserWindow, job: PrintJob, geo: PageGeometry, target: Target): Promise<PrintResult> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    // If the user closes the print dialog the print callback never fires, so
    // resolve here instead of hanging the renderer. The listener is removed on
    // settle: the shared print window is long-lived, so leaving one per job
    // would pile up and trip the max-listeners warning after ~10 sales.
    const onClosed = () => finish({ ok: false, message: 'Print cancelled.' });
    win.once('closed', onClosed);

    const finish = (r: PrintResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (!win.isDestroyed()) win.removeListener('closed', onClosed);
      resolve(r);
    };

    /**
     * Once we stop waiting on the silent attempt we must drop its watchdog, or
     * it would fire later and open a *second* print dialog on top of the
     * fallback dialog the cashier is already looking at.
     */
    const clearWatchdog = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    // The watchdog is only useful for the silent attempt; a dialog is
    // user-driven and may legitimately stay open for a long time.
    const escalateToDialog = () => {
      clearWatchdog();
      invoke(false, '');
    };

    const label = job.jobName || 'Document';

    const invoke = (silent: boolean, deviceName: string) => {
      const options: Electron.WebContentsPrintOptions = {
        silent,
        printBackground: true,
        deviceName: deviceName || undefined,
        pageSize: geo.pageSize,
        margins: { marginType: 'none' },
        landscape: false,
        color: true,
        copies: job.copies && job.copies > 1 ? Math.floor(job.copies) : undefined,
      };
      try {
        win.webContents.print(options, (success, failureReason) => {
          if (success) {
            log(`print ok: ${label} -> ${silent ? deviceName || 'default' : 'dialog'} (${geo.widthMm}x${geo.heightMm}mm)`);
            finish({ ok: true, message: `${label} sent to printer.` });
            return;
          }
          const reason = failureReason || 'unknown error';
          if (silent) {
            // The configured printer may have gone offline. Fall back to the
            // dialog once so the cashier can still print.
            log(`silent print failed for ${label} (${reason}); falling back to the print dialog`);
            escalateToDialog();
            return;
          }
          log(`print failed: ${label} — ${reason}`);
          finish({ ok: false, message: `Print failed: ${reason}` });
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (silent) {
          escalateToDialog();
          return;
        }
        finish({ ok: false, message: `Print failed: ${msg}` });
      }
    };

    if (target.silent) {
      timer = setTimeout(() => {
        log(`silent print timed out for ${label} (${target.deviceName})`);
        escalateToDialog();
      }, SILENT_PRINT_TIMEOUT_MS);
    }

    log(`print job: ${label} ${geo.widthMm}x${geo.heightMm}mm — ${target.reason}`);
    invoke(target.silent, target.deviceName);
  });
}

/**
 * Load a job into the shared hidden window, measure it, then run `fn` with the
 * live window and the resolved geometry. Retries once with a fresh window,
 * because a poisoned renderer is only recoverable by replacing the window.
 */
async function renderJob<T>(
  job: PrintJob,
  fn: (win: BrowserWindow, geo: PageGeometry) => Promise<T>
): Promise<T> {
  const known = geometryFromSpec(job);
  const seedHeight = known ? known.heightMm : MIN_ROLL_HEIGHT_MM;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await withPrintWindow(previewWidthPx(job), 600, async (win) => {
        await loadDocument(win, job, seedHeight);
        const geo = known ?? (await resolveGeometry(win, job));
        await stampPageSize(win, job, geo.heightMm);
        return fn(win, geo);
      });
    } catch (e) {
      lastErr = e;
      log(`renderJob attempt ${attempt + 1} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw lastErr;
}

/** Render, size and print a document. This is the app's only print entry point. */
export async function printDocument(job: PrintJob): Promise<PrintResult> {
  const target = resolveTarget(job);
  try {
    const result = await renderJob(job, (win, geo) => runPrint(win, job, geo, target));
    if (job.warnings && job.warnings.length && result.ok) {
      return { ok: result.ok, message: `${result.message} ${job.warnings.join(' ')}` };
    }
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`printDocument failed: ${msg}`);
    return { ok: false, message: `Could not render the document for printing: ${msg}` };
  }
}

/**
 * Render a job to a PDF buffer using the same page geometry as
 * `printDocument`, without touching a printer. Used by scripts/print_smoke.js
 * to assert real output dimensions (58mm/80mm/A4) on machines with no thermal
 * printer attached.
 *
 * Note: on Electron 43 `printToPDF` throws "Failed to generate PDF: Printing
 * failed" for ANY explicit `pageSize` object, including A4 — only the CSS
 * `@page` rule is honoured. So this uses `preferCSSPageSize: true` and relies on
 * the `@page` rule `loadDocument` already stamps from the job's paper. This is
 * also why the CSS rule is load-bearing in production: it is the fallback if a
 * driver ignores the `pageSize` we pass to `webContents.print`.
 */
export async function printJobToPdf(job: PrintJob): Promise<{ data: Buffer; geometry: PageGeometry }> {
  return renderJob(job, async (win, geo) => {
    const data = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      landscape: false,
    });
    return { data, geometry: geo };
  });
}

/**
 * Render a job to a PNG image using the same page geometry as `printDocument`.
 * Gives the smoke test something it can actually LOOK at, so right-edge
 * clipping, barcode legibility and sheet alignment are verified visually and
 * not only by page-box arithmetic.
 */
export async function printJobToPng(job: PrintJob, filePath: string): Promise<PageGeometry> {
  return renderJob(job, async (win, geo) => {
    const mmToPx = 96 / 25.4;
    const target = { width: Math.ceil(geo.widthMm * mmToPx), height: Math.ceil(geo.heightMm * mmToPx) };
    const [w, h] = win.getSize();
    if (w !== target.width || h !== target.height) win.setContentSize(target.width, target.height);
    // Let the resize settle so the capture matches the final laid-out page.
    await new Promise((r) => setTimeout(r, 120));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(filePath, image.toPNG());
    return geo;
  });
}

/**
 * Read back the text the browser actually laid out for a job. Geometry checks
 * prove nothing is clipped, but they cannot notice that a field silently went
 * missing from the markup, so tests assert against this too.
 */
export async function readJobText(job: PrintJob): Promise<string> {
  return renderJob(job, async (win) => {
    const t = await win.webContents.executeJavaScript(
      'document.body ? document.body.innerText : ""',
      true
    );
    return String(t || '');
  });
}

export interface LayoutAudit {
  geometry: PageGeometry;
  /** Printable width the content is allowed to occupy, in mm. */
  limitMm: number;
  /** Document scroll size vs the viewport it was laid out in. */
  scrollWidth: number;
  clientWidth: number;
  /** Elements whose box escapes the printable width, worst first. */
  offenders: Array<{ tag: string; cls: string; text: string; overflowRight: number }>;
}

/**
 * Measure the laid-out page and report any element that escapes the printable
 * width. This is the check that actually catches the shop's complaint: text or a
 * barcode running off the right edge and being chopped by the printer. Page-box
 * arithmetic alone cannot see it, because the PDF is still a perfectly valid
 * 58mm page even when its content is clipped.
 *
 * Thermal rolls are compared against the PRINTABLE width (paper minus the
 * printer's hardware margin), not the paper width, because the driver clips
 * anything wider than the head can reach.
 */
export async function auditJobLayout(job: PrintJob): Promise<LayoutAudit> {
  return renderJob(job, async (win, geo) => {
    const limitMm =
      job.paper === 'thermal58' || job.paper === 'thermal80' ? PAPER_SPECS[job.paper].contentMm : geo.widthMm;
    const limitPx = (limitMm * 96) / 25.4;
    const raw = await win.webContents.executeJavaScript(`
      (() => {
        const de = document.documentElement;
        const limit = ${limitPx};
        const out = [];
        for (const el of document.body.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          const or = r.right - limit;
          if (or > 1) {
            out.push({
              tag: el.tagName.toLowerCase(),
              cls: String(el.className || '').slice(0, 40),
              text: String(el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40),
              or: Math.round(or)
            });
          }
        }
        return { sw: de.scrollWidth, cw: de.clientWidth, offenders: out.slice(0, 12) };
      })()
    `, true);
    const offenders: LayoutAudit['offenders'] = (raw.offenders || [])
      .map((o: { tag: string; cls: string; text: string; or: number }) => ({
        tag: o.tag,
        cls: o.cls,
        text: o.text,
        overflowRight: o.or,
      }))
      .sort((a: { overflowRight: number }, b: { overflowRight: number }) => b.overflowRight - a.overflowRight);
    return {
      geometry: geo,
      limitMm,
      scrollWidth: raw.sw,
      clientWidth: raw.cw,
      offenders,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════
//  PREVIEW
// ═══════════════════════════════════════════════════════════════════
/**
 * Preview windows print through the SAME pipeline as "Print" rather than
 * calling `window.print()` in a sandboxed renderer (which Electron cannot do).
 * The toolbar button fetches `posprint://print/<token>`, handled by
 * `registerPrintProtocol()`, so no preload or contextBridge is required.
 *
 * Phase 4 widens the window so the roll sits centred on a grey backdrop (a real
 * "sheet" preview instead of a web page), and adds Download PDF / WhatsApp share
 * beside Print, plus an Enter=print / Esc=close keyboard layer. Print and the
 * export both run the identical job through `printDocument` / `printJobToPdf`,
 * so what is previewed, printed and exported can never diverge.
 */
export const PRINT_SCHEME = 'posprint';

const previewJobs = new Map<string, PrintJob>();
const previewWindows = new Map<string, BrowserWindow>();
/** Sale behind a receipt preview — enables the WhatsApp share button. */
const previewSaleIds = new Map<string, number>();
let protocolRegistered = false;
let tokenSeq = 0;

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

export function registerPrintProtocol(): void {
  if (protocolRegistered) return;
  protocolRegistered = true;
  try {
    protocol.handle(PRINT_SCHEME, async (request) => {
      let host = '';
      let token = '';
      let params: URLSearchParams;
      try {
        const url = new URL(request.url);
        host = url.hostname;
        token = url.pathname.replace(/^\//, '');
        params = url.searchParams;
      } catch {
        return textResponse('bad request', 400);
      }

      if (host === 'close') {
        const w = previewWindows.get(token);
        if (w && !w.isDestroyed()) w.close();
        return textResponse('closed');
      }

      if (host === 'print') {
        const job = previewJobs.get(token);
        if (!job) return textResponse('Unknown print job.', 404);
        // The toolbar's copies box rides along on the query string.
        const copies = Math.floor(Number(params.get('copies')));
        const effective = Number.isFinite(copies) && copies > 0 ? { ...job, copies } : job;
        const res = await printDocument(effective);
        return textResponse(res.message);
      }

      if (host === 'pdf') {
        const job = previewJobs.get(token);
        if (!job) return textResponse('Unknown print job.', 404);
        try {
          const { data } = await printJobToPdf(job);
          const base = (job.jobName || 'document').replace(/[^\w.-]+/g, '_');
          const parent = previewWindows.get(token);
          const options = {
            title: 'Save PDF',
            defaultPath: `${base}.pdf`,
            filters: [{ name: 'PDF document', extensions: ['pdf'] }],
          };
          const result =
            parent && !parent.isDestroyed()
              ? await dialog.showSaveDialog(parent, options)
              : await dialog.showSaveDialog(options);
          if (result.canceled || !result.filePath) return textResponse('PDF download cancelled.');
          fs.writeFileSync(result.filePath, data);
          log(`preview PDF written: ${result.filePath}`);
          return textResponse(`Saved PDF: ${result.filePath}`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          log(`preview PDF failed: ${msg}`);
          return textResponse(`Could not create the PDF: ${msg}`, 500);
        }
      }

      if (host === 'share') {
        const saleId = previewSaleIds.get(token);
        if (!saleId) return textResponse('This preview cannot be shared on WhatsApp.', 404);
        try {
          // Dynamic import: whatsapp-gateway pulls in the client + print stack,
          // and printing.ts imports this module — keep it off the static graph.
          const { sendSaleReceiptOnWhatsApp } = await import('../whatsapp-gateway');
          const res = await sendSaleReceiptOnWhatsApp(saleId);
          return textResponse(res.message);
        } catch (e) {
          return textResponse(`WhatsApp share failed: ${e instanceof Error ? e.message : String(e)}`, 500);
        }
      }

      return textResponse('unknown action', 404);
    });
    log('print preview protocol registered (posprint://)');
  } catch (e) {
    log(`failed to register posprint protocol: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Toolbar injected into every preview window. Written with plain string
 * concatenation (no backticks / `${}`) because it is itself embedded in a
 * template literal by `injectToolbar`.
 */
const TOOLBAR_JS = `
(() => {
  const TOKEN = __TOKEN__;
  const PRINT_LABEL = __PRINT_LABEL__;
  const SHOW_PDF = __SHOW_PDF__;
  const SHOW_SHARE = __SHOW_SHARE__;
  const COPIES = __COPIES__;
  const bar = document.createElement('div');
  bar.id = '__posbar';
  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = __META__;
  bar.appendChild(meta);
  const busy = { on: false };
  const call = (url, btn, workingLabel) => {
    if (busy.on) return;
    busy.on = true;
    const original = btn.textContent;
    btn.disabled = true;
    if (workingLabel) btn.textContent = workingLabel;
    fetch(url)
      .then((r) => r.text())
      .then((t) => { meta.textContent = t; })
      .catch((err) => { meta.textContent = 'Error: ' + err; })
      .finally(() => { busy.on = false; btn.disabled = false; btn.textContent = original; });
  };
  const copiesBox = document.createElement('input');
  copiesBox.id = '__poscopies';
  copiesBox.type = 'number';
  copiesBox.min = '1';
  copiesBox.max = '10';
  copiesBox.value = String(COPIES || 1);
  copiesBox.title = 'Number of copies';
  bar.appendChild(copiesBox);
  const go = document.createElement('button');
  go.className = 'go';
  go.textContent = PRINT_LABEL;
  go.onclick = () => {
    const n = Math.max(1, Math.min(10, parseInt(copiesBox.value, 10) || 1));
    call('posprint://print/' + TOKEN + '?copies=' + n, go, 'Printing…');
  };
  bar.appendChild(go);
  if (SHOW_PDF) {
    const pdf = document.createElement('button');
    pdf.className = 'alt';
    pdf.textContent = 'Download PDF';
    pdf.onclick = () => call('posprint://pdf/' + TOKEN, pdf, 'Saving…');
    bar.appendChild(pdf);
  }
  if (SHOW_SHARE) {
    const share = document.createElement('button');
    share.className = 'alt';
    share.textContent = 'WhatsApp';
    share.onclick = () => call('posprint://share/' + TOKEN, share, 'Sending…');
    bar.appendChild(share);
  }
  const x = document.createElement('button');
  x.className = 'x';
  x.textContent = 'Close';
  x.onclick = () => { fetch('posprint://close/' + TOKEN).catch(() => {}); };
  bar.appendChild(x);
  document.body.appendChild(bar);
  document.body.style.paddingTop = '46px';
  // Enter = print, Esc = close — unless a control already has focus, so the
  // copies box and the buttons keep their native Enter behaviour.
  document.addEventListener('keydown', (e) => {
    const t = e.target || {};
    const isField = t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON';
    if (e.key === 'Escape') { e.preventDefault(); x.click(); return; }
    if ((e.key === 'Enter' || e.key === '\\r') && !isField) { e.preventDefault(); go.click(); }
  });
})();
`;

const TOOLBAR_CSS = `
#__posbar { position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
  display: flex; gap: 8px; align-items: center; padding: 8px 12px;
  background: #0f172a; color: #fff; font: 600 13px "Segoe UI", Arial, sans-serif;
  box-shadow: 0 2px 8px rgba(0,0,0,.4); }
#__posbar .meta { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-weight: 400; font-size: 12px; opacity: .85; }
#__posbar button { padding: 6px 16px; border: none; border-radius: 4px; cursor: pointer;
  font: 600 13px "Segoe UI", Arial, sans-serif; }
#__posbar .go { background: #2563eb; color: #fff; }
#__posbar .alt { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; }
#__posbar .x { background: #334155; color: #fff; }
#__posbar button[disabled] { background: #475569; cursor: progress; }
#__posbar #__poscopies { width: 52px; padding: 5px 6px; border-radius: 4px; border: 1px solid #334155;
  background: #0b1220; color: #fff; font: 600 13px "Segoe UI", Arial, sans-serif; }
/* The paper sits centred on a grey backdrop so the roll reads as a sheet, not a
   web page. Preview only — printing re-renders the job in its own window. */
html { background: #e5e7eb; }
body { background: #fff; box-shadow: 0 1px 8px rgba(0,0,0,.35); }
@media print { #__posbar { display: none !important; } body { padding-top: 0 !important; } }
`;

function injectToolbar(
  win: BrowserWindow,
  token: string,
  meta: string,
  opts: { printLabel: string; showPdf: boolean; showShare: boolean; copies: number }
): void {
  const js = TOOLBAR_JS
    .replace(/__TOKEN__/g, JSON.stringify(token))
    .replace(/__META__/g, JSON.stringify(meta))
    .replace(/__PRINT_LABEL__/g, JSON.stringify(opts.printLabel))
    .replace(/__SHOW_PDF__/g, opts.showPdf ? 'true' : 'false')
    .replace(/__SHOW_SHARE__/g, opts.showShare ? 'true' : 'false')
    .replace(/__COPIES__/g, String(Math.max(1, Math.floor(opts.copies) || 1)));
  win.webContents
    .executeJavaScript(`(() => {
      const s = document.createElement('style');
      s.textContent = ${JSON.stringify(TOOLBAR_CSS)};
      document.head.appendChild(s);
      ${js}
    })()`)
    .catch((e) => log(`preview toolbar injection failed: ${String(e)}`));
}

export interface PreviewOptions {
  /** Shown in the preview toolbar. */
  title: string;
  printButtonLabel?: string;
  /** Sale behind a receipt preview — turns on the Download PDF + WhatsApp buttons. */
  saleId?: number;
  /** Offer the "Download PDF" button (default: on). */
  allowPdf?: boolean;
  /** Offer the "WhatsApp" share button (needs `saleId`; default: on). */
  allowShare?: boolean;
  /** Copies pre-filled in the toolbar. */
  copies?: number;
}

/** Open a true-to-paper preview whose Print button runs the real print pipeline. */
export async function previewDocument(job: PrintJob, opts: PreviewOptions): Promise<PrintResult> {
  registerPrintProtocol();

  // Widen the window so a receipt roll is a centred "sheet" on a grey backdrop
  // instead of a razor-thin strip filling the whole window.
  const paperPx = previewWidthPx(job);
  const winPx = Math.max(paperPx + 56, 480);
  const win = newPrintWindow(winPx, 700);
  win.setTitle(opts.title);
  const token = `p${++tokenSeq}-${Date.now()}`;
  previewJobs.set(token, job);
  previewWindows.set(token, win);
  if (opts.saleId) previewSaleIds.set(token, opts.saleId);
  win.once('closed', () => {
    previewJobs.delete(token);
    previewWindows.delete(token);
    previewSaleIds.delete(token);
  });

  try {
    const known = geometryFromSpec(job);
    await loadDocument(win, job, known ? known.heightMm : MIN_ROLL_HEIGHT_MM);
    const geo = known ?? (await resolveGeometry(win, job));
    await stampPageSize(win, job, geo.heightMm);

    // Match the real paper width and content height so the preview reads
    // exactly like the output, not like a generic 400x600 web page.
    win.setContentSize(
      Math.round(winPx),
      Math.max(300, Math.min(1600, Math.round(mmToPx(geo.heightMm)) + 46))
    );
    injectToolbar(win, token, `${opts.title} — ${geo.widthMm}mm wide`, {
      printLabel: opts.printButtonLabel || 'Print',
      showPdf: opts.allowPdf !== false,
      showShare: opts.allowShare !== false && !!opts.saleId,
      copies: opts.copies && opts.copies > 0 ? opts.copies : 1,
    });
    // The loaded document carries its own <title>Receipt</title>, which Chromium
    // pushes onto the window title. Re-assert ours AFTER the load so the window
    // is titled exactly as spec'd ("Receipt preview"), not "Receipt".
    win.setTitle(opts.title);
    // newPrintWindow is created hidden (hidden windows must stay hidden while
    // printing). A preview is user-facing, so it has to be shown explicitly —
    // otherwise the button appears to do nothing at all.
    win.show();
    win.focus();
    return { ok: true, message: 'Preview opened.' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    disposeWindow(win);
    previewJobs.delete(token);
    previewWindows.delete(token);
    return { ok: false, message: `Could not open the preview: ${msg}` };
  }
}

// ═══════════════════════════════════════════════════════════════════
//  CALIBRATION
// ═══════════════════════════════════════════════════════════════════

export async function printCalibration(
  paper: PaperKind,
  build: (widthMm: number, printerLabel: string) => string
): Promise<PrintResult> {
  const spec = PAPER_SPECS[paper];
  let printerLabel = 'unknown printer';
  const configured = getConfiguredPrinter('receipt');
  try {
    const list = await getAvailablePrinters();
    const match = configured && configured !== AUTO_PRINTER ? list.find((p) => p.name === configured) : list.find((p) => p.isDefault);
    printerLabel = match ? `${match.displayName}${match.isDefault ? ' (system default)' : ''}` : 'unknown printer';
  } catch {
    /* printer list unavailable — the sheet still prints */
  }
  return printDocument({
    html: build(spec.widthMm, printerLabel),
    paper,
    printerKey: 'receipt',
    jobName: `Calibration sheet (${spec.widthMm}mm)`,
  });
}
