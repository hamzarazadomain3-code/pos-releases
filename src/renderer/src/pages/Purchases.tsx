import { useCallback, useEffect, useState } from 'react';
import { ModalCloseButton } from '../components/ModalCloseButton';
import type { Product, PurchaseItem, PurchaseOrder, PurchasePriceRow, Supplier, SupplierTransaction } from '../../../shared/types';
import { DateRangePicker, SearchInput, FilterBar, FilterRow } from '../components/filters';
import { formatDateTimeAdmin } from '../utils/dateUtils';
import { useBarcodeScan } from '../hooks/useBarcodeScan';

type Tab = 'suppliers' | 'orders';

export default function Purchases() {
  const [tab, setTab] = useState<Tab>('suppliers');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [supplierId, setSupplierId] = useState<number | ''>('');
  const [status, setStatus] = useState<'pending' | 'received' | 'cancelled' | ''>('');

  const [supplierModal, setSupplierModal] = useState(false);
  const [sName, setSName] = useState('');
  const [sPhone, setSPhone] = useState('');
  const [sAddress, setSAddress] = useState('');

  const [ledger, setLedger] = useState<{ supplier: Supplier; rows: SupplierTransaction[] } | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMode, setPayMode] = useState('cash');

  const [poModal, setPoModal] = useState(false);
  const [poSupplier, setPoSupplier] = useState('');
  const [lines, setLines] = useState<{ product_id: number; qty: string; unit_cost: string }[]>([]);
  const [poView, setPoView] = useState<{ order: PurchaseOrder; items: PurchaseItem[] } | null>(null);

  // ── PO product search: staged Enter (1x select, 2x qty, 3x add) + barcode scan ──
  const [poSearch, setPoSearch] = useState('');
  const [poSearchStage, setPoSearchStage] = useState<'idle' | 'select' | 'qty'>('idle');
  const [poSelIdx, setPoSelIdx] = useState(-1);
  const [poQty, setPoQty] = useState('1');

  const poMatches = products.filter((p) => {
    if (!poSearch) return true;
    const q = poSearch.trim().toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.sku ?? '').toLowerCase().includes(q) ||
      (p.barcode ?? '').toLowerCase().includes(q)
    );
  });

  const selectedPoProduct = () => {
    if (poSearchStage === 'idle') return undefined;
    const sel = poSelIdx >= 0 && poSelIdx < poMatches.length ? poMatches[poSelIdx] : undefined;
    if (sel) return sel;
    return poMatches.length > 0 ? poMatches[0] : undefined;
  };

  const addLineForProduct = (p: Product, qty = 1) => {
    const existing = lines.findIndex((l) => l.product_id === p.id);
    if (existing >= 0) {
      const n = [...lines];
      n[existing] = { ...n[existing], qty: String((Number(n[existing].qty) || 0) + qty) };
      setLines(n);
    } else {
      setLines([...lines, { product_id: p.id, qty: String(qty), unit_cost: String(p.cost_price || '') }]);
    }
  };

  const confirmPoAdd = () => {
    const p = selectedPoProduct();
    if (!p) return;
    addLineForProduct(p, Math.max(1, Math.floor(Number(poQty)) || 1));
    setPoSearch('');
    setPoSearchStage('idle');
    setPoSelIdx(-1);
    setPoQty('1');
  };

  useBarcodeScan({
    enabled: poModal,
    onScan: (code) => {
      window.api.inventory
        .getByBarcode(code.trim())
        .then((p) => {
          if (!p) return setErr(`No product found for barcode "${code}"`);
          addLineForProduct(p, 1);
          setPoSearch('');
          setPoSearchStage('idle');
          setPoSelIdx(-1);
          setPoQty('1');
        })
        .catch((e) => setErr(String(e)));
    },
  });

  const [priceHist, setPriceHist] = useState<PurchasePriceRow[]>([]);
  const [priceProd, setPriceProd] = useState<{ id: number; name: string } | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      setSuppliers(await window.api.purchases.suppliers());
      setOrders(await window.api.purchases.listOrders(status || undefined, from || undefined, to || undefined, supplierId || undefined));
      setProducts(await window.api.inventory.list());
    } catch (e) {
      setErr(String(e));
    }
  }, [from, to, supplierId, status]);

  useEffect(() => {
    load();
  }, [load]);

  const addSupplier = async () => {
    if (!sName.trim()) return setErr('Supplier name required');
    await window.api.purchases.createSupplier(sName, sPhone, sAddress);
    setSName('');
    setSPhone('');
    setSAddress('');
    setSupplierModal(false);
    await load();
  };

  const openLedger = async (s: Supplier) => {
    setLedger({ supplier: s, rows: await window.api.purchases.ledger(s.id) });
  };

  const pay = async () => {
    if (!ledger) return;
    const amt = Number(payAmount);
    if (!amt || amt <= 0) return setErr('Enter a valid amount');
    try {
      const sup = await window.api.purchases.paySupplier(ledger.supplier.id, amt, payMode);
      setLedger({ supplier: sup, rows: await window.api.purchases.ledger(sup.id) });
      setPayAmount('');
      await load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const openPo = async (id: number) => {
    const full = await window.api.purchases.getOrder(id);
    if (full) setPoView({ order: full, items: full.items });
  };

  const receivePo = async (id: number) => {
    await window.api.purchases.receiveOrder(id);
    setPoView(null);
    await load();
  };

  const cancelPo = async (id: number) => {
    await window.api.purchases.cancelOrder(id);
    setPoView(null);
    await load();
  };

  const showPriceHist = async (p: Product) => {
    setPriceProd({ id: p.id, name: p.name });
    setPriceHist(await window.api.purchases.priceHistory(p.id));
  };

  const poTotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_cost) || 0), 0);

  const resetStagedSearch = () => {
    setPoSearch('');
    setPoSearchStage('idle');
    setPoSelIdx(-1);
    setPoQty('1');
  };

  const savePo = async () => {
    if (!poSupplier) return setErr('Select a supplier');
    const items = lines
      .filter((l) => l.product_id && Number(l.qty) > 0)
      .map((l) => ({ product_id: l.product_id, qty: Number(l.qty), unit_cost: Number(l.unit_cost) || 0 }));
    if (!items.length) return setErr('Add at least one item');
    try {
      await window.api.purchases.createOrder(Number(poSupplier), items);
      setPoModal(false);
      setPoSupplier('');
      setLines([]);
      resetStagedSearch();
      await load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const statusLabel = (s: string) => (s === 'received' ? 'Received' : s === 'cancelled' ? 'Cancelled' : 'Pending');

  const supplierOptions = suppliers.map(s => ({ value: s.id, label: s.name }));
  const statusOptions = [
    { value: 'pending', label: 'Pending' },
    { value: 'received', label: 'Received' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  const handleClearPurchaseFilters = () => {
    setFrom('');
    setTo('');
    setSupplierId('');
    setStatus('');
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Purchases & Suppliers</h1>
        <div className="tabs">
          <button className={`tab-btn ${tab === 'suppliers' ? 'active' : ''}`} onClick={() => setTab('suppliers')}>
            Suppliers
          </button>
          <button className={`tab-btn ${tab === 'orders' ? 'active' : ''}`} onClick={() => setTab('orders')}>
            Purchase Orders
          </button>
        </div>
      </div>

      {err && (
        <div className="notice error">
          {err} <button className="btn btn-sm" onClick={() => setErr('')}>OK</button>
        </div>
      )}

      {tab === 'suppliers' && (
        <div className="card">
          <div className="card-head">
            <h2>Suppliers</h2>
            <button className="btn btn-primary" onClick={() => setSupplierModal(true)}>
              Add Supplier
            </button>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Payable</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.phone ?? '—'}</td>
                  <td className={s.balance > 0 ? 'text-warn' : ''}>{s.balance.toFixed(2)}</td>
                  <td>
                    <button className="btn btn-sm" onClick={() => openLedger(s)}>
                      Ledger / Pay
                    </button>
                  </td>
                </tr>
              ))}
              {!suppliers.length && (
                <tr>
                  <td colSpan={4} className="muted">
                    No suppliers yet — add one to start purchasing.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'orders' && (
        <div className="card">
          <FilterBar onClear={handleClearPurchaseFilters} onApply={load}>
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
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : '')}
                style={{ width: '180px' }}
              >
                <option value="">All Suppliers</option>
                {supplierOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <select
                className="field-select"
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                style={{ width: '140px' }}
              >
                <option value="">All Status</option>
                {statusOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </FilterRow>
            <FilterRow style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-sm" onClick={() => window.api.excel.exportPurchaseOrders({ status: status || undefined, from: from || undefined, to: to || undefined, supplierId: supplierId || undefined }).catch((e) => setErr(String(e)))}>
                Export Excel
              </button>
              <button className="btn btn-primary" onClick={() => { resetStagedSearch(); setPoModal(true); }}>
                New Purchase Order
              </button>
            </FilterRow>
          </FilterBar>
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Supplier</th>
                <th>Date</th>
                <th>Total</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>PO-{String(o.id).padStart(4, '0')}</td>
                  <td>{o.supplier_name ?? '—'}</td>
                  <td>{o.created_at ? formatDateTimeAdmin(o.created_at) : '—'}</td>
                  <td>{o.total_amount.toFixed(2)}</td>
                  <td>
                    <span className={`badge ${o.status === 'received' ? 'ok' : o.status === 'cancelled' ? 'bad' : ''}`}>
                      {statusLabel(o.status)}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-sm" onClick={() => openPo(o.id)}>
                      View
                    </button>
                    {o.status === 'pending' && (
                      <>
                        <button className="btn btn-sm btn-primary" onClick={() => receivePo(o.id)}>
                          Receive Stock
                        </button>
                        <button className="btn btn-sm" onClick={() => cancelPo(o.id)}>
                          Cancel
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!orders.length && (
                <tr>
                  <td colSpan={6} className="muted">
                    No purchase orders yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {supplierModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2>Add Supplier</h2>
              <ModalCloseButton onClose={() => setSupplierModal(false)} />
            </div>
            <label className="lbl">Name *</label>
            <input className="inp" value={sName} onChange={(e) => setSName(e.target.value)} autoFocus />
            <label className="lbl">Phone</label>
            <input className="inp" value={sPhone} onChange={(e) => setSPhone(e.target.value)} />
            <label className="lbl">Address</label>
            <input className="inp" value={sAddress} onChange={(e) => setSAddress(e.target.value)} />
            <div className="row-btns">
              <button className="btn btn-primary" onClick={addSupplier}>
                Save
              </button>
              <button className="btn" onClick={() => setSupplierModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {poModal && (
        <div className="modal-overlay">
          <div className="modal modal-wide">
<div className="modal-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h2>New Purchase Order</h2>
                <ModalCloseButton onClose={() => { resetStagedSearch(); setPoModal(false); }} />
              </div>
            <label className="lbl">Supplier *</label>
            <select className="inp" value={poSupplier} onChange={(e) => setPoSupplier(e.target.value)}>
              <option value="">— select —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <div style={{ marginTop: 12 }}>
              <label className="lbl">Search / scan product (Enter 1× select, 2× qty, 3× add)</label>
              <input
                className="inp"
                placeholder="Type name, SKU or barcode, or scan…"
                value={poSearch}
                onChange={(e) => {
                  setPoSearch(e.target.value);
                  setPoSearchStage('idle');
                  setPoSelIdx(-1);
                  setPoQty('1');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    const count = poMatches.length;
                    if (count === 0) return;
                    e.preventDefault();
                    setPoSelIdx((prev) => {
                      const base = prev < 0 ? 0 : prev;
                      const next = e.key === 'ArrowDown' ? (base + 1) % count : (base - 1 + count) % count;
                      const el = document.querySelector(`[data-po-index="${next}"]`);
                      (el as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
                      return next;
                    });
                    setPoSearchStage('idle');
                    return;
                  }
                  if (e.key === 'Enter' || e.key === '\r' || e.key === '\n') {
                    e.preventDefault();
                    if (poMatches.length === 0) return;
                    if (poSearchStage === 'select') {
                      setPoSearchStage('qty');
                      return;
                    }
                    const sel = poSelIdx >= 0 && poSelIdx < poMatches.length ? poSelIdx : 0;
                    setPoSelIdx(sel);
                    const el = document.querySelector(`[data-po-index="${sel}"]`);
                    (el as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
                    setPoSearchStage('select');
                    return;
                  }
                  if (e.key === 'Escape' || e.key === 'Esc') {
                    setPoSearch('');
                    setPoSearchStage('idle');
                    setPoSelIdx(-1);
                    setPoQty('1');
                  }
                }}
              />
              {poSearch && poMatches.length > 0 && (
                <div className="search-result-dropdown">
                  {poMatches.slice(0, 30).map((p, i) => (
                    <button
                      key={p.id}
                      data-po-index={i}
                      type="button"
                      className={`search-result-item${i === poSelIdx ? ' highlighted' : ''}${poSearchStage === 'select' && poSelIdx === i ? ' selected' : ''}`}
                      onMouseEnter={() => setPoSelIdx(i)}
                      onClick={() => {
                        if (poSearchStage === 'select' && poSelIdx === i) setPoSearchStage('qty');
                        else {
                          setPoSelIdx(i);
                          setPoSearchStage('qty');
                        }
                      }}
                    >
                      <span className="psr-name">{p.name}</span>
                      <span className="psr-meta">
                        cost {p.cost_price}
                        {p.barcode ? ` • ${p.barcode}` : p.sku ? ` • ${p.sku}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {poSearchStage === 'qty' && selectedPoProduct() && (
                <div className="quantity-input-box">
                  <span>{selectedPoProduct()!.name} — Qty:</span>
                  <input
                    type="number"
                    min={1}
                    max={9999}
                    autoFocus
                    value={poQty}
                    onChange={(e) => setPoQty(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === '\r' || e.key === '\n') {
                        e.preventDefault();
                        confirmPoAdd();
                        return;
                      }
                      if (e.key === 'Escape' || e.key === 'Esc') setPoSearchStage('select');
                    }}
                  />
                  <button className="btn btn-sm btn-primary" onClick={confirmPoAdd}>
                    Add {Math.max(1, Math.floor(Number(poQty)) || 1)}
                  </button>
                  <button className="btn btn-sm" onClick={() => setPoSearchStage('select')}>Cancel</button>
                </div>
              )}
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Product</th>
                  <th style={{ width: 100 }}>Qty</th>
                  <th style={{ width: 120 }}>Unit Cost</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <select
                        className="inp"
                        value={l.product_id}
                        onChange={(e) => {
                          const n = [...lines];
                          n[i] = { ...n[i], product_id: Number(e.target.value) };
                          setLines(n);
                        }}
                      >
                        <option value={0}>— select —</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} (cost {p.cost_price})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="inp"
                        type="number"
                        min="1"
                        value={l.qty}
                        onChange={(e) => {
                          const n = [...lines];
                          n[i] = { ...n[i], qty: e.target.value };
                          setLines(n);
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="inp"
                        type="number"
                        min="0"
                        step="0.01"
                        value={l.unit_cost}
                        onChange={(e) => {
                          const n = [...lines];
                          n[i] = { ...n[i], unit_cost: e.target.value };
                          setLines(n);
                        }}
                      />
                    </td>
                    <td>
                      <button
                        className="btn btn-sm"
                        onClick={() => setLines(lines.filter((_, j) => j !== i))}
                      >
                        X
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              className="btn btn-sm"
              onClick={() => setLines([...lines, { product_id: 0, qty: '', unit_cost: '' }])}
            >
              + Add Item
            </button>
            <div className="total-bar">
              Total: <strong>{poTotal.toFixed(2)}</strong>
            </div>
            <div className="row-btns">
              <button className="btn btn-primary" onClick={savePo}>
                Create (adds to payable)
              </button>
              <button
                className="btn"
                onClick={() => {
                  setPoModal(false);
                  setPoSupplier('');
                  setLines([]);
                  resetStagedSearch();
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {poView && (
        <div className="modal-overlay">
          <div className="modal modal-wide">
            <div className="modal-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2>
                PO-{String(poView.order.id).padStart(4, '0')} — {poView.order.supplier_name ?? ''}
              </h2>
              <ModalCloseButton onClose={() => setPoView(null)} />
            </div>
            <p className="muted small">
              {formatDateTimeAdmin(poView.order.created_at ?? '')} | {statusLabel(poView.order.status)}
            </p>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Unit Cost</th>
                  <th>Line Total</th>
                </tr>
              </thead>
              <tbody>
                {poView.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.product_name ?? `#${i.product_id}`}</td>
                    <td>{i.qty}</td>
                    <td>{i.unit_cost.toFixed(2)}</td>
                    <td>{(i.qty * i.unit_cost).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="total-bar">
              Total: <strong>{poView.order.total_amount.toFixed(2)}</strong>
            </div>
            {poView.order.status === 'pending' && (
              <div className="row-btns">
                <button className="btn btn-primary" onClick={() => receivePo(poView.order.id)}>
                  Receive Stock
                </button>
                <button className="btn" onClick={() => cancelPo(poView.order.id)}>
                  Cancel Order
                </button>
              </div>
            )}
            <button className="btn" onClick={() => setPoView(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {ledger && (
        <div className="modal-overlay">
          <div className="modal modal-wide">
            <div className="modal-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2>Supplier — {ledger.supplier.name}</h2>
              <ModalCloseButton onClose={() => setLedger(null)} />
            </div>
            <div className="ledger-head">
              <span>
                Payable: <strong>{ledger.supplier.balance.toFixed(2)}</strong>
              </span>
              <span>
                Pay:
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="limit-input"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
                <select className="limit-input" value={payMode} onChange={(e) => setPayMode(e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="bank">Bank</option>
                  <option value="jazzcash">JazzCash</option>
                  <option value="easypaisa">Easypaisa</option>
                </select>
                <button className="btn btn-sm btn-primary" onClick={pay}>
                  Pay
                </button>
              </span>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {ledger.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDateTimeAdmin(r.created_at ?? '')}</td>
                    <td>
                      {r.type.startsWith('payment')
                        ? 'Payment'
                        : r.type === 'purchase'
                          ? `Purchase (PO-${String(r.purchase_order_id ?? 0).padStart(4, '0')})`
                          : 'Cancelled'}
                    </td>
                    <td className={r.amount < 0 ? '' : 'text-warn'}>
                      {r.amount < 0 ? `(${(-r.amount).toFixed(2)})` : r.amount.toFixed(2)}
                    </td>
                    <td>{r.running.toFixed(2)}</td>
                  </tr>
                ))}
                {!ledger.rows.length && (
                  <tr>
                    <td colSpan={4} className="muted">
                      No transactions.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <button className="btn" onClick={() => setLedger(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {priceProd && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2>Price History — {priceProd.name}</h2>
              <ModalCloseButton onClose={() => setPriceProd(null)} />
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {priceHist.map((h) => (
                  <tr key={h.id}>
                    <td>{formatDateTimeAdmin(h.created_at ?? '')}</td>
                    <td>{h.unit_cost.toFixed(2)}</td>
                  </tr>
                ))}
                {!priceHist.length && (
                  <tr>
                    <td colSpan={2} className="muted">
                      No purchase history.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <button className="btn" onClick={() => setPriceProd(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {tab === 'orders' && (
        <div className="card">
          <div className="card-head">
            <h2>Price History</h2>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Product</th>
                <th>Cost</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.slice(0, 30).map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.cost_price.toFixed(2)}</td>
                  <td>
                    <button className="btn btn-sm" onClick={() => showPriceHist(p)}>
                      History
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}