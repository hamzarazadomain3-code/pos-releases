import { useEffect, useState, useRef } from 'react';
import type { AdminSettingsMap } from '../../../../shared/types';

interface Section {
  key: string;
  label: string;
  settings: { key: string; label: string; type: 'text' | 'number' | 'toggle' | 'select' | 'color' | 'wallpaper'; options?: string[]; hint?: string }[];
}

const SECTIONS: Section[] = [
  {
    key: 'shop', label: 'Shop Settings',
    settings: [
      { key: 'currency_symbol', label: 'Currency Symbol', type: 'text' },
      { key: 'date_format', label: 'Date Format', type: 'select', options: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] },
      { key: 'time_format', label: 'Time Format', type: 'select', options: ['12h', '24h'] },
      { key: 'decimal_places', label: 'Decimal Places', type: 'select', options: ['2', '3', '4'] },
    ],
  },
  {
    key: 'billing', label: 'Billing Settings',
    settings: [
      { key: 'receipt_width', label: 'Receipt Width', type: 'select', options: ['58mm', '80mm'] },
      { key: 'receipt_font_size', label: 'Receipt Font Size', type: 'select', options: ['small', 'normal', 'large'] },
      { key: 'auto_print_receipt', label: 'Auto-print Receipt', type: 'toggle' },
      { key: 'receipt_header_text', label: 'Receipt Header Text', type: 'text', hint: 'Shown at top of receipt' },
      { key: 'receipt_footer_text', label: 'Receipt Footer Text', type: 'text', hint: 'Shown at bottom of receipt' },
      { key: 'show_tax_on_receipt', label: 'Show Tax on Receipt', type: 'toggle' },
      { key: 'show_discount_breakdown', label: 'Show Discount Breakdown', type: 'toggle' },
      { key: 'show_payment_method', label: 'Show Payment Method', type: 'toggle' },
      { key: 'show_cashier_name', label: 'Show Cashier Name', type: 'toggle' },
      { key: 'round_off_total', label: 'Round Off Total', type: 'toggle' },
      { key: 'default_payment_mode', label: 'Default Payment Mode', type: 'select', options: ['Cash', 'Card', 'Easypaisa', 'JazzCash'] },
      { key: 'require_customer', label: 'Require Customer for Every Bill', type: 'toggle' },
      { key: 'allow_negative_stock', label: 'Allow Negative Stock', type: 'toggle' },
      { key: 'invoice_prefix', label: 'Invoice Prefix', type: 'text' },
      { key: 'invoice_start_number', label: 'Starting Invoice Number', type: 'number' },
      { key: 'max_discount_percent', label: 'Max Discount % Allowed', type: 'number' },
      { key: 'discount_require_password_above', label: 'Require Password for Discount Above (%)', type: 'number' },
    ],
  },
  {
    key: 'inventory', label: 'Inventory Settings',
    settings: [
      { key: 'auto_generate_sku', label: 'Auto-generate SKU', type: 'toggle' },
      { key: 'sku_prefix', label: 'SKU Prefix', type: 'text' },
      { key: 'stock_valuation_method', label: 'Stock Valuation Method', type: 'select', options: ['FIFO', 'LIFO', 'Average'] },
      { key: 'expiry_alert_days', label: 'Expiry Alert Days', type: 'number' },
      { key: 'barcode_format', label: 'Barcode Format', type: 'select', options: ['CODE128', 'EAN-13', 'CODE39'] },
      { key: 'auto_generate_barcode', label: 'Auto-generate Barcode', type: 'toggle' },
      { key: 'scanner_buffer_gap', label: 'Scanner Buffer Gap (ms)', type: 'number' },
    ],
  },
  {
    key: 'customer', label: 'Customer / Udhaar Settings',
    settings: [
      { key: 'udhaar_enabled', label: 'Enable Udhaar (Credit)', type: 'toggle' },
      { key: 'default_credit_limit', label: 'Default Credit Limit (Rs)', type: 'number' },
      { key: 'max_credit_limit', label: 'Max Credit Limit (Rs)', type: 'number' },
      { key: 'udhaar_interest_rate', label: 'Udhaar Interest Rate (%/month)', type: 'number' },
      { key: 'payment_due_days', label: 'Payment Due Days', type: 'number' },
      { key: 'loyalty_enabled', label: 'Enable Loyalty Program', type: 'toggle' },
      { key: 'points_per_rupee', label: 'Points per Rupee Spent', type: 'number' },
    ],
  },
  {
    key: 'reports', label: 'Reports Settings',
    settings: [
      { key: 'daily_report_time', label: 'Daily Report Time', type: 'text', hint: 'HH:MM format (e.g. 22:00)' },
      { key: 'weekly_report_day', label: 'Weekly Report Day', type: 'select', options: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] },
      { key: 'monthly_report_date', label: 'Monthly Report Date (1-28)', type: 'number' },
      { key: 'report_send_email', label: 'Send Reports via Email', type: 'toggle' },
      { key: 'report_send_whatsapp', label: 'Send Reports via WhatsApp', type: 'toggle' },
    ],
  },
  {
    key: 'alerts', label: 'Alerts & Notifications',
    settings: [
      { key: 'low_stock_alert_enabled', label: 'Low Stock Alert', type: 'toggle' },
      { key: 'low_stock_threshold', label: 'Low Stock Threshold', type: 'number' },
      { key: 'expiry_alert_enabled', label: 'Expiry Alert', type: 'toggle' },
      { key: 'udhaar_reminder_enabled', label: 'Udhaar Reminder', type: 'toggle' },
      { key: 'udhaar_reminder_time', label: 'Udhaar Reminder Time', type: 'text', hint: 'HH:MM format (e.g. 07:00)' },
      { key: 'high_discount_alert_threshold', label: 'High Discount Alert Threshold (%)', type: 'number' },
      { key: 'login_alert_enabled', label: 'Login Alert', type: 'toggle' },
    ],
  },
  {
    key: 'security', label: 'Security Settings',
    settings: [
      { key: 'min_password_length', label: 'Min Password Length', type: 'number' },
      { key: 'require_uppercase', label: 'Require Uppercase Letters', type: 'toggle' },
      { key: 'require_numbers', label: 'Require Numbers', type: 'toggle' },
      { key: 'require_special_chars', label: 'Require Special Characters', type: 'toggle' },
      { key: 'password_expiry_days', label: 'Password Expiry (days)', type: 'number' },
      { key: 'session_timeout_minutes', label: 'Session Timeout (minutes)', type: 'number' },
      { key: 'allow_remember_me', label: 'Allow Remember Me', type: 'toggle' },
      { key: 'two_factor_enabled', label: 'Two-Factor Authentication', type: 'toggle' },
      { key: 'two_factor_method', label: '2FA Method', type: 'select', options: ['email', 'sms', 'authenticator'] },
    ],
  },
  {
    key: 'theme', label: 'Theme & UI',
    settings: [
      { key: 'theme', label: 'Theme', type: 'select', options: ['light', 'dark', 'auto'] },
      { key: 'primary_color', label: 'Primary Color', type: 'color' },
      { key: 'font_size', label: 'Font Size', type: 'select', options: ['small', 'normal', 'large'] },
      { key: 'language', label: 'Language', type: 'select', options: ['en', 'ur'] },
      { key: 'wallpaper_image', label: 'Background Wallpaper', type: 'wallpaper' },
    ],
  },
  {
    key: 'backup', label: 'Backup & Recovery',
    settings: [
      { key: 'auto_backup_enabled', label: 'Auto-backup Enabled', type: 'toggle' },
      { key: 'auto_backup_interval', label: 'Backup Interval', type: 'select', options: ['daily', 'weekly', 'monthly'] },
      { key: 'backup_time', label: 'Backup Time', type: 'text', hint: 'HH:MM format' },
      { key: 'backup_retention_days', label: 'Backup Retention (days)', type: 'number' },
      { key: 'encrypt_backup', label: 'Encrypt Backup', type: 'toggle' },
    ],
  },
  {
    key: 'shift', label: 'Shift Management',
    settings: [
      { key: 'default_opening_cash', label: 'Default Opening Cash (Rs)', type: 'number' },
      { key: 'variance_tolerance', label: 'Variance Tolerance (Rs)', type: 'number' },
      { key: 'require_shift_approval', label: 'Require Shift Approval', type: 'toggle' },
    ],
  },
  {
    key: 'tax', label: 'Tax Settings',
    settings: [
      { key: 'default_tax_rate', label: 'Default Tax Rate (%)', type: 'number' },
      { key: 'tax_inclusive', label: 'Tax Inclusive Pricing', type: 'toggle' },
      { key: 'gst_number', label: 'GST Registration Number', type: 'text' },
    ],
  },
  {
    key: 'business', label: 'Business Logic',
    settings: [
      { key: 'wholesale_margin_percent', label: 'Wholesale Margin (%)', type: 'number' },
      { key: 'minimum_profit_margin', label: 'Minimum Profit Margin (%)', type: 'number' },
      { key: 'markup_percent', label: 'Default Markup (%)', type: 'number' },
    ],
  },
];

