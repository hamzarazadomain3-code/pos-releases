import { useCallback, useEffect, useState } from 'react';
import type { UdhaarCatalogItem } from '../../../shared/types';
import { Modal } from './Modal';
import { KeyboardInput } from './KeyboardInput';
import { formatMoney } from '../utils/currency';

/**
 * Udhaar item catalog — the barcode → name/price memory the Add Udhaar dialog
 * falls back to for items that are not in Inventory. Owner-managed, with CSV
 * import/export so a shop can bulk-load its regular khata items.
 */

interface Draft {
  id?: number;
  barcode: string;
  name: string;
  price: string;
  unit: string;
}

const EMPTY: Draft = { barcode: '', name: '', price: '', unit: '' };

export interface UdhaarCatalogModalProps {
  onClose: () => void;
}

export function UdhaarCatalogModal({ onClose }: UdhaarCatalogModalProps) {
  const [items, setItems] = useState<UdhaarCatalogItem[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setItems(await window.api.udhaar.catalogList());
  }, []);

  useEffect(() => {
    load().catch((e) => setNotice(e instanceof Error ? e.message : String(e)));
  }, [load]);

  async function save() {
    if (!draft.name.trim()) {
      setNotice('Item name is required.');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await window.api.udhaar.catalogUpsert({
        id: draft.id,
        barcode: draft.barcode.trim() || null,
        name: draft.name.trim(),
        price: Number(draft.price) || 0,
        unit: draft.unit.trim() || null,
      });
      setDraft(EMPTY);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    setBusy(true);
    try {
      await window.api.udhaar.catalogDelete(id);
      if (draft.id === id) setDraft(EMPTY);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    setBusy(true);
    try {
      const ok = await window.api.udhaar.catalogExport();
      if (ok) setNotice('Catalog exported to CSV.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function importCsv() {
    setBusy(true);
    try {
      const res = await window.api.udhaar.catalogImport();
      setNotice(res.message);
      if (res.ok) await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const filtered = items.filter((it) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return it.name.toLowerCase().includes(q) || (it.barcode ?? '').toLowerCase().includes(q);
  });

  return (
    <Modal
      onClose={onClose}
      onSubmit={save}
      title="Udhaar item catalog"
      className="modal-wide"
      label="Udhaar catalog"
      shortcuts={[
        { action: 'save', label: 'Save item' },
        { keys: 'Esc', label: 'Close' },
      ]}
    >
      {notice && (
        <div className="notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}

      <div className="udhaar-options" style={{ alignItems: 'flex-end' }}>
        <label className="field">
          <span>Barcode</span>
          <KeyboardInput
            type="text"
            decimals={false}
            value={draft.barcode}
            onChange={(e) => setDraft({ ...draft, barcode: e.target.value })}
            placeholder="Optional"
          />
        </label>
        <label className="field" style={{ flex: 1 }}>
          <span>Name *</span>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="field">
          <span>Price</span>
          <KeyboardInput type="text" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} placeholder="0.00" />
        </label>
        <label className="field">
          <span>Unit</span>
          <input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="Piece" />
        </label>
        <button className="btn btn-primary" onClick={save} disabled={busy || !draft.name.trim()}>
          {draft.id ? 'Update' : 'Add item'}
        </button>
        {draft.id && (
          <button className="btn" onClick={() => setDraft(EMPTY)}>
            Cancel edit
          </button>
        )}
      </div>

      <div className="ledger-toolbar">
        <input placeholder="Search catalog…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn btn-sm" onClick={exportCsv} disabled={busy}>
          Export CSV
        </button>
        <button className="btn btn-sm" onClick={importCsv} disabled={busy}>
          Import CSV
        </button>
        <span className="muted small">{filtered.length} item(s)</span>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Barcode</th>
              <th>Name</th>
              <th>Unit</th>
              <th className="num">Price</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((it) => (
              <tr key={it.id}>
                <td className="muted">{it.barcode ?? '—'}</td>
                <td className="name">{it.name}</td>
                <td>{it.unit ?? '—'}</td>
                <td className="num">{formatMoney(it.price)}</td>
                <td>
                  <div className="row-actions">
                    <button
                      className="btn btn-sm"
                      onClick={() => setDraft({ id: it.id, barcode: it.barcode ?? '', name: it.name, price: String(it.price), unit: it.unit ?? '' })}
                    >
                      Edit
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => remove(it.id)} disabled={busy}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="muted center">
                  No catalog items yet. Add one above, or import a CSV (barcode, name, price, unit).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
