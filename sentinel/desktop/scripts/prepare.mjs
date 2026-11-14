#!/usr/bin/env node
// Assembles everything the desktop app ships with into desktop/build/:
//   build/server/server.mjs  – the SENTINEL server bundled into one file (no node_modules needed)
//   build/web/               – the built React dashboard
//   build/bin/go2rtc(.exe)   – the official go2rtc release for THIS OS/CPU
// Requires `npm install` in sentinel/ first (server + web dependencies).
import { execSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SENTINEL = path.resolve(DESKTOP, '..');
const OUT = path.join(DESKTOP, 'build');

if (!existsSync(path.join(SENTINEL, 'node_modules', 'fastify'))) {
  console.error('Run "npm install" in sentinel/ first.');
  process.exit(1);
}

rmSync(path.join(OUT, 'server'), { recursive: true, force: true });
rmSync(path.join(OUT, 'web'), { recursive: true, force: true });

console.log('• building dashboard (web)…');
execSync('npm run build -w web', { cwd: SENTINEL, stdio: 'inherit' });
cpSync(path.join(SENTINEL, 'web', 'dist'), path.join(OUT, 'web'), { recursive: true });

console.log('• bundling server…');
await build({
  entryPoints: [path.join(SENTINEL, 'server', 'src', 'app.ts')],
  outfile: path.join(OUT, 'server', 'server.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // CommonJS dependencies (fastify, ws, …) call require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  // Optional native speed-ups of `ws`; it falls back to JS when they are missing.
  // onnxruntime-node is a native addon: it cannot be bundled, it is copied next to the bundle below.
  external: ['bufferutil', 'utf-8-validate', 'ffmpeg-static', 'onnxruntime-node'],
  logLevel: 'warning',
  legalComments: 'linked',
});

console.log('• go2rtc…');
execSync(`node "${path.join(SENTINEL, 'scripts', 'install-go2rtc.mjs')}" --out "${path.join(OUT, 'bin')}"`, { stdio: 'inherit' });
console.log('• ffmpeg (motion detection)…');
const require = createRequire(import.meta.url);
const ffmpegSrc = require(path.join(SENTINEL, 'node_modules', 'ffmpeg-static'));
if (!ffmpegSrc || !existsSync(ffmpegSrc)) throw new Error('ffmpeg-static binary missing: run npm install in sentinel/');
const ffmpegDst = path.join(OUT, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
copyFileSync(ffmpegSrc, ffmpegDst);
chmodSync(ffmpegDst, 0o755);
console.log('• object detection (onnxruntime + model)…');
// Node resolves `onnxruntime-node` from build/server/node_modules, right beside server.mjs.
const NM = path.join(OUT, 'server', 'node_modules');
rmSync(NM, { recursive: true, force: true });
cpSync(path.join(SENTINEL, 'node_modules', 'onnxruntime-common'), path.join(NM, 'onnxruntime-common'), { recursive: true });
const ortSrc = path.join(SENTINEL, 'node_modules', 'onnxruntime-node');
const keepBin = path.join('bin', 'napi-v6', process.platform, process.arch);
if (!existsSync(path.join(ortSrc, keepBin))) throw new Error(`onnxruntime-node has no binaries for ${process.platform}/${process.arch}`);
cpSync(ortSrc, path.join(NM, 'onnxruntime-node'), {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ortSrc, src);
    if (rel === 'script' || rel.startsWith('script' + path.sep)) return false; // install-time only
    // Only this platform's binaries, and no GPU providers (hundreds of MB, never used: CPU only).
    if (rel.startsWith('bin' + path.sep) && rel.length >= keepBin.length && !rel.startsWith(keepBin)) return false;
    if (/providers_(cuda|tensorrt)/.test(rel)) return false;
    return true;
  },
});
execSync(`node "${path.join(SENTINEL, 'scripts', 'install-model.mjs')}" --out "${path.join(OUT, 'models')}"`, { stdio: 'inherit' });
console.log('✔ desktop/build ready');
