import { Component, Suspense, lazy, createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AdminSettingsMap, NavPage, UserRow } from '../../shared/types';
import { resetFormatCache } from './utils/formatters';
import { initCurrency } from './utils/currency';
import { initDateUtils, resetDateUtils } from './utils/dateUtils';
import { KeyboardProvider } from './keyboard/KeyboardProvider';
import { buildSidebar, canOpenRoute, landingPageFor, SIDEBAR_GROUPS, SIDEBAR_ITEMS } from '@shared/sidebarMenu';
import { resolveCombo } from '@shared/shortcuts';
import { shortcutHintLabel } from '@shared/sidebarKeyboardNav';
import { brandDisplayName, brandSubtitle, brandInitials, PRODUCT_NAME } from '@shared/sidebarBrand';
import { sidebarIconShapes } from '@shared/sidebarIcons';
import { languageToggleLabelKey, languageToggleTarget, roleLabelKey, userDisplayName, userInitials } from '@shared/sidebarFooter';
import { badgeFor, BADGE_REFRESH_MS, type SidebarBadge } from '@shared/sidebarBadges';
import {
  DEFAULT_GROUP_STATE,
  groupStateKey,
  groupStateReducer,
  isGroupExpanded,
  parseGroupState,
  type GroupState,
} from '@shared/sidebarMenu';
import FirstRunWizard from './components/FirstRunWizard';
import rokarLogoLight from './assets/rokar-pos-logo-light.png';
import rokarMarkDark from './assets/rokar-pos-mark-dark.png';
import defaultWallpaper from './assets/wallpaper-default.webp';
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Billing = lazy(() => import('./pages/Billing'));
const Udhaar = lazy(() => import('./pages/Udhaar'));
const Reports = lazy(() => import('./pages/Reports'));
const Settings = lazy(() => import('./pages/Settings'));
const Purchases = lazy(() => import('./pages/Purchases'));
const Returns = lazy(() => import('./pages/Returns'));
const Users = lazy(() => import('./pages/Users'));
const Audits = lazy(() => import('./pages/Audits'));
const Promotions = lazy(() => import('./pages/Promotions'));
const Shifts = lazy(() => import('./pages/Shifts'));
const Branches = lazy(() => import('./pages/Branches'));
const AdminPanel = lazy(() => import('./pages/AdminPanel'));
const Quotations = lazy(() => import('./pages/Quotations'));
const InvoiceDesigner = lazy(() => import('./pages/InvoiceDesigner'));
const QuickSaleGrid = lazy(() => import('./pages/QuickSaleGrid'));
const Transfers = lazy(() => import('./pages/Transfers'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Commissions = lazy(() => import('./pages/Commissions'));
const CustomReports = lazy(() => import('./pages/CustomReports'));
const FIFOStockReport = lazy(() => import('./pages/FIFOStockReport'));
const LoginRecovery = lazy(() => import('./pages/LoginRecovery'));
// One entry for label printing: Quick Labels (former Barcode Labels page) and the
// Designer (former Label Studio) live behind a mode switch. See pages/Labels.tsx.
const Labels = lazy(() => import('./pages/Labels'));

const SESSION_KEY = 'pos_session';
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000;
/** The page the user was last on — for the "Last page" landing choice. */
const LAST_PAGE_KEY = 'pos_last_page';

/** localStorage can be blocked (private mode); never let it break the app. */
function readLastPage(): string | null {
  try {
    return localStorage.getItem(LAST_PAGE_KEY);
  } catch {
    return null;
  }
}

function writeLastPage(page: string): void {
  try {
    localStorage.setItem(LAST_PAGE_KEY, page);
  } catch {
    /* storage blocked — the landing choice simply falls back */
  }
}

/**
 * The navigation icon.
 *
 * The drawings live in `src/shared/sidebarIcons.ts` — the ONE icon set — so
 * the desktop sidebar, the phone drawer and the page search all show the same
 * picture for a page, and no two pages wear the same one.
 */
function NavIcon({ iconId }: { iconId: string }) {
  const shapes = sidebarIconShapes(iconId);
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shapes.map((shape, i) => createElement(shape.tag, { key: i, ...shape.attrs }))}
    </svg>
  );
}


