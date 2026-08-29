import { useEffect, useState } from 'react';
import type { ShortcutRow } from '../../../../shared/types';

export default function ShortcutKeys() {
  const [shortcuts, setShortcuts] = useState<ShortcutRow[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const s = await window.api.admin.shortcuts.getAll();
      setShortcuts(s);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = shortcuts.filter(
    (s) =>
      s.action.toLowerCase().includes(search.toLowerCase()) ||
      s.description?.toLowerCase().includes(search.toLowerCase()) ||
      s.shortcut_key.toLowerCase().includes(search.toLowerCase())
  );

  const startEdit = (action: string, currentKey: string) => {
    setEditing(action);
    setEditValue(currentKey);
  };

  const saveShortcut = async (action: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await window.api.admin.shortcuts.update(action, editValue);
      await load();
      setEditing(null);
      setNotice('Shortcut updated');
      setTimeout(() => setNotice(null), 2000);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const resetAll = async () => {
    if (!confirm('Reset all shortcuts to defaults?')) return;
    setBusy(true);
    try {
      await window.api.admin.shortcuts.reset();
      await load();
      setNotice('All shortcuts reset to defaults');
      setTimeout(() => setNotice(null), 2000);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <div className="admin-sub-page">
      <div className="admin-sub-header">
        <h2>Keyboard Shortcuts</h2>
        <div className="admin-sub-actions">
          <input
            className="search-input"
            placeholder="Search shortcuts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn" onClick={resetAll} disabled={busy}>Reset to Defaults</button>
        </div>
      </div>

      {notice && <div className="notice" onClick={() => setNotice(null)}>{notice}</div>}

      <div className="shortcut-list">
        {filtered.map((s) => (
          <div key={s.action} className="shortcut-row">
            <div className="shortcut-info">
              <span className="shortcut-action">{s.description || s.action}</span>
              <span className="shortcut-key-label">{s.action}</span>
            </div>
            <div className="shortcut-controls">
              {editing === s.action ? (
                <>
                  <input
                    className="shortcut-input"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveShortcut(s.action)}
                    autoFocus
                  />
                  <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => saveShortcut(s.action)}>
                    Save
                  </button>
                  <button className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <kbd className="shortcut-display">{s.shortcut_key}</kbd>
                  <button className="btn btn-sm" onClick={() => startEdit(s.action, s.shortcut_key)}>
                    Edit
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
