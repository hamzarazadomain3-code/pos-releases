exports.up = async (db) => {
  const cols = db.prepare('PRAGMA table_info(users)').all();
  if (!cols.some((c) => c.name === 'pin')) {
    db.exec('ALTER TABLE users ADD COLUMN pin TEXT');
  }
  if (!cols.some((c) => c.name === 'active')) {
    db.exec('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
  }
  db.exec(`
    UPDATE users SET role = 'owner' WHERE role = 'admin' OR role IS NULL OR role = '';
    UPDATE users SET role = 'owner' WHERE id = 1;
  `);
};

exports.down = async () => {};