import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type {
  UdhaarItemLine,
  UdhaarLedger,
  UdhaarLedgerRow,
} from '../../../shared/types';
import { Modal } from './Modal';
import { KeyboardInput } from './KeyboardInput';
import { UdhaarEntryModal } from './UdhaarEntryModal';
import { UdhaarCatalogModal } from './UdhaarCatalogModal';
import { SearchInput, DateRangePicker } from './filters';
import { formatDateTimeAdmin, formatDateAdmin } from '../utils/dateUtils';
import { formatMoney, getCurrencySymbol } from '../utils/currency';
import { useListKeyboard } from '../hooks/useListKeyboard';

type Tab = 'transactions' | 'items' | 'payments';

type FlatItem = UdhaarItemLine & { paid: boolean; overdue: boolean; tx_date: string | null };

const PAY_MODES = ['Cash', 'Card', 'Easypaisa', 'JazzCash', 'Bank Transfer'];
const PAPERS: { value: 'a4' | 'thermal80' | 'thermal58'; label: string }[] = [
  { value: 'a4', label: 'A4 sheet' },
  { value: 'thermal80', label: '80mm roll' },
  { value: 'thermal58', label: '58mm roll' },
];

function dateOnly(ts: string | null | undefined): string | null {
  return ts ? String(ts).slice(0, 10) : null;
}

function isOverdueDue(row: UdhaarLedgerRow): boolean {
  return row.overdue;
}

export interface UdhaarLedgerModalProps {
  customerId: number;
  onClose: () => void;
  /** Called after a mutation (payment / limit change) so the page list refreshes. */
  onChanged?: () => void;
}

