import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ExpenseCategoryRow, ExpenseRow } from '../../../shared/types';
import { toLocalDateString, formatDateAdmin } from '../utils/dateUtils';

const fmt = (n: number) => n?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '0';

export default function Expenses() {
  const { t } = useTranslation();
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [categories, setCategories] = useState<ExpenseCategoryRow[]>([]);
  const [summary, setSummary] = useState<{ total: number; byCategory: Array<{ category: string; total: number; count: number }> }>({ total: 0, byCategory: [] });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'list' | 'categories'>('list');
  const [filterCategory, setFilterCategory] = useState<number | ''>('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');

  // Expense form
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [formCat, setFormCat] = useState<number | ''>('');
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formDate, setFormDate] = useState(toLocalDateString(new Date()));
  const [formRecurring, setFormRecurring] = useState(false);
  const [formRecType, setFormRecType] = useState<'daily' | 'weekly' | 'monthly'>('monthly');

  // Category form
  const [catFormOpen, setCatFormOpen] = useState(false);
  const [catEditId, setCatEditId] = useState<number | null>(null);
  const [catName, setCatName] = useState('');
  const [catDesc, setCatDesc] = useState('');
  const [catColor, setCatColor] = useState('#6B7280');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const filters: any = {};
      if (filterCategory) filters.category_id = filterCategory;
      if (filterFrom) filters.from = filterFrom;
      if (filterTo) filters.to = filterTo;
      const [e, c, s] = await Promise.all([
        window.api.expenses.list(filters),
        window.api.expenses.categories(),
        window.api.expenses.summary(filterFrom || undefined, filterTo || undefined),
      ]);
      setExpenses(e);
      setCategories(c);
      setSummary(s);
    } catch (e) { setErr(String(e)); }
    finally { setLoading(false); }
  }, [filterCategory, filterFrom, filterTo]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (err || success) { const t = setTimeout(() => { setErr(''); setSuccess(''); }, 3000); return () => clearTimeout(t); }
  }, [err, success]);

  const resetForm = () => {
    setFormOpen(false); setEditId(null); setFormCat(''); setFormTitle('');
    setFormDesc(''); setFormAmount(''); setFormDate(toLocalDateString(new Date()));
    setFormRecurring(false); setFormRecType('monthly');
  };

  const openNew = () => {
    resetForm(); setFormOpen(true);
    if (categories.length > 0) setFormCat(categories[0].id);
  };

  const openEdit = (e: ExpenseRow) => {
    setFormOpen(true); setEditId(e.id);
    setFormCat(e.category_id); setFormTitle(e.title); setFormDesc(e.description || '');
    setFormAmount(String(e.amount)); setFormDate(e.expense_date.slice(0, 10));
    setFormRecurring(!!e.is_recurring); setFormRecType(e.recurrence_type || 'monthly');
  };

  const saveExpense = async () => {
    if (!formCat || !formTitle || !formAmount) return;
    const amt = parseFloat(formAmount);
    if (isNaN(amt) || amt <= 0) return;
    const payload = {
      category_id: formCat, user_id: 1, title: formTitle, description: formDesc || undefined,
      amount: amt, expense_date: formDate, is_recurring: formRecurring,
      recurrence_type: formRecurring ? formRecType : null,
    };
    const res = editId
      ? await window.api.expenses.update(editId, payload)
      : await window.api.expenses.create(payload);
    if (res.ok) { setSuccess(editId ? 'Expense updated' : 'Expense added'); resetForm(); load(); }
    else setErr(res.message || 'Error');
  };

  const deleteExpense = async (id: number) => {
    if (!confirm('Delete this expense?')) return;
    const res = await window.api.expenses.delete(id);
    if (res.ok) { setSuccess('Deleted'); load(); } else setErr(res.message || 'Error');
  };

  // Category management
  const resetCatForm = () => { setCatFormOpen(false); setCatEditId(null); setCatName(''); setCatDesc(''); setCatColor('#6B7280'); };
  const saveCategory = async () => {
    if (!catName) return;
    const res = catEditId
      ? await window.api.expenses.updateCategory(catEditId, { name: catName, description: catDesc, color: catColor })
      : await window.api.expenses.createCategory({ name: catName, description: catDesc, color: catColor });
    if (res.ok) { setSuccess(catEditId ? 'Category updated' : 'Category added'); resetCatForm(); load(); }
    else setErr(res.message || 'Error');
  };
  const deleteCategory = async (id: number) => {
    if (!confirm('Delete this category?')) return;
    const res = await window.api.expenses.deleteCategory(id);
    if (res.ok) { setSuccess('Deleted'); load(); } else setErr(res.message || 'Error');
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Expenses</h1>
        <div className="row-btns">
          {tab === 'list' && <button className="btn btn-primary" onClick={openNew}>+ New Expense</button>}
          {tab === 'categories' && <button className="btn btn-primary" onClick={() => { resetCatForm(); setCatFormOpen(true); }}>+ New Category</button>}
        </div>
      </div>

      {err && <div className="notice" style={{ color: 'var(--danger)' }}>{err}</div>}
      {success && <div className="notice" style={{ color: 'var(--ok)' }}>{success}</div>}

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="small muted">Total Expenses</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>Rs {fmt(summary.total)}</div>
        </div>
        {summary.byCategory.slice(0, 4).map((c) => (
          <div key={c.category} className="card" style={{ textAlign: 'center' }}>
            <div className="small muted">{c.category}</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>Rs {fmt(c.total)}</div>
            <div className="small muted">{c.count} items</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className={`btn btn-sm ${tab === 'list' ? 'btn-primary' : ''}`} onClick={() => setTab('list')}>Expenses</button>
        <button className={`btn btn-sm ${tab === 'categories' ? 'btn-primary' : ''}`} onClick={() => setTab('categories')}>Categories</button>
      </div>

      {/* Filters */}
      {tab === 'list' && (
        <div className="form-row" style={{ marginBottom: 12 }}>
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value ? Number(e.target.value) : '')}>
            <option value="">All Categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} placeholder="From" />
          <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} placeholder="To" />
        </div>
      )}

      {/* Expense form modal */}
      {formOpen && (
        <div className="modal-overlay" onClick={() => resetForm()}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editId ? 'Edit Expense' : 'New Expense'}</h3>
              <button className="btn-close" onClick={resetForm}>×</button>
            </div>
            <div className="modal-content">
              <div className="form-group">
                <label>Category</label>
                <select value={formCat} onChange={(e) => setFormCat(Number(e.target.value))}>
                  <option value="">Select...</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Title</label>
                <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="Expense title" />
              </div>
              <div className="form-group">
                <label>Description</label>
                <input value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="Optional description" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Amount (Rs)</label>
                  <input type="number" step="0.01" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Date</label>
                  <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} />
                </div>
              </div>
              <div className="form-group">
                <label>
                  <input type="checkbox" checked={formRecurring} onChange={(e) => setFormRecurring(e.target.checked)} /> Recurring
                </label>
                {formRecurring && (
                  <select value={formRecType} onChange={(e) => setFormRecType(e.target.value as any)}>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={resetForm}>Cancel</button>
              <button className="btn btn-primary" onClick={saveExpense}>{editId ? 'Update' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Category form modal */}
      {catFormOpen && (
        <div className="modal-overlay" onClick={() => resetCatForm()}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{catEditId ? 'Edit Category' : 'New Category'}</h3>
              <button className="btn-close" onClick={resetCatForm}>×</button>
            </div>
            <div className="modal-content">
              <div className="form-group">
                <label>Name</label>
                <input value={catName} onChange={(e) => setCatName(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Description</label>
                <input value={catDesc} onChange={(e) => setCatDesc(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Color</label>
                <input type="color" value={catColor} onChange={(e) => setCatColor(e.target.value)} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={resetCatForm}>Cancel</button>
              <button className="btn btn-primary" onClick={saveCategory}>{catEditId ? 'Update' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? <div className="muted center">Loading...</div> : tab === 'list' ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Title</th>
              <th>Category</th>
              <th>Amount</th>
              <th>User</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {expenses.length === 0 && <tr><td colSpan={7} className="center muted">No expenses found</td></tr>}
            {expenses.map((e) => (
              <tr key={e.id}>
                <td>{formatDateAdmin(e.expense_date)}</td>
                <td>{e.title}</td>
                <td>
                  <span className="badge" style={{ background: e.category_color || '#6B7280', color: '#fff' }}>
                    {e.category_name}
                  </span>
                </td>
                <td style={{ fontWeight: 600 }}>Rs {fmt(e.amount)}</td>
                <td className="muted">{e.username}</td>
                <td><span className={`badge ${e.status === 'active' ? 'badge-ok' : 'badge-warn'}`}>{e.status}</span></td>
                <td>
                  <button className="btn btn-sm" onClick={() => openEdit(e)}>Edit</button>{' '}
                  <button className="btn btn-sm btn-danger" onClick={() => deleteExpense(e.id)}>Del</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Name</th><th>Description</th><th>Color</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="muted">{c.description || '-'}</td>
                <td><span style={{ display: 'inline-block', width: 20, height: 20, borderRadius: 4, background: c.color, verticalAlign: 'middle' }} /></td>
                <td><span className={`badge ${c.is_active ? 'badge-ok' : 'badge-warn'}`}>{c.is_active ? 'Active' : 'Inactive'}</span></td>
                <td>
                  <button className="btn btn-sm" onClick={() => { setCatFormOpen(true); setCatEditId(c.id); setCatName(c.name); setCatDesc(c.description || ''); setCatColor(c.color); }}>Edit</button>{' '}
                  <button className="btn btn-sm btn-danger" onClick={() => deleteCategory(c.id)}>Del</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
