// qrcode shim — the WhatsApp gateway lazily imports `qrcode` to turn the pairing
// QR into a data URL. The gateway is inert in a Worker, so this never runs; keep
// the export surface so a dynamic import resolves.
export async function toDataURL(): Promise<string> {
  return 'data:image/png;base64,';
}
export function toString(): string {
  return '';
}
export default { toDataURL, toString };
