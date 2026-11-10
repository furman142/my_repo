import assert from 'node:assert/strict';
import { mkdtempSync, utimesSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.GO2RTC_BIN = '/nonexistent';
const { secondsToBoundary, finalizeSegment } = await import('./recorder.js');

test('segments end on wall-clock boundaries', () => {
  assert.equal(secondsToBoundary(new Date(2026, 10, 10, 13, 7, 30), 10), 150); // -> 13:10:00
  assert.equal(secondsToBoundary(new Date(2026, 10, 10, 13, 59, 0), 60), 60); // -> 14:00:00
  assert.equal(secondsToBoundary(new Date(2026, 10, 10, 13, 9, 58), 10), 5); // minimum 5 s
});

test('finalize renames with duration, discards empty files', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  const part = path.join(dir, '13-00-00.part.mp4');
  writeFileSync(part, Buffer.alloc(100 * 1024));
  const start = new Date(Date.now() - 600_000);
  utimesSync(part, new Date(), new Date());
  assert.equal(finalizeSegment(part, start), true);
  const files = readdirSync(dir);
  assert.equal(files.length, 1);
  assert.match(files[0], /^13-00-00_(599|600|601)\.mp4$/);

  const tiny = path.join(dir, '13-10-00.part.mp4');
  writeFileSync(tiny, Buffer.alloc(10));
  assert.equal(finalizeSegment(tiny, new Date()), false);
  assert.equal(existsSync(tiny), false);
});
