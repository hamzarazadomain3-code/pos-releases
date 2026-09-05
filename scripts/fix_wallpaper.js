const {DatabaseSync} = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Hamza PC/AppData/Roaming/pos-app/pos.db');
db.prepare("DELETE FROM admin_settings WHERE key = 'wallpaper_image'").run();
console.log('wallpaper_image cleared');
const remaining = db.prepare("SELECT key, value FROM admin_settings WHERE key LIKE '%wallpaper%'").all();
console.log('Remaining wallpaper settings:', JSON.stringify(remaining));
