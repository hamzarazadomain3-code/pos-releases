import { useCallback, useEffect, useState } from 'react';
import type { InvoiceTemplateRow, TemplateConfig } from '../../../shared/types';
import { DEFAULT_TEMPLATE_CONFIG, parseTemplateConfig } from '../../../shared/invoiceTemplateConfig';
import { Modal } from '../components/Modal';
import { KeyboardInput } from '../components/KeyboardInput';
import { Field } from '../components/Field';
import { InvoiceTemplatePreview } from '../components/InvoiceTemplatePreview';
import { useListKeyboard } from '../hooks/useListKeyboard';
import { useKeyboardScope } from '../hooks/useKeyboardScope';

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
  const [baseConfig, setBaseConfig] = useState<TemplateConfig>(DEFAULT_TEMPLATE_CONFIG);
  const [previewTemplate, setPreviewTemplate] = useState<InvoiceTemplateRow | null>(null);
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
    setFontSize(DEFAULT_TEMPLATE_CONFIG.fontSize);
    setPrimaryColor(DEFAULT_TEMPLATE_CONFIG.primaryColor);
    setFooterText(DEFAULT_TEMPLATE_CONFIG.footerText);
    setBaseConfig(DEFAULT_TEMPLATE_CONFIG);
    setEditorOpen(true);
  };

  const openEdit = (t: InvoiceTemplateRow) => {
    setEditingId(t.id);
    setName(t.name);
    setType(t.type);
    setPaperSize(t.paper_size);
    const cfg = parseTemplateConfig(t.config_json);
    setBaseConfig(cfg);
    setFontSize(cfg.fontSize || 12);
    setPrimaryColor(cfg.primaryColor || '#DC3545');
    setFooterText(cfg.footerText || '');
    setEditorOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setErr('');
    try {
      // Keep every loaded toggle (logo, address, bold flags, …) instead of
      // resetting the template to defaults on each save.
      const config: TemplateConfig = {
        ...baseConfig,
        fontSize,
        primaryColor,
        footerText,
        headerLines: baseConfig.headerLines ?? [],
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

  // ── Keyboard: arrow through templates; Enter edits; Delete removes ──
  const templateList = useListKeyboard({
    count: templates.length,
    onOpen: (i) => { const t = templates[i]; if (t) openEdit(t); },
    onDelete: (i) => { const t = templates[i]; if (t) handleDelete(t.id); },
  });

  useKeyboardScope({
    kind: 'page',
    label: 'Invoice Templates',
    actions: {
      new_record: () => openNew(),
      save: () => { if (editorOpen) handleSave(); },
    },
    shortcuts: [
      { action: 'new_record', label: 'New template' },
      { keys: '↑ / ↓', label: 'Move between templates' },
      { keys: 'Enter', label: 'Edit highlighted template' },
      { keys: 'Delete', label: 'Delete highlighted template' },
    ],
  });

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
          <div style={{ overflowX: 'auto' }} {...templateList.getContainerProps()}>
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
                {templates.map((t, i) => (
                  <tr key={t.id} {...templateList.getRowProps(i)}>
                    <td><strong>{t.name}</strong></td>
                    <td>{TYPE_LABELS[t.type] || t.type}</td>
                    <td>{t.paper_size}</td>
                    <td>{t.is_default ? '✓' : ''}</td>
                    <td>
                      <div className="row-btns">
                        <button className="btn btn-sm btn-primary" onClick={() => openEdit(t)}>Edit</button>
                        <button className="btn btn-sm" onClick={() => setPreviewTemplate(t)}>Preview</button>
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
        <Modal
          onClose={() => setEditorOpen(false)}
          onSubmit={handleSave}
          title={editingId ? 'Edit Template' : 'New Template'}
          style={{ maxWidth: 520, width: '95%' }}
          label="Invoice Template"
          shortcuts={[{ action: 'save', label: 'Save template' }]}
        >

            <Field label="Template Name" required>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main Sale Receipt" />
            </Field>

            <div className="form-row">
              <Field label="Document Type">
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  {Object.entries(TYPE_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </Field>
              <Field label="Paper Size">
                <select value={paperSize} onChange={(e) => setPaperSize(e.target.value)}>
                  {PAPER_SIZES.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="form-row">
              <Field label="Primary Color">
                <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
              </Field>
              <Field label="Font Size (px)">
                <KeyboardInput type="text" decimals={false} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} />
              </Field>
            </div>

            <Field label="Footer Text">
              <input value={footerText} onChange={(e) => setFooterText(e.target.value)} />
            </Field>

            {/* Preview (shared component; honours every persisted config flag) */}
            <InvoiceTemplatePreview
              config={{ ...baseConfig, fontSize, primaryColor, footerText }}
              style={{ marginTop: 12 }}
            />

            <div className="row-btns" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn" onClick={() => setEditorOpen(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={!name || saving} onClick={handleSave}>
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Template'}
              </button>
            </div>
        </Modal>
      )}

      {previewTemplate && (
        <Modal
          onClose={() => setPreviewTemplate(null)}
          title={`Preview: ${previewTemplate.name}`}
          style={{ maxWidth: 560, width: '95%' }}
        >
          <InvoiceTemplatePreview config={parseTemplateConfig(previewTemplate.config_json)} />
        </Modal>
      )}
    </div>
  );
}
