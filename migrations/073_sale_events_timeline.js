/**
 * PHASE 3d — Sales History timeline.
 *
 * 1. `sale_events` is the append-only timeline. One row per event (a sale and
 *    its later void are TWO rows), with the real timestamp, user, reason and a
 *    JSON snapshot where the source row may later change or disappear.
 * 2. `held_bills.deleted_at` turns a held-bill delete into a SOFT delete so the
 *    deleted bill + its snapshot remain visible in history. Existing
 *    `listHeldBills()` callers only see rows where `deleted_at IS NULL`.
 * 3. Seeds the optional `business_day_start_hour` setting (0 = midnight).
 * 4. Backfills events that were previously only implicit in `sales` / `returns`
 *    / `cash_refunds` / `held_bills` / `quotations`. The insert is `OR IGNORE`
 *    against a unique dedupe index, so running the migration again (or a DB
 *    restored from a backup) never duplicates a row.
 *
 * Additive and idempotent: no existing row is updated or deleted.
 */

function hasColumn(db, table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function hasTable(db, table) {
  return !!db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table);
}

function safeJson(text) {
  if (!text || typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Best-effort cart value from a held-bill payload (same fields Billing saves). */
function heldAmount(payload) {
  if (!payload || typeof payload !== 'object') return 0;
  const candidates = [payload.total, payload.payTotal, payload.grandTotal, payload.subtotal];
  for (const c of candidates) {
    const n = number(c);
    if (n) return Math.abs(n);
  }
  if (Array.isArray(payload.items)) {
    return Math.abs(
      payload.items.reduce((sum, line) => {
        const qty = number(line.qty ?? line.display_qty ?? 0);
        const price = number(line.price ?? line.unit_price ?? 0);
        return sum + qty * price;
      }, 0)
    );
  }
  return 0;
}

function reasonFromDetails(details) {
  if (!details) return null;
  const m = /reason=(.*)$/i.exec(String(details));
  return (m ? m[1] : String(details)).trim() || null;
}

exports.up = async (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sale_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      sale_id INTEGER,
      held_bill_id INTEGER,
      invoice_no TEXT,
      user_id INTEGER,
      amount REAL DEFAULT 0,
      reason TEXT,
      snapshot_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'utc') || 'Z')
    );
    CREATE INDEX IF NOT EXISTS idx_sale_events_created ON sale_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_sale_events_type ON sale_events(event_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_sale_events_sale ON sale_events(sale_id);
    CREATE INDEX IF NOT EXISTS idx_sale_events_held ON sale_events(held_bill_id);
  `);

  // Soft delete for held bills (additive; older DBs get the column now).
  if (!hasColumn(db, 'held_bills', 'deleted_at')) {
    db.exec('ALTER TABLE held_bills ADD COLUMN deleted_at TEXT');
  }

  // Idempotent dedupe key for the backfill + runtime writes.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_events_dedupe
      ON sale_events (
        event_type,
        IFNULL(sale_id, -1),
        IFNULL(held_bill_id, -1),
        created_at
      )
  `);

  // Optional business-day anchor (04:00 = a shop that closes after midnight).
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('business_day_start_hour', '0')").run();

  const insert = db.prepare(`
    INSERT OR IGNORE INTO sale_events
      (event_type, sale_id, held_bill_id, invoice_no, user_id, amount, reason, snapshot_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // ── Sales: every completed / returned / voided bill is an event. ──
  const sales = db.prepare('SELECT * FROM sales ORDER BY id').all();
  for (const s of sales) {
    const total = number(s.total_amount);
    const isReturn = s.status === 'returned';
    const type = isReturn ? 'return' : 'sale';
    const amount = isReturn ? -Math.abs(total) : total;
    insert.run(
      type,
      s.id,
      null,
      s.invoice_no,
      s.user_id ?? null,
      amount,
      null,
      JSON.stringify({ source: 'backfill', state: s.status }),
      s.created_at
    );

    if (s.status === 'voided') {
      // Runtime warms write the void event at the moment of the void; the
      // activity log timestamp can differ by milliseconds, so dedupe by
      // (event, sale) here rather than relying on the exact string.
      const alreadyVoided = db
        .prepare("SELECT 1 AS x FROM sale_events WHERE event_type = 'void' AND sale_id = ? LIMIT 1")
        .get(s.id);
      if (alreadyVoided) continue;
      const log = db
        .prepare(
          `SELECT * FROM activity_log
           WHERE action = 'sale_voided' AND entity = 'sale' AND entity_id = ?
           ORDER BY id DESC LIMIT 1`
        )
        .get(s.id);
      insert.run(
        'void',
        s.id,
        null,
        s.invoice_no,
        (log && log.user_id) ?? s.user_id ?? null,
        -Math.abs(total),
        log ? reasonFromDetails(log.details) : 'Void (historical; time not recorded)',
        JSON.stringify({ source: 'backfill', state: 'voided' }),
        (log && log.created_at) || s.created_at
      );
    }
  }

  // ── Legacy invoice returns (not the negative cart-return sale, which was
  //    already covered above). ──
  if (hasTable(db, 'returns')) {
    const rows = db
      .prepare(
        `SELECT r.*, s.invoice_no, s.status AS sale_status, s.user_id AS sale_user
         FROM returns r JOIN sales s ON s.id = r.sale_id
         ORDER BY r.id`
      )
      .all();
    for (const r of rows) {
      if (r.sale_status === 'returned') continue;
      insert.run(
        'return',
        r.sale_id,
        null,
        r.invoice_no,
        r.sale_user ?? null,
        -Math.abs(number(r.refund_amount)),
        r.reason ?? null,
        JSON.stringify({
          source: 'backfill',
          return_id: r.id,
          refund_mode: r.refund_mode,
          restock: !!r.restock,
        }),
        r.created_at
      );
    }
  }

  // ── Manual cash refunds. ──
  const refunds = db.prepare('SELECT * FROM cash_refunds ORDER BY id').all();
  for (const r of refunds) {
    insert.run(
      'cash_refund',
      null,
      null,
      null,
      r.user_id ?? null,
      -Math.abs(number(r.amount)),
      r.reason ?? null,
      JSON.stringify({ source: 'backfill', mode: r.mode, shift_id: r.shift_id }),
      r.created_at
    );
  }

  // ── Held bills that are still open. ──
  const holds = db
    .prepare("SELECT * FROM held_bills WHERE kind = 'held' AND deleted_at IS NULL ORDER BY id")
    .all();
  for (const h of holds) {
    const payload = safeJson(h.data);
    insert.run(
      'hold_created',
      null,
      h.id,
      `HOLD-${h.id}`,
      null,
      heldAmount(payload),
      null,
      h.data,
      h.created_at
    );
  }

  // ── Quotation conversions. ──
  const quotes = db
    .prepare('SELECT * FROM quotations WHERE converted_sale_id IS NOT NULL ORDER BY id')
    .all();
  for (const q of quotes) {
    insert.run(
      'quotation_converted',
      q.converted_sale_id,
      null,
      q.quote_no,
      q.user_id ?? null,
      0,
      null,
      JSON.stringify({ source: 'backfill', quote_no: q.quote_no }),
      q.converted_at || q.updated_at || q.created_at
    );
  }
};

exports.down = async (db) => {
  db.exec(`
    DROP INDEX IF EXISTS idx_sale_events_dedupe;
    DROP INDEX IF EXISTS idx_sale_events_held;
    DROP INDEX IF EXISTS idx_sale_events_sale;
    DROP INDEX IF EXISTS idx_sale_events_type;
    DROP INDEX IF EXISTS idx_sale_events_created;
    DROP TABLE IF EXISTS sale_events;
  `);
};
