import { useEffect, useState, useCallback } from 'react';
import type { CashDrawerBreakdown, CashDrawerSession, ShiftRow, UserRow } from '../../../shared/types';
import { formatDateTimeAdmin, formatTimeAdmin } from '../utils/dateUtils';

interface Props {
  shift: ShiftRow;
  onClose: () => void;
}

export default function CashDrawer({ shift, onClose }: Props) {
  const [session, setSession] = useState<CashDrawerSession | null>(null);
  const [breakdown, setBreakdown] = useState<CashDrawerBreakdown | null>(null);
  const [openingCash, setOpeningCash] = useState('5000');
  const [closingCash, setClosingCash] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());
  const [confirmClose, setConfirmClose] = useState(false);
  const [user, setUser] = useState<UserRow | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await window.api.cashDrawer.getCurrent(shift.id);
      setSession(s);
      if (s) {
        const b = await window.api.cashDrawer.getBreakdown(shift.id);
        setBreakdown(b);
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }, [shift.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    window.api.auth.currentUser().then(setUser).catch(() => undefined);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const handleOpen = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const s = await window.api.cashDrawer.open(shift.id, Number(openingCash) || 0);
      setSession(s);
      const b = await window.api.cashDrawer.getBreakdown(shift.id);
      setBreakdown(b);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const handleClose = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await window.api.cashDrawer.close(shift.id, Number(closingCash) || 0, notes.trim() || undefined);
      onClose();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const handlePrintSummary = () => {
    if (!session || !breakdown) return;
    const actualCash = Number(closingCash) || 0;
    const cashIn = (breakdown as any).cash_in ?? 0;
    const cashOut = (breakdown as any).cash_out ?? 0;
    const otherPayments = (breakdown as any).cheque_sales + (breakdown as any).easypaisa_sales + (breakdown as any).jazzcash_sales;
    window.api.printing.printDrawerSummary({
      opening_cash: session.opening_cash,
      closing_cash: actualCash,
      cash_sales: breakdown.cash_sales,
      card_sales: breakdown.card_sales,
      udhaar_sales: breakdown.udhaar_sales,
      other_payments: otherPayments,
      cash_refunds: breakdown.refunds,
      cash_in: cashIn,
      cash_out: cashOut,
      expected_cash: expectedBalance,
      actual_cash: actualCash,
      variance: actualCash - expectedBalance,
      opened_at: formatDateTimeAdmin(session.opening_time),
      closed_at: formatDateTimeAdmin(new Date().toISOString()),
      cashier: user?.username ?? session.opened_by_name ?? '—',
      notes: notes.trim() || undefined,
    }).catch(() => setNotice('Print failed'));
  };

  const totalReceived = breakdown
    ? breakdown.cash_sales + breakdown.card_sales + breakdown.cheque_sales +
      breakdown.easypaisa_sales + breakdown.jazzcash_sales + breakdown.udhaar_sales
    : 0;

  const expectedBalance = session && breakdown
    ? session.opening_cash + breakdown.cash_sales - breakdown.refunds
    : 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal cash-drawer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cash-drawer-header">
          <h2>Cash Drawer Session</h2>
          <button className="btn btn-sm" onClick={onClose}>✕</button>
        </div>

        {notice && <div className="notice" onClick={() => setNotice(null)}>{notice}</div>}

        {!session ? (
          <div className="cash-drawer-body">
            <div className="cash-drawer-section">
              <div className="section-title">Open Cash Drawer</div>
              <p className="muted small">Shift #{shift.id} — {shift.username}</p>
              <div className="cash-drawer-grid">
                <div className="cash-drawer-stat">
                  <span className="stat-label">Opening Time</span>
                  <span className="stat-value">{now.toLocaleTimeString()}</span>
                </div>
                <div className="cash-drawer-stat">
                  <span className="stat-label">Status</span>
                  <span className="stat-value text-warn">Not Opened</span>
                </div>
              </div>
              <label className="field" style={{ marginTop: 12 }}>
                <span>Opening Cash (Rs)</span>
                <input
                  type="number"
                  min="0"
                  value={openingCash}
                  onChange={(e) => setOpeningCash(e.target.value)}
                />
              </label>
            </div>
            <div className="cash-drawer-actions">
              <button className="btn btn-primary" disabled={busy} onClick={handleOpen}>
                {busy ? 'Opening...' : 'Open Drawer'}
              </button>
              <button className="btn" onClick={onClose}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="cash-drawer-body">
            {/* Drawer Status */}
            <div className="cash-drawer-section">
              <div className="section-title">Drawer Status</div>
              <div className="cash-drawer-grid">
                <div className="cash-drawer-stat">
                  <span className="stat-label">Opening Time</span>
                  <span className="stat-value">{formatDateTimeAdmin(session.opening_time)}</span>
                </div>
                <div className="cash-drawer-stat">
                  <span className="stat-label">Opening Cash</span>
                  <span className="stat-value">Rs {session.opening_cash.toFixed(2)}</span>
                </div>
                <div className="cash-drawer-stat">
                  <span className="stat-label">Opened By</span>
                  <span className="stat-value">{session.opened_by_name ?? '—'}</span>
                </div>
                <div className="cash-drawer-stat">
                  <span className="stat-label">Current Time</span>
                  <span className="stat-value">{now.toLocaleTimeString()}</span>
                </div>
                <div className="cash-drawer-stat">
                  <span className="stat-label">Status</span>
                  <span className="stat-value text-ok">Opened</span>
                </div>
                <div className="cash-drawer-stat">
                  <span className="stat-label">Expected Balance</span>
                  <span className="stat-value">Rs {expectedBalance.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Session Info */}
            {breakdown && (
              <div className="cash-drawer-section">
                <div className="section-title">Session Info</div>
                <div className="cash-drawer-grid">
                  <div className="cash-drawer-stat">
                    <span className="stat-label">Total Sales Today</span>
                    <span className="stat-value">Rs {totalReceived.toFixed(2)}</span>
                  </div>
                  <div className="cash-drawer-stat">
                    <span className="stat-label">Total Bills</span>
                    <span className="stat-value">{breakdown.total_bills}</span>
                  </div>
                  <div className="cash-drawer-stat">
                    <span className="stat-label">Average Bill</span>
                    <span className="stat-value">Rs {breakdown.average_bill.toFixed(2)}</span>
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <button className="btn btn-sm" onClick={handlePrintSummary}>Print Drawer Summary</button>
                </div>
              </div>
            )}

            {/* Payment Breakdown */}
            {breakdown && (
              <div className="cash-drawer-section">
                <div className="section-title">Payment Breakdown</div>
                <div className="cash-drawer-breakdown">
                  <div className="breakdown-row">
                    <span>Cash Sales</span>
                    <span className="num">Rs {breakdown.cash_sales.toFixed(2)}</span>
                  </div>
                  <div className="breakdown-row">
                    <span>Card Sales</span>
                    <span className="num">Rs {breakdown.card_sales.toFixed(2)}</span>
                  </div>
                  <div className="breakdown-row">
                    <span>Cheques</span>
                    <span className="num">Rs {breakdown.cheque_sales.toFixed(2)}</span>
                  </div>
                  <div className="breakdown-row">
                    <span>Easypaisa</span>
                    <span className="num">Rs {breakdown.easypaisa_sales.toFixed(2)}</span>
                  </div>
                  <div className="breakdown-row">
                    <span>JazzCash</span>
                    <span className="num">Rs {breakdown.jazzcash_sales.toFixed(2)}</span>
                  </div>
                  <div className="breakdown-row">
                    <span>Udhaar / Credit</span>
                    <span className="num">Rs {breakdown.udhaar_sales.toFixed(2)}</span>
                  </div>
                  <div className="breakdown-row total">
                    <span>Refunds</span>
                    <span className="num text-warn">-Rs {breakdown.refunds.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Close Drawer */}
            {!confirmClose ? (
              <div className="cash-drawer-section">
                <div className="section-title">Close Drawer</div>
                <label className="field">
                  <span>Counted Cash (Rs)</span>
                  <input
                    type="number"
                    min="0"
                    value={closingCash}
                    onChange={(e) => setClosingCash(e.target.value)}
                    placeholder="Enter the counted cash amount"
                  />
                </label>
                <label className="field">
                  <span>Notes</span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Optional notes (variance reason, etc.)"
                    rows={2}
                  />
                </label>
                {closingCash && (
                  <div className="cash-drawer-variance">
                    <span>Variance:</span>
                    <span className={
                      Number(closingCash) - expectedBalance === 0 ? 'text-ok' :
                      Number(closingCash) - expectedBalance > 0 ? 'text-ok' : 'text-warn'
                    }>
                      Rs {(Number(closingCash) - expectedBalance).toFixed(2)}
                      {Number(closingCash) - expectedBalance === 0 ? ' (Exact)' :
                       Number(closingCash) - expectedBalance > 0 ? ' (Over)' : ' (Short)'}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="cash-drawer-section">
                <div className="confirm-box">
                  <p>Are you sure you want to close the cash drawer?</p>
                  <p className="muted small">This action cannot be undone.</p>
                </div>
              </div>
            )}

            <div className="cash-drawer-actions">
              {!confirmClose ? (
                <>
                  <button
                    className="btn btn-danger"
                    disabled={busy || !closingCash}
                    onClick={() => setConfirmClose(true)}
                  >
                    Close Drawer
                  </button>
                  <button className="btn" onClick={onClose}>Cancel</button>
                </>
              ) : (
                <>
                  <button className="btn btn-danger" disabled={busy} onClick={handleClose}>
                    {busy ? 'Closing...' : 'Confirm Close'}
                  </button>
                  <button className="btn" onClick={() => setConfirmClose(false)}>Back</button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
