// bwip-js shim — `printDocs.ts` rasterises barcodes/QR codes with bwip-js'
// ASYNC `toBuffer(options, callback)`. A Worker has no native rasteriser, but the
// shim MUST still invoke the callback: `printDocs.toDataUrl` wraps `toBuffer` in a
// Promise that only settles inside that callback, so returning silently would hang
// every barcode job forever (it did — label printing froze the web app).
//
// Resolving with no buffer makes `toDataUrl` resolve to '', so the label document
// is still built (name, price and the human-readable number); the browser then
// draws the real barcode images client-side with jsbarcode (see
// web/electron-browser.ts). Real rasterisation stays a desktop-only capability.
type BarcodeCallback = (err: Error | null, buffer?: null) => void;

export function toBuffer(options?: unknown, callback?: unknown): null {
  const cb = (typeof options === 'function' ? options : callback) as
    | ((err: Error | null, buffer?: null) => void)
    | undefined;
  if (typeof cb === 'function') cb(null, null);
  return null;
}
export function toCanvas(): void {}
export function toSVG(): string {
  return '';
}
export default { toBuffer, toCanvas, toSVG };
