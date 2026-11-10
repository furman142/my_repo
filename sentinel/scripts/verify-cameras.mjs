#!/usr/bin/env node
// Real connection test for every configured camera: pulls a few seconds of video through go2rtc
// and reports what actually arrived. Exit code 0 only if every camera delivered video.
//   npm run verify            (SENTINEL must be running: npm start)
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(path.join(ROOT, 'server/dist/cameras/probe.js'))) {
  console.error('Build first: npm run build');
  process.exit(2);
}
const { probeStream } = await import('../server/dist/cameras/probe.js');
const { getSettings } = await import('../server/dist/settings/store.js');
const { go2rtc } = await import('../server/dist/go2rtc/client.js');

if (!(await go2rtc.ping())) {
  console.error('✖ go2rtc is not reachable. Start SENTINEL first (npm start).');
  process.exit(2);
}
// --demo: self-test of the pipeline with the synthetic DEMO streams (Settings → Demo mode). NOT cameras.
const demo = process.argv.includes('--demo');
const cams = demo
  ? [1, 2].map((i) => ({ name: `DEMO ${i} (synthetic, not a camera)`, model: 'ffmpeg', stream: `sentinel_demo_${i}`, streamSd: null }))
  : getSettings().cameras.filter((c) => c.enabled);
if (!cams.length) {
  console.error('✖ No cameras configured yet. Use Settings → "חיבור מצלמות Xiaomi" in the dashboard.');
  process.exit(2);
}

const withSd = process.argv.includes('--sd');
let failed = 0;
for (const c of cams) {
  const streams = [['hd', c.stream], ...(withSd && c.streamSd ? [['sd', c.streamSd]] : [])];
  for (const [q, s] of streams) {
    process.stdout.write(`… ${c.name} [${c.model}] ${q.toUpperCase()} `);
    const r = await probeStream(s, 6);
    if (r.ok) {
      console.log(`\r✔ ${c.name} [${c.model}] ${q.toUpperCase()}: ${r.codec ?? '?'} ${r.width ? `${r.width}x${r.height}` : ''}, ${r.fragments} fragments, ${(r.bytes / 1024).toFixed(0)} KB in ${(r.elapsedMs / 1000).toFixed(1)}s`);
    } else {
      failed++;
      console.log(`\r✖ ${c.name} [${c.model}] ${q.toUpperCase()}: NO VIDEO — ${r.error ?? 'unknown error'}`);
    }
  }
}
console.log(failed ? `\n${failed} stream(s) failed.` : '\nAll streams delivered real video.');
process.exit(failed ? 1 : 0);
