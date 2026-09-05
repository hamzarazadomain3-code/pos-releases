import { Component, Suspense, lazy, useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { NavPage, UserRow } from '../../shared/types';
import { resetFormatCache } from './utils/formatters';
import { initDateUtils, resetDateUtils } from './utils/dateUtils';
import Inventory from './pages/Inventory';
import Billing from './pages/Billing';
import Udhaar from './pages/Udhaar';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Purchases from './pages/Purchases';
import Returns from './pages/Returns';
import Users from './pages/Users';
import Audits from './pages/Audits';
import Promotions from './pages/Promotions';
import Shifts from './pages/Shifts';
import Branches from './pages/Branches';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const BarcodeGenerator = lazy(() => import('./pages/BarcodeGenerator'));
const AdminPanel = lazy(() => import('./pages/AdminPanel'));
const Quotations = lazy(() => import('./pages/Quotations'));
const InvoiceDesigner = lazy(() => import('./pages/InvoiceDesigner'));
const QuickSaleGrid = lazy(() => import('./pages/QuickSaleGrid'));
const Transfers = lazy(() => import('./pages/Transfers'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Commissions = lazy(() => import('./pages/Commissions'));
const CustomReports = lazy(() => import('./pages/CustomReports'));
const FIFOStockReport = lazy(() => import('./pages/FIFOStockReport'));

const SESSION_KEY = 'pos_session';
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000;

const NAV_ICONS: Record<string, JSX.Element> = {
  billing: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><line x1="8" y1="3" x2="8" y2="21"/><line x1="2" y1="9" x2="22" y2="9"/></svg>,
  dashboard: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>,
  inventory: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>,
  quickSale: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>,
  purchases: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>,
  returns: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>,
  udhaar: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>,
  quotations: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
  transfers: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>,
  branches: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>,
  barcode: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2v20"/><rect x="10" y="2" width="2" height="20"/><rect x="15" y="2" width="1" height="20"/><rect x="19" y="2" width="2" height="20"/><rect x="3" y="2" width="2" height="20"/></svg>,
  audits: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
  promotions: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  shifts: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  reports: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  expenses: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  commissions: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  customReports: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  fifoStock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
  settings: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  users: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  admin: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  invoiceAdmin: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
};

interface UpdateStatus {
  state: string;
  detail?: string;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="page">
          <div className="page-header">
            <h1>Something went wrong</h1>
          </div>
          <div className="card">
            <p className="text-warn">{this.state.error.message}</p>
            <div className="row-btns">
              <button
                className="btn btn-primary"
                onClick={() => this.setState({ error: null })}
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    const off = window.api.updater.onStatus((s) => setStatus(s));
    window.api.updater.getState().then((s) => setStatus({ state: s }));
    return off;
  }, []);

  if (!status) return null;

  if (status.state === 'downloaded') {
    return (
      <div className="update-banner">
        <div>
          <strong>Update v{status.detail} ready</strong>
          <span className="muted small"> Restart to install — your data is safe.</span>
        </div>
        <div className="row-btns">
          <button className="btn btn-primary btn-sm" onClick={() => window.api.updater.install()}>
            Restart Now
          </button>
          <button className="btn btn-sm" onClick={() => setStatus(null)}>
            Later
          </button>
        </div>
      </div>
    );
  }

  if (status.state === 'downloading') {
    return (
      <div className="update-banner">
        <div>
          <strong>Downloading update… {status.detail}%</strong>
        </div>
      </div>
    );
  }

  if (status.state === 'restarting') {
    return (
      <div className="modal-overlay" style={{ zIndex: 9999 }}>
        <div className="modal" style={{ textAlign: 'center', padding: '40px' }}>
          <div className="spinner" style={{
            margin: '0 auto 16px',
            width: '40px',
            height: '40px',
            border: '4px solid #e0e0e0',
            borderTopColor: '#3b82f6',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }}></div>
          <strong style={{ fontSize: '18px', display: 'block', marginBottom: '8px' }}>
            Installing update...
          </strong>
          <span className="muted small">Please wait while the app restarts</span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  return null;
}

const ALL_NAV: { key: NavPage; labelKey: string; minRole: 'cashier' | 'manager' | 'owner' }[] = [
  { key: 'billing', labelKey: 'navigation.billing', minRole: 'cashier' },
  { key: 'dashboard', labelKey: 'navigation.dashboard', minRole: 'manager' },
  { key: 'inventory', labelKey: 'navigation.inventory', minRole: 'manager' },
  { key: 'branches', labelKey: 'navigation.branches', minRole: 'owner' },
  { key: 'quickSale', labelKey: 'navigation.quickSale', minRole: 'cashier' },
  { key: 'transfers', labelKey: 'navigation.transfers', minRole: 'manager' },
  { key: 'quotations', labelKey: 'navigation.quotations', minRole: 'manager' },
  { key: 'invoiceAdmin', labelKey: 'navigation.invoiceAdmin', minRole: 'manager' },
  { key: 'barcode', labelKey: 'navigation.barcode', minRole: 'manager' },
  { key: 'audits', labelKey: 'navigation.audits', minRole: 'manager' },
  { key: 'promotions', labelKey: 'navigation.promotions', minRole: 'manager' },
  { key: 'purchases', labelKey: 'navigation.purchases', minRole: 'manager' },
  { key: 'udhaar', labelKey: 'navigation.Udhaar', minRole: 'manager' },
  { key: 'returns', labelKey: 'navigation.returns', minRole: 'manager' },
  { key: 'shifts', labelKey: 'navigation.shifts', minRole: 'manager' },
  { key: 'reports', labelKey: 'navigation.reports', minRole: 'manager' },
  { key: 'expenses', labelKey: 'navigation.expenses', minRole: 'manager' },
  { key: 'commissions', labelKey: 'navigation.commissions', minRole: 'manager' },
  { key: 'customReports', labelKey: 'navigation.customReports', minRole: 'manager' },
  { key: 'fifoStock', labelKey: 'navigation.fifoStock', minRole: 'manager' },
  { key: 'settings', labelKey: 'navigation.settings', minRole: 'owner' },
  { key: 'users', labelKey: 'navigation.users', minRole: 'owner' },
  { key: 'admin', labelKey: 'navigation.admin', minRole: 'owner' },
];

const ROLE_RANK: Record<string, number> = { cashier: 1, manager: 2, owner: 3 };

function adjustColor(hex: string, amount: number): string {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  const num = parseInt(hex, 16);
  let r = Math.min(255, Math.max(0, (num >> 16) + amount));
  let g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
  let b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function navFor(role: string): { key: NavPage; label: string }[] {
  return ALL_NAV.filter((n) => ROLE_RANK[role] >= ROLE_RANK[n.minRole]).map(({ key, labelKey }) => ({ key, label: key }));
}

function BranchSelector() {
  const { t } = useTranslation();
  const [currentBranch, setCurrentBranch] = useState<any>(null);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.api.branches.getCurrent().then((b) => { setCurrentBranch(b); });
    window.api.branches.list().then((bs) => { setBranches(bs); setLoading(false); });
  }, []);

  const handleChange = async (branchId: number) => {
    setLoading(true);
    const res = await window.api.branches.setCurrent(branchId);
    if (res.ok) {
      const b = branches.find((br) => br.id === branchId);
      setCurrentBranch(b);
    }
    setLoading(false);
  };

  if (loading || branches.length <= 1) return null;

  return (
    <select
      value={currentBranch?.id || ''}
      onChange={(e) => handleChange(Number(e.target.value))}
      style={{ width: '100%', padding: '8px', borderRadius: 4, border: '1px solid #ddd' }}
    >
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name} {b.is_default ? '✓' : ''}
        </option>
      ))}
    </select>
  );
}

