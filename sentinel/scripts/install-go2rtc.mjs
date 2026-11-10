#!/usr/bin/env node
// Downloads the official go2rtc release binary for this OS/CPU into sentinel/bin/.
// Source: https://github.com/AlexxIT/go2rtc/releases  (Xiaomi support: v1.9.13+)
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = process.env.GO2RTC_VERSION || 'v1.9.15';
const MIN_XIAOMI = [1, 9, 13];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// --out <dir>: install somewhere else (the desktop build bundles go2rtc into the app).
const outIdx = process.argv.indexOf('--out');
const BIN_DIR = outIdx > 0 ? path.resolve(process.argv[outIdx + 1]) : path.join(ROOT, 'bin');
const isWin = process.platform === 'win32';
const target = path.join(BIN_DIR, isWin ? 'go2rtc.exe' : 'go2rtc');

function asset() {
  const arch = { x64: 'amd64', arm64: 'arm64', arm: 'arm', ia32: '386' }[process.arch];
  if (!arch) throw new Error(`Unsupported CPU architecture: ${process.arch}`);
  switch (process.platform) {
    case 'win32':
      return { name: `go2rtc_win${arch === 'amd64' ? '64' : arch === '386' ? '32' : '_' + arch}.zip`, zip: true };
    case 'darwin':
      return { name: `go2rtc_mac_${arch}.zip`, zip: true };
    case 'linux':
      return { name: `go2rtc_linux_${arch}`, zip: false };
    default:
      throw new Error(`Unsupported OS: ${process.platform}`);
  }
}

function versionOk(v) {
  const parts = v.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((parts[i] ?? 0) > MIN_XIAOMI[i]) return true;
    if ((parts[i] ?? 0) < MIN_XIAOMI[i]) return false;
  }
  return true;
}

function installedVersion() {
  if (!existsSync(target)) return null;
  try {
    const out = execFileSync(target, ['-version'], { encoding: 'utf8' });
    return /version (\S+)/.exec(out)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function main() {
  if (!versionOk(VERSION)) throw new Error(`go2rtc ${VERSION} has no Xiaomi support (needs v1.9.13+)`);
  const have = installedVersion();
  if (have && `v${have}` === VERSION && !process.argv.includes('--force')) {
    console.log(`go2rtc ${have} already installed at ${target}`);
    return;
  }

  const a = asset();
  const url = `https://github.com/AlexxIT/go2rtc/releases/download/${VERSION}/${a.name}`;
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(BIN_DIR, { recursive: true });

  if (a.zip) {
    const zipPath = path.join(BIN_DIR, a.name);
    const outDir = path.join(BIN_DIR, 'extract');
    writeFileSync(zipPath, buf);
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir);
    if (isWin) {
      execFileSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath '${zipPath}' -DestinationPath '${outDir}'`], { stdio: 'inherit' });
    } else {
      execFileSync('unzip', ['-o', zipPath, '-d', outDir], { stdio: 'inherit' });
    }
    const exe = path.join(outDir, isWin ? 'go2rtc.exe' : 'go2rtc');
    if (!existsSync(exe)) throw new Error('go2rtc binary not found inside the zip');
    rmSync(target, { force: true });
    renameSync(exe, target);
    rmSync(outDir, { recursive: true, force: true });
    rmSync(zipPath, { force: true });
  } else {
    writeFileSync(target, buf);
  }
  if (!isWin) chmodSync(target, 0o755);
  if (process.platform === 'darwin') {
    // Downloaded binaries are quarantined by Gatekeeper; clear it for this file only.
    try {
      execFileSync('xattr', ['-d', 'com.apple.quarantine', target], { stdio: 'ignore' });
    } catch {
      /* not quarantined */
    }
  }
  console.log(`Installed: ${execFileSync(target, ['-version'], { encoding: 'utf8' }).trim()}`);
}

main().catch((err) => {
  console.error(`\n✖ ${err.message}`);
  process.exit(1);
});