interface UpdateStatus {
  state: string;
  detail?: string;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // The "Something went wrong" screen hides the real cause — log it with the
    // component stack so page crashes (e.g. Label Studio reading a missing
    // template) are diagnosable from the DevTools console instead of guessing.
    console.error('[render] page crash:', error.message, '\n', info && info.componentStack ? info.componentStack : '');
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

// The menu itself lives in ONE place: `src/shared/sidebarMenu.ts`. Every layout
// (desktop sidebar, tablet rail, phone drawer, phone bottom bar, Ctrl+K search)
// is fed by `buildSidebar()` — there is no second list of pages.

function adjustColor(hex: string, amount: number): string {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  const num = parseInt(hex, 16);
  let r = Math.min(255, Math.max(0, (num >> 16) + amount));
  let g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
  let b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
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

function LoginScreen({
  onLogin,
  logo,
  shopName,
  onForgotPassword,
  onSupportRecovery,
  initialUsername = '',
}: {
  onLogin: (user: UserRow, rememberMe: boolean) => void;
  logo?: string | null;
  shopName?: string | null;
  onForgotPassword: () => void;
  onSupportRecovery: () => void;
  initialUsername?: string;
}) {
  const { t } = useTranslation();
  const [pinMode, setPinMode] = useState(false);
  const [username, setUsername] = useState(initialUsername);
  const [secret, setSecret] = useState('');
const [showPassword, setShowPassword] = useState(false);
const [capsLock, setCapsLock] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [otpPending, setOtpPending] = useState<UserRow | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpMessage, setOtpMessage] = useState<string | null>(null);
  const [otpBusy, setOtpBusy] = useState(false);
  const passRef = useRef<HTMLInputElement>(null);

  // Hidden developer fallback for when the security question cannot be answered.
  // Deliberately obscure and only armed on the login screen.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.altKey && (e.code === 'KeyR' || e.key === 'R')) {
        e.preventDefault();
        onSupportRecovery();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSupportRecovery]);

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
        {logo ? (
          <img src={logo} alt="Shop logo" className="lock-logo" />
        ) : (
          <img src={rokarLogoLight} alt="Rokar POS" className="lock-logo lock-brand-logo" />
        )}
        <h2>{shopName || 'Rokar POS'}</h2>
        <p className="muted">{t('messages.sign_in_to_continue')}</p>
        {!pinMode && (
          <input
            placeholder="Username"
            value={username}
            autoFocus
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                passRef.current?.focus();
              }
            }}
          />
        )}
        <input
          ref={passRef}
          type={showPassword ? 'text' : 'password'}
          placeholder={pinMode ? t('messages.enter_pin') : t('messages.password')}
          value={secret}
          autoFocus={pinMode}
          onChange={(e) => {
            setSecret(e.target.value);
          }}
          onKeyUp={(e) => setCapsLock(!!e.getModifierState && e.getModifierState('CapsLock'))}
          onKeyDown={(e) => e.key === 'Enter' && doLogin()}
        />
        {!pinMode && (
          <button type="button" className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => setShowPassword((v) => !v)}>
            {showPassword ? 'Hide' : 'Show'}
          </button>
        )}
        {capsLock && !pinMode && <div className="muted small" style={{ marginTop: 4 }}>Caps Lock is on</div>}
        {pinMode && (
          <div className="pin-pad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => (
              <button
                key={k}
                type="button"
                className="pin-key"
                onClick={() => {
                  if (k === 'C') setSecret('');
                  else if (k === '⌫') setSecret((s) => s.slice(0, -1));
                  else setSecret((s) => s + k);
                }}
              >
                {k}
              </button>
            ))}
          </div>
        )}
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
          {pinMode ? t('buttons.Login_with_PIN') : t('buttons.Login')}
        </button>
        <button className="btn" onClick={() => { setPinMode(!pinMode); setSecret(''); setErr(null); }}>
          {pinMode ? t('buttons.Login_with_username_&_password') : t('buttons.Cashier__Login_with_PIN')}
        </button>
        {!pinMode && (
          <button className="btn btn-link" onClick={onForgotPassword}>
            Forgot password?
          </button>
        )}
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
        {logo ? (
          <img src={logo} alt="Shop logo" className="lock-logo" />
        ) : (
          <img src={rokarLogoLight} alt="Rokar POS" className="lock-logo lock-brand-logo" />
        )}
        <h2>Rokar POS</h2>
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

