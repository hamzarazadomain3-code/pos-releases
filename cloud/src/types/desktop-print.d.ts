// Typecheck-only ambient shims for the desktop print builders the cloud print
// bridge imports *through virtual specifiers* (`@desktop/print*`). esbuild
// resolves those specifiers to the real service files (see the alias plugin in
// scripts/build.mjs), but cloud tsc must NOT follow into printService.ts — it
// imports Electron's BrowserWindow, which the cloud has no types for. Declaring
// the modules here keeps the type boundary at the builders we actually call.
//
// Keep in sync with the real signatures in
// src/main/services/{printing,printDocs,labelStudioPrinting}.ts.

declare module '@desktop/print' {
  export interface PrintJob {
    html: string;
    paper: string;
    jobName?: string;
  }
  /** Pure (DB-read only): build the thermal receipt document. */
  export function buildReceiptJob(saleId: number, template?: unknown): PrintJob;
  /** Pure (DB-read only): build the A4/A5 invoice document. */
  export function buildInvoiceJob(saleId: number): PrintJob;
  /** Async (DB-read only): build a batch of barcode labels. */
  export function buildLabelJob(
    productIds: number[],
    size?: string,
    copies?: number,
    layoutOverride?: 'roll' | 'sheet',
    barcodeOnly?: boolean
  ): Promise<PrintJob>;
  /** Pure (DB-read only): the cash-drawer summary document. */
  export function buildDrawerSummaryHtml(data: unknown): string;
}

declare module '@desktop/printdocs' {
  /** Pure: the paper-size calibration sheet document for a given width. */
  export function buildCalibrationHtml(paperWidthMm: number, printerLabel: string): string;
}

declare module '@desktop/labelstudio' {
  export interface PrintJob {
    html: string;
    paper: string;
    jobName?: string;
  }
  /** Async (DB-read only): build a batch from a user-drawn label template. */
  export function buildLabelStudioJob(
    productIds: number[],
    template: unknown,
    size?: string,
    copies?: number,
    run?: unknown
  ): Promise<PrintJob>;
  /** Pure: the label-sized calibration sheet document. */
  export function buildCalibrationLabelHtml(size?: string): string;
}
