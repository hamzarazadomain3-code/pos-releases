const sqlite3 = require('node:sqlite');
const db = new sqlite3.DatabaseSync('E:/antigravty/db-copy/pos-copy.db');
console.log('PRAGMA table_info(cash_drawer_sessions):');
const info = db.prepare('PRAGMA table_info(cash_drawer_sessions)').all();
console.log(JSON.stringify(info));
const c1 = db.prepare("SELECT COUNT(*) as c FROM cash_drawer_sessions").get();
console.log('total cash_drawer_sessions:', c1.c);
try {
  const c2 = db.prepare("SELECT COUNT(*) as c FROM cash_drawer_sessions WHERE closed_at IS NULL OR closed_at = ''").get();
  console.log('unclosed (closed_at null/empty):', c2.c);
} catch(e) {
  console.log('err1:', e.message);
}
try {
  const c3 = db.prepare("SELECT COUNT(*) as c FROM cash_drawer_sessions WHERE closing_time IS NULL OR closing_time = ''").get();
  console.log('unclosed (closing_time null/empty):', c3.c);
} catch(e) {
  console.log('err2:', e.message);
}
db.close();