import { useCallback, useEffect, useRef, useState } from 'react';
import bwipjs from 'bwip-js';
import type { Category, ExpiringRow, Product, ProductImportResult, ProductInput, StockMovement, Unit } from '../../../shared/types';
import { DateRangePicker, SearchInput, MultiSelectDropdown, FilterBar, FilterRow } from '../components/filters';

interface ProductBatch {
  id: number;
  product_id: number;
  batch_number: string;
  quantity: number;
  cost_price: number;
  expiry_date: string | null;
  received_date: string;
  created_at: string;
}

interface ProductUnit {
  id?: number;
  level: 0 | 1 | 2;
  name: string;
  quantity_in_base_units: number;
  barcode: string;
  price: string;
  is_base: boolean;
}

interface FormState {
  name: string;
  sku: string;
  barcode: string;
  category_id: string;
  unit_id: string;
  cost_price: string;
  sale_price: string;
  wholesale_price: string;
  shelf_location: string;
  stock_qty: string;
  low_stock_threshold: string;
  tax_rate: string;
  expiry_date: string;
  units: ProductUnit[];
}

const EMPTY_FORM: FormState = {
  name: '',
  sku: '',
  barcode: '',
  category_id: '',
  unit_id: '',
  cost_price: '',
  sale_price: '',
  wholesale_price: '',
  shelf_location: '',
  stock_qty: '',
  low_stock_threshold: '',
  tax_rate: '',
  expiry_date: '',
  units: [
    { level: 0, name: 'Piece', quantity_in_base_units: 1, barcode: '', price: '', is_base: true },
  ],
};

function BarcodeCanvas({ text }: { text: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setVisible(true);
        });
      },
      { rootMargin: '100px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!ref.current || !text || !visible) return;
    try {
      bwipjs.toCanvas(ref.current, { bcid: 'ean13', text, scale: 1, height: 8, includetext: true, textxalign: 'center' });
    } catch {
      /* ignore: invalid or unsupported barcode text */
    }
  }, [text, visible]);

  return <canvas ref={ref} className="barcode-canvas" />;
}

