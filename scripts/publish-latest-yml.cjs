/**
 * Regenerate dist_release/latest.yml from the ACTUAL installer that is on the
 * release, then upload it.
 *
 * Why this exists: a previous release shipped WITHOUT latest.yml (the
 * electron-builder publish step was interrupted mid-upload), so every client
 * failed with "Cannot find channel latest.yml update info: 404". The local
 * latest.yml can also be STALE when electron-builder rebuilds the installer
 * (NSIS embeds a timestamp, so the bytes change on every run) — a stale
 * sha512 makes electron-updater reject the download with a checksum error.
 *
 * This script computes the sha512/size from the file itself, so the manifest
 * always describes the bytes that clients will actually download.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const OUT_DIR = 'dist_release';
const { version } = require('../package.json');

const OWNER = 'hamzarazadomain3-code';
const REPO = 'pos-releases';
const TAG = `v${version}`;
const INSTALLER = `RokarPOS-Setup-${version}.exe`;
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

function sha512Base64(file) {
  const hash = crypto.createHash('sha512');
  hash.update(fs.readFileSync(file));
  return hash.digest('base64');
}

function buildManifest(installerPath) {
  const size = fs.statSync(installerPath).size;
  const sha512 = sha512Base64(installerPath);
  const releaseDate = new Date().toISOString();
  return (
    `version: ${version}\n` +
    `files:\n` +
    `  - url: ${INSTALLER}\n` +
    `    sha512: ${sha512}\n` +
    `    size: ${size}\n` +
    `path: ${INSTALLER}\n` +
    `sha512: ${sha512}\n` +
    `releaseDate: '${releaseDate}'\n`
  );
}

function uploadAsset(releaseId, filePath, assetName) {
  return new Promise((resolve, reject) => {
    const stat = fs.statSync(filePath);
    const req = https.request(
      {
        hostname: 'uploads.github.com',
        path: `/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`,
        method: 'POST',
        headers: {
          Authorization: `token ${TOKEN}`,
          'User-Agent': 'pos-app-release',
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/octet-stream',
          'Content-Length': stat.size,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`Uploaded ${assetName} (${stat.size} bytes)`);
            resolve();
          } else {
            reject(new Error(`Upload failed HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    fs.createReadStream(filePath).pipe(req);
  });
}

function deleteAsset(assetId) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: `/repos/${OWNER}/${REPO}/releases/assets/${assetId}`,
        method: 'DELETE',
        headers: {
          Authorization: `token ${TOKEN}`,
          'User-Agent': 'pos-app-release',
          Accept: 'application/vnd.github+json',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode === 204) {
            console.log('Deleted stale latest.yml asset');
            resolve();
          } else {
            console.log(`Delete returned HTTP ${res.statusCode} (continuing)`);
            resolve();
          }
        });
      }
    );
    req.on('error', () => resolve());
    req.end();
  });
}

function api(method, p) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: p,
        method,
        headers: {
          Authorization: `token ${TOKEN}`,
          'User-Agent': 'pos-app-release',
          Accept: 'application/vnd.github+json',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  if (!TOKEN) {
    console.error('FINALIZE_FAIL: GH_TOKEN not set');
    process.exit(1);
  }

  const installerPath = path.join(OUT_DIR, INSTALLER);
  if (!fs.existsSync(installerPath)) {
    console.error(`FINALIZE_FAIL: installer not found at ${installerPath}`);
    process.exit(1);
  }

  // 1. Write a manifest that describes the ACTUAL installer bytes.
  const manifest = buildManifest(installerPath);
  const manifestPath = path.join(OUT_DIR, 'latest.yml');
  fs.writeFileSync(manifestPath, manifest);
  console.log('--- latest.yml ---');
  console.log(manifest);

  // 2. Find the release + any existing latest.yml asset.
  const rel = await api('GET', `/repos/${OWNER}/${REPO}/releases/tags/${TAG}`);
  if (!rel.body || !rel.body.id) {
    console.error(`FINALIZE_FAIL: release ${TAG} not found: ${JSON.stringify(rel.body).slice(0, 200)}`);
    process.exit(1);
  }
  const releaseId = rel.body.id;
  const existing = (rel.body.assets || []).find((a) => a.name === 'latest.yml');
  if (existing) await deleteAsset(existing.id);

  // 3. Upload it.
  await uploadAsset(releaseId, manifestPath, 'latest.yml');

  // 4. Verify the release really has every asset the updater needs.
  const check = await api('GET', `/repos/${OWNER}/${REPO}/releases/tags/${TAG}`);
  const names = (check.body.assets || []).map((a) => a.name);
  const required = ['latest.yml', INSTALLER, `${INSTALLER}.blockmap`, 'RokarPOS-Setup.exe'];
  const missing = required.filter((n) => !names.includes(n));
  console.log('Release assets:', names.join(', '));
  if (missing.length) {
    console.error(`FINALIZE_FAIL: release is missing: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log('OK: latest.yml is on the release and every required asset is present.');
})().catch((e) => {
  console.error('FINALIZE_FAIL:', e.message);
  process.exit(1);
});