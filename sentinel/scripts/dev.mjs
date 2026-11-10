#!/usr/bin/env node
// Development: backend (tsx watch, port 8080) + Vite (port 5173, proxies /api to the backend).
import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';
const procs = [
  spawn(npm, ['run', 'dev', '-w', 'server'], { stdio: 'inherit', shell: isWin }),
  spawn(npm, ['run', 'dev', '-w', 'web'], { stdio: 'inherit', shell: isWin }),
];
const stop = () => procs.forEach((p) => p.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => { if (code) stop(); }));
