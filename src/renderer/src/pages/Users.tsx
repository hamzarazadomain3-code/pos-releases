import { useCallback, useEffect, useState } from 'react';
import { ModalCloseButton } from '../components/ModalCloseButton';
import type { UserInput, UserRole, UserRow } from '../../../shared/types';

export default function Users() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [modal, setModal] = useState<null | { mode: 'add' } | { mode: 'edit'; user: UserRow }>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState<UserRole>('cashier');
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setUsers(await window.api.users.list());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openAdd = () => {
    setUsername('');
    setPassword('');
    setPin('');
    setRole('cashier');
    setErr('');
    setModal({ mode: 'add' });
  };

  const openEdit = (u: UserRow) => {
    setUsername(u.username);
    setPassword('');
    setPin('');
    setRole(u.role);
    setErr('');
    setModal({ mode: 'edit', user: u });
  };

  const submit = async () => {
    try {
      if (modal?.mode === 'add') {
        const input: UserInput = { username, role, password: password || undefined, pin: pin || undefined };
        await window.api.users.create(input);
        setSuccess(`User "${username}" created`);
      } else if (modal && modal.mode === 'edit') {
        const changes: { password?: string; pin?: string; role?: UserRole } = {};
        if (password) changes.password = password;
        if (pin) changes.pin = pin;
        if (role !== modal.user.role) changes.role = role;
        await window.api.users.update(modal.user.id, changes);
        setSuccess(`User "${modal.user.username}" updated`);
      }
      setModal(null);
      await load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const toggleActive = async (u: UserRow) => {
    try {
      await window.api.users.update(u.id, { active: u.active === 1 ? false : true });
      await load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const remove = async (u: UserRow) => {
    if (!window.confirm(`Delete user "${u.username}"?`)) return;
    try {
      await window.api.users.remove(u.id);
      setSuccess(`User "${u.username}" deleted`);
      await load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const roleLabel = (r: string) =>
    r === 'owner' ? 'Owner' : r === 'manager' ? 'Manager' : 'Cashier';

  return (
    <div className="page">
      <div className="page-head">
        <h1>Users & Roles</h1>
      </div>

      {err && (
        <div className="notice error">
          {err} <button className="btn btn-sm" onClick={() => setErr('')}>OK</button>
        </div>
      )}
      {success && (
        <div className="notice">
          {success} <button className="btn btn-sm" onClick={() => setSuccess('')}>OK</button>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>Staff Accounts</h2>
          <button className="btn btn-primary" onClick={openAdd}>
            Add User
          </button>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.active === 1 ? '' : 'muted'}>
                <td>
                  {u.username}
                  {u.role === 'owner' && <span className="badge badge-warn" style={{ marginLeft: 8 }}>Owner</span>}
                </td>
                <td>{roleLabel(u.role)}</td>
                <td>{u.active === 1 ? 'Active' : 'Disabled'}</td>
                <td>
                  <div className="row-actions">
                    <button className="btn btn-sm" onClick={() => openEdit(u)}>
                      Edit / Reset
                    </button>
                    {u.role !== 'owner' && (
                      <button className="btn btn-sm" onClick={() => toggleActive(u)}>
                        {u.active === 1 ? 'Disable' : 'Enable'}
                      </button>
                    )}
                    {u.role !== 'owner' && (
                      <button className="btn btn-sm btn-danger" onClick={() => remove(u)}>
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small" style={{ marginTop: 12 }}>
          Owner: full access (settings, users, reports, everything). Manager: inventory, purchases, udhaar, returns & reports.
          Cashier: billing only — PIN login for fast counter switching.
        </p>
      </div>

      {modal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2>{modal.mode === 'add' ? 'Add User' : `Edit — ${modal.user.username}`}</h2>
              <ModalCloseButton onClose={() => setModal(null)} />
            </div>
            {modal.mode === 'add' && (
              <>
                <label className="lbl">Username *</label>
                <input className="inp" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
              </>
            )}
            <label className="lbl">Role *</label>
            <select className="inp" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              <option value="cashier">Cashier (billing only, PIN login)</option>
              <option value="manager">Manager (inventory + reports)</option>
              <option value="owner">Owner (full access)</option>
            </select>
            {modal.mode === 'edit' && (
              <label className="lbl">
                Username: <strong>{modal.user.username}</strong>
              </label>
            )}
            <label className="lbl">
              {modal.mode === 'edit' ? 'New password (leave blank to keep)' : 'Password'} {role === 'cashier' ? '(optional if PIN set)' : '*'}
            </label>
            <input className="inp" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <label className="lbl">
              PIN {role === 'cashier' ? '(required for fast counter login)' : '(optional)'}
            </label>
            <input className="inp" type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="4-10 digits" />
            <div className="row-btns">
              <button className="btn btn-primary" onClick={submit}>
                Save
              </button>
              <button className="btn" onClick={() => setModal(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}