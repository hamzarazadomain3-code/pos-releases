import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, getDbPath } from '../db';
import { getAllSettings, setSetting } from './settings';

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function runLocalBackup(): string {
  const db = getDb();
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const dir = path.join(app.getPath('documents'), 'ShopKeeper POS', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `pos-${stamp()}.db`);
  fs.copyFileSync(getDbPath(), dest);
  setSetting('last_backup', new Date().toISOString());
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