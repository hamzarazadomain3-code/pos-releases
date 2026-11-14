// xlsx shim — DO NOT USE. This file is kept only as a trap.
//
// It USED to be the `xlsx` alias in cloud/scripts/build.mjs, and that silently
// broke every workbook feature in the web app:
//
//   - the Inventory import died with
//     "Cannot read properties of undefined (reading '0')" (XLSX.read returned {})
//   - every Excel export produced an EMPTY file (XLSX.write returned no bytes)
//
// The real SheetJS library is now bundled into the Worker (the build needs
// `mainFields: ['main', 'module']` for that, because `platform: 'neutral'` has
// no main fields by default). If this shim is ever wired back up, the import
// and every export break again — so fail loudly instead.
function refuse(): never {
  throw new Error(
    'The xlsx shim is not allowed in the Worker: the real SheetJS library must be bundled ' +
      '(see cloud/scripts/build.mjs). A shimmed xlsx makes the Inventory import throw and ' +
      'every Excel export produce an empty file.'
  );
}

export const utils = {
  book_new: refuse,
  aoa_to_sheet: refuse,
  json_to_sheet: refuse,
  book_append_sheet: refuse,
  sheet_to_json: refuse,
};

export function read(): never {
  return refuse();
}
export function readFile(): never {
  return refuse();
}
export function write(): never {
  return refuse();
}
export function writeFile(): never {
  return refuse();
}
export const version = '0.0.0-web-shim-REMOVED';
export default { utils, read, write, writeFile, version };
