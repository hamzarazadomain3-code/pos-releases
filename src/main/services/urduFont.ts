import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const FONT_FILE = 'NotoNastaliqUrdu-Regular.ttf';
const FONT_FAMILY = 'Noto Nastaliq Urdu';

/**
 * Absolute filesystem path to the embedded Urdu font (the bundled copy
 * living in resources/fonts). Returns null when the file is missing so
 * callers can gracefully fall back to the system font stack.
 */
export function getUrduFontPath(): string | null {
  try {
    const base = app && app.isPackaged
      ? path.join(process.resourcesPath || '', 'fonts')
      : (app && app.getAppPath ? path.join(app.getAppPath(), 'resources', 'fonts') : path.join(process.cwd(), 'resources', 'fonts'));
    const full = path.join(base, FONT_FILE);
    if (fs.existsSync(full)) return full;
  } catch {
    /* ignore — fall through to null */
  }
  return null;
}

/**
 * A ready-to-drop-in `url(...)` string for a `@font-face` rule. Returns null on
 * platforms/installs where the font is not present so the caller can omit it.
 * Uses the plain "file://" form Chromium reads locally.
 */
export function getUrduFontUrl(): string | null {
  const p = getUrduFontPath();
  if (!p) return null;
  return 'file:///' + p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1:/');
}

export { FONT_FAMILY as URDU_FONT_FAMILY };