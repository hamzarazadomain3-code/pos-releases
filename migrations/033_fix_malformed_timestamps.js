exports.up = async (db) => {
  // Fix malformed timestamps across all tables
  // 1. Replace space with 'T' separator: "2026-08-30 02:30:58" -> "2026-08-30T02:30:58"
  // 2. Append 'Z' suffix to UTC timestamps missing it
  // 3. Handle edge cases

  const tables = [
    'activity_log', 'created_at',
    'audits', 'created_at',
    'audits', 'completed_at',
    'shifts', 'opened_at',
    'shifts', 'closed_at',
    'sales', 'created_at',
    'payments', 'created_at',
    'purchase_orders', 'created_at',
    'cash_drawer_sessions', 'opening_time',
    'cash_drawer_sessions', 'closing_time',
    'customer_transactions', 'created_at',
    'supplier_transactions', 'created_at',
    'purchase_price_history', 'created_at',
    'returns', 'created_at',
    'promotions', 'start_date',
    'promotions', 'end_date',
    'product_batches', 'received_date',
    'product_batches', 'expiry_date',
    'stock_movements', 'created_at',
  ];

  for (let i = 0; i < tables.length; i += 2) {
    const table = tables[i];
    const column = tables[i + 1];
    
    // Check if table and column exist
    const tableInfo = db.prepare(`PRAGMA table_info(${table})`).all();
    const colExists = tableInfo.some((c) => c.name === column);
    if (!colExists) continue;

    // Fix space separator -> 'T' separator
    // Only fix rows that have space but not 'T', and look like datetime
    await db.exec(`
      UPDATE ${table}
      SET ${column} = REPLACE(${column}, ' ', 'T')
      WHERE ${column} IS NOT NULL
        AND ${column} LIKE '% %'
        AND ${column} NOT LIKE '%T%'
        AND ${column} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]';
    `);

    // Fix missing 'Z' on ISO-like strings (has 'T' but no Z/offset)
    // Pattern: YYYY-MM-DDTHH:MM:SS or YYYY-MM-DDTHH:MM:SS.sss
    await db.exec(`
      UPDATE ${table}
      SET ${column} = ${column} || 'Z'
      WHERE ${column} IS NOT NULL
        AND ${column} NOT LIKE '%Z'
        AND ${column} NOT LIKE '%+%'
        AND ${column} NOT LIKE '%-%'  -- This would match negative offset like -05:00
        AND ${column} LIKE '%T%'
        AND ${column} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*';
    `);
  }

  // Additional cleanup: Fix any remaining timestamps that have double T or other issues
  // Fix double T: "2026-08-30TT02:30:58" -> "2026-08-30T02:30:58"
  const fixTables = ['activity_log', 'audits', 'shifts', 'sales', 'payments', 'purchase_orders', 'cash_drawer_sessions'];
  for (const table of fixTables) {
    const tableInfo = db.prepare(`PRAGMA table_info(${table})`).all();
    const hasCreatedAt = tableInfo.some((c) => c.name === 'created_at');
    if (hasCreatedAt) {
      await db.exec(`
        UPDATE ${table}
        SET created_at = REPLACE(created_at, 'TT', 'T')
        WHERE created_at IS NOT NULL AND created_at LIKE '%TT%';
      `);
    }
  }
};

exports.down = async (db) => {
  // Migration is effectively irreversible (data correction)
  // Could attempt to reverse but not reliable
};