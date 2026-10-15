// node:path / path shim — a small POSIX-only implementation, enough that modules
// which build paths at import time (printing/label/backup) get a string back
// instead of `undefined`. No real filesystem is involved.

function join(...parts: string[]): string {
  return parts
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .join('/')
    .replace(/\/{2,}/g, '/');
}
function resolve(...parts: string[]): string {
  return join(...parts);
}
function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '.' : p.slice(0, i);
}
function basename(p: string, ext?: string): string {
  let b = p.slice(p.lastIndexOf('/') + 1);
  if (ext && b.endsWith(ext)) b = b.slice(0, -ext.length);
  return b;
}
function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i);
}
function isAbsolute(p: string): boolean {
  return p.startsWith('/');
}
function normalize(p: string): string {
  return p;
}
function relative(_from: string, to: string): string {
  return to;
}

export const sep = '/';
export { join, resolve, dirname, basename, extname, isAbsolute, normalize, relative };
export default { join, resolve, dirname, basename, extname, isAbsolute, normalize, relative, sep, posix: { join } };
