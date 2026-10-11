import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CustomReportRow, ReportScheduleRow } from '../../../shared/types';
import { formatDateAdmin } from '../utils/dateUtils';
import { Modal } from '../components/Modal';
import { KeyboardInput } from '../components/KeyboardInput';
import { useListKeyboard } from '../hooks/useListKeyboard';
import { useKeyboardScope } from '../hooks/useKeyboardScope';

export default function CustomReports() {
  const { t } = useTranslation();
  const [reports, setReports] = useState<CustomReportRow[]>([]);
  const [schedules, setSchedules] = useState<ReportScheduleRow[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'reports' | 'schedules'>('reports');
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');

  // Report form
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formTable, setFormTable] = useState('');
  const [formColumns, setFormColumns] = useState<string[]>([]);
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [formLimit, setFormLimit] = useState('100');
  const [formPublic, setFormPublic] = useState(false);

  // Preview
  const [previewData, setPreviewData] = useState<{ columns: string[]; rows: any[][] } | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, s, t] = await Promise.all([
        window.api.customReports.list(),
        window.api.customReports.schedules(),
        window.api.customReports.tables(),
      ]);
      setReports(r);
      setSchedules(s);
      setTables(t);
    } catch (e) { setErr(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (err || success) { const t = setTimeout(() => { setErr(''); setSuccess(''); }, 3000); return () => clearTimeout(t); }
  }, [err, success]);

  useEffect(() => {
    if (formTable) {
      window.api.customReports.schema(formTable).then((cols) => {
        setAvailableColumns(cols || []);
      });
    }
  }, [formTable]);

  const resetForm = () => {
    setFormOpen(false); setEditId(null); setFormName(''); setFormDesc('');
    setFormTable(''); setFormColumns([]); setFormLimit('100'); setFormPublic(false);
  };

  const openEdit = (r: CustomReportRow) => {
    setFormOpen(true); setEditId(r.id); setFormName(r.name); setFormDesc(r.description || '');
    setFormTable(r.base_table); setFormColumns(JSON.parse(r.columns_json || '[]'));
    setFormLimit(String(r.limit_rows || 100)); setFormPublic(!!r.is_public);
  };

  const toggleColumn = (col: string) => {
    setFormColumns((prev) => prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]);
  };

  const saveReport = async () => {
    if (!formName || !formTable || formColumns.length === 0) return;
    const payload = {
      name: formName, description: formDesc, base_table: formTable,
      columns_json: JSON.stringify(formColumns),
      limit_rows: parseInt(formLimit) || 100, is_public: formPublic,
    };
    const res = editId
      ? await window.api.customReports.update(editId, payload)
      : await window.api.customReports.create(payload);
    if (res.ok) { setSuccess(editId ? 'Report updated' : 'Report created'); resetForm(); load(); }
    else setErr(res.message || 'Error');
  };

  const deleteReport = async (id: number) => {
    if (!confirm('Delete this report?')) return;
    const res = await window.api.customReports.delete(id);
    if (res.ok) { setSuccess('Deleted'); load(); } else setErr(res.message || 'Error');
  };

  const previewReport = async (id: number) => {
    try {
      const data = await window.api.customReports.execute(id, 50);
      setPreviewData(data);
      setPreviewId(id);
    } catch (e) { setErr(String(e)); }
  };

  // ── Keyboard: arrow through reports; Enter runs; Delete removes ──
  const reportList = useListKeyboard({
    count: reports.length,
    onOpen: (i) => { const r = reports[i]; if (r) previewReport(r.id); },
    onDelete: (i) => { const r = reports[i]; if (r) deleteReport(r.id); },
  });

  const scheduleList = useListKeyboard({ count: schedules.length });

  useKeyboardScope({
    kind: 'page',
    label: 'Custom Reports',
    actions: {
      new_record: () => { resetForm(); setFormOpen(true); },
      save: () => { if (formOpen) saveReport(); },
    },
    shortcuts: [
      { action: 'new_record', label: 'New report' },
      { keys: '↑ / ↓', label: 'Move between rows' },
      { keys: 'Enter', label: 'Run highlighted report' },
      { keys: 'Delete', label: 'Delete highlighted report' },
    ],
  });

  return (
    <div className="page">
      <div className="page-header">
        <h1>Custom Reports</h1>
        <div className="row-btns">
          <button className="btn btn-primary" onClick={() => { resetForm(); setFormOpen(true); }}>+ New Report</button>
        </div>
      </div>

      {err && <div className="notice" style={{ color: 'var(--danger)' }}>{err}</div>}
      {success && <div className="notice" style={{ color: 'var(--ok)' }}>{success}</div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className={`btn btn-sm ${tab === 'reports' ? 'btn-primary' : ''}`} onClick={() => { setTab('reports'); setPreviewData(null); }}>Reports</button>
        <button className={`btn btn-sm ${tab === 'schedules' ? 'btn-primary' : ''}`} onClick={() => setTab('schedules')}>Schedules</button>
      </div>

      {/* Report form modal */}
      {formOpen && (
        <Modal
          onClose={() => resetForm()}
          onSubmit={saveReport}
          title={editId ? 'Edit Report' : 'New Report'}
          style={{ maxWidth: 600 }}
          label="Custom Report"
          shortcuts={[{ action: 'save', label: 'Save report' }]}
        >
          <div className="modal-content">
            <div className="form-group">
              <label>Report Name</label>
              <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Monthly Sales Summary" />
            </div>
            <div className="form-group">
              <label>Description</label>
              <input value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="Optional description" />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Base Table</label>
                <select value={formTable} onChange={(e) => { setFormTable(e.target.value); setFormColumns([]); }}>
                  <option value="">Select table...</option>
                  {tables.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Row Limit</label>
                <KeyboardInput type="text" decimals={false} value={formLimit} onChange={(e) => setFormLimit(e.target.value)} />
              </div>
            </div>
            {availableColumns.length > 0 && (
              <div className="form-group">
                <label>Columns</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {availableColumns.map((col) => (
                    <button
                      key={col}
                      className={`btn btn-sm ${formColumns.includes(col) ? 'btn-primary' : ''}`}
                      onClick={() => toggleColumn(col)}
                      type="button"
                    >
                      {col}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="form-group">
              <label>
                <input type="checkbox" checked={formPublic} onChange={(e) => setFormPublic(e.target.checked)} /> Public (visible to all users)
              </label>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={resetForm}>Cancel</button>
            <button className="btn btn-primary" onClick={saveReport}>{editId ? 'Update' : 'Create'}</button>
          </div>
        </Modal>
      )}

      {/* Preview modal */}
      {previewData && (
        <Modal
          onClose={() => setPreviewData(null)}
          title="Report Preview"
          style={{ maxWidth: '90vw' }}
          label="Report Preview"
        >
          <div className="modal-content" style={{ overflow: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>{previewData.columns.map((c) => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {previewData.rows.map((row, i) => (
                  <tr key={i}>{row.map((cell, j) => <td key={j}>{cell === null ? '-' : String(cell)}</td>)}</tr>
                ))}
              </tbody>
            </table>
            <div className="muted small" style={{ marginTop: 8 }}>{previewData.rows.length} rows returned</div>
          </div>
        </Modal>
      )}

      {/* Table */}
      {loading ? <div className="muted center">Loading...</div> : tab === 'reports' ? (
        <div {...reportList.getContainerProps()}>
          <table className="data-table">
            <thead>
              <tr><th>Name</th><th>Table</th><th>Columns</th><th>Public</th><th>Created</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {reports.length === 0 && <tr><td colSpan={6} className="center muted">No reports created yet</td></tr>}
              {reports.map((r, i) => (
                <tr key={r.id} {...reportList.getRowProps(i)}>
                  <td>{r.name}</td>
                  <td><span className="badge">{r.base_table}</span></td>
                  <td className="small muted">{JSON.parse(r.columns_json || '[]').length} cols</td>
                  <td>{r.is_public ? '✓' : ''}</td>
                  <td className="muted small">{formatDateAdmin(r.created_at)}</td>
                  <td>
                    <button className="btn btn-sm" onClick={() => previewReport(r.id)}>Run</button>{' '}
                    <button className="btn btn-sm" onClick={() => openEdit(r)}>Edit</button>{' '}
                    <button className="btn btn-sm btn-danger" onClick={() => deleteReport(r.id)}>Del</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div {...scheduleList.getContainerProps()}>
          <table className="data-table">
            <thead>
              <tr><th>Report</th><th>Frequency</th><th>Format</th><th>Active</th><th>Last Run</th></tr>
            </thead>
            <tbody>
              {schedules.length === 0 && <tr><td colSpan={5} className="center muted">No schedules configured</td></tr>}
              {schedules.map((s, i) => (
                <tr key={s.id} {...scheduleList.getRowProps(i)}>
                  <td>{s.report_name || `Report #${s.report_id}`}</td>
                  <td>{s.frequency}</td>
                  <td><span className="badge">{s.format?.toUpperCase()}</span></td>
                  <td>{s.is_active ? '✓' : ''}</td>
                  <td className="muted small">{s.last_run ? formatDateAdmin(s.last_run) : 'Never'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
