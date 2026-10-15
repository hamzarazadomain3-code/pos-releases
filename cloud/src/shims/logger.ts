// logger shim — the desktop `src/main/logger.ts` writes to a rotating file
// (node:fs + electron `app`). In a Worker every log line is simply dropped.
export function log(_message?: unknown, ..._rest: unknown[]): void {}
export function logError(_message?: unknown, ..._rest: unknown[]): void {}
export function initLogger(): void {}
export function closeLogger(): void {}
export function getLogFilePath(): string {
  return '';
}
export default { log, logError, initLogger, closeLogger, getLogFilePath };
