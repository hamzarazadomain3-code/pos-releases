import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  PurchaseOrder,
  PurchaseProductRow,
  PurchaseProductUnit,
  Supplier,
} from '../../../shared/types';
import { matchProducts } from '../../../shared/productSearch';
import {
  baseQty,
  belowCost,
  computeTotals,
  costChange,
  costPerBaseUnit,
  isLowStock,
  lineMoney,
  marginPct,
  mergeDuplicateLines,
  minStockLevel,
  purchaseUnits,
  round2,
  safeNumber,
  suggestedQty,
  suggestedSalePrice,
  validatePo,
} from '../../../shared/purchaseCalc';
import { Modal } from './Modal';
import { KeyboardInput } from './KeyboardInput';
import { DateInput } from './DateInput';
import { useBarcodeScan } from '../hooks/useBarcodeScan';

export interface PoSettings {
  cost_change_warn_pct: number;
  min_margin_pct: number;
  auto_suggest_low_stock: boolean;
  default_payment_method: 'cash' | 'bank';
  update_cost_price: boolean;
}

export interface PurchaseOrderModalProps {
  suppliers: Supplier[];
  /** Called after the order was created or saved as a draft. */
  onSaved: (order: PurchaseOrder) => void;
  onClose: () => void;
}

/** One row of the order. The product data is the LIVE snapshot. */
interface PoLine {
  key: string;
  product_id: number;
  qty: string;
  unit_cost: string;
  tax_pct: string;
  /** The purchase unit of the row (the piece, the box, the carton). */
  unit_id: number | null;
  units_in_base: number;
  unit_name: string;
  batch_no: string;
  expiry_date: string;
  /** The live inventory data of the product (what the row displays). */
  product: PurchaseProductRow | null;
}

