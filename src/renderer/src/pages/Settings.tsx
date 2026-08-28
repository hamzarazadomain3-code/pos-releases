import { useEffect, useState } from 'react';
import type { ActivityRow, ScalePluMapping, SettingsMap, WhatsAppStatus } from '../../../shared/types';

export default function Settings() {
  const [settings, setSettings] = useState<SettingsMap>({});
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
  const [waTestText, setWaTestText] = useState('Test message from ShopKeeper POS ✓');
  const [waBusy, setWaBusy] = useState(false);
  const [waConnecting, setWaConnecting] = useState(false);
  const [pluMappings, setPluMappings] = useState<ScalePluMapping[]>([]);

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
  }, []);

  async function saveShop() {
    for (const [k, v] of Object.entries(settings)) {
      await window.api.settings.set(k, v);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  // Handle logo upload: read as DataURL and store in settings
  const handleLogoUpload = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setSettings((prev) => ({ ...prev, shop_logo: reader.result as string }));
    };
    reader.readAsDataURL(file);
  };

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
                <input
                  type="number"
                  min={1}
                  value={settings.expiry_warning_days ?? '30'}
                  onChange={(e) => setSettings({ ...settings, expiry_warning_days: e.target.value })}
                />
                <span className="muted small">Items expiring within this many days show in the "Expiring Soon" dashboard widget (default 30).</span>
              </label>
              <label className="field">
                <span>Shop Logo</span>
                <input type="file" accept="image/*" onChange={handleLogoUpload} />
                {settings.shop_logo ? (
                  <div className="logo-upload-row">
                    <img src={settings.shop_logo} alt="Shop logo" className="logo-preview" />
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => setSettings({ ...settings, shop_logo: '' })}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <span className="muted small">Shows on the receipt, login screen and sidebar. Upload then click Save.</span>
                )}
              </label>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={saveShop}>
                {saved ? 'Saved!' : 'Save'}
              </button>
            </div>
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
              Last backup: {settings.last_backup ? new Date(settings.last_backup).toLocaleString() : 'never'}
            </p>
            <p className="muted small">
              Last cloud sync:{' '}
              {settings.last_cloud_backup ? new Date(settings.last_cloud_backup).toLocaleString() : 'never'}
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
        </div>
      </div>
    </div>
    
    {/* License panel */}
    <div className="panel">
      <div className="panel-title">License</div>
      <div className="settings-form">
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
                  <td>{a.created_at ? new Date(a.created_at).toLocaleString() : '—'}</td>
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
    </div>
  );
}