import { useCallback, useEffect, useState } from 'react';
import type { Customer, CustomerTransaction } from '../../../shared/types';
import { DateRangePicker, SearchInput, FilterBar, FilterRow } from '../components/filters';
import { formatDateTimeAdmin } from '../utils/dateUtils';
import { getCurrencySymbol } from '../utils/currency';
import { Modal } from '../components/Modal';
import { KeyboardInput } from '../components/KeyboardInput';
import { useListKeyboard } from '../hooks/useListKeyboard';
import { useKeyboardScope } from '../hooks/useKeyboardScope';

export default function Udhaar() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newBalance, setNewBalance] = useState('');
  const [ledger, setLedger] = useState<{ customer: Customer; rows: CustomerTransaction[] } | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMode, setPayMode] = useState('Cash');
  const [payNote, setPayNote] = useState('');
  const [limitInput, setLimitInput] = useState('');
  const [busy, setBusy] = useState(false);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState<'paid' | 'pending' | 'all'>('all');

  const load = useCallback(async () => {
    setCustomers(await window.api.customers.list());
  }, []);

  useEffect(() => {
    load().catch((e) => setNotice(e instanceof Error ? e.message : String(e)));
  }, [load]);

  const filtered = customers
    .filter((c) => !search.trim() || c.name.toLowerCase().includes(search.trim().toLowerCase()) || (c.phone ?? '').includes(search.trim()))
    .filter((c) => {
      if (status === 'paid') return c.balance <= 0;
      if (status === 'pending') return c.balance > 0;
      return true;
    });
  const totalDue = customers.reduce((s, c) => s + c.balance, 0);

  async function exportCustomers() {
    try {
      const ok = await window.api.excel.exportCustomers({
        status: status === 'all' ? undefined : status,
        from: from || undefined,
        to: to || undefined,
      });
      if (ok) setNotice('Customer list exported to Excel.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function openLedger(c: Customer) {
    try {
      const rows = await window.api.customers.ledger(c.id);
      setLedger({ customer: c, rows });
      setPayAmount('');
      setPayNote('');
      setLimitInput(c.credit_limit ? String(c.credit_limit) : '');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function submitPayment() {
    if (!ledger) return;
    const amount = Number(payAmount);
    if (!amount || amount <= 0) return;
    setBusy(true);
    try {
      await window.api.customers.receivePayment(ledger.customer.id, amount, payMode, payNote.trim() || undefined);
      const rows = await window.api.customers.ledger(ledger.customer.id);
      const cust = (await window.api.customers.list()).find((c) => c.id === ledger.customer.id);
      if (cust) setLedger({ customer: cust, rows });
      setPayAmount('');
      setPayNote('');
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function createCustomer() {
    if (!newName.trim()) return;
    await window.api.customers.create(newName, newPhone, Number(newBalance) || 0);
    setNewName('');
    setNewPhone('');
    setNewBalance('');
    setAddOpen(false);
    await load();
  }

  const statusOptions = [
    { value: 'all', label: 'All' },
    { value: 'pending', label: 'Pending (Due)' },
    { value: 'paid', label: 'Paid/Settled' },
  ];

  const handleClearUdhaarFilters = () => {
    setFrom('');
    setTo('');
    setStatus('all');
    setSearch('');
  };

  // ── Keyboard: arrow between customers, Enter opens the ledger ──
  const customerList = useListKeyboard({
    count: filtered.length,
    onOpen: (i) => { const c = filtered[i]; if (c) openLedger(c); },
  });

  const ledgerList = useListKeyboard({ count: ledger?.rows.length ?? 0 });

  useKeyboardScope({
    kind: 'page',
    label: 'Udhaar / Khata',
    actions: {
      new_record: () => setAddOpen(true),
    },
    shortcuts: [
      { action: 'new_record', label: 'Add customer' },
      { keys: '↑ / ↓', label: 'Move between customers' },
      { keys: 'Enter', label: 'Open the ledger' },
    ],
  });

  return (
    <div className="page">
      <div className="page-header">
        <h1>Udhaar / Khata</h1>
        <FilterBar onClear={handleClearUdhaarFilters} onApply={load}>
          <FilterRow>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search customer..."
              debounceMs={300}
            />
            <DateRangePicker
              from={from}
              to={to}
              onChange={(from: string, to: string) => { setFrom(from); setTo(to); }}
              labelFrom="From"
              labelTo="To"
            />
            <select
              className="field-select"
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
              style={{ width: '160px' }}
            >
              {statusOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </FilterRow>
          <FilterRow style={{ justifyContent: 'flex-end' }}>
            <span className="badge badge-warn" style={{ marginRight: 'auto' }}>Total due: {totalDue.toFixed(2)}</span>
            <button className="btn btn-sm" onClick={exportCustomers}>
              Export Excel
            </button>
            <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
              + Add Customer
            </button>
          </FilterRow>
        </FilterBar>
      </div>

      {notice && (
        <div className="notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}

      <div className="table-wrap" {...customerList.getContainerProps()}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th className="num">Outstanding</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c, i) => {
              const overLimit = c.credit_limit != null && c.credit_limit > 0 && c.balance > c.credit_limit;
              return (
                <tr key={c.id} className={overLimit ? 'row-danger' : c.balance > 0 ? 'row-low' : ''} {...customerList.getRowProps(i)}>
                  <td>
                    <strong>{c.name}</strong>
                    {overLimit && <div className="small text-warn">Over credit limit!</div>}
                  </td>
                  <td>{c.phone ?? '—'}</td>
                  <td className={`num ${c.balance > 0 ? 'text-warn' : 'text-ok'}`}>
                    {c.balance > 0 ? c.balance.toFixed(2) : '0.00'}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-sm" onClick={() => openLedger(c)}>
                        Ledger
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="muted center">
                  No customers found. Add a customer to start giving udhaar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {addOpen && (
        <Modal
          onClose={() => setAddOpen(false)}
          onSubmit={createCustomer}
          title="Add Customer"
          className="modal-sm"
          label="Add Customer"
          shortcuts={[{ action: 'save', label: 'Save customer' }]}
        >
          <label className="field">
            <span>Name *</span>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} />
          </label>
          <label className="field">
            <span>Phone</span>
            <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
          </label>
          <label className="field">
            <span>Opening Balance ({getCurrencySymbol()})</span>
            <KeyboardInput
              type="text"
              decimals
              value={newBalance}
              onChange={(e) => setNewBalance(e.target.value)}
              placeholder="0.00"
            />
          </label>
          <div className="modal-actions">
            <button className="btn" onClick={() => setAddOpen(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={!newName.trim()} onClick={createCustomer}>
              Save
            </button>
          </div>
        </Modal>
      )}

      {ledger && (
        <Modal
          onClose={() => setLedger(null)}
          onSubmit={submitPayment}
          title={`Ledger — ${ledger.customer.name}`}
          className="modal-wide"
          label="Customer Ledger"
          shortcuts={[{ keys: 'Enter', label: 'Receive payment' }]}
        >
          {(() => {
            const limit = ledger.customer.credit_limit ?? 0;
            const over = limit > 0 && ledger.customer.balance > limit;
            return (
              <>
                <div className="ledger-head">
                  <span>
                    Outstanding: <strong className={over ? 'text-warn' : ''}>{ledger.customer.balance.toFixed(2)}</strong>
                  </span>
                  <span className="muted small">Phone: {ledger.customer.phone ?? '—'}</span>
                  <span className="muted small">
                    Credit limit:
                    <KeyboardInput
                      type="text"
                      className="limit-input"
                      value={limitInput}
                      onChange={(e) => setLimitInput(e.target.value)}
                      placeholder="0"
                    />
                    <button
                      className="btn btn-sm"
                      onClick={async () => {
                        const c = await window.api.customers.setCreditLimit(ledger.customer.id, Number(limitInput) || 0);
                        setLedger({ ...ledger, customer: c });
                        await load();
                      }}
                    >
                      Set
                    </button>
                  </span>
                </div>
                {over && (
                  <div className="notice">
                    Warning: Udhaar limit exceeded! Balance {ledger.customer.balance.toFixed(2)} exceeds limit {limit.toFixed(2)}.
                  </div>
                )}
              </>
            );
          })()}

          <div className="pay-box">
            <select value={payMode} onChange={(e) => setPayMode(e.target.value)}>
              <option>Cash</option>
              <option>Card</option>
              <option>Easypaisa</option>
              <option>JazzCash</option>
              <option>Bank Transfer</option>
            </select>
            <KeyboardInput
              type="text"
              decimals
              placeholder="Amount"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
            />
            <input placeholder="Note (optional)" value={payNote} onChange={(e) => setPayNote(e.target.value)} />
            <button className="btn btn-primary" onClick={submitPayment} disabled={busy || !payAmount || Number(payAmount) <= 0}>
              Receive Payment
            </button>
          </div>

          <div className="table-wrap" {...ledgerList.getContainerProps()}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th className="num">Amount</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {[...ledger.rows].reverse().map((r, i) => (
                  <tr key={r.id} {...ledgerList.getRowProps(i)}>
                    <td>{r.created_at ? formatDateTimeAdmin(r.created_at) : '—'}</td>
                    <td>
                      {r.type.startsWith('payment') ? (
                        <span className="text-ok">Payment ({r.type.split(':')[1]})</span>
                      ) : r.type === 'sale' ? (
                        <span className="text-warn">Sale (udhaar)</span>
                      ) : (
                        <span className="muted">Void</span>
                      )}
                    </td>
                    <td className={`num ${r.amount < 0 ? 'text-ok' : 'text-warn'}`}>
                      {r.amount > 0 ? '+' : ''}
                      {r.amount.toFixed(2)}
                    </td>
                    <td className="num">{r.running.toFixed(2)}</td>
                  </tr>
                ))}
                {ledger.rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted center">
                      No transactions yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setLedger(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
