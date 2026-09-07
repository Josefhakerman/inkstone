'use strict';

/* electron-builder normally stamps the exe's icon and version info with rcedit,
   but its signing-tools archive can't unpack on Windows without the symlink
   privilege (Developer Mode). We skip that step in the build script and do the
   rcedit pass here instead, using whichever copy of rcedit is already cached. */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

function findRcedit() {
  const cache = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign');
  if (!fs.existsSync(cache)) return null;
  for (const dir of fs.readdirSync(cache)) {
    const p = path.join(cache, dir, 'rcedit-x64.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const icon = path.join(__dirname, 'icon.ico');
  const rcedit = findRcedit();

  if (!rcedit || !fs.existsSync(exe) || !fs.existsSync(icon)) {
    console.log('  • afterPack: rcedit or icon unavailable, leaving exe resources as-is');
    return;
  }

  const info = context.packager.appInfo;
  const args = [
    exe,
    '--set-icon', icon,
    '--set-version-string', 'ProductName', info.productName,
    '--set-version-string', 'FileDescription', info.description || info.productName,
    '--set-version-string', 'CompanyName', info.companyName || 'Josef',
    '--set-version-string', 'LegalCopyright', `Copyright © ${new Date().getFullYear()}`,
    '--set-version-string', 'OriginalFilename', path.basename(exe),
    '--set-file-version', info.version,
    '--set-product-version', info.version
  ];

  try {
    execFileSync(rcedit, args, { stdio: 'pipe' });
    console.log('  • afterPack: stamped icon and version info onto', path.basename(exe));
  } catch (err) {
    console.log('  • afterPack: rcedit failed, continuing without it —', err.message);
  }
};
