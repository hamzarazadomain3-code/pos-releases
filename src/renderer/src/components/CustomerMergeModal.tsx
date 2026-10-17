import { useEffect, useMemo, useState } from 'react';
import type { Customer } from '../../../shared/types';
import { Modal } from './Modal';
import { SearchInput } from './filters';
import { formatMoney } from '../utils/currency';

export interface CustomerMergeModalProps {
  /** The customer being merged away (their history moves to the target). */
  source: Customer;
  onClose: () => void;
  /** Called after a successful merge — the source no longer exists. */
  onMerged: () => void;
}

/**
 * Owner-only: fold a duplicate customer into a real one. Every ledger row, sale
 * and udhaar item held by the source is re-pointed at the target, the target's
 * balance is re-derived from the transactions, and the source row is deleted.
 */
export function CustomerMergeModal({ source, onClose, onMerged }: CustomerMergeModalProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.api.customers
      .list()
      .then((list) => setCustomers(list.filter((c) => c.id !== source.id)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [source.id]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return customers
      .filter(
        (c) =>
          !term ||
          c.name.toLowerCase().includes(term) ||
          (c.phone ?? '').includes(term)
      )
      .slice(0, 100);
  }, [customers, search]);

  async function merge() {
    if (!selected || busy) return;
    const ok = window.confirm(
      `Merge “${source.name}” into “${selected.name}”?\n\nAll of ${source.name}'s transactions and sales move to ${selected.name}, and ${source.name} is deleted. This cannot be undone.`
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.api.customers.merge(source.id, selected.id);
      if (!res.ok) {
        setError(res.message || 'Could not merge the customers.');
        setBusy(false);
        return;
      }
      onMerged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      onSubmit={merge}
      title="Merge customer"
      label="Merge customer"
      className="modal-lg"
      actions={{ save: () => void merge() }}
      shortcuts={[{ keys: 'Esc', label: 'Close' }]}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={merge} disabled={busy || !selected}>
            {busy ? 'Merging…' : 'Merge'}
          </button>
        </>
      }
    >
      <div className="notice">
        Merging <strong>{source.name}</strong>
        {source.phone ? ` (${source.phone})` : ''} — balance {formatMoney(source.balance)} — into
        another customer. All history moves across and {source.name} is removed.
      </div>

      <div style={{ margin: '10px 0' }}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search the target customer…" debounceMs={200} />
      </div>

      {error && <div className="notice error">{error}</div>}

      <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th />
              <th>Name</th>
              <th>Phone</th>
              <th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => (
              <tr
                key={c.id}
                className={selected?.id === c.id ? 'row-low' : ''}
                onClick={() => setSelected(c)}
                style={{ cursor: 'pointer' }}
              >
                <td>
                  <input type="radio" checked={selected?.id === c.id} onChange={() => setSelected(c)} />
                </td>
                <td>
                  <strong>{c.name}</strong>
                  {(c.status ?? 'active') === 'inactive' && (
                    <span className="badge" style={{ marginLeft: 6 }}>Inactive</span>
                  )}
                </td>
                <td>{c.phone ?? '—'}</td>
                <td className={`num ${c.balance > 0 ? 'text-warn' : 'text-ok'}`}>{c.balance.toFixed(2)}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={4} className="muted center">
                  No other customers to merge into.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
