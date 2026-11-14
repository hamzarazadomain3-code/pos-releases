/**
 * Binary file transfer between the renderer and the main process.
 *
 * The desktop app hands bytes over Electron IPC, where a `Uint8Array` survives
 * as a `Uint8Array`. The **web** app does not: `cloud/web/electron-browser.ts`
 * posts `JSON.stringify({ channel, args })` to `/api/rpc`, so a `Uint8Array`
 * arrives on the server as a plain object (`{"0":72,"1":105,...}`) — which is
 * exactly what made `Buffer.from(data)` throw
 *
 *   "The first argument must be of type string or an instance of Buffer, …"
 *
 * So the renderer sends the file as a **base64 string** (a plain JSON string
 * survives every transport unchanged) and the main process normalises whatever
 * it receives back into bytes.
 *
 * The prefix makes the encoding explicit, so a payload that is *not* base64
 * (a raw CSV text, say) can never be silently mis-read.
 */

/** Marks a string payload as base64-encoded bytes. */
export const BASE64_PREFIX = 'base64:';

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encode bytes as standard base64 (no line breaks). Pure — no platform APIs. */
export function encodeBytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += B64_ALPHABET[(n >> 18) & 63];
    out += B64_ALPHABET[(n >> 12) & 63];
    out += i + 1 < len ? B64_ALPHABET[(n >> 6) & 63] : '=';
    out += i + 2 < len ? B64_ALPHABET[n & 63] : '=';
  }
  return out;
}

/** Decode standard base64 to bytes. Returns `null` when the text is not base64. */
export function decodeBase64ToBytes(text: string): Uint8Array | null {
  const clean = text.replace(/[\r\n\t ]/g, '');
  if (!clean.length) return new Uint8Array(0);
  const body = clean.endsWith('==') ? clean.slice(0, -2) : clean.endsWith('=') ? clean.slice(0, -1) : clean;
  if (!body.length) return new Uint8Array(0);
  const out = new Uint8Array(Math.floor((body.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let p = 0;
  for (let i = 0; i < body.length; i++) {
    const v = B64_ALPHABET.indexOf(body[i]);
    if (v < 0) return null;
    acc = ((acc << 6) | v) & 0x1fff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, p);
}

/** Wrap bytes as the string payload the renderer sends over IPC / HTTP. */
export function toBase64Payload(bytes: Uint8Array): string {
  return BASE64_PREFIX + encodeBytesToBase64(bytes);
}

/**
 * Turn whatever the transport delivered back into bytes.
 *
 * Handles every shape a file payload can arrive as:
 *  - `Uint8Array` / `Buffer`      — the desktop Electron IPC path
 *  - `ArrayBuffer` / a typed view  — a structured-clone transport
 *  - a base64 string with the `base64:` prefix — the web JSON path
 *  - a number array                — a JSON array of byte values
 *  - `{ type: 'Buffer', data: [...] }` — a Node Buffer after JSON.stringify
 *  - a plain object with numeric keys — `JSON.parse(JSON.stringify(bytes))`,
 *    i.e. the Uint8Array the **web** transport produces
 *
 * Returns `null` for a payload that cannot be read as bytes.
 */
export function normalizeBinaryPayload(payload: unknown): Uint8Array | null {
  if (payload === null || payload === undefined) return null;
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (ArrayBuffer.isView(payload)) {
    const view = payload as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (typeof payload === 'string') {
    if (payload.startsWith(BASE64_PREFIX)) return decodeBase64ToBytes(payload.slice(BASE64_PREFIX.length));
    // A raw text file (CSV) — every code point becomes one byte.
    const out = new Uint8Array(payload.length);
    for (let i = 0; i < payload.length; i++) out[i] = payload.charCodeAt(i) & 0xff;
    return out;
  }
  if (Array.isArray(payload)) {
    const out = new Uint8Array(payload.length);
    for (let i = 0; i < payload.length; i++) out[i] = Number(payload[i]) & 0xff;
    return out;
  }
  if (typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    // A Node Buffer stringifies to `{ type: 'Buffer', data: [...] }`.
    if (obj.type === 'Buffer' && (Array.isArray(obj.data) || ArrayBuffer.isView(obj.data))) {
      return normalizeBinaryPayload(obj.data);
    }
    const keys = Object.keys(obj);
    if (!keys.length) return new Uint8Array(0);
    const len = typeof obj.length === 'number' ? obj.length : keys.length;
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = Number(obj[i]) & 0xff;
    return out;
  }
  return null;
}

/**
 * The bytes carried by a file-transfer result, or `null` when the result is not
 * a byte payload.
 *
 * A file export answers with:
 *  - `true`                  — the desktop wrote the file (native save dialog)
 *  - a file path             — the desktop wrote the file and reports where
 *  - a base64 payload string — the web build, which has no file system
 */
export function fileBytesFromResult(result: unknown): Uint8Array | null {
  if (result === null || result === undefined) return null;
  if (typeof result === 'boolean' || typeof result === 'number') return null;
  if (typeof result === 'string') {
    // A plain string without the prefix is a file path, not bytes.
    return result.startsWith(BASE64_PREFIX) ? normalizeBinaryPayload(result) : null;
  }
  return normalizeBinaryPayload(result);
}
