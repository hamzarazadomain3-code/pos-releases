import { useEffect, useState } from 'react';
import type { ShiftDetail, ShiftRow } from '../../../shared/types';
import { formatDateTimeAdmin } from '../utils/dateUtils';
import { Modal } from '../components/Modal';
import { KeyboardInput } from '../components/KeyboardInput';
import { useListKeyboard } from '../hooks/useListKeyboard';
import { useKeyboardScope } from '../hooks/useKeyboardScope';

export default function Shifts() {
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [detail, setDetail] = useState<ShiftDetail | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [forceTarget, setForceTarget] = useState<ShiftRow | null>(null);
  const [forceCash, setForceCash] = useState('');
  const [forceNotes, setForceNotes] = useState('');

  const load = () => {
    window.api.shifts.list().then(setShifts).catch((e) => setNotice(e.message));
  };

  useEffect(() => {
    load();
  }, []);

  const viewShift = async (s: ShiftRow) => {
    try {
      setDetail(await window.api.shifts.get(s.id));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  const handleForceClose = async () => {
    if (!forceTarget) return;
    try {
      const counted = forceCash.trim() === '' ? undefined : Number(forceCash);
      if (counted !== undefined && (Number.isNaN(counted) || counted < 0)) {
        setNotice('Counted cash must be a valid non-negative amount');
        return;
      }
      const r = await window.api.shifts.forceClose(forceTarget.id, counted, forceNotes.trim() || undefined);
      setNotice(`Shift #${r.id} force-closed${r.variance !== 0 ? ` (variance ${r.variance})` : ''}`);
      setForceTarget(null);
      load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  // ── Keyboard: arrow between shifts, Enter opens the detail ──
  const shiftList = useListKeyboard({
    count: shifts.length,
    onOpen: (i) => { const s = shifts[i]; if (s) viewShift(s); },
  });

  const shiftSalesList = useListKeyboard({ count: detail?.sales.length ?? 0 });

  useKeyboardScope({
    kind: 'page',
    label: 'Shift History',
    shortcuts: [
      { keys: '↑ / ↓', label: 'Move between shifts' },
      { keys: 'Enter', label: 'View highlighted shift' },
    ],
  });

  return (
    <div className="page">
      <div className="page-header">
        <h1>Shift History</h1>
      </div>
      {notice && (
        <div className="notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}
      <div className="panel">
        <div className="table-wrap" {...shiftList.getContainerProps()}>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Cashier</th>
                <th>Start</th>
                <th>End</th>
                <th>Opening</th>
                <th>Expected</th>
                <th>Counted</th>
                <th>Variance</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((s, i) => (
                <tr key={s.id} {...shiftList.getRowProps(i)}>
                  <td>{s.id}</td>
                  <td>{s.username}</td>
                  <td>{s.opened_at ? formatDateTimeAdmin(s.opened_at) : '—'}</td>
                  <td>{s.closed_at ? formatDateTimeAdmin(s.closed_at) : '—'}</td>
                  <td>{s.start_cash.toFixed(2)}</td>
                  <td>{s.expected_cash !== null ? s.expected_cash.toFixed(2) : '—'}</td>
                  <td>{s.end_cash !== null ? s.end_cash.toFixed(2) : '—'}</td>
                  <td>
                    {s.variance !== null ? (
                      <span className={s.variance === 0 ? '' : s.variance > 0 ? 'text-ok' : 'text-danger'}>
                        {s.variance >= 0 ? '+' : ''}
                        {s.variance.toFixed(2)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {s.closed_at ? (
                      <span className={`badge ${s.forced ? 'badge-warn' : ''}`}>{s.forced ? 'Forced' : 'Closed'}</span>
                    ) : (
                      <span className="badge badge-ok">Open</span>
                    )}
                  </td>
                  <td>
                    {!s.closed_at && (
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => {
                          setForceTarget(s);
                          setForceCash('');
                          setForceNotes('');
                        }}
                      >
                        Force Close
                      </button>
                    )}
                    <button
                      className="btn btn-sm"
                      onClick={() => viewShift(s)}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
              {shifts.length === 0 && (
                <tr>
                  <td colSpan={10} className="muted center pad">
                    No shifts yet — cashiers open a shift from the Billing screen.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {forceTarget && (
        <Modal
          onClose={() => setForceTarget(null)}
          onSubmit={handleForceClose}
          title={`Force Close Shift #${forceTarget.id}`}
          className="modal-sm"
          label="Force Close Shift"
          shortcuts={[{ action: 'save', label: 'Force close shift' }]}
        >
            <p className="muted">
              {forceTarget.username} never closed this shift. Enter the counted cash if known — otherwise the expected
              amount is used (zero variance).
            </p>
            <label className="field">
              <span>Counted cash (optional)</span>
              <KeyboardInput
                type="text"
                decimals
                value={forceCash}
                onChange={(e) => setForceCash(e.target.value)}
                placeholder="Leave empty to use expected"
              />
            </label>
            <label className="field">
              <span>Notes (optional)</span>
              <input value={forceNotes} onChange={(e) => setForceNotes(e.target.value)} placeholder="e.g. cashier left without closing" />
            </label>
            <div className="modal-actions">
              <button className="btn" onClick={() => setForceTarget(null)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleForceClose}
              >
                Force Close
              </button>
            </div>
        </Modal>
      )}

      {detail && (
        <Modal
          onClose={() => setDetail(null)}
          title={`Shift #${detail.id} — ${detail.username}`}
          className="modal-wide"
          label="Shift Detail"
        >
            <p className="muted">
              {detail.opened_at ? formatDateTimeAdmin(detail.opened_at) : ''}
              {' → '}
              {detail.closed_at ? formatDateTimeAdmin(detail.closed_at) : 'still open'}
              {detail.forced ? ' · force-closed' : ''}
              {detail.notes ? ` · ${detail.notes}` : ''}
            </p>
            <div className="summary-row">
              <span>Opening cash</span>
              <span>{detail.start_cash.toFixed(2)}</span>
            </div>
            <div className="summary-row">
              <span>Cash sales</span>
              <span>{detail.cash_sales.toFixed(2)}</span>
            </div>
            <div className="summary-row">
              <span>Cash refunds</span>
              <span>-{detail.cash_refunds.toFixed(2)}</span>
            </div>
            <div className="summary-row">
              <span>Expected cash</span>
              <span>{(detail.expected_cash ?? detail.expected_preview).toFixed(2)}</span>
            </div>
            <div className="summary-row">
              <span>Counted cash</span>
              <span>{detail.end_cash !== null ? detail.end_cash.toFixed(2) : '—'}</span>
            </div>
            <div className="summary-row total">
              <span>Variance</span>
              <span>
                {detail.variance !== null ? (
                  <span className={detail.variance > 0 ? 'text-ok' : detail.variance < 0 ? 'text-danger' : ''}>
                    {detail.variance >= 0 ? '+' : ''}
                    {detail.variance.toFixed(2)}
                  </span>
                ) : (
                  '—'
                )}
              </span>
            </div>
            <div className="table-wrap" {...shiftSalesList.getContainerProps()}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Time</th>
                    <th>Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.sales.map((s, i) => (
                    <tr key={s.id} {...shiftSalesList.getRowProps(i)}>
                      <td>{s.invoice_no}</td>
                      <td>{s.created_at ? formatDateTimeAdmin(s.created_at) : '—'}</td>
                      <td>{s.total_amount.toFixed(2)}</td>
                      <td>
                        <span className={`badge ${s.status === 'voided' ? 'badge-danger' : ''}`}>{s.status}</span>
                      </td>
                    </tr>
                  ))}
                  {detail.sales.length === 0 && (
                    <tr>
                      <td colSpan={4} className="muted center pad">
                        No sales in this shift.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setDetail(null)}>
                Close
              </button>
            </div>
        </Modal>
      )}
    </div>
  );
}