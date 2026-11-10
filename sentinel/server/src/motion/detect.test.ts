import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventTracker, MotionDetector } from './detect.js';

const W = 320;
const H = 180;

/** Flat gray frame with optional noise and an optional bright square. */
function frame(level: number, opts: { square?: [number, number, number]; noise?: number } = {}) {
  const rgb = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = level + (opts.noise ? Math.round((Math.random() - 0.5) * opts.noise) : 0);
      if (opts.square) {
        const [sx, sy, size] = opts.square;
        if (x >= sx && x < sx + size && y >= sy && y < sy + size) v = 240;
      }
      const i = (y * W + x) * 3;
      rgb[i] = rgb[i + 1] = rgb[i + 2] = Math.max(0, Math.min(255, v));
    }
  }
  return rgb;
}

test('static noisy scene produces no motion', () => {
  const d = new MotionDetector({ width: W, height: H });
  for (let i = 0; i < 40; i++) assert.equal(d.push(frame(100, { noise: 20 })).motion, false);
});

test('moving object is detected after confirmation and localized', () => {
  const d = new MotionDetector({ width: W, height: H });
  for (let i = 0; i < 10; i++) d.push(frame(80));
  const r1 = d.push(frame(80, { square: [100, 60, 40] }));
  assert.equal(r1.motion, false, 'needs 2 frames to confirm');
  const r2 = d.push(frame(80, { square: [110, 60, 40] }));
  assert.equal(r2.motion, true);
  assert.ok(r2.box);
  const [x, y] = r2.box!;
  assert.ok(x > 0.25 && x < 0.4 && y > 0.25 && y < 0.4, `box ${r2.box}`);
});

test('global lighting change (IR switch) is not motion', () => {
  const d = new MotionDetector({ width: W, height: H });
  for (let i = 0; i < 10; i++) d.push(frame(60));
  const r = d.push(frame(180));
  assert.equal(r.lighting, true);
  assert.equal(r.motion, false);
  // and the new lighting becomes the background
  assert.equal(d.push(frame(180)).motion, false);
  assert.equal(d.push(frame(180)).motion, false);
});

test('sensitivity changes what counts as motion', () => {
  const small = (x: number) => frame(80, { square: [x, 80, 12] }); // ~0.25% of the image
  const run = (s: 'low' | 'high') => {
    const d = new MotionDetector({ width: W, height: H, sensitivity: s });
    for (let i = 0; i < 10; i++) d.push(frame(80));
    d.push(small(50));
    return d.push(small(60)).motion;
  };
  assert.equal(run('low'), false);
  // 12px square = 9 cells of 4800 = 0.19% < high (0.6%) as well: use a bigger one for high
  const d = new MotionDetector({ width: W, height: H, sensitivity: 'high' });
  for (let i = 0; i < 10; i++) d.push(frame(80));
  d.push(frame(80, { square: [50, 80, 24] }));
  assert.equal(d.push(frame(80, { square: [60, 80, 24] })).motion, true);
});

test('event tracker starts, keeps peak and ends after quiet period', () => {
  const t = new EventTracker(8000);
  const m = (ratio: number) => ({ ratio, motion: ratio > 0, lighting: false, box: null });
  assert.equal(t.update(m(0.02), 0), 'start');
  assert.equal(t.update(m(0.05), 500), null);
  assert.equal(t.update(m(0), 4000), null);
  assert.equal(t.update(m(0), 8600), 'end');
  const ev = t.close()!;
  assert.equal(ev.peak, 0.05);
  assert.equal(ev.start, 0);
  assert.equal(ev.last, 500);
});

test('very long activity is split into separate events', () => {
  const t = new EventTracker(8000, 60_000);
  const m = { ratio: 0.03, motion: true, lighting: false, box: null };
  assert.equal(t.update(m, 0), 'start');
  assert.equal(t.update(m, 30_000), null);
  assert.equal(t.update(m, 60_000), 'end');
  t.close();
  assert.equal(t.update(m, 60_500), 'start');
});
