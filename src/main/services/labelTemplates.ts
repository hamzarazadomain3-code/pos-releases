/**
 * Barcode label documents.
 *
 * Generated in the main process (not the renderer) for two reasons:
 *  - the renderer used to print with `window.print()`, which Electron cannot do;
 *  - the print pipeline owns the paper geometry, so the label must be built
 *    against the same label spec that is handed to the print job.
 *
 * All lengths are in mm/pt so the label is physically identical regardless of
 * the label printer's DPI.
 */
import { esc, toDataUrl, symbologyFor, todayLabel, fmtExpiryDate, printCurrency } from './printDocs';
import { LABEL_SPECS, type LabelLayout, type LabelSize } from './printService';

export interface LabelProduct {
  id: number;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  sale_price: number;
  expiry_date?: string | null;
}

export interface LabelBatch {
  html: string;
  /** Total label cells in the batch. */
  count: number;
  /** Columns used (1 for roll media). */
  cols: number;
  /** Rows the roll must hold, so the page can be an exact multiple of the pitch. */
  rows: number;
  size: LabelSize;
}

const barCache = new Map<string, string>();

async function barcodeFor(text: string, heightMm: number): Promise<string> {
  const bcid = symbologyFor(text);
  const key = `${bcid}|${text}|${heightMm}`;
  const hit = barCache.get(key);
  if (hit !== undefined) return hit;
  const png = await toDataUrl({
    bcid,
    text,
    // bwip-js works in dots at the printer's density; scale keeps the bar count
    // legible on small labels without overflowing the cell.
    scale: 2,
    height: 40,
    includetext: false,
    paddingwidth: 0,
    paddingheight: 0,
  });
  barCache.set(key, png);
  return png;
}

function money(currency: string, n: number): string {
  return `${currency} ${Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export async function buildLabelBatchHtml(
  products: LabelProduct[],
  size: LabelSize,
  layout: LabelLayout,
  copiesPerProduct: number,
  shopName: string,
  /** Barcode-only stickers: no product name, price or expiry. */
  barcodeOnly = false
): Promise<LabelBatch> {
  const spec = LABEL_SPECS[size];
  const currency = printCurrency();
  const copies = Math.max(1, Math.min(50, Math.floor(copiesPerProduct) || 1));

  // Expand the selection into individual label cells.
  const cells: LabelProduct[] = [];
  for (const p of products) {
    for (let i = 0; i < copies; i++) cells.push(p);
  }

  const cols = layout === 'sheet' ? spec.sheetCols : 1;
  const rows = Math.max(1, Math.ceil(cells.length / cols));
  const today = todayLabel();

  // Pre-render one barcode per distinct value (copies share the image).
  const barcodes = new Map<number, string>();
  for (const p of products) {
    const text = String(p.barcode || p.sku || p.id);
    barcodes.set(p.id, await barcodeFor(text, spec.barH));
  }

  const labels = cells
    .map((p) => {
      const text = String(p.barcode || p.sku || p.id);
      const png = barcodes.get(p.id) || '';
      const expiry = fmtExpiryDate(p.expiry_date);
      // Barcode-only sticker: shop name, barcode and the number, nothing else.
      if (barcodeOnly) {
        return `<div class="label label-bare">
  <div class="brand">${esc(shopName || '')}</div>
  <div class="code">${png ? `<img src="${png}" alt="" /><div class="num">${esc(text)}</div>` : `<div class="num">${esc(text)}</div>`}</div>
</div>`;
      }
      return `<div class="label">
  <div class="brand">${esc(shopName || '')}</div>
  <div class="name">${esc(p.name)}</div>
  <div class="code">${png ? `<img src="${png}" alt="" /><div class="num">${esc(text)}</div>` : `<div class="num">${esc(text)}</div>`}</div>
  <div class="foot"><span class="price">${esc(money(currency, p.sale_price))}</span>${expiry ? `<span class="exp">Exp ${esc(expiry)}</span>` : ''}</div>
  <div class="date">${today}</div>
</div>`;
    })
    .join('');

  const contentMm = layout === 'sheet' ? 190 : spec.w;

  const css = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: 'Segoe UI', Arial, sans-serif; color: #000; -webkit-print-color-adjust: exact; }
.sheet { display: grid; grid-template-columns: repeat(${cols}, ${spec.w}mm); gap: ${spec.gap}mm; justify-content: start; width: ${contentMm}mm; }
.label {
  width: ${spec.w}mm; height: ${spec.h}mm; overflow: hidden; page-break-inside: avoid;
  break-inside: avoid; border: 0.2mm solid #bbb; border-radius: 1mm;
  padding: 0.6mm 0.8mm; display: flex; flex-direction: column; align-items: center;
  justify-content: space-between; text-align: center; font-size: ${spec.fontPt}pt; line-height: 1.05;
}
.brand { font-size: ${(spec.fontPt * 0.72).toFixed(2)}pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.name { font-size: ${spec.fontPt}pt; font-weight: 700; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.code { display: flex; flex-direction: column; align-items: center; max-width: 100%; }
.code img { height: ${spec.barH}mm; width: auto; max-width: 100%; display: block; }
.num { font-family: 'Consolas', 'Courier New', monospace; font-size: ${(spec.fontPt * 0.8).toFixed(2)}pt; letter-spacing: 0.01em; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.foot { display: flex; justify-content: space-between; align-items: baseline; width: 100%; gap: 1mm; font-size: ${(spec.fontPt * 0.85).toFixed(2)}pt; font-weight: 700; }
.price { white-space: nowrap; }
.exp { color: #000; font-weight: 600; white-space: nowrap; }
.date { font-size: ${(spec.fontPt * 0.65).toFixed(2)}pt; color: #333; }
/* Barcode-only sticker: the barcode takes the whole label. */
.label-bare { padding: 0.8mm; }
.label-bare .code img { height: ${(spec.barH * 1.35).toFixed(1)}mm; }
`;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Barcode labels</title>
<style>${css}</style>
</head>
<body>
<div class="sheet">${labels}</div>
</body>
</html>`;

  return { html, count: cells.length, cols, rows, size };
}
