exports.up = async (db) => {
  // Append 'Z' suffix to existing activity_log timestamps that don't have it
  db.exec(`
    UPDATE activity_log SET created_at = created_at || 'Z' 
    WHERE created_at IS NOT NULL AND created_at NOT LIKE '%Z';
  `);
};

exports.down = async (db) => {
  // Can't easily reverse - timestamps would need parsing
  // This migration is effectively irreversible
};