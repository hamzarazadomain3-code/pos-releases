// print-bridge — web printing for the cloud app.
//
// A browser cannot drive a printer the way Electron's hidden print window does,
// but it CAN print an HTML document. Every desktop print channel ultimately
// builds an HTML document from pure/DB-read-only helpers, so the worker's only
// job here is to hand that HTML back to the browser; `web/electron-browser.ts`
// then prints it with the browser's own dialog. No print logic is duplicated —
// the exact same builders the desktop's `src/main/ipc.ts` printing handlers call
// are called here, so the browser prints what the desktop would.
//
// The builders are imported through opaque `@desktop/*` specifiers so cloud tsc
// keeps its thin type boundary (see src/types/desktop-print.d.ts) and esbuild
// resolves them to the real service files (see scripts/build.mjs).

import {
  buildReceiptJob,
  buildInvoiceJob,
  buildLabelJob,
  buildDrawerSummaryHtml,
} from '@desktop/print';
import { buildCalibrationHtml } from '@desktop/printdocs';
import { buildLabelStudioJob, buildCalibrationLabelHtml } from '@desktop/labelstudio';

export interface WebPrintDocument {
  ok: boolean;
  /** The document to print. Present only when `ok` is true. */
  html?: string;
  /** Shown to the user; the browser keeps the real @page/@media print styling. */
  title?: string;
  /** Paper the document is meant for (informational). */
  paper?: string;
  message?: string;
}

/**
 * Full page width (mm) per paper kind. Only used for the print test sheet, whose
 * builder needs a width; the receipt/invoice/drawer builders embed their own.
 */
const PAPER_WIDTH_MM: Record<string, number> = {
  thermal58: 58,
  thermal80: 80,
  a4: 210,
  a5: 148,
};

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const ids = (v: unknown): number[] => (Array.isArray(v) ? v.map(num).filter((n) => n > 0) : []);
const copies = (v: unknown): number => {
  const n = Math.round(num(v));
  return n >= 1 ? Math.min(200, n) : 1;
};
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

const job = (j: { html: string; paper?: string }, title: string): WebPrintDocument => ({
  ok: true,
  html: j.html,
  title,
  paper: j.paper,
});

const unsupported = (message: string): WebPrintDocument => ({ ok: false, message });

/**
 * Build the HTML for one desktop `printing:*` channel. Mirrors the channel →
 * builder mapping in `src/main/ipc.ts` so the browser prints the same document.
 */
export async function buildPrintDocument(
  channel: string,
  args: unknown[]
): Promise<WebPrintDocument> {
  const a = Array.isArray(args) ? args : [];
  try {
    switch (channel) {
      case 'printing:printSale':
      case 'printing:previewReceipt':
        return job(buildReceiptJob(num(a[0]), a[1]), 'Receipt');

      case 'printing:printInvoice':
      case 'printing:previewInvoice':
        return job(buildInvoiceJob(num(a[0])), 'Invoice');

      case 'printing:printLabel':
        return job(await buildLabelJob([num(a[0])], undefined, copies(a[1])), 'Label');

      case 'printing:printBarcodeLabel':
        return job(
          await buildLabelJob([num(a[0])], undefined, copies(a[1]), undefined, true),
          'Barcode label'
        );

      case 'printing:printBarcodeBatch':
      case 'printing:previewBarcodeBatch':
        return job(await buildLabelJob(ids(a[0]), str(a[1]), copies(a[2])), 'Barcode labels');

      case 'printing:printBarcodeBatchWithOptions': {
        const options = (a[3] ?? {}) as { template?: unknown; run?: unknown };
        const built = options.template
          ? await buildLabelStudioJob(
              ids(a[0]),
              options.template,
              str(a[1]),
              copies(a[2]),
              options.run as never
            )
          : await buildLabelJob(ids(a[0]), str(a[1]), copies(a[2]));
        return job(built, 'Labels');
      }

      case 'printing:printCalibrationLabel':
        return {
          ok: true,
          html: buildCalibrationLabelHtml(str(a[0])),
          title: 'Label calibration',
        };

      case 'printing:printDrawerSummary':
        return {
          ok: true,
          html: buildDrawerSummaryHtml((a[0] ?? {}) as never),
          title: 'Cash drawer summary',
        };

      case 'printing:printTestSheet': {
        const paper = str(a[0]) ?? 'thermal80';
        const widthMm = PAPER_WIDTH_MM[paper] ?? 80;
        return {
          ok: true,
          html: buildCalibrationHtml(widthMm, 'Browser printing'),
          title: 'Print test sheet',
          paper,
        };
      }

      case 'printing:openCashDrawer':
        return unsupported(
          'A cash drawer cannot be pulsed from the web app — connect it to a desktop till.'
        );

      case 'printing:exportLabelBatchToPDF':
      case 'printing:exportLabelBatchToPNG':
        return unsupported(
          'File export needs the desktop app — in the browser use Print → “Save as PDF”.'
        );

      default:
        return unsupported(`Printing channel “${channel}” is not available in the web app.`);
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
