#!/usr/bin/env node
// Proves that object recognition works with exactly the files the desktop app ships
// (desktop/build): the bundled server, the copied onnxruntime binaries and the model.
// Run after `npm run prepare-app`. Exits non-zero on failure.
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BUILD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'build');
process.env.SENTINEL_MODEL = path.join(BUILD, 'models', 'yolox_tiny.onnx');
process.env.SENTINEL_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'sentinel-smoke-'));
process.env.GO2RTC_BIN = path.join(BUILD, 'bin', process.platform === 'win32' ? 'go2rtc.exe' : 'go2rtc');

try {
  const server = await import(pathToFileURL(path.join(BUILD, 'server', 'server.mjs')).href);
  const r = await server.selfTestObjects();
  console.log(`✔ object recognition works on ${process.platform}/${process.arch}: one frame in ${r.ms} ms, ${r.detections} detections on a blank frame`);
  if (r.detections !== 0) throw new Error('expected nothing on a blank frame');
  process.exit(0);
} catch (err) {
  console.error(`✖ object recognition self-test failed: ${err?.stack ?? err}`);
  process.exit(1);
}
