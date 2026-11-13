/**
 * Verify a published release the way electron-updater sees it:
 *   1. fetch latest.yml from the release
 *   2. parse the version + file url + sha512 + size
 *   3. download the installer and check the sha512 BYTE FOR BYTE
 *   4. check the blockmap is present (differential download)
 *   5. check the version-less alias exists (the website's download button)
 *
 * A release that fails step 3 makes every client fail with a checksum error,
 * and one that fails step 1 fails with "Cannot find channel latest.yml".
 */
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

const OWNER = 'hamzarazadomain3-code';
const REPO = 'pos-releases';
const TAG = process.argv[2] || 'v2.25.0';
const BASE = `https://github.com/${OWNER}/${REPO}`;

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', headers: { 'User-Agent': 'pos-app-verify', ...headers } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return get(res.headers.location, headers).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.end();
  });
}

function parseManifest(yaml) {
  const out = { version: null, path: null, sha512: null, size: null, files: [] };
  for (const line of yaml.split('\n')) {
    const t = line.trim();
    let m;
    if ((m = t.match(/^version:\s*(\S+)$/))) out.version = m[1].replace(/^['"]|['"]$/g, '');
    if ((m = t.match(/^path:\s*(\S+)$/))) out.path = m[1];
    if ((m = t.match(/^sha512:\s*(\S+)$/))) out.sha512 = m[1];
    if ((m = t.match(/^size:\s*(\d+)$/))) out.size = Number(m[1]);
    if ((m = t.match(/^-?\s*url:\s*(\S+)$/))) out.files.push(m[1]);
  }
  return out;
}

let pass = 0;
let fail = 0;
function check(cond, label, detail = '') {
  if (cond) {
    console.log(`  [PASS] ${label}${detail ? ' — ' + detail : ''}`);
    pass++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ' — ' + detail : ''}`);
    fail++;
  }
}

(async () => {
  console.log(`=== Release verification: ${TAG} ===\n`);

  // 1. The manifest the updater fetches.
  console.log('--- latest.yml ---');
  const manifestUrl = `${BASE}/releases/download/${TAG}/latest.yml`;
  const yml = (await get(manifestUrl)).toString('utf8');
  console.log(yml);
  const info = parseManifest(yml);
  check(!!info.version, 'the manifest declares a version', info.version || '(none)');
  check(!!info.path, 'the manifest names the installer', info.path || '(none)');
  check(!!info.sha512, 'the manifest carries a sha512');
  check(Number.isFinite(info.size) && info.size > 0, 'the manifest carries a size', String(info.size));

  // 2. The installer itself — downloaded and hashed byte for byte.
  console.log('\n--- installer bytes ---');
  const installerUrl = `${BASE}/releases/download/${TAG}/${info.path}`;
  console.log('  downloading', installerUrl);
  const bytes = await get(installerUrl);
  const actualSha = crypto.createHash('sha512').update(bytes).digest('base64');
  check(bytes.length === info.size, 'the downloaded size matches the manifest', `${bytes.length} vs ${info.size}`);
  check(actualSha === info.sha512, 'the downloaded sha512 matches the manifest',
    actualSha === info.sha512 ? 'exact match' : `DIFFERENT — manifest ${info.sha512.slice(0, 16)}… actual ${actualSha.slice(0, 16)}…`);

  // 3. The blockmap (differential download) and the version-less alias.
  console.log('\n--- other assets ---');
  for (const name of [`${info.path}.blockmap`, 'RokarPOS-Setup.exe']) {
    try {
      const b = await get(`${BASE}/releases/download/${TAG}/${name}`);
      check(b.length > 0, `${name} is downloadable`, `${b.length} bytes`);
    } catch (e) {
      check(false, `${name} is downloadable`, e.message);
    }
  }

  // 4. The generic CDN feed the app now uses as its PRIMARY provider.
  console.log('\n--- generic CDN feed (primary provider) ---');
  try {
    const cdn = await get(`${BASE}/releases/latest/download/latest.yml`);
    const cdnInfo = parseManifest(cdn.toString('utf8'));
    check(cdnInfo.version === info.version, 'the CDN feed serves the same version', cdnInfo.version);
  } catch (e) {
    check(false, 'the CDN feed serves latest.yml', e.message);
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('\n=== VERIFICATION FAILED ===');
  console.error(e.message);
  process.exit(1);
});