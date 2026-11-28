// electron (server shim) — the cloud worker bundles the REAL `src/main/ipc.ts` so
// ALL of the desktop's IPC channels become available in the web app with the exact
// same argument and return shapes. ipc.ts (plus a few services) import from
// 'electron'; this module satisfies those imports and *captures* every
// `ipcMain.handle(channel, handler)` registration into a channel -> handler map
// that `src/dispatch.ts` invokes. There is no Electron runtime in a Worker.
//
// The handful of channels that genuinely need a window/dialog/printer (printing,
// file export, backup, updater) are still registered, but the stub window/dialog/
// app objects below make them no-ops at *call* time — never a load-time crash.

export type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

const registry = new Map<string, IpcHandler>();

/** Channel -> handler map, filled by the real `registerIpcHandlers()` (+ licensing). */
export function getIpcRegistry(): Map<string, IpcHandler> {
  return registry;
}

type IpcMainShim = {
  handle(channel: string, handler: IpcHandler): IpcMainShim;
  on(): IpcMainShim;
  once(): IpcMainShim;
  removeHandler(): IpcMainShim;
  removeAllListeners(): IpcMainShim;
  emit(): boolean;
};

export const ipcMain: IpcMainShim = {
  handle(channel, handler) {
    registry.set(channel, handler);
    return ipcMain;
  },
  on: () => ipcMain,
  once: () => ipcMain,
  removeHandler: () => ipcMain,
  removeAllListeners: () => ipcMain,
  emit: () => false,
};

const noop = (): void => {};

export const app = {
  isPackaged: false,
  getVersion: (): string => '2.15.1',
  getName: (): string => 'Rokar POS',
  getAppPath: (): string => '',
  getPath: (): string => '/tmp/rokar',
  quit: noop,
  exit: noop,
  whenReady: async (): Promise<void> => {},
  on: noop,
  once: noop,
  setName: noop,
  setAppUserModelId: noop,
  commandLine: { appendSwitch: noop },
  setAsDefaultProtocolClient: (): boolean => true,
  requestSingleInstanceLock: (): boolean => true,
};

export const BrowserWindow = {
  getFocusedWindow: (): unknown => null,
  getAllWindows: (): unknown[] => [],
  fromWebContents: (): unknown => null,
};

export const dialog = {
  showOpenDialog: async (): Promise<{ canceled: boolean; filePaths: string[] }> => ({
    canceled: true,
    filePaths: [],
  }),
  showSaveDialog: async (): Promise<{ canceled: boolean; filePath: string | undefined }> => ({
    canceled: true,
    filePath: undefined,
  }),
  showMessageBox: async (): Promise<{ response: number }> => ({ response: 0 }),
};

export const protocol = {
  handle: noop,
  unhandle: noop,
  registerSchemesAsPrivileged: noop,
  registerFileProtocol: noop,
};

export const shell = {
  openExternal: async (): Promise<void> => {},
  openPath: async (): Promise<string> => '',
};

export const Menu = {
  setApplicationMenu: noop,
  buildFromTemplate: (): unknown => ({}),
};

export const screen = {
  getPrimaryDisplay: (): unknown => ({ workAreaSize: { width: 1280, height: 800 } }),
};

export const nativeImage = {
  createFromPath: (): unknown => ({ isEmpty: () => true }),
};

export const contextBridge = {
  exposeInMainWorld: noop,
};

export const ipcRenderer = {
  invoke: async (): Promise<undefined> => undefined,
  send: noop,
  on: noop,
  once: noop,
  removeListener: noop,
};

/**
 * `safeStorage` — the OS key store (Phase 0's credential vault,
 * `src/main/services/secretVault.ts`).
 *
 * A Worker has NO OS key store, so:
 *   - `isEncryptionAvailable()` is FALSE, which is the vault's documented
 *     fallback: the credential is stored as plain text (exactly how the web
 *     app stored it before the vault existed) and the owner is warned once;
 *   - `decryptString()` returns '' — a value that was encrypted on the
 *     DESKTOP is never "decrypted" into a secret here. The shop is told to
 *     re-enter it, which is the vault's rule for a value that cannot be
 *     decrypted;
 *   - `encryptString()` THROWS on purpose. The vault asks first, so this is
 *     unreachable today; if a future code path encrypts without asking, a
 *     loud failure is safer than writing plain text under an "enc:v1:" prefix
 *     that nobody can decrypt.
 *
 * This export is REQUIRED: without it the whole worker bundle fails to build
 * ("No matching export in src/shims/electron-server.ts for import
 * 'safeStorage'"), and the deploy dies. `npm run test:cloudShim` is the
 * permanent guard for exactly that.
 */
export const safeStorage = {
  isEncryptionAvailable: (): boolean => false,
  encryptString: (): Buffer => {
    throw new Error('safeStorage is not available on the server');
  },
  decryptString: (): string => '',
};

/**
 * `powerMonitor` — the desktop's updater watches the 'resume' event to check
 * for an update after the machine wakes up. A Worker has no power events, so
 * the stub is a no-op. It is here because the desktop IMPORTS it as a value
 * from 'electron': a missing export in this shim breaks the whole bundle
 * ("No matching export in src/shims/electron-server.ts for import
 * 'powerMonitor'"), even for a module the Worker does not use yet.
 */
export const powerMonitor = {
  on: noop,
  once: noop,
  removeAllListeners: noop,
  removeListener: noop,
  getSystemIdleTime: (): number => 0,
  getSystemIdleState: (): string => 'active',
};

export default {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  shell,
  Menu,
  screen,
  nativeImage,
  contextBridge,
  ipcRenderer,
  safeStorage,
  powerMonitor,
};
