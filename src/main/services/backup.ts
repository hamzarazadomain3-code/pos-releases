import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, getDbPath } from '../db';
import { setAdminSetting, getAdminSetting } from './admin';
import { getAllSettings, setSetting } from './settings';

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function runLocalBackup(): string {
  const db = getDb();
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');

  // Determine backup directory (custom folder or default)
  const customFolder = getAdminSetting('backup_folder')?.trim();
  const defaultFolder = path.join(app.getPath('documents'), 'ShopKeeper POS', 'backups');
  const dir = customFolder && customFolder !== '' ? customFolder : defaultFolder;

  // Ensure the directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const dest = path.join(dir, `pos-${stamp()}.db`);
  fs.copyFileSync(getDbPath(), dest);

  // Update timestamps in both generic and admin settings for compatibility
  const nowIso = new Date().toISOString();
  setSetting('last_backup', nowIso);
  setAdminSetting('backup_last', nowIso);

  // Cleanup old backups based on retention setting
  try {
    const retentionStr = getAdminSetting('backup_retention_days');
    const retentionDays = retentionStr ? parseInt(retentionStr, 10) : 30;
    const cutoff = Date.now() - retentionDays * 86400000;
    const files = fs.readdirSync(dir);
    for (const f of files) {
      if (!f.startsWith('pos-') || !f.endsWith('.db')) continue;
      const tsPart = f.slice(4, -3); // strip 'pos-' and '.db'
      const m = tsPart.match(/^(\d{8})-(\d{6})$/);
      if (!m) continue;
      const [_, datePart, timePart] = m;
      const year = parseInt(datePart.slice(0, 4), 10);
      const month = parseInt(datePart.slice(4, 6), 10) - 1; // zero‑based month
      const day = parseInt(datePart.slice(6, 8), 10);
      const hour = parseInt(timePart.slice(0, 2), 10);
      const minute = parseInt(timePart.slice(2, 4), 10);
      const second = parseInt(timePart.slice(4, 6), 10);
      const fileTime = new Date(year, month, day, hour, minute, second).getTime();
      if (fileTime < cutoff) {
        try { fs.unlinkSync(path.join(dir, f)); } catch (_) { }
      }
    }
  } catch (_) { /* ignore cleanup errors */ }

  return dest;
}

export interface BackupResult {
  localPath: string;
  cloudPath: string | null;
  cloudOk: boolean;
  cloudError: string | null;
}

export function copyToCloud(localPath: string): { cloudPath: string | null; ok: boolean; error: string | null } {
  const folder = (getAllSettings().cloud_backup_folder ?? '').trim();
  if (!folder) {
    setSetting('cloud_backup_status', '');
    return { cloudPath: null, ok: true, error: null };
  }
  if (!fs.existsSync(folder)) {
    const msg = `Cloud backup folder not found: ${folder}`;
    setSetting('cloud_backup_status', msg);
    return { cloudPath: null, ok: false, error: msg };
  }
  try {
    const dest = path.join(folder, path.basename(localPath));
    fs.copyFileSync(localPath, dest);
    setSetting('last_cloud_backup', new Date().toISOString());
    setSetting('cloud_backup_status', '');
    return { cloudPath: dest, ok: true, error: null };
  } catch (e) {
    const msg = `Cloud backup failed: ${e instanceof Error ? e.message : String(e)}`;
    setSetting('cloud_backup_status', msg);
    return { cloudPath: null, ok: false, error: msg };
  }
}

export function runBackup(): BackupResult {
  const localPath = runLocalBackup();
  const cloud = copyToCloud(localPath);
  return {
    localPath,
    cloudPath: cloud.cloudPath,
    cloudOk: cloud.ok,
    cloudError: cloud.error,
  };
}