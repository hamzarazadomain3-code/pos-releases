// Typecheck-only ambient shims for the Node/browser-global surface that the REAL
// desktop service code touches. The cloud bundle never imports these modules at
// runtime — esbuild aliases `crypto`/`node:crypto` to crypto-shim.ts and `../db`
// to web-db.ts — but tsc follows the real `src/main/services/*` imports into the
// real `src/main/db.ts`, so these declarations let the compiler typecheck them
// without pulling in @types/node or electron.
//
// `Buffer` intentionally has NO declaration here: @cloudflare/workers-types
// already declares the (generic) global `Buffer` that desktop code uses in
// `Buffer.from(hex, 'hex')`, so we must not shadow or merge with it.
//
// This file must stay in sync with the actual usage in the desktop code; it is a
// *type* boundary only and never enters the bundle.

declare module 'node:crypto' {
  export function scryptSync(
    password: string | Uint8Array,
    salt: string | Uint8Array,
    keylen: number,
    options?: { N?: number; r?: number; p?: number; maxmem?: number }
  ): Buffer;
  // The values passed by the desktop code (lib-typed generic Buffers) are not
  // assignable to plain Uint8Array under TS 5.7+ generic typed arrays. This
  // shim is only a type boundary, so accept anything at the call sites.
  export function timingSafeEqual(a: unknown, b: unknown): boolean;
  export function randomBytes(size: number): Buffer;
  export function randomUUID(): string;
}

declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string, options?: unknown);
    exec(sql: string): void;
    prepare(sql: string): {
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
      run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    };
    close(): void;
  }
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
}

declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function readdirSync(path: string): string[];
}

declare const process: {
  env: Record<string, string | undefined>;
  cwd(): string;
  resourcesPath?: string;
};

declare const require: (id: string) => any;