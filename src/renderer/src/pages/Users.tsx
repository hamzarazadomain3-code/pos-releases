import { useCallback, useEffect, useState } from 'react';
import { ModalCloseButton } from '../components/ModalCloseButton';
import type { RecoveryStatus, UserInput, UserRole, UserRow } from '../../../shared/types';

/**
 * Preset recovery questions plus a custom option. Answers are stored hashed
 * (scrypt under 'pos-recovery-salt'), so they can never be read back — the owner
 * is told this up front.
 */
const PRESET_QUESTIONS = [
  'What is your shop\'s registration year?',
  'What is the owner\'s father\'s name?',
  'What was the name of your first shop?',
  'What is your mother\'s maiden name?',
  'What is the name of your favourite teacher?',
  'What is your CNIC number (digits only)?',
  'What is the make of your first vehicle?',
  'What is the name of your childhood street?',
  'What was your first phone brand?',
];
const CUSTOM_QUESTION = '__custom__';

export default function Users() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [me, setMe] = useState<UserRow | null>(null);
  const [modal, setModal] = useState<null | { mode: 'add' } | { mode: 'edit'; user: UserRow }>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState<UserRole>('cashier');
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');

  // Recovery & security
  const [secStatus, setSecStatus] = useState<RecoveryStatus | null>(null);
  const [secQuestion, setSecQuestion] = useState<string>(PRESET_QUESTIONS[0]);
  const [secCustom, setSecCustom] = useState('');
  const [secAnswer, setSecAnswer] = useState('');
  const [secBusy, setSecBusy] = useState(false);
  const [secErr, setSecErr] = useState('');
  const [codeShown, setCodeShown] = useState(false);
  const [ownerCode, setOwnerCode] = useState('');

  const load = useCallback(async () => {
    setUsers(await window.api.users.list());
    const current = await window.api.auth.currentUser();
    setMe(current);
  }, []);

  const loadSec = useCallback(async () => {
    const current = await window.api.auth.currentUser();
    if (!current) return;
    setSecStatus(await window.api.recovery.getStatus(current.id));
  }, []);

  useEffect(() => {
    load();
    loadSec();
  }, [load, loadSec]);

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

  // ── Recovery & security ────────────────────────────────────────────────
  const saveSecurity = async () => {
    if (!me) return;
    const question = secQuestion === CUSTOM_QUESTION ? secCustom : secQuestion;
    if (!question.trim()) {
      setSecErr('Choose or type a security question');
      return;
    }
    if (!secAnswer.trim()) {
      setSecErr('Enter the answer to your security question');
      return;
    }
    setSecBusy(true);
    setSecErr('');
    try {
      setSecStatus(await window.api.recovery.setSecurity(me.id, question, secAnswer));
      setSecAnswer('');
      setSecCustom('');
      setSuccess('Recovery question saved. Write the recovery code down and keep it safe.');
    } catch (e) {
      setSecErr(String(e));
    }
    setSecBusy(false);
  };

  const removeSecurity = async () => {
    if (!me || !window.confirm('Remove your recovery question? You will only be able to reset via Support Recovery.')) return;
    setSecBusy(true);
    setSecErr('');
    try {
      setSecStatus(await window.api.recovery.clearSecurity(me.id));
      setSuccess('Recovery question removed');
    } catch (e) {
      setSecErr(String(e));
    }
    setSecBusy(false);
  };

  const revealCode = async () => {
    setSecBusy(true);
    setSecErr('');
    try {
      setOwnerCode(await window.api.recovery.ownerCode());
      setCodeShown(true);
    } catch (e) {
      setSecErr(String(e));
    }
    setSecBusy(false);
  };

  const rotateCode = async () => {
    if (!window.confirm('Generate a new recovery code? The old one will stop working immediately.')) return;
    setSecBusy(true);
    setSecErr('');
    try {
      setOwnerCode(await window.api.recovery.rotateCode());
      setCodeShown(true);
      setSuccess('New recovery code generated');
    } catch (e) {
      setSecErr(String(e));
    }
    setSecBusy(false);
  };

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
          <h2>Recovery &amp; Security</h2>
          <span className="muted small">For your account ({me?.username ?? '—'})</span>
        </div>

        <p className="muted small" style={{ marginTop: 0 }}>
          Set a security question so you can reset your own password from the login screen without calling
          support. Your answer is stored hashed — it cannot be read back, so pick something you will remember.
        </p>

        {secErr && (
          <div className="notice error">
            {secErr} <button className="btn btn-sm" onClick={() => setSecErr('')}>OK</button>
          </div>
        )}

        <div style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label className="lbl">
              Current question:{' '}
              {secStatus?.hasSecurityQuestion ? (
                <strong>{secStatus.question}</strong>
              ) : (
                <span className="muted">not set</span>
              )}
            </label>
          </div>

          <div>
            <label className="lbl">Security question</label>
            <select className="inp" value={secQuestion} onChange={(e) => setSecQuestion(e.target.value)}>
              {PRESET_QUESTIONS.map((q) => (
                <option key={q} value={q}>{q}</option>
              ))}
              <option value={CUSTOM_QUESTION}>Other (type my own)…</option>
            </select>
          </div>

          {secQuestion === CUSTOM_QUESTION && (
            <div>
              <label className="lbl">Your question</label>
              <input
                className="inp"
                value={secCustom}
                maxLength={200}
                placeholder="Type your own security question"
                onChange={(e) => setSecCustom(e.target.value)}
              />
            </div>
          )}

          <div>
            <label className="lbl">Answer</label>
            <input
              className="inp"
              type="password"
              value={secAnswer}
              placeholder="Answer to the question above"
              onChange={(e) => setSecAnswer(e.target.value)}
            />
            <p className="muted small" style={{ margin: '4px 0 0' }}>
              Capitalisation and extra spaces do not matter when you type it back in.
            </p>
          </div>

          <div className="row-btns">
            <button className="btn btn-primary" disabled={secBusy} onClick={saveSecurity}>
              {secStatus?.hasSecurityQuestion ? 'Update Recovery' : 'Save Recovery'}
            </button>
            {secStatus?.hasSecurityQuestion && (
              <button className="btn" disabled={secBusy} onClick={removeSecurity}>
                Remove
              </button>
            )}
          </div>
        </div>

        <hr style={{ margin: '18px 0', border: 'none', borderTop: '1px solid var(--border)' }} />

        <div style={{ maxWidth: 520 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: '15px' }}>Recovery code</h3>
          <p className="muted small" style={{ marginTop: 0 }}>
            A second way in, if you forget your security answer. It is generated on this installation and
            shown once — write it down and keep it somewhere safe. It works at the login screen via
            &quot;Forgot password? → Use my recovery code instead&quot;.
          </p>

          {codeShown && ownerCode ? (
            <div style={{ marginBottom: 10 }}>
              <code className="recovery-device-id">{ownerCode}</code>
              <div className="row-btns" style={{ marginTop: 8 }}>
                <button
                  className="btn btn-sm"
                  onClick={() => navigator.clipboard.writeText(ownerCode).catch(() => undefined)}
                >
                  Copy
                </button>
                <button className="btn btn-sm" onClick={() => setCodeShown(false)}>Hide</button>
              </div>
            </div>
          ) : (
            <button className="btn" disabled={secBusy} onClick={revealCode}>
              Show recovery code
            </button>
          )}

          <button className="btn btn-sm" style={{ marginTop: 8 }} disabled={secBusy} onClick={rotateCode}>
            Generate a new code
          </button>
        </div>

        <hr style={{ margin: '18px 0', border: 'none', borderTop: '1px solid var(--border)' }} />

        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: '15px' }}>Support Recovery (developer)</h3>
          <p className="muted small" style={{ marginTop: 0 }}>
            If you forget both your answer and your recovery code, the shop can still get back in without a
            reinstall: on the login screen press <strong>Ctrl + Shift + Alt + R</strong> and read the Device ID
            to your software contact.
          </p>
          <div className="row-btns">
            <button
              className="btn btn-sm"
              onClick={() => {
                navigator.clipboard
                  .writeText(secStatus?.deviceId ?? '')
                  .catch(() => undefined);
                setSuccess('Device ID copied to the clipboard');
              }}
              disabled={!secStatus?.deviceId}
            >
              Copy Device ID
            </button>
            {secStatus?.deviceId && <code className="recovery-device-id">{secStatus.deviceId}</code>}
          </div>
          <p className="muted small" style={{ margin: '8px 0 0' }}>
            They will also be asked for the Request # and Owner name shown on their screen — read those out too.
          </p>
        </div>
      </div>

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