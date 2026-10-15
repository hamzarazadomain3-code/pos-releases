// Typecheck-only shim for the `electron` surface the real `src/main/db.ts` uses
// (it computes the migrations dir from `app`). Never part of the cloud bundle —
// db.ts is aliased out of the bundle entirely; this declaration only exists so
// tsc can typecheck the desktop files the dispatch layer imports.

declare module 'electron' {
  export const app: {
    isPackaged: boolean;
    getAppPath(): string;
    getPath(name: string): string;
  };
}

declare module 'electron/main' {
  export const app: {
    isPackaged: boolean;
    getAppPath(): string;
    getPath(name: string): string;
  };
}