function LoginScreen({ onLogin, logo }: { onLogin: (user: UserRow, rememberMe: boolean) => void; logo?: string | null }) {
  const { t } = useTranslation();
  const [pinMode, setPinMode] = useState(false);
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [otpPending, setOtpPending] = useState<UserRow | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpMessage, setOtpMessage] = useState<string | null>(null);
  const [otpBusy, setOtpBusy] = useState(false);

  const doLogin = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = pinMode
        ? await window.api.auth.loginWithPin(secret)
        : await window.api.auth.login(username, secret);
      if (res.ok && res.user) {
        // Check if 2FA is enabled
        const twoFAEnabled = await window.api.twoFactor.isEnabled();
        if (twoFAEnabled) {
          setOtpPending(res.user);
          const otpResult = await window.api.twoFactor.generateOtp(res.user.id);
          setOtpMessage(otpResult.message);
          setSecret('');
          setBusy(false);
          return;
        }
        setSecret('');
        onLogin(res.user, rememberMe);
      } else {
        setErr(res.message ?? 'errors.login_failed');
      }
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
  };

  const verifyOtp = async () => {
    if (!otpPending || !otpCode || otpBusy) return;
    setOtpBusy(true);
    setErr(null);
    try {
      const result = await window.api.twoFactor.verifyOtp(otpPending.id, otpCode);
      if (result.ok) {
        onLogin(otpPending, rememberMe);
      } else {
        setErr(result.message);
      }
    } catch (e) {
      setErr(String(e));
    }
    setOtpBusy(false);
  };

  // 2FA OTP screen
  if (otpPending) {
    return (
      <div className="lock-overlay">
        <div className="lock-box">
          {logo && <img src={logo} alt="Shop logo" className="lock-logo" />}
          <h2>Verification Code</h2>
          <p className="muted">{otpMessage || 'Enter the code sent to your email/phone'}</p>
          <input
            type="text"
            placeholder="Enter 6-digit code"
            value={otpCode}
            autoFocus
            maxLength={6}
            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && verifyOtp()}
          />
          {err && <p className="text-warn small">{err}</p>}
          <button className="btn btn-primary btn-lg" disabled={!otpCode || otpBusy} onClick={verifyOtp}>
            {otpBusy ? 'Verifying...' : 'Verify'}
          </button>
          <button className="btn" onClick={() => { setOtpPending(null); setOtpCode(''); setErr(null); }}>
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="lock-overlay">
      <div className="lock-box">
        {logo && <img src={logo} alt="Shop logo" className="lock-logo" />}
        <h2>ShopKeeper POS</h2>
        <p className="muted">{t('messages.sign_in_to_continue')}</p>
        {!pinMode && (
          <input
            placeholder="Username"
            value={username}
            autoFocus
            onChange={(e) => setUsername(e.target.value)}
          />
        )}
        <input
          type="password"
          placeholder={pinMode ? t('messages.enter_pin') : t('messages.password')}
          value={secret}
          autoFocus={pinMode}
          onChange={(e) => setSecret(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doLogin()}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#888', margin: '4px 0 8px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
          />
          Remember me
        </label>
        {err && <p className="text-warn small">{err}</p>}
        <button className="btn btn-primary btn-lg" disabled={!secret || busy} onClick={doLogin}>
          {pinMode ? t('buttons.login_with_pin') : t('buttons.Login')}
        </button>
        <button className="btn" onClick={() => { setPinMode(!pinMode); setSecret(''); setErr(null); }}>
        {pinMode ? t('buttons.Use_username_&_password') : t('buttons.Cashier?_Login_with_PIN')}
        </button>
      </div>
    </div>
  );
}

