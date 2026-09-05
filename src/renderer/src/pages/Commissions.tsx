import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CommissionRuleRow, SalesmanCommissionRow } from '../../../shared/types';
import { formatDateAdmin } from '../utils/dateUtils';

const fmt = (n: number) => n?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '0';

export default function Commissions() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'rules' | 'commissions' | 'summary'>('rules');
  const [rules, setRules] = useState<CommissionRuleRow[]>([]);
  const [commissions, setCommissions] = useState<SalesmanCommissionRow[]>([]);
  const [salesmen, setSalesmen] = useState<Array<{ id: number; username: string; commission_rate: number }>>([]);
  const [summary, setSummary] = useState({ total: 0, pending: 0, paid: 0, count: 0 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');

  // Filters
  const [filterSalesman, setFilterSalesman] = useState<number | ''>('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  // Rule form
  const [ruleFormOpen, setRuleFormOpen] = useState(false);
  const [ruleEditId, setRuleEditId] = useState<number | null>(null);
  const [ruleName, setRuleName] = useState('');
  const [ruleType, setRuleType] = useState<'percent' | 'fixed'>('percent');
  const [ruleValue, setRuleValue] = useState('');
  const [ruleScope, setRuleScope] = useState<'global' | 'category' | 'product'>('global');
  const [rulePriority, setRulePriority] = useState('0');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([
        window.api.commissions.rules(),
        window.api.commissions.salesmen(),
      ]);
      setRules(r);
      setSalesmen(s);
    } catch (e) { setErr(String(e)); }
    finally { setLoading(false); }
  }, []);

  const loadCommissions = useCallback(async () => {
    setLoading(true);
    try {
      const filters: any = {};
      if (filterSalesman) filters.salesman_id = filterSalesman;
      if (filterStatus) filters.status = filterStatus;
      if (filterFrom) filters.from = filterFrom;
      if (filterTo) filters.to = filterTo;
      const [c, sm] = await Promise.all([
        window.api.commissions.list(filters),
        filterSalesman ? window.api.commissions.summary(filterSalesman as number, filterFrom || undefined, filterTo || undefined) : null,
      ]);
      setCommissions(c);
      if (sm) setSummary(sm);
    } catch (e) { setErr(String(e)); }
    finally { setLoading(false); }
  }, [filterSalesman, filterStatus, filterFrom, filterTo]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === 'commissions') loadCommissions(); }, [tab, loadCommissions]);

  useEffect(() => {
    if (err || success) { const t = setTimeout(() => { setErr(''); setSuccess(''); }, 3000); return () => clearTimeout(t); }
  }, [err, success]);

  const resetRuleForm = () => {
    setRuleFormOpen(false); setRuleEditId(null); setRuleName('');
    setRuleType('percent'); setRuleValue(''); setRuleScope('global'); setRulePriority('0');
  };

  const openRuleEdit = (r: CommissionRuleRow) => {
    setRuleFormOpen(true); setRuleEditId(r.id); setRuleName(r.name);
    setRuleType(r.type); setRuleValue(String(r.value)); setRuleScope(r.scope); setRulePriority(String(r.priority));
  };

  const saveRule = async () => {
    if (!ruleName || !ruleValue) return;
    const payload = {
      name: ruleName, type: ruleType, value: parseFloat(ruleValue),
      scope: ruleScope, priority: parseInt(rulePriority) || 0,
    };
    const res = ruleEditId
      ? await window.api.commissions.updateRule(ruleEditId, payload)
      : await window.api.commissions.createRule(payload);
    if (res.ok) { setSuccess(ruleEditId ? 'Rule updated' : 'Rule created'); resetRuleForm(); load(); }
    else setErr(res.message || 'Error');
  };

  const deleteRule = async (id: number) => {
    if (!confirm('Delete this rule?')) return;
    const res = await window.api.commissions.deleteRule(id);
    if (res.ok) { setSuccess('Deleted'); load(); } else setErr(res.message || 'Error');
  };

  const updateStatus = async (id: number, status: string) => {
    const res = await window.api.commissions.updateStatus(id, status, 1);
    if (res.ok) { setSuccess(`Status → ${status}`); loadCommissions(); }
    else setErr(res.message || 'Error');
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Salesman Commissions</h1>
        <div className="row-btns">
          {tab === 'rules' && <button className="btn btn-primary" onClick={() => { resetRuleForm(); setRuleFormOpen(true); }}>+ New Rule</button>}
        </div>
      </div>

      {err && <div className="notice" style={{ color: 'var(--danger)' }}>{err}</div>}
      {success && <div className="notice" style={{ color: 'var(--ok)' }}>{success}</div>}

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="small muted">Total Commissions</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Rs {fmt(summary.total)}</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="small muted">Pending</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--warn)' }}>Rs {fmt(summary.pending)}</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="small muted">Paid</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ok)' }}>Rs {fmt(summary.paid)}</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="small muted">Transactions</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{summary.count}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className={`btn btn-sm ${tab === 'rules' ? 'btn-primary' : ''}`} onClick={() => setTab('rules')}>Rules</button>
        <button className={`btn btn-sm ${tab === 'commissions' ? 'btn-primary' : ''}`} onClick={() => setTab('commissions')}>Commissions</button>
      </div>

      {/* Filters for commissions tab */}
      {tab === 'commissions' && (
        <div className="form-row" style={{ marginBottom: 12 }}>
          <select value={filterSalesman} onChange={(e) => setFilterSalesman(e.target.value ? Number(e.target.value) : '')}>
            <option value="">All Salesmen</option>
            {salesmen.map((s) => <option key={s.id} value={s.id}>{s.username}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} placeholder="From" />
          <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} placeholder="To" />
        </div>
      )}

      {/* Rule form modal */}
      {ruleFormOpen && (
        <div className="modal-overlay" onClick={() => resetRuleForm()}>
          <div className="modal" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{ruleEditId ? 'Edit Rule' : 'New Commission Rule'}</h3>
              <button className="btn-close" onClick={resetRuleForm}>×</button>
            </div>
            <div className="modal-content">
              <div className="form-group">
                <label>Rule Name</label>
                <input value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder="e.g. 5% on all sales" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Type</label>
                  <select value={ruleType} onChange={(e) => setRuleType(e.target.value as any)}>
                    <option value="percent">Percent (%)</option>
                    <option value="fixed">Fixed (Rs)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Value</label>
                  <input type="number" step="0.01" value={ruleValue} onChange={(e) => setRuleValue(e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Scope</label>
                  <select value={ruleScope} onChange={(e) => setRuleScope(e.target.value as any)}>
                    <option value="global">Global</option>
                    <option value="category">Category</option>
                    <option value="product">Product</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Priority</label>
                  <input type="number" value={rulePriority} onChange={(e) => setRulePriority(e.target.value)} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={resetRuleForm}>Cancel</button>
              <button className="btn btn-primary" onClick={saveRule}>{ruleEditId ? 'Update' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? <div className="muted center">Loading...</div> : tab === 'rules' ? (
        <table className="data-table">
          <thead>
            <tr><th>Name</th><th>Type</th><th>Value</th><th>Scope</th><th>Priority</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {rules.length === 0 && <tr><td colSpan={7} className="center muted">No rules configured</td></tr>}
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td><span className="badge">{r.type}</span></td>
                <td style={{ fontWeight: 600 }}>{r.type === 'percent' ? `${r.value}%` : `Rs ${fmt(r.value)}`}</td>
                <td>{r.scope}</td>
                <td>{r.priority}</td>
                <td><span className={`badge ${r.is_active ? 'badge-ok' : 'badge-warn'}`}>{r.is_active ? 'Active' : 'Inactive'}</span></td>
                <td>
                  <button className="btn btn-sm" onClick={() => openRuleEdit(r)}>Edit</button>{' '}
                  <button className="btn btn-sm btn-danger" onClick={() => deleteRule(r.id)}>Del</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Date</th><th>Salesman</th><th>Sale ID</th><th>Base</th><th>Rate</th><th>Commission</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {commissions.length === 0 && <tr><td colSpan={8} className="center muted">No commissions found</td></tr>}
            {commissions.map((c) => (
              <tr key={c.id}>
                <td>{formatDateAdmin(c.created_at)}</td>
                <td>{c.salesman_name}</td>
                <td>#{c.sale_id}</td>
                <td>Rs {fmt(c.base_amount)}</td>
                <td>{c.commission_type === 'percent' ? `${c.commission_rate}%` : `Rs ${fmt(c.commission_rate)}`}</td>
                <td style={{ fontWeight: 600, color: 'var(--ok)' }}>Rs {fmt(c.commission_amount)}</td>
                <td><span className={`badge badge-${c.status === 'paid' ? 'ok' : c.status === 'cancelled' ? 'warn' : ''}`}>{c.status}</span></td>
                <td>
                  {c.status === 'pending' && <>
                    <button className="btn btn-sm" onClick={() => updateStatus(c.id, 'approved')}>Approve</button>{' '}
                    <button className="btn btn-sm btn-danger" onClick={() => updateStatus(c.id, 'cancelled')}>Cancel</button>
                  </>}
                  {c.status === 'approved' && (
                    <button className="btn btn-sm btn-primary" onClick={() => updateStatus(c.id, 'paid')}>Pay</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
