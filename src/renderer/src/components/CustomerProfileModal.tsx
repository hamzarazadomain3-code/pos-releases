import { useCallback, useEffect, useState } from 'react';
import type { Customer, UdhaarLedger, UdhaarItemLine } from '../../../shared/types';
import { Modal } from './Modal';
import { KeyboardInput } from './KeyboardInput';
import { CustomerMergeModal } from './CustomerMergeModal';
import { getCurrencySymbol } from '../utils/currency';

export interface CustomerProfileModalProps {
  customerId: number;
  onClose: () => void;
  onEdit: (customer: Customer) => void;
  /** Any change (deactivate / reactivate / delete) — reload the list. */
  onChanged: () => void;
  /** Open the full Udhaar ledger modal. */
  onOpenLedger: (customerId: number) => void;
}

type TabId = 'details' | 'ledger' | 'items' | 'payments' | 'documents';

const TABS: { id: TabId; label: string }[] = [
  { id: 'details', label: 'Details' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'items', label: 'Items' },
  { id: 'payments', label: 'Payments' },
  { id: 'documents', label: 'Documents' },
];

function money(n: number | null | undefined): string {
  return `${getCurrencySymbol()}${Number(n || 0).toFixed(2)}`;
}

function dt(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="profile-field">
      <span>{label}</span>
      <b>{value && String(value).trim() ? value : '—'}</b>
    </div>
  );
}

/**
 * Read-only customer profile with tabs for details, ledger, items, payments and
 * documents. Lifecycle actions (edit / deactivate / delete) live in the footer;
 * a customer who has any history can only be deactivated, never deleted.
 */
