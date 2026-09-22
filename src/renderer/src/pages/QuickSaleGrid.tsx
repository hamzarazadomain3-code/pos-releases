import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Product, Customer, Category } from '../../../shared/types';
import { formatMoney } from '../utils/currency';
import { useBarcodeScan } from '../hooks/useBarcodeScan';

interface CartItem {
  product_id: number;
  product_name: string;
  qty: number;
  unit_price: number;
  line_total: number;
}

function formatStockQty(qty: number): string {
  return Number(qty.toFixed(2)).toString();
}

export default function QuickSaleGrid() {
  const { t } = useTranslation();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | 'all'>('all');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerId, setCustomerId] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');
  const [pendingQty, setPendingQty] = useState(1);
  const [qtyDialog, setQtyDialog] = useState<Product | null>(null);
  const [qtyDialogValue, setQtyDialogValue] = useState('1');
  const [browseIndex, setBrowseIndex] = useState(-1);
  const pendingQtyRef = useRef(1);
  pendingQtyRef.current = pendingQty;
  const browseIndexRef = useRef(-1);
  browseIndexRef.current = browseIndex;
  const gridRef = useRef<HTMLDivElement>(null);
  const clickTimer = useRef<number | null>(null);

  // ── Staged search (Enter 1x select, 2x qty box, 3x confirm & add) ──
  const [searchStage, setSearchStage] = useState<'idle' | 'select' | 'qty'>('idle');
  const [searchSelIdx, setSearchSelIdx] = useState(-1);
  const [searchQty, setSearchQty] = useState('1');

  useEffect(() => {
    Promise.all([
      window.api.inventory.list(),
      window.api.inventory.categories(),
      window.api.customers.list(),
    ]).then(([prods, cats, custs]) => {
      setProducts(prods);
      setCategories(cats);
      setCustomers(custs);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const filteredProducts = products.filter((p) => {
    if (selectedCategory !== 'all' && Number(p.category_id) !== Number(selectedCategory)) return false;
    if (search) {
      const q = search.trim().toLowerCase();
      const inName = p.name.toLowerCase().includes(q);
      const inSku = (p.sku ?? '').toLowerCase().includes(q);
      const inBarcode = (p.barcode ?? '').toLowerCase().includes(q);
      if (!inName && !inSku && !inBarcode) return false;
    }
    return Number(p.active) === 1;
  });

  const selectedSearchProduct = () => {
    if (searchStage === 'idle') return undefined;
    const sel = searchSelIdx >= 0 && searchSelIdx < filteredProducts.length ? filteredProducts[searchSelIdx] : undefined;
    if (sel) return sel;
    if (filteredProducts.length === 0) return undefined;
    return filteredProducts[0];
  };

  const resetStagedSearch = (keepTerm = false) => {
    setSearchStage('idle');
    setSearchSelIdx(-1);
    setSearchQty('1');
    if (!keepTerm) setSearch('');
  };

  const confirmStagedAdd = () => {
    const prod = selectedSearchProduct();
    if (!prod) return;
    const n = Math.max(1, Math.floor(Number(searchQty)) || 1);
    addQty(prod, n);
    resetStagedSearch();
    setBrowseIndex(-1);
  };

  const addToCart = (product: Product) => {
    const existing = cart.find((i) => i.product_id === product.id);
    if (existing) {
      setCart(cart.map((i) =>
        i.product_id === product.id
          ? { ...i, qty: i.qty + 1, line_total: (i.qty + 1) * i.unit_price }
          : i
      ));
    } else {
      setCart([
        ...cart,
        {
          product_id: product.id,
          product_name: product.name,
          qty: 1,
          unit_price: product.sale_price,
          line_total: product.sale_price,
        },
      ]);
    }
  };

  const addQty = (product: Product, qty: number) => {
    const n = Math.max(1, Math.floor(qty) || 1);
    const existing = cart.find((i) => i.product_id === product.id);
    if (existing) {
      setCart(cart.map((i) =>
        i.product_id === product.id
          ? { ...i, qty: i.qty + n, line_total: (i.qty + n) * i.unit_price }
          : i
      ));
    } else {
      setCart([
        ...cart,
        {
          product_id: product.id,
          product_name: product.name,
          qty: n,
          unit_price: product.sale_price,
          line_total: n * product.sale_price,
        },
      ]);
    }
  };

  const openQtyDialog = (product: Product) => {
    pendingQtyRef.current = pendingQty;
    setQtyDialogValue(String(pendingQtyRef.current));
    setQtyDialog(product);
  };

  const confirmQtyDialog = (product: Product) => {
    const v = Number(qtyDialogValue) || 1;
    addQty(product, Math.max(1, Math.min(999, v)));
    setQtyDialog(null);
    setPendingQty(1);
  };

  useEffect(() => {
    if (filteredProducts.length === 0) setBrowseIndex(-1);
    else if (browseIndex >= filteredProducts.length) setBrowseIndex(filteredProducts.length - 1);
  }, [filteredProducts.length]);

  const updateQty = (productId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) =>
          i.product_id === productId ? { ...i, qty: Math.max(1, i.qty + delta) } : i
        )
        .filter((i) => i.qty > 0)
    );
  };

  const removeFromCart = (productId: number) => {
    setCart((prev) => prev.filter((i) => i.product_id !== productId));
  };

  const cartTotal = cart.reduce((s, i) => s + i.line_total, 0);
  const cartCount = cart.reduce((s, i) => s + i.qty, 0);

  const handleCheckout = async () => {
    if (cart.length === 0) { setErr('Cart is empty'); return; }
    setSaving(true);
    setErr(''); setSuccess('');

    try {
      const user = await window.api.auth.currentUser();
      if (!user) { setErr('Not logged in'); setSaving(false); return; }

      const items = cart.map((i) => ({
        product_id: i.product_id,
        qty: i.qty,
        price: i.unit_price,
        line_discount: 0,
        tax_rate: 0,
      }));

      const res = await window.api.sales.create({
        items,
        customer_id: customerId || null,
        bill_discount: 0,
        discount_type: 'amount',
        payments: [{ mode: 'Cash', amount: cartTotal }],
        notes: notes || null,
      });

      if (res.sale) {
        setSuccess(`Sale ${res.sale.invoice_no} completed`);
        setCart([]);
        setCustomerId('');
        setNotes('');
      } else {
        setErr('Sale failed');
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  // ── Barcode scanner (shared hook) ──
  useBarcodeScan({
    enabled: !qtyDialog,
    minLength: 6,
    onScan: (code) => {
      const hit = products.find((p) => p.barcode === code || p.sku === code);
      if (hit) {
        addQty(hit, 1);
        setBrowseIndex(-1);
        resetStagedSearch();
      }
    },
  });

  // ── Keyboard navigation (grid focus only; fields handle their own Enter/arrows) ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName || '';
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (qtyDialog) {
        if (e.key === 'Escape' || e.key === 'Esc') {
          e.preventDefault();
          setQtyDialog(null);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setQtyDialogValue(String(Math.min(999, (Number(qtyDialogValue) || 1) + 1)));
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setQtyDialogValue(String(Math.max(1, (Number(qtyDialogValue) || 1) - 1)));
          return;
        }
        if (e.key === 'Enter' || e.key === '\r' || e.key === '\n') {
          e.preventDefault();
          confirmQtyDialog(qtyDialog);
          return;
        }
      }

      if (inField) return;

      if (e.key.startsWith('Arrow')) {
        setBrowseIndex((prev) => {
          const count = filteredProducts.length;
          if (count === 0) return prev;
          let next = prev < 0 ? 0 : prev;
          if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (next - 1 + count) % count;
          else next = (next + 1) % count;
          const el = gridRef.current?.querySelector(`[data-index="${next}"]`);
          (el as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
          return next;
        });
        e.preventDefault();
        return;
      }

      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setPendingQty((q) => Math.min(999, q + 1));
        return;
      }
      if (e.key === '-') {
        e.preventDefault();
        setPendingQty((q) => Math.max(1, q - 1));
        return;
      }

      if (e.key === 'Enter' || e.key === '\r' || e.key === '\n') {
        e.preventDefault();
        const sel = browseIndex >= 0 && browseIndex < filteredProducts.length ? filteredProducts[browseIndex] : undefined;
        if (sel) openQtyDialog(sel);
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  if (loading) return <p className="muted center pad">Loading Quick Sale…</p>;

  return (
    <div className="page" style={{ display: 'grid', gridTemplateColumns: '220px 1fr 360px', gap: 16, height: 'calc(100vh - 60px)' }}>
      {/* Left: Category Filter */}
      <aside className="card" style={{ height: '100%', overflowY: 'auto' }}>
        <h3 style={{ marginBottom: 12 }}>Categories</h3>
        <button
          className={`btn btn-block ${selectedCategory === 'all' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setSelectedCategory('all')}
          style={{ marginBottom: 8, textAlign: 'left' }}
        >
          All Products
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            className={`btn btn-block ${selectedCategory === c.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSelectedCategory(c.id)}
            style={{ marginBottom: 6, textAlign: 'left' }}
          >
            {c.name}
          </button>
        ))}
      </aside>

      {/* Center: Product Grid */}
      <section className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div className="row-btns" style={{ marginBottom: 12 }}>
          <input
            placeholder="Search products..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSearchStage('idle');
              setSearchSelIdx(-1);
              setSearchQty('1');
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const count = filteredProducts.length;
                if (count === 0) return;
                e.preventDefault();
                setBrowseIndex((prev) => {
                  const base = prev < 0 ? 0 : prev;
                  const next = e.key === 'ArrowDown' ? (base + 1) % count : (base - 1 + count) % count;
                  const el = gridRef.current?.querySelector(`[data-index="${next}"]`);
                  (el as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
                  return next;
                });
                setSearchSelIdx(-1);
                setSearchStage('idle');
                return;
              }
              if (e.key === 'Enter' || e.key === '\r' || e.key === '\n') {
                e.preventDefault();
                if (filteredProducts.length === 0) return;
                if (searchStage === 'select') {
                  setSearchStage('qty');
                  return;
                }
                const sel = searchSelIdx >= 0 && searchSelIdx < filteredProducts.length ? searchSelIdx : 0;
                setSearchSelIdx(sel);
                setBrowseIndex(sel);
                const el = gridRef.current?.querySelector(`[data-index="${sel}"]`);
                (el as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
                setSearchStage('select');
                return;
              }
              if (e.key === 'Escape' || e.key === 'Esc') {
                if (searchStage !== 'idle') resetStagedSearch(true);
                else resetStagedSearch();
              }
            }}
            style={{ flex: 1 }}
          />
          <span className="muted">{filteredProducts.length} products</span>
          </div>
          {searchStage === 'select' && (
            <div className="search-result-item highlighted">
              <span className="psr-name">{selectedSearchProduct()?.name}</span>
              {selectedSearchProduct() && (
                <span className="psr-meta">
                  {formatMoney(selectedSearchProduct()!.sale_price)}
                  {selectedSearchProduct()!.stock_qty > 0
                    ? ` • ${formatStockQty(selectedSearchProduct()!.stock_qty)} in stock`
                    : ' • out'}
                </span>
              )}
              <span className="search-hint">Enter ×1 = selected, Enter ×2 = qty, press Enter again to add</span>
            </div>
          )}
          {searchStage === 'qty' && selectedSearchProduct() && (
            <div className="quantity-input-box">
              <span>{selectedSearchProduct()!.name} — Qty:</span>
              <input
                type="number"
                min={1}
                max={999}
                autoFocus
                value={searchQty}
                onChange={(e) => setSearchQty(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === '\r' || e.key === '\n') {
                    e.preventDefault();
                    confirmStagedAdd();
                    return;
                  }
                  if (e.key === 'Escape' || e.key === 'Esc') {
                    setSearchStage('select');
                  }
                }}
              />
              <button className="btn btn-sm btn-primary" onClick={confirmStagedAdd}>
                Add {Math.max(1, Math.floor(Number(searchQty)) || 1)}
              </button>
              <button className="btn btn-sm" onClick={() => setSearchStage('select')}>Cancel</button>
            </div>
          )}
          <p className="muted small" style={{ marginTop: -8, marginBottom: 8 }}>
            <strong>Quick keys:</strong> arrows move, <strong>+ / −</strong> set qty, <strong>Enter</strong> in search: 1× select, 2× qty, 3× add; double-click an item for exact qty, scanner supported.
          </p>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredProducts.length === 0 ? (
            <p className="muted center pad">
              {selectedCategory !== 'all'
                ? `No products in this category${search ? ` matching "${search}"` : ''}.`
                : 'No products found'}
            </p>
          ) : (
            <div ref={gridRef} style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 12,
              padding: 8,
            }}>
              {filteredProducts.map((p, idx) => (
                <div key={p.id}
                  data-index={idx}
                  className="card"
                  onClick={() => {
                    if (clickTimer.current !== null) { window.clearTimeout(clickTimer.current); clickTimer.current = null; }
                    clickTimer.current = window.setTimeout(() => { clickTimer.current = null; addToCart(p); }, 220);
                  }}
                  onDoubleClick={(e) => {
                    if (clickTimer.current !== null) { window.clearTimeout(clickTimer.current); clickTimer.current = null; }
                    e.preventDefault();
                    openQtyDialog(p);
                  }}
                  style={{
                    cursor: 'pointer',
                    textAlign: 'center',
                    padding: 12,
                    border: '2px solid transparent',
                    transition: 'border-color 0.2s',
                    position: 'relative',
                    ...(browseIndex === idx ? { borderColor: 'var(--primary)', boxShadow: '0 0 0 2px rgba(79, 70, 229, 0.25)' } : {}),
                  }}
                  onMouseEnter={(e) => { if (browseIndexRef.current !== idx) e.currentTarget.style.borderColor = '#3b82f6'; }}
                  onMouseLeave={(e) => { if (browseIndexRef.current !== idx) e.currentTarget.style.borderColor = 'transparent'; }}
                >
                  {p.image ? (
                    <img
                      src={p.image}
                      alt=""
                      loading="lazy"
                      style={{ width: 48, height: 48, objectFit: 'cover', marginBottom: 8, borderRadius: 8 }}
                    />
                  ) : (
                    <div style={{ fontSize: 48, marginBottom: 8 }}>📦</div>
                  )}
                  {browseIndex === idx && (
                    <span className="badge" style={{ position: 'absolute', top: 4, right: 4, background: 'var(--primary)', color: '#fff' }}>
                      × {pendingQty}
                    </span>
                  )}
                  <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.name}
                  </div>
                  <div style={{ color: p.stock_qty > 0 ? '#16a34a' : '#dc2626', fontWeight: 700, marginTop: 4 }}>
                    {formatMoney(p.sale_price)}
                  </div>
                  <div className="muted small" style={{ marginTop: 4, color: p.stock_qty > 0 ? undefined : '#dc2626', fontWeight: p.stock_qty > 0 ? 400 : 600 }}>
                    {p.stock_qty > 0 ? `Stock: ${formatStockQty(p.stock_qty)}` : 'Out of stock'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Right: Cart Panel */}
      <aside className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div className="row-btns" style={{ marginBottom: 12, justifyContent: 'space-between' }}>
          <h3>Cart ({cartCount})</h3>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', borderBottom: '1px solid #eee', paddingBottom: 12 }}>
          {cart.length === 0 ? (
            <p className="muted center pad" style={{ marginTop: 40 }}>Cart is empty</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {cart.map((item) => (
                <li key={item.product_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{item.product_name}</div>
                    <div className="small muted">{formatMoney(item.unit_price)} × {item.qty}</div>
                  </div>
                  <div className="row-btns" style={{ gap: 4 }}>
                    <button className="btn btn-sm" onClick={() => updateQty(item.product_id, -1)}>−</button>
                    <span style={{ padding: '0 8px', minWidth: 30, textAlign: 'center' }}>{item.qty}</span>
                    <button className="btn btn-sm" onClick={() => updateQty(item.product_id, 1)}>+</button>
                    <button className="btn btn-sm" style={{ color: '#b91c1c' }} onClick={() => removeFromCart(item.product_id)}>✕</button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="row-btns" style={{ marginTop: 16, justifyContent: 'space-between' }}>
            <span>Subtotal</span>
            <strong>{formatMoney(cartTotal)}</strong>
          </div>
        </div>

        {/* Checkout Section */}
        <div style={{ paddingTop: 12, borderTop: '1px solid #eee' }}>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label>Customer</label>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Walk-in</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 12 }}>
            <label>Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional notes..." />
          </div>

          {err && <div className="card" style={{ marginBottom: 12 }}><p className="text-warn">{err}</p></div>}
          {success && <div className="card" style={{ marginBottom: 12 }}><p style={{ color: '#16a34a' }}>{success}</p></div>}

          <div className="row-btns" style={{ marginTop: 8 }}>
            <button className="btn" style={{ flex: 1 }} onClick={() => { setCart([]); setCustomerId(''); setNotes(''); }}>
              Clear Cart
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={cart.length === 0 || saving}
              onClick={handleCheckout}
            >
              {saving ? 'Processing…' : `Checkout — ${formatMoney(cartTotal)}`}
            </button>
          </div>
        </div>
      </aside>

      {qtyDialog && (
        <div className="modal-overlay" onClick={() => setQtyDialog(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add quantity — {qtyDialog.name}</h3>
            <label className="field" style={{ marginTop: 12 }}>
              <span>Quantity</span>
              <input
                type="number"
                min={1}
                max={999}
                autoFocus
                value={qtyDialogValue}
                onChange={(e) => setQtyDialogValue(e.target.value)}
                onFocus={(e) => e.target.select()}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp') { setQtyDialogValue(String(Math.min(999, (Number(qtyDialogValue) || 1) + 1))); e.preventDefault(); }
                  if (e.key === 'ArrowDown') { setQtyDialogValue(String(Math.max(1, (Number(qtyDialogValue) || 1) - 1))); e.preventDefault(); }
                }}
              />
            </label>
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn" onClick={() => setQtyDialog(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => confirmQtyDialog(qtyDialog)}>
                Add {Math.max(1, Math.min(999, Number(qtyDialogValue) || 1))}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}