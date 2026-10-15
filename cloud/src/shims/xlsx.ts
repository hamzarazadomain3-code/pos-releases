// xlsx shim — `export.ts` writes .xlsx workbooks with the SheetJS library. A
// Worker can't save to disk, so these return empty values instead of bundling the
// whole library. (The web UI has no file-export channels wired anyway.)
export const utils = {
  book_new: () => ({}),
  aoa_to_sheet: () => ({}),
  json_to_sheet: () => ({}),
  book_append_sheet: () => {},
  sheet_to_json: () => [],
};

export function read(): any {
  return {};
}
export function readFile(): any {
  return {};
}
export function write(): Uint8Array {
  return new Uint8Array();
}
export function writeFile(): void {}
export const version = '0.0.0-web-shim';
export default { utils, read, write, writeFile, version };