export function CustomerProfileModal({
  customerId,
  onClose,
  onEdit,
  onChanged,
  onOpenLedger,
}: CustomerProfileModalProps) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [ledger, setLedger] = useState<UdhaarLedger | null>(null);
  const [tab, setTab] = useState<TabId>('details');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [writeOffOpen, setWriteOffOpen] = useState(false);
  const [writeOffAmount, setWriteOffAmount] = useState('');
  const [writeOffNote, setWriteOffNote] = useState('');
  const [mergeOpen, setMergeOpen] = useState(false);

  const isOwner = role === 'owner';

  useEffect(() => {
    window.api.auth
      .currentUser()
      .then((u) => setRole(u?.role ?? null))
      .catch(() => setRole(null));
  }, []);

  const load = useCallback(async () => {
    const [c, l] = await Promise.all([
      window.api.customers.get(customerId),
      window.api.udhaar.ledger(customerId),
    ]);
    setCustomer(c);
    setLedger(l);
  }, [customerId]);

  useEffect(() => {
    load().catch((e) => setNotice(e instanceof Error ? e.message : String(e)));
  }, [load]);

  const items: UdhaarItemLine[] = ledger ? ledger.rows.flatMap((r) => r.items) : [];
  const payments = ledger ? ledger.rows.filter((r) => r.type.startsWith('payment')) : [];
  const hasHistory = (ledger?.rows.length ?? 0) > 0;
  const inactive = customer?.status === 'inactive';

  async function toggleStatus() {
    if (!customer) return;
    setBusy(true);
    try {
      if (inactive) await window.api.customers.reactivate(customer.id);
      else await window.api.customers.deactivate(customer.id);
      await load();
      onChanged();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function applyWriteOff() {
    if (!customer) return;
    const amount = Number(writeOffAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice('Enter a write-off amount greater than zero.');
      return;
    }
    if (!window.confirm(`Write off ${money(amount)} from ${customer.name}'s balance? No cash is received.`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await window.api.udhaar.writeOff(customer.id, amount, writeOffNote.trim() || undefined);
      if (!res.ok) {
        setNotice(res.message || 'Could not write off the amount.');
        return;
      }
      setWriteOffOpen(false);
      setWriteOffAmount('');
      setWriteOffNote('');
      await load();
      onChanged();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!customer) return;
    if (!window.confirm(`Delete ${customer.name}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await window.api.customers.remove(customer.id);
      if (res.ok) {
        onChanged();
        onClose();
      } else {
        setNotice(res.message || 'Could not delete the customer.');
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      title={`Customer — ${customer?.name ?? '…'}`}
      className="modal-lg"
      label="Customer profile"
      shortcuts={[{ keys: 'Esc', label: 'Close' }]}
    >
      {customer && (
        <div className="profile-head">
          {customer.photo ? (
            <img src={customer.photo} alt="" className="profile-photo" />
          ) : (
            <div className="profile-photo profile-photo-empty">{(customer.name || '?').charAt(0).toUpperCase()}</div>
          )}
          <div className="profile-head-main">
            <div className="profile-head-name">
              <strong>{customer.name}</strong>
              {inactive && <span className="badge">Inactive</span>}
              {ledger?.summary.over_limit && <span className="badge badge-warn">Over limit</span>}
              {customer.customer_type && customer.customer_type !== 'retail' && (
                <span className="badge">{customer.customer_type}</span>
              )}
            </div>
            <div className="muted small">
              {customer.phone || 'No phone'}
              {customer.city ? ` · ${customer.city}` : ''}
              {customer.business_name ? ` · ${customer.business_name}` : ''}
            </div>
          </div>
          <div className="profile-head-balance">
            <span className="muted small">Outstanding</span>
            <b className={customer.balance > 0 ? 'text-warn' : 'text-ok'}>{money(customer.balance)}</b>
          </div>
        </div>
      )}

      {notice && (
        <div className="notice error" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}

      {writeOffOpen && customer && (
        <div className="write-off-box">
          <div className="row-actions" style={{ alignItems: 'flex-end' }}>
            <label className="write-off-field">
              Write-off amount
              <KeyboardInput
                type="number"
                value={writeOffAmount}
                onChange={(e) => setWriteOffAmount(e.target.value)}
                placeholder="0.00"
                autoFocus
              />
            </label>
            <label className="write-off-field grow">
              Reason / note
              <input
                type="text"
                value={writeOffNote}
                onChange={(e) => setWriteOffNote(e.target.value)}
                placeholder="e.g. bad debt, settlement"
              />
            </label>
            <button type="button" className="btn btn-danger" onClick={applyWriteOff} disabled={busy}>
              Write off
            </button>
            <button type="button" className="btn" onClick={() => setWriteOffOpen(false)} disabled={busy}>
              Cancel
            </button>
          </div>
          <div className="small muted">
            Write-off forgives debt — no cash is received. It lowers the balance and is recorded as a
            “Write-off” ledger entry. Only the owner can do this.
          </div>
        </div>
      )}

      <div className="modal-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            className={`modal-tab${t.id === tab ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="modal-tab-body">
        {!customer && <div className="muted center">Loading…</div>}

        {customer && tab === 'details' && (
          <div className="profile-grid">
            <Field label="Urdu name" value={customer.urdu_name} />
            <Field label="Type" value={customer.customer_type} />
            <Field label="Shop / business" value={customer.business_name} />
            <Field label="Contact person" value={customer.contact_person} />
            <Field label="Customer code" value={customer.customer_code} />
            <Field label="Group" value={customer.group_name} />
            <Field label="Tags" value={customer.tags} />
            <Field label="Phone" value={customer.phone} />
            <Field label="Alternate phone" value={customer.phone_alt} />
            <Field label="WhatsApp" value={customer.whatsapp} />
            <Field label="Email" value={customer.email} />
            <Field label="Language" value={customer.message_language} />
            <Field label="Address" value={customer.address} />
            <Field label="City" value={customer.city} />
            <Field label="Area" value={customer.area} />
            <Field label="Maps link" value={customer.maps_link} />
            <Field label="CNIC" value={customer.cnic} />
            <Field label="NTN / STRN" value={customer.ntn} />
            <Field label="Drug licence" value={customer.drug_licence} />
            <Field label="Reference / guarantor" value={customer.guarantor} />
            <Field label="Guarantor phone" value={customer.guarantor_phone} />
            <Field label="Price level" value={customer.price_level} />
            <Field label="Credit limit" value={money(customer.credit_limit)} />
            <Field label="Credit days" value={String(customer.credit_days ?? 0)} />
            <Field label="When over limit" value={customer.credit_action ?? (customer.block_on_exceed ? 'block' : 'warn')} />
            <Field label="Default discount" value={customer.default_discount_pct ? `${customer.default_discount_pct}%` : '—'} />
            <Field label="Max single bill" value={customer.max_single_bill ? money(customer.max_single_bill) : '—'} />
            <Field label="Available credit" value={money(ledger?.summary.available)} />
            <Field label="Overdue" value={money(ledger?.summary.overdue_amount)} />
            <Field label="Last payment" value={dt(ledger?.summary.last_payment_at)} />
            <Field label="Last sale" value={dt(ledger?.summary.last_sale_at)} />
            <Field label="Birthday" value={customer.birthday} />
            <Field label="Anniversary" value={customer.anniversary} />
            <Field label="Notes" value={customer.notes} />
          </div>
        )}

        {customer && tab === 'ledger' && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Particulars</th>
                  <th className="num">Amount</th>
                  <th className="num">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {(ledger?.rows ?? []).map((r) => (
                  <tr key={r.id}>
                    <td>{dt(r.created_at)}</td>
                    <td>
                      {r.type.startsWith('payment')
                        ? `Payment (${r.type.split(':')[1] ?? ''})`
                        : r.invoice_no ?? (r.type === 'opening_balance' ? 'Opening balance' : 'Udhaar items')}
                      {r.note ? <span className="muted small"> · {r.note}</span> : null}
                    </td>
                    <td className={`num ${r.amount < 0 ? 'text-ok' : 'text-warn'}`}>
                      {r.amount > 0 ? '+' : ''}
                      {money(r.amount)}
                    </td>
                    <td className="num">{money(r.remaining)}</td>
                  </tr>
                ))}
                {(ledger?.rows.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={4} className="muted center">
                      No ledger entries yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {customer && tab === 'items' && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th className="num">Rate</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.key}>
                    <td>{dt(it.created_at)}</td>
                    <td className="name">
                      {it.name}
                      {it.barcode ? <span className="muted small"> · {it.barcode}</span> : null}
                    </td>
                    <td className="num">
                      {it.qty}
                      {it.unit ? ` ${it.unit}` : ''}
                    </td>
                    <td className="num">{money(it.rate)}</td>
                    <td className="num">{money(it.line_total)}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted center">
                      No items taken on credit.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {customer && tab === 'payments' && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Mode</th>
                  <th>Note</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{dt(p.created_at)}</td>
                    <td>{(p.type.split(':')[1] ?? '').toUpperCase()}</td>
                    <td>{p.note || '—'}</td>
                    <td className="num text-ok">{money(Math.abs(p.amount))}</td>
                  </tr>
                ))}
                {payments.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted center">
                      No payments received yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {customer && tab === 'documents' && (
          <div className="muted center">
            No documents stored for this customer yet.
            <div className="small">Document attachments arrive in a later phase.</div>
          </div>
        )}
      </div>

      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose} disabled={busy}>
          Close
        </button>
        <button type="button" className="btn" onClick={() => onOpenLedger(customerId)} disabled={busy}>
          Full ledger
        </button>
        {isOwner && customer && customer.balance > 0 && (
          <button type="button" className="btn" onClick={() => setWriteOffOpen((v) => !v)} disabled={busy}>
            Write off
          </button>
        )}
        {isOwner && customer && (
          <button type="button" className="btn" onClick={() => setMergeOpen(true)} disabled={busy}>
            Merge…
          </button>
        )}
        {!hasHistory && (
          <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
            Delete
          </button>
        )}
        {customer && (
          <button type="button" className="btn" onClick={toggleStatus} disabled={busy}>
            {inactive ? 'Reactivate' : 'Deactivate'}
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={() => customer && onEdit(customer)} disabled={busy || !customer}>
          Edit
        </button>
      </div>

      {mergeOpen && customer && (
        <CustomerMergeModal
          source={customer}
          onClose={() => setMergeOpen(false)}
          onMerged={() => {
            setMergeOpen(false);
            onChanged();
            onClose();
          }}
        />
      )}
    </Modal>
  );
}
