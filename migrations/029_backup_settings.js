exports.up = function (db) {
  // Add admin settings for backup folder and last backup timestamp
  const insert = db.prepare('INSERT OR IGNORE INTO admin_settings (key, value) VALUES (?, ?)');
  insert.run('backup_folder', '');
  insert.run('backup_last', '');
};

exports.down = function (db) {
  // Remove the settings added in the up migration
  const del = db.prepare('DELETE FROM admin_settings WHERE key = ?');
  del.run('backup_folder');
  del.run('backup_last');
};
