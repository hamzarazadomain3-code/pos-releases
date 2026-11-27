/**
 * Migration 091 — backfill `purchase_items.received_qty` from the LEGACY
 * `quantity_received`.
 *
 * The Purchase Order screen grew TWO counters for the same thing:
 *
 *   - `quantity_received` — added by migration 024 (the ORIGINAL counter; a
 *     NULL there meant "fully received").
 *   - `received_qty`      — added by migration 064 (the counter every screen
 *     reads today).
 *
 * Since migration 064 the service writes BOTH columns, so a new row is
 * always consistent. But every row created BEFORE migration 064 has
 * `received_qty = 0` (the column's default) and its real number in
 * `quantity_received`. For those legacy orders the screen said "nothing
 * received" while the shop had already taken the goods in — and the new
 * cancel-after-receive guard (Phase 3) would have let the owner cancel an
 * order whose stock was on the shelf.
 *
 * The backfill:
 *   1. copies `quantity_received` into `received_qty` where the legacy column
 *      holds a POSITIVE number and the new one is still empty,
 *   2. marks a line of a `received` order as fully received when neither
 *      counter says anything (the legacy "NULL = fully received" rule),
 *   3. leaves every other row untouched.
 *
 * Additive and idempotent: it only ever fills an EMPTY counter, so running
 * it twice changes nothing and it can never lower a number.
 */
exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) ? true : false;
  const hasColumn = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);

  if (!hasTable('purchase_items') || !hasTable('purchase_orders')) return;
  if (!hasColumn('purchase_items', 'received_qty')) return;
  if (!hasColumn('purchase_items', 'quantity_received')) return;

  // ── 1. the legacy counter wins when the new one is still empty ────────────
  const legacy = db
    .prepare(
      `UPDATE purchase_items
          SET received_qty = quantity_received
        WHERE COALESCE(received_qty, 0) = 0
          AND COALESCE(quantity_received, 0) > 0`
    )
    .run();
  if (legacy.changes > 0) {
    console.log(`[migration 091] Backfilled received_qty on ${legacy.changes} purchase line(s)`);
  }

  // ── 2. a received order with no counter at all = fully received ───────────
  const legacyNull = db
    .prepare(
      `UPDATE purchase_items
          SET received_qty = qty
        WHERE COALESCE(received_qty, 0) = 0
          AND purchase_order_id IN (
            SELECT id FROM purchase_orders WHERE status IN ('received', 'partially_received')
          )`
    )
    .run();
  if (legacyNull.changes > 0) {
    console.log(`[migration 091] Marked ${legacyNull.changes} received line(s) as fully received`);
  }

  // ── 3. the two counters now agree on every row that has a number ─────────
  const drift = db
    .prepare(
      `SELECT COUNT(*) AS c
         FROM purchase_items
        WHERE COALESCE(received_qty, 0) > 0
          AND COALESCE(quantity_received, 0) <> COALESCE(received_qty, 0)`
    )
    .get();
  if (drift && drift.c > 0) {
    db.prepare(
      `UPDATE purchase_items
          SET quantity_received = received_qty
        WHERE COALESCE(received_qty, 0) > 0
          AND COALESCE(quantity_received, 0) <> COALESCE(received_qty, 0)`
    ).run();
    console.log(`[migration 091] Synced quantity_received on ${drift.c} purchase line(s)`);
  }
};

exports.down = function () {
  // Non-destructive: the received quantities are the shop's own records.
};
