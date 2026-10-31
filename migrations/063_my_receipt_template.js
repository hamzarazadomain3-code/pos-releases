/**
 * Migration 063 — "My receipt" one-time template
 *
 * Phase 2 removed every hardcoded branch address / phone / footer from the
 * rendering code and from the defaults for NEW installs. To keep an EXISTING
 * install's printed output exactly as it was, this one-time, idempotent
 * migration creates a saved template named "My receipt" and makes it the active
 * receipt template:
 *
 *   - The template carries no block text overrides. Every user-editable value
 *     (address, phone, WhatsApp, terms, header lines) resolves LIVE through
 *     shared/renderDocument.ts: template override -> branch override -> Shop
 *     Profile (settings) -> empty. So the receipt prints exactly what the shop
 *     has configured today, and later edits in Settings or the Designer flow
 *     through instead of being shadowed by a stale snapshot.
 *   - Install safety: when a design has ALREADY been applied
 *     (`receipt_design_json` exists), it wins — the library default is NOT set,
 *     so a customised install keeps printing its own design. The "My receipt"
 *     template is still created so it is available in the Designer.
 *
 * Idempotent: if a "my-receipt" template already exists, nothing changes.
 */
exports.up = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(table).length > 0;
  if (!hasTable('admin_settings')) return;

  const readAdmin = (key) => {
    try {
      const row = db.prepare('SELECT value FROM admin_settings WHERE key = ?').get(key);
      return row && row.value != null ? String(row.value) : '';
    } catch {
      return '';
    }
  };

  let lib = {};
  const raw = readAdmin('receipt_design_library_json');
  if (raw) {
    try {
      lib = JSON.parse(raw);
    } catch {
      lib = {};
    }
  }
  const templates = Array.isArray(lib.templates) ? lib.templates : [];

  // Already migrated (or the owner already made one) — never touch it again.
  if (templates.some((t) => t && (t.id === 'my-receipt' || /^my receipt$/i.test(String(t.name || ''))))) return;

  const now = Date.now();
  const entry = {
    id: 'my-receipt',
    name: 'My receipt',
    // No overrides captured on purpose: values resolve live from the Shop
    // Profile at print time (see the header comment). Normalisation fills the
    // full default section list for a receipt.
    design: {
      schemaVersion: 1,
      documentType: 'receipt',
      paper: 'thermal80',
    },
    builtin: false,
    createdAt: now,
    updatedAt: now,
  };

  const next = {
    schemaVersion: lib.schemaVersion || 1,
    templates: [...templates, entry],
    documentTypeDefaults: { ...(lib.documentTypeDefaults || {}) },
    defaults: { ...(lib.defaults || {}) },
    branchDefaults: { ...(lib.branchDefaults || {}) },
  };

  // Only make it ACTIVE when the install never applied a custom design —
  // otherwise `receipt_design_json` must keep driving the printer.
  const applied = readAdmin('receipt_design_json');
  const setValue = db.prepare(
    'INSERT OR REPLACE INTO admin_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
  );
  if (!applied) {
    next.defaults.thermal80 = 'my-receipt';
    next.defaults.thermal58 = 'my-receipt';
    next.documentTypeDefaults.receipt = 'my-receipt';
    setValue.run('receipt_design_enabled', 'true');
  }

  setValue.run('receipt_design_library_json', JSON.stringify(next));
};

exports.down = function (db) {
  const hasTable = (table) =>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(table).length > 0;
  if (!hasTable('admin_settings')) return;

  try {
    const row = db.prepare('SELECT value FROM admin_settings WHERE key = ?').get('receipt_design_library_json');
    if (!row || !row.value) return;
    const lib = JSON.parse(String(row.value));
    lib.templates = (Array.isArray(lib.templates) ? lib.templates : []).filter((t) => t && t.id !== 'my-receipt');
    for (const key of ['thermal80', 'thermal58']) {
      if (lib.defaults && lib.defaults[key] === 'my-receipt') delete lib.defaults[key];
    }
    if (lib.documentTypeDefaults && lib.documentTypeDefaults.receipt === 'my-receipt') {
      delete lib.documentTypeDefaults.receipt;
    }
    db.prepare('UPDATE admin_settings SET value = ? WHERE key = ?').run(JSON.stringify(lib), 'receipt_design_library_json');
  } catch {
    /* down() is best-effort */
  }
};
