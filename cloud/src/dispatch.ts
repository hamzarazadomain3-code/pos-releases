// dispatch — the cloud-side IPC surface.
//
// Rather than re-declaring the desktop's channel handlers by hand, the worker
// imports the REAL `src/main/ipc.ts` `registerIpcHandlers()` and calls it once.
// Every `ipcMain.handle(channel, handler)` it performs is captured by the
// `electron` server shim (src/shims/electron-server.ts), so the web app runs the
// *exact* desktop handlers — same arguments, same return shapes, same owner gates.
//
// The real services' `../db` imports are esbuild-aliased to web-db, their
// `node:crypto` imports to crypto-shim, and the Electron/node-only leaves
// (electron, fs, os, path, child_process, node:sqlite, nodemailer, xlsx, bwip-js,
// whatsapp-web.js, logger, supportKey) to inert shims under src/shims/.
//
// Session model: one web session maps to one POS user id. `dispatch` temporarily
// sets that user as the service-level session (so `can('owner')` gates work) and
// always clears it afterwards. `auth:login`/`auth:loginWithPin` set their own
// session internally, so they run with a null session user.

import { getIpcRegistry, type IpcHandler } from './shims/electron-server';
import { registerIpcHandlers } from '@desktop/ipc';
import { registerIpc as registerLicensing } from '@desktop/licensing';
import { buildPrintDocument } from './print-bridge';
import * as auth from '../../src/main/services/auth';

// Injected at bundle time from the desktop package.json (see scripts/build.mjs),
// so this never has to be bumped by hand.
declare const __APP_VERSION__: string;
const WEB_VERSION = __APP_VERSION__;

// Channels the desktop registers OUTSIDE ipc.ts (initialise-time in main.ts and
// updater.ts). They have no service logic worth porting; the app only reads them.
const extraHandlers: Record<string, IpcHandler> = {
  'app:get-version': () => WEB_VERSION,
  'app:getLogPath': () => '',
  'app:quit': () => undefined,
  'updater:check': () => undefined,
  'updater:install': () => undefined,
  'updater:getState': () => ({ state: 'idle' }),
  // Web printing: a browser cannot run Electron's hidden print window, so the
  // document is built server-side (the same builders the desktop handlers use)
  // and returned as HTML for the browser to print. See src/print-bridge.ts.
  'cloud:print': (_e: unknown, ...args: unknown[]) =>
    buildPrintDocument(String(args[0] ?? ''), Array.isArray(args[1]) ? (args[1] as unknown[]) : []),
};

const FAKE_EVENT = { sender: null } as unknown;

let initialized = false;

/**
 * Register every desktop channel once. Safe to call before entering the
 * ShopObject's `transactionSync`: registering handlers performs no database work
 * (service singletons are constructed lazily by their accessors).
 */
export function ensureDispatchInit(): void {
  if (initialized) return;
  initialized = true;
  registerIpcHandlers();
  registerLicensing();
}

/**
 * Run a channel handler synchronously. Called inside the ShopObject's
 * `transactionSync` so a throw rolls the POS database back and a success commits.
 * Async handlers (licensing, printing, export, backup, mail) return a Promise,
 * which the caller awaits after the transaction commits.
 */
export function dispatch(channel: string, args: unknown[], sessionUser: number | null): unknown {
  ensureDispatchInit();
  const handler = getIpcRegistry().get(channel) ?? extraHandlers[channel];
  if (!handler) throw new Error(`Unknown channel: ${channel}`);
  auth.setSessionUser(sessionUser);
  try {
    return handler(FAKE_EVENT, ...(Array.isArray(args) ? args : []));
  } finally {
    auth.setSessionUser(null);
  }
}
