const sqlite3 = require('node:sqlite');
const db = new sqlite3.DatabaseSync('E:/antigravty/db-copy/pos-copy.db');
function count(table, where) {
  try {
    const sql = 'SELECT COUNT(*) as c FROM ' + table + (where ? ' WHERE ' + where : '');
    const r = db.prepare(sql).get();
    return r.c;
  } catch (e) { return 'N/A (' + e.message + ')'; }
}
console.log('=== Phase B counts ===');
console.log('A7 test products (%Wiring Test Item%):', count('products', "name LIKE '%Wiring Test Item%'"));
console.log('A7 test products (INIT-%):', count('products', "sku LIKE 'INIT-%'"));
console.log('A7 test products (AG0ENT6N):', count('products', "barcode = 'AG0ENT6N'"));
const isTestCol = db.prepare("SELECT 1 FROM pragma_table_info('products') WHERE name='is_test'").all();
console.log('is_test column exists:', isTestCol.length > 0);
const hasCashDrawers = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cash_drawer_sessions'").all().length > 0;
console.log('cash_drawer_sessions exists:', hasCashDrawers);
if (hasCashDrawers) {
  console.log('A4 open cash drawers:', count('cash_drawer_sessions', "status != 'closed'"));
}
console.log('admin_settings:', count('admin_settings'));
console.log('alert_log rows:', count('alert_log'));
const dup = db.prepare("SELECT COUNT(*) as c FROM (SELECT alert_type, product_id, COUNT(*) cnt FROM alert_log GROUP BY alert_type, product_id HAVING cnt > 1)").all();
console.log('duplicate alerts by type+product:', dup[0].c);
console.log('promotions:', count('promotions'));
console.log('products with sale < cost (cost>0):', count('products', 'cost_price > 0 AND sale_price < cost_price'));
console.log('open shifts:', count('shifts', 'closed_at IS NULL'));
console.log('customers:', count('customers'));
console.log('users:', count('users'));
console.log('shifts (total):', count('shifts'));
console.log('sales (total):', count('sales'));
console.log('=== mojibake check ===');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
let mojibakeFound = false;
for (const tr of tables) {
  const cols = db.prepare('PRAGMA table_info(' + tr.name + ')').all();
  for (const c of cols) {
    if (c.type === 'TEXT') {
      try {
        const q = "SELECT COUNT(*) as c FROM " + tr.name + " WHERE " + c.name + " LIKE ? OR " + c.name + " LIKE ? OR " + c.name + " LIKE ?";
        const mr = db.prepare(q).get('%â€%', '%ðŸ%', '%Ã%');
        if (mr.c > 0) {
          console.log('MOJIBAKE: ' + tr.name + '.' + c.name + ' = ' + mr.c + ' rows');
          mojibakeFound = true;
        }
      } catch(e) {}
    }
  }
}
if (!mojibakeFound) console.log('No mojibake found in any TEXT column.');
db.close();