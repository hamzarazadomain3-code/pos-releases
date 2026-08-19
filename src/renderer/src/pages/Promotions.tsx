import { useCallback, useEffect, useState } from 'react';
import type { Category, Product, PromotionInput, PromotionRow } from '../../../shared/types';

const emptyForm = (): PromotionInput => ({
  name: '',
  type: 'percent',
  scope: 'product',
  product_id: null,
  category_id: null,
  discount_value: 10,
  buy_qty: 2,
  free_qty: 1,
  start_date: '',
  end_date: '',
  active: true,
});

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function inDateRange(p: PromotionRow): boolean {
  const t = today();
  if (p.start_date && p.start_date > t) return false;
  if (p.end_date && p.end_date < t) return false;
  return true;
}

export default function Promotions() {
  const [rows, setRows] = useState<PromotionRow[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState<PromotionInput>(emptyForm());
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await window.api.promotions.list());
      setProducts(await window.api.inventory.list());
      setCategories(await window.api.inventory.categories());
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setModal(true);
  };

  const openEdit = (p: PromotionRow) => {
    setEditing(p.id);
    setForm({
      name: p.name,
      type: p.type,
      scope: p.scope,
      product_id: p.product_id,
      category_id: p.category_id,
      discount_value: p.discount_value,
      buy_qty: p.buy_qty,
      free_qty: p.free_qty,
      start_date: p.start_date ?? '',
      end_date: p.end_date ?? '',
      active: p.active === 1,
    });
    setModal(true);
  };

  const save = async () => {
    try {
      setErr('');
      const input: PromotionInput = {
        ...form,
        name: form.name.trim(),
        product_id: form.scope === 'product' ? form.product_id : null,
        category_id: form.scope === 'category' ? form.category_id : null,
        discount_value: Number(form.discount_value) || 0,
        buy_qty: Number(form.buy_qty) || 1,
        free_qty: Number(form.free_qty) || 0,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
      };
      if (editing === null) await window.api.promotions.create(input);
      else await window.api.promotions.update(editing, input);
      setModal(false);
      await load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const toggleActive = async (p: PromotionRow) => {
    try {
      setErr('');
      await window.api.promotions.update(p.id, {
        name: p.name,
        type: p.type,
        scope: p.scope,
        product_id: p.product_id,
        category_id: p.category_id,
        discount_value: p.discount_value,
        buy_qty: p.buy_qty,
        free_qty: p.free_qty,
        start_date: p.start_date,
        end_date: p.end_date,
        active: p.active !== 1,
      });
      await load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const remove = async (p: PromotionRow) => {
    if (!window.confirm(`Delete promotion "${p.name}"?`)) return;
    try {
      setErr('');
      await window.api.promotions.remove(p.id);
      await load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const typeLabel = (t: PromotionRow['type']) =>
    t === 'percent' ? 'Percent off' : t === 'fixed' ? 'Fixed amount off' : 'BOGO';
  const scopeLabel = (p: PromotionRow) =>
    p.scope === 'product' ? (p.product_name ?? `Product #${p.product_id}`) : (p.category_name ?? `Category #${p.category_id}`);
  const valueLabel = (p: PromotionRow) =>
    p.type === 'percent'
      ? `${p.discount_value}%`
      : p.type === 'fixed'
        ? `${p.discount_value.toFixed(2)} off`
        : p.discount_value >= 100
          ? `Buy ${p.buy_qty} Get ${p.free_qty} Free`
          : `Buy ${p.buy_qty} Get ${p.free_qty} at ${p.discount_value}% off`;

  const statusInfo = (p: PromotionRow) => {
    if (p.active !== 1) return { cls: 'bad', text: 'Disabled' };
    if (!inDateRange(p)) return { cls: '', text: 'Scheduled / Expired' };
    return { cls: 'ok', text: 'Active' };
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Promotions</h1>
        <button className="btn btn-primary" onClick={openCreate}>
          New Promotion
        </button>
      </div>

      {err && (
        <div className="notice error">
          {err} <button className="btn btn-sm" onClick={() => setErr('')}>OK</button>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>Discount Rules</h2>
          <p className="muted small">
            Auto-applied at checkout — best deal for the customer wins (product rule beats category rule on a tie).
          </p>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Applies To</th>
              <th>Deal</th>
              <th>Valid From</th>
              <th>Valid To</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const st = statusInfo(p);
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{typeLabel(p.type)}</td>
                  <td>{scopeLabel(p)}</td>
                  <td>{valueLabel(p)}</td>
                  <td>{p.start_date ?? '—'}</td>
                  <td>{p.end_date ?? '—'}</td>
                  <td>
                    <span className={`badge ${st.cls === 'ok' ? 'ok' : st.cls === 'bad' ? 'bad' : ''}`}>{st.text}</span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-sm" onClick={() => openEdit(p)}>
                        Edit
                      </button>
                      <button className="btn btn-sm" onClick={() => toggleActive(p)}>
                        {p.active === 1 ? 'Disable' : 'Enable'}
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => remove(p)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={8} className="muted">
                  No promotions yet — create one to auto-apply discounts at checkout.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="modal-overlay">
          <div className="modal modal-wide">
            <h2>{editing === null ? 'New Promotion' : 'Edit Promotion'}</h2>
            <label className="lbl">Name *</label>
            <input className="inp" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />

            <div className="form-grid" style={{ marginTop: 10 }}>
              <div className="field">
                <span>Type</span>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as PromotionInput['type'] })}>
                  <option value="percent">Percent off</option>
                  <option value="fixed">Fixed amount off</option>
                  <option value="bogo">BOGO (Buy X Get Y)</option>
                </select>
              </div>
              <div className="field">
                <span>Applies To</span>
                <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as PromotionInput['scope'] })}>
                  <option value="product">Product</option>
                  <option value="category">Category</option>
                </select>
              </div>
            </div>

            {form.scope === 'product' ? (
              <label className="field" style={{ marginTop: 10 }}>
                <span>Product *</span>
                <select
                  value={form.product_id ?? ''}
                  onChange={(e) => setForm({ ...form, product_id: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">— select —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sale_price})
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="field" style={{ marginTop: 10 }}>
                <span>Category *</span>
                <select
                  value={form.category_id ?? ''}
                  onChange={(e) => setForm({ ...form, category_id: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">— select —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="form-grid" style={{ marginTop: 10 }}>
              {form.type === 'percent' && (
                <label className="field">
                  <span>Discount % (1-100)</span>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={form.discount_value}
                    onChange={(e) => setForm({ ...form, discount_value: Number(e.target.value) })}
                  />
                </label>
              )}
              {form.type === 'fixed' && (
                <label className="field">
                  <span>Amount off</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.discount_value}
                    onChange={(e) => setForm({ ...form, discount_value: Number(e.target.value) })}
                  />
                </label>
              )}
              {form.type === 'bogo' && (
                <>
                  <label className="field">
                    <span>Buy (qty)</span>
                    <input
                      type="number"
                      min="1"
                      value={form.buy_qty}
                      onChange={(e) => setForm({ ...form, buy_qty: Number(e.target.value) })}
                    />
                  </label>
                  <label className="field">
                    <span>Get (qty)</span>
                    <input
                      type="number"
                      min="1"
                      value={form.free_qty}
                      onChange={(e) => setForm({ ...form, free_qty: Number(e.target.value) })}
                    />
                  </label>
                  <label className="field">
                    <span>Free-item discount % (100 = free)</span>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={form.discount_value}
                      onChange={(e) => setForm({ ...form, discount_value: Number(e.target.value) })}
                    />
                  </label>
                </>
              )}
              {form.type !== 'bogo' && (
                <div className="field">
                  <span>&nbsp;</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={form.active}
                      onChange={(e) => setForm({ ...form, active: e.target.checked })}
                    />
                    Enabled
                  </label>
                </div>
              )}
            </div>

            <div className="form-grid" style={{ marginTop: 10 }}>
              <label className="field">
                <span>Start date (optional)</span>
                <input type="date" value={form.start_date ?? ''} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </label>
              <label className="field">
                <span>End date (optional)</span>
                <input type="date" value={form.end_date ?? ''} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
              </label>
            </div>
            {form.type === 'bogo' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                Enabled
              </label>
            )}

            <div className="row-btns">
              <button className="btn btn-primary" onClick={save}>
                Save
              </button>
              <button className="btn" onClick={() => setModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}