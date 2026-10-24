/**
 * One-off helper: mirror RokarPOS-Setup-<version>.exe onto the published
 * release under the version-less name RokarPOS-Setup.exe.
 *
 * The marketing site points at
 *   /releases/latest/download/RokarPOS-Setup.exe
 * and GitHub only redirects that when the latest release actually carries an
 * asset with EXACTLY that name. When the mirror step is skipped, every download
 * button on the live site 404s.
 *
 * Usage: GH_TOKEN=... node scripts/upload-stable-asset.js [tag]
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const { version, build } = require('../package.json');
const OWNER = 'hamzarazadomain3-code';
const REPO = 'pos-releases';
const STABLE_ASSET = 'RokarPOS-Setup.exe';
const tag = process.argv[2] || `v${version}`;

if (!TOKEN) {
  console.error('FAIL: set GH_TOKEN');
  process.exit(1);
}

function api(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: apiPath,
        method,
        headers: {
          Authorization: `token ${TOKEN}`,
          'User-Agent': 'pos-app-release',
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
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
      },
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Raw-bytes upload: the endpoint takes the file as the request BODY, never as
// multipart/form-data (multipart makes GitHub store the encoded body itself).
function uploadAsset(releaseId, filePath, assetName) {
  return new Promise((resolve) => {
    const stat = fs.statSync(filePath);
    console.log(`Uploading ${assetName} (${(stat.size / 1024 / 1024).toFixed(1)} MB)...`);
    const started = Date.now();
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
          const secs = ((Date.now() - started) / 1000).toFixed(1);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`OK: uploaded ${assetName} in ${secs}s`);
            resolve(true);
          } else {
            console.log(`FAIL (HTTP ${res.statusCode}) in ${secs}s: ${data.slice(0, 300)}`);
            resolve(false);
          }
        });
      },
    );
    req.on('error', (e) => {
      console.log(`FAIL: ${e.message}`);
      resolve(false);
    });
    const file = fs.createReadStream(filePath);
    file.on('error', (e) => {
      console.log(`FAIL read: ${e.message}`);
      req.destroy();
      resolve(false);
    });
    file.pipe(req);
  });
}

(async () => {
  const list = await api('GET', `/repos/${OWNER}/${REPO}/releases`);
  const release = (list.body || []).find((r) => r.tag_name === tag);
  if (!release) {
    console.error(`FAIL: no release ${tag}`);
    process.exit(1);
  }
  console.log(`Release: ${release.tag_name} (id ${release.id})`);

  const existing = (release.assets || []).map((a) => a.name);
  console.log(`Existing assets: ${existing.join(', ')}`);

  if (existing.includes(STABLE_ASSET)) {
    console.log(`Already present: ${STABLE_ASSET}`);
    return;
  }

  const outDir = (build && build.directories && build.directories.output) || 'dist_release';
  const installer = path.join(__dirname, '..', outDir, `RokarPOS-Setup-${version}.exe`);
  if (!fs.existsSync(installer)) {
    console.error(`FAIL: installer not found at ${installer}`);
    process.exit(1);
  }

  const ok = await uploadAsset(release.id, installer, STABLE_ASSET);
  if (!ok) process.exit(1);

  const verify = await api('GET', `/repos/${OWNER}/${REPO}/releases/${release.id}`);
  const names = (verify.body.assets || []).map((a) => a.name);
  console.log(`Final assets: ${names.join(', ')}`);
  console.log(names.includes(STABLE_ASSET) ? 'DONE: stable alias live' : 'FAIL: alias missing after upload');
})();
