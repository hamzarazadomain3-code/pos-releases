// Copies the puppeteer Chrome for Testing (headless shell) cache into build/puppeteer-cache
// so electron-builder can ship it with the installer (see build.extraResources).
// Keeps the exact cache structure puppeteer expects: <cache>/chrome-headless-shell/<platform>-<buildId>/...
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const src = process.env.PUPPETEER_CACHE_DIR || path.join(os.homedir(), '.cache', 'puppeteer');
const shellDir = path.join(src, 'chrome-headless-shell');
const dest = path.join(__dirname, '..', 'build', 'puppeteer-cache');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(shellDir)) {
  console.warn(
    '[prepare-puppeteer] chrome-headless-shell cache not found at ' +
      shellDir +
      '. WhatsApp receipts will require a manual browser install on target machines.'
  );
  process.exit(0);
}

fs.rmSync(dest, { recursive: true, force: true });
copyDir(shellDir, dest);

const sizeMB = ((fs.readdirSync(dest, { recursive: true }).reduce((sum, f) => {
  const st = fs.statSync(path.join(dest, f));
  return sum + (st.isFile() ? st.size : 0);
}, 0)) / 1024 / 1024);
console.log(`[prepare-puppeteer] Copied headless shell → build/puppeteer-cache (${sizeMB.toFixed(1)} MB)`);