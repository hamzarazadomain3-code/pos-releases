import { Component, Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { NavPage, UserRow } from '../../shared/types';
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

const LOCK_AFTER_MS = 5 * 60 * 1000;

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
];

const ROLE_RANK: Record<string, number> = { cashier: 1, manager: 2, owner: 3 };

function navFor(role: string): { key: NavPage; label: string }[] {
  return ALL_NAV.filter((n) => ROLE_RANK[role] >= ROLE_RANK[n.minRole]).map(({ key, labelKey }) => ({ key, label: key }));
}

function LoginScreen({ onLogin, logo }: { onLogin: (user: UserRow) => void; logo?: string | null }) {
  const { t } = useTranslation();
  const [pinMode, setPinMode] = useState(false);
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const doLogin = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = pinMode
        ? await window.api.auth.loginWithPin(secret)
        : await window.api.auth.login(username, secret);
      if (res.ok && res.user) {
        setSecret('');
        setUsername('');
        onLogin(res.user);
      } else {
        setErr(res.message ?? 'errors.login_failed');
      }
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
  };

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
  const timerRef = useRef<number>(0);
  const nav = user ? navFor(user.role) : [];

  useEffect(() => {
    window.api.settings
      .getAll()
      .then((s) => setShopLogo(s.shop_logo ?? null))
      .catch(() => undefined);
  }, []);

  const handleLanguageChange = (lang: 'en' | 'ur') => {
    i18n.changeLanguage(lang);
    localStorage.setItem('language', lang);
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

  const handleLogin = useCallback(async (u: UserRow) => {
    setUser(u);
    setPage('billing');
    if (u.role === 'owner') {
      setMustChangePw(await window.api.auth.defaultPasswordActive());
    }
  }, []);
  const armLock = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setLocked(true), LOCK_AFTER_MS);
  }, []);

  useEffect(() => {
    if (!user) return;
    armLock();
    const events: (keyof WindowEventMap)[] = ['mousemove', 'keydown', 'click', 'mousedown', 'wheel'];
    events.forEach((ev) => window.addEventListener(ev, armLock));
    return () => {
      window.clearTimeout(timerRef.current);
      events.forEach((ev) => window.removeEventListener(ev, armLock));
    };
  }, [user, armLock]);

  useEffect(() => {
    if (user && !nav.some((n) => n.key === page)) setPage('billing');
    const savedLang = localStorage.getItem('language') || 'en';
    if (i18n.language !== savedLang) {
      i18n.changeLanguage(savedLang);
    }
  }, [user, nav, page, i18n.language]);

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
          </Suspense>
        </ErrorBoundary>
      </main>
      {locked && <LockScreen user={user} onUnlock={() => { setLocked(false); armLock(); }} logo={shopLogo} />}
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