export default function Inventory() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: number; name: string }[]>([]);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [stockStatus, setStockStatus] = useState<'in_stock' | 'low_stock' | 'out_of_stock' | ''>('');
  const [supplierId, setSupplierId] = useState<number | ''>('');
  const [expiryFrom, setExpiryFrom] = useState('');
  const [expiryTo, setExpiryTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [newCategory, setNewCategory] = useState('');

  const [stockModal, setStockModal] = useState<{ product: Product } | null>(null);
  const [stockQty, setStockQty] = useState('');
  const [stockReason, setStockReason] = useState('Stock in');

  const [movements, setMovements] = useState<{ product: Product; rows: StockMovement[] } | null>(null);
  const [batches, setBatches] = useState<{ product: Product; rows: ProductBatch[] } | null>(null);
  const [stockReceived, setStockReceived] = useState<{ product: Product; batch: ProductBatch }[] | null>(null);

  const [importResult, setImportResult] = useState<ProductImportResult | null>(null);

  const [expirySort, setExpirySort] = useState<'none' | 'expiry_asc' | 'expiry_desc'>('none');
  const [expiryDays, setExpiryDays] = useState(30);
  const [expiring, setExpiring] = useState<ExpiringRow[]>([]);

  const daysUntil = (d: string | null): number | null => {
    if (!d) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((new Date(d + 'T00:00:00').getTime() - today.getTime()) / 86400000);
  };

  const expiryClass = (d: string | null) => {
    const n = daysUntil(d);
    if (n === null) return '';
    return n < 0 ? 'row-expired' : n <= 7 ? 'row-expiring' : '';
  };

  const load = useCallback(async () => {
    const [prod, cats, unis, low, sups] = await Promise.all([
      window.api.inventory.list(
        search || undefined,
        false,
        categoryId || undefined,
        stockStatus || undefined,
        supplierId || undefined,
        expiryFrom || undefined,
        expiryTo || undefined
      ),
      window.api.inventory.categories(),
      window.api.inventory.units(),
      window.api.inventory.lowStock(),
      window.api.purchases.suppliers(),
    ]);
    setProducts(prod);
    setCategories(cats);
    setUnits(unis);
    setLowStockCount(low.length);
    setSuppliers(sups.map(s => ({ id: s.id, name: s.name })));
  }, [search, categoryId, stockStatus, supplierId, expiryFrom, expiryTo]);

  useEffect(() => {
    window.api.settings
      .getAll()
      .then((m) => {
        const n = Number(m.expiry_warning_days);
        if (Number.isFinite(n) && n > 0) setExpiryDays(Math.floor(n));
      })
      .catch(() => undefined);
    window.api.reports
      .expiringSoon()
      .then(setExpiring)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load().catch((e) => setNotice(e.message));
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  async function openEdit(p: Product) {
    setEditing(p);
    // Load product units
    const productUnits = await window.api.inventory.getUnits(p.id);
    const units: ProductUnit[] = productUnits.map(u => ({
      id: u.id,
      level: u.level,
      name: u.name,
      quantity_in_base_units: u.quantity_in_base_units,
      barcode: u.barcode ?? '',
      price: u.price != null ? String(u.price) : '',
      is_base: !!u.is_base,
    }));
    setForm({
      name: p.name,
      sku: p.sku ?? '',
      barcode: p.barcode ?? '',
      category_id: p.category_id != null ? String(p.category_id) : '',
      unit_id: p.unit_id != null ? String(p.unit_id) : '',
      cost_price: p.cost_price != null ? String(p.cost_price) : '',
      sale_price: p.sale_price != null ? String(p.sale_price) : '',
      wholesale_price: p.wholesale_price != null ? String(p.wholesale_price) : '',
      shelf_location: p.shelf_location ?? '',
      stock_qty: '',
      low_stock_threshold: p.low_stock_threshold != null ? String(p.low_stock_threshold) : '',
      tax_rate: p.tax_rate != null ? String(p.tax_rate) : '',
      expiry_date: p.expiry_date ?? '',
      units,
    });
    setFormOpen(true);
  }

  function updateUnit(index: number, patch: Partial<ProductUnit>) {
    setForm((f) => ({
      ...f,
      units: f.units.map((u, i) => (i === index ? { ...u, ...patch } : u)),
    }));
  }

  function addPackagingLevel() {
    setForm((f) => {
      const nextLevel = (Math.max(0, ...f.units.map((u) => u.level)) + 1) as 0 | 1 | 2;
      return {
        ...f,
        units: [
          ...f.units,
          { level: nextLevel, name: '', quantity_in_base_units: 2, barcode: '', price: '', is_base: false },
        ],
      };
    });
  }

  function removeUnit(index: number) {
    setForm((f) => ({ ...f, units: f.units.filter((_, i) => i !== index) }));
  }

  async function handleSave() {
    setBusy(true);
    try {
      for (const u of form.units) {
        if (!u.name.trim()) {
          setNotice('Each selling unit needs a name.');
          setBusy(false);
          return;
        }
        if (!u.is_base && (!u.quantity_in_base_units || u.quantity_in_base_units <= 0)) {
          setNotice(`Packaging level "${u.name}" must contain a positive quantity of base units.`);
          setBusy(false);
          return;
        }
      }

      const unitsPayload = form.units.map((u, i) => ({
        level: i as 0 | 1 | 2,
        name: u.name.trim(),
        quantity_in_base_units: u.is_base ? 1 : u.quantity_in_base_units,
        barcode: u.barcode.trim() || null,
        price: u.price ? Number(u.price) : null,
        is_base: u.is_base,
      }));
      if (!unitsPayload.some((u) => u.is_base)) {
        const baseName = units.find((u) => u.id === Number(form.unit_id))?.name || 'Piece';
        unitsPayload.unshift({ level: 0, name: baseName, quantity_in_base_units: 1, barcode: null, price: null, is_base: true });
      }

      const input: ProductInput = {
        name: form.name,
        sku: form.sku || null,
        barcode: form.barcode || null,
        category_id: form.category_id ? Number(form.category_id) : null,
        unit_id: form.unit_id ? Number(form.unit_id) : null,
        cost_price: form.cost_price ? Number(form.cost_price) : 0,
        sale_price: form.sale_price ? Number(form.sale_price) : 0,
        wholesale_price: form.wholesale_price ? Number(form.wholesale_price) : null,
        shelf_location: form.shelf_location.trim() || null,
        low_stock_threshold: form.low_stock_threshold ? Number(form.low_stock_threshold) : 0,
        tax_rate: form.tax_rate ? Number(form.tax_rate) : 0,
        expiry_date: form.expiry_date || null,
        units: unitsPayload,
      };
      if (editing) {
        await window.api.inventory.update(editing.id, input);
      } else {
        input.stock_qty = form.stock_qty ? Number(form.stock_qty) : 0;
        await window.api.inventory.create(input);
      }
      setFormOpen(false);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(p: Product) {
    if (!window.confirm(`Delete product "${p.name}"? This also removes its stock history.`)) return;
    try {
      await window.api.inventory.remove(p.id);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleAddCategory() {
    const name = newCategory.trim();
    if (!name) return;
    try {
      const cat = await window.api.inventory.createCategory(name);
      setCategories(await window.api.inventory.categories());
      setForm({ ...form, category_id: String(cat.id) });
      setNewCategory('');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleStock() {
    if (!stockModal) return;
    const qty = Number(stockQty);
    if (!qty || Number.isNaN(qty)) return;
    try {
      await window.api.inventory.adjustStock(stockModal.product.id, qty, stockReason.trim() || 'Stock adjustment');
      setStockModal(null);
      setStockQty('');
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function openMovements(p: Product) {
    try {
      const rows = await window.api.inventory.movements(p.id);
      setMovements({ product: p, rows });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function openBatches(p: Product) {
    try {
      const rows = await window.api.inventory.getBatches(p.id);
      setBatches({ product: p, rows });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function openStockReceived() {
    try {
      const allProducts = await window.api.inventory.list(undefined, true);
      const received: { product: Product; batch: ProductBatch }[] = [];
      for (const p of allProducts) {
        const batches = await window.api.inventory.getBatches(p.id);
        for (const b of batches) {
          received.push({ product: p, batch: b });
        }
      }
      received.sort((a, b) => {
        const dateA = a.batch.received_date || '';
        const dateB = b.batch.received_date || '';
        return dateB.localeCompare(dateA); // Most recent first
      });
      setStockReceived(received);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleImport() {
    try {
      const res = await window.api.excel.importProducts();
      if (res) setImportResult(res);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleExport() {
    try {
      const ok = await window.api.excel.exportProducts({
        search: search || undefined,
        includeInactive: false,
        categoryId: categoryId || undefined,
        stockStatus: stockStatus || undefined,
        supplierId: supplierId || undefined,
        expiryFrom: expiryFrom || undefined,
        expiryTo: expiryTo || undefined,
      });
      if (ok) setNotice('Inventory exported to Excel.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleTemplate() {
    try {
      await window.api.excel.downloadTemplate();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  }

  const low = (p: Product) => p.low_stock_threshold > 0 && p.stock_qty <= p.low_stock_threshold;

  const shown = (() => {
    let list = products;
    if (expirySort === 'expiry_asc') {
      list = [...list].sort(
        (a, b) => (daysUntil(a.expiry_date) ?? Infinity) - (daysUntil(b.expiry_date) ?? Infinity)
      );
    }
    if (expirySort === 'expiry_desc') {
      list = [...list].sort(
        (a, b) => (daysUntil(b.expiry_date) ?? -Infinity) - (daysUntil(a.expiry_date) ?? -Infinity)
      );
    }
    return list;
  })();

  const categoryOptions = categories.map(c => ({ value: c.id, label: c.name }));
  const stockStatusOptions = [
    { value: 'in_stock', label: 'In Stock' },
    { value: 'low_stock', label: 'Low Stock' },
    { value: 'out_of_stock', label: 'Out of Stock' },
  ];
  const supplierOptions = suppliers.map(s => ({ value: s.id, label: s.name }));

  const handleClearFilters = () => {
    setSearch('');
    setCategoryId('');
    setStockStatus('');
    setSupplierId('');
    setExpiryFrom('');
    setExpiryTo('');
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Inventory</h1>
        <FilterBar
          onClear={handleClearFilters}
          onApply={load}
        >
          <FilterRow>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search name, SKU, barcode..."
              debounceMs={300}
            />
            <select
              className="field-select"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : '')}
              style={{ width: '160px' }}
            >
              <option value="">All Categories</option>
              {categoryOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <select
              className="field-select"
              value={stockStatus}
              onChange={(e) => setStockStatus(e.target.value as any)}
              style={{ width: '140px' }}
            >
              <option value="">All Stock Status</option>
              {stockStatusOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
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
          </FilterRow>
          <FilterRow>
            <DateRangePicker
              from={expiryFrom}
              to={expiryTo}
              onChange={(from: string, to: string) => { setExpiryFrom(from); setExpiryTo(to); }}
              labelFrom="Expiry From"
              labelTo="Expiry To"
            />
            <select
              className="field-select"
              value={expirySort}
              onChange={(e) => setExpirySort(e.target.value as 'none' | 'expiry_asc' | 'expiry_desc')}
              style={{ width: '160px' }}
            >
              <option value="none">Sort: default</option>
              <option value="expiry_asc">Sort: expiry nearest</option>
              <option value="expiry_desc">Sort: expiry farthest</option>
            </select>
          </FilterRow>
          <FilterRow style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-sm" onClick={handleTemplate}>
              Template
            </button>
            <button className="btn btn-sm" onClick={handleImport}>
              Import Excel
            </button>
            <button className="btn btn-sm" onClick={handleExport}>
              Export Excel
            </button>
            <button className="btn btn-sm" onClick={openStockReceived}>
              Stock Received
            </button>
            <button className="btn btn-primary" onClick={openCreate}>
              + Add Product
            </button>
          </FilterRow>
        </FilterBar>
      </div>

      {notice && (
        <div className="notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}

      {expiring.length > 0 && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="panel-title">Expiring Soon (within {expiryDays} days)</div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th className="num">Stock</th>
                  <th>Expiry Date</th>
                  <th className="num">Days Left</th>
                </tr>
              </thead>
              <tbody>
                {expiring.map((e) => (
                  <tr key={e.id} className={e.days_left < 0 ? 'row-expired' : e.days_left <= 7 ? 'row-expiring' : ''}>
                    <td>{e.name}</td>
                    <td>{e.category_name ?? '—'}</td>
                    <td className="num">{e.stock_qty}</td>
                    <td>{e.expiry_date}</td>
                    <td className={`num ${e.days_left < 0 ? 'text-warn' : e.days_left <= 7 ? 'text-warn' : ''}`}>
                      {e.days_left < 0 ? `expired ${Math.abs(e.days_left)}d ago` : `${e.days_left}d`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Barcode</th>
              <th>Category</th>
              <th>Unit</th>
              <th>Cost</th>
              <th>Sale</th>
              <th>Whole</th>
              <th>Shelf</th>
              <th className="num">Stock</th>
              <th>Expiry</th>
              <th>Batches</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const dn = daysUntil(p.expiry_date);
              return (
                <tr key={p.id} className={expiryClass(p.expiry_date) || (low(p) ? 'row-low' : '')}>
                  <td>
                    <strong>{p.name}</strong>
                    <div className="muted small">{p.sku}</div>
                  </td>
                  <td>
                    {p.barcode ? (
                      <div className="barcode-cell">
                        <BarcodeCanvas text={p.barcode} />
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{p.category_name ?? '—'}</td>
                  <td>{p.unit_symbol ?? '—'}</td>
                  <td>{p.cost_price.toLocaleString()}</td>
                  <td>{p.sale_price.toLocaleString()}</td>
                  <td>{p.wholesale_price != null ? p.wholesale_price.toLocaleString() : '—'}</td>
                  <td>{p.shelf_location ?? '—'}</td>
                  <td className={`num ${low(p) ? 'text-warn' : ''}`}>
                    {p.stock_qty} {p.low_stock_threshold > 0 && low(p) ? '(low)' : ''}
                  </td>
                  <td>
                    {p.expiry_date ? (
                      dn !== null && dn < 0 ? (
                        <span className="text-warn">{p.expiry_date} (expired)</span>
                      ) : dn !== null && dn <= 7 ? (
                        <span className="text-warn">{p.expiry_date} ({dn}d)</span>
                      ) : (
                        <span>{p.expiry_date} ({dn}d)</span>
                      )
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-sm" onClick={() => openEdit(p)}>
                        Edit
                      </button>
                      <button className="btn btn-sm" onClick={() => setStockModal({ product: p })}>
                        Stock
                      </button>
                      <button className="btn btn-sm" onClick={() => openMovements(p)}>
                        History
                      </button>
                      <button className="btn btn-sm" onClick={() => openBatches(p)}>
                        Batches
                      </button>
                      <button className="btn btn-sm" onClick={() => window.api.printing.printLabel(p.id, 1)} title="Sticker with name, price and barcode">
                        Label
                      </button>
                      <button className="btn btn-sm" onClick={() => window.api.printing.printBarcodeLabel(p.id, 1)} title="Barcode-only sticker (no name/price)">
                        Barcode
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(p)}>
                        Del
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={11} className="muted center">
                  No products found{search ? ` for "${search}"` : ''}. Click "Add Product" to start.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>{editing ? 'Edit Product' : 'Add Product'}</h2>
            <div className="form-grid">
              <label className="field span-2">
                <span>Name *</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Dalda Ghee 1kg"
                />
              </label>
              <label className="field">
                <span>SKU</span>
                <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="auto" />
              </label>
              <label className="field">
                <span>Barcode</span>
                <div className="inline-row">
                  <input
                    value={form.barcode}
                    onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                    placeholder="auto-generate"
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={async () => {
                      const bc = await window.api.inventory.generateBarcode();
                      setForm({ ...form, barcode: bc });
                    }}
                  >
                    Generate
                  </button>
                </div>
              </label>
              <label className="field">
                <span>Category</span>
                <select
                  value={form.category_id}
                  onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                >
                  <option value="">— none —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Unit</span>
                <select
                  value={form.unit_id}
                  onChange={(e) => {
                    const unitId = e.target.value;
                    const isKg =
                      units.find((u) => u.id === Number(unitId))?.name.toLowerCase() === 'kilogram';
                    setForm((f) => {
                      const hasGram = f.units.some((u) => u.name.trim().toLowerCase() === 'gram');
                      if (isKg && !hasGram) {
                        const nextLevel = (Math.max(0, ...f.units.map((u) => u.level)) + 1) as 0 | 1 | 2;
                        return {
                          ...f,
                          unit_id: unitId,
                          units: [
                            ...f.units,
                            { level: nextLevel, name: 'Gram', quantity_in_base_units: 0.001, barcode: '', price: '', is_base: false },
                          ],
                        };
                      }
                      return { ...f, unit_id: unitId };
                    });
                  }}
                >
                  <option value="">— none —</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.symbol})
                    </option>
                  ))}
                </select>
              </label>
              {!form.category_id && (
                <div className="field span-2">
                  <div className="inline-row">
                    <input
                      placeholder="New category name"
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                    />
                    <button type="button" className="btn btn-sm" onClick={handleAddCategory}>
                      Add
                    </button>
                  </div>
                </div>
              )}
              <label className="field">
                <span>Cost Price</span>
                <input
                  type="number"
                  value={form.cost_price}
                  onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Sale Price *</span>
                <input
                  type="number"
                  value={form.sale_price}
                  onChange={(e) => setForm({ ...form, sale_price: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Wholesale Price</span>
                <input
                  type="number"
                  value={form.wholesale_price}
                  onChange={(e) => setForm({ ...form, wholesale_price: e.target.value })}
                  placeholder="optional"
                />
                <span className="muted small">Used when billing in Wholesale mode. Blank = retail price.</span>
              </label>
              <label className="field">
                <span>Shelf / Rack Location</span>
                <input
                  value={form.shelf_location}
                  onChange={(e) => setForm({ ...form, shelf_location: e.target.value })}
                  placeholder="e.g. Aisle 2, Rack 3"
                />
              </label>
              {!editing && (
                <label className="field">
                  <span>Initial Stock</span>
                  <input
                    type="number"
                    value={form.stock_qty}
                    onChange={(e) => setForm({ ...form, stock_qty: e.target.value })}
                  />
                </label>
              )}
              <label className="field">
                <span>Low Stock Alert</span>
                <input
                  type="number"
                  value={form.low_stock_threshold}
                  onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Tax %</span>
                <input
                  type="number"
                  value={form.tax_rate}
                  onChange={(e) => setForm({ ...form, tax_rate: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Expiry Date</span>
                <input
                  type="date"
                  value={form.expiry_date}
                  onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
                />
              </label>
              <div className="field span-2">
                <span>Selling Units</span>
                <div className="units-config">
                  {form.units.map((u, i) => (
                    <div key={i} className="unit-row">
                      {u.is_base ? (
                        <>
                          <input
                            className="unit-name"
                            value={u.name}
                            onChange={(e) => updateUnit(i, { name: e.target.value })}
                            placeholder="Base unit name"
                          />
                          <span className="unit-qty-fixed muted">1 × base</span>
                          <span className="badge badge-primary">Base</span>
                        </>
                      ) : (
                        <>
                          <input
                            className="unit-name"
                            value={u.name}
                            onChange={(e) => updateUnit(i, { name: e.target.value })}
                            placeholder="e.g. Box"
                          />
                          <input
                            className="unit-qty"
                            type="number"
                            min={2}
                            value={u.quantity_in_base_units}
                            onChange={(e) => updateUnit(i, { quantity_in_base_units: Number(e.target.value) })}
                            title="Base units in this packaging level"
                          />
                          <input
                            className="unit-barcode"
                            value={u.barcode}
                            onChange={(e) => updateUnit(i, { barcode: e.target.value })}
                            placeholder="barcode (optional)"
                          />
                          <input
                            className="unit-price"
                            type="number"
                            value={u.price}
                            onChange={(e) => updateUnit(i, { price: e.target.value })}
                            placeholder="price (optional)"
                          />
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={() => removeUnit(i)}
                            title="Remove level"
                          >
                            ×
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                  <button type="button" className="btn btn-sm" onClick={addPackagingLevel}>
                    + Add Packaging Level
                  </button>
                </div>
                <span className="muted small">
                  Base unit (qty 1) cannot be removed. Packaging levels convert to base units when sold.
                  Products with a Kilogram base unit automatically get a <strong>Gram</strong> selling
                  option — the cashier can then type e.g. 250 and the system calculates the price from
                  the Kilogram rate.
                </span>
              </div>
            </div>
            {form.barcode && (
              <div className="form-barcode-preview">
                <BarcodeCanvas text={form.barcode} />
              </div>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={() => setFormOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={busy || !form.name.trim()}>
                {busy ? 'Saving...' : 'Save '}
              </button>
            </div>
          </div>
        </div>
      )}

      {stockModal && (
        <div className="modal-overlay">
          <div className="modal modal-sm">
            <h2>Stock Adjustment</h2>
            <p className="muted">
              {stockModal.product.name} — current stock: <strong>{stockModal.product.stock_qty}</strong>
            </p>
            <label className="field">
              <span>Quantity (+in / −out)</span>
              <input
                type="number"
                value={stockQty}
                autoFocus
                onChange={(e) => setStockQty(e.target.value)}
                placeholder="e.g. 10 or -3"
              />
            </label>
            <label className="field">
              <span>Reason</span>
              <input value={stockReason} onChange={(e) => setStockReason(e.target.value)} />
            </label>
            <div className="modal-actions">
              <button className="btn" onClick={() => setStockModal(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleStock} disabled={!stockQty}>
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {movements && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Stock History — {movements.product.name}</h2>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Change</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.rows.map((m) => (
                    <tr key={m.id}>
                      <td>{m.created_at ? new Date(m.created_at).toLocaleString() : '—'}</td>
                      <td className={m.change_qty >= 0 ? 'text-ok' : 'text-warn'}>
                        {m.change_qty > 0 ? '+' : ''}
                        {m.change_qty}
                      </td>
                      <td>{m.reason ?? '—'}</td>
                    </tr>
                  ))}
                  {movements.rows.length === 0 && (
                    <tr>
                      <td colSpan={3} className="muted center">
                        No movements recorded.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setMovements(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {importResult && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Import Result</h2>
            <p>
              <strong>{importResult.inserted}</strong> product(s) imported successfully.
              {importResult.errors.length > 0 && (
                <span className="text-warn">
                  {' '}
                  <strong>{importResult.errors.length}</strong> row(s) failed.
                </span>
              )}
            </p>
            {importResult.errors.length > 0 && (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="num">Row</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importResult.errors.map((e, i) => (
                      <tr key={i}>
                        <td className="num">{e.row}</td>
                        <td className="text-warn">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={async () => {
                  setImportResult(null);
                  await load();
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      {batches && (
        <div className="modal-overlay">
          <div className="modal modal-wide">
            <h2>Batch Details — {batches.product.name}</h2>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Batch #</th>
                    <th className="num">Qty</th>
                    <th className="num">Cost</th>
                    <th>Expiry Date</th>
                    <th>Received</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.rows.map((b) => (
                    <tr key={b.id}>
                      <td><strong>{b.batch_number}</strong></td>
                      <td className="num">{b.quantity}</td>
                      <td className="num">{b.cost_price.toLocaleString()}</td>
                      <td>{b.expiry_date ?? '—'}</td>
                      <td>{b.received_date ? new Date(b.received_date).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                  {batches.rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted center">No batches recorded.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setBatches(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {stockReceived && (
        <div className="modal-overlay">
          <div className="modal modal-wide">
            <h2>Stock Received Log</h2>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Batch #</th>
                    <th className="num">Qty</th>
                    <th className="num">Cost</th>
                    <th>Expiry</th>
                    <th>Received Date</th>
                  </tr>
                </thead>
                <tbody>
                  {stockReceived.map(({ product, batch: b }) => (
                      <tr key={b.id}>
                        <td>{product.name}</td>
                        <td><strong>{b.batch_number}</strong></td>
                        <td className="num">{b.quantity}</td>
                        <td className="num">{b.cost_price.toLocaleString()}</td>
                        <td>{b.expiry_date ?? '—'}</td>
                        <td>{b.received_date ? new Date(b.received_date).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  {stockReceived.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted center">No stock received records.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setStockReceived(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
