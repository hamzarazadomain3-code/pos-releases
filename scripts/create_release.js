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
       name: `${tag} - Advanced Inventory & Profitability Reports`,
      body: `## ShopKeeper POS v${version}

### Advanced Inventory + Profitability Reports (v1.8.0)

#### Database Migration 024
- **New tables:** \`inventory_snapshots\`, \`product_profitability\`, \`alert_log\`
- **Extended \`suppliers\`:** email, city, payment_terms, average_rate, reliability_score, total_orders, on_time_delivery_pct, is_active
- **Extended \`purchase_orders\`:** delivery_date, notes, updated_at
- **Extended \`purchase_items\`:** quantity_received, total_cost, unit_name (batch_number/expiry_date already existed)
- **Extended \`products\`:** min_stock_level, reorder_qty, last_supplier_id
- **Default settings:** expiry_warning_days=30, low_stock_warning_days=7, slow_mover_days=60, low_profit_threshold=5

#### Inventory Reports Service (\`inventoryReports.ts\`)
- **Purchase History:** filter by product + date range, delivery status, batch/expiry tracking
- **Daily Inventory:** opening/purchases/sales/closing/variance with snapshot capture
- **Weekly Inventory:** 7-day rollup with days-tracked aggregation
- **Monthly Inventory:** category, avg cost/selling price, supplier diversity
- **Supplier Metrics:** order count, total spent, on-time %, reliability score, average cost
- **Product Purchase Summary:** 3-month purchase history with post-purchase sales tracking
- **Daily Snapshot:** auto-created at midnight via scheduler, stored in \`inventory_snapshots\`

#### Profitability Service (\`profitability.ts\`)
- **Daily/Weekly/Monthly:** units sold, COGS, revenue, gross profit, margin %
- **Category Analysis:** revenue/profit/margin aggregated by category
- **Low Profit Products:** margin below configurable threshold (default 5%)
- **Top Products:** highest gross profit in period
- **Worst Products:** lowest sales volume with days-no-sale
- **Break-Even Analysis:** break-even price at 10% target margin, status indicator

#### Alert Service (\`alertService.ts\`)
- **Low Stock:** critical (out of stock) or warning (below minimum)
- **Expiry:** warnings for items expiring within 30 days, critical within 7 days
- **Low Profit:** products below margin threshold
- **Slow Movers:** no sales for 60+ days (warning at 60, info at 90)
- **Deduplication:** prevents duplicate alerts within same day for same product
- **CRUD:** get all/unread, mark as read, resolve with action notes

#### Scheduler (\`main.ts\`)
- **Daily snapshot** at midnight local time (setTimeout to next midnight + 24h interval)
- **Hourly alert checks** (setTimeout to next hour + 60min interval)

#### UI (Reports.tsx)
- **Alerts tab:** check-now button, daily snapshot button, alert table with severity badges, ack/resolve actions
- **Profitability tab:** 8 sub-tabs (Daily, Weekly, Monthly, Category, Break-Even, Low Profit, Top Products, Worst Products)
- **Inventory tab:** 5 sub-tabs (Daily, Weekly, Monthly, Purchase History, Supplier Metrics)
- All tables include Excel export where applicable

#### Test Suite
- \`scripts/test_inventoryReports.js\`: 12 tests covering purchase history, daily inventory, supplier metrics, expiry, profitability COGS/revenue, snapshot creation, alert dedup

#### Version bump: \`1.7.1\` → \`1.8.0\`
`,
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