export default function SystemSettings() {
  const [settings, setSettings] = useState<AdminSettingsMap>({});
  const [activeSection, setActiveSection] = useState(SECTIONS[0].key);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    window.api.admin.settings.getAll().then(setSettings).catch((e) => setNotice(String(e)));
  }, []);

  const updateSetting = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const saveAll = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await window.api.admin.settings.setBatch(settings);
      setSaved(true);
      setDirty(false);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const resetDefaults = async () => {
    if (!confirm('Reset ALL settings to defaults? This cannot be undone.')) return;
    setBusy(true);
    try {
      await window.api.admin.settings.resetDefaults();
      const fresh = await window.api.admin.settings.getAll();
      setSettings(fresh);
      setNotice('All settings reset to defaults');
      setTimeout(() => setNotice(null), 2000);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const currentSection = SECTIONS.find((s) => s.key === activeSection) ?? SECTIONS[0];

  const PRESET_COLORS = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0d9488', '#6366f1', '#ec4899'];

  const handlePreview = () => {
    setPreviewing(true);
    const theme = settings.theme || 'light';
    document.body.classList.remove('theme-dark', 'theme-light');
    document.body.classList.add(`theme-${theme}`);
    if (settings.primary_color) {
      document.documentElement.style.setProperty('--primary', settings.primary_color);
    }
    if (settings.font_size) {
      const sizeMap: Record<string, string> = { small: '12px', normal: '14px', large: '16px' };
      document.documentElement.style.fontSize = sizeMap[settings.font_size] || '14px';
    }
    if (settings.wallpaper_image) {
      document.body.style.backgroundImage = `url(${settings.wallpaper_image})`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
      document.body.style.backgroundRepeat = 'no-repeat';
    }
    setTimeout(() => setPreviewing(false), 3000);
  };

  const handleWallpaperUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setNotice('Image too large (max 5MB)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      updateSetting('wallpaper_image', dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const removeWallpaper = () => {
    updateSetting('wallpaper_image', '');
    document.body.style.backgroundImage = '';
    document.body.style.backgroundSize = '';
    document.body.style.backgroundPosition = '';
    document.body.style.backgroundRepeat = '';
  };

  return (
    <div className="admin-sub-page">
      <div className="admin-sub-header">
        <h2>System Settings</h2>
        <div className="admin-sub-actions">
          {dirty && <span className="badge badge-warn">Unsaved changes</span>}
          <button className="btn" onClick={resetDefaults} disabled={busy}>Reset Defaults</button>
          <button className="btn btn-primary" disabled={busy || !dirty} onClick={saveAll}>
            {saved ? 'Saved!' : busy ? 'Saving...' : 'Save All'}
          </button>
        </div>
      </div>

      {notice && <div className="notice" onClick={() => setNotice(null)}>{notice}</div>}

      <div className="settings-layout">
        <div className="settings-nav">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              className={`settings-nav-btn ${activeSection === s.key ? 'active' : ''}`}
              onClick={() => setActiveSection(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="settings-content">
          <h3 style={{ marginBottom: 16 }}>{currentSection.label}</h3>
          {activeSection === 'theme' && (
            <div style={{ marginBottom: 16 }}>
              <button className="btn btn-sm" onClick={handlePreview} disabled={previewing}>
                {previewing ? 'Previewing...' : 'Preview Theme'}
              </button>
            </div>
          )}
          {currentSection.settings.map((s) => (
            <label key={s.key} className="admin-setting-item">
              <div className="admin-setting-label">
                <span>{s.label}</span>
                {s.hint && <span className="muted small">{s.hint}</span>}
              </div>
              {s.type === 'toggle' ? (
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={settings[s.key] === 'true'}
                    onChange={(e) => updateSetting(s.key, e.target.checked ? 'true' : 'false')}
                  />
                  <span className="toggle-slider" />
                </label>
              ) : s.type === 'select' ? (
                <select
                  value={settings[s.key] ?? ''}
                  onChange={(e) => updateSetting(s.key, e.target.value)}
                  className="admin-setting-select"
                >
                  {s.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : s.type === 'color' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="color"
                    value={settings[s.key] || '#2563eb'}
                    onChange={(e) => updateSetting(s.key, e.target.value)}
                    style={{ width: 40, height: 32, padding: 0, border: 'none', cursor: 'pointer' }}
                  />
                  <input
                    type="text"
                    value={settings[s.key] ?? ''}
                    onChange={(e) => updateSetting(s.key, e.target.value)}
                    className="admin-setting-input"
                    style={{ flex: 1 }}
                    placeholder="#2563eb"
                  />
                </div>
              ) : s.type === 'wallpaper' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {settings.wallpaper_image && (
                    <div style={{ position: 'relative', width: '100%', maxHeight: 120, overflow: 'hidden', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <img src={settings.wallpaper_image} alt="Wallpaper preview" style={{ width: '100%', height: 120, objectFit: 'cover' }} />
                      <button className="btn btn-danger btn-sm" onClick={removeWallpaper} style={{ position: 'absolute', top: 4, right: 4 }}>Remove</button>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-sm" onClick={() => wallpaperInputRef.current?.click()}>
                      {settings.wallpaper_image ? 'Change Wallpaper' : 'Upload Wallpaper'}
                    </button>
                    <input ref={wallpaperInputRef} type="file" accept="image/*" onChange={handleWallpaperUpload} style={{ display: 'none' }} />
                  </div>
                  <span className="muted small">Max 5MB. Supports JPG, PNG, WebP.</span>
                </div>
              ) : (
                <input
                  type={s.type}
                  value={settings[s.key] ?? ''}
                  onChange={(e) => updateSetting(s.key, e.target.value)}
                  className="admin-setting-input"
                />
              )}
            </label>
          ))}
          {activeSection === 'theme' && settings.primary_color && (
            <div style={{ marginTop: 16 }}>
              <div className="muted small" style={{ marginBottom: 8 }}>Preset Colors:</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => updateSetting('primary_color', c)}
                    style={{
                      width: 28, height: 28, borderRadius: '50%', border: settings.primary_color === c ? '3px solid var(--text)' : '2px solid var(--border)',
                      background: c, cursor: 'pointer', padding: 0,
                    }}
                    title={c}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
