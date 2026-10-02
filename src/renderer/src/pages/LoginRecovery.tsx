import { useEffect, useRef, useState } from 'react';

/**
 * Password recovery screens for the login flow.
 *
 *   mode="self"    — Option A. Username -> security question (or recovery code)
 *                    -> new password.
 *   mode="support" — Option B. Device ID -> developer-issued code -> new password.
 *
 * Both modes share the same step machine; only the contents of the 'verify' step
 * differ. Rendered inside .lock-overlay/.lock-box to match the existing login and
 * lock screens. Strings are plain English, like the existing 2FA OTP screen.
 */

const MIN_PASSWORD_LENGTH = 4;

type Step = 'username' | 'verify' | 'password' | 'done';

interface Props {
  mode: 'self' | 'support';
  logo?: string | null;
  initialUsername?: string;
  onClose: () => void;
  onDone: (username: string) => void;
}

export default function LoginRecovery({ mode, logo, initialUsername = '', onClose, onDone }: Props) {
  const isSupport = mode === 'support';
  const [step, setStep] = useState<Step>(isSupport ? 'verify' : 'username');
  const [username, setUsername] = useState(initialUsername);
  const [question, setQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [useCode, setUseCode] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [epoch, setEpoch] = useState<number>(0);
  const [supportEnabled, setSupportEnabled] = useState(true);
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const fail = (message: string) => setErr(message);

  // ── Option A: step 1, look up the security question ──────────────────────
  const findQuestion = async () => {
    if (!username.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await window.api.recovery.getQuestion(username.trim());
      if (!res.hasRecovery) {
        setErr(
          'No recovery question is set for this account. Ask the owner to set one in Users → Recovery & Security.'
        );
        setBusy(false);
        return;
      }
      setQuestion(res.question);
      setStep('verify');
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
  };

  // ── Option A: verify the answer (or the owner recovery code) ────────────
  const verifyAnswer = async () => {
    if (busy || !answer.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await window.api.recovery.verifyAnswer(username.trim(), answer.trim());
      if (res.ok) {
        setAnswer('');
        setStep('password');
      } else {
        setErr(res.message ?? 'Incorrect answer');
      }
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
  };

  // ── Option B: load the device ID to read out to support ──────────────────
  useEffect(() => {
    if (!isSupport) return;
    let alive = true;
    window.api.recovery
      .supportInfo()
      .then((info) => {
        if (!alive) return;
        setSupportEnabled(info.enabled);
        setDeviceId(info.deviceId);
        setEpoch(info.epoch);
        setOwnerName(info.ownerUsername);
      })
      .catch((e) => { if (alive) setErr(String(e)); });
    return () => { alive = false; };
  }, [isSupport]);

  const copyDeviceId = async () => {
    if (!deviceId) return;
    try {
      await navigator.clipboard.writeText(deviceId);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setErr('Could not copy — please write the Device ID down manually');
    }
  };

  // ── Option B: verify the developer-issued code ───────────────────────────
  const verifyCode = async () => {
    if (busy || code.trim().length < 8) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await window.api.recovery.verifySupportCode(code.trim());
      if (res.ok) {
        setCode('');
        setStep('password');
      } else {
        setErr(res.message ?? 'Invalid recovery code');
      }
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
  };

  // ── Shared final step: set the new password ──────────────────────────────
  const setNewPassword = async () => {
    if (busy) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setErr(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (password !== confirm) {
      setErr('The two passwords do not match');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      // Support recovery always targets the owner (empty username = owner lookup).
      // Option A targets the account whose question was answered.
      const target = isSupport ? '' : username.trim();
      const res = await window.api.recovery.setNewPassword(target, password);
      if (!res.ok) {
        setErr(res.message ?? 'Could not reset the password');
        setBusy(false);
        return;
      }
      setPassword('');
      setConfirm('');
      setStep('done');
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
  };

  const heading =
    step === 'done'
      ? 'Password updated'
      : isSupport
        ? step === 'password'
          ? 'Support verification passed'
          : 'Support Recovery'
        : step === 'username'
          ? 'Reset your password'
          : step === 'verify'
            ? 'Answer your security question'
            : 'Choose a new password';

  const subtitle =
    step === 'done'
      ? `You can now sign in with your new password${!isSupport && username ? ` (${username})` : ''}.`
      : isSupport
        ? step === 'password'
          ? 'Set a new password for the owner account.'
          : 'Read the Device ID to your software support contact.'
        : step === 'username'
          ? 'Enter your username to begin.'
          : step === 'verify'
            ? useCode
              ? 'Enter the recovery code you wrote down.'
              : (question ?? '')
            : 'Pick something you will remember.';

  return (
    <div className="lock-overlay">
      <div className="lock-box">
        {logo && <img src={logo} alt="Shop logo" className="lock-logo" />}

        {step === 'done' ? (
          <>
            <h2>Password updated</h2>
            <p className="muted">{subtitle}</p>
            <button className="btn btn-primary btn-lg" onClick={() => onDone(isSupport ? '' : username.trim())}>
              Back to login
            </button>
          </>
        ) : (
          <>
            <h2>{heading}</h2>
            <p className="muted">{subtitle}</p>

            {step === 'username' && (
              <input
                placeholder="Username"
                value={username}
                autoFocus
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && findQuestion()}
              />
            )}

            {step === 'verify' && isSupport && !supportEnabled && (
              <p className="text-warn small" style={{ margin: 0 }}>
                Support Recovery is not available in this build. Please use
                &ldquo;Forgot password?&rdquo; with your security question instead.
              </p>
            )}

            {step === 'verify' && isSupport && supportEnabled && (
              <>
                <label className="lbl" style={{ marginBottom: 2 }}>Read these to your support contact</label>
                <code className="recovery-device-id">{deviceId ?? 'Loading…'}</code>
                <div className="row-btns" style={{ justifyContent: 'center', gap: 16 }}>
                  <span className="muted small">
                    Owner: <strong>{ownerName ?? '—'}</strong>
                  </span>
                  <span className="muted small">
                    Request #: <strong>{epoch}</strong>
                  </span>
                </div>
                <button className="btn btn-sm" onClick={copyDeviceId} disabled={!deviceId}>
                  {copied ? 'Copied' : 'Copy Device ID'}
                </button>
                <label className="lbl" style={{ marginBottom: 2 }}>Recovery code from support</label>
                <input
                  placeholder="XXXX-XXXX"
                  value={code}
                  autoFocus
                  maxLength={9}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && verifyCode()}
                />
                <p className="muted small" style={{ margin: 0 }}>
                  Each code works only once, so make sure you use the request number shown above.
                </p>
              </>
            )}

            {step === 'verify' && !isSupport && (
              <>
                <input
                  type="text"
                  placeholder={useCode ? 'XXXX-XXXX' : 'Your answer'}
                  value={answer}
                  autoFocus
                  onChange={(e) => setAnswer(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && verifyAnswer()}
                />
                <button
                  className="btn btn-sm"
                  onClick={() => { setUseCode(!useCode); setAnswer(''); setErr(null); }}
                >
                  {useCode ? 'Use my security answer instead' : 'Use my recovery code instead'}
                </button>
              </>
            )}

            {step === 'password' && (
              <>
                <input
                  type="password"
                  placeholder="New password"
                  value={password}
                  autoFocus
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && setNewPassword()}
                />
                <input
                  type="password"
                  placeholder="Confirm new password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && setNewPassword()}
                />
              </>
            )}

            {err && <p className="text-warn small">{err}</p>}

            {step === 'username' && (
              <button className="btn btn-primary btn-lg" disabled={!username.trim() || busy} onClick={findQuestion}>
                {busy ? 'Checking…' : 'Continue'}
              </button>
            )}

            {step === 'verify' && isSupport && (
              <button className="btn btn-primary btn-lg" disabled={code.trim().length < 8 || busy} onClick={verifyCode}>
                {busy ? 'Verifying…' : 'Verify code'}
              </button>
            )}

            {step === 'verify' && !isSupport && (
              <button className="btn btn-primary btn-lg" disabled={!answer.trim() || busy} onClick={verifyAnswer}>
                {busy ? 'Checking…' : 'Verify answer'}
              </button>
            )}

            {step === 'password' && (
              <button className="btn btn-primary btn-lg" disabled={!password || busy} onClick={setNewPassword}>
                {busy ? 'Saving…' : 'Set password'}
              </button>
            )}

            <button className="btn" onClick={onClose}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}