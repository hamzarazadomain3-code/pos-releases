const https = require('https');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const OWNER = 'hamzarazadomain3-code';
const REPO = 'pos-releases';

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com',
      path: path,
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
        resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  // 1. Check if release already exists
  console.log('Checking for existing release...');
  const list = await api('GET', `/repos/${OWNER}/${REPO}/releases`);
  const existing = (list.body || []).find((r) => r.tag_name === 'v1.6.0');
  
  let release;
  if (existing) {
    console.log('Release already exists, updating assets...');
    release = existing;
  } else {
    console.log('Creating new release...');
    const created = await api('POST', `/repos/${OWNER}/${REPO}/releases`, {
      tag_name: 'v1.6.0',
      name: 'v1.6.0 - Professional Reports',
      body: '## ShopKeeper POS v1.6.0 - Professional Reports System\n\n- Sales Analysis (summary, payment breakdown, daily trend)\n- Product Performance (top products, slow movers, category analysis)\n- Customer Analysis (top customers, udhaar summary, overdue)\n- Inventory Analysis (stock summary, expiry alerts, turnover velocity)\n- Financial P&L (gross/net sales, margins, expenses)\n- Tax Report (taxable sales, tax collected, by-category)\n- Daily Closing (bills, totals, payment mode, expenses)\n- PDF export for all reports\n\nAuto-update support via latest.yml',
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

  // 2. Upload installer asset
  const exePath = path.join(process.cwd(), 'dist_release', 'ShopKeeperPOS-Setup-1.6.0.exe');
  if (fs.existsSync(exePath)) {
    console.log('Uploading installer...');
    await uploadAsset(release.id, exePath, 'ShopKeeperPOS-Setup-1.6.0.exe', 'application/x-msdownload');
    console.log('Installer uploaded.');
  }
  
  // 3. Upload latest.yml asset  
  const ymlPath = path.join(process.cwd(), 'dist_release', 'latest.yml');
  if (fs.existsSync(ymlPath)) {
    console.log('Uploading latest.yml...');
    await uploadAsset(release.id, ymlPath, 'latest.yml', 'text/yaml');
    console.log('latest.yml uploaded.');
  }
  
  console.log('Done! Release URL:', release.html_url);

  function uploadAsset(releaseId, filePath, assetName, contentType) {
    return new Promise((resolve, reject) => {
      const fileStat = fs.statSync(filePath);
      const req = https.request({
        hostname: 'uploads.github.com',
        path: `/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?name=${assetName}`,
        method: 'POST',
        headers: {
          Authorization: `token ${TOKEN}`,
          'User-Agent': 'pos-app-release',
          Accept: 'application/vnd.github+json',
          'Content-Type': contentType,
          'Content-Length': fileStat.size,
        },
      }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            console.error('Upload failed:', res.statusCode, data);
            resolve(); // continue even if asset exists
          }
        });
      });
      req.on('error', reject);
      const stream = fs.createReadStream(filePath);
      stream.pipe(req);
    });
  }
})();
