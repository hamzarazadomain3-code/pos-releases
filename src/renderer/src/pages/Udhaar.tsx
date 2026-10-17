import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Customer, UdhaarAging, UdhaarAgingRow } from '../../../shared/types';
import { DateRangePicker, SearchInput, FilterBar, FilterRow } from '../components/filters';
import { UdhaarLedgerModal } from '../components/UdhaarLedger';
import { UdhaarEntryModal } from '../components/UdhaarEntryModal';
import { UdhaarCustomerModal } from '../components/UdhaarCustomerModal';
import { CustomerProfileModal } from '../components/CustomerProfileModal';
import { ReceivePaymentModal } from '../components/ReceivePaymentModal';
import { formatMoney } from '../utils/currency';
import { useListKeyboard } from '../hooks/useListKeyboard';
import { useKeyboardScope } from '../hooks/useKeyboardScope';

type Notice = { text: string; kind: 'ok' | 'error' };
type View = 'list' | 'aging';

/** 'YYYY-MM-DD HH:MM:SS' → 'YYYY-MM-DD' (for range compare). */
const dateOnly = (ts?: string | null): string => (ts ? String(ts).slice(0, 10) : '');
const fmt = (n: number): string =>
  (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Udhaar() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [aging, setAging] = useState<UdhaarAging | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('list');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [customerModal, setCustomerModal] = useState<{ customer: Customer | null } | null>(null);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [ledgerCustomerId, setLedgerCustomerId] = useState<number | null>(null);
  const [entryCustomer, setEntryCustomer] = useState<Customer | null>(null);
  const [receiveCustomer, setReceiveCustomer] = useState<Customer | null>(null);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState<'paid' | 'pending' | 'all'>('all');

  const flash = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    setNotice({ text, kind });
  }, []);
  const fail = useCallback(
    (e: unknown) => flash(e instanceof Error ? e.message : String(e), 'error'),
    [flash]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await window.api.customers.list();
      setCustomers(list);
    } finally {
      setLoading(false);
    }
    // Aging is a derived report — a failure here must not blank the customer list.
    try {
      setAging(await window.api.udhaar.aging());
    } catch {
      setAging(null);
    }
  }, []);

  useEffect(() => {
    load().catch(fail);
  }, [load, fail]);

  /** Per-customer aging row, keyed by id — drives the due badges + aging view. */
  const agingById = useMemo(() => {
    const map = new Map<number, UdhaarAgingRow>();
    for (const r of aging?.rows ?? []) map.set(r.customer_id, r);
    return map;
  }, [aging]);

  const filtered = customers
    .filter((c) => showInactive || (c.status ?? 'active') !== 'inactive')
    .filter(
      (c) =>
        !search.trim() ||
        c.name.toLowerCase().includes(search.trim().toLowerCase()) ||
        (c.phone ?? '').includes(search.trim())
    )
    .filter((c) => {
      if (status === 'paid') return c.balance <= 0;
      if (status === 'pending') return c.balance > 0;
      return true;
    })
    .filter((c) => {
      const d = dateOnly(c.created_at);
      if (from && (!d || d < from)) return false;
      if (to && (!d || d > to)) return false;
      return true;
    });

  const totalDue = customers.reduce((s, c) => s + c.balance, 0);
  const agingRows = aging?.rows ?? [];

  async function exportCustomers() {
    try {
      const ok = await window.api.excel.exportCustomers({
        status: status === 'all' ? undefined : status,
        from: from || undefined,
        to: to || undefined,
      });
      if (ok) flash('Customer list exported to Excel.');
    } catch (e) {
      fail(e);
    }
  }

  async function remind(c: Customer) {
    try {
      const res = await window.api.udhaar.remind(c.id);
      if (res.ok) flash(`Reminder sent to ${c.name}.`);
      else flash(res.message || 'Could not send the reminder.', 'error');
    } catch (e) {
      fail(e);
    }
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

  // ── Keyboard: arrow between rows, Enter opens (ledger in list view, profile in aging) ──
  const customerList = useListKeyboard({
    count: view === 'aging' ? agingRows.length : filtered.length,
    onOpen: (i) => {
      if (view === 'aging') {
        const r = agingRows[i];
        if (r) setProfileId(r.customer_id);
      } else {
        const c = filtered[i];
        if (c) setLedgerCustomerId(c.id);
      }
    },
  });

  useKeyboardScope({
    kind: 'page',
    label: 'Udhaar / Khata',
    actions: {
      new_record: () => setCustomerModal({ customer: null }),
    },
    shortcuts: [
      { action: 'new_record', label: 'Add customer' },
      { keys: '↑ / ↓', label: 'Move between rows' },
      { keys: 'Enter', label: 'Open the ledger / profile' },
    ],
  });

  /** A "days overdue" / "due on" badge for the list view. */
  function dueBadge(row: UdhaarAgingRow | undefined) {
    if (!row) return <span className="muted">—</span>;
    if (row.days_overdue > 0) {
      return <span className="badge badge-danger">Overdue {row.days_overdue}d</span>;
    }
    if (row.oldest_due_date) {
      return <span className="badge badge-ok">Due {row.oldest_due_date}</span>;
    }
    return <span className="muted">—</span>;
  }

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
              labelFrom="Joined from"
              labelTo="Joined to"
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
            <label className="inline-check">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Show inactive
            </label>
          </FilterRow>
          <FilterRow style={{ justifyContent: 'flex-end' }}>
            <span className="badge badge-warn" style={{ marginRight: 'auto' }}>
              Total due: {formatMoney(totalDue)}
            </span>
            <div className="view-toggle" role="tablist" aria-label="View">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'list'}
                className={view === 'list' ? 'active' : ''}
                onClick={() => setView('list')}
              >
                Customers
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'aging'}
                className={view === 'aging' ? 'active' : ''}
                onClick={() => setView('aging')}
              >
                Aging
              </button>
            </div>
            <button className="btn btn-sm" onClick={exportCustomers}>
              Export Excel
            </button>
            <button className="btn btn-primary" onClick={() => setCustomerModal({ customer: null })}>
              + Add Customer
            </button>
          </FilterRow>
        </FilterBar>
      </div>

      {notice && (
        <div className={`notice ${notice.kind === 'error' ? 'error' : ''}`} onClick={() => setNotice(null)}>
          {notice.text}
        </div>
      )}

      {view === 'list' && (
        <div className="table-wrap" {...customerList.getContainerProps()}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th className="num">Outstanding</th>
                <th>Due</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && customers.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted center">Loading…</td>
                </tr>
              )}
              {filtered.map((c, i) => {
                const overLimit = c.credit_limit != null && c.credit_limit > 0 && c.balance > c.credit_limit;
                const inactive = (c.status ?? 'active') === 'inactive';
                return (
                  <tr key={c.id} className={overLimit ? 'row-danger' : c.balance > 0 ? 'row-low' : ''} {...customerList.getRowProps(i)}>
                    <td>
                      <button className="link-btn name" onClick={() => setProfileId(c.id)}>
                        <strong>{c.name}</strong>
                      </button>
                      {inactive && <span className="badge" style={{ marginLeft: 6 }}>Inactive</span>}
                      {overLimit && <div className="small text-warn">Over credit limit!</div>}
                    </td>
                    <td>{c.phone ?? '—'}</td>
                    <td className={`num ${c.balance > 0 ? 'text-warn' : 'text-ok'}`}>
                      {c.balance.toFixed(2)}
                    </td>
                    <td>{dueBadge(agingById.get(c.id))}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-sm" onClick={() => setProfileId(c.id)}>
                          Profile
                        </button>
                        <button className="btn btn-sm" onClick={() => setLedgerCustomerId(c.id)}>
                          Ledger
                        </button>
                        <button className="btn btn-sm btn-primary" onClick={() => setEntryCustomer(c)}>
                          + Udhaar items
                        </button>
                        {c.balance > 0 && (
                          <button className="btn btn-sm" onClick={() => setReceiveCustomer(c)}>
                            Receive
                          </button>
                        )}
                        {c.balance > 0 && (
                          <button className="btn btn-sm" onClick={() => remind(c)} title="Send a WhatsApp reminder">
                            Remind
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted center">
                    No customers found. Add a customer to start giving udhaar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {view === 'aging' && (
        <div className="table-wrap" {...customerList.getContainerProps()}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Phone</th>
                <th className="num">Current</th>
                <th className="num">1–30</th>
                <th className="num">31–60</th>
                <th className="num">61–90</th>
                <th className="num">90+</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {loading && !aging && (
                <tr>
                  <td colSpan={8} className="muted center">Loading…</td>
                </tr>
              )}
              {agingRows.map((r, i) => (
                <tr
                  key={r.customer_id}
                  className={r.days_overdue > 0 ? 'row-danger' : r.outstanding > 0 ? 'row-low' : ''}
                  {...customerList.getRowProps(i)}
                >
                  <td>
                    <button className="link-btn name" onClick={() => setProfileId(r.customer_id)}>
                      <strong>{r.name}</strong>
                    </button>
                    {r.days_overdue > 0 && (
                      <span className="badge badge-danger" style={{ marginLeft: 6 }}>
                        {r.days_overdue}d
                      </span>
                    )}
                  </td>
                  <td>{r.phone ?? '—'}</td>
                  <td className="num">{fmt(r.buckets.current)}</td>
                  <td className="num text-warn">{fmt(r.buckets.d1_30)}</td>
                  <td className="num text-warn">{fmt(r.buckets.d31_60)}</td>
                  <td className="num text-warn">{fmt(r.buckets.d61_90)}</td>
                  <td className="num text-warn">{fmt(r.buckets.d90_plus)}</td>
                  <td className="num"><strong>{fmt(r.buckets.total)}</strong></td>
                </tr>
              ))}
              {agingRows.length > 0 && (
                <tr className="aging-total">
                  <td><strong>Total</strong></td>
                  <td />
                  <td className="num">{fmt(aging!.totals.current)}</td>
                  <td className="num">{fmt(aging!.totals.d1_30)}</td>
                  <td className="num">{fmt(aging!.totals.d31_60)}</td>
                  <td className="num">{fmt(aging!.totals.d61_90)}</td>
                  <td className="num">{fmt(aging!.totals.d90_plus)}</td>
                  <td className="num"><strong>{fmt(aging!.totals.total)}</strong></td>
                </tr>
              )}
              {!loading && agingRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted center">
                    Nothing outstanding — no receivables to age.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {aging && (
            <p className="muted small" style={{ padding: '6px 4px' }}>
              Receivables as of {aging.as_of} · {agingRows.length} customer(s) with a balance.
            </p>
          )}
        </div>
      )}

      {customerModal && (
        <UdhaarCustomerModal
          customer={customerModal.customer}
          onClose={() => setCustomerModal(null)}
          onSaved={(c) => {
            setCustomerModal(null);
            load().catch(() => undefined);
            if (c) flash(`${c.name} saved.`);
          }}
          onOpenExisting={(id) => {
            setCustomerModal(null);
            setProfileId(id);
          }}
        />
      )}

      {profileId != null && (
        <CustomerProfileModal
          customerId={profileId}
          onClose={() => setProfileId(null)}
          onEdit={(c) => {
            setProfileId(null);
            setCustomerModal({ customer: c });
          }}
          onChanged={() => {
            load().catch(() => undefined);
          }}
          onOpenLedger={(id) => {
            setProfileId(null);
            setLedgerCustomerId(id);
          }}
        />
      )}

      {receiveCustomer && (
        <ReceivePaymentModal
          customer={receiveCustomer}
          onClose={() => setReceiveCustomer(null)}
          onSaved={(c) => {
            setReceiveCustomer(null);
            load().catch(() => undefined);
            flash(`Payment received from ${c.name}.`);
          }}
        />
      )}

      {ledgerCustomerId != null && (
        <UdhaarLedgerModal
          customerId={ledgerCustomerId}
          onClose={() => setLedgerCustomerId(null)}
          onChanged={load}
        />
      )}

      {entryCustomer && (
        <UdhaarEntryModal
          customerId={entryCustomer.id}
          customerName={entryCustomer.name}
          customerBalance={entryCustomer.balance}
          onClose={() => setEntryCustomer(null)}
          onSaved={() => {
            load().catch(() => undefined);
          }}
        />
      )}
    </div>
  );
}
