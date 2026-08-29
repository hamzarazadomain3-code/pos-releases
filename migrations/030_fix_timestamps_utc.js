exports.up = async (db) => {
  // Append 'Z' suffix to existing timestamps that don't have it
  db.exec(`
    UPDATE activity_log SET created_at = created_at || 'Z' 
    WHERE created_at IS NOT NULL AND created_at NOT LIKE '%Z';
    
    UPDATE audits SET created_at = created_at || 'Z' 
    WHERE created_at IS NOT NULL AND created_at NOT LIKE '%Z';
    
    UPDATE audits SET completed_at = completed_at || 'Z' 
    WHERE completed_at IS NOT NULL AND completed_at NOT LIKE '%Z';
    
    UPDATE cash_drawer_sessions SET opening_time = opening_time || 'Z' 
    WHERE opening_time IS NOT NULL AND opening_time NOT LIKE '%Z';
    
    UPDATE cash_drawer_sessions SET closing_time = closing_time || 'Z' 
    WHERE closing_time IS NOT NULL AND closing_time NOT LIKE '%Z';
    
    UPDATE shifts SET opened_at = opened_at || 'Z' 
    WHERE opened_at IS NOT NULL AND opened_at NOT LIKE '%Z';
    
    UPDATE shifts SET closed_at = closed_at || 'Z' 
    WHERE closed_at IS NOT NULL AND closed_at NOT LIKE '%Z';
    
    UPDATE sales SET created_at = created_at || 'Z' 
    WHERE created_at IS NOT NULL AND created_at NOT LIKE '%Z';
    
    UPDATE payments SET created_at = created_at || 'Z' 
    WHERE created_at IS NOT NULL AND created_at NOT LIKE '%Z';
  `);
};

exports.down = async (db) => {
  // Can't easily reverse - timestamps would need parsing
  // This migration is effectively irreversible
};