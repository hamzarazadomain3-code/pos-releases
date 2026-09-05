import { useEffect, useState } from 'react';
import type { AdminUserRow } from '../../../../shared/types';
import { formatDateAdmin, formatDateTimeAdmin } from '../../utils/dateUtils';

export default function UserManagement() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [showReset, setShowReset] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const u = await window.api.admin.users.getAll();
      setUsers(u);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => { load(); }, []);

  const resetPassword = async (userId: number) => {
    if (!newPassword || newPassword.length < 4) {
      setNotice('Password must be at least 4 characters');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await window.api.admin.users.resetPassword(userId, newPassword);
      setShowReset(null);
      setNewPassword('');
      setNotice('Password reset successfully');
      setTimeout(() => setNotice(null), 2000);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const formatRole = (r: string) => r.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="admin-sub-page">
      <div className="admin-sub-header">
        <h2>User Management</h2>
        <p className="muted small">Manage user accounts and passwords</p>
      </div>

      {notice && <div className="notice" onClick={() => setNotice(null)}>{notice}</div>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
              <th>Last Login</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.id}</td>
                <td><strong>{u.username}</strong></td>
                <td><span className="badge">{formatRole(u.role)}</span></td>
                <td>
                  <span className={u.active ? 'text-ok' : 'text-warn'}>
                    {u.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="muted small">{u.created_at ? formatDateAdmin(u.created_at) : '—'}</td>
                <td className="muted small">{u.last_login ? formatDateTimeAdmin(u.last_login) : 'Never'}</td>
                <td>
                  {showReset === u.id ? (
                    <div className="inline-row">
                      <input
                        type="password"
                        placeholder="New password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && resetPassword(u.id)}
                        autoFocus
                        style={{ width: 140 }}
                      />
                      <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => resetPassword(u.id)}>
                        Set
                      </button>
                      <button className="btn btn-sm" onClick={() => { setShowReset(null); setNewPassword(''); }}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button className="btn btn-sm" onClick={() => setShowReset(u.id)}>
                      Reset Password
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={7} className="muted center">No users found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