/**
 * The wallpaper every screen shows.
 *
 * The shop's own wallpaper when they have set one, otherwise the supplied
 * Rokar POS artwork - the app's DEFAULT wallpaper. Module scope (not inside
 * the component) so the admin-settings change listener can re-apply it
 * without re-mounting the whole app.
 */
function applyWallpaper(settings: AdminSettingsMap) {
  const wallpaper = settings.wallpaper_image || defaultWallpaper;
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
}

export default function App() {
  const { t, i18n } = useTranslation();
  const [user, setUser] = useState<UserRow | null>(null);
  const [page, setPage] = useState<NavPage>('billing');
  const [locked, setLocked] = useState(false);
  const [mustChangePw, setMustChangePw] = useState(false);
  const [shopLogo, setShopLogo] = useState<string | null>(null);
  const [shopName, setShopName] = useState<string | null>(null);
  const [branchName, setBranchName] = useState<string | null>(null);
  const [sessionRestoring, setSessionRestoring] = useState(true);
  const [multiBranch, setMultiBranch] = useState(false);
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState<'self' | 'support' | null>(null);
  const [recoveryPrefill, setRecoveryPrefill] = useState('');
  const [shortcutMap, setShortcutMap] = useState<Record<string, string>>({});
  /** Settings > Keyboard: the Esc gesture (default ON). */
  const [escapeGestureEnabled, setEscapeGestureEnabled] = useState(true);
  /** Settings > Keyboard: the double-Esc window in ms (default 400). */
  const [escapeDoubleTapWindowMs, setEscapeDoubleTapWindowMs] = useState(400);
  const [showFirstRunWizard, setShowFirstRunWizard] = useState(false);
  const [firstRunChecked, setFirstRunChecked] = useState(false);
  /** The refusal message when the route guard blocks a page. */
  const [guardNotice, setGuardNotice] = useState<string | null>(null);
  /** Which sidebar groups are collapsed (remembered per user). */
  const [groupState, setGroupState] = useState<GroupState>(DEFAULT_GROUP_STATE);
 // The ONE menu: built for this role, this feature set and this language.
 const navGroups = useMemo(() => {
   const labels: Record<string, string> = {};
   for (const item of SIDEBAR_ITEMS) labels[item.route] = t(item.i18nKey, item.i18nKey);
   for (const group of SIDEBAR_GROUPS) labels[group.i18nKey] = t(group.i18nKey, group.i18nKey);
   return buildSidebar({
     role: user?.role,
     features: { multi_branch: multiBranch },
     language: i18n.language === 'ur' ? 'ur' : 'en',
     labels,
   });
 }, [user?.role, multiBranch, i18n.language, t]);

 // The flat list the keyboard layer and the page search use — the SAME items.
 // The footer: the name and the letters in the little avatar.
 const footerName = userDisplayName(user?.username);
 const footerInitials = userInitials(user?.username);

 // The badges next to the menu items. The numbers come from the main process
 // (the same tables the Dashboard and the Alerts read) and are refreshed at
 // most once a minute — the service keeps them for a minute on its side too.
 const [badges, setBadges] = useState<SidebarBadge[]>([]);

 useEffect(() => {
   if (!user) {
     setBadges([]);
     return;
   }
   let alive = true;
   const load = () => {
     Promise.resolve(window.api.sidebar?.badges?.())
       .then((list) => {
         if (alive && Array.isArray(list)) setBadges(list as SidebarBadge[]);
       })
       .catch(() => {
         // A missing badge must never break the menu.
         if (alive) setBadges([]);
       });
   };
   load();
   const timer = setInterval(load, BADGE_REFRESH_MS);
   return () => {
     alive = false;
     clearInterval(timer);
   };
 }, [user?.id]);

 const activeNav = useMemo(
   () => navGroups.flatMap((g) => g.items.map((i) => ({ key: i.route, label: i.label }))),
   [navGroups]
 );

  // Load the admin shortcut bindings for the global keyboard layer.
  useEffect(() => {
    if (!user) {
      setShortcutMap({});
      return;
    }
    let mounted = true;
    window.api.admin.shortcuts
      .getAll()
      .then((rows) => {
        if (!mounted) return;
        const map: Record<string, string> = {};
        for (const r of rows) {
          if (r.is_active) map[r.action] = r.shortcut_key;
        }
        setShortcutMap(map);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [user]);

  // Settings > Keyboard: the Esc gesture toggle and its double-tap window.
  useEffect(() => {
    if (!user) return;
    let mounted = true;
    window.api.settings
      .getAll()
      .then((s) => {
        if (!mounted) return;
        const on = s.escape_refresh_enabled;
        if (on !== undefined) setEscapeGestureEnabled(on !== 'false' && on !== '0');
        const win = Number(s.escape_double_tap_window_ms);
        if (Number.isFinite(win) && win > 0) setEscapeDoubleTapWindowMs(win);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [user]);

  useEffect(() => {
    window.api.settings
      .getAll()
      .then((s) => {
        setShopLogo(s.shop_logo ?? null);
        setShopName(s.shop_name ?? null);
      })
      .catch(() => undefined);
  }, []);

  // The branch the shop is sitting in (only meaningful for a multi-branch shop).
  useEffect(() => {
    if (!multiBranch) {
      setBranchName(null);
      return;
    }
    window.api.branches
      .getCurrent()
      .then((b) => setBranchName(b?.name ?? null))
      .catch(() => setBranchName(null));
  }, [multiBranch]);

  useEffect(() => {
    if (!user) {
      setMultiBranch(false);
      setSessionTimeoutMinutes(0);
      return;
    }
    window.api.admin.features.isEnabled('multi_branch').then(setMultiBranch).catch(() => setMultiBranch(false));
    window.api.auth.getSecurityPolicy().then((p) => setSessionTimeoutMinutes(p.session_timeout_minutes || 0)).catch(() => undefined);
  }, [user]);

  useEffect(() => {
    if (!user || locked || mustChangePw || sessionTimeoutMinutes <= 0) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setLocked(true), sessionTimeoutMinutes * 60 * 1000);
    };
    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [user, locked, mustChangePw, sessionTimeoutMinutes]);

  // Restore session from localStorage on mount
  useEffect(() => {
    const restore = async () => {
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) { 
          setSessionRestoring(false); 
          // Check if first run is needed
          const firstRunDone = localStorage.getItem('first_run_complete');
          if (!firstRunDone) {
            const settings = await window.api.settings.getAll();
            if (!settings?.shop_name) {
              setShowFirstRunWizard(true);
            }
          }
          return; 
        }
        const saved = JSON.parse(raw) as { user: UserRow; savedAt: number };
        if (Date.now() - saved.savedAt > SESSION_MAX_AGE) {
          localStorage.removeItem(SESSION_KEY);
          setSessionRestoring(false);
          return;
        }
        const refreshed = await window.api.auth.refreshSession();
        if (refreshed) {
          setUser(refreshed);
          setPage(await resolveLanding(refreshed.role));
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

  // Listen for Support Recovery IPC from main process (menu item click)
  useEffect(() => {
    const off = window.api.app.onOpenSupportRecovery(() => {
      // Only trigger if on login screen (no user logged in, no recovery mode active)
      if (!user && !recoveryMode) {
        setRecoveryMode('support');
      }
    });
    return () => off();
  }, [user, recoveryMode]);

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

        initCurrency().catch(() => undefined);

        // Wallpaper
        // The supplied brand artwork is the app's DEFAULT wallpaper: it shows on
        // every screen until the owner picks their own in Admin -> System
        // Settings -> Background Wallpaper.
        // Always reset body opacity (old bug set it to 0, making body invisible)
        document.body.style.opacity = '1';
        // The wallpaper: the shop's own one, or the app's default artwork.
        applyWallpaper(settings);
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
      initDateUtils(); // Re-read date format settings
      // The wallpaper may have changed (upload / reset to default).
      window.api.admin.settings
        .getAll()
        .then((settings) => { if (settings) applyWallpaper(settings); })
        .catch(() => undefined);
    });
    return () => { if (off) off(); };
  }, []);

  // ── The route guard ──────────────────────────────────────────────────────
  // The MENU hides a link; this REFUSES the page. Both read the same rules
  // (`canOpenRoute` -> the one menu definition), so a route hidden from the
  // menu can never be opened — not by the keyboard layer, not by the command
  // palette, not by a shortcut, not by a deep link.
  const navigate = useCallback(
    (next: NavPage) => {
      if (!canOpenRoute(user?.role, next, { multi_branch: multiBranch })) {
        setGuardNotice('You do not have access to that page.');
        window.setTimeout(() => setGuardNotice(null), 2500);
        return false;
      }
      setPage(next);
      return true;
    },
    [user?.role, multiBranch]
  );

  // ── The landing page after a login ───────────────────────────────────────
  // The Setting wins when it names a page this role may open; otherwise the
  // role's own page (cashier -> Billing, owner/manager -> Dashboard).
  // The setting and the feature toggle are read HERE, not from state, because
  // the session restore runs on mount — before either has arrived.
  const resolveLanding = useCallback(async (role: string): Promise<NavPage> => {
    let setting = '';
    let multiBranch = false;
    try {
      const s = await window.api.settings.getAll();
      setting = s.page_after_login ?? '';
    } catch {
      /* the setting is optional */
    }
    try {
      multiBranch = await window.api.admin.features.isEnabled('multi_branch');
    } catch {
      multiBranch = false;
    }
    const allowed = buildSidebar({ role, features: { multi_branch: multiBranch } }).flatMap((g) =>
      g.items.map((i) => i.route)
    );
    const decision = landingPageFor({
      role,
      setting,
      lastPage: readLastPage(),
      allowedRoutes: allowed,
    });
    return decision.page ?? 'billing';
  }, []);

  const handleLogin = useCallback(async (u: UserRow, rememberMe: boolean) => {
    setUser(u);
    setPage(await resolveLanding(u.role));
    if (rememberMe) {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ user: u, savedAt: Date.now() }));
    }
    if (u.role === 'owner') {
      setMustChangePw(await window.api.auth.defaultPasswordActive());
    }
  }, []);

  const handleLogout = useCallback(() => {
    if (user?.role === 'owner') {
      window.api.auth.logout();
      localStorage.removeItem(SESSION_KEY);
      setUser(null);
    }
  }, [user]);

  useEffect(() => {
    // Safety net for a page that is no longer permitted (a role change, a
    // feature toggle being switched off). The guard above refuses the route
    // in the first place; this catches the page that was already open.
    if (user && !canOpenRoute(user.role, page, { multi_branch: multiBranch })) setPage('billing');
    const savedLang = localStorage.getItem('language') || 'en';
    if (i18n.language !== savedLang) {
      i18n.changeLanguage(savedLang);
    }
  }, [user, page, multiBranch, i18n.language]);

  // Remember the last page — the "Last page" landing choice needs it.
  useEffect(() => {
    if (!user) return;
    writeLastPage(page);
  }, [user, page]);

  // ── The collapsible groups ────────────────────────────────────────────────
  // The state is remembered PER USER. localStorage can be blocked (private
  // mode), so every access is guarded — a blocked store must never break the
  // app, it only means the state is not remembered.
  useEffect(() => {
    if (!user) {
      setGroupState(DEFAULT_GROUP_STATE);
      return;
    }
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(groupStateKey(user.id));
    } catch {
      raw = null;
    }
    setGroupState(parseGroupState(raw));
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    try {
      localStorage.setItem(groupStateKey(user.id), JSON.stringify(groupState));
    } catch {
      /* storage blocked — the state is simply not remembered */
    }
  }, [user?.id, groupState]);

  const toggleSidebarGroup = useCallback((groupId: string) => {
    setGroupState((s) => groupStateReducer(s, { type: 'toggle', groupId }));
  }, []);

  if (sessionRestoring) {
    return (
      <div className="app-shell">
        <div className="lock-overlay">
          <div className="lock-box" style={{ textAlign: 'center' }}>
            <img src={rokarLogoLight} alt="Rokar POS" className="lock-logo lock-brand-logo" style={{ marginBottom: 12 }} />
            <div className="spinner" style={{ margin: '0 auto 16px', width: '32px', height: '32px', border: '3px solid #e0e0e0', borderTopColor: '#0B5D4B', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
            <p className="muted">Restoring session...</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    // Show first run wizard if needed
    if (showFirstRunWizard) {
      return (
        <FirstRunWizard
          onComplete={(shopProfile, templateId) => {
            setShowFirstRunWizard(false);
            localStorage.setItem('first_run_complete', 'true');
            // The wizard will have saved the profile and template
            // Refresh settings and continue
            window.location.reload();
          }}
        />
      );
    }
    return (
      <div className="app-shell">
        <Suspense fallback={null}>
          {recoveryMode ? (
            <LoginRecovery
              mode={recoveryMode}
              logo={shopLogo}
              initialUsername={recoveryPrefill}
              onClose={() => setRecoveryMode(null)}
              onDone={(u) => {
                setRecoveryMode(null);
                setRecoveryPrefill(u);
              }}
            />
          ) : (
            <LoginScreen
              onLogin={handleLogin}
              logo={shopLogo}
              shopName={shopName}
              initialUsername={recoveryPrefill}
              onForgotPassword={() => setRecoveryMode('self')}
              onSupportRecovery={() => {
                if (window.confirm('Support Recovery is a developer tool.\n\nContinue?')) {
                  setRecoveryMode('support');
                }
              }}
            />
          )}
        </Suspense>
      </div>
    );
  }

  return (
    <KeyboardProvider
      shortcutMap={shortcutMap}
      pages={activeNav.map((n) => ({ key: n.key, label: n.label }))}
      onNavigate={(key) => navigate(key as NavPage)}
      enabled={!locked && !mustChangePw}
      escapeGestureEnabled={escapeGestureEnabled}
      escapeDoubleTapWindowMs={escapeDoubleTapWindowMs}
      onGoToBilling={() => setPage('billing')}
    >
    <div className="app-shell">
      {guardNotice && (
        <div className="guard-notice" role="status" aria-live="polite">
          {guardNotice}
        </div>
      )}
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
      {/* Phone search — opens the Ctrl+K page switcher. */}
      <button
        className="mobile-search-btn"
        onClick={() => {
          const ev = new KeyboardEvent('keydown', {
            key: 'k',
            code: 'KeyK',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          });
          window.dispatchEvent(ev);
        }}
        aria-label="Search pages"
        title="Search pages"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>

      <aside
        className={`sidebar bilten-sidebar ${sidebarOpen ? 'open' : ''}`}
      >
        <div className="sidebar-brand">
          {shopLogo ? (
            <img src={shopLogo} alt="" className="brand-icon brand-logo" />
          ) : (
            <img src={rokarMarkDark} alt="" className="brand-icon" />
          )}
          <span className="nav-label sidebar-brand-info">
            <span className="sidebar-brand-label">{brandDisplayName(shopName)}</span>
            {brandSubtitle(multiBranch, branchName) && (
              <span className="sidebar-brand-branch">{brandSubtitle(multiBranch, branchName)}</span>
            )}
          </span>
          {/* The status dot: green while a shift is open. */}
          {badges.some((b) => b.id === 'shifts') && (
            <span className="sidebar-brand-dot" aria-hidden="true" />
          )}
        </div>
        <nav className="sidebar-nav" aria-label={t('navigation.billing', 'Menu')}>
          {navGroups.map((group) => {
            // In icon-only mode there is no heading to collapse, so every group
            // stays open — otherwise the sidebar would show nothing at all.
            const expanded = sidebarOpen
              ? isGroupExpanded(groupState, group.id, page)
              : true;
            return (
              <div key={group.id} className={`nav-group${group.separated ? ' nav-group-separated' : ''}`}>
                <button
                  type="button"
                  className="nav-group-title nav-group-toggle"
                  aria-expanded={expanded}
                  onClick={() => toggleSidebarGroup(group.id)}
                  title={group.label}
                >
                  <span className="nav-group-label">{group.label}</span>
                  <span className="nav-group-chevron" aria-hidden="true">▾</span>
                </button>
                {expanded &&
                  group.items.map((item) => {
                    // The badge of this page (the menu definition says which
                    // page carries which badge; the numbers come from the main
                    // process and the role filter already ran there).
                    const badge = item.badgeId ? badgeFor(badges, item.badgeId) : undefined;
                    return (
                      <button
                        key={item.id}
                        className={page === item.route ? 'nav-btn active' : 'nav-btn'}
                        onClick={() => { navigate(item.route); }}
                        aria-label={item.label}
                        data-label={item.label}
                        title={item.label}
                        aria-current={page === item.route ? 'page' : undefined}
                      >
                        <span className="nav-icon"><NavIcon iconId={item.iconId} /></span>
                        <span className="nav-label">{item.label}</span>
                        {item.shortcutAction && shortcutHintLabel(resolveCombo(item.shortcutAction, shortcutMap)) && (
                          <span className="nav-shortcut-hint" aria-hidden="true">
                            {shortcutHintLabel(resolveCombo(item.shortcutAction, shortcutMap))}
                          </span>
                        )}
                        {badge && (
                          <span
                            className={badge.kind === 'dot' ? 'nav-badge nav-badge-dot' : 'nav-badge'}
                            title={badge.kind === 'dot' ? item.label : `${item.label}: ${badge.display}`}
                            aria-label={badge.kind === 'dot' ? `${item.label}: new` : `${item.label}: ${badge.display}`}
                          >
                            {badge.kind === 'dot' ? '' : badge.display}
                          </span>
                        )}
                      </button>
                    );
                  })}
              </div>
            );
          })}
        </nav>

        {/* ── The footer: who is signed in, the language, the sign-out, the
            collapse. The old 🚪 emoji button is gone — an emoji is not a
            button (it rendered as a picture on some systems and as a broken
            box on others); the sign-out is a real button with a drawn icon. */}
        <div className="sidebar-bottom">
          <div
            className="sidebar-user"
            aria-label={t('sidebar.signedInAs', {
              name: footerName,
              role: t(roleLabelKey(user?.role)),
            })}
          >
            <span className="sidebar-user-avatar" aria-hidden="true">{footerInitials}</span>
            <span className="sidebar-user-info">
              <span className="sidebar-user-name">{footerName}</span>
              <span className="sidebar-user-role">{t(roleLabelKey(user?.role))}</span>
            </span>
          </div>

          <div className="sidebar-bottom-actions">
            <button
              type="button"
              className="sidebar-footer-btn"
              onClick={() => handleLanguageChange(languageToggleTarget(i18n.language))}
              aria-label={t(languageToggleLabelKey(i18n.language))}
              title={t(languageToggleLabelKey(i18n.language))}
            >
              <span className="nav-label collapse-label">{t(languageToggleLabelKey(i18n.language))}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18" />
                <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
              </svg>
            </button>

            <button
              type="button"
              className="sidebar-footer-btn"
              onClick={handleLogout}
              aria-label={t('sidebar.signOut')}
              title={t('sidebar.signOut')}
            >
              <span className="nav-label collapse-label">{t('sidebar.signOut')}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>

            <button
              type="button"
              className="sidebar-collapse-btn"
              onClick={() => setSidebarOpen((o) => !o)}
              aria-label={sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')}
              title={sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')}
            >
              <span className="collapse-glyph" aria-hidden="true">{sidebarOpen ? '◀' : '▶'}</span>
              <span className="nav-label collapse-label">{t('sidebar.collapse')}</span>
            </button>
          </div>
        </div>
      </aside>

      <div className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(false)} />

      <main className="content">
        <ErrorBoundary>
          <Suspense fallback={<div className="page"><div className="muted center pad">Loading…</div></div>}>
          {page === 'billing' && <Billing onNavigate={(key) => navigate(key as NavPage)} onLogout={handleLogout} />}
          {page === 'dashboard' && <Dashboard />}
          {page === 'inventory' && <Inventory />}
          {page === 'branches' && <Branches />}
          {page === 'quickSale' && <QuickSaleGrid />}
          {page === 'transfers' && <Transfers />}
          {page === 'quotations' && <Quotations />}
          {page === 'invoiceAdmin' && <InvoiceDesigner />}
          {page === 'labelStudio' && <Labels initialMode="designer" />}
          {/* Legacy key: old shortcuts / deep links land on the Quick Labels mode. */}
          {page === 'barcode' && <Labels initialMode="quick" />}
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
          {page === 'admin' && <AdminPanel onNavigate={(key) => navigate(key as NavPage)} />}
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
    </KeyboardProvider>
  );
}