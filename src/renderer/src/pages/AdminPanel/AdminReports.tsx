import { useEffect, useState } from 'react';
import type { SystemHealth } from '../../../../shared/types';

export default function AdminReports() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);

  useEffect(() => {
    window.api.admin.systemHealth().then(setHealth).catch((e) => setNotice(String(e)));
  }, []);

  const formatBytes = (b: number) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatUptime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const handleBackup = async () => {
    setBackupBusy(true);
    setNotice(null);
    try {
      const r = await window.api.backup.run();
      setNotice(`Backup saved: ${r.localPath}`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
    setBackupBusy(false);
  };

  return (
    <div className="admin-sub-page">
      <div className="admin-sub-header">
        <h2>System Reports & Health</h2>
      </div>

      {notice && <div className="notice" onClick={() => setNotice(null)}>{notice}</div>}

      {health && (
        <div className="health-grid">
          <div className="health-card">
            <div className="health-card-title">Users</div>
            <div className="health-card-value">{health.total_users}</div>
            <div className="health-card-sub muted small">{health.active_users} active</div>
          </div>
          <div className="health-card">
            <div className="health-card-title">Products</div>
            <div className="health-card-value">{health.total_products}</div>
          </div>
          <div className="health-card">
            <div className="health-card-title">Total Sales</div>
            <div className="health-card-value">{health.total_sales.toLocaleString()}</div>
          </div>
          <div className="health-card">
            <div className="health-card-title">Customers</div>
            <div className="health-card-value">{health.total_customers.toLocaleString()}</div>
          </div>
          <div className="health-card">
            <div className="health-card-title">Database Size</div>
            <div className="health-card-value">{formatBytes(health.db_size_bytes)}</div>
          </div>
          <div className="health-card">
            <div className="health-card-title">Uptime</div>
            <div className="health-card-value">{formatUptime(health.uptime_seconds)}</div>
          </div>
        </div>
      )}

      <div className="health-section" style={{ marginTop: 24 }}>
        <h3>Backup</h3>
        <p className="muted small" style={{ marginBottom: 12 }}>
          Create a manual backup of the database. Backups are stored in your Documents folder.
        </p>
        <button className="btn btn-primary" disabled={backupBusy} onClick={handleBackup}>
          {backupBusy ? 'Backing up...' : 'Backup Now'}
        </button>
      </div>

      <div className="health-section" style={{ marginTop: 24 }}>
        <h3>Database Info</h3>
        {health && (
          <div className="muted small" style={{ marginTop: 8 }}>
            <p>Path: <code>{health.db_path}</code></p>
            <p>Size: {formatBytes(health.db_size_bytes)}</p>
          </div>
        )}
      </div>
    </div>
  );
}
