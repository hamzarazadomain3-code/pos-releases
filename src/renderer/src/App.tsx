import { Component, Suspense, lazy, useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { NavPage, UserRow } from '../../shared/types';
import { resetFormatCache } from './utils/formatters';
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

const Dashboard = lazy(() => import('./pages/Dashboard'));
const BarcodeGenerator = lazy(() => import('./pages/BarcodeGenerator'));
const AdminPanel = lazy(() => import('./pages/AdminPanel'));

const SESSION_KEY = 'pos_session';
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000;

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
  { key: 'barcode', labelKey: 'navigation.barcode', minRole: 'manager' },
  { key: 'audits', labelKey: 'navigation.audits', minRole: 'manager' },
  { key: 'promotions', labelKey: 'navigation.promotions', minRole: 'manager' },
  { key: 'purchases', labelKey: 'navigation.purchases', minRole: 'manager' },
  { key: 'udhaar', labelKey: 'navigation.Udhaar', minRole: 'manager' },
  { key: 'returns', labelKey: 'navigation.returns', minRole: 'manager' },
  { key: 'shifts', labelKey: 'navigation.shifts', minRole: 'manager' },
  { key: 'reports', labelKey: 'navigation.reports', minRole: 'manager' },
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
        if (wallpaper) {
          document.body.style.backgroundImage = `url(${wallpaper})`;
          document.body.style.backgroundSize = 'cover';
          document.body.style.backgroundPosition = 'center';
          document.body.style.backgroundRepeat = 'no-repeat';
          document.body.style.backgroundAttachment = 'fixed';
        } else {
          document.body.style.backgroundImage = '';
          document.body.style.backgroundSize = '';
          document.body.style.backgroundPosition = '';
          document.body.style.backgroundRepeat = '';
          document.body.style.backgroundAttachment = '';
        }
      } catch {
        // Admin settings may not exist yet on first run
      }
    }
    applySettings();
    return () => { mounted = false; };
  }, [i18n.language]);

  // ── Listen for admin settings changes to re-apply live ──
  useEffect(() => {
    const off = window.api.admin.settings.onChange?.(() => {
      resetFormatCache();
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
      <aside className="sidebar">
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
              onClick={() => setPage(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
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
      <main className="content">
        <ErrorBoundary>
          <Suspense fallback={<div className="page"><div className="muted center pad">Loading…</div></div>}>
          {page === 'billing' && <Billing />}
          {page === 'dashboard' && <Dashboard />}
          {page === 'inventory' && <Inventory />}
          {page === 'barcode' && <BarcodeGenerator />}
          {page === 'audits' && <Audits />}
          {page === 'promotions' && <Promotions />}
          {page === 'purchases' && <Purchases />}
          {page === 'udhaar' && <Udhaar />}
          {page === 'returns' && <Returns />}
          {page === 'shifts' && <Shifts />}
          {page === 'reports' && <Reports />}
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