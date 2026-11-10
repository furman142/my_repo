#!/usr/bin/env node
// Assembles everything the desktop app ships with into desktop/build/:
//   build/server/server.mjs  – the SENTINEL server bundled into one file (no node_modules needed)
//   build/web/               – the built React dashboard
//   build/bin/go2rtc(.exe)   – the official go2rtc release for THIS OS/CPU
// Requires `npm install` in sentinel/ first (server + web dependencies).
import { execSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
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
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'warning',
  legalComments: 'linked',
});

console.log('• go2rtc…');
execSync(`node "${path.join(SENTINEL, 'scripts', 'install-go2rtc.mjs')}" --out "${path.join(OUT, 'bin')}"`, { stdio: 'inherit' });
console.log('✔ desktop/build ready');
