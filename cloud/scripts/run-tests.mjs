// run-tests.mjs — end-to-end foundation tests for the Rokar POS cloud worker,
// driven through wrangler's local TestHarness (miniflare under the hood).
//
// Run: npm test   (builds first)
//
// Covers: health, signup (slug, trial window, token), login, the real
// migrations proving their seeds (settings currency 'Rs'), the full real
// inventory + activity + users + settings service surface via /api/rpc, the
// owner gate on settings:set, credential failures, auth failures, second-shop
// isolation (incl. the fresh-shop admin rename), and the trial-expiry 402 gate
// (login stays allowed).

import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createTestHarness } from 'wrangler';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The desktop app version, which the worker now reports from its own package.json. */
const APP_VERSION = JSON.parse(readFileSync(path.resolve(root, '..', 'package.json'), 'utf8')).version;

const DAY = 24 * 60 * 60 * 1000;

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` :: ${detail}` : ''}`);
  }
}

async function main() {
  const server = createTestHarness({
    root,
    workers: [
      {
        config: {
          name: 'rokar-pos',
          compatibility_date: '2026-09-30',
          compatibility_flags: ['nodejs_compat'],
          main: './dist/index.js',
          d1_databases: [{ binding: 'ACCOUNTS', database_name: 'rokar-accounts' }],
          durable_objects: { bindings: [{ name: 'SHOP', class_name: 'ShopObject' }] },
          migrations: [{ tag: 'v1', new_sqlite_classes: ['ShopObject'] }],
          assets: { directory: './web-dist', binding: 'ASSETS' },
        },
      },
    ],
  });

  await server.listen();
  const worker = server.getWorker('rokar-pos');
  const env = await worker.getEnv();

  async function api(pathname, { method = 'GET', token, body } = {}) {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    return worker.fetch(pathname, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function rpc(token, channel, args) {
    return api('/api/rpc', { method: 'POST', token, body: { channel, args: args ?? [] } });
  }

  /** rpc + parsed JSON body in one call (avoids double-reading the response). */
  async function rpcData(token, channel, args) {
    const res = await rpc(token, channel, args);
    const body = await res.json();
    return { status: res.status, ...body };
  }

  try {
    console.log('== web app ==');
    const appHtml = await api('/');
    const appText = await appHtml.text();
    check('GET / serves HTML (200)', appHtml.status === 200 && /text\/html/i.test(appHtml.headers.get('content-type') || ''), `status=${appHtml.status} ct=${appHtml.headers.get('content-type')}`);
    check('app shell mounts #app', /\<div id="app"\>/.test(appText));
    check('app references its assets', /app\.js/.test(appText) && /style\.css/.test(appText));

    const appJs = await api('/app.js');
    const jsText = await appJs.text();
    check('GET /app.js serves JS', appJs.status === 200 && /javascript/i.test(appJs.headers.get('content-type') || ''), `status=${appJs.status}`);
    check('app.js is the Rokar dashboard', /rokar_web_session/.test(jsText) && /api\/signup/.test(jsText));

    const style = await api('/style.css');
    check('GET /style.css serves CSS', style.status === 200 && /css/i.test(style.headers.get('content-type') || ''), `status=${style.status}`);

    // The served app.js must be valid JavaScript — parse it with node --check.
    const tmp = path.join(root, '.tmp-app-check.js');
    await import('node:fs').then(async ({ writeFileSync, rmSync }) => {
      writeFileSync(tmp, jsText, 'utf8');
      try {
        const { execFileSync } = await import('node:child_process');
        execFileSync(process.execPath, ['--check', tmp]);
        check('served app.js parses (node --check)', true);
      } catch (e) {
        check('served app.js parses (node --check)', false, String(e && e.message));
      } finally {
        rmSync(tmp, { force: true });
      }
    });

    console.log('== real desktop app (/app) ==');
    // The full desktop renderer is built by `npm run build:web` into web-dist/app
    // and served under /app by the [assets] binding. Verify the artefact on disk,
    // then the HTTP surface through the harness.
    const fs = await import('node:fs');
    const distApp = path.join(root, 'web-dist', 'app');
    const indexHtml = fs.existsSync(path.join(distApp, 'index.html'))
      ? fs.readFileSync(path.join(distApp, 'index.html'), 'utf8')
      : '';
    check('web-dist/app/index.html built', indexHtml.length > 0 && /<div id="root">/.test(indexHtml));
    const bundleRef = indexHtml.match(/\/app\/assets\/[A-Za-z0-9_.-]+\.js/);
    check('index.html references a built bundle', !!bundleRef, bundleRef ? bundleRef[0] : 'none');
    if (bundleRef) {
      const bundlePath = path.join(root, 'web-dist', bundleRef[0].replace('/app/', 'app/'));
      check('built bundle exists on disk', fs.existsSync(bundlePath));
      if (fs.existsSync(bundlePath)) {
        const bundleText = fs.readFileSync(bundlePath, 'utf8');
        // The web bridge stores the shared web session key and calls /api/rpc, and
        // the entry pulls in the real desktop preload (window.api).
        check('bundle carries the web bridge (session key + /api/rpc)', bundleText.includes('rokar_web_session') && bundleText.includes('/api/rpc'));
        check('bundle ships the real renderer (desktop pages)', /Complete\s*Sale|sale|billing/i.test(bundleText));
        // Browsers reserve Ctrl+Shift+S, so the web bridge serves save+print as
        // Ctrl+Alt+S (see cloud/web/electron-browser.ts). The literal must survive
        // minification, and it is only ever produced by that patch.
        check('bundle carries the browser-safe save+print fallback', bundleText.includes('Ctrl+Alt+S') && bundleText.includes('save_print'));
      }
    }

    const appIndex = await api('/app/');
    const appIndexText = await appIndex.text();
    check(
      'GET /app/ serves the renderer HTML',
      appIndex.status === 200 && /text\/html/i.test(appIndex.headers.get('content-type') || '') && /<div id="root">/.test(appIndexText),
      `status=${appIndex.status} ct=${appIndex.headers.get('content-type')}`
    );
    if (bundleRef && appIndex.status === 200) {
      const webBundle = await api(bundleRef[0]);
      const webBundleText = await webBundle.text();
      check(
        'GET renderer bundle serves JS',
        webBundle.status === 200 && /javascript/i.test(webBundle.headers.get('content-type') || ''),
        `status=${webBundle.status}`
      );
      check('served renderer bundle matches the built one', webBundleText.length > 1000 && webBundleText.includes('rokar_web_session'));
    }

    console.log('== health ==');
    const h = await api('/api/health');
    const hb = await h.json();
    check('GET /api/health ok', h.status === 200 && hb.ok === true, `status=${h.status}`);

    console.log('== signup shop 1 (Cafe Roast) ==');
    const s1 = await api('/api/signup', {
      method: 'POST',
      body: { shopName: 'Cafe Roast', username: 'admin', password: 'shop-pass-1' },
    });
    const s1b = await s1.json();
    check('signup 201 + ok', s1.status === 201 && s1b.ok === true, `status=${s1.status}`);
    check('slugified shop slug', s1b.shop?.slug === 'cafe-roast', `slug=${s1b.shop?.slug}`);
    check('plan is trial', s1b.shop?.plan === 'trial', `plan=${s1b.shop?.plan}`);
    const trialDelta = new Date(s1b.shop?.trial_ends_at).getTime() - Date.now();
    check(
      'trial_ends_at ~+7d',
      trialDelta > 6.5 * DAY && trialDelta < 7.5 * DAY,
      `delta=${Math.round(trialDelta / DAY)}d`
    );
    const token1 = s1b.token;
    check('signup returns session token', typeof token1 === 'string' && token1.length > 10);
    check('seeded owner id is 1', s1b.user?.id === 1);

    console.log('== signup slug collision ==');
    const s1b2 = await api('/api/signup', {
      method: 'POST',
      body: { shopName: 'Cafe Roast', username: 'admin', password: 'shop-pass-2' },
    });
    const s1b2_json = await s1b2.json();
    check('collision gets -2 suffix', s1b2_json.shop?.slug === 'cafe-roast-2', `slug=${s1b2_json.shop?.slug}`);

    console.log('== login ==');
    const lgood = await api('/api/login', {
      method: 'POST',
      body: { shop: 'cafe-roast', username: 'admin', password: 'shop-pass-1' },
    });
    const lgoodb = await lgood.json();
    check('login success', lgood.status === 200 && lgoodb.ok === true && typeof lgoodb.token === 'string');
    check('login returns owner user', lgoodb.user?.role === 'owner' && lgoodb.user?.id === 1);
    check('login returns shop plan (web app state)', lgoodb.shop?.plan === 'trial' && /^\d{4}-\d{2}-\d{2}/.test(lgoodb.shop?.trial_ends_at || ''), `plan=${lgoodb.shop?.plan}`);
    const token1b = lgoodb.token;

    const lbad = await api('/api/login', {
      method: 'POST',
      body: { shop: 'cafe-roast', username: 'admin', password: 'wrong-pass' },
    });
    check('wrong password -> 401', lbad.status === 401, `status=${lbad.status}`);

    console.log('== rpc auth ==');
    const noTok = await api('/api/rpc', { method: 'POST', body: { channel: 'settings:getAll', args: [] } });
    check('rpc without token -> 401', noTok.status === 401, `status=${noTok.status}`);
    const badTok = await api('/api/rpc', { method: 'POST', token: 'not-a-token', body: { channel: 'settings:getAll', args: [] } });
    check('rpc with bad token -> 401', badTok.status === 401, `status=${badTok.status}`);

    console.log('== migrations + settings ==');
    const g1 = await rpc(token1b, 'settings:getAll', []);
    const g1b = await g1.json();
    check('settings:getAll ok', g1.status === 200 && g1b.ok === true);
    check('migration 002 currency seed "Rs"', g1b.data?.currency === 'Rs', `currency=${g1b.data?.currency}`);
    check(
      'bootstrap set shop_name to signup name',
      g1b.data?.shop_name === 'Cafe Roast',
      `shop_name=${g1b.data?.shop_name}`
    );

    console.log('== inventory (real service code) ==');
    const created = await rpc(token1b, 'inventory:create', [
      {
        name: 'Fresh Milk 1L',
        cost_price: 120,
        sale_price: 150,
        stock_qty: 20,
        low_stock_threshold: 5,
        units: [{ level: 0, name: 'Bottle', quantity_in_base_units: 1, is_base: true }],
      },
    ]);
    const createdb = await created.json();
    check('inventory:create ok', created.status === 200 && createdb.ok === true && createdb.data?.id, `err=${createdb.error}`);
    const pid = createdb.data?.id;
    check('auto barcode + name', typeof createdb.data?.barcode === 'string' && createdb.data?.name === 'Fresh Milk 1L');
    check('initial stock 20', createdb.data?.stock_qty === 20, `stock=${createdb.data?.stock_qty}`);

    const got = await rpc(token1b, 'inventory:get', [pid]);
    const gotb = await got.json();
    check('inventory:get returns product', gotb.ok === true && gotb.data?.name === 'Fresh Milk 1L');

    const listed = await rpc(token1b, 'inventory:list', []);
    const listedb = await listed.json();
    check('inventory:list contains product', Array.isArray(listedb.data) && listedb.data.some((p) => p.id === pid));

    const batches = await rpc(token1b, 'inventory:getBatches', [pid]);
    const batchesb = await batches.json();
    check('stock batch created', Array.isArray(batchesb.data) && batchesb.data.length >= 1);

    const units = await rpc(token1b, 'inventory:getUnits', [pid]);
    const unitsb = await units.json();
    check('base unit from create input', Array.isArray(unitsb.data) && unitsb.data.some((u) => u.name === 'Bottle' && u.is_base));

    const adj = await rpc(token1b, 'inventory:adjustStock', [pid, 5, 'Restock']);
    const adjb = await adj.json();
    check('adjustStock +5 -> 25', adjb.ok === true && adjb.data?.stock_qty === 25, `stock=${adjb.data?.stock_qty}`);

    const movements = await rpc(token1b, 'inventory:movements', [pid]);
    const movementsb = await movements.json();
    check('stock movements recorded', Array.isArray(movementsb.data) && movementsb.data.length >= 1);

    const cats = await rpc(token1b, 'inventory:categories', []);
    const catsb = await cats.json();
    check('categories list array', Array.isArray(catsb.data));
    const newCat = await rpc(token1b, 'inventory:createCategory', ['Beverages']);
    const newCatb = await newCat.json();
    check('createCategory ok', newCatb.ok === true && newCatb.data?.name === 'Beverages');

    const unitList = await rpc(token1b, 'inventory:units', []);
    const unitListb = await unitList.json();
    check('units list array', Array.isArray(unitListb.data));

    const low = await rpc(token1b, 'inventory:lowStock', []);
    const lowb = await low.json();
    check('lowStock list array', Array.isArray(lowb.data));

    console.log('== activity ==');
    const act = await rpc(token1b, 'activity:list', []);
    const actb = await act.json();
    check('activity recorded (product_created etc.)', Array.isArray(actb.data) && actb.data.length >= 1, `n=${actb.data?.length}`);

    console.log('== settings owner gate + users ==');
    const ss = await rpc(token1b, 'settings:set', ['shop_name', 'Cafe Roast HQ']);
    const ssb = await ss.json();
    check('settings:set ok', ssb.ok === true, `err=${ssb.error}`);
    const g2 = await rpc(token1b, 'settings:getAll', []);
    const g2b = await g2.json();
    check('settings updated', g2b.data?.shop_name === 'Cafe Roast HQ');

    const mkCashier = await rpc(token1b, 'users:create', [{ username: 'cashier1', password: 'pin-pass', pin: '1234', role: 'cashier' }]);
    const mkCashierb = await mkCashier.json();
    check('users:create cashier ok', mkCashierb.ok === true, `err=${mkCashierb.error}`);
    const cashierLogin = await api('/api/login', {
      method: 'POST',
      body: { shop: 'cafe-roast', username: 'cashier1', password: 'pin-pass' },
    });
    const cashierLoginb = await cashierLogin.json();
    check('cashier login ok', cashierLoginb.ok === true);
    const gated = await rpc(cashierLoginb.token, 'settings:set', ['shop_name', 'hax']);
    const gatedb = await gated.json();
    check('settings:set owner-gated', gatedb.ok === false && /owner/i.test(gatedb.error || ''), `err=${gatedb.error}`);

    const cu = await rpc(token1b, 'auth:currentUser', []);
    const cub = await cu.json();
    check('auth:currentUser as owner', cub.ok === true && cub.data?.username === 'admin' && cub.data?.role === 'owner');

    console.log('== full desktop IPC surface (reused ipc.ts) ==');
    // Open a shift so the real billing path (createSale requires one) can run.
    await rpc(token1b, 'shifts:open', [0]);

    // customers
    const cust = await rpcData(token1b, 'customers:create', ['Ali Raza', '0300-1234567']);
    check('customers:create ok', cust.ok === true && cust.data?.id, `err=${cust.error}`);
    const custId = cust.data?.id;
    const custList = await rpcData(token1b, 'customers:list', []);
    check(
      'customers:list contains customer',
      Array.isArray(custList.data) && custList.data.some((c) => c.id === custId)
    );
    check('customers:ledger ok', (await rpcData(token1b, 'customers:ledger', [custId])).ok === true);

    // a real sale through the real sales service
    const sale = await rpcData(token1b, 'sales:create', [
      {
        items: [{ product_id: pid, qty: 2, price: 150, line_discount: 0, tax_rate: 0, unit_name: 'Bottle' }],
        payments: [{ mode: 'Cash', amount: 300 }],
        customer_id: custId,
      },
    ]);
    check('sales:create ok', sale.ok === true && sale.data?.sale?.id, `err=${sale.error}`);
    const saleId = sale.data?.sale?.id;
    check(
      'sale has invoice number',
      typeof sale.data?.sale?.invoice_no === 'string' && sale.data.sale.invoice_no.length > 0,
      `invoice_no=${sale.data?.sale?.invoice_no}`
    );
    check('sale change is 0 (paid exactly)', sale.data?.change === 0, `change=${sale.data?.change}`);
    check('sales:get returns sale', (await rpcData(token1b, 'sales:get', [saleId])).data?.id === saleId);
    const saleList = await rpcData(token1b, 'sales:list', []);
    check('sales:list contains sale', Array.isArray(saleList.data) && saleList.data.some((s) => s.id === saleId));
    check('sale decremented stock (25 -> 23)', (await rpcData(token1b, 'inventory:get', [pid])).data?.stock_qty === 23);

    // reports (real reports service)
    check('reports:dashboard ok', (await rpcData(token1b, 'reports:dashboard', [])).ok === true);
    check('reports:salesReport ok', (await rpcData(token1b, 'reports:salesReport', [])).ok === true);
    check('reports:bestSellers is array', Array.isArray((await rpcData(token1b, 'reports:bestSellers', [])).data));
    check('reports:getDailyStats ok', (await rpcData(token1b, 'reports:getDailyStats', [])).ok === true);
    check('reports:getTaxReport ok', (await rpcData(token1b, 'reports:getTaxReport', [])).ok === true);
    check('reports:getFinancialReport ok', (await rpcData(token1b, 'reports:getFinancialReport', [])).ok === true);
    check('reports:getInventoryAnalysis ok', (await rpcData(token1b, 'reports:getInventoryAnalysis', [])).ok === true);
    check('reports:expenses is array', Array.isArray((await rpcData(token1b, 'reports:expenses', [])).data));

    // expenses + purchases writes
    check(
      'reports:addExpense ok',
      (
        await rpcData(token1b, 'reports:addExpense', [
          { title: 'Electricity', amount: 5000, category: 'Utilities', expense_date: '2026-10-01' },
        ])
      ).ok === true
    );
    check(
      'purchases:createSupplier ok',
      (await rpcData(token1b, 'purchases:createSupplier', ['Metro Wholesale', '0301-1112223'])).ok === true
    );
    check('purchases:suppliers is array', Array.isArray((await rpcData(token1b, 'purchases:suppliers', [])).data));
    check('purchases:orders is array', Array.isArray((await rpcData(token1b, 'purchases:orders', [])).data));

    // remaining families: registered + run through the reused desktop handlers
    check('returns:list is array', Array.isArray((await rpcData(token1b, 'returns:list', [])).data));
    check('audits:list is array', Array.isArray((await rpcData(token1b, 'audits:list', [])).data));
    check('promotions:list is array', Array.isArray((await rpcData(token1b, 'promotions:list', [])).data));
    check('shifts:list is array', Array.isArray((await rpcData(token1b, 'shifts:list', [])).data));
    check('quotations:list is array', Array.isArray((await rpcData(token1b, 'quotations:list', [])).data));
    check('branches:list is array', Array.isArray((await rpcData(token1b, 'branches:list', [])).data));
    check('commissions:rules is array', Array.isArray((await rpcData(token1b, 'commissions:rules', [])).data));
    check('fifo:stockReport ok', (await rpcData(token1b, 'fifo:stockReport', [])).ok === true);
    check(
      'scaleBarcode:listPluMappings is array',
      Array.isArray((await rpcData(token1b, 'scaleBarcode:listPluMappings', [])).data)
    );
    check('receipt:getTemplates ok', (await rpcData(token1b, 'receipt:getTemplates', [])).ok === true);
    check('printing:getPrinterSettings ok', (await rpcData(token1b, 'printing:getPrinterSettings', [])).ok === true);
    check('licensing:trialStatus ok', (await rpcData(token1b, 'licensing:trialStatus', [])).ok === true);
    check('app:get-version ok', (await rpcData(token1b, 'app:get-version', [])).data === APP_VERSION);

    console.log('== web printing (cloud:print bridge) ==');
    // A browser cannot run Electron's hidden print window, so printing is served
    // by src/print-bridge.ts: the SAME document builders the desktop handlers use
    // are called server-side and the HTML is returned for the browser to print.
    const receiptDoc = await rpcData(token1b, 'cloud:print', ['printing:printSale', [saleId]]);
    check(
      'cloud:print builds the receipt HTML',
      receiptDoc.ok === true &&
        typeof receiptDoc.data?.html === 'string' &&
        /<!DOCTYPE html>/i.test(receiptDoc.data.html) &&
        receiptDoc.data.html.includes(sale.data.sale.invoice_no),
      `err=${receiptDoc.error}`
    );
    const invoiceDoc = await rpcData(token1b, 'cloud:print', ['printing:printInvoice', [saleId]]);
    check(
      'cloud:print builds the invoice HTML (fixed A4 page)',
      invoiceDoc.ok === true && /@page[^}]*size:\s*210mm\s+297mm/i.test(invoiceDoc.data?.html || ''),
      `err=${invoiceDoc.error}`
    );
    const labelDoc = await rpcData(token1b, 'cloud:print', [
      'printing:printBarcodeBatch',
      [[pid], '38x25', 1],
    ]);
    check(
      'cloud:print builds the label batch HTML',
      labelDoc.ok === true && /class="label/.test(labelDoc.data?.html || ''),
      `err=${labelDoc.error}`
    );
    const drawerDoc = await rpcData(token1b, 'cloud:print', [
      'printing:printDrawerSummary',
      [{ opening_cash: 0, closing_cash: 0, cash_sales: 0, card_sales: 0, udhaar_sales: 0, other_payments: 0, cash_refunds: 0, cash_in: 0, cash_out: 0, expected_cash: 0, actual_cash: 0, variance: 0, opened_at: '', closed_at: '', cashier: 'admin' }],
    ]);
    check(
      'cloud:print builds the drawer summary HTML',
      drawerDoc.ok === true && /Cash Drawer Summary/i.test(drawerDoc.data?.html || ''),
      `err=${drawerDoc.error}`
    );
    const drawerPulse = await rpcData(token1b, 'cloud:print', ['printing:openCashDrawer', []]);
    check(
      'cloud:print refuses the cash drawer with a message',
      drawerPulse.ok === true &&
        drawerPulse.data?.ok === false &&
        /cash drawer/i.test(drawerPulse.data?.message || ''),
      `msg=${drawerPulse.data?.message}`
    );
    const exportDoc = await rpcData(token1b, 'cloud:print', ['printing:exportLabelBatchToPDF', [[pid], null, '38x25', 1]]);
    check(
      'cloud:print explains file export needs the desktop',
      exportDoc.ok === true && exportDoc.data?.ok === false,
      `msg=${exportDoc.data?.message}`
    );
    const unknownPrint = await rpcData(token1b, 'cloud:print', ['printing:nope', []]);
    check(
      'cloud:print rejects an unknown channel',
      unknownPrint.ok === true && unknownPrint.data?.ok === false,
      `msg=${unknownPrint.data?.message}`
    );

    console.log('== shop 2 (isolation + fresh-shop admin rename) ==');
    const s2 = await api('/api/signup', {
      method: 'POST',
      body: { shopName: 'Kebab House', username: 'kebab', password: 'kebab-pass-1' },
    });
    const s2b = await s2.json();
    check('signup 2 slug', s2b.shop?.slug === 'kebab-house', `slug=${s2b.shop?.slug}`);
    const l2 = await api('/api/login', {
      method: 'POST',
      body: { shop: 'kebab-house', username: 'kebab', password: 'kebab-pass-1' },
    });
    const l2b = await l2.json();
    check('login as renamed owner works', l2b.ok === true && l2b.user?.id === 1, `err=${l2b.error}`);
    const token2 = l2b.token;

    const g3 = await rpc(token2, 'settings:getAll', []);
    const g3b = await g3.json();
    check('shop 2 has fresh POS db (currency "Rs")', g3b.data?.currency === 'Rs');
    check('shop 2 not affected by shop 1 rename', g3b.data?.shop_name === 'Kebab House', `shop_name=${g3b.data?.shop_name}`);

    const users2 = await rpc(token2, 'users:list', []);
    const users2b = await users2.json();
    const firstUser2 = Array.isArray(users2b.data) ? users2b.data[0] : undefined;
    check('renamed owner is user id 1', firstUser2?.username === 'kebab' && firstUser2?.role === 'owner');

    const inv2 = await rpc(token2, 'inventory:list', []);
    const inv2b = await inv2.json();
    check('shop 2 inventory empty (isolation)', Array.isArray(inv2b.data) && inv2b.data.length === 0);

    const sale2 = await rpcData(token2, 'sales:list', []);
    check('shop 2 has no sales (isolation)', Array.isArray(sale2.data) && sale2.data.length === 0);
    const cust2 = await rpcData(token2, 'customers:list', []);
    check('shop 2 has no customers (isolation)', Array.isArray(cust2.data) && cust2.data.length === 0);
    check('shop 2 reports:dashboard ok', (await rpcData(token2, 'reports:dashboard', [])).ok === true);

    console.log('== trial expiry ==');
    try {
      await env.ACCOUNTS.prepare('UPDATE shops SET trial_ends_at = ? WHERE slug = ?')
        .bind(new Date(Date.now() - DAY).toISOString(), 'cafe-roast')
        .run();
    } catch (e) {
      check('trial expiry fixture (D1 mutation available)', false, String(e));
    }
    const expired = await rpc(token1b, 'auth:currentUser', []);
    const expiredb = await expired.json();
    check('authenticated rpc after trial end -> 402', expired.status === 402 && expiredb.error === 'trial_expired', `status=${expired.status} error=${expiredb.error}`);

    const loginAfterExpiry = await api('/api/login', {
      method: 'POST',
      body: { shop: 'cafe-roast', username: 'admin', password: 'shop-pass-1' },
    });
    const loginAfterExpiryb = await loginAfterExpiry.json();
    check('login still allowed after trial end', loginAfterExpiryb.ok === true && typeof loginAfterExpiryb.token === 'string');

    const shop2Still = await rpc(token2, 'settings:getAll', []);
    const shop2Stillb = await shop2Still.json();
    check('shop 2 unaffected by shop 1 expiry', shop2Stillb.ok === true);

    console.log('== manual activation (owner-gated) ==');
    const cashAct = await api('/api/activate', { method: 'POST', token: cashierLoginb.token });
    check('cashier cannot activate -> 403', cashAct.status === 403, `status=${cashAct.status}`);
    const ownerAct = await api('/api/activate', { method: 'POST', token: token1b });
    const ownerActb = await ownerAct.json();
    check(
      'owner activates -> plan active',
      ownerAct.status === 200 && ownerActb.ok === true && ownerActb.shop?.plan === 'active',
      `status=${ownerAct.status} plan=${ownerActb.shop?.plan}`
    );
    check('activation clears trial_ends_at', ownerActb.shop?.trial_ends_at === null);
    const noTokAct = await api('/api/activate', { method: 'POST' });
    check('activate without token -> 401', noTokAct.status === 401, `status=${noTokAct.status}`);
    const afterAct = await rpc(token1b, 'settings:getAll', []);
    const afterActb = await afterAct.json();
    check('rpc works again after activation', afterAct.status === 200 && afterActb.ok === true, `status=${afterAct.status}`);
  } catch (e) {
    check('suite ran without exception', false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    await server.close();
  }

  console.log('');
  console.log(`Result: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(' - ' + f);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main();