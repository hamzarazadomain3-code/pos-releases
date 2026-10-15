// node:child_process shim — the print service shells out to the OS to enumerate
// printers. That is impossible in a Worker; any callback receives an Error and a
// benign handle is returned so the caller's `.on(...)` never dereferences null.

type Callback = (error: Error | null, stdout?: string, stderr?: string) => void;

function pickCallback(a?: unknown, b?: unknown, c?: unknown): Callback | null {
  for (const candidate of [c, b, a]) {
    if (typeof candidate === 'function') return candidate as Callback;
  }
  return null;
}

export function execFile(_file?: unknown, a?: unknown, b?: unknown, c?: unknown): any {
  const callback = pickCallback(a, b, c);
  const error = new Error('child_process is not available in the web app');
  if (callback) {
    try {
      callback(error, '', '');
    } catch {
      /* ignore */
    }
  }
  return { on: () => undefined, kill: () => undefined, stdout: null, stderr: null };
}

export function exec(): any {
  return execFile();
}
export function execSync(): string {
  return '';
}
export function spawn(): any {
  return { on: () => undefined, kill: () => undefined };
}
export default { execFile, exec, execSync, spawn };
