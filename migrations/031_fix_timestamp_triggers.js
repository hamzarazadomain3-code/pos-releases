exports.up = async (db) => {
  // Add triggers to set UTC timestamps with proper ISO 8601 format (Z suffix)
  // Using strftime for proper format: 2026-08-29T20:22:11Z
  db.exec(`
    -- sales.created_at
    CREATE TRIGGER IF NOT EXISTS sales_set_created_at
    AFTER INSERT ON sales
    WHEN NEW.created_at IS NULL OR NEW.created_at = ''
    BEGIN
      UPDATE sales SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
    END;

    -- shifts.opened_at
    CREATE TRIGGER IF NOT EXISTS shifts_set_opened_at
    AFTER INSERT ON shifts
    WHEN NEW.opened_at IS NULL OR NEW.opened_at = ''
    BEGIN
      UPDATE shifts SET opened_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
    END;

    -- payments.created_at
    CREATE TRIGGER IF NOT EXISTS payments_set_created_at
    AFTER INSERT ON payments
    WHEN NEW.created_at IS NULL OR NEW.created_at = ''
    BEGIN
      UPDATE payments SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
    END;

    -- purchase_orders.created_at
    CREATE TRIGGER IF NOT EXISTS purchase_orders_set_created_at
    AFTER INSERT ON purchase_orders
    WHEN NEW.created_at IS NULL OR NEW.created_at = ''
    BEGIN
      UPDATE purchase_orders SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
    END;

    -- audits.created_at
    CREATE TRIGGER IF NOT EXISTS audits_set_created_at
    AFTER INSERT ON audits
    WHEN NEW.created_at IS NULL OR NEW.created_at = ''
    BEGIN
      UPDATE audits SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
    END;

    -- cash_drawer_sessions.opening_time
    CREATE TRIGGER IF NOT EXISTS cash_drawer_sessions_set_opening_time
    AFTER INSERT ON cash_drawer_sessions
    WHEN NEW.opening_time IS NULL OR NEW.opening_time = ''
    BEGIN
      UPDATE cash_drawer_sessions SET opening_time = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
    END;

    -- activity_log.created_at
    CREATE TRIGGER IF NOT EXISTS activity_log_set_created_at
    AFTER INSERT ON activity_log
    WHEN NEW.created_at IS NULL OR NEW.created_at = ''
    BEGIN
      UPDATE activity_log SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
    END;
  `);
};

exports.down = async (db) => {
  db.exec(`
    DROP TRIGGER IF EXISTS sales_set_created_at;
    DROP TRIGGER IF EXISTS shifts_set_opened_at;
    DROP TRIGGER IF EXISTS payments_set_created_at;
    DROP TRIGGER IF EXISTS purchase_orders_set_created_at;
    DROP TRIGGER IF EXISTS audits_set_created_at;
    DROP TRIGGER IF EXISTS cash_drawer_sessions_set_opening_time;
    DROP TRIGGER IF EXISTS activity_log_set_created_at;
  `);
};