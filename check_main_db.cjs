const { createClient } = require('@libsql/client');
const db = createClient({ url: 'file:../pos.db', authToken: '' });

async function run() {
  try {
    const tables = await db.execute("SELECT name FROM sqlite_master WHERE type = 'table'");
    console.log('Tables:', tables.rows.map(r => r.name).join(', '));
    
    const cols = await db.execute("PRAGMA table_info(activity_log)");
    console.log('activity_log columns:', cols.rows.map(c => c.name + ':' + c.type).join(', '));
    
    const count = await db.execute('SELECT COUNT(*) as c FROM activity_log');
    console.log('activity_log count:', count.rows[0].c);
    
    if (count.rows[0].c > 0) {
      const sample = await db.execute('SELECT created_at FROM activity_log LIMIT 3');
      console.log('Sample created_at:', sample.rows.map(r => r.created_at).join(', '));
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
}
run();