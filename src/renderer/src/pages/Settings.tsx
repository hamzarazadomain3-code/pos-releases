import { useEffect, useState } from 'react';
import type {
  ActivityRow,
  PrinterInfo,
  PrinterSettingsSnapshot,
  ScalePluMapping,
  SettingsMap,
  TrialStatus,
  WhatsAppStatus,
} from '../../../shared/types';
import { formatTimestamp, formatDateTimeAdmin } from '../utils/dateUtils';
import { Modal } from '../components/Modal';
import { KeyboardInput } from '../components/KeyboardInput';
import { ImageField } from '../components/ImageField';
import { useKeyboardScope } from '../hooks/useKeyboardScope';
import ReceiptDesigner from './ReceiptDesigner';

export default function Settings() {
  const [settings, setSettings] = useState<SettingsMap>({});
  // Null = not a trial, so the panel is hidden entirely for licensed shops.
  const [trial, setTrial] = useState<TrialStatus | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [backupPath, setBackupPath] = useState<string | null>(null);
  const [version, setVersion] = useState('');
  const [updateState, setUpdateState] = useState<string>('idle');
  const [updateDetail, setUpdateDetail] = useState<string>('');
  const [waStatus, setWaStatus] = useState<WhatsAppStatus | null>(null);
  const [waQr, setWaQr] = useState<string | null>(null);
  const [waTestPhone, setWaTestPhone] = useState('');
  const [waTestText, setWaTestText] = useState('Test message from Rokar POS ✓');
  const [waBusy, setWaBusy] = useState(false);
  const [waConnecting, setWaConnecting] = useState(false);
  const [pluMappings, setPluMappings] = useState<ScalePluMapping[]>([]);
  const [receiptTemplates, setReceiptTemplates] = useState<Array<{ id: string; name: string; description: string; width: string }>>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('standard');
  const [designerOpen, setDesignerOpen] = useState(false);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [printSettings, setPrintSettings] = useState<PrinterSettingsSnapshot | null>(null);
  const [printBusy, setPrintBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [branches, setBranches] = useState<Array<{ id: number; name: string }>>([]);

  useEffect(() => {
    window.api.settings.getAll().then(setSettings).catch((e) => setNotice(e.message));
    window.api.activity.list(100).then(setActivity).catch((e) => setNotice(e.message));
    window.api.app.getVersion().then(setVersion).catch(() => undefined);
    const off = window.api.updater.onStatus((s) => {
      setUpdateState(s.state);
      setUpdateDetail(s.detail ?? '');
    });
    window.api.updater.getState().then(setUpdateState).catch(() => undefined);
    window.api.whatsapp.getStatus().then(setWaStatus).catch(() => setWaStatus(null));
    const offQr = window.api.whatsapp.onQr((qr) => setWaQr(qr));
    const offWaStatus = window.api.whatsapp.onStatus((s) => {
      setWaStatus({ connected: s.connected, phone: s.phone ?? null, qr: null, error: s.error ?? null });
      if (s.connected) setWaQr(null);
    });
    const poll = setInterval(async () => {
      try {
        const s = await window.api.whatsapp.getStatus();
        setWaStatus(s);
        if (s.qr) setWaQr(s.qr);
        if (s.connected) setWaQr(null);
      } catch {
        // ignore transient failures
      }
    }, 2500);
    return () => {
      clearInterval(poll);
      off();
      offQr();
      offWaStatus();
    };
  }, []);

  useEffect(() => {
    window.api.scaleBarcode.listPluMappings().then(setPluMappings).catch(() => setPluMappings([]));
    window.api.receipt.getTemplates().then(setReceiptTemplates).catch(() => setReceiptTemplates([]));
    window.api.admin.settings.get('receipt_template').then((v) => {
      if (v) setSelectedTemplate(v);
    }).catch(() => undefined);
    window.api.branches.list().then(setBranches).catch(() => setBranches([]));
    window.api.printing.getPrinters().then(setPrinters).catch(() => setPrinters([]));
    window.api.printing.getPrinterSettings().then(setPrintSettings).catch(() => undefined);
    // Poll the countdown rather than reading it once: the whole point of showing
    // "N of 15 days left" is that it moves. Cheap — it is a local settings read.
    const loadTrial = () =>
      window.api.licensing
        .trialStatus()
        .then((t) => setTrial(t.isTrial ? t : null))
        .catch(() => setTrial(null));
    loadTrial();
    const trialPoll = setInterval(loadTrial, 60_000);
    return () => clearInterval(trialPoll);
  }, []);

  async function saveShop() {
    for (const [k, v] of Object.entries(settings)) {
      await window.api.settings.set(k, v);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const actionLabel = (a: string) =>
    ({
      sale_created: 'Sale created',
      sale_voided: 'Sale voided',
      payment_received: 'Payment received',
      stock_adjust: 'Stock adjusted',
      product_created: 'Product created',
      product_updated: 'Product updated',
      product_deleted: 'Product deleted',
    }[a] ?? a);

  useKeyboardScope({
    kind: 'page',
    label: 'Settings',
    actions: {
      save: () => { saveShop(); },
    },
    shortcuts: [{ action: 'save', label: 'Save shop information' }],
  });

  return (
    <div className="page">
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      {notice && (
        <div className="notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}

      <div className="settings-grid">
        <div className="panel">
          <div className="panel-title">Shop Information</div>
          <div className="settings-form">
            {(
              [
                ['shop_name', 'Shop Name'],
                ['shop_address', 'Address'],
                ['shop_phone', 'Phone'],
                ['shop_whatsapp', 'WhatsApp'],
                ['receipt_footer', 'Receipt Footer'],
                ['currency', 'Currency Symbol'],
              ] as [string, string][]
              ).map(([key, label]) => (
                <label className="field" key={key}>
                  <span>{label}</span>
                  <input
                    value={settings[key] ?? ''}
                    onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
                  />
                </label>
              ))}
              <label className="field">
                <span>Expiry warning window (days)</span>
                <KeyboardInput
                  type="text"
                  decimals
                  value={settings.expiry_warning_days ?? '30'}
                  onChange={(e) => setSettings({ ...settings, expiry_warning_days: e.target.value })}
                />
                <span className="muted small">Items expiring within this many days show in the "Expiring Soon" dashboard widget (default 30).</span>
              </label>
              <label className="field">
                <span>Shop Logo</span>
                <ImageField
                  value={settings.shop_logo ?? ''}
                  onChange={(v) => setSettings({ ...settings, shop_logo: v })}
                  maxDim={512}
                  buttonText="Upload from PC"
                  previewClassName="logo-preview"
                  hint="Shows on the receipt, login screen and sidebar. Upload then click Save."
                />
              </label>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={saveShop}>
                {saved ? 'Saved!' : 'Save'}
              </button>
            </div>
          </div>
        </div>

        {/* ── Shop Profile (Extended) ── */}
        <div className="panel">
          <div className="panel-title">Shop Profile</div>
          <div className="settings-form">
            <p className="muted small" style={{ marginBottom: 12 }}>
              Extended shop profile for receipts, invoices, and reports. Fields marked with * are required.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Shop Name *</label>
                <input
                  value={settings.shop_name ?? ''}
                  onChange={(e) => setSettings({ ...settings, shop_name: e.target.value })}
                  placeholder="e.g. Ahmed General Store"
                />
              </div>

              <div className="form-group">
                <label>Shop Name (Urdu)</label>
                <input
                  value={settings.shop_name_urdu ?? ''}
                  onChange={(e) => setSettings({ ...settings, shop_name_urdu: e.target.value })}
                  placeholder="Urdu name (optional)"
                  dir="rtl"
                />
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Address</label>
                <textarea
                  value={settings.shop_address ?? ''}
                  onChange={(e) => setSettings({ ...settings, shop_address: e.target.value })}
                  placeholder="Street, City, Area"
                  rows={3}
                  style={{ width: '100%' }}
                />
              </div>

              <div className="form-group">
                <label>Phone</label>
                <input
                  value={settings.shop_phone ?? ''}
                  onChange={(e) => setSettings({ ...settings, shop_phone: e.target.value })}
                  placeholder="e.g. 0300-1234567"
                />
              </div>

              <div className="form-group">
                <label>WhatsApp</label>
                <input
                  value={settings.shop_whatsapp ?? ''}
                  onChange={(e) => setSettings({ ...settings, shop_whatsapp: e.target.value })}
                  placeholder="e.g. 0300-1234567"
                />
              </div>

              <div className="form-group">
                <label>Email</label>
                <input
                  value={settings.shop_email ?? ''}
                  onChange={(e) => setSettings({ ...settings, shop_email: e.target.value })}
                  placeholder="e.g. shop@example.com"
                  type="email"
                />
              </div>

              <div className="form-group">
                <label>Website</label>
                <input
                  value={settings.shop_website ?? ''}
                  onChange={(e) => setSettings({ ...settings, shop_website: e.target.value })}
                  placeholder="e.g. www.myshop.com"
                />
              </div>

              <div className="form-group">
                <label>NTN</label>
                <input
                  value={settings.shop_ntn ?? ''}
                  onChange={(e) => setSettings({ ...settings, shop_ntn: e.target.value })}
                  placeholder="National Tax Number"
                />
              </div>

              <div className="form-group">
                <label>STRN</label>
                <input
                  value={settings.shop_strn ?? ''}
                  onChange={(e) => setSettings({ ...settings, shop_strn: e.target.value })}
                  placeholder="Sales Tax Registration Number"
                />
              </div>

              <div className="form-group">
                <label>Currency</label>
                <select
                  value={settings.currency ?? 'Rs'}
                  onChange={(e) => setSettings({ ...settings, currency: e.target.value })}
                >
                  <option value="Rs">Rs (Pakistani Rupee)</option>
                  <option value="$">$ (US Dollar)</option>
                  <option value="€">€ (Euro)</option>
                </select>
              </div>

              <div className="form-group">
                <label>Currency Position</label>
                <select
                  value={settings.currency_position ?? 'before'}
                  onChange={(e) => setSettings({ ...settings, currency_position: e.target.value as 'before' | 'after' })}
                >
                  <option value="before">Before amount (Rs 100)</option>
                  <option value="after">After amount (100 Rs)</option>
                </select>
              </div>

              <div className="form-group">
                <label>Date Format</label>
                <select
                  value={settings.date_format ?? 'dd/mm/yyyy'}
                  onChange={(e) => setSettings({ ...settings, date_format: e.target.value })}
                >
                  <option value="dd/mm/yyyy">DD/MM/YYYY</option>
                  <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                  <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                </select>
              </div>

              <div className="form-group">
                <label>Language</label>
                <select
                  value={settings.language ?? 'en'}
                  onChange={(e) => setSettings({ ...settings, language: e.target.value as 'en' | 'ur' })}
                >
                  <option value="en">English</option>
                  <option value="ur">اردو (Urdu)</option>
                </select>
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Receipt Footer</label>
                <textarea
                  value={settings.receipt_footer ?? ''}
                  onChange={(e) => setSettings({ ...settings, receipt_footer: e.target.value })}
                  placeholder="e.g. Thank you for shopping with us!"
                  rows={2}
                  style={{ width: '100%' }}
                />
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Terms & Conditions</label>
                <textarea
                  value={settings.receipt_terms_text ?? ''}
                  onChange={(e) => setSettings({ ...settings, receipt_terms_text: e.target.value })}
                  placeholder="Terms & conditions (optional)"
                  rows={2}
                  style={{ width: '100%' }}
                />
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Return Policy</label>
                <textarea
                  value={settings.receipt_return_policy ?? ''}
                  onChange={(e) => setSettings({ ...settings, receipt_return_policy: e.target.value })}
                  placeholder="Return policy (optional)"
                  rows={2}
                  style={{ width: '100%' }}
                />
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Thank You Message</label>
                <textarea
                  value={settings.receipt_thank_you ?? ''}
                  onChange={(e) => setSettings({ ...settings, receipt_thank_you: e.target.value })}
                  placeholder="Thank you message (optional)"
                  rows={2}
                  style={{ width: '100%' }}
                />
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Software Credit</label>
                <input
                  value={settings.receipt_software_by ?? ''}
                  onChange={(e) => setSettings({ ...settings, receipt_software_by: e.target.value })}
                  placeholder="Software credit text (optional)"
                />
                <span className="muted small">Leave empty to hide the software credit line on receipts.</span>
              </div>

              <div className="form-group">
                <label>Receipt Language</label>
                <select
                  value={settings.receipt_language ?? 'en'}
                  onChange={(e) => setSettings({ ...settings, receipt_language: e.target.value })}
                >
                  <option value="en">English</option>
                  <option value="ur">اردو (Urdu)</option>
                </select>
              </div>

              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={settings.receipt_show_items_summary === 'true'}
                    onChange={(e) => setSettings({ ...settings, receipt_show_items_summary: e.target.checked ? 'true' : 'false' })}
                  />
                  <span>Show items summary (Items: N, Qty: X)</span>
                </label>
              </div>

              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={settings.receipt_show_payment_method === 'true'}
                    onChange={(e) => setSettings({ ...settings, receipt_show_payment_method: e.target.checked ? 'true' : 'false' })}
                  />
                  <span>Show payment method on receipt</span>
                </label>
              </div>

              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={settings.receipt_show_tax_on_receipt === 'true'}
                    onChange={(e) => setSettings({ ...settings, receipt_show_tax_on_receipt: e.target.checked ? 'true' : 'false' })}
                  />
                  <span>Show tax on receipt</span>
                </label>
              </div>

              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={settings.receipt_show_software_credit === 'true'}
                    onChange={(e) => setSettings({ ...settings, receipt_show_software_credit: e.target.checked ? 'true' : 'false' })}
                  />
                  <span>Show software credit on receipt</span>
                </label>
              </div>

              <div className="form-group">
                <label>Show payment method on receipt</label>
                <select
                  value={settings.receipt_show_payment_method ?? 'true'}
                  onChange={(e) => setSettings({ ...settings, receipt_show_payment_method: e.target.value })}
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>

              {/* Branch Address Overrides */}
              <div style={{ gridColumn: '1 / -1', marginTop: '8px', padding: '12px', background: '#f8f9fa', borderRadius: '6px' }}>
                <h4 style={{ margin: '0 0 8px' }}>Branch Address Overrides</h4>
                <p className="muted small" style={{ marginBottom: 8 }}>Set custom address per branch for receipts printed at that location.</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
                  {branches.length > 0 ? (
                    branches.map((branch: any) => (
                      <div key={branch.id} className="form-group">
                        <label>{branch.name} Address Override</label>
                        <input
                          value={settings[`branch_${branch.id}_address`] ?? ''}
                          onChange={(e) => setSettings({ ...settings, [`branch_${branch.id}_address`]: e.target.value })}
                          placeholder={`Address override for ${branch.name}`}
                        />
                      </div>
                    ))
                  ) : (
                    <p className="muted small">No branches configured. Add branches in the Branches page first.</p>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={saveShop}>
                {saved ? 'Saved!' : 'Save'}
              </button>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">Printers &amp; Paper</div>
          <div className="settings-form">
            <p className="muted small">
              Pick a printer for each document type. If a printer is left on <strong>Ask every time</strong>, Windows
              shows its print dialog each time so the job can never silently go to the wrong device.
              Printers marked <em>file output</em> (XPS, PDF, OneNote, Fax) do not print to paper.
            </p>

            {(['receipt', 'invoice', 'label'] as const).map((slot) => {
              const printerKey = `${slot}Printer` as const;
              const paperKey = `${slot}Paper` as const;
              const title = slot === 'receipt' ? 'Receipts' : slot === 'invoice' ? 'Invoices' : 'Barcode Labels';
              const currentPrinter = printSettings?.[printerKey] ?? 'auto';
              const currentPaper = printSettings?.[paperKey] ?? '';
              const paperOptions =
                slot === 'receipt'
                  ? Object.entries(printSettings?.papers ?? {}).filter(([k]) => k.startsWith('thermal'))
                  : slot === 'invoice'
                    ? Object.entries(printSettings?.papers ?? {}).filter(([k]) => k === 'a4' || k === 'a5')
                    : Object.entries(printSettings?.labelSizes ?? {});
              return (
                <div
                  key={slot}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    padding: '10px 12px',
                    marginBottom: '10px',
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: '8px' }}>{title}</div>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <label className="field" style={{ flex: '1 1 260px' }}>
                      <span>Printer</span>
                      <select
                        value={currentPrinter}
                        onChange={async (e) => {
                          const v = e.target.value;
                          setPrintSettings((s) => (s ? { ...s, [printerKey]: v } : s));
                          const r = await window.api.printing.setPrinter(slot, v);
                          if (!r.ok) setNotice(r.message);
                          else setNotice(`${title} printer saved.`);
                        }}
                      >
                        <option value="auto">Ask every time (show Windows dialog)</option>
                        <option value="default">System default printer (print silently)</option>
                        {printers.map((p) => (
                          <option key={p.name} value={p.name}>
                            {p.displayName}
                            {p.isDefault ? ' — Windows default' : ''}
                            {p.isVirtual ? ' [file output / no paper]' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field" style={{ flex: '0 1 220px' }}>
                      <span>Paper / size</span>
                      <select
                        value={currentPaper}
                        onChange={async (e) => {
                          const v = e.target.value;
                          setPrintSettings((s) => (s ? { ...s, [paperKey]: v } : s));
                          const r = await window.api.printing.setPaper(slot, v);
                          if (!r.ok) setNotice(r.message);
                          else setNotice(`${title} paper saved.`);
                        }}
                      >
                        {paperOptions.map(([k, v]) => {
                          const spec = v as { label?: string; w?: number; h?: number; widthMm?: number; contentMm?: number };
                          const detail =
                            spec.w != null
                              ? `${spec.w} × ${spec.h}mm`
                              : `${spec.widthMm}mm paper / ${spec.contentMm}mm printable`;
                          return (
                            <option key={k} value={k}>
                              {spec.label ?? k} ({detail})
                            </option>
                          );
                        })}
                      </select>
                    </label>
                  </div>
                  {slot === 'label' && (
                    <div style={{ marginTop: '8px' }}>
                      <label className="field" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>Media</span>
                        <select
                          value={printSettings?.labelLayout ?? 'roll'}
                          onChange={async (e) => {
                            const v = e.target.value;
                            setPrintSettings((s) => (s ? { ...s, labelLayout: v as 'roll' | 'sheet' } : s));
                            await window.api.printing.setLabelLayout(v);
                          }}
                          style={{ width: 'auto' }}
                        >
                          <option value="roll">Label roll (one label across)</option>
                          <option value="sheet">A4 label sheet (grid)</option>
                        </select>
                      </label>
                      <label className="field" style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                        <span>Barcode DPI</span>
                        <select
                          value={printSettings?.barcodeDpi ?? 203}
                          onChange={async (e) => {
                            const n = parseInt(e.target.value) || 203;
                            setPrintSettings((s) => (s ? { ...s, barcodeDpi: n } : s));
                            const r = await window.api.admin.settings.set('barcode_dpi', String(n));
                            if (r !== true) setNotice('Could not save the barcode DPI.');
                          }}
                          style={{ width: 'auto' }}
                        >
                          <option value={203}>203 dpi (most label printers)</option>
                          <option value={300}>300 dpi</option>
                        </select>
                        <span className="muted small">Match your label printer's head so barcode bars snap to whole dots.</span>
                      </label>
                    </div>
                  )}
                </div>
              );
            })}

            <label
              className="field"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' }}
            >
              <input
                type="checkbox"
                checked={printSettings?.printMode === 'dialog'}
                onChange={async (e) => {
                  const v = e.target.checked ? 'dialog' : 'silent';
                  setPrintSettings((s) => (s ? { ...s, printMode: v } : s));
                  try {
                    const r = await window.api.admin.settings.set('print_mode', v);
                    if (r !== true) setNotice('Could not save the print dialog preference.');
                    else
                      setNotice(
                        v === 'dialog'
                          ? 'Every print will now ask which printer to use.'
                          : 'Prints will use the printer chosen above.'
                      );
                  } catch (err) {
                    setNotice(err instanceof Error ? err.message : String(err));
                  }
                }}
                style={{ width: 'auto' }}
              />
              <span>
                Always ask which printer to use
                <span className="muted small"> — overrides the choices above and opens the Windows dialog for every print.</span>
              </span>
            </label>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
              <button
                className="btn"
                onClick={async () => {
                  setPrintBusy(true);
                  setNotice(null);
                  try {
                    const r = await window.api.printing.printTestSheet('receipt');
                    setNotice(r.ok ? r.message : r.message);
                  } catch (e) {
                    setNotice(e instanceof Error ? e.message : String(e));
                  } finally {
                    setPrintBusy(false);
                  }
                }}
                disabled={printBusy}
              >
                {printBusy ? 'Sending…' : 'Print Test Page (Receipt)'}
              </button>
              <button
                className="btn"
                onClick={async () => {
                  setPrintBusy(true);
                  setNotice(null);
                  try {
                    const r = await window.api.printing.printTestSheet('a4');
                    setNotice(r.message);
                  } catch (e) {
                    setNotice(e instanceof Error ? e.message : String(e));
                  } finally {
                    setPrintBusy(false);
                  }
                }}
                disabled={printBusy}
              >
                Print Test Page (A4 Invoice)
              </button>
            </div>
            <p className="muted small" style={{ marginTop: '6px' }}>
              Test pages print a millimetre ruler and black bars across the full printable width, so you can confirm the
              paper is 58mm or 80mm and that nothing is cut off on the right edge.
            </p>
            <p className="muted small">
              The cash drawer is wired into the till's receipt printer, so it follows the <strong>Receipts</strong>{' '}
              setting above.
            </p>
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">Receipt Template</div>
          <div className="settings-form">
            <p className="muted small">
              Choose the receipt layout used when printing or previewing receipts. This affects the width, font, and overall design.
            </p>
            <label className="field">
              <span>Template</span>
              <select
                value={selectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value)}
              >
                {receiptTemplates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} — {t.description}</option>
                ))}
              </select>
            </label>
            {receiptTemplates.filter((t) => t.id === selectedTemplate).map((t) => (
              <div key={t.id} className="muted small" style={{ marginTop: 4 }}>
                Width: {t.width}
              </div>
            ))}
            <div className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    await window.api.admin.settings.set('receipt_template', selectedTemplate);
                    setNotice('Receipt template saved!');
                  } catch (e) {
                    setNotice(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                Save Template
              </button>
              <button
                className="btn"
                disabled={previewBusy}
                onClick={async () => {
                  setPreviewBusy(true);
                  try {
                    // Preview renders the EXACT HTML the printer builds, so a
                    // template choice can be verified before it is saved.
                    const sales = await window.api.sales.list(
                      undefined, undefined, false, undefined, undefined, undefined,
                      undefined, undefined, undefined, undefined, 'date', 'desc'
                    );
                    const sale = sales && sales[0];
                    if (!sale) {
                      setNotice('No sale exists yet — make a test sale to preview the receipt.');
                      return;
                    }
                    await window.api.printing.previewReceipt(sale.id, selectedTemplate);
                  } catch (e) {
                    setNotice(e instanceof Error ? e.message : String(e));
                  } finally {
                    setPreviewBusy(false);
                  }
                }}
              >
                {previewBusy ? 'Opening…' : 'Preview Receipt'}
              </button>
              <button className="btn" onClick={() => setDesignerOpen(true)}>
                Receipt Designer
              </button>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">Appearance</div>
          <div className="settings-form">
            <label className="field">
              <span>Theme</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className={`btn btn-sm ${!document.body.classList.contains('theme-dark') ? 'btn-primary' : ''}`}
                  onClick={() => {
                    document.body.classList.remove('theme-dark');
                    localStorage.setItem('theme', 'light');
                    window.api.admin.settings.set('theme', 'light').catch(() => undefined);
                  }}
                >
                  ☀ Light
                </button>
                <button
                  className={`btn btn-sm ${document.body.classList.contains('theme-dark') ? 'btn-primary' : ''}`}
                  onClick={() => {
                    document.body.classList.add('theme-dark');
                    localStorage.setItem('theme', 'dark');
                    window.api.admin.settings.set('theme', 'dark').catch(() => undefined);
                  }}
                >
                  ☾ Dark
                </button>
              </div>
              <span className="muted small">Switch between light and dark mode. Your choice is saved and applied app-wide.</span>
            </label>
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">Backup</div>
          <div className="settings-form">
            <p className="muted small">
              A local backup runs automatically once per day to your Documents folder — even fully offline. If you select
              your OneDrive / Google Drive sync folder below, each backup is also copied there and synced to the cloud by
              your Drive app.
            </p>
            <label className="field">
              <span>Cloud sync folder</span>
              <div className="inline-row">
                <input
                  readOnly
                  value={settings.cloud_backup_folder ?? ''}
                  placeholder="Not configured — click Choose Folder"
                  onClick={() => setNotice('Use "Choose Folder" to pick your OneDrive / Drive folder')}
                />
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    const p = await window.api.settings.chooseCloudFolder();
                    if (p) {
                      await window.api.settings.set('cloud_backup_folder', p);
                      setSettings({ ...settings, cloud_backup_folder: p });
                    }
                  }}
                >
                  Choose Folder
                </button>
                {settings.cloud_backup_folder && (
                  <button
                    className="btn"
                    onClick={async () => {
                      await window.api.settings.set('cloud_backup_folder', '');
                      setSettings({ ...settings, cloud_backup_folder: '' });
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </label>
            {settings.cloud_backup_status && (
              <div className="notice error" style={{ marginBottom: 0, cursor: 'default' }}>
                Cloud backup warning: {settings.cloud_backup_status}
              </div>
            )}
            <p className="muted small">
              Last backup: {settings.last_backup ? formatDateTimeAdmin(settings.last_backup) : 'never'}
            </p>
            <p className="muted small">
              Last cloud sync:{' '}
              {settings.last_cloud_backup ? formatDateTimeAdmin(settings.last_cloud_backup) : 'never'}
            </p>
            <button
              className="btn btn-primary"
              onClick={async () => {
                try {
                  setNotice(null);
                  const r = await window.api.backup.run();
                  setBackupPath(r.localPath);
                  setSettings({ ...settings, last_backup: new Date().toISOString() });
                  if (r.cloudOk && r.cloudPath) {
                    setNotice(`Cloud backup synced: ${r.cloudPath}`);
                  } else if (r.cloudError) {
                    setNotice(r.cloudError);
                  }
                } catch (e) {
                  setNotice(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Backup Now
            </button>
            {backupPath && <p className="small text-ok">Saved: {backupPath}</p>}
            <p className="muted small" style={{ marginTop: 14 }}>
              Restore replaces ALL current data with a previously saved backup file. The main process will verify the file
              first and ask you to confirm before anything is overwritten.
            </p>
            <button
              className="btn"
              onClick={async () => {
                try {
                  setNotice(null);
                  const r = await window.api.backup.restore();
                  setNotice(r.message);
                } catch (e) {
                  setNotice(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Restore Backup…
            </button>
        </div>
      </div>
    </div>
    
    {/* License panel */}
    <div className="panel">
      <div className="panel-title">License</div>
      <div className="settings-form">
        {trial && (
          <div
            className="muted small"
            style={{
              marginBottom: 10,
              padding: '8px 10px',
              borderRadius: 6,
              border: `1px solid ${trial.active ? 'var(--border)' : 'var(--danger)'}`,
              background: trial.active ? 'transparent' : 'rgba(220,80,80,0.08)',
            }}
          >
            {trial.active ? (
              <>
                Free trial — <strong>{trial.daysLeft} of {trial.totalDays} days</strong> left
                {trial.expiresAt && <> (ends {new Date(trial.expiresAt).toLocaleDateString()})</>}.
                {!trial.serverAnchored && (
                  <>
                    {' '}This machine is offline, so the countdown is a local estimate. It will be
                    confirmed — and can only be shortened, never extended — next time the app
                    reaches the server.
                  </>
                )}
              </>
            ) : (
              <>
                The {trial.totalDays}-day free trial has ended. Enter your license key below to keep
                billing.
              </>
            )}
          </div>
        )}
        <label className="field">
          <span>License Key</span>
          <input
            value={settings.license_key ?? ''}
            onChange={e => setSettings({ ...settings, license_key: e.target.value })}
          />
        </label>
        <div className="modal-actions">
          <button
            className="btn btn-primary"
            onClick={async () => {
              try {
                const msg = await window.api.licensing.activate(settings.license_key ?? '');
                setNotice(msg);
                // Re-read immediately: activating a paid key must clear the trial
                // banner at once. Without this it would linger for up to a minute,
                // claiming an active trial for a shop that just paid.
                const t = await window.api.licensing.trialStatus();
                setTrial(t.isTrial ? t : null);
              } catch (e) {
                setNotice(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Activate
          </button>
        </div>
      </div>
    </div>
    
    {/* BayLan Label Scale — PLU mappings panel */}
    <div className="panel" style={{ marginTop: 14 }}>
      <div className="panel-title">BayLan Label Scale — PLU Mappings</div>
      <div className="settings-form">
        <p className="muted small">
          Products with a 5-digit PLU code stored in their Barcode field will appear here. When you scan a
          scale-printed label barcode (starting with "21"), the app decodes the PLU and looks up the product by
          its barcode. Set a product's barcode to its 5-digit PLU code (e.g. "10001") to link them.
        </p>
        {pluMappings.length === 0 ? (
          <p className="muted small">No PLU mappings found. Add a 5-digit PLU code as a product's barcode to map it.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>PLU Code</th>
                <th>Product</th>
                <th>ID</th>
              </tr>
            </thead>
            <tbody>
              {pluMappings.map((m) => (
                <tr key={m.plu}>
                  <td>{m.plu}</td>
                  <td>{m.product_name}</td>
                  <td className="num muted small">{m.product_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small" style={{ marginTop: 8 }}>
          Tip: In Inventory → Edit Product, set the Barcode field to the PLU code (5 digits) from the scale label.
        </p>
      </div>
    </div>

    {/* Update panel */}
    <div className="panel">
      <div className="panel-title">Update</div>
      <div className="settings-form">
        <p className="muted small">
          Current version: <strong>{version || '…'}</strong>. The app checks for updates automatically in the background
          after startup. You can also check manually at any time.
        </p>
        <div className="row-btns">
          <button
            className="btn btn-primary"
            disabled={updateState === 'checking' || updateState === 'downloading' || updateState === 'downloaded' || updateState === 'restarting'}
            onClick={async () => {
              setUpdateState('checking');
              setUpdateDetail('');
              try {
                await window.api.updater.check();
              } catch (e) {
                setNotice(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Check for Updates
          </button>
          {updateState === 'downloaded' && (
            <button className="btn btn-primary" onClick={() => window.api.updater.install()}>
              Restart Now
            </button>
          )}
        </div>
        {updateState === 'checking' && <p className="small muted">Checking for updates…</p>}
        {updateState === 'downloading' && <p className="small muted">Downloading update… {updateDetail}%</p>}
        {updateState === 'up-to-date' && <p className="small text-ok">You are on the latest version.</p>}
        {updateState === 'downloaded' && (
          <p className="small text-ok">Update v{updateDetail} downloaded — restart to install.</p>
        )}
        {updateState === 'error' && <p className="small text-warn">Update check failed: {updateDetail}</p>}
        {updateState === 'restarting' && (
          <Modal
            onClose={() => undefined}
            overlayStyle={{ zIndex: 9999 }}
            style={{ textAlign: 'center', padding: '40px' }}
            closeOnOverlay={false}
          >
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
          </Modal>
        )}
      </div>
    </div>

    {/* WhatsApp Gateway panel */}
    <div className="panel" style={{ marginTop: 14 }}>
      <div className="panel-title">WhatsApp Receipt Alerts</div>
      <div className="settings-form">
        <p className="muted small">
          Connect your shop's WhatsApp to send receipts to customers as messages. Scan the QR below with
          WhatsApp (Menu → Linked Devices) once; the session stays logged in afterwards.
        </p>
        <div className="field">
          <span>Status</span>
          <div>
            {waStatus?.connected ? (
              <span className="text-ok">
                <strong>Connected</strong>
                {waStatus.phone ? ` — ${waStatus.phone}` : ''}
              </span>
            ) : (
              <span className="text-warn">
                <strong>Not connected</strong>
                {waStatus?.error ? ` (${waStatus.error})` : ''} — restart the app or rescan the QR below.
              </span>
            )}
            <div style={{ marginTop: 6 }}>
              <button
                className="btn"
                disabled={waConnecting}
                onClick={async () => {
                  setWaConnecting(true);
                  setWaQr(null);
                  try {
                    const s = await window.api.whatsapp.start();
                    setWaStatus(s);
                    if (s.qr) setWaQr(s.qr);
                  } catch (e) {
                    setNotice(e instanceof Error ? e.message : String(e));
                  } finally {
                    setWaConnecting(false);
                  }
                }}
              >
                {waConnecting ? 'Connecting…' : 'Reconnect / Rescan QR'}
              </button>
            </div>
          </div>
        </div>
        {waQr && (
          <div className="field">
            <span>Scan this QR code with WhatsApp</span>
            <img
              src={waQr}
              alt="WhatsApp QR code"
              style={{ width: 220, height: 220, border: '1px solid #ddd', borderRadius: 4 }}
            />
          </div>
        )}
        <label className="field">
          <span>Test phone number (e.g. 03001234567)</span>
          <input value={waTestPhone} onChange={(e) => setWaTestPhone(e.target.value)} placeholder="03xxxxxxxxx" />
        </label>
        <label className="field">
          <span>Test message</span>
          <input value={waTestText} onChange={(e) => setWaTestText(e.target.value)} />
        </label>
        <div className="modal-actions">
          <button
            className="btn btn-primary"
            disabled={!waTestPhone.trim() || waBusy}
            onClick={async () => {
              setWaBusy(true);
              try {
                const r = await window.api.whatsapp.send(waTestPhone.trim(), waTestText);
                setNotice(r.message);
              } catch (e) {
                setNotice(e instanceof Error ? e.message : String(e));
              } finally {
                setWaBusy(false);
              }
            }}
          >
            {waBusy ? 'Sending…' : 'Send Test Message'}
          </button>
        </div>
      </div>
    </div>

    <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel-title">Activity Log (last 100)</div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Action</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((a) => (
                <tr key={a.id}>
                  <td>{formatTimestamp(a.created_at)}</td>
                  <td>{a.username ?? '—'}</td>
                  <td>{actionLabel(a.action)}</td>
                  <td className="muted">{a.details ?? '—'}</td>
                </tr>
              ))}
              {activity.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted center">
                    No activity recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {designerOpen && <ReceiptDesigner onClose={() => setDesignerOpen(false)} />}
    </div>
  );
}