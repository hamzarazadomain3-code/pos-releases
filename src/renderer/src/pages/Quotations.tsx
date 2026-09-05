import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuotationRow, Customer, Product } from '../../../shared/types';
import { formatDateTimeAdmin } from '../utils/dateUtils';

const fmt = (n: number) => n?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '0';

interface QuotationItemDraft {
  product_id: number;
  product_name?: string;
  qty: number;
  unit_price: number;
  line_total: number;
}

export default function Quotations() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<QuotationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<QuotationItemDraft[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [foundProducts, setFoundProducts] = useState<Product[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.api.quotations.list(
        { search: search || undefined, status: statusFilter || undefined }
      );
      setRows(data);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    window.api.customers.list().then(setCustomers).catch(() => undefined);
  }, []);

  const handleConvert = async (id: number) => {
    setErr(''); setSuccess('');
    try {
      const user = await window.api.auth.currentUser();
      const res = await window.api.quotations.convertToSale(id, user?.id || 1);
      if (res.ok) {
        setSuccess(`Converted to sale ${res.invoice_no}`);
        load();
      } else {
        setErr(res.message || 'Conversion failed');
      }
    } catch (e) {
      setErr(String(e));
    }
  };

  const handleExpire = async () => {
    try {
      const res = await window.api.quotations.expireOld();
      if (res.count > 0) {
        setSuccess(`${res.count} quotation(s) expired`);
        load();
      }
    } catch (e) {
      setErr(String(e));
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const res = await window.api.quotations.delete(id);
      if (res.ok) { setSuccess('Quotation deleted'); load(); }
      else setErr(res.message || 'Delete failed');
    } catch (e) {
      setErr(String(e));
    }
  };

  const searchProducts = async (q: string) => {
    setProductSearch(q);
    if (q.length < 2) { setFoundProducts([]); return; }
    try {
      const results = await window.api.inventory.list(q);
      setFoundProducts(results.slice(0, 10));
    } catch { setFoundProducts([]); }
  };

  const addItem = (p: Product) => {
    if (items.some((i) => i.product_id === p.id)) return;
    setItems([...items, {
      product_id: p.id,
      product_name: p.name,
      qty: 1,
      unit_price: p.sale_price,
      line_total: p.sale_price,
    }]);
    setProductSearch('');
    setFoundProducts([]);
  };

  const updateItem = (idx: number, field: keyof QuotationItemDraft, value: number) => {
    const next = [...items];
    (next[idx] as any)[field] = value;
    next[idx].line_total = next[idx].qty * next[idx].unit_price;
    setItems(next);
  };

  const removeItem = (idx: number) => {
    setItems(items.filter((_, i) => i !== idx));
  };

  const totalAmount = items.reduce((s, i) => s + i.line_total, 0);

  const handleCreate = async () => {
    setSaving(true);
    setErr('');
    try {
      const user = await window.api.auth.currentUser();
      if (!user) { setErr('Not logged in'); setSaving(false); return; }
      const res = await window.api.quotations.create({
        customer_id: customerId || null,
        user_id: user.id,
        notes: notes || null,
        items: items.map((i) => ({
          product_id: i.product_id,
          qty: i.qty,
          unit_price: i.unit_price,
          line_total: i.line_total,
        })),
        subtotal: totalAmount,
        total_amount: totalAmount,
      });
      if (res.ok) {
        setSuccess(`Created ${res.quote_no}`);
        setEditorOpen(false);
        setItems([]);
        setCustomerId('');
        setNotes('');
        load();
      } else {
        setErr(res.message || 'Create failed');
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Quotations</h1>
        <div className="row-btns">
          <button className="btn" onClick={handleExpire}>Expire Old</button>
          <button className="btn btn-primary" onClick={() => setEditorOpen(true)}>
            New Quotation
          </button>
        </div>
      </div>

      {err && <div className="card"><p className="text-warn">{err}</p></div>}
      {success && <div className="card"><p style={{ color: '#16a34a' }}>{success}</p></div>}

      <div className="card">
        <div className="row-btns" style={{ marginBottom: 12 }}>
          <input
            placeholder="Search quote no / customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            style={{ flex: 1 }}
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="expired">Expired</option>
            <option value="converted">Converted</option>
          </select>
          <button className="btn" onClick={load}>Search</button>
        </div>

        {loading ? (
          <p className="muted center pad">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="muted center pad">No quotations found.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Quote #</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Valid Until</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((q) => (
                  <tr key={q.id}>
                    <td><strong>{q.quote_no}</strong></td>
                    <td>{q.customer_name || '—'}</td>
                    <td>
                      <span style={{
                        padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600,
                        background: q.status === 'converted' ? '#dcfce7' :
                          q.status === 'expired' ? '#fef2f2' :
                          q.status === 'accepted' ? '#dbeafe' : '#f3f4f6',
                        color: q.status === 'converted' ? '#166534' :
                          q.status === 'expired' ? '#991b1b' :
                          q.status === 'accepted' ? '#1e40af' : '#374151',
                      }}>
                        {q.status}
                      </span>
                    </td>
                    <td>{fmt(q.total_amount)}</td>
                    <td>{q.valid_until || '—'}</td>
                    <td>{formatDateTimeAdmin(q.created_at)}</td>
                    <td>
                      <div className="row-btns">
                        {q.status !== 'converted' && q.status !== 'expired' && (
                          <button className="btn btn-primary btn-sm" onClick={() => handleConvert(q.id)}>
                            Convert
                          </button>
                        )}
                        {q.status !== 'converted' && (
                          <button className="btn btn-sm" style={{ color: '#b91c1c' }} onClick={() => handleDelete(q.id)}>
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editorOpen && (
        <div className="modal-overlay" onClick={() => setEditorOpen(false)}>
          <div className="modal" style={{ maxWidth: 720, width: '95%' }} onClick={(e) => e.stopPropagation()}>
            <div className="row-btns" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
              <h2>New Quotation</h2>
              <button className="btn btn-sm" onClick={() => setEditorOpen(false)}>✕</button>
            </div>

            <div className="form-group">
              <label>Customer</label>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">Walk-in Customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Add Product (search by name or barcode)</label>
              <input
                placeholder="Type to search..."
                value={productSearch}
                onChange={(e) => searchProducts(e.target.value)}
              />
              {foundProducts.length > 0 && (
                <div style={{ border: '1px solid #ddd', borderRadius: 6, marginTop: 4, maxHeight: 200, overflowY: 'auto' }}>
                  {foundProducts.map((p) => (
                    <div
                      key={p.id}
                      style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0' }}
                      onClick={() => addItem(p)}
                    >
                      <strong>{p.name}</strong> — {fmt(p.sale_price)}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {items.length > 0 && (
              <table className="data-table" style={{ marginBottom: 12 }}>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Price</th>
                    <th>Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={idx}>
                      <td>{item.product_name}</td>
                      <td>
                        <input
                          type="number" min="1" value={item.qty}
                          style={{ width: 60 }}
                          onChange={(e) => updateItem(idx, 'qty', Number(e.target.value))}
                        />
                      </td>
                      <td>
                        <input
                          type="number" min="0" step="0.01" value={item.unit_price}
                          style={{ width: 90 }}
                          onChange={(e) => updateItem(idx, 'unit_price', Number(e.target.value))}
                        />
                      </td>
                      <td>{fmt(item.line_total)}</td>
                      <td>
                        <button className="btn btn-sm" onClick={() => removeItem(idx)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="form-group">
              <label>Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>

            <div className="row-btns" style={{ justifyContent: 'space-between' }}>
              <strong>Total: {fmt(totalAmount)}</strong>
              <div className="row-btns">
                <button className="btn" onClick={() => setEditorOpen(false)}>Cancel</button>
                <button
                  className="btn btn-primary"
                  disabled={items.length === 0 || saving}
                  onClick={handleCreate}
                >
                  {saving ? 'Saving…' : 'Save Quotation'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
