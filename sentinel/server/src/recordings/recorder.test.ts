import assert from 'node:assert/strict';
import { mkdtempSync, utimesSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.GO2RTC_BIN = '/nonexistent';
const { secondsToBoundary, finalizeSegment, retentionCutoff } = await import('./recorder.js');

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

test('retention keeps whole calendar days and deletes at the end of the day', () => {
  const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
  // 2 days = today + yesterday. All of the 10th survives the whole of the 11th...
  assert.ok(at(10, 0, 5).getTime() >= retentionCutoff(at(11, 23, 59), 2));
  // ...and is deleted as soon as the 12th starts.
  assert.ok(at(10, 23, 55).getTime() < retentionCutoff(at(12, 0, 1), 2));
  assert.ok(at(11, 0, 0).getTime() >= retentionCutoff(at(12, 0, 1), 2));
  // 1 day = today only.
  assert.ok(at(11, 23, 59).getTime() < retentionCutoff(at(12, 0, 1), 1));
});