const emptyLine = (): PoLine => ({
  key: `l${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
  product_id: 0,
  qty: '',
  unit_cost: '',
  tax_pct: '',
  unit_id: null,
  units_in_base: 1,
  unit_name: '',
  batch_no: '',
  expiry_date: '',
  product: null,
});

/** The signature of a product's live data — when it changes, the row is stale. */
function rowSignature(p: PurchaseProductRow | null): string {
  if (!p) return '';
  return [
    p.stock_qty,
    p.cost_price,
    p.sale_price,
    p.wholesale_price,
    p.min_stock_level,
    p.low_stock_threshold,
    p.reorder_qty,
    p.tax_rate,
    p.last_purchase_cost,
    p.units.map((u) => `${u.id}:${u.quantity_in_base_units}`).join(','),
  ].join('|');
}

/**
 * The New Purchase Order modal.
 *
 * The rule of this screen: it READS the inventory master data live — the
 * stock, the reorder level, the costs, the tax, the units and the last
 * purchase come from the inventory tables every time the row is drawn, so
 * whatever the shop changed in Inventory shows up here without a second copy
 * to keep in sync.
 */
export default function PurchaseOrderModal({ suppliers, onSaved, onClose }: PurchaseOrderModalProps) {
  const [supplierId, setSupplierId] = useState<number | ''>('');
  const [lines, setLines] = useState<PoLine[]>([]);
  const [expectedDate, setExpectedDate] = useState('');
  const [refNo, setRefNo] = useState('');
  const [notes, setNotes] = useState('');
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount');
  const [discountValue, setDiscountValue] = useState('');
  const [freight, setFreight] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank'>('cash');
  const [settings, setSettings] = useState<PoSettings>({
    cost_change_warn_pct: 10,
    min_margin_pct: 0,
    auto_suggest_low_stock: true,
    default_payment_method: 'cash',
    update_cost_price: true,
  });

  const [search, setSearch] = useState('');
  const [stage, setStage] = useState<'idle' | 'select' | 'qty'>('idle');
  const [selIdx, setSelIdx] = useState(-1);
  const [qty, setQty] = useState('1');
  const [suggestions, setSuggestions] = useState<PurchaseProductRow[] | null>(null);
  const [stale, setStale] = useState(false);
  const [undo, setUndo] = useState<{ line: PoLine; index: number } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  /* ── the settings of the PO screen ─────────────────────────────────────── */
  useEffect(() => {
    let alive = true;
    window.api.purchases
      .poSettings()
      .then((s) => {
        if (!alive) return;
        setSettings(s);
        setPaymentMethod(s.default_payment_method);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  /* ── the product search (the live inventory list) ──────────────────────── */
  const [catalog, setCatalog] = useState<PurchaseProductRow[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    Promise.all([window.api.inventory.list(), window.api.purchases.lowStockProducts(500)])
      .then(([products, low]) => {
        if (!alive) return;
        const byId = new Map<number, PurchaseProductRow>();
        for (const p of products) {
          byId.set(p.id, {
            product_id: p.id,
            name: p.name,
            sku: p.sku ?? null,
            barcode: p.barcode ?? null,
            stock_qty: safeNumber(p.stock_qty, 0),
            min_stock_level: safeNumber((p as { min_stock_level?: number }).min_stock_level, 0),
            low_stock_threshold: safeNumber(p.low_stock_threshold, 0),
            reorder_qty: safeNumber((p as { reorder_qty?: number | null }).reorder_qty, 0),
            cost_price: safeNumber(p.cost_price, 0),
            sale_price: safeNumber(p.sale_price, 0),
            wholesale_price: p.wholesale_price ?? null,
            tax_rate: safeNumber(p.tax_rate, 0),
            is_loose: p.is_loose ?? null,
            batch_no: (p as { batch_no?: string | null }).batch_no ?? null,
            expiry_date: p.expiry_date ?? null,
            last_supplier_id: (p as { last_supplier_id?: number | null }).last_supplier_id ?? null,
            last_supplier_name: null,
            last_purchase_cost: null,
            last_purchase_at: null,
            units: [],
          });
        }
        // The low-stock list carries the extra live fields (the last purchase
        // cost, the units, the last supplier) — it is the richer source.
        for (const l of low) byId.set(l.product_id, l);
        setCatalog([...byId.values()]);
        setCatalogLoading(false);
      })
      .catch((e) => {
        setErr(String(e));
        setCatalogLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  /** The units of a product — the purchase unit of a row. */
  const unitsOfProduct = useCallback((productId: number): PurchaseProductUnit[] => {
    const row = catalog.find((c) => c.product_id === productId);
    return purchaseUnits(row?.units ?? null);
  }, [catalog]);

  const matches = useMemo(() => {
    const products = catalog.map((c) => ({
      id: c.product_id,
      sku: c.sku,
      barcode: c.barcode,
      name: c.name,
      category_id: null,
      unit_id: null,
      cost_price: c.cost_price,
      sale_price: c.sale_price,
      wholesale_price: c.wholesale_price,
      shelf_location: null,
      stock_qty: c.stock_qty,
      low_stock_threshold: c.low_stock_threshold,
      tax_rate: c.tax_rate,
      expiry_date: c.expiry_date,
      active: 1,
      is_test: 0,
    }));
    return matchProducts(products as never, search, 30).map((p) => catalog.find((c) => c.product_id === p.id)!);
  }, [catalog, search]);

  const selectedProduct = useCallback((): PurchaseProductRow | undefined => {
    if (stage === 'idle') return undefined;
    const sel = selIdx >= 0 && selIdx < matches.length ? matches[selIdx] : undefined;
    return sel ?? (matches.length > 0 ? matches[0] : undefined);
  }, [matches, selIdx, stage]);

  /* ── adding a line ─────────────────────────────────────────────────────── */

  /**
   * Add a product as a line.
   *
   * The AUTO-FILL comes from the live inventory data: the unit cost is the
   * LAST purchase cost (else the product's own `cost_price`), the quantity is
   * the product's reorder qty (else the gap to its reorder level) and the tax
   * is the product's tax. Everything stays editable.
   */
  const addLineForProduct = useCallback(
    (product: PurchaseProductRow, quantity?: number) => {
      const live = catalog.find((c) => c.product_id === product.product_id) ?? product;
      const units = purchaseUnits(live.units ?? null);
      const base = units.find((u) => u.is_base) ?? units[0];
      const pack = units.find((u) => !u.is_base) ?? base;
      const unit = pack ?? base;
      const multiplier = safeNumber(unit?.quantity_in_base_units, 1) || 1;
      const suggested = suggestedQty({
        stock_qty: live.stock_qty,
        min_stock_level: live.min_stock_level,
        low_stock_threshold: live.low_stock_threshold,
        reorder_qty: live.reorder_qty,
      });
      const qtyValue = quantity ?? (suggested > 0 ? suggested : 1);
      const baseline = live.last_purchase_cost ?? live.cost_price;
      const needsBatch = Boolean(live.batch_no) || Boolean(live.expiry_date);

      setLines((prev) => {
        const at = prev.findIndex((l) => l.product_id === live.product_id);
        if (at >= 0) {
          const n = [...prev];
          const mergedQty = safeNumber(n[at].qty, 0) + qtyValue;
          n[at] = {
            ...n[at],
            qty: String(mergedQty),
            product: live,
            unit_id: unit?.id ?? null,
            units_in_base: multiplier,
            unit_name: unit?.name ?? '',
          };
          return n;
        }
        return [
          ...prev,
          {
            ...emptyLine(),
            product_id: live.product_id,
            qty: String(qtyValue),
            unit_cost: String(round2(baseline)),
            tax_pct: String(safeNumber(live.tax_rate, 0)),
            unit_id: unit?.id ?? null,
            units_in_base: multiplier,
            unit_name: unit?.name ?? '',
            batch_no: needsBatch ? live.batch_no ?? '' : '',
            expiry_date: needsBatch ? live.expiry_date ?? '' : '',
            product: live,
          },
        ];
      });
      setUndo(null);
    },
    [catalog]
  );

  const confirmAdd = useCallback(() => {
    const p = selectedProduct();
    if (!p) return;
    addLineForProduct(p, Math.max(1, safeNumber(qty, 1)));
    setSearch('');
    setStage('idle');
    setSelIdx(-1);
    setQty('1');
    // The focus goes back to the search box: the next line is one keypress away.
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }, [addLineForProduct, qty, selectedProduct]);

  useBarcodeScan({
    enabled: true,
    onScan: (code) => {
      const found = catalog.find(
        (c) => (c.barcode ?? '').toLowerCase() === code.trim().toLowerCase() ||
          (c.sku ?? '').toLowerCase() === code.trim().toLowerCase()
      );
      if (!found) {
        setErr(`No product found for barcode "${code}"`);
        return;
      }
      addLineForProduct(found);
      setSearch('');
      setStage('idle');
      setSelIdx(-1);
    },
  });

  useEffect(() => {
    if (stage !== 'qty') return;
    const t = window.setTimeout(() => qtyRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [stage]);

  /* ── the supplier-aware lists ──────────────────────────────────────────── */

  const addSupplierProducts = useCallback(async () => {
    const sid = safeNumber(supplierId, 0);
    if (!sid) {
      setErr('Select a supplier first.');
      return;
    }
    const rows = await window.api.purchases.supplierProducts(sid);
    setSuggestions(rows);
  }, [supplierId]);

  const addLowStockProducts = useCallback(async () => {
    const rows = await window.api.purchases.lowStockProducts(200);
    setSuggestions(rows);
  }, []);

  /** The suggestion list is EXPLICIT: the user confirms every row. */
  const confirmSuggestions = useCallback(
    (rows: PurchaseProductRow[]) => {
      for (const r of rows) {
        const suggested = suggestedQty({
          stock_qty: r.stock_qty,
          min_stock_level: r.min_stock_level,
          low_stock_threshold: r.low_stock_threshold,
          reorder_qty: r.reorder_qty,
        });
        addLineForProduct(r, suggested > 0 ? suggested : 1);
      }
      setSuggestions(null);
    },
    [addLineForProduct]
  );

  /* ── the live link: the inventory may change under a draft ────────────── */

  const refreshRows = useCallback(async () => {
    const ids = lines.map((l) => l.product_id).filter((id) => id > 0);
    if (!ids.length) return;
    const rows = await Promise.all(ids.map((id) => window.api.purchases.productRow(id)));
    setLines((prev) =>
      prev.map((l) => {
        const at = rows.findIndex((r) => r?.product_id === l.product_id);
        return at >= 0 && rows[at] ? { ...l, product: rows[at] as PurchaseProductRow } : l;
      })
    );
    setStale(false);
  }, [lines]);

  useEffect(() => {
    const ids = lines.map((l) => l.product_id).filter((id) => id > 0);
    if (!ids.length) return;
    const timer = window.setInterval(async () => {
      try {
        const rows = await Promise.all(ids.map((id) => window.api.purchases.productRow(id)));
        const changed = rows.some((r) => {
          if (!r) return false;
          const line = lines.find((l) => l.product_id === r.product_id);
          return line ? rowSignature(line.product) !== rowSignature(r) : false;
        });
        if (changed) setStale(true);
      } catch {
        /* the check is a convenience, never a blocker */
      }
    }, 15000);
    return () => window.clearInterval(timer);
  }, [lines]);

  /* ── the money ─────────────────────────────────────────────────────────── */

  const totals = useMemo(
    () =>
      computeTotals({
        lines: lines.map((l) => ({
          qty: safeNumber(l.qty, 0),
          unit_cost: safeNumber(l.unit_cost, 0),
          units_in_base: l.units_in_base,
          tax_pct: safeNumber(l.tax_pct, 0),
        })),
        discount_type: discountType,
        discount_value: safeNumber(discountValue, 0),
        freight: safeNumber(freight, 0),
        paid_amount: safeNumber(paidAmount, 0),
      }),
    [lines, discountType, discountValue, freight, paidAmount]
  );

  const validation = useMemo(
    () =>
      validatePo({
        supplierId: safeNumber(supplierId, 0),
        lines: lines.map((l) => ({
          product_id: l.product_id,
          qty: safeNumber(l.qty, 0),
          unit_cost: safeNumber(l.unit_cost, 0),
        })),
        totals,
      }),
    [supplierId, lines, totals]
  );

  /* ── saving ────────────────────────────────────────────────────────────── */

  const buildPayload = useCallback(
    (status: 'draft' | 'ordered') => {
      const items = lines
        .filter((l) => l.product_id > 0 && safeNumber(l.qty, 0) > 0)
        .map((l) => ({
          product_id: l.product_id,
          qty: safeNumber(l.qty, 0),
          unit_cost: safeNumber(l.unit_cost, 0),
          units_in_base: l.units_in_base,
          unit_name: l.unit_name,
          tax_pct: safeNumber(l.tax_pct, 0),
          batch_no: l.batch_no.trim() || null,
          expiry_date: l.expiry_date.trim() || null,
        }));
      return {
        items,
        options: {
          status,
          expected_date: expectedDate.trim() || null,
          notes: notes.trim() || null,
          reference_no: refNo.trim() || null,
          discount_type: discountType,
          discount_value: safeNumber(discountValue, 0),
          freight: safeNumber(freight, 0),
          paid_amount: status === 'draft' ? 0 : safeNumber(paidAmount, 0),
          payment_method: status === 'draft' ? null : paymentMethod,
        },
      };
    },
    [lines, expectedDate, notes, refNo, discountType, discountValue, freight, paidAmount, paymentMethod]
  );

  const save = useCallback(
    async (status: 'draft' | 'ordered') => {
      setErr('');
      if (status === 'ordered') {
        // The duplicate lines are merged with a PROMPT, never silently.
        const dupes = validation.duplicateProductIds;
        if (dupes.length > 0) {
          const merged = mergeDuplicateLines(
            lines.map((l) => ({
              product_id: l.product_id,
              qty: safeNumber(l.qty, 0),
              unit_cost: safeNumber(l.unit_cost, 0),
            }))
          );
          setLines((prev) => {
            const n = [...prev];
            for (const pid of dupes) {
              const at = n.findIndex((l) => l.product_id === pid);
              if (at >= 0) n[at] = { ...n[at], qty: String(merged.lines.find((m) => m.product_id === pid)?.qty ?? 0) };
            }
            return n;
          });
          setErr('The same product was in the list twice — the quantities were merged. Check it and save again.');
          return;
        }
        if (!validation.ok) {
          setErr(validation.messages.join(' '));
          return;
        }
      } else if (!safeNumber(supplierId, 0)) {
        setErr('Select a supplier before saving a draft.');
        return;
      }
      setBusy(true);
      try {
        const { items, options } = buildPayload(status);
        if (!items.length) {
          setErr('Add at least one item with a quantity.');
          setBusy(false);
          return;
        }
        const order = await window.api.purchases.createOrder(safeNumber(supplierId, 0), items, options);
        onSaved(order);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [buildPayload, lines, onSaved, supplierId, validation]
  );

  /* ── the keyboard ──────────────────────────────────────────────────────── */

  const onModalKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Ctrl+Enter = Create, Ctrl+S = Save draft. Esc closes ONLY this modal.
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        void save('ordered');
        return;
      }
      if ((e.key === 's' || e.key === 'S') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        void save('draft');
        return;
      }
      // Del on a row removes it — with an undo.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const active = document.activeElement as HTMLElement | null;
        const row = active?.closest?.('[data-po-line]') as HTMLElement | null;
        if (row) {
          e.preventDefault();
          e.stopPropagation();
          const key = row.getAttribute('data-po-line');
          const index = lines.findIndex((l) => l.key === key);
          if (index >= 0) {
            setUndo({ line: lines[index], index });
            setLines((prev) => prev.filter((l) => l.key !== key));
          }
        }
      }
    },
    [lines, save]
  );

  const removeLine = useCallback(
    (key: string) => {
      const index = lines.findIndex((l) => l.key === key);
      if (index < 0) return;
      setUndo({ line: lines[index], index });
      setLines((prev) => prev.filter((l) => l.key !== key));
    },
    [lines]
  );

  const undoRemove = useCallback(() => {
    if (!undo) return;
    setLines((prev) => {
      const n = [...prev];
      n.splice(Math.min(undo.index, n.length), 0, undo.line);
      return n;
    });
    setUndo(null);
  }, [undo]);

  /* ── the row rendering helpers ─────────────────────────────────────────── */

  const updateLine = useCallback((key: string, patch: Partial<PoLine>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }, []);

  const setUnit = useCallback(
    (key: string, unit: PurchaseProductUnit) => {
      updateLine(key, {
        unit_id: unit.id,
        units_in_base: safeNumber(unit.quantity_in_base_units, 1) || 1,
        unit_name: unit.name,
      });
    },
    [updateLine]
  );

  const marginOf = useCallback(
    (line: PoLine): number => marginPct(line.product?.sale_price ?? 0, safeNumber(line.unit_cost, 0)),
    []
  );

  const marginWarning = useCallback(
    (line: PoLine): boolean => {
      const sale = line.product?.sale_price ?? 0;
      const cost = safeNumber(line.unit_cost, 0);
      if (!sale) return false;
      if (belowCost(sale, cost)) return true;
      const limit = settings.min_margin_pct;
      return limit > 0 && marginOf(line) < limit;
    },
    [marginOf, settings.min_margin_pct]
  );

  const costWarning = useCallback(
    (line: PoLine) => {
      const baseline = line.product?.last_purchase_cost ?? line.product?.cost_price ?? 0;
      return costChange(baseline, safeNumber(line.unit_cost, 0), settings.cost_change_warn_pct);
    },
    [settings.cost_change_warn_pct]
  );

  const applySuggestedSalePrice = useCallback(
    (line: PoLine) => {
      const p = line.product;
      if (!p) return;
      const suggestion = suggestedSalePrice(p.sale_price, p.cost_price, safeNumber(line.unit_cost, 0));
      // NEVER silent: the sale price is NOT written here. The order carries
      // the suggested price and the owner confirms it when the goods arrive.
      setErr(
        `Suggested sale price for ${p.name}: ${suggestion.toFixed(2)} (the current margin kept). It is NOT saved automatically — set it in Inventory or on the receipt.`
      );
    },
    []
  );

  /* ── the render ────────────────────────────────────────────────────────── */

  const footer = (
    <>
      <div className="po-totals-inline">
        <span>Total</span>
        <strong data-testid="po-grand-total">{totals.grandTotal.toFixed(2)}</strong>
        {totals.paid > 0 && (
          <>
            <span>Payable</span>
            <strong data-testid="po-payable">{totals.payable.toFixed(2)}</strong>
          </>
        )}
      </div>
      <button className="btn" onClick={() => void save('draft')} disabled={busy} data-testid="po-save-draft">
        Save draft
      </button>
      <button
        className="btn btn-primary"
        onClick={() => void save('ordered')}
        disabled={busy || !validation.ok}
        title={validation.ok ? '' : validation.messages.join(' ')}
        data-testid="po-create"
      >
        Create
      </button>
      <button className="btn" onClick={onClose} disabled={busy} data-testid="po-cancel">
        Cancel
      </button>
    </>
  );

  return (
    <Modal
      onClose={onClose}
      onSubmit={() => void save('ordered')}
      onKeyDown={onModalKeyDown}
      title="New Purchase Order"
      className="modal-wide modal-scroll-body modal-po"
      label="New Purchase Order"
      actions={{ save: () => void save('ordered') }}
      footer={footer}
    >
      <div className="modal-body" ref={bodyRef} data-testid="po-body">
        {err && (
          <div className="po-error" data-testid="po-error">
            {err}
          </div>
        )}
        {stale && (
          <div className="po-stale-banner" data-testid="po-stale-banner">
            <span>The inventory changed while this order was open.</span>
            <button className="btn btn-sm" onClick={() => void refreshRows()} data-testid="po-refresh">
              Refresh
            </button>
          </div>
        )}
        {undo && (
          <div className="po-undo-banner" data-testid="po-undo-banner">
            <span>Line removed.</span>
            <button className="btn btn-sm" onClick={undoRemove} data-testid="po-undo">
              Undo
            </button>
          </div>
        )}

        {/* ── the header ─────────────────────────────────────────────────── */}
        <div className="po-header-grid">
          <label className="lbl">
            Supplier *
            <select
              className="inp"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : '')}
              data-testid="po-supplier"
            >
              <option value="">— select —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="lbl">
            Expected delivery
            <DateInput value={expectedDate} onChange={setExpectedDate} data-testid="po-expected-date" />
          </label>
          <label className="lbl">
            Supplier invoice / ref no
            <input
              className="inp"
              value={refNo}
              onChange={(e) => setRefNo(e.target.value)}
              data-testid="po-ref-no"
            />
          </label>
          <label className="lbl">
            Notes
            <input className="inp" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="po-notes" />
          </label>
        </div>

        <div className="po-supplier-actions">
          <button className="btn btn-sm" onClick={() => void addSupplierProducts()} data-testid="po-add-supplier-products">
            Add this supplier's products
          </button>
          <button className="btn btn-sm" onClick={() => void addLowStockProducts()} data-testid="po-add-low-stock">
            Add low-stock items
          </button>
        </div>

        {suggestions && (
          <div className="po-suggestions" data-testid="po-suggestions">
            <div className="po-suggestions-head">
              <span>
                {suggestions.length} item{suggestions.length === 1 ? '' : 's'} — confirm the ones you want.
              </span>
              <div>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => confirmSuggestions(suggestions)}
                  data-testid="po-suggestions-confirm"
                >
                  Add all
                </button>
                <button className="btn btn-sm" onClick={() => setSuggestions(null)}>
                  Close
                </button>
              </div>
            </div>
            <div className="po-suggestions-list">
              {suggestions.map((r) => (
                <div key={r.product_id} className="po-suggestion-row">
                  <span>{r.name}</span>
                  <span className="muted small">
                    stock {r.stock_qty} / min {minStockLevel(r)} · suggested{' '}
                    {suggestedQty({
                      stock_qty: r.stock_qty,
                      min_stock_level: r.min_stock_level,
                      low_stock_threshold: r.low_stock_threshold,
                      reorder_qty: r.reorder_qty,
                    }) || 1}
                  </span>
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      addLineForProduct(r);
                      setSuggestions((prev) => (prev ? prev.filter((x) => x.product_id !== r.product_id) : prev));
                    }}
                  >
                    Add
                  </button>
                </div>
              ))}
              {suggestions.length === 0 && <div className="muted small">Nothing to suggest.</div>}
            </div>
          </div>
        )}

        {/* ── the product search ─────────────────────────────────────────── */}
        <div className="po-search-wrap">
          <label className="lbl">Search / scan product (Enter 1× select, 2× qty, 3× add)</label>
          {catalogLoading && (
            <div className="muted small" data-testid="po-catalog-loading">
              Loading the inventory…
            </div>
          )}
          {!catalogLoading && catalog.length === 0 && (
            <div className="muted small" data-testid="po-catalog-empty">
              The inventory is empty — add a product in Inventory first.
            </div>
          )}
          <input
            ref={searchRef}
            className="inp"
            placeholder="Type name, SKU or barcode, or scan…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setStage('idle');
              setSelIdx(-1);
              setQty('1');
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const count = matches.length;
                if (count === 0) return;
                e.preventDefault();
                setSelIdx((prev) => {
                  const base = prev < 0 ? 0 : prev;
                  const next = e.key === 'ArrowDown' ? (base + 1) % count : (base - 1 + count) % count;
                  const el = document.querySelector(`[data-po-index="${next}"]`);
                  (el as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
                  return next;
                });
                setStage('idle');
                return;
              }
              if (e.key === 'Enter' || e.key === '\r' || e.key === '\n') {
                e.preventDefault();
                if (matches.length === 0) return;
                if (stage === 'select') {
                  setStage('qty');
                  return;
                }
                const sel = selIdx >= 0 && selIdx < matches.length ? selIdx : 0;
                setSelIdx(sel);
                setStage('select');
                return;
              }
              if (e.key === 'Escape' || e.key === 'Esc') {
                e.preventDefault();
                e.stopPropagation();
                setSearch('');
                setStage('idle');
                setSelIdx(-1);
                setQty('1');
              }
            }}
            data-testid="po-search"
          />
          {search && matches.length > 0 && (
            <div className="search-result-dropdown po-search-results">
              {matches.map((p, i) => (
                <button
                  key={p.product_id}
                  data-po-index={i}
                  type="button"
                  className={`search-result-item${i === selIdx ? ' highlighted' : ''}`}
                  onMouseEnter={() => setSelIdx(i)}
                  onClick={() => {
                    setSelIdx(i);
                    setStage('qty');
                  }}
                >
                  <span className="psr-name">{p.name}</span>
                  <span className="psr-meta">
                    stock {p.stock_qty}
                    {p.barcode ? ` • ${p.barcode}` : p.sku ? ` • ${p.sku}` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
          {stage === 'qty' && selectedProduct() && (
            <div className="quantity-input-box">
              <span>{selectedProduct()!.name} — Qty:</span>
              <KeyboardInput
                ref={qtyRef}
                type="text"
                decimals
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === '\r' || e.key === '\n') {
                    e.preventDefault();
                    e.stopPropagation();
                    confirmAdd();
                    return;
                  }
                  if (e.key === 'Escape' || e.key === 'Esc') {
                    e.preventDefault();
                    e.stopPropagation();
                    setStage('select');
                  }
                }}
              />
              <button className="btn btn-sm btn-primary" onClick={confirmAdd}>
                Add {Math.max(1, safeNumber(qty, 1))}
              </button>
              <button className="btn btn-sm" onClick={() => setStage('select')}>
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* ── the lines ──────────────────────────────────────────────────── */}
        <div className="po-lines" data-testid="po-lines">
          {lines.length === 0 ? (
            <div className="po-empty" data-testid="po-empty">
              No items yet. Search a product above, or use “Add low-stock items”.
            </div>
          ) : (
            lines.map((l, index) => {
              const p = l.product;
              const money = lineMoney({
                qty: safeNumber(l.qty, 0),
                unit_cost: safeNumber(l.unit_cost, 0),
                units_in_base: l.units_in_base,
                tax_pct: safeNumber(l.tax_pct, 0),
              });
              const low = p ? isLowStock(p) : false;
              const min = p ? minStockLevel(p) : 0;
              const cc = costWarning(l);
              const mw = marginWarning(l);
              const units = p ? purchaseUnits(p.units ?? null) : [];
              const perBase = costPerBaseUnit(safeNumber(l.unit_cost, 0), l.units_in_base);
              const inBase = baseQty(safeNumber(l.qty, 0), l.units_in_base);
              const needsBatch = Boolean(p?.batch_no) || Boolean(p?.expiry_date);
              return (
                <div className="po-line" key={l.key} data-po-line={l.key} data-testid={`po-line-${index}`}>
                  <div className="po-line-main">
                    <div className="po-line-product">
                      <div className="po-line-name">{p?.name ?? 'Unknown product'}</div>
                      <div className="po-line-meta muted small">
                        {(p?.sku || p?.barcode || '') && <span>{p?.sku || p?.barcode}</span>}
                        {p && (
                          <span className={low ? 'po-stock-low' : ''}>
                            stock {p.stock_qty}
                            {min > 0 ? ` / min ${min}` : ''}
                            {low ? ' — LOW' : ''}
                          </span>
                        )}
                        {p?.last_purchase_cost != null && <span>last cost {p.last_purchase_cost}</span>}
                        {p && <span>cost {p.cost_price}</span>}
                        {p && <span>sale {p.sale_price}</span>}
                        {p?.last_supplier_name && (
                          <span className="po-supplier-badge">{p.last_supplier_name}</span>
                        )}
                        {p?.is_loose ? <span className="po-badge">loose</span> : null}
                      </div>
                    </div>

                    <label className="po-cell">
                      <span className="lbl-sm">Unit</span>
                      <select
                        className="inp inp-sm"
                        value={l.unit_id ?? ''}
                        onChange={(e) => {
                          const u = units.find((x) => x.id === Number(e.target.value));
                          if (u) setUnit(l.key, u);
                        }}
                        data-testid={`po-unit-${index}`}
                      >
                        {units.length === 0 && <option value="">—</option>}
                        {units.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.quantity_in_base_units})
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="po-cell">
                      <span className="lbl-sm">Qty</span>
                      <KeyboardInput
                        className="inp inp-sm"
                        type="text"
                        decimals
                        value={l.qty}
                        onChange={(e) => updateLine(l.key, { qty: e.target.value })}
                        data-testid={`po-qty-${index}`}
                      />
                    </label>

                    <label className="po-cell">
                      <span className="lbl-sm">Unit cost</span>
                      <KeyboardInput
                        className="inp inp-sm"
                        type="text"
                        decimals
                        value={l.unit_cost}
                        onChange={(e) => updateLine(l.key, { unit_cost: e.target.value })}
                        data-testid={`po-cost-${index}`}
                      />
                    </label>

                    <label className="po-cell">
                      <span className="lbl-sm">Tax %</span>
                      <KeyboardInput
                        className="inp inp-sm"
                        type="text"
                        decimals
                        value={l.tax_pct}
                        onChange={(e) => updateLine(l.key, { tax_pct: e.target.value })}
                        data-testid={`po-tax-${index}`}
                      />
                    </label>

                    <div className="po-cell po-line-total">
                      <span className="lbl-sm">Total</span>
                      <strong data-testid={`po-line-total-${index}`}>{money.total.toFixed(2)}</strong>
                    </div>

                    <button
                      className="btn btn-sm"
                      onClick={() => removeLine(l.key)}
                      title="Remove the line (Del)"
                      data-testid={`po-remove-${index}`}
                    >
                      ✕
                    </button>
                  </div>

                  <div className="po-line-sub muted small">
                    {l.units_in_base > 1 && (
                      <span data-testid={`po-conversion-${index}`}>
                        {l.qty || 0} {l.unit_name || 'unit'} = {inBase} pcs · cost {perBase.toFixed(2)} per base unit
                      </span>
                    )}
                    {p && (
                      <span className={mw ? 'po-warn' : ''} data-testid={`po-margin-${index}`}>
                        margin {marginOf(l).toFixed(1)}%
                        {mw && ' — below the limit'}
                      </span>
                    )}
                    {cc.warn && (
                      <span className="po-warn" data-testid={`po-cost-warning-${index}`}>
                        cost changed {cc.oldCost.toFixed(2)} → {cc.newCost.toFixed(2)} ({cc.pct > 0 ? '+' : ''}
                        {cc.pct}%)
                      </span>
                    )}
                    {mw && p && (
                      <button
                        className="btn btn-sm"
                        onClick={() => applySuggestedSalePrice(l)}
                        data-testid={`po-update-price-${index}`}
                      >
                        Update sale price
                      </button>
                    )}
                  </div>

                  {needsBatch && (
                    <div className="po-line-batch">
                      <label className="po-cell">
                        <span className="lbl-sm">Batch no</span>
                        <input
                          className="inp inp-sm"
                          value={l.batch_no}
                          onChange={(e) => updateLine(l.key, { batch_no: e.target.value })}
                          data-testid={`po-batch-${index}`}
                        />
                      </label>
                      <label className="po-cell">
                        <span className="lbl-sm">Expiry</span>
                        <DateInput
                          value={l.expiry_date}
                          onChange={(v) => updateLine(l.key, { expiry_date: v })}
                        />
                      </label>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* ── the money ──────────────────────────────────────────────────── */}
        <div className="po-money-grid">
          <label className="lbl">
            Discount
            <span className="po-discount-row">
              <select
                className="inp inp-sm"
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value === 'percent' ? 'percent' : 'amount')}
                data-testid="po-discount-type"
              >
                <option value="amount">Amount</option>
                <option value="percent">Percent</option>
              </select>
              <KeyboardInput
                className="inp inp-sm"
                type="text"
                decimals
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                data-testid="po-discount"
              />
            </span>
          </label>
          <label className="lbl">
            Freight / other charges
            <KeyboardInput
              className="inp"
              type="text"
              decimals
              value={freight}
              onChange={(e) => setFreight(e.target.value)}
              data-testid="po-freight"
            />
          </label>
          <label className="lbl">
            Paid now
            <KeyboardInput
              className="inp"
              type="text"
              decimals
              value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value)}
              data-testid="po-paid"
            />
          </label>
          <label className="lbl">
            Payment method
            <select
              className="inp"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value === 'bank' ? 'bank' : 'cash')}
              data-testid="po-payment-method"
            >
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
            </select>
          </label>
        </div>

        <div className="po-totals" data-testid="po-totals">
          <div>
            <span>Subtotal</span>
            <strong data-testid="po-subtotal">{totals.subtotal.toFixed(2)}</strong>
          </div>
          <div>
            <span>Discount</span>
            <strong data-testid="po-discount-total">
              {(totals.lineDiscount + totals.discount).toFixed(2)}
            </strong>
          </div>
          <div>
            <span>Tax</span>
            <strong data-testid="po-tax-total">{totals.tax.toFixed(2)}</strong>
          </div>
          <div>
            <span>Freight</span>
            <strong data-testid="po-freight-total">{totals.freight.toFixed(2)}</strong>
          </div>
          <div className="po-total-grand">
            <span>Grand total</span>
            <strong data-testid="po-total-grand">{totals.grandTotal.toFixed(2)}</strong>
          </div>
          <div>
            <span>Paid</span>
            <strong data-testid="po-paid-total">{totals.paid.toFixed(2)}</strong>
          </div>
          <div>
            <span>Payable</span>
            <strong data-testid="po-payable-total">{totals.payable.toFixed(2)}</strong>
          </div>
        </div>

        {!validation.ok && (
          <ul className="po-validation" data-testid="po-validation">
            {validation.messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
