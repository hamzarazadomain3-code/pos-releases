'use strict';
/**
 * electron-builder afterPack hook.
 *
 * Why this exists: `win.signAndEditExecutable` is disabled because electron-builder's
 * built-in executable editor on Windows shells out to `app-builder rcedit`, which
 * unpacks the winCodeSign bundle with `7za`. `7za` is not on PATH on the build
 * machines, so the built-in editor aborts the whole build. Disabling it kept the
 * build green but also meant the app executable never got our icon — Explorer and
 * the taskbar showed the stock Electron icon while the NSIS installer/uninstaller
 * (which embed the .ico themselves) looked correct.
 *
 * This hook embeds the icon and version metadata using a vendored rcedit that needs
 * no external extractor, so the packaged `Rokar POS.exe` carries the real logo.
 */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const appInfo = context.packager.appInfo;
  const productName = appInfo.productName || 'Rokar POS';
  const exeName = `${productName}.exe`;
  const exe = path.join(context.appOutDir, exeName);

  if (!fs.existsSync(exe)) {
    console.warn(`[after-pack] app executable not found, skipping: ${exe}`);
    return;
  }

  const toolsDir = path.join(__dirname, '..', 'build', 'tools');
  // builder-util Arch enum: ia32 = 0, x64 = 1, armv7l = 2, arm64 = 3, universal = 4
  const arch = context.arch === 0 ? 'ia32' : 'x64';
  const rcedit = path.join(toolsDir, `rcedit-${arch}.exe`);
  const icon = path.join(__dirname, '..', 'build', 'icon.ico');

  if (!fs.existsSync(rcedit) || !fs.existsSync(icon)) {
    console.warn('[after-pack] rcedit or icon.ico missing, skipping icon embed');
    return;
  }

  const version = appInfo.version || context.packager.appInfo.version;
  const args = [
    exe,
    '--set-icon', icon,
    '--set-version-string', 'FileDescription', productName,
    '--set-version-string', 'ProductName', productName,
    '--set-version-string', 'InternalName', productName,
    '--set-version-string', 'OriginalFilename', exeName,
    '--set-version-string', 'CompanyName', appInfo.companyName || 'Rokar',
    '--set-file-version', version,
    '--set-product-version', version,
  ];

  execFileSync(rcedit, args, { stdio: 'inherit' });
  console.log(`[after-pack] embedded icon + version info into ${exeName}`);
};
