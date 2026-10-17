import { useState } from 'react';
import { Modal } from './Modal';
import { KeyboardInput } from './KeyboardInput';
import { formatMoney } from '../utils/currency';
import type { Customer } from '../../../shared/types';

const PAY_MODES = ['Cash', 'Card', 'Easypaisa', 'JazzCash', 'Bank Transfer'];
const EPSILON = 0.005;

export interface ReceivePaymentModalProps {
  customer: Customer;
  onClose: () => void;
  /** Called with the updated customer after a successful payment. */
  onSaved: (customer: Customer) => void;
}

/**
 * Quick "Receive payment" dialog reached from the Udhaar list. It only calls the
 * existing `customers.receivePayment` service — no ledger logic lives here — so
 * the running balance and FIFO allocation are identical to the ledger's own form.
 */
export function ReceivePaymentModal({ customer, onClose, onSaved }: ReceivePaymentModalProps) {
  const balance = Number(customer.balance) || 0;
  const [amount, setAmount] = useState(balance > 0 ? String(balance) : '');
  const [mode, setMode] = useState('Cash');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (amt > balance + EPSILON) {
      setError(`Amount cannot exceed the outstanding balance of ${formatMoney(balance)}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await window.api.customers.receivePayment(
        customer.id,
        amt,
        mode,
        note.trim() || undefined
      );
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      onSubmit={submit}
      title={`Receive payment — ${customer.name}`}
      label="Receive payment"
      actions={{ save: () => void submit() }}
      shortcuts={[
        { keys: 'Enter', label: 'Save payment (last field)' },
        { keys: 'Esc', label: 'Close' },
      ]}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : 'Save payment'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          Outstanding balance
          <input type="text" value={formatMoney(balance)} readOnly tabIndex={-1} />
        </label>
        <label>
          Amount received
          <KeyboardInput
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            autoFocus
          />
        </label>
        <label>
          Payment mode
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            {PAY_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          Note (optional)
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. cash on account"
          />
        </label>
      </div>

      {error && <div className="notice error">{error}</div>}
      <p className="muted" style={{ marginTop: 8 }}>
        A payment lowers the customer's balance and is allocated oldest-debt-first, exactly like
        the ledger's Receive payment.
      </p>
    </Modal>
  );
}
