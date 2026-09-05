import { useEffect, useState } from 'react';
import { ModalCloseButton } from '../../components/ModalCloseButton';
import type { AdminRole, RolePermission } from '../../../../shared/types';

const ALL_PERMISSIONS = [
  'view_reports', 'create_users', 'edit_products', 'view_sales',
  'manage_alerts', 'access_settings', 'print_labels', 'manage_shifts',
  'process_returns', 'manage_promotions', 'manage_purchases', 'manage_udhaar',
  'manage_audits', 'access_admin_panel', 'manage_roles', 'view_activity_log',
  'backup_restore', 'manage_expenses', 'manage_categories', 'export_data',
];

const formatPerm = (p: string) => p.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function RolesPermissions() {
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [selectedRole, setSelectedRole] = useState<number | null>(null);
  const [permissions, setPermissions] = useState<RolePermission[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadRoles = async () => {
    try {
      const r = await window.api.admin.roles.getAll();
      setRoles(r);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => { loadRoles(); }, []);

  const selectRole = async (id: number) => {
    setSelectedRole(id);
    try {
      const perms = await window.api.admin.roles.getPermissions(id);
      setPermissions(perms);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  const togglePermission = (permName: string) => {
    setPermissions((prev) => {
      const existing = prev.find((p) => p.permission_name === permName);
      if (existing) {
        return prev.map((p) =>
          p.permission_name === permName ? { ...p, is_allowed: p.is_allowed ? 0 : 1 } : p
        );
      }
      return [...prev, { id: 0, role_id: selectedRole!, permission_name: permName, is_allowed: 1 }];
    });
  };

  const savePermissions = async () => {
    if (!selectedRole) return;
    setBusy(true);
    setNotice(null);
    try {
      await window.api.admin.roles.setPermissions(
        selectedRole,
        permissions.map((p) => ({ permission_name: p.permission_name, is_allowed: !!p.is_allowed }))
      );
      setNotice('Permissions saved');
      setTimeout(() => setNotice(null), 2000);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const createRole = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      await window.api.admin.roles.create(newName.trim(), newDesc.trim() || undefined);
      await loadRoles();
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
      setNotice('Role created');
      setTimeout(() => setNotice(null), 2000);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const deleteRole = async (id: number, name: string) => {
    if (!confirm(`Delete role "${name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await window.api.admin.roles.delete(id);
      await loadRoles();
      if (selectedRole === id) { setSelectedRole(null); setPermissions([]); }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <div className="admin-sub-page">
      <div className="admin-sub-header">
        <h2>Roles & Permissions</h2>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Role</button>
      </div>

      {notice && <div className="notice" onClick={() => setNotice(null)}>{notice}</div>}

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3>Create New Role</h3>
              <ModalCloseButton onClose={() => setShowCreate(false)} />
            </div>
            <label className="field">
              <span>Role Name</span>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
            </label>
            <label className="field">
              <span>Description</span>
              <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
            </label>
            <div className="modal-actions">
              <button className="btn btn-primary" disabled={busy || !newName.trim()} onClick={createRole}>
                {busy ? 'Creating...' : 'Create'}
              </button>
              <button className="btn" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="roles-layout">
        <div className="roles-list">
          {roles.map((r) => (
            <div
              key={r.id}
              className={`role-card ${selectedRole === r.id ? 'active' : ''}`}
              onClick={() => selectRole(r.id)}
            >
              <div className="role-card-header">
                <span className="role-name">{r.name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</span>
                {r.is_system_role ? (
                  <span className="badge">System</span>
                ) : (
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={(e) => { e.stopPropagation(); deleteRole(r.id, r.name); }}
                  >
                    Delete
                  </button>
                )}
              </div>
              {r.description && <p className="muted small">{r.description}</p>}
            </div>
          ))}
        </div>

        <div className="permissions-panel">
          {selectedRole ? (
            <>
              <div className="permissions-header">
                <h3>Permissions: {roles.find((r) => r.id === selectedRole)?.name.replace(/_/g, ' ')}</h3>
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={savePermissions}>
                  {busy ? 'Saving...' : 'Save Permissions'}
                </button>
              </div>
              <div className="permissions-grid">
                {ALL_PERMISSIONS.map((p) => {
                  const perm = permissions.find((pp) => pp.permission_name === p);
                  const allowed = perm ? !!perm.is_allowed : false;
                  return (
                    <label key={p} className={`permission-item ${allowed ? 'allowed' : 'denied'}`}>
                      <input
                        type="checkbox"
                        checked={allowed}
                        onChange={() => togglePermission(p)}
                      />
                      <span>{formatPerm(p)}</span>
                    </label>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="muted center" style={{ padding: 40 }}>
              Select a role to edit permissions
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
