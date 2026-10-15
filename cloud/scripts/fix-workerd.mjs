// fix-workerd.mjs — Windows-only helper that re-adds the MSVC runtime DLLs the
// workerd.exe binary needs but npm does not ship. Any `npm install` can wipe
// them (the package is reinstalled over), so run this right after installs;
// `npm run build` also runs it.
//
// Sources: the newest installed Edge Core version dir under
// `C:\Program Files (x86)\Microsoft\EdgeCore`. Destination:
// `node_modules\workerd\node_modules\@cloudflare\workerd-windows-64\bin`.

import { existsSync, readdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const NEEDED = [
  'vcruntime140.dll',
  'vcruntime140_1.dll',
  'msvcp140.dll',
  'msvcp140_2.dll',
  'msvcp140_codecvt_ids.dll',
  'concrt140.dll',
];

const EDGE_ROOT = 'C:\\Program Files (x86)\\Microsoft\\EdgeCore';

function versionCompare(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

function main() {
  const envRoot = process.env.EDGE_CORE_DIR;
  const edgeRoot = envRoot && existsSync(envRoot) ? envRoot : EDGE_ROOT;

  let versions = [];
  if (existsSync(edgeRoot)) {
    versions = readdirSync(edgeRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      // version-like directories ("155.0.4283.45") rank above labelled ones
      // ("Edge Optimized"), newest numeric version first.
      .sort((a, b) => {
        const aNum = /^\d/.test(a);
        const bNum = /^\d/.test(b);
        if (aNum !== bNum) return aNum ? -1 : 1;
        return versionCompare(b, a);
      });
  }

  if (versions.length === 0) {
    console.warn(
      `[fix-workerd] No Edge Core installs found under ${edgeRoot} — workerd may fail to boot. Set EDGE_CORE_DIR to point at a directory holding MSVC runtime DLLs if so.`
    );
    process.exit(0);
  }

  const newest = versions[0];
  const sourceDir = path.join(edgeRoot, newest);

  const binDir = path.join(
    root,
    'node_modules',
    'workerd',
    'node_modules',
    '@cloudflare',
    'workerd-windows-64',
    'bin'
  );
  if (!existsSync(binDir)) {
    console.warn(`[fix-workerd] workerd bin dir not found: ${binDir}`);
    process.exit(0);
  }

  let copied = 0;
  const missing = [];
  for (const dll of NEEDED) {
    const from = path.join(sourceDir, dll);
    if (existsSync(from)) {
      copyFileSync(from, path.join(binDir, dll));
      copied++;
    } else {
      missing.push(dll);
    }
  }

  console.log(
    `[fix-workerd] copied ${copied}/${NEEDED.length} MSVC DLLs from Edge ${newest} into workerd bin`
  );
  if (missing.length > 0) console.warn(`[fix-workerd] not present in Edge Core: ${missing.join(', ')}`);
}

main();