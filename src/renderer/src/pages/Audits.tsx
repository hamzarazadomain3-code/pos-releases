import { useCallback, useEffect, useState } from 'react';
import { ModalCloseButton } from '../components/ModalCloseButton';
import type { AuditItemRow, AuditRow, Category } from '../../../shared/types';
import { DateRangePicker, SearchInput, MultiSelectDropdown, FilterBar, FilterRow, Pagination } from '../components/filters';
import { formatDateTimeAdmin } from '../utils/dateUtils';

export default function Audits() {
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const [active, setActive] = useState<AuditRow[]>([]);
  const [history, setHistory] = useState<AuditRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [users, setUsers] = useState<{ id: number; username: string }[]>([]);
  const [current, setCurrent] = useState<(AuditRow & { items: AuditItemRow[] }) | null>(null);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [onlyUncounted, setOnlyUncounted] = useState(false);
  const [result, setResult] = useState<(AuditRow & { items: AuditItemRow[] }) | null>(null);
  const [detail, setDetail] = useState<(AuditRow & { items: AuditItemRow[] }) | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  // History pagination & filters
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(50);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');
  const [historyUserId, setHistoryUserId] = useState<number | ''>('');
  const [historyStatus, setHistoryStatus] = useState<'in_progress' | 'completed' | ''>('');

  const load = useCallback(async () => {
    try {
      const all = await window.api.audits.list();
      setActive(all.filter((a) => a.status === 'in_progress'));
      setHistory(all.filter((a) => a.status === 'completed'));
      setCategories(await window.api.inventory.categories());
      setUsers((await window.api.users.list()).map(u => ({ id: u.id, username: u.username })));
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await window.api.audits.listPaginated(
        historyPage,
        historyPageSize,
        historyFrom || undefined,
        historyTo || undefined,
        historyUserId || undefined,
        historyStatus || undefined
      );
      setHistory(res.rows);
      setHistoryTotal(res.total);
    } catch (e) {
      setErr(String(e));
    }
  }, [historyPage, historyPageSize, historyFrom, historyTo, historyUserId, historyStatus]);

  useEffect(() => {
    load();
    loadHistory();
  }, [load, loadHistory]);

  const seedCounts = (audit: AuditRow & { items: AuditItemRow[] }) => {
    const map: Record<number, string> = {};
    for (const it of audit.items) {
      if (it.counted_qty !== null) map[it.product_id] = String(it.counted_qty);
    }
    setCounts(map);
  };

  const startAudit = async () => {
    try {
      setErr('');
      const a = await window.api.audits.create();
      const full = await window.api.audits.get(a.id);
      if (full) {
        setCurrent(full);
        seedCounts(full);
        setSearch('');
        setCatFilter('');
        setOnlyUncounted(false);
      }
      await load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const openAudit = async (id: number) => {
    try {
      setErr('');
      const full = await window.api.audits.get(id);
      if (full) {
        setCurrent(full);
        seedCounts(full);
        setSearch('');
        setCatFilter('');
        setOnlyUncounted(false);
      }
    } catch (e) {
      setErr(String(e));
    }
  };

  const saveProgress = async () => {
    if (!current) return;
    try {
      setErr('');
      setMsg('');
      const dirty = Object.entries(counts)
        .filter(([, v]) => v.trim() !== '' && !isNaN(Number(v)))
        .map(([pid, v]) => ({ product_id: Number(pid), counted_qty: Number(v) }));
      await window.api.audits.saveCounts(current.id, dirty);
      const fresh = await window.api.audits.get(current.id);
      if (fresh) {
        setCurrent(fresh);
        seedCounts(fresh);
      }
      setMsg('Progress saved — you can continue later');
      await load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const complete = async () => {
    if (!current) return;
    if (!window.confirm('Complete this audit? Stock will be adjusted to the counted quantities.')) return;
    try {
      setErr('');
      const done = await window.api.audits.complete(current.id);
      setResult(done);
      setCurrent(null);
      setMsg('');
      await load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const openDetail = async (id: number) => {
    try {
      setErr('');
      const full = await window.api.audits.get(id);
      if (full) setDetail(full);
    } catch (e) {
      setErr(String(e));
    }
  };

  const countedCount = Object.values(counts).filter((v) => v.trim() !== '').length;
  const totalCount = current ? current.items.length : 0;

  const visible = current
    ? current.items.filter((i) => {
        const s = search.trim().toLowerCase();
        if (s) {
          const name = (i.product_name ?? '').toLowerCase();
          const bc = (i.barcode ?? '').toLowerCase();
          if (!name.includes(s) && !bc.includes(s)) return false;
        }
        if (catFilter && (i.category_name ?? '') !== catFilter) return false;
        if (onlyUncounted) {
          const v = counts[i.product_id];
          if (v !== undefined && v.trim() !== '') return false;
        }
        return true;
      })
    : [];

  const varianceOf = (it: AuditItemRow): number | null => {
    const v = counts[it.product_id];
    if (v === undefined || v.trim() === '' || isNaN(Number(v))) return null;
    return Number(v) - it.system_qty;
  };

  const previewVariance = current
    ? visible.reduce((s, it) => s + (varianceOf(it) ?? 0), 0)
    : 0;

  const overage = (items: AuditItemRow[]) =>
    items.reduce((s, i) => s + (i.variance > 0 ? i.variance : 0), 0);
  const shortage = (items: AuditItemRow[]) =>
    items.reduce((s, i) => s + (i.variance < 0 ? i.variance : 0), 0);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Stock Audit</h1>
        <div className="tabs">
          <button className={`tab-btn ${tab === 'active' ? 'active' : ''}`} onClick={() => setTab('active')}>
            Audits
          </button>
          <button className={`tab-btn ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
            History
          </button>
        </div>
      </div>

      {err && (
        <div className="notice error">
          {err} <button className="btn btn-sm" onClick={() => setErr('')}>OK</button>
        </div>
      )}
      {msg && (
        <div className="notice" style={{ background: '#dcfce7', color: '#166534', borderColor: '#bbf7d0', cursor: 'default' }}>
          {msg}
        </div>
      )}

      {tab === 'history' && (
        <div className="card">
          <FilterBar
            onClear={() => {
              setHistoryFrom('');
              setHistoryTo('');
              setHistoryUserId('');
              setHistoryStatus('');
              setHistoryPage(1);
            }}
            onApply={loadHistory}
          >
            <FilterRow>
              <DateRangePicker
                from={historyFrom}
                to={historyTo}
                onChange={(from: string, to: string) => { setHistoryFrom(from); setHistoryTo(to); setHistoryPage(1); }}
                labelFrom="From"
                labelTo="To"
              />
              <select
                className="field-select"
                value={historyUserId}
                onChange={(e) => { setHistoryUserId(e.target.value ? Number(e.target.value) : ''); setHistoryPage(1); }}
                style={{ width: '180px' }}
              >
                <option value="">All Users</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.username}</option>
                ))}
              </select>
              <select
                className="field-select"
                value={historyStatus}
                onChange={(e) => { setHistoryStatus(e.target.value as any); setHistoryPage(1); }}
                style={{ width: '140px' }}
              >
                <option value="">All Status</option>
                <option value="completed">Completed</option>
                <option value="in_progress">In Progress</option>
              </select>
            </FilterRow>
            <FilterRow style={{ justifyContent: 'flex-end' }}>
              <select
                className="field-select"
                value={historyPageSize}
                onChange={(e) => { setHistoryPageSize(Number(e.target.value)); setHistoryPage(1); }}
                style={{ width: '120px' }}
              >
                <option value="10">10 per page</option>
                <option value="25">25 per page</option>
                <option value="50">50 per page</option>
                <option value="100">100 per page</option>
              </select>
            </FilterRow>
          </FilterBar>
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Date</th>
                <th>By</th>
                <th>Items Counted</th>
                <th>Overage</th>
                <th>Shortage</th>
                <th>Net Variance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {history.map((a) => (
                  <tr key={a.id}>
                    <td>AU-{String(a.id).padStart(4, '0')}</td>
                    <td>{a.completed_at ? formatDateTimeAdmin(a.completed_at) : '—'}</td>
                    <td>{a.username ?? '—'}</td>
                    <td>{a.total_items}</td>
                    <td className="text-ok">+{(a.overage ?? 0).toFixed(2)}</td>
                    <td className="text-warn">{(a.shortage ?? 0).toFixed(2)}</td>
                    <td>{a.total_variance.toFixed(2)}</td>
                    <td>
                      <button className="btn btn-sm" onClick={() => openDetail(a.id)}>
                        View Detail
                      </button>
                    </td>
                  </tr>
                ))}
              {!history.length && (
                <tr>
                  <td colSpan={8} className="muted">
                    No completed audits yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <Pagination
            currentPage={historyPage}
            pageSize={historyPageSize}
            totalItems={historyTotal}
            onPageChange={setHistoryPage}
            onPageSizeChange={setHistoryPageSize}
          />
        </div>
      )}

      {tab === 'active' && !current && (
        <>
          <div className="card">
            <div className="card-head">
              <h2>Active Audits</h2>
              <button className="btn btn-primary" onClick={startAudit}>
                Start New Audit
              </button>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Started</th>
                  <th>By</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {active.map((a) => (
                  <tr key={a.id}>
                    <td>AU-{String(a.id).padStart(4, '0')}</td>
                    <td>{a.created_at ? formatDateTimeAdmin(a.created_at) : '—'}</td>
                    <td>{a.username ?? '—'}</td>
                    <td>
                      <button className="btn btn-sm btn-primary" onClick={() => openAudit(a.id)}>
                        Continue
                      </button>
                    </td>
                  </tr>
                ))}
                {!active.length && (
                  <tr>
                    <td colSpan={4} className="muted">
                      No active audits — start one to begin counting.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'active' && current && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>
                Audit AU-{String(current.id).padStart(4, '0')} — {current.username ?? ''}
              </h2>
              <p className="muted small">
                Started {formatDateTimeAdmin(current.created_at ?? '')} | Counted{' '}
                <strong>{countedCount}</strong> / {totalCount} items
              </p>
            </div>
            <div className="row-btns" style={{ marginTop: 0 }}>
              <button className="btn" onClick={saveProgress}>
                Save Progress
              </button>
              <button className="btn btn-primary" onClick={complete}>
                Complete Audit
              </button>
              <button className="btn" onClick={() => setCurrent(null)}>
                Exit
              </button>
            </div>
          </div>

          <div className="toolbar" style={{ marginBottom: 12 }}>
            <input
              className="search-input"
              placeholder="Search product or barcode…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className="inp" style={{ width: 180 }} value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
            <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={onlyUncounted} onChange={(e) => setOnlyUncounted(e.target.checked)} />
              Only uncounted
            </label>
            <span className="total-bar" style={{ marginLeft: 'auto', padding: 0 }}>
              Visible variance: <strong className={previewVariance > 0 ? 'text-ok' : previewVariance < 0 ? 'text-warn' : ''}>{previewVariance.toFixed(2)}</strong>
            </span>
          </div>

          <table className="tbl">
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th style={{ width: 100 }}>System</th>
                <th style={{ width: 120 }}>Counted</th>
                <th style={{ width: 110 }}>Variance</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((it) => {
                const v = varianceOf(it);
                return (
                  <tr key={it.product_id}>
                    <td>
                      {it.product_name ?? `#${it.product_id}`}
                      <div className="small muted">{it.barcode ?? ''}</div>
                    </td>
                    <td>{it.category_name ?? '—'}</td>
                    <td>{it.system_qty}</td>
                    <td>
                      <input
                        className="inp"
                        type="number"
                        min="0"
                        step="1"
                        value={counts[it.product_id] ?? ''}
                        placeholder={it.counted_qty !== null ? String(it.counted_qty) : ''}
                        onChange={(e) => setCounts({ ...counts, [it.product_id]: e.target.value })}
                      />
                    </td>
                    <td>
                      {v === null ? (
                        <span className="muted">—</span>
                      ) : v > 0 ? (
                        <span className="text-ok">+{v.toFixed(2)}</span>
                      ) : v < 0 ? (
                        <span className="text-warn">{v.toFixed(2)}</span>
                      ) : (
                        <span className="muted">0</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!visible.length && (
                <tr>
                  <td colSpan={5} className="muted">
                    No products match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {result && (
        <div className="modal-overlay">
          <div className="modal modal-wide">
            <div className="modal-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2>Audit AU-{String(result.id).padStart(4, '0')} Completed</h2>
              <ModalCloseButton onClose={() => setResult(null)} />
            </div>
            <p className="muted small">
              {result.completed_at ? formatDateTimeAdmin(result.completed_at) : ''} | by {result.username ?? '—'} |{' '}
              {result.total_items} items counted
            </p>
            <div className="stat-grid" style={{ marginTop: 12 }}>
              <div className="stat-card">
                <div className="stat-label">Overage</div>
                <div className="stat-value text-ok">+{overage(result.items).toFixed(2)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Shortage</div>
                <div className="stat-value text-warn">{shortage(result.items).toFixed(2)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Net Variance</div>
                <div className="stat-value">{result.total_variance.toFixed(2)}</div>
              </div>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>System</th>
                  <th>Counted</th>
                  <th>Variance</th>
                </tr>
              </thead>
              <tbody>
                {result.items
                  .filter((i) => i.counted_qty !== null)
                  .map((i) => (
                    <tr key={i.id}>
                      <td>{i.product_name ?? `#${i.product_id}`}</td>
                      <td>{i.system_qty}</td>
                      <td>{i.counted_qty}</td>
                      <td className={i.variance > 0 ? 'text-ok' : i.variance < 0 ? 'text-warn' : 'muted'}>
                        {i.variance > 0 ? '+' : ''}
                        {i.variance.toFixed(2)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <div className="row-btns">
              <button className="btn btn-primary" onClick={() => setResult(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div className="modal-overlay">
          <div className="modal modal-wide">
            <div className="modal-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2>Audit AU-{String(detail.id).padStart(4, '0')}</h2>
              <ModalCloseButton onClose={() => setDetail(null)} />
            </div>
            <p className="muted small">
              {detail.completed_at ? formatDateTimeAdmin(detail.completed_at) : ''} | by {detail.username ?? '—'} |{' '}
              {detail.total_items} items counted | net variance {detail.total_variance.toFixed(2)}
            </p>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>System</th>
                  <th>Counted</th>
                  <th>Variance</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.product_name ?? `#${i.product_id}`}</td>
                    <td>{i.system_qty}</td>
                    <td>{i.counted_qty === null ? '—' : i.counted_qty}</td>
                    <td className={i.variance > 0 ? 'text-ok' : i.variance < 0 ? 'text-warn' : 'muted'}>
                      {i.variance > 0 ? '+' : ''}
                      {i.variance.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row-btns">
              <button className="btn" onClick={() => setDetail(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}