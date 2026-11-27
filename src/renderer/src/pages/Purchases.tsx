import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  // Phase 3, item 15 — the Purchases screen is bilingual (en + ur).
  const { t } = useTranslation();
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
    if (!sName.trim()) return setErr(t('purchases.page.nameRequired'));
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
    if (!amt || amt <= 0) return setErr(t('purchases.page.enterAmount'));
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
    // Phase 3, item 16 — the "Stock received" note belongs to the order that
    // was received. It used to stay on screen, so the NEXT order the owner
    // opened showed a note about a receipt that belonged to another order.
    setReceiveNote('');
    setReceiveQty({});
    if (full) setPoView({ order: full, items: full.items });
  };

  /**
   * Phase 3, item 3 — the partial receive is keyed by the LINE, not by the
   * product.
   *
   * The old key was `product_id`, so an order with two lines of the SAME
   * product (two batches, two prices) showed ONE input for both lines and the
   * typed quantity was sent for EACH of them — the shop received twice what
   * it typed. The line id (`purchase_items.id`) addresses one row exactly.
   */
  const receivePo = async (id: number, linesToReceive?: { item_id: number; product_id: number; qty: number }[]) => {
    try {
      await window.api.purchases.receiveOrder(id, linesToReceive);
      // The receipt says what happened to the product's cost price — the shop
      // must never wonder why a cost did (or did not) change.
      try {
        const s = await window.api.purchases.poSettings();
        setReceiveNote(
          s.update_cost_price
            ? t('purchases.page.receivedCostUpdated')
            : t('purchases.page.receivedCostKept')
        );
      } catch {
        setReceiveNote(t('purchases.page.receivedPlain'));
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
    // Phase 3, item 3 — the quantity is addressed to the LINE.
    const lines = poView.items
      .map((i) => ({ item_id: i.id, product_id: i.product_id, qty: Number(receiveQty[i.id]) || 0 }))
      .filter((l) => l.qty > 0);
    if (!lines.length) return setErr(t('purchases.page.typeHowMuch'));
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
   *
   * Phase 3, item 17 — the copy does NOT carry the supplier's invoice /
   * reference number. That number belongs to ONE invoice; two orders showing
   * the same ref no made the shop's own records ambiguous (and the import
   * match on the ref no picked the wrong order).
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
        // NO reference_no — the new order has its own (the shop fills it in).
        notes: full.notes ?? null,
        discount_type: (full.discount_type as 'amount' | 'percent') ?? 'amount',
        discount_value: Number(full.discount_value) || 0,
        freight: Number(full.freight) || 0,
      });
      await load();
      setErr(t('purchases.page.duplicated', { id: String(copy.id).padStart(4, '0') }));
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
      ? t('purchases.page.statusReceived')
      : s === 'cancelled'
        ? t('purchases.page.statusCancelled')
        : s === 'draft'
          ? t('purchases.page.statusDraft')
          : s === 'partial'
            ? t('purchases.page.statusPartial')
            : t('purchases.page.statusOrdered');

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

  /**
   * An order that can still be CANCELLED.
   *
   * A partially received order cannot: its stock is already in the shop, so
   * cancelling it would hide stock that has to be adjusted separately. The
   * service refuses it too ("Only an open order can be cancelled").
   */
  const canCancelOrder = (s: string) => s === 'pending' || s === 'ordered' || s === 'draft';

  const supplierOptions = suppliers.map(s => ({ value: s.id, label: s.name }));
  const statusOptions = [
    { value: 'draft', label: t('purchases.page.statusDraft') },
    { value: 'ordered', label: t('purchases.page.statusOrdered') },
    { value: 'partial', label: t('purchases.page.statusPartial') },
    { value: 'received', label: t('purchases.page.statusReceived') },
    { value: 'cancelled', label: t('purchases.page.statusCancelled') },
  ];

  // ── the totals of the FILTERED list ──────────────────────────────────────
  //   Phase 3, item 18 — a DRAFT costs nothing and a CANCELLED order is not
  //   payable, so neither belongs in the money row. Before this the header
  //   summed every row, so a saved draft or a cancelled order inflated the
  //   "Payable" figure the owner reads.
  const moneyOrders = orders.filter((o) => o.status !== 'draft' && o.status !== 'cancelled');
  const listTotal = moneyOrders.reduce((s, o) => s + (Number(o.total_amount) || 0), 0);
  const listPaid = moneyOrders.reduce((s, o) => s + (Number(o.paid_amount) || 0), 0);
  const listPayable = moneyOrders.reduce(
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
    label: t('purchases.page.scopeLabel'),
    actions: {
      new_record: () => {
        if (tab === 'suppliers') setSupplierModal(true);
        else setPoModal(true);
      },
    },
    shortcuts: [
      {
        action: 'new_record',
        label: tab === 'suppliers' ? t('purchases.page.scopeAddSupplier') : t('purchases.page.scopeNewOrder'),
      },
      { keys: '↑ / ↓', label: t('purchases.page.scopeMoveRows') },
      { keys: 'Enter', label: t('purchases.page.scopeOpenRow') },
    ],
  });

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t('purchases.page.title')}</h1>
        <div className="tabs">
          <button className={`tab-btn ${tab === 'suppliers' ? 'active' : ''}`} onClick={() => setTab('suppliers')}>
            {t('purchases.page.tabSuppliers')}
          </button>
          <button className={`tab-btn ${tab === 'orders' ? 'active' : ''}`} onClick={() => setTab('orders')}>
            {t('purchases.page.tabOrders')}
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
            <h2>{t('purchases.page.tabSuppliers')}</h2>
            <button className="btn btn-primary" onClick={() => setSupplierModal(true)}>
              {t('purchases.page.addSupplier')}
            </button>
          </div>
          <div {...supplierList.getContainerProps()}>
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('purchases.page.name')}</th>
                <th>{t('purchases.page.phone')}</th>
                <th>{t('purchases.page.payable')}</th>
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
                      {t('purchases.page.ledgerPay')}
                    </button>
                  </td>
                </tr>
              ))}
              {!suppliers.length && (
                <tr>
                  <td colSpan={4} className="muted">
                    {t('purchases.page.noSuppliers')}
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
                labelFrom={t('purchases.page.from')}
                labelTo={t('purchases.page.to')}
              />
              <select
                className="field-select"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : '')}
                style={{ width: '180px' }}
              >
                <option value="">{t('purchases.page.allSuppliers')}</option>
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
                <option value="">{t('purchases.page.allStatus')}</option>
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
                {t('purchases.page.exportExcel')}
              </button>
              {undoInfo && (
                <button className="btn btn-sm" onClick={undoLastImport} title={`${t('purchases.page.undoImport')} #${undoInfo.id} (${undoInfo.imported_count} lines)`}>
                  {t('purchases.page.undoImport')}
                </button>
              )}
              <button className="btn btn-sm" onClick={() => { setImportFile(null); setImportOpen(true); }}>
                {t('purchases.page.importFromFile')}
              </button>
              <button className="btn btn-primary" onClick={() => setPoModal(true)}>
                {t('purchases.page.newOrder')}
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
                setErr(t('purchases.page.couldNotReadFile'));
              }
            }}
            style={
              importDragOver
                ? { border: '2px dashed var(--primary)', borderRadius: 8, padding: 6, marginBottom: 8, background: 'rgba(59,130,246,0.05)' }
                : undefined
            }
          >
            {importDragOver && <div className="muted small">{t('purchases.page.dropHint')}</div>}
          </div>
          <div className="po-totals" style={{ marginBottom: 10 }} data-testid="po-list-totals">
            <div>
              <span>{t('purchases.page.orders')}</span>
              <strong data-testid="po-list-count">{orders.length}</strong>
            </div>
            <div>
              <span>{t('purchases.page.orderValue')}</span>
              <strong data-testid="po-list-total">{listTotal.toFixed(2)}</strong>
            </div>
            <div>
              <span>{t('purchases.page.paidNow')}</span>
              <strong data-testid="po-list-paid">{listPaid.toFixed(2)}</strong>
            </div>
            <div>
              <span>{t('purchases.page.payable')}</span>
              <strong data-testid="po-list-payable">{listPayable.toFixed(2)}</strong>
            </div>
          </div>
          <div {...orderList.getContainerProps()}>
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>{t('purchases.page.tabSuppliers')}</th>
                <th>{t('purchases.page.date')}</th>
                <th>{t('purchases.page.total')}</th>
                <th>{t('purchases.page.paid')}</th>
                <th>{t('purchases.page.payable')}</th>
                <th>{t('purchases.page.status')}</th>
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
                      <button className="btn btn-sm" onClick={() => openPo(o.id)} data-testid={`po-view-${o.id}`}>
                        {t('purchases.page.view')}
                      </button>
                      {isOpenOrder(o.status) && (
                        <button className="btn btn-sm btn-primary" onClick={() => receivePo(o.id)} data-testid={`po-receive-${o.id}`}>
                          {t('purchases.page.receive')}
                        </button>
                      )}
                      {canCancelOrder(o.status) && (
                        <button className="btn btn-sm" onClick={() => askCancelPo(o.id)}>
                          {t('purchases.page.cancel')}
                        </button>
                      )}
                      <button className="btn btn-sm" onClick={() => printPo(o.id, 'a4')}>
                        {t('purchases.page.print')}
                      </button>
                      <button className="btn btn-sm" onClick={() => printPo(o.id, 'thermal80')}>
                        {t('purchases.page.thermal')}
                      </button>
                      <button className="btn btn-sm" onClick={() => duplicatePo(o.id)}>
                        {t('purchases.page.duplicate')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!orders.length && (
                <tr>
                  <td colSpan={8} className="muted">
                    {t('purchases.page.noOrders')}
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
          title={t('purchases.page.cancelTitle')}
          className="modal-sm"
          label={t('purchases.page.cancelLabel')}
          shortcuts={[{ action: 'save', label: t('purchases.page.cancelShortcut') }]}
        >
          <div className="notice warn" style={{ marginBottom: 10 }}>
            {t('purchases.page.cancelNotice')}
          </div>
          <label className="lbl">{t('purchases.page.reason')}</label>
          <input
            className="inp"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder={t('purchases.page.reasonPlaceholder')}
            data-testid="po-cancel-reason"
          />
          <div className="row-btns">
            <button
              className="btn btn-primary"
              onClick={() => void cancelPo(cancelTarget, cancelReason)}
              data-testid="po-cancel-confirm"
            >
              {t('purchases.page.cancelTheOrder')}
            </button>
            <button className="btn" onClick={() => setCancelTarget(null)}>
              {t('purchases.page.keepIt')}
            </button>
          </div>
        </Modal>
      )}

      {supplierModal && (
        <Modal
          onClose={() => setSupplierModal(false)}
          onSubmit={addSupplier}
          title={t('purchases.page.addSupplier')}
          className="modal-sm"
          label={t('purchases.page.addSupplier')}
          shortcuts={[{ action: 'save', label: t('purchases.page.saveSupplier') }]}
        >
            <label className="lbl">{t('purchases.page.name')} *</label>
            <input className="inp" value={sName} onChange={(e) => setSName(e.target.value)} />
            <label className="lbl">{t('purchases.page.phone')}</label>
            <input className="inp" value={sPhone} onChange={(e) => setSPhone(e.target.value)} />
            <label className="lbl">{t('purchases.page.address')}</label>
            <input className="inp" value={sAddress} onChange={(e) => setSAddress(e.target.value)} />
            <div className="row-btns">
              <button className="btn btn-primary" onClick={addSupplier}>
                {t('purchases.page.save')}
              </button>
              <button className="btn" onClick={() => setSupplierModal(false)}>
                {t('purchases.page.cancel')}
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
          label={t('purchases.page.poLabel')}
        >
          <div className="modal-body">
            <p className="muted small">
              {formatDateTimeAdmin(poView.order.created_at ?? '')} |{' '}
              <span className={`po-status-chip ${statusChip(poView.order.status)}`}>
                {statusLabel(poView.order.status)}
              </span>
              {poView.order.delivery_date ? ` | ${t('purchases.page.expected', { date: poView.order.delivery_date })}` : ''}
            </p>
            {poView.order.reference_no && (
              <p className="muted small">
                {t('purchases.page.reference', { ref: poView.order.reference_no })}{' '}
                {poView.order.document_type === 'purchase_invoice' ? t('purchases.page.purchaseInvoice') : ''}
              </p>
            )}
            {poView.order.notes && (
              <p className="muted small">{t('purchases.page.notesPrefix', { notes: poView.order.notes })}</p>
            )}
            {poView.order.cancel_reason && (
              <p className="muted small">{t('purchases.page.cancelledReason', { reason: poView.order.cancel_reason })}</p>
            )}
            {receiveNote && (
              <div className="notice" style={{ marginBottom: 8 }} data-testid="po-receive-note">
                {receiveNote}
              </div>
            )}
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('purchases.page.product')}</th>
                  <th>{t('purchases.page.qty')}</th>
                  <th>{t('purchases.page.received')}</th>
                  <th>{t('purchases.page.unitCost')}</th>
                  <th>{t('purchases.page.lineTotal')}</th>
                  {isOpenOrder(poView.order.status) && (
                    <th style={{ width: 110 }}>{t('purchases.page.receiveNow')}</th>
                  )}
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
                        {multiplier > 1 ? ` ${i.unit_name ?? ''} = ${t('purchases.page.pcs', { qty: money.baseQty })}` : ''}
                        {i.tax_pct ? ` ${t('purchases.page.taxSuffix', { tax: i.tax_pct })}` : ''}
                      </td>
                      <td>
                        {received}
                        {remaining > 0 ? ` ${t('purchases.page.left', { qty: remaining })}` : ''}
                      </td>
                      <td>
                        {i.unit_cost.toFixed(2)}
                        {multiplier > 1 ? ` ${t('purchases.page.perBase', { cost: money.costPerBase.toFixed(2) })}` : ''}
                      </td>
                      <td>{money.total.toFixed(2)}</td>
                      {isOpenOrder(poView.order.status) && (
                        <td>
                          <input
                            className="inp"
                            style={{ width: 90 }}
                            placeholder={String(remaining)}
                            value={receiveQty[i.id] ?? ''}
                            disabled={remaining <= 0}
                            onChange={(e) => setReceiveQty((prev) => ({ ...prev, [i.id]: e.target.value }))}
                            data-testid={`po-receive-qty-${i.id}`}
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
                <span>{t('purchases.page.subtotal')}</span>
                <strong>{(Number(poView.order.subtotal) || 0).toFixed(2)}</strong>
              </div>
              <div>
                <span>{t('purchases.page.discount')}</span>
                <strong>{(Number(poView.order.discount_amount) || 0).toFixed(2)}</strong>
              </div>
              <div>
                <span>{t('purchases.page.tax')}</span>
                <strong>{(Number(poView.order.tax_total) || 0).toFixed(2)}</strong>
              </div>
              <div>
                <span>{t('purchases.page.freight')}</span>
                <strong>{(Number(poView.order.freight) || 0).toFixed(2)}</strong>
              </div>
              <div className="po-total-grand">
                <span>{t('purchases.page.total')}</span>
                <strong data-testid="po-view-total">{poView.order.total_amount.toFixed(2)}</strong>
              </div>
              <div>
                <span>{t('purchases.page.paid')}</span>
                <strong data-testid="po-view-paid">{(Number(poView.order.paid_amount) || 0).toFixed(2)}</strong>
              </div>
              <div>
                <span>{t('purchases.page.payable')}</span>
                <strong data-testid="po-view-payable">
                  {Math.max(0, poView.order.total_amount - (Number(poView.order.paid_amount) || 0)).toFixed(2)}
                </strong>
              </div>
            </div>
            <div className="row-btns" style={{ flexWrap: 'wrap' }}>
              <button className="btn btn-sm" onClick={() => window.api.purchases.previewOrder(poView.order.id).catch((e) => setErr(String(e)))}>
                {t('purchases.page.previewPrint')}
              </button>
              <button className="btn btn-sm" onClick={() => printPo(poView.order.id, 'a4')}>
                {t('purchases.page.printA4')}
              </button>
              <button className="btn btn-sm" onClick={() => printPo(poView.order.id, 'thermal80')}>
                {t('purchases.page.printThermal')}
              </button>
              <button className="btn btn-sm" onClick={() => window.api.purchases.saveOrderText(poView.order.id).catch((e) => setErr(String(e)))}>
                {t('purchases.page.saveAsText')}
              </button>
            </div>
            {isOpenOrder(poView.order.status) && (
              <div className="row-btns" style={{ flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={receivePartial}>
                  {t('purchases.page.receiveTyped')}
                </button>
                <button className="btn" onClick={() => receivePo(poView.order.id)}>
                  {t('purchases.page.receiveAll')}
                </button>
              </div>
            )}
            {canCancelOrder(poView.order.status) && (
              <div className="row-btns" style={{ flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => askCancelPo(poView.order.id)}>
                  {t('purchases.page.cancelOrder')}
                </button>
              </div>
            )}
            <button className="btn" onClick={() => setPoView(null)}>
              {t('purchases.page.close')}
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
          label={t('purchases.page.supplierLedger')}
          shortcuts={[{ keys: 'Enter', label: t('purchases.page.recordPayment') }]}
        >
            <div className="ledger-head">
              <span>
                {t('purchases.page.payable')}: <strong>{ledger.supplier.balance.toFixed(2)}</strong>
              </span>
              <span>
                {t('purchases.page.pay')}:
                <KeyboardInput
                  type="text"
                  decimals
                  className="limit-input"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
                <select className="limit-input" value={payMode} onChange={(e) => setPayMode(e.target.value)}>
                  <option value="cash">{t('purchases.page.cash')}</option>
                  <option value="bank">{t('purchases.page.bank')}</option>
                  <option value="jazzcash">{t('purchases.page.jazzcash')}</option>
                  <option value="easypaisa">{t('purchases.page.easypaisa')}</option>
                </select>
                <button className="btn btn-sm btn-primary" onClick={pay}>
                  {t('purchases.page.pay')}
                </button>
              </span>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('purchases.page.date')}</th>
                  <th>{t('purchases.page.type')}</th>
                  <th>{t('purchases.page.amount')}</th>
                  <th>{t('purchases.page.balance')}</th>
                </tr>
              </thead>
              <tbody>
                {ledger.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDateTimeAdmin(r.created_at ?? '')}</td>
                    <td>
                      {r.type.startsWith('payment')
                        ? t('purchases.page.payment')
                        : r.type === 'purchase'
                          ? t('purchases.page.purchaseTx', { id: String(r.purchase_order_id ?? 0).padStart(4, '0') })
                          : t('purchases.page.cancelledTx')}
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
                      {t('purchases.page.noTransactions')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <button className="btn" onClick={() => setLedger(null)}>
              {t('purchases.page.close')}
            </button>
        </Modal>
      )}

      {priceProd && (
        <Modal
          onClose={() => setPriceProd(null)}
          title={`${t('purchases.page.priceHistory')} — ${priceProd.name}`}
          label={t('purchases.page.priceHistory')}
        >
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('purchases.page.date')}</th>
                  <th>{t('purchases.page.cost')}</th>
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
                      {t('purchases.page.noHistory')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <button className="btn" onClick={() => setPriceProd(null)}>
              {t('purchases.page.close')}
            </button>
        </Modal>
      )}

      {tab === 'orders' && (
        <div className="card">
          <div className="card-head">
            <h2>{t('purchases.page.priceHistory')}</h2>
          </div>
          <div {...priceList.getContainerProps()}>
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('purchases.page.product')}</th>
                <th>{t('purchases.page.cost')}</th>
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
                      {t('purchases.page.history')}
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