export function UdhaarLedgerModal({ customerId, onClose, onChanged }: UdhaarLedgerModalProps) {
  const [data, setData] = useState<UdhaarLedger | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('transactions');

  // filters (statement + items)
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [paper, setPaper] = useState<'a4' | 'thermal80' | 'thermal58'>('a4');
  const [itemSearch, setItemSearch] = useState('');
  const [itemPaid, setItemPaid] = useState<'all' | 'paid' | 'unpaid'>('all');
  const [groupByProduct, setGroupByProduct] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // payment form
  const [payAmount, setPayAmount] = useState('');
  const [payMode, setPayMode] = useState('Cash');
  const [payNote, setPayNote] = useState('');
  const [limitInput, setLimitInput] = useState('');

  // Phase 2 — manual item entries + catalog
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryDirection, setEntryDirection] = useState<'debit' | 'credit'>('debit');
  const [catalogOpen, setCatalogOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await window.api.udhaar.ledger(customerId);
    setData(res);
    setLimitInput(res.customer.credit_limit ? String(res.customer.credit_limit) : '');
  }, [customerId]);

  useEffect(() => {
    load().catch((e) => setNotice(e instanceof Error ? e.message : String(e)));
  }, [load]);

  const rows = data?.rows ?? [];
  const summary = data?.summary;

  const payments = useMemo(() => rows.filter((r) => r.amount < 0), [rows]);
  const txRows = useMemo(() => [...rows].reverse(), [rows]);

  const flatItems = useMemo<FlatItem[]>(() => {
    const out: FlatItem[] = [];
    for (const r of rows) {
      for (const it of r.items) {
        out.push({ ...it, paid: r.paid, overdue: r.overdue, tx_date: dateOnly(r.created_at) });
      }
    }
    return out;
  }, [rows]);

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    return flatItems.filter((it) => {
      if (itemPaid === 'paid' && !it.paid) return false;
      if (itemPaid === 'unpaid' && it.paid) return false;
      const d = dateOnly(it.created_at);
      if (from && d && d < from) return false;
      if (to && d && d > to) return false;
      if (q && !it.name.toLowerCase().includes(q) && !(it.barcode ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [flatItems, itemPaid, itemSearch, from, to]);

  const itemTotals = useMemo(
    () => filteredItems.reduce((acc, it) => ({ qty: acc.qty + it.qty, amount: acc.amount + it.line_total }), { qty: 0, amount: 0 }),
    [filteredItems]
  );

  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; amount: number; unit: string | null }>();
    for (const it of filteredItems) {
      const key = it.name.toLowerCase();
      const g = map.get(key) ?? { name: it.name, qty: 0, amount: 0, unit: it.unit };
      g.qty += it.qty;
      g.amount += it.line_total;
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  }, [filteredItems]);

  const txList = useListKeyboard({ count: txRows.length });
  const itemList = useListKeyboard({ count: grouped.length ? grouped.length : filteredItems.length });

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  async function submitPayment() {
    if (!data) return;
    const amount = Number(payAmount);
    if (!amount || amount <= 0) return;
    setBusy(true);
    try {
      await window.api.customers.receivePayment(data.customer.id, amount, payMode, payNote.trim() || undefined);
      setPayAmount('');
      setPayNote('');
      await load();
      onChanged?.();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveLimit() {
    if (!data) return;
    try {
      await window.api.customers.setCreditLimit(data.customer.id, Number(limitInput) || 0);
      await load();
      onChanged?.();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function runPrint(preview: boolean) {
    if (!data) return;
    setBusy(true);
    try {
      const fn = preview ? window.api.udhaar.previewStatement : window.api.udhaar.printStatement;
      const res = await fn(data.customer.id, from || undefined, to || undefined, paper);
      if (!res.ok) setNotice(res.message);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function exportExcel() {
    if (!data) return;
    try {
      const ok = await window.api.excel.exportUdhaarStatement(data.customer.id, from || undefined, to || undefined);
      if (ok) setNotice('Statement exported to Excel.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function exportPdf() {
    if (!data) return;
    setBusy(true);
    try {
      const res = await window.api.udhaar.exportStatementPdf(data.customer.id, from || undefined, to || undefined, paper);
      if (!res.ok || !res.data) {
        setNotice(res.message || 'Export failed');
        return;
      }
      const blob = res.data instanceof Blob ? res.data : new Blob([new Uint8Array(res.data)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `statement-${data.customer.name.replace(/[^\w-]+/g, '_')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice('Statement PDF exported.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function shareWhatsApp() {
    if (!data) return;
    setBusy(true);
    try {
      const res = await window.api.udhaar.shareStatement(data.customer.id, from || undefined, to || undefined);
      setNotice(res.message);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openReceipt(saleId: number) {
    try {
      const res = await window.api.printing.previewReceipt(saleId);
      if (!res.ok) setNotice(res.message);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  function openEntry(dir: 'debit' | 'credit') {
    setEntryDirection(dir);
    setEntryOpen(true);
  }

  function settle() {
    if (!data) return;
    setTab('payments');
    setPayAmount(data.customer.balance > 0 ? String(data.customer.balance) : '');
  }

  async function printEntrySlip(txId: number) {
    setBusy(true);
    try {
      const res = await window.api.udhaar.printEntrySlip(txId, 'thermal80');
      if (!res.ok) setNotice(res.message);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function shareEntrySlip(txId: number) {
    setBusy(true);
    try {
      const res = await window.api.udhaar.shareEntrySlip(txId);
      setNotice(res.message);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** A row is a Phase 2 manual item entry (nothing else writes `udhaar_items`). */
  function isManualEntry(r: UdhaarLedgerRow): boolean {
    return r.type === 'udhaar_items';
  }

  const title = data ? `Ledger — ${data.customer.name}` : 'Ledger';

  return (
    <Modal
      onClose={onClose}
      title={title}
      className="modal-wide"
      label="Customer Ledger"
      shortcuts={[
        { keys: 'Enter', label: 'Receive payment (last field)' },
        { keys: 'Esc', label: 'Close' },
      ]}
    >
      {notice && (
        <div className="notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}

      {!data ? (
        <div className="muted center" style={{ padding: 24 }}>
          Loading ledger…
        </div>
      ) : (
        <>
          {/* ── Header summary ─────────────────────────────────── */}
          <div className="ledger-summary">
            <div>
              <span className="small muted">Outstanding</span>
              <strong className={summary && summary.over_limit ? 'text-warn' : ''}>{formatMoney(data.customer.balance)}</strong>
            </div>
            <div>
              <span className="small muted">Credit limit</span>
              <strong>{summary && summary.credit_limit > 0 ? formatMoney(summary.credit_limit) : '—'}</strong>
            </div>
            <div>
              <span className="small muted">Available</span>
              <strong>{summary && summary.credit_limit > 0 ? formatMoney(summary.available) : '—'}</strong>
            </div>
            <div>
              <span className="small muted">Overdue</span>
              <strong className={summary && summary.overdue_amount > 0 ? 'text-warn' : ''}>
                {summary ? formatMoney(summary.overdue_amount) : '—'}
              </strong>
            </div>
            <div>
              <span className="small muted">Last payment</span>
              <strong>{summary?.last_payment_at ? formatDateAdmin(summary.last_payment_at) : '—'}</strong>
            </div>
            <div>
              <span className="small muted">Last sale</span>
              <strong>{summary?.last_sale_at ? formatDateAdmin(summary.last_sale_at) : '—'}</strong>
            </div>
          </div>

          <div className="ledger-head">
            <span className="small muted">Phone: {data.customer.phone ?? '—'}</span>
            <span className="small">
              Credit limit:
              <KeyboardInput
                type="text"
                className="limit-input"
                value={limitInput}
                onChange={(e) => setLimitInput(e.target.value)}
                placeholder="0"
              />
              <button className="btn btn-sm" onClick={saveLimit}>
                Set
              </button>
            </span>
          </div>

          {summary?.over_limit && (
            <div className="notice">
              Warning: Udhaar limit exceeded! Balance {formatMoney(data.customer.balance)} exceeds limit{' '}
              {formatMoney(summary.credit_limit)}.
            </div>
          )}

          {/* ── Quick actions (Phase 2) ────────────────────────── */}
          <div className="ledger-toolbar">
            <button className="btn btn-primary" onClick={() => openEntry('debit')} disabled={busy}>
              + Add Udhaar Items
            </button>
            <button className="btn btn-sm" onClick={() => openEntry('credit')} disabled={busy}>
              Return items
            </button>
            <button className="btn btn-sm" onClick={settle} disabled={busy || !data || data.customer.balance <= 0}>
              Settle
            </button>
            <button className="btn btn-sm" onClick={() => setCatalogOpen(true)} disabled={busy}>
              Item catalog
            </button>
          </div>

          {/* ── Statement toolbar ──────────────────────────────── */}
          <div className="ledger-toolbar">
            <DateRangePicker
              from={from}
              to={to}
              onChange={(f, t) => {
                setFrom(f);
                setTo(t);
              }}
              labelFrom="From"
              labelTo="To"
            />
            <select className="field-select" value={paper} onChange={(e) => setPaper(e.target.value as typeof paper)} title="Statement paper">
              {PAPERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <button className="btn btn-sm" onClick={() => runPrint(true)} disabled={busy}>
              Preview
            </button>
            <button className="btn btn-sm" onClick={() => runPrint(false)} disabled={busy}>
              Print Statement
            </button>
            <button className="btn btn-sm" onClick={exportExcel} disabled={busy}>
              Export Excel
            </button>
            <button className="btn btn-sm" onClick={exportPdf} disabled={busy}>
              Export PDF
            </button>
            <button className="btn btn-sm" onClick={shareWhatsApp} disabled={busy}>
              WhatsApp
            </button>
          </div>

          {/* ── Tabs ───────────────────────────────────────────── */}
          <div className="tabs">
            <button className={`tab-btn ${tab === 'transactions' ? 'active' : ''}`} onClick={() => setTab('transactions')}>
              Transactions ({rows.length})
            </button>
            <button className={`tab-btn ${tab === 'items' ? 'active' : ''}`} onClick={() => setTab('items')}>
              Items Taken ({flatItems.length})
            </button>
            <button className={`tab-btn ${tab === 'payments' ? 'active' : ''}`} onClick={() => setTab('payments')}>
              Payments ({payments.length})
            </button>
          </div>

          {/* ── Transactions tab ───────────────────────────────── */}
          {tab === 'transactions' && (
            <div className="table-wrap" {...txList.getContainerProps()}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 34 }} />
                    <th>Date</th>
                    <th>Particulars</th>
                    <th className="num">Amount</th>
                    <th className="num">Balance</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {txRows.map((r, i) => {
                    const hasItems = r.items.length > 0;
                    const open = expanded.has(r.id);
                    return (
                      <Fragment key={r.id}>
                        <tr
                          {...txList.getRowProps(i)}
                          className={isOverdueDue(r) ? 'row-danger' : r.amount < 0 ? '' : 'row-low'}
                        >
                          <td>
                            {hasItems ? (
                              <button className="btn-icon" onClick={() => toggleExpand(r.id)} title={open ? 'Hide items' : 'Show items'}>
                                {open ? '▾' : '▸'}
                              </button>
                            ) : null}
                          </td>
                          <td>{r.created_at ? formatDateTimeAdmin(r.created_at) : '—'}</td>
                          <td>
                            {r.type.startsWith('payment') ? (
                              <span className="text-ok">
                                Payment ({r.type.split(':')[1]})
                                {r.note ? ` — ${r.note}` : ''}
                              </span>
                            ) : r.sale_id && r.invoice_no ? (
                              <>
                                <button className="link-btn" onClick={() => openReceipt(r.sale_id as number)}>
                                  {r.invoice_no}
                                </button>{' '}
                                <span className="muted small">Udhaar sale</span>
                                {hasItems && <span className="muted small"> · {r.items.length} item(s)</span>}
                              </>
                            ) : isManualEntry(r) ? (
                              <>
                                <span>{r.direction === 'credit' ? 'Items returned' : 'Udhaar items'}</span>
                                {r.reference && <span className="muted small"> · {r.reference}</span>}
                                {hasItems && <span className="muted small"> · {r.items.length} item(s)</span>}
                              </>
                            ) : r.type === 'opening_balance' ? (
                              <span className="muted">Opening balance</span>
                            ) : (
                              <span className="muted">{r.note || 'Void'}</span>
                            )}
                            {r.overdue && <span className="badge badge-warn" style={{ marginLeft: 8 }}>Overdue</span>}
                            {!r.overdue && r.direction === 'debit' && r.paid && (
                              <span className="badge" style={{ marginLeft: 8 }}>Paid</span>
                            )}
                          </td>
                          <td className={`num ${r.amount < 0 ? 'text-ok' : 'text-warn'}`}>
                            {r.amount > 0 ? '+' : ''}
                            {formatMoney(r.amount)}
                          </td>
                          <td className="num">{formatMoney(r.running)}</td>
                          <td>
                            {isManualEntry(r) ? (
                              <div className="row-actions">
                                <button className="btn btn-sm" onClick={() => printEntrySlip(r.id)} disabled={busy}>
                                  Print
                                </button>
                                <button className="btn btn-sm" onClick={() => shareEntrySlip(r.id)} disabled={busy}>
                                  WhatsApp
                                </button>
                              </div>
                            ) : (
                              <span className="muted small">—</span>
                            )}
                          </td>
                        </tr>
                        {open && (
                          <tr key={`${r.id}-detail`} className="ledger-item-row">
                            <td colSpan={6}>
                              <div className="item-meta">
                                <span>
                                  <b>{r.invoice_no ?? (isManualEntry(r) ? 'Udhaar items' : 'Entry')}</b>
                                </span>
                                {r.cashier_name && <span>Cashier: {r.cashier_name}</span>}
                                {r.reference && <span>Ref: {r.reference}</span>}
                                {r.note && <span>Note: {r.note}</span>}
                              </div>
                              <table className="data-table item-detail">
                                <thead>
                                  <tr>
                                    <th>Invoice</th>
                                    <th>Product</th>
                                    <th className="num">Qty</th>
                                    <th className="num">Rate</th>
                                    <th className="num">Disc</th>
                                    <th className="num">Amount</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {r.items.map((it) => (
                                    <tr key={it.key}>
                                      <td className="muted small">{it.invoice_no ?? '—'}</td>
                                      <td className="name">
                                        {it.name}
                                        {it.barcode ? <span className="muted small"> · {it.barcode}</span> : null}
                                        {(it.batch || it.expiry) && (
                                          <span className="muted small"> · Batch {it.batch ?? '—'} / Exp {it.expiry ?? '—'}</span>
                                        )}
                                      </td>
                                      <td className="num">
                                        {it.qty}
                                        {it.unit ? ` ${it.unit}` : ''}
                                      </td>
                                      <td className="num">{formatMoney(it.rate)}</td>
                                      <td className="num">{it.discount ? formatMoney(it.discount) : '—'}</td>
                                      <td className="num">{formatMoney(it.line_total)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted center">
                        No transactions yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Items Taken tab ────────────────────────────────── */}
          {tab === 'items' && (
            <>
              <div className="ledger-toolbar">
                <SearchInput value={itemSearch} onChange={setItemSearch} placeholder="Search item / barcode..." debounceMs={200} />
                <select className="field-select" value={itemPaid} onChange={(e) => setItemPaid(e.target.value as typeof itemPaid)}>
                  <option value="all">All</option>
                  <option value="unpaid">Unpaid</option>
                  <option value="paid">Paid</option>
                </select>
                <label className="inline-check">
                  <input type="checkbox" checked={groupByProduct} onChange={(e) => setGroupByProduct(e.target.checked)} />
                  Group by product
                </label>
              </div>

              <div className="table-wrap" {...itemList.getContainerProps()}>
                <table className="data-table">
                  <thead>
                    {groupByProduct ? (
                      <tr>
                        <th>Product</th>
                        <th className="num">Qty</th>
                        <th className="num">Amount</th>
                      </tr>
                    ) : (
                      <tr>
                        <th>Date</th>
                        <th>Invoice</th>
                        <th>Item</th>
                        <th className="num">Qty</th>
                        <th className="num">Rate</th>
                        <th className="num">Amount</th>
                        <th>Status</th>
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {groupByProduct
                      ? grouped.map((g, i) => (
                          <tr key={g.name} {...itemList.getRowProps(i)}>
                            <td className="name">{g.name}</td>
                            <td className="num">
                              {g.qty}
                              {g.unit ? ` ${g.unit}` : ''}
                            </td>
                            <td className="num">{formatMoney(g.amount)}</td>
                          </tr>
                        ))
                      : filteredItems.map((it, i) => (
                          <tr key={it.key} {...itemList.getRowProps(i)} className={it.overdue ? 'row-danger' : ''}>
                            <td>{it.created_at ? formatDateAdmin(it.created_at) : '—'}</td>
                            <td>
                              {it.sale_id && it.invoice_no ? (
                                <button className="link-btn" onClick={() => openReceipt(it.sale_id as number)}>
                                  {it.invoice_no}
                                </button>
                              ) : (
                                it.invoice_no ?? '—'
                              )}
                            </td>
                            <td className="name">
                              {it.name}
                              {it.barcode ? <span className="muted small"> · {it.barcode}</span> : null}
                            </td>
                            <td className="num">
                              {it.qty}
                              {it.unit ? ` ${it.unit}` : ''}
                            </td>
                            <td className="num">{formatMoney(it.rate)}</td>
                            <td className="num">{formatMoney(it.line_total)}</td>
                            <td>
                              {it.paid ? (
                                <span className="badge">Paid</span>
                              ) : (
                                <span className="badge badge-warn">Unpaid</span>
                              )}
                            </td>
                          </tr>
                        ))}
                    {((groupByProduct && grouped.length === 0) || (!groupByProduct && filteredItems.length === 0)) && (
                      <tr>
                        <td colSpan={groupByProduct ? 3 : 7} className="muted center">
                          No items match these filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={groupByProduct ? 1 : 3} className="num muted">
                        Totals
                      </td>
                      {groupByProduct ? (
                        <>
                          <td className="num">{itemTotals.qty}</td>
                          <td className="num">{formatMoney(itemTotals.amount)}</td>
                        </>
                      ) : (
                        <>
                          <td className="num">{itemTotals.qty}</td>
                          <td />
                          <td className="num">{formatMoney(itemTotals.amount)}</td>
                          <td />
                        </>
                      )}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}

          {/* ── Payments tab ───────────────────────────────────── */}
          {tab === 'payments' && (
            <>
              <div className="pay-box">
                <select value={payMode} onChange={(e) => setPayMode(e.target.value)}>
                  {PAY_MODES.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
                <KeyboardInput
                  type="text"
                  decimals
                  placeholder={`Amount (${getCurrencySymbol()})`}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
                <input placeholder="Note (optional)" value={payNote} onChange={(e) => setPayNote(e.target.value)} />
                <button className="btn btn-primary" onClick={submitPayment} disabled={busy || !payAmount || Number(payAmount) <= 0}>
                  Receive Payment
                </button>
              </div>
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
                    {[...payments].reverse().map((p) => (
                      <tr key={p.id}>
                        <td>{p.created_at ? formatDateTimeAdmin(p.created_at) : '—'}</td>
                        <td>{p.type.split(':')[1] ?? 'Cash'}</td>
                        <td className="muted">{p.note ?? '—'}</td>
                        <td className="num text-ok">{formatMoney(Math.abs(p.amount))}</td>
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
            </>
          )}

          <div className="modal-actions">
            <button className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      )}

      {entryOpen && data && (
        <UdhaarEntryModal
          customerId={data.customer.id}
          customerName={data.customer.name}
          customerBalance={data.customer.balance}
          initialDirection={entryDirection}
          onClose={() => setEntryOpen(false)}
          onSaved={() => {
            load().catch(() => undefined);
            onChanged?.();
          }}
        />
      )}

      {catalogOpen && <UdhaarCatalogModal onClose={() => setCatalogOpen(false)} />}
    </Modal>
  );
}
