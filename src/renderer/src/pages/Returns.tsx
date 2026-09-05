import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CashRefundRow, ReturnRow, Sale, SaleItem } from '../../../shared/types';
import { DateRangePicker, SearchInput, FilterBar, FilterRow } from '../components/filters';
import { formatDateTimeAdmin } from '../utils/dateUtils';

export default function Returns() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Sale | null>(null);
  const [saleDetail, setSaleDetail] = useState<{ sale: Sale; items: SaleItem[] } | null>(null);
  const [qtyMap, setQtyMap] = useState<Record<number, string>>({});
  const [priceMap, setPriceMap] = useState<Record<number, string>>({});
  const [includeMap, setIncludeMap] = useState<Record<number, boolean>>({});
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'cash' | 'credit'>('cash');
  const [restock, setRestock] = useState(true);
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');
  const [cfAmount, setCfAmount] = useState('');
  const [cfReason, setCfReason] = useState('');
  const [cfBusy, setCfBusy] = useState(false);
  const [cashRefunds, setCashRefunds] = useState<CashRefundRow[]>([]);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [customerId, setCustomerId] = useState<number | ''>('');
  const [productId, setProductId] = useState<number | ''>('');

  const load = useCallback(async () => {
    setSales(await window.api.sales.list());
    setReturns(await window.api.returns.list(from || undefined, to || undefined, customerId || undefined, productId || undefined));
    setCashRefunds(await window.api.returns.listCashRefunds());
  }, [from, to, customerId, productId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(
    () => sales.filter((s) => (search ? `${s.invoice_no} ${s.customer_name ?? ''}`.toLowerCase().includes(search.toLowerCase()) : true)),
    [sales, search]
  );

  const openSale = async (s: Sale) => {
    setSelected(s);
    setErr('');
    setSuccess('');
    const detail = await window.api.sales.get(s.id);
    if (!detail) return;
    setSaleDetail({ sale: detail, items: detail.items });
    const q: Record<number, string> = {};
    const p: Record<number, string> = {};
    const inc: Record<number, boolean> = {};
    for (const it of detail.items) {
      const remaining = it.qty - (it.returned_qty ?? 0);
      q[it.id] = remaining > 0 ? String(remaining) : '0';
      p[it.id] = String(it.unit_price);
      inc[it.id] = remaining > 0;
    }
    setQtyMap(q);
    setPriceMap(p);
    setIncludeMap(inc);
  };

  const doReturn = async () => {
    if (!saleDetail) return;
    const items = saleDetail.items
      .filter((i) => includeMap[i.id] && Number(qtyMap[i.id]) > 0)
      .map((i) => ({ sale_item_id: i.id, qty: Number(qtyMap[i.id]), unit_price: Number(priceMap[i.id]) || 0 }));
    if (!items.length) return setErr('Select at least one item with a quantity');
    try {
      const r = await window.api.returns.create({
        sale_id: saleDetail.sale.id,
        items,
        reason: reason || undefined,
        refund_mode: mode,
        restock,
      });
      setSuccess(`Return #${r.id} saved — refund ${r.refund_amount.toFixed(2)} (${r.refund_mode})`);
      setReason('');
      setSelected(null);
      setSaleDetail(null);
      await load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const doCashRefund = async () => {
    const amount = Number(cfAmount);
    if (!amount || amount <= 0) return setErr('Enter a valid refund amount');
    setCfBusy(true);
    try {
      const r = await window.api.returns.createCashRefund(amount, cfReason.trim() || undefined, 'cash');
      setSuccess(`Cash refund #${r.id} recorded — Rs ${r.amount.toFixed(2)}`);
      setCfAmount('');
      setCfReason('');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCfBusy(false);
    }
  };

  const customerOptions = sales.map(s => ({ value: s.customer_id ?? 0, label: s.customer_name ?? 'Walk-in' })).filter((v, i, a) => a.findIndex(t => t.value === v.value) === i && v.value !== 0);
  const productOptions = [] as { value: number; label: string }[]; // Would need to fetch from products or aggregate from sales

  const handleClearReturnFilters = () => {
    setFrom('');
    setTo('');
    setCustomerId('');
    setProductId('');
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Returns / Refunds</h1>
        <FilterBar onClear={handleClearReturnFilters} onApply={load}>
          <FilterRow>
            <DateRangePicker
              from={from}
              to={to}
              onChange={(from: string, to: string) => { setFrom(from); setTo(to); }}
              labelFrom="From"
              labelTo="To"
            />
            <select
              className="field-select"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : '')}
              style={{ width: '180px' }}
            >
              <option value="">All Customers</option>
              {customerOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <select
              className="field-select"
              value={productId}
              onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : '')}
              style={{ width: '180px' }}
            >
              <option value="">All Products</option>
              {productOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </FilterRow>
        </FilterBar>
      </div>

      {err && (
        <div className="notice error">
          {err} <button className="btn btn-sm" onClick={() => setErr('')}>OK</button>
        </div>
      )}
      {success && <div className="notice">{success}</div>}

      <div className="card">
        <div className="card-head">
          <h2>Return an item from an invoice</h2>
          <input
            className="inp search-input"
            placeholder="Search by invoice no or customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 320 }}
          />
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Date</th>
              <th>Customer</th>
              <th>Total</th>
              <th>Returned</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered
              .filter((s) => s.status === 'completed')
              .slice(0, 30)
              .map((s) => (
                <tr key={s.id} className={selected?.id === s.id ? 'row-low' : ''}>
                  <td>{s.invoice_no}</td>
                  <td>{formatDateTimeAdmin(s.created_at ?? '')}</td>
                  <td>{s.customer_name ?? 'Walk-in'}</td>
                  <td>{s.total_amount.toFixed(2)}</td>
                  <td className={s.returned_amount ? 'text-warn' : ''}>{(s.returned_amount ?? 0).toFixed(2)}</td>
                  <td>
                    <button className="btn btn-sm" onClick={() => openSale(s)}>
                      {selected?.id === s.id ? 'Selected' : 'Select'}
                    </button>
                  </td>
                </tr>
              ))}
            {!filtered.filter((s) => s.status === 'completed').length && (
              <tr>
                <td colSpan={6} className="muted">
                  No completed sales.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {saleDetail && (
        <div className="card">
          <div className="card-head">
            <h2>
              {saleDetail.sale.invoice_no} — {saleDetail.sale.customer_name ?? 'Walk-in'}
            </h2>
            <span className="muted small">
              Total {saleDetail.sale.total_amount.toFixed(2)} | Already returned {(saleDetail.sale.returned_amount ?? 0).toFixed(2)} |{' '}
              Returnable {(saleDetail.sale.total_amount - (saleDetail.sale.returned_amount ?? 0)).toFixed(2)}
            </span>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 30 }}></th>
                <th>Item</th>
                <th style={{ width: 110 }}>Qty</th>
                <th style={{ width: 120 }}>Unit Refund</th>
                <th style={{ width: 120 }}>Refund</th>
              </tr>
            </thead>
            <tbody>
              {saleDetail.items.map((it) => {
                const remaining = it.qty - (it.returned_qty ?? 0);
                const qty = Number(qtyMap[it.id]) || 0;
                const price = Number(priceMap[it.id]) || 0;
                return (
                  <tr key={it.id} className={remaining <= 0 ? 'muted' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        checked={!!includeMap[it.id]}
                        disabled={remaining <= 0}
                        onChange={(e) => setIncludeMap({ ...includeMap, [it.id]: e.target.checked })}
                      />
                    </td>
                    <td>
                      {it.product_name ?? `#${it.product_id}`}
                      <div className="small muted">
                        sold {it.qty} {remaining <= 0 ? '(fully returned)' : `(returnable ${remaining})`}
                      </div>
                    </td>
                    <td>
                      <input
                        className="inp"
                        type="number"
                        min="0"
                        max={remaining}
                        value={qtyMap[it.id] ?? ''}
                        onChange={(e) => setQtyMap({ ...qtyMap, [it.id]: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="inp"
                        type="number"
                        min="0"
                        step="0.01"
                        value={priceMap[it.id] ?? ''}
                        onChange={(e) => setPriceMap({ ...priceMap, [it.id]: e.target.value })}
                      />
                    </td>
                    <td className="num">{(qty * price).toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="expense-form" style={{ marginTop: 12 }}>
            <input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: 1 }} />
            <select value={mode} onChange={(e) => setMode(e.target.value as 'cash' | 'credit')}>
              <option value="cash">Cash refund</option>
              <option value="credit">Credit to customer balance</option>
            </select>
            <label className="lbl" style={{ margin: 0 }}>
              <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> Restock returned items
            </label>
            <button className="btn btn-primary" onClick={doReturn}>
              Return — refund{' '}
              {saleDetail.items
                .filter((i) => includeMap[i.id])
                .reduce((s, i) => s + (Number(qtyMap[i.id]) || 0) * (Number(priceMap[i.id]) || 0), 0)
                .toFixed(2)}
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>Cash Refund (no invoice)</h2>
        </div>
        <div className="expense-form">
          <input
            placeholder="Amount (Rs)"
            type="number"
            min="0"
            step="0.01"
            value={cfAmount}
            onChange={(e) => setCfAmount(e.target.value)}
            style={{ maxWidth: 160 }}
          />
          <input placeholder="Reason (optional)" value={cfReason} onChange={(e) => setCfReason(e.target.value)} style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={doCashRefund} disabled={cfBusy}>
            Refund Cash
          </button>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          Records cash paid out from the drawer without a linked invoice (e.g. change errors, petty refunds). Counted against the current shift's cash.
        </p>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Returns History</h2>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>Invoice</th>
              <th>Date</th>
              <th>Refund</th>
              <th>Mode</th>
              <th>Restocked</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {returns.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.invoice_no ?? '—'}</td>
                <td>{formatDateTimeAdmin(r.created_at ?? '')}</td>
                <td className="text-warn">({r.refund_amount.toFixed(2)})</td>
                <td>{r.refund_mode}</td>
                <td>{r.restock ? 'Yes' : 'No'}</td>
                <td>{r.reason ?? '—'}</td>
              </tr>
            ))}
            {!returns.length && (
              <tr>
                <td colSpan={7} className="muted">
                  No returns yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Cash Refunds History</h2>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>Date</th>
              <th>Refund</th>
              <th>By</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {cashRefunds.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{formatDateTimeAdmin(r.created_at ?? '')}</td>
                <td className="text-warn">({r.amount.toFixed(2)})</td>
                <td>{r.username ?? '—'}</td>
                <td>{r.reason ?? '—'}</td>
              </tr>
            ))}
            {!cashRefunds.length && (
              <tr>
                <td colSpan={5} className="muted">
                  No cash refunds yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}