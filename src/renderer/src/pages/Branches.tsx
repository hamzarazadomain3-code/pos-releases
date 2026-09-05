import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BranchRow } from '../../../shared/types';

export default function Branches() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<BranchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Editor fields
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [isDefault, setIsDefault] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.api.branches.list();
      setRows(data);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setEditingId(null);
    setName(''); setAddress(''); setPhone(''); setEmail('');
    setIsActive(true); setIsDefault(false);
    setEditorOpen(true);
  };

  const openEdit = (b: BranchRow) => {
    setEditingId(b.id);
    setName(b.name);
    setAddress(b.address || '');
    setPhone(b.phone || '');
    setEmail(b.email || '');
    setIsActive(b.is_active === 1);
    setIsDefault(b.is_default === 1);
    setEditorOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setErr('');
    try {
      const input = { name, address, phone, email, is_active: isActive, is_default: isDefault };
      const res = editingId
        ? await window.api.branches.update(editingId, input)
        : await window.api.branches.create(input);
      if (res.ok) {
        setSuccess(editingId ? 'Branch updated' : 'Branch created');
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

  const handleSetCurrent = async (id: number) => {
    const res = await window.api.branches.setCurrent(id);
    if (res.ok) { setSuccess('Current branch updated'); load(); }
    else setErr(res.message || 'Failed');
  };

  const handleDelete = async (id: number) => {
    const res = await window.api.branches.delete(id);
    if (res.ok) { setSuccess('Branch deleted'); load(); }
    else setErr(res.message || 'Delete failed');
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Branches</h1>
        <button className="btn btn-primary" onClick={openNew}>New Branch</button>
      </div>

      {err && <div className="card"><p className="text-warn">{err}</p></div>}
      {success && <div className="card"><p style={{ color: '#16a34a' }}>{success}</p></div>}

      <div className="card">
        {loading ? (
          <p className="muted center pad">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="muted center pad">No branches found.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Address</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Default</th>
                  <th>Current</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} style={{ background: b.is_default ? '#fef3c7' : '' }}>
                    <td><strong>{b.name}</strong></td>
                    <td>{b.address || '—'}</td>
                    <td>{b.phone || '—'}</td>
                    <td>
                      <span style={{
                        padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600,
                        background: b.is_active ? '#dcfce7' : '#fee2e2',
                        color: b.is_active ? '#166534' : '#991b1b',
                      }}>
                        {b.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>{b.is_default === 1 ? '✓' : ''}</td>
                    <td>
                      <button
                        className="btn btn-sm"
                        onClick={() => handleSetCurrent(b.id)}
                        disabled={b.is_default === 1 || b.id === rows.find(r => r.is_default === 1)?.id}
                      >
                        {b.is_default === 1 ? 'Default' : 'Use This'}
                      </button>
                    </td>
                    <td>
                      <div className="row-btns">
                        <button className="btn btn-sm btn-primary" onClick={() => openEdit(b)}>Edit</button>
                        {!b.is_default && (
                          <button className="btn btn-sm" style={{ color: '#b91c1c' }} onClick={() => handleDelete(b.id)}>Delete</button>
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
          <div className="modal" style={{ maxWidth: 520, width: '95%' }} onClick={(e) => e.stopPropagation()}>
            <div className="row-btns" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
              <h2>{editingId ? 'Edit Branch' : 'New Branch'}</h2>
              <button className="btn btn-sm" onClick={() => setEditorOpen(false)}>✕</button>
            </div>

            <div className="form-group">
              <label>Branch Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Main Shop" />
            </div>

            <div className="form-group">
              <label>Address</label>
              <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Phone</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>
                  <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                  Active
                </label>
              </div>
              <div className="form-group">
                <label>
                  <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
                  Default Branch
                </label>
              </div>
            </div>

            <div className="row-btns" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn" onClick={() => setEditorOpen(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={!name || saving} onClick={handleSave}>
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Branch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}