const https = require('https');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const OWNER = 'hamzarazadomain3-code';
const REPO = 'pos-releases';
const { version } = require('../package.json');
const tag = `v${version}`;

if (!TOKEN) {
  console.error('FINALIZE_FAIL: GH_TOKEN not set');
  process.exit(1);
}

function api(method, p, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com',
      path: p,
      method: method,
      headers: {
        Authorization: `token ${TOKEN}`,
        'User-Agent': 'pos-app-release',
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function uploadAsset(releaseId, filePath, assetName, contentType) {
  return new Promise((resolve) => {
    const stat = fs.statSync(filePath);
    const req = https.request({
      hostname: 'uploads.github.com',
      path: `/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?name=${assetName}`,
      method: 'POST',
      headers: {
        Authorization: `token ${TOKEN}`,
        'User-Agent': 'pos-app-release',
        Accept: 'application/vnd.github+json',
        'Content-Type': contentType,
        'Content-Length': stat.size,
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`  Uploaded ${assetName} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
        } else {
          console.error(`  Upload ${assetName} failed: ${res.statusCode}`, data);
        }
        resolve();
      });
    });
    req.on('error', (e) => { console.error('Upload error:', e.message); resolve(); });
    const stream = fs.createReadStream(filePath);
    stream.pipe(req);
  });
}

(async () => {
  console.log('Checking for existing release for', tag);
  const list = await api('GET', `/repos/${OWNER}/${REPO}/releases?per_page=20`);
  const existing = (list.body || []).find((r) => r.tag_name === tag);

  let release;
  if (existing) {
    console.log('Release already exists:', existing.html_url);
    release = existing;
  } else {
    console.log('Creating new release for', tag);
    const created = await api('POST', `/repos/${OWNER}/${REPO}/releases`, {
      tag_name: tag,
      name: `${tag} - BayLan Label Scale Barcode Integration`,
      body: '## ShopKeeper POS v' + version + '\n\n### BayLan RLS1100 Label Scale Integration (Phase 1 - Decode Only)\n\n- Scale barcode parser: detects prefix "21" + validates EAN-13 checksum + extracts 5-digit PLU + 5-digit price\n- Barcode 2110001002342 decodes to: PLU=10001, Price=Rs.234\n- Seamless billing flow: scan scale label → find product by PLU → add to cart with decoded price\n- PLU-to-product mapping UI in Settings page\n- Full EAN-13 check digit validation\n- Unit tests covering valid/invalid barcodes, wrong prefix, zero price, edge cases\n\nPhase 2 (live serial/USB connection) to follow separately.',
      draft: false,
      prerelease: false,
    });
    if (created.status !== 201) {
      console.error('Failed to create release:', JSON.stringify(created.body));
      process.exit(1);
    }
    release = created.body;
    console.log('Release created:', release.html_url);
  }

  // Upload assets
  const exeName = `ShopKeeperPOS-Setup-${version}.exe`;
  const exePath = path.join(process.cwd(), 'dist_release', exeName);
  const ymlPath = path.join(process.cwd(), 'dist_release', 'latest.yml');

  if (fs.existsSync(exePath)) {
    console.log('Uploading installer...');
    await uploadAsset(release.id, exePath, exeName, 'application/x-msdownload');
  } else {
    console.error('Installer not found:', exePath);
  }

  if (fs.existsSync(ymlPath)) {
    console.log('Uploading latest.yml...');
    await uploadAsset(release.id, ymlPath, 'latest.yml', 'text/yaml');
  } else {
    console.error('latest.yml not found:', ymlPath);
  }

  console.log('\nDone! Release URL:', release.html_url);
})();
