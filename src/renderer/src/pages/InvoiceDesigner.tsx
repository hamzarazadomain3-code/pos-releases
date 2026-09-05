import { useCallback, useEffect, useState } from 'react';
import type { InvoiceTemplateRow } from '../../../shared/types';
import { formatDateAdmin } from '../utils/dateUtils';

const TYPE_LABELS: Record<string, string> = {
  sale: 'Sale Invoice', purchase: 'Purchase Order', quotation: 'Quotation',
  payment: 'Payment Receipt', return: 'Return Invoice',
};

const PAPER_SIZES = [
  { value: 'a4', label: 'A4 (210×297mm)' },
  { value: 'a5', label: 'A5 (148×210mm)' },
  { value: 'thermal58', label: 'Thermal 58mm' },
  { value: 'thermal80', label: 'Thermal 80mm' },
];

export default function InvoiceDesigner() {
  const [templates, setTemplates] = useState<InvoiceTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  // Editor fields
  const [name, setName] = useState('');
  const [type, setType] = useState('sale');
  const [paperSize, setPaperSize] = useState('a4');
  const [fontSize, setFontSize] = useState(12);
  const [primaryColor, setPrimaryColor] = useState('#DC3545');
  const [footerText, setFooterText] = useState('Thank you for your business!');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.api.templates.list();
      setTemplates(data);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setEditingId(null);
    setName('');
    setType('sale');
    setPaperSize('a4');
    setEditorOpen(true);
  };

  const openEdit = (t: InvoiceTemplateRow) => {
    setEditingId(t.id);
    setName(t.name);
    setType(t.type);
    setPaperSize(t.paper_size);
    try {
      const cfg = JSON.parse(t.config_json);
      setFontSize(cfg.fontSize || 12);
      setPrimaryColor(cfg.primaryColor || '#DC3545');
      setFooterText(cfg.footerText || '');
    } catch { /* use defaults */ }
    setEditorOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setErr('');
    try {
      const config = {
        showLogo: true, showShopName: true, showShopAddress: true, showShopPhone: true,
        showInvoiceNo: true, showDate: true, showCustomer: true, showItemsTable: true,
        showTotals: true, showPaymentInfo: true, showFooter: true,
        boldInvoiceNo: true, boldTotal: true, boldGrandTotal: true,
        fontSize, primaryColor, footerText, headerLines: [],
      };
      const input = { name, type, paper_size: paperSize, config, is_default: false };
      const res = editingId
        ? await window.api.templates.update(editingId, input)
        : await window.api.templates.create(input);
      if (res.ok) {
        setSuccess(editingId ? 'Template updated' : 'Template created');
        setEditorOpen(false);
        load();
      } else {
        setErr(res.message || 'Save failed');
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (t: InvoiceTemplateRow) => {
    const res = await window.api.templates.update(t.id, { is_default: true });
    if (res.ok) { setSuccess(`"${t.name}" is now default for ${TYPE_LABELS[t.type] || t.type}`); load(); }
    else setErr(res.message || 'Failed');
  };

  const handleDelete = async (id: number) => {
    const res = await window.api.templates.delete(id);
    if (res.ok) { setSuccess('Template deleted'); load(); }
    else setErr(res.message || 'Delete failed');
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Invoice Templates</h1>
        <button className="btn btn-primary" onClick={openNew}>New Template</button>
      </div>

      {err && <div className="card"><p className="text-warn">{err}</p></div>}
      {success && <div className="card"><p style={{ color: '#16a34a' }}>{success}</p></div>}

      <div className="card">
        {loading ? (
          <p className="muted center pad">Loading…</p>
        ) : templates.length === 0 ? (
          <p className="muted center pad">No templates found.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Paper</th>
                  <th>Default</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id}>
                    <td><strong>{t.name}</strong></td>
                    <td>{TYPE_LABELS[t.type] || t.type}</td>
                    <td>{t.paper_size}</td>
                    <td>{t.is_default ? '✓' : ''}</td>
                    <td>
                      <div className="row-btns">
                        <button className="btn btn-sm btn-primary" onClick={() => openEdit(t)}>Edit</button>
                        {!t.is_default && (
                          <button className="btn btn-sm" onClick={() => handleSetDefault(t)}>Set Default</button>
                        )}
                        <button className="btn btn-sm" style={{ color: '#b91c1c' }} onClick={() => handleDelete(t.id)}>Delete</button>
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
          <div className="modal" style={{ maxWidth: 520, width: '95%' }} onClick={(e) => e.stopPropagation()}>
            <div className="row-btns" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
              <h2>{editingId ? 'Edit Template' : 'New Template'}</h2>
              <button className="btn btn-sm" onClick={() => setEditorOpen(false)}>✕</button>
            </div>

            <div className="form-group">
              <label>Template Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main Sale Receipt" />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Document Type</label>
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  {Object.entries(TYPE_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Paper Size</label>
                <select value={paperSize} onChange={(e) => setPaperSize(e.target.value)}>
                  {PAPER_SIZES.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Primary Color</label>
                <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Font Size (px)</label>
                <input type="number" min="8" max="24" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} />
              </div>
            </div>

            <div className="form-group">
              <label>Footer Text</label>
              <input value={footerText} onChange={(e) => setFooterText(e.target.value)} />
            </div>

            {/* Preview */}
            <div style={{
              border: '1px solid #ddd', borderRadius: 8, padding: 16, marginTop: 12,
              fontFamily: 'monospace', fontSize, background: '#fafafa',
            }}>
              <div style={{ color: primaryColor, fontWeight: 'bold', fontSize: fontSize + 4, marginBottom: 8 }}>
                ShopKeeper POS
              </div>
              <div style={{ fontSize: fontSize - 2, color: '#666', marginBottom: 8 }}>
                Shop Address • Phone
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid #ddd', margin: '8px 0' }} />
              <div style={{ marginBottom: 4 }}>Invoice #: INV-001</div>
              <div style={{ marginBottom: 8 }}>Date: {formatDateAdmin(new Date().toISOString())}</div>
              <table style={{ width: '100%', fontSize: fontSize - 2 }}>
                <tbody>
                  <tr><td>Sample Product</td><td style={{ textAlign: 'right' }}>2 × 500</td><td style={{ textAlign: 'right' }}>1,000</td></tr>
                </tbody>
              </table>
              <hr style={{ border: 'none', borderTop: '1px solid #ddd', margin: '8px 0' }} />
              <div style={{ fontWeight: 'bold', color: primaryColor }}>Total: 1,000</div>
              {footerText && (
                <div style={{ marginTop: 12, fontSize: fontSize - 2, color: '#888', textAlign: 'center' }}>
                  {footerText}
                </div>
              )}
            </div>

            <div className="row-btns" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn" onClick={() => setEditorOpen(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={!name || saving} onClick={handleSave}>
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
