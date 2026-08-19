const crypto = require('crypto');
const SALT = 'pos-salt';

function hashSecret(secret) {
  return crypto.scryptSync(secret, SALT, 64).toString('hex');
}

exports.up = async (db) => {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!existing) {
    const passwordHash = hashSecret('admin123');
    const info = db
      .prepare('INSERT INTO users (username, password_hash, role, active, pin) VALUES (?, ?, ?, 1, NULL)')
      .run('admin', passwordHash, 'owner');
    console.log('Created default admin user id:', info.lastInsertRowid);
  } else {
    console.log('Admin user already exists');
  }
};

exports.down = async () => {
  // Migration rollback not implemented - admin user should not be deleted
};