import { useCallback, useEffect, useRef, useState } from 'react';
import type { Product, PurchaseItem, PurchaseOrder, PurchasePriceRow, Supplier, SupplierTransaction } from '../../../shared/types';
import { DateRangePicker, SearchInput, FilterBar, FilterRow } from '../components/filters';
import { formatDateTimeAdmin } from '../utils/dateUtils';
import { Modal } from '../components/Modal';
import { KeyboardInput } from '../components/KeyboardInput';
import { useListKeyboard } from '../hooks/useListKeyboard';
import { useKeyboardScope } from '../hooks/useKeyboardScope';
import PurchaseOrderModal from '../components/PurchaseOrderModal';
import PurchaseImportWizard from '../components/PurchaseImportWizard';
import { downloadBytes } from '../utils/download';
import { fileBytesFromResult } from '../../../shared/binaryTransfer';
import { lineMoney } from '../../../shared/purchaseCalc';

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
  const [poView, setPoView] = useState<{ order: PurchaseOrder; items: PurchaseItem[] } | null>(null);

  // ── Phase 3: import wizard, partial receive, undo ──
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importDragOver, setImportDragOver] = useState(false);
  const [receiveQty, setReceiveQty] = useState<Record<number, string>>({});
  const [undoInfo, setUndoInfo] = useState<{ id: number; imported_count: number } | null>(null);
  /** The order that is being cancelled + WHY. */
  const [cancelTarget, setCancelTarget] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  /** What the receipt says about the product's cost price. */
  const [receiveNote, setReceiveNote] = useState('');

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

  const receivePo = async (id: number, linesToReceive?: { product_id: number; qty: number }[]) => {
    try {
      await window.api.purchases.receiveOrder(id, linesToReceive);
      // The receipt says what happened to the product's cost price — the shop
      // must never wonder why a cost did (or did not) change.
      try {
        const s = await window.api.purchases.poSettings();
        setReceiveNote(
          s.update_cost_price
            ? 'Stock received. The products’ cost price now follows this purchase.'
            : 'Stock received. The products’ cost price was left as it is (the shop’s costing setting says so).'
        );
      } catch {
        setReceiveNote('Stock received.');
      }
      setPoView(null);
      setReceiveQty({});
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  /** Receive only the quantities typed in the PO view (partial receive). */
  const receivePartial = async () => {
    if (!poView) return;
    const lines = poView.items
      .map((i) => ({ product_id: i.product_id, qty: Number(receiveQty[i.product_id]) || 0 }))
      .filter((l) => l.qty > 0);
    if (!lines.length) return setErr('Type how much of each line arrived before receiving.');
    await receivePo(poView.order.id, lines);
  };

  const refreshUndo = useCallback(() => {
    window.api.purchases
      .importLast()
      .then((r) => setUndoInfo(r ? { id: r.id, imported_count: r.imported_count } : null))
      .catch(() => setUndoInfo(null));
  }, []);

  useEffect(() => {
    refreshUndo();
  }, [refreshUndo]);

  const undoLastImport = async () => {
    try {
      const r = await window.api.purchases.importUndo();
      setErr(`✓ ${r.message}`);
      refreshUndo();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  /** Ask WHY the order is being cancelled — the reason is stored with it. */
  const askCancelPo = (id: number) => {
    setCancelTarget(id);
    setCancelReason('');
  };

  const cancelPo = async (id: number, reason?: string) => {
    try {
      await window.api.purchases.cancelOrder(id, reason);
      setCancelTarget(null);
      setCancelReason('');
      setPoView(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  /** Print the order (A4 or thermal) through the ONE print path. */
  const printPo = async (id: number, paper: 'a4' | 'thermal80') => {
    try {
      const r = await window.api.purchases.printOrder(id, paper);
      if (!r?.ok) setErr(r?.message || 'The print did not go through.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  /**
   * Duplicate an order: the SAME lines, as a NEW order (a new number, a new
   * date, nothing received yet). The copy keeps the costs and the units it
   * was ordered with — the shop can edit them before creating it.
   */
  const duplicatePo = async (id: number) => {
    try {
      const full = await window.api.purchases.getOrder(id);
      if (!full) throw new Error('Purchase order not found');
      const items = full.items.map((it) => ({
        product_id: it.product_id,
        qty: Number(it.qty) || 0,
        unit_cost: Number(it.unit_cost) || 0,
        units_in_base: it.unit_multiplier ?? 1,
        tax_pct: Number(it.tax_pct) || 0,
        batch_no: it.batch_no ?? null,
        expiry_date: it.expiry_date ?? null,
      }));
      if (!items.length) throw new Error('That order has no items to duplicate.');
      const copy = await window.api.purchases.createOrder(full.supplier_id, items, {
        status: 'draft',
        reference_no: full.reference_no ?? null,
        notes: full.notes ?? null,
        discount_type: (full.discount_type as 'amount' | 'percent') ?? 'amount',
        discount_value: Number(full.discount_value) || 0,
        freight: Number(full.freight) || 0,
      });
      await load();
      setErr(`Duplicated as PO-${String(copy.id).padStart(4, '0')} (a draft).`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const showPriceHist = async (p: Product) => {
    setPriceProd({ id: p.id, name: p.name });
    setPriceHist(await window.api.purchases.priceHistory(p.id));
  };

  // ── the order statuses ───────────────────────────────────────────────────
  //   `pending` is the LEGACY name of `ordered` — both mean "the order is
  //   open and the goods have not all arrived".
  const statusLabel = (s: string) =>
    s === 'received'
      ? 'Received'
      : s === 'cancelled'
        ? 'Cancelled'
        : s === 'draft'
          ? 'Draft'
          : s === 'partial'
            ? 'Partial'
            : 'Ordered';

  const statusChip = (s: string) =>
    s === 'received'
      ? 'po-status-received'
      : s === 'cancelled'
        ? 'po-status-cancelled'
        : s === 'draft'
          ? 'po-status-draft'
          : s === 'partial'
            ? 'po-status-partial'
            : 'po-status-ordered';

  /** An order that can still be received or cancelled. */
  const isOpenOrder = (s: string) => s === 'pending' || s === 'ordered' || s === 'partial';

  const supplierOptions = suppliers.map(s => ({ value: s.id, label: s.name }));
  const statusOptions = [
    { value: 'draft', label: 'Draft' },
    { value: 'ordered', label: 'Ordered' },
    { value: 'partial', label: 'Partial' },
    { value: 'received', label: 'Received' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  // ── the totals of the FILTERED list ──────────────────────────────────────
  const listTotal = orders.reduce((s, o) => s + (Number(o.total_amount) || 0), 0);
  const listPaid = orders.reduce((s, o) => s + (Number(o.paid_amount) || 0), 0);
  const listPayable = orders.reduce(
    (s, o) => s + Math.max(0, (Number(o.total_amount) || 0) - (Number(o.paid_amount) || 0)),
    0
  );

  const handleClearPurchaseFilters = () => {
    setFrom('');
    setTo('');
    setSupplierId('');
    setStatus('');
  };

  // ── Keyboard: arrow through the tables; Enter opens the highlighted row ──
  const supplierList = useListKeyboard({
    count: suppliers.length,
    onOpen: (i) => { const s = suppliers[i]; if (s) openLedger(s); },
  });
  const orderList = useListKeyboard({
    count: orders.length,
    onOpen: (i) => { const o = orders[i]; if (o) openPo(o.id); },
  });
  const priceList = useListKeyboard({
    count: Math.min(products.length, 30),
    onOpen: (i) => { const p = products[i]; if (p) showPriceHist(p); },
  });

  useKeyboardScope({
    kind: 'page',
    label: 'Purchases & Suppliers',
    actions: {
      new_record: () => {
        if (tab === 'suppliers') setSupplierModal(true);
        else setPoModal(true);
      },
    },
    shortcuts: [
      { action: 'new_record', label: tab === 'suppliers' ? 'Add supplier' : 'New purchase order' },
      { keys: '↑ / ↓', label: 'Move between rows' },
      { keys: 'Enter', label: 'Open highlighted row / next PO line field' },
    ],
  });

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
          <div {...supplierList.getContainerProps()}>
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
              {suppliers.map((s, i) => (
                <tr key={s.id} {...supplierList.getRowProps(i)}>
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
              <button
  className="btn btn-sm"
  onClick={async () => {
    try {
      const res = await window.api.excel.exportPurchaseOrders({ status: status || undefined, from: from || undefined, to: to || undefined, supplierId: supplierId || undefined });
      const bytes = fileBytesFromResult(res);
      if (bytes) {
        downloadBytes(bytes, 'purchase-orders.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      }
    } catch (e) {
      setErr(String(e));
    }
  }}
>
                Export Excel
              </button>
              {undoInfo && (
                <button className="btn btn-sm" onClick={undoLastImport} title={`Undo import #${undoInfo.id} (${undoInfo.imported_count} lines)`}>
                  Undo last import
                </button>
              )}
              <button className="btn btn-sm" onClick={() => { setImportFile(null); setImportOpen(true); }}>
                Import from file
              </button>
              <button className="btn btn-primary" onClick={() => setPoModal(true)}>
                New Purchase Order
              </button>
            </FilterRow>
          </FilterBar>
          <div
            data-purchase-drop="true"
            onDragOver={(e) => { e.preventDefault(); setImportDragOver(true); }}
            onDragLeave={() => setImportDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setImportDragOver(false);
              // The file itself is passed on (not a path): the browser has no
              // file system, and the wizard reads the content.
              const f = e.dataTransfer.files?.[0];
              if (f) {
                // The wizard parses it and jumps to the column mapping.
                setImportFile(f);
                setImportOpen(true);
              } else {
                setErr('Could not read the dropped file.');
              }
            }}
            style={
              importDragOver
                ? { border: '2px dashed var(--primary)', borderRadius: 8, padding: 6, marginBottom: 8, background: 'rgba(59,130,246,0.05)' }
                : undefined
            }
          >
            {importDragOver && <div className="muted small">Drop the Excel / CSV file to start the import…</div>}
          </div>
          <div className="po-totals" style={{ marginBottom: 10 }} data-testid="po-list-totals">
            <div>
              <span>Orders</span>
              <strong data-testid="po-list-count">{orders.length}</strong>
            </div>
            <div>
              <span>Order value</span>
              <strong data-testid="po-list-total">{listTotal.toFixed(2)}</strong>
            </div>
            <div>
              <span>Paid now</span>
              <strong data-testid="po-list-paid">{listPaid.toFixed(2)}</strong>
            </div>
            <div>
              <span>Payable</span>
              <strong data-testid="po-list-payable">{listPayable.toFixed(2)}</strong>
            </div>
          </div>
          <div {...orderList.getContainerProps()}>
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Supplier</th>
                <th>Date</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Payable</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o, i) => (
                <tr key={o.id} {...orderList.getRowProps(i)}>
                  <td>PO-{String(o.id).padStart(4, '0')}</td>
                  <td>{o.supplier_name ?? '—'}</td>
                  <td>{o.created_at ? formatDateTimeAdmin(o.created_at) : '—'}</td>
                  <td>{(Number(o.total_amount) || 0).toFixed(2)}</td>
                  <td>{(Number(o.paid_amount) || 0).toFixed(2)}</td>
                  <td>
                    {(
                      Math.max(0, (Number(o.total_amount) || 0) - (Number(o.paid_amount) || 0)) || 0
                    ).toFixed(2)}
                  </td>
                  <td>
                    <span className={`po-status-chip ${statusChip(o.status)}`} data-testid={`po-status-${o.id}`}>
                      {statusLabel(o.status)}
                    </span>
                  </td>
                  <td>
                    <div className="po-quick-actions">
                      <button className="btn btn-sm" onClick={() => openPo(o.id)}>
                        View
                      </button>
                      {isOpenOrder(o.status) && (
                        <>
                          <button className="btn btn-sm btn-primary" onClick={() => receivePo(o.id)}>
                            Receive
                          </button>
                          <button className="btn btn-sm" onClick={() => askCancelPo(o.id)}>
                            Cancel
                          </button>
                        </>
                      )}
                      <button className="btn btn-sm" onClick={() => printPo(o.id, 'a4')}>
                        Print
                      </button>
                      <button className="btn btn-sm" onClick={() => printPo(o.id, 'thermal80')}>
                        Thermal
                      </button>
                      <button className="btn btn-sm" onClick={() => duplicatePo(o.id)}>
                        Duplicate
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!orders.length && (
                <tr>
                  <td colSpan={8} className="muted">
                    No purchase orders yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {cancelTarget !== null && (
        <Modal
          onClose={() => setCancelTarget(null)}
          onSubmit={() => void cancelPo(cancelTarget, cancelReason)}
          title="Cancel this purchase order"
          className="modal-sm"
          label="Cancel purchase order"
          shortcuts={[{ action: 'save', label: 'Cancel the order' }]}
        >
          <div className="notice warn" style={{ marginBottom: 10 }}>
            The order is cancelled and the stock is NOT touched. The reason is stored with the order.
          </div>
          <label className="lbl">Reason</label>
          <input
            className="inp"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Why is it cancelled?"
            data-testid="po-cancel-reason"
          />
          <div className="row-btns">
            <button
              className="btn btn-primary"
              onClick={() => void cancelPo(cancelTarget, cancelReason)}
              data-testid="po-cancel-confirm"
            >
              Cancel the order
            </button>
            <button className="btn" onClick={() => setCancelTarget(null)}>
              Keep it
            </button>
          </div>
        </Modal>
      )}

      {supplierModal && (
        <Modal
          onClose={() => setSupplierModal(false)}
          onSubmit={addSupplier}
          title="Add Supplier"
          className="modal-sm"
          label="Add Supplier"
          shortcuts={[{ action: 'save', label: 'Save supplier' }]}
        >
            <label className="lbl">Name *</label>
            <input className="inp" value={sName} onChange={(e) => setSName(e.target.value)} />
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
        </Modal>
      )}

      {poModal && (
        <PurchaseOrderModal
          suppliers={suppliers}
          onClose={() => setPoModal(false)}
          onSaved={async () => {
            setPoModal(false);
            await load();
          }}
        />
      )}

      {poView && (
        <Modal
          onClose={() => setPoView(null)}
          title={`PO-${String(poView.order.id).padStart(4, '0')} — ${poView.order.supplier_name ?? ''}`}
          className="modal-wide modal-scroll-body"
          label="Purchase Order"
        >
          <div className="modal-body">
            <p className="muted small">
              {formatDateTimeAdmin(poView.order.created_at ?? '')} |{' '}
              <span className={`po-status-chip ${statusChip(poView.order.status)}`}>
                {statusLabel(poView.order.status)}
              </span>
              {poView.order.delivery_date ? ` | Expected: ${poView.order.delivery_date}` : ''}
            </p>
            {poView.order.reference_no && (
              <p className="muted small">Reference: {poView.order.reference_no} {poView.order.document_type === 'purchase_invoice' ? '· Purchase Invoice' : ''}</p>
            )}
            {poView.order.notes && <p className="muted small">Notes: {poView.order.notes}</p>}
            {poView.order.cancel_reason && (
              <p className="muted small">Cancelled — reason: {poView.order.cancel_reason}</p>
            )}
            {receiveNote && (
              <div className="notice" style={{ marginBottom: 8 }} data-testid="po-receive-note">
                {receiveNote}
              </div>
            )}
            <table className="tbl">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Received</th>
                  <th>Unit Cost</th>
                  <th>Line Total</th>
                  {isOpenOrder(poView.order.status) && <th style={{ width: 110 }}>Receive Now</th>}
                </tr>
              </thead>
              <tbody>
                {poView.items.map((i) => {
                  const received = Number(i.received_qty) || 0;
                  const remaining = Math.max(0, Number(i.qty) - received);
                  const money = lineMoney({
                    qty: Number(i.qty) || 0,
                    unit_cost: Number(i.unit_cost) || 0,
                    units_in_base: i.unit_multiplier,
                    discount_pct: i.discount_pct,
                    tax_pct: i.tax_pct,
                  });
                  const multiplier = Number(i.unit_multiplier) || 1;
                  return (
                    <tr key={i.id}>
                      <td>{i.product_name ?? `#${i.product_id}`}</td>
                      <td>
                        {i.qty}
                        {multiplier > 1 ? ` ${i.unit_name ?? ''} = ${money.baseQty} pcs` : ''}
                        {i.tax_pct ? ` (+${i.tax_pct}% tax)` : ''}
                      </td>
                      <td>{received}{remaining > 0 ? ` · ${remaining} left` : ''}</td>
                      <td>
                        {i.unit_cost.toFixed(2)}
                        {multiplier > 1 ? ` (${money.costPerBase.toFixed(2)} / base)` : ''}
                      </td>
                      <td>{money.total.toFixed(2)}</td>
                      {isOpenOrder(poView.order.status) && (
                        <td>
                          <input
                            className="inp"
                            style={{ width: 90 }}
                            placeholder={String(remaining)}
                            value={receiveQty[i.product_id] ?? ''}
                            disabled={remaining <= 0}
                            onChange={(e) => setReceiveQty((prev) => ({ ...prev, [i.product_id]: e.target.value }))}
                            data-testid={`po-receive-qty-${i.product_id}`}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="po-totals" style={{ marginTop: 10 }}>
              <div>
                <span>Subtotal</span>
                <strong>{(Number(poView.order.subtotal) || 0).toFixed(2)}</strong>
              </div>
              <div>
                <span>Discount</span>
                <strong>{(Number(poView.order.discount_amount) || 0).toFixed(2)}</strong>
              </div>
              <div>
                <span>Tax</span>
                <strong>{(Number(poView.order.tax_total) || 0).toFixed(2)}</strong>
              </div>
              <div>
                <span>Freight</span>
                <strong>{(Number(poView.order.freight) || 0).toFixed(2)}</strong>
              </div>
              <div className="po-total-grand">
                <span>Total</span>
                <strong data-testid="po-view-total">{poView.order.total_amount.toFixed(2)}</strong>
              </div>
              <div>
                <span>Paid</span>
                <strong data-testid="po-view-paid">{(Number(poView.order.paid_amount) || 0).toFixed(2)}</strong>
              </div>
              <div>
                <span>Payable</span>
                <strong data-testid="po-view-payable">
                  {Math.max(0, poView.order.total_amount - (Number(poView.order.paid_amount) || 0)).toFixed(2)}
                </strong>
              </div>
            </div>
            <div className="row-btns" style={{ flexWrap: 'wrap' }}>
              <button className="btn btn-sm" onClick={() => window.api.purchases.previewOrder(poView.order.id).catch((e) => setErr(String(e)))}>
                Preview / Print
              </button>
              <button className="btn btn-sm" onClick={() => printPo(poView.order.id, 'a4')}>
                Print A4
              </button>
              <button className="btn btn-sm" onClick={() => printPo(poView.order.id, 'thermal80')}>
                Print thermal
              </button>
              <button className="btn btn-sm" onClick={() => window.api.purchases.saveOrderText(poView.order.id).catch((e) => setErr(String(e)))}>
                Save as text
              </button>
            </div>
            {isOpenOrder(poView.order.status) && (
              <div className="row-btns" style={{ flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={receivePartial}>
                  Receive typed quantities
                </button>
                <button className="btn" onClick={() => receivePo(poView.order.id)}>
                  Receive all remaining
                </button>
                <button className="btn" onClick={() => askCancelPo(poView.order.id)}>
                  Cancel Order
                </button>
              </div>
            )}
            <button className="btn" onClick={() => setPoView(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}

      {importOpen && (
        <PurchaseImportWizard
          suppliers={suppliers}
          products={products}
          initialFile={importFile}
          onClose={() => { setImportOpen(false); setImportFile(null); }}
          onDone={() => { void load(); refreshUndo(); }}
        />
      )}

      {ledger && (
        <Modal
          onClose={() => setLedger(null)}
          onSubmit={pay}
          title={`Supplier — ${ledger.supplier.name}`}
          className="modal-wide"
          label="Supplier Ledger"
          shortcuts={[{ keys: 'Enter', label: 'Record payment' }]}
        >
            <div className="ledger-head">
              <span>
                Payable: <strong>{ledger.supplier.balance.toFixed(2)}</strong>
              </span>
              <span>
                Pay:
                <KeyboardInput
                  type="text"
                  decimals
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
        </Modal>
      )}

      {priceProd && (
        <Modal
          onClose={() => setPriceProd(null)}
          title={`Price History — ${priceProd.name}`}
          label="Price History"
        >
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
        </Modal>
      )}

      {tab === 'orders' && (
        <div className="card">
          <div className="card-head">
            <h2>Price History</h2>
          </div>
          <div {...priceList.getContainerProps()}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Product</th>
                <th>Cost</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.slice(0, 30).map((p, i) => (
                <tr key={p.id} {...priceList.getRowProps(i)}>
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
        </div>
      )}
    </div>
  );
}