import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

let logFile: string | null = null;
let stream: fs.WriteStream | null = null;

export function initLogger(): void {
  const logsDir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  logFile = path.join(logsDir, `app-${day}.log`);
  stream = fs.createWriteStream(logFile, { flags: 'a' });
  log('=== ShopKeeper POS starting ===');
}

export function log(message: string): void {
  const line = `[${new Date().toLocaleString()}] ${message}`;
  try {
    console.log(line);
  } catch {
    /* ignore */
  }
  try {
    stream?.write(line + '\n');
  } catch {
    /* ignore */
  }
}

export function logError(context: string, err: unknown): void {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  const line = `[${new Date().toLocaleString()}] ERROR ${context}: ${msg}`;
  try {
    console.error(line);
  } catch {
    /* ignore */
  }
  try {
    stream?.write(line + '\n');
  } catch {
    /* ignore */
  }
}

export function getLogFilePath(): string {
  return logFile ?? '';
}

export function closeLogger(): void {
  stream?.end();
  stream = null;
}