const {DatabaseSync} = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Hamza PC/AppData/Roaming/pos-app/pos.db');
const rows = db.prepare("SELECT key, value FROM admin_settings WHERE key LIKE '%wallpaper%' OR key LIKE '%opacity%' OR key LIKE '%blur%' OR key LIKE '%brightness%' OR key LIKE '%tint%'").all();
for (const r of rows) {
  if (r.key === 'wallpaper_image') {
    console.log(r.key + ': [base64 length=' + (r.value || '').length + ' chars]');
  } else {
    console.log(r.key + ': ' + r.value);
  }
}
