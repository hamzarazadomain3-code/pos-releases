import { useEffect, useState } from 'react';
import type { AdminSettingsMap } from '../../../../shared/types';

interface Section {
  key: string;
  label: string;
  settings: { key: string; label: string; type: 'text' | 'number' | 'toggle' | 'select'; options?: string[]; hint?: string }[];
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
      { key: 'receipt_font_size', label: 'Receipt Font Size', type: 'number' },
      { key: 'auto_print_receipt', label: 'Auto-print Receipt', type: 'toggle' },
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
      { key: 'primary_color', label: 'Primary Color', type: 'text' },
      { key: 'font_size', label: 'Font Size', type: 'select', options: ['small', 'normal', 'large'] },
      { key: 'language', label: 'Language', type: 'select', options: ['en', 'ur'] },
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
        </div>
      </div>
    </div>
  );
}
