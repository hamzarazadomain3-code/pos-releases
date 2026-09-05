import { useEffect, useState } from 'react';
import type { ActivityLogEntry } from '../../../../shared/types';
import { formatTimestamp } from '../../utils/dateUtils';

export default function ActivityLog() {
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<{ from: string; to: string; action: string }>({ from: '', to: '', action: '' });
  const [notice, setNotice] = useState<string | null>(null);
  const pageSize = 50;

  const load = async (offset = 0) => {
    try {
      const f: any = { limit: pageSize, offset };
      if (filters.from) f.from = filters.from;
      if (filters.to) f.to = filters.to;
      if (filters.action) f.action = filters.action;
      const r = await window.api.admin.activity.getAll(f);
      setLogs(r.rows);
      setTotal(r.total);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => { load(0); setPage(0); }, [filters.from, filters.to, filters.action]);

  const clearLogs = async () => {
    if (!confirm('Clear activity logs older than 90 days?')) return;
    try {
      const cleared = await window.api.admin.activity.clear(90);
      setNotice(`Cleared ${cleared} old log entries`);
      load(page * pageSize);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  const formatAction = (a: string) =>
    a.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="admin-sub-page">
      <div className="admin-sub-header">
        <h2>Activity Log</h2>
        <div className="admin-sub-actions">
          <span className="muted small">{total} entries</span>
          <button className="btn btn-sm" onClick={clearLogs}>Clear Old Logs (90+ days)</button>
        </div>
      </div>

      {notice && <div className="notice" onClick={() => setNotice(null)}>{notice}</div>}

      <div className="log-filters">
        <label className="field-inline">
          <span>From</span>
          <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </label>
        <label className="field-inline">
          <span>To</span>
          <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </label>
        <label className="field-inline">
          <span>Action</span>
          <select value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })}>
            <option value="">All Actions</option>
            <option value="login">Login</option>
            <option value="logout">Logout</option>
            <option value="sale_created">Sale Created</option>
            <option value="sale_voided">Sale Voided</option>
            <option value="payment_received">Payment Received</option>
            <option value="stock_adjust">Stock Adjusted</option>
            <option value="product_created">Product Created</option>
            <option value="product_updated">Product Updated</option>
            <option value="product_deleted">Product Deleted</option>
            <option value="shift_opened">Shift Opened</option>
            <option value="shift_closed">Shift Closed</option>
            <option value="cash_drawer_opened">Cash Drawer Opened</option>
            <option value="cash_drawer_closed">Cash Drawer Closed</option>
            <option value="shortcut_updated">Shortcut Updated</option>
            <option value="feature_toggled">Feature Toggled</option>
            <option value="role_created">Role Created</option>
            <option value="role_permissions_updated">Permissions Updated</option>
            <option value="password_reset">Password Reset</option>
          </select>
        </label>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>Action</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="muted small">{formatTimestamp(l.created_at)}</td>
                <td>{l.username ?? '—'}</td>
                <td><span className="badge">{formatAction(l.action)}</span></td>
                <td className="muted small">{l.details ?? '—'}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td colSpan={4} className="muted center">No activity logs found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn-sm" disabled={page === 0} onClick={() => { setPage(page - 1); load((page - 1) * pageSize); }}>
            Previous
          </button>
          <span className="muted small">Page {page + 1} of {totalPages}</span>
          <button className="btn btn-sm" disabled={page >= totalPages - 1} onClick={() => { setPage(page + 1); load((page + 1) * pageSize); }}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
