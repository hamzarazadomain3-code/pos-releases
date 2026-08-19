exports.up = async (db) => {
  db.exec(`
    ALTER TABLE shifts ADD COLUMN expected_cash REAL;
    ALTER TABLE shifts ADD COLUMN variance REAL;
    ALTER TABLE shifts ADD COLUMN forced INTEGER DEFAULT 0;
    ALTER TABLE shifts ADD COLUMN notes TEXT;
    CREATE INDEX IF NOT EXISTS idx_shifts_user ON shifts(user_id);
  `);
};

exports.down = async (db) => {
  db.exec(`
    ALTER TABLE shifts DROP COLUMN expected_cash;
    ALTER TABLE shifts DROP COLUMN variance;
    ALTER TABLE shifts DROP COLUMN forced;
    ALTER TABLE shifts DROP COLUMN notes;
  `);
};
