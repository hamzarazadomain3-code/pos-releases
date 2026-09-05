import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Product, Customer, Category } from '../../../shared/types';

interface CartItem {
  product_id: number;
  product_name: string;
  qty: number;
  unit_price: number;
  line_total: number;
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
    if (selectedCategory !== 'all' && p.category_id !== selectedCategory) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return p.active === 1 && p.stock_qty > 0;
  });

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
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1 }}
          />
          <span className="muted">{filteredProducts.length} products</span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredProducts.length === 0 ? (
            <p className="muted center pad">No products found</p>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 12,
              padding: 8,
            }}>
              {filteredProducts.map((p) => (
                <div
                  key={p.id}
                  className="card"
                  onClick={() => addToCart(p)}
                  style={{
                    cursor: 'pointer',
                    textAlign: 'center',
                    padding: 12,
                    border: '2px solid transparent',
                    transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = '#3b82f6'}
                  onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
                >
                  <div style={{ fontSize: 48, marginBottom: 8 }}>📦</div>
                  <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.name}
                  </div>
                  <div style={{ color: '#16a34a', fontWeight: 700, marginTop: 4 }}>
                    Rs {p.sale_price.toLocaleString()}
                  </div>
                  <div className="muted small" style={{ marginTop: 4 }}>
                    Stock: {p.stock_qty}
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
                    <div className="small muted">Rs {item.unit_price.toLocaleString()} × {item.qty}</div>
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
            <strong>Rs {cartTotal.toLocaleString()}</strong>
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
              {saving ? 'Processing…' : `Checkout — Rs ${cartTotal.toLocaleString()}`}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}