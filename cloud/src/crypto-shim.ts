// crypto-shim — byte-compatible replacements for the `node:crypto` exports the
// real services + migrations use, built on noble-hashes (pure JS, no Node).
//
// esbuild aliases every `crypto` / `node:crypto` import (services + the 3
// migrations that require it) to this module.
//
//   scryptSync      -> noble `scrypt` at the node default parameters
//                      { N: 16384, r: 8, p: 1, dkLen } — byte-compatible with
//                      node's scryptSync (verified against node outputs).
//   timingSafeEqual -> constant-time byte compare.
//   randomBytes     -> crypto.getRandomValues (returns Buf).
//   randomUUID      -> global crypto.randomUUID() (workerd provides it).
//
// The returned `Buf extends Uint8Array` gains `.toString('hex'|'base64')` so the
// desktop code's `scryptSync(...).toString('hex')` / `randomBytes(n).toString('hex')`
// patterns keep working. `Buffer` itself is the workerd global (nodejs_compat),
// so `Buffer.from(hex, 'hex')` in the real auth code resolves at runtime.

import { scrypt } from '@noble/hashes/scrypt';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';

export class Buf extends Uint8Array {
  toString(encoding: 'hex' | 'base64' | 'utf8' | string = 'utf8'): string {
    if (encoding === 'hex') {
      let hex = '';
      for (let i = 0; i < this.length; i++) {
        hex += (this[i]! & 0xff).toString(16).padStart(2, '0');
      }
      return hex;
    }
    if (encoding === 'base64') {
      let binary = '';
      for (let i = 0; i < this.length; i++) {
        binary += String.fromCharCode(this[i]!);
      }
      return btoa(binary);
    }
    return new TextDecoder().decode(this);
  }
}

export function scryptSync(
  password: string | Uint8Array,
  salt: string | Uint8Array,
  keylen: number,
  _options?: { N?: number; r?: number; p?: number; maxmem?: number }
): Buf {
  const bytes = scrypt(password, salt, {
    N: 16384,
    r: 8,
    p: 1,
    dkLen: keylen,
  });
  return new Buf(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
}

/** Constant-time comparison (timingSafeEqual). Assumes equal length; false otherwise. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

export function randomBytes(size: number): Buf {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return new Buf(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
}

export function randomUUID(): string {
  return crypto.randomUUID();
}

/**
 * `createHmac('sha256', key)` — used by `recovery.ts` for support/owner codes.
 * Mirrors node's chained `Hmac`: `update(data, encoding?)` returns the instance,
 * `digest(encoding?)` returns a Buffer (Buf) or, when an encoding is given, a
 * string. Only SHA-256 is supported (the only algorithm the desktop uses).
 */
class Hmac {
  private readonly chunks: Uint8Array[] = [];
  constructor(private readonly key: Uint8Array) {}

  update(data: string | Uint8Array, _encoding?: string): this {
    this.chunks.push(typeof data === 'string' ? new TextEncoder().encode(data) : data);
    return this;
  }

  digest(encoding?: string): Buf | string {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const msg = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      msg.set(chunk, offset);
      offset += chunk.length;
    }
    const out = hmac(sha256, this.key, msg);
    const buf = new Buf(out.buffer as ArrayBuffer, out.byteOffset, out.byteLength);
    return encoding ? buf.toString(encoding) : buf;
  }
}

export function createHmac(_algorithm: string, key: string | Uint8Array): Hmac {
  const keyBytes = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  return new Hmac(keyBytes);
}