function LockScreen({ user, onUnlock, logo }: { user: UserRow; onUnlock: () => void; logo?: string | null }) {
  const { t } = useTranslation();
  const [pass, setPass] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tryUnlock = async () => {
    if (busy || !pass) return;
    setBusy(true);
    const ok = await window.api.auth.verifyForUser(user.id, pass);
    setBusy(false);
    if (ok) {
      setPass('');
      onUnlock();
    } else {
      setErr(t('messages.incorrect_password_or_pin'));
    }
  };

  return (
    <div className="lock-overlay">
      <div className="lock-box">
        {logo && <img src={logo} alt="Shop logo" className="lock-logo" />}
        <h2>ShopKeeper POS</h2>
        <p className="muted">
          {t('messages.locked')}{' '}— {user.username} ({user.role}). {t('messages.enter_password_or_pin')}
        </p>
        <input
          type="password"
          autoFocus
          placeholder={t('messages.password/_pin')}
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && tryUnlock()}
        />
        {err && <p className="text-warn small">{err}</p>}
        <button className="btn btn-primary btn-lg" disabled={!pass || busy} onClick={tryUnlock}>
          {t('buttons.Unlock')}
        </button>
      </div>
    </div>
  );
}

function ChangePasswordModal({ user, onDone }: { user: UserRow; onDone: () => void }) {
  const { t } = useTranslation();
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (p1.length < 4) return setErr(t('errors.password_at_least_4_chars'));
    if (p1 !== p2) return setErr(t('errors.passwords_do_not_match'));
    try {
      await window.api.users.update(user.id, { password: p1 });
      onDone();
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <div className="lock-overlay">
      <div className="lock-box">
        <h2>{t('messages.set_new_owner_password')}</h2>
        <p className="muted">{t('messages.default_password_warning')}</p>
        <input type="password" placeholder={t('messages.new_password')} value={p1} autoFocus onChange={(e) => setP1(e.target.value)} />
        <input type="password" placeholder={t('messages.confirm_password')} value={p2} onChange={(e) => setP2(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        {err && <p className="text-warn small">{err}</p>}
        <button className="btn btn-primary btn-lg" disabled={!p1 || !p2} onClick={save}>
          {t('buttons.Save_&_Continue')}
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const { t, i18n } = useTranslation();
  const [user, setUser] = useState<UserRow | null>(null);
  const [page, setPage] = useState<NavPage>('billing');
  const [locked, setLocked] = useState(false);
  const [mustChangePw, setMustChangePw] = useState(false);
  const [shopLogo, setShopLogo] = useState<string | null>(null);
  const [sessionRestoring, setSessionRestoring] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const nav = user ? navFor(user.role) : [];

  useEffect(() => {
    window.api.settings
      .getAll()
      .then((s) => setShopLogo(s.shop_logo ?? null))
      .catch(() => undefined);
  }, []);

  // Restore session from localStorage on mount
  useEffect(() => {
    const restore = async () => {
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) { setSessionRestoring(false); return; }
        const saved = JSON.parse(raw) as { user: UserRow; savedAt: number };
        if (Date.now() - saved.savedAt > SESSION_MAX_AGE) {
          localStorage.removeItem(SESSION_KEY);
          setSessionRestoring(false);
          return;
        }
        const refreshed = await window.api.auth.refreshSession();
        if (refreshed) {
          setUser(refreshed);
          setPage('billing');
        } else {
          localStorage.removeItem(SESSION_KEY);
        }
      } catch {
        localStorage.removeItem(SESSION_KEY);
      }
      setSessionRestoring(false);
    };
    restore();
  }, []);

  const handleLanguageChange = (lang: 'en' | 'ur') => {
    i18n.changeLanguage(lang);
    localStorage.setItem('language', lang);
    window.api.admin.settings.set('language', lang).catch(() => undefined);
  };

  useEffect(() => {
    const savedLang = localStorage.getItem('language');
    if (savedLang && savedLang !== i18n.language) {
      i18n.changeLanguage(savedLang);
    }
    const dir = i18n.language === 'ur' ? 'rtl' : 'ltr';
    document.documentElement.lang = i18n.language;
    document.documentElement.dir = dir;
  }, [i18n.language]);

  // ── Apply admin settings: theme, primary color, font size, language, wallpaper ──
  useEffect(() => {
    let mounted = true;
    async function applySettings() {
      try {
        const settings = await window.api.admin.settings.getAll();
        if (!mounted || !settings) return;

        // Theme (dark/light)
        const theme = settings.theme || 'light';
        document.body.classList.remove('theme-dark', 'theme-light');
        document.body.classList.add(`theme-${theme}`);

        // Primary color
        const primaryColor = settings.primary_color;
        if (primaryColor) {
          document.documentElement.style.setProperty('--primary', primaryColor);
          const darker = adjustColor(primaryColor, -20);
          document.documentElement.style.setProperty('--primary-dark', darker);
        }

        // Font size
        const fontSize = settings.font_size || 'normal';
        const sizeMap: Record<string, string> = { small: '12px', normal: '14px', large: '16px' };
        document.documentElement.style.fontSize = sizeMap[fontSize] || '14px';

        // Language from admin settings
        const adminLang = settings.language;
        if (adminLang && adminLang !== i18n.language) {
          i18n.changeLanguage(adminLang);
          localStorage.setItem('language', adminLang);
        }

        // Wallpaper
        const wallpaper = settings.wallpaper_image;
        // Always reset body opacity (old bug set it to 0, making body invisible)
        document.body.style.opacity = '1';
        if (wallpaper) {
          const blur = parseInt(settings.wallpaper_blur || '0', 10);
          const brightness = parseInt(settings.wallpaper_brightness || '100', 10);
          const saturation = parseInt(settings.wallpaper_saturation || '100', 10);
          const grayscale = settings.wallpaper_grayscale === 'true' || settings.wallpaper_grayscale === '1' ? 1 : 0;
          const pos = settings.wallpaper_position || 'center';
          const scale = settings.wallpaper_scale || 'cover';
          const posMap: Record<string, string> = { center: 'center', top: 'top center', bottom: 'bottom center', left: 'center left', right: 'center right' };
          const scaleMap: Record<string, string> = { cover: 'cover', contain: 'contain', stretch: '100% 100%', tile: 'repeat' };
          const filters = `blur(${blur}px) brightness(${brightness}%) saturate(${saturation}%) grayscale(${grayscale})`;

          document.body.style.backgroundImage = `url(${wallpaper})`;
          document.body.style.backgroundSize = scaleMap[scale] || 'cover';
          document.body.style.backgroundPosition = posMap[pos] || 'center';
          document.body.style.backgroundRepeat = scale === 'tile' ? 'repeat' : 'no-repeat';
          document.body.style.backgroundAttachment = 'fixed';
          (document.body.style as any).filter = blur > 0 || brightness !== 100 || saturation !== 100 || grayscale ? filters : '';

          // Tint overlay — optional color tint over wallpaper, NEVER touch body.opacity
          const tintColor = settings.wallpaper_tint_color;
          const tintOpacity = parseInt(settings.wallpaper_tint_opacity || '0', 10) / 100;
          let tintEl = document.getElementById('wallpaper-tint-overlay') as HTMLElement;
          if (tintColor && tintOpacity > 0) {
            if (!tintEl) {
              tintEl = document.createElement('div');
              tintEl.id = 'wallpaper-tint-overlay';
              tintEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:0;';
              document.body.appendChild(tintEl);
            }
            tintEl.style.backgroundColor = tintColor;
            tintEl.style.opacity = String(tintOpacity);
          } else if (tintEl) {
            tintEl.style.opacity = '0';
          }
        } else {
          document.body.style.backgroundImage = '';
          document.body.style.backgroundSize = '';
          document.body.style.backgroundPosition = '';
          document.body.style.backgroundRepeat = '';
          document.body.style.backgroundAttachment = '';
          (document.body.style as any).filter = '';
          const tintEl = document.getElementById('wallpaper-tint-overlay');
          if (tintEl) tintEl.style.opacity = '0';
        }
      } catch {
        // Admin settings may not exist yet on first run
      }
    }
    applySettings();
    initDateUtils(); // Initialize date format settings
    return () => { mounted = false; };
  }, [i18n.language]);

  // ── Listen for admin settings changes to re-apply live ──
  useEffect(() => {
    const off = window.api.admin.settings.onChange?.(() => {
      resetFormatCache();
      resetDateUtils();
    });
    return () => { if (off) off(); };
  }, []);

  const handleLogin = useCallback(async (u: UserRow, rememberMe: boolean) => {
    setUser(u);
    setPage('billing');
    if (rememberMe) {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ user: u, savedAt: Date.now() }));
    }
    if (u.role === 'owner') {
      setMustChangePw(await window.api.auth.defaultPasswordActive());
    }
  }, []);

  useEffect(() => {
    if (user && !nav.some((n) => n.key === page)) setPage('billing');
    const savedLang = localStorage.getItem('language') || 'en';
    if (i18n.language !== savedLang) {
      i18n.changeLanguage(savedLang);
    }
  }, [user, nav, page, i18n.language]);

  if (sessionRestoring) {
    return (
      <div className="app-shell">
        <div className="lock-overlay">
          <div className="lock-box" style={{ textAlign: 'center' }}>
            <div className="spinner" style={{ margin: '0 auto 16px', width: '32px', height: '32px', border: '3px solid #e0e0e0', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
            <p className="muted">Restoring session...</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="app-shell">
        <LoginScreen onLogin={handleLogin} logo={shopLogo} />
      </div>
    );
  }

  const activeNav = nav.map((item) => ({
    ...item,
    label: t(`navigation.${item.key}`, item.label),
  }));

  return (
    <div className="app-shell">
      <button
        className="sidebar-toggle"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open navigation"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      </button>

      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          {shopLogo ? (
            <img src={shopLogo} alt="Shop logo" className="brand-logo" />
          ) : (
            <span className="brand-dot">SK</span>
          )}
          <span>ShopKeeper {i18n.language === 'ur' ? 'پوز' : 'POS'}</span>
          <span className="lang-switcher" style={{ marginLeft: 'auto' }} onClick={() => handleLanguageChange(i18n.language === 'en' ? 'ur' : 'en')}>
            {i18n.language === 'en' ? 'اردو' : 'English'}
          </span>
        </div>
        <nav className="sidebar-nav">
          {activeNav.map((item) => (
            <button
              key={item.key}
              className={page === item.key ? 'nav-btn active' : 'nav-btn'}
              onClick={() => { setPage(item.key); setSidebarOpen(false); }}
              title={sidebarCollapsed ? item.label : undefined}
            >
              <span className="nav-icon">{NAV_ICONS[item.key] || null}</span>
              {!sidebarCollapsed && <span className="nav-label">{item.label}</span>}
            </button>
          ))}
        </nav>

        {/* Branch Selector */}
        <div className="sidebar-branch" style={{ padding: 12, borderTop: '1px solid #eee' }}>
          <div className="small muted" style={{ marginBottom: 8 }}>Current Branch</div>
          <BranchSelector />
        </div>

        <button className="sidebar-collapse-btn" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: sidebarCollapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s' }}>
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>

        <div className="sidebar-user">
          <div className="small muted">{user.username}</div>
          <div className="small muted" style={{ textTransform: 'capitalize' }}>{user.role}</div>
          <button
            className="btn btn-sm"
            style={{ width: '100%', marginTop: 8 }}
            onClick={async () => {
              await window.api.auth.logout();
              localStorage.removeItem(SESSION_KEY);
              setUser(null);
            }}
          >
            {t('buttons.Logout')}
          </button>
        </div>
      </aside>

      <div className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(false)} />

      <main className="content">
        <ErrorBoundary>
          <Suspense fallback={<div className="page"><div className="muted center pad">Loading…</div></div>}>
          {page === 'billing' && <Billing />}
          {page === 'dashboard' && <Dashboard />}
          {page === 'inventory' && <Inventory />}
          {page === 'branches' && <Branches />}
          {page === 'quickSale' && <QuickSaleGrid />}
          {page === 'transfers' && <Transfers />}
          {page === 'quotations' && <Quotations />}
          {page === 'invoiceAdmin' && <InvoiceDesigner />}
          {page === 'barcode' && <BarcodeGenerator />}
          {page === 'audits' && <Audits />}
          {page === 'promotions' && <Promotions />}
          {page === 'purchases' && <Purchases />}
          {page === 'udhaar' && <Udhaar />}
          {page === 'returns' && <Returns />}
          {page === 'shifts' && <Shifts />}
          {page === 'reports' && <Reports />}
          {page === 'expenses' && <Expenses />}
          {page === 'commissions' && <Commissions />}
          {page === 'customReports' && <CustomReports />}
          {page === 'fifoStock' && <FIFOStockReport />}
          {page === 'settings' && <Settings />}
          {page === 'users' && <Users />}
          {page === 'admin' && <AdminPanel />}
          </Suspense>
        </ErrorBoundary>
      </main>
      {locked && <LockScreen user={user} onUnlock={() => setLocked(false)} logo={shopLogo} />}
      {mustChangePw && (
        <ChangePasswordModal
          user={user}
          onDone={() => {
            setMustChangePw(false);
            setUser({ ...user });
          }}
        />
      )}
      <UpdateBanner />
    </div>
  );
}