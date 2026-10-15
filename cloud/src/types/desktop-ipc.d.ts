// Typecheck-only ambient shims for the two desktop modules the cloud bundle
// imports *through virtual specifiers*. esbuild resolves these specifiers to the
// real files (see the alias plugin in scripts/build.mjs), but cloud tsc must NOT
// follow into `src/main/ipc.ts` (it would pull the whole Electron/node service
// graph into the typecheck). Declaring the modules here keeps the type boundary
// at the call we actually make.

declare module '@desktop/ipc' {
  /** Registers every desktop IPC channel on the captured `ipcMain` shim. */
  export function registerIpcHandlers(): void;
}

declare module '@desktop/licensing' {
  /** Registers the `licensing:*` channels on the captured `ipcMain` shim. */
  export function registerIpc(): void;
}
