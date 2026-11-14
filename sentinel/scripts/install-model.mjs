#!/usr/bin/env node
// Downloads the object-detection model (YOLOX-tiny, Apache-2.0) from the official YOLOX release
// into sentinel/models/ and verifies its SHA-256. Used for people / vehicle detection.
//   node scripts/install-model.mjs [--out <dir>]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_ = 'https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.onnx';
const SHA256 = '427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7';
const NAME = 'yolox_tiny.onnx';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outIdx = process.argv.indexOf('--out');
const DIR = outIdx > 0 ? path.resolve(process.argv[outIdx + 1]) : path.join(ROOT, 'models');
const target = path.join(DIR, NAME);
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

try {
  if (existsSync(target) && sha(readFileSync(target)) === SHA256) {
    console.log(`model already installed at ${target}`);
  } else {
    console.log(`Downloading ${URL_}`);
    const res = await fetch(URL_);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    // Never use a file that is not exactly the one this code was tested with.
    if (sha(buf) !== SHA256) throw new Error(`checksum mismatch: got ${sha(buf)}`);
    mkdirSync(DIR, { recursive: true });
    writeFileSync(target, buf);
    console.log(`Installed: ${target} (${(buf.length / 1024 / 1024).toFixed(1)} MB, sha256 ok)`);
  }
} catch (err) {
  console.error(`\n✖ ${err.message}`);
  process.exit(1);
}
