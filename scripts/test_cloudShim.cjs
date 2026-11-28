// test_cloudShim.cjs — the PERMANENT guard for the cloud (Worker) build.
//
// Phase 5, item 5.9 (found by the deploy, not by the test battery):
// Phase 0 added the credential vault (`src/main/services/secretVault.ts`),
// which imports `safeStorage` from 'electron'. The Worker bundles the REAL
// desktop IPC surface, so 'electron' is aliased to
// `cloud/src/shims/electron-server.ts`. That shim had no `safeStorage`
// export, so esbuild refused to bundle:
//
//   ../src/main/services/secretVault.ts:1:9: ERROR: No matching export in
//   "src/shims/electron-server.ts" for import "safeStorage"
//
// and the deploy died (`.git/deploy-cloud.log`: "DEPLOY FAILED"). The 103
// suite battery could not see it: it never builds the Worker.
//
// This suite has two halves:
//
//   1. the SOURCE check — every named import the desktop takes from
//      'electron' / 'electron/main' must exist in the server shim. It is
//      fast, and it names the exact missing export;
//   2. the REAL build — `cloud/scripts/build.mjs` is run (esbuild), and the
//      bundle must be produced. This is the check that actually failed.
//
// Run: npm run test:cloudShim

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const shimPath = path.join(root, 'cloud', 'src', 'shims', 'electron-server.ts');

let passed = 0;
let failed = 0;

function check(cond, label, detail = '') {
  if (cond) {
    passed++;
    console.log(`  [PASS] ${label}${detail ? ' -- ' + detail : ''}`);
  } else {
    failed++;
    console.log(`  [FAIL] ${label}${detail ? ' -- ' + detail : ''}`);
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

// ---------------------------------------------------------------------------
// Walk the desktop's main-process sources for the named electron imports.
// ---------------------------------------------------------------------------
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function electronImports() {
  const mainDir = path.join(root, 'src', 'main');
  const found = new Map(); // exportName -> [file]
  const files = walk(mainDir);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    // import { a, b as c } from 'electron';
    // A TYPE-ONLY import (`import type { X } from 'electron'`) is erased by
    // esbuild, so it needs no runtime export in the shim.
    const re = /import\s+(?!type\s)\{([^}]*)\}\s*from\s*'electron(?:\/main)?'/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      for (const raw of m[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0].trim();
        if (!name) continue;
        if (!found.has(name)) found.set(name, []);
        found.get(name).push(path.relative(root, file));
      }
    }
  }
  return { found, fileCount: files.length };
}

function shimExports() {
  const text = fs.readFileSync(shimPath, 'utf8');
  const names = new Set();
  const re = /export\s+(?:const|let|var|function|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) names.add(m[1]);
  return names;
}

section('The desktop files the Worker bundles');
const { found, fileCount } = electronImports();
console.log(`  scanned ${fileCount} files under src/main`);
check(fileCount > 20, 'the scan found the desktop main-process sources', `${fileCount} files`);

section('Every electron import the desktop takes must exist in the server shim');
const shimNames = shimExports();
console.log(`  the shim exports: ${[...shimNames].sort().join(', ')}`);
for (const [name, files] of [...found.entries()].sort()) {
  check(shimNames.has(name), `the shim exports '${name}'`, `used by ${files[0]}${files.length > 1 ? ` (+${files.length - 1} more)` : ''}`);
}

// The one that actually broke the deploy.
check(shimNames.has('safeStorage'), "the shim exports 'safeStorage' (the Phase 0 credential vault)");

section('The real Worker build (esbuild)');
const cloudDir = path.join(root, 'cloud');
let buildOut = '';
let buildOk = false;
try {
  buildOut = execFileSync(process.execPath, [path.join('scripts', 'build.mjs')], {
    cwd: cloudDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 300000,
  });
  buildOk = true;
} catch (e) {
  buildOut = `${e.stdout || ''}\n${e.stderr || ''}`;
}
check(buildOk, 'cloud/scripts/build.mjs completes', buildOk ? 'the bundle was produced' : buildOut.split('\n').filter(Boolean).slice(-6).join(' | '));
if (buildOk) {
  const bundle = path.join(cloudDir, 'dist', 'index.js');
  const size = fs.existsSync(bundle) ? fs.statSync(bundle).size : 0;
  check(size > 1000, 'the Worker bundle exists and is not empty', `${size} bytes`);
  check(/safeStorage|isEncryptionAvailable/.test(fs.readFileSync(bundle, 'utf8')), 'the bundle carries the safeStorage shim');
}

console.log(`\n${passed}/${passed + failed} checks passed.`);
if (failed) {
  console.error(`\n=== ${failed} CHECK(S) FAILED ===`);
  process.exit(1);
}
console.log('ALL PASSED');
process.exit(0);
