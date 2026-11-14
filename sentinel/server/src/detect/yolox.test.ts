import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INPUT, decode, letterbox, nms, type Detection } from './yolox.js';

const ROW = 85;
const TOTAL = (52 * 52 + 26 * 26 + 13 * 13) * ROW;

/** Put one prediction into a raw YOLOX output tensor at stride-8 grid cell (gx, gy). */
function rawWith(gx: number, gy: number, cls: number, obj: number, clsScore: number, wPx: number, hPx: number): Float32Array {
  const out = new Float32Array(TOTAL);
  const i = (gy * 52 + gx) * ROW;
  out[i] = 0.5; // centre offset inside the cell
  out[i + 1] = 0.5;
  out[i + 2] = Math.log(wPx / 8);
  out[i + 3] = Math.log(hPx / 8);
  out[i + 4] = obj;
  out[i + 5 + cls] = clsScore;
  return out;
}

test('letterbox keeps aspect ratio, pads with 114 and swaps RGB to BGR', () => {
  const w = 640, h = 360;
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < rgb.length; i += 3) rgb[i] = 200; // pure red-ish frame
  const { data, scale } = letterbox(rgb, w, h);
  assert.equal(scale, INPUT / w);
  const plane = INPUT * INPUT;
  assert.equal(data.length, 3 * plane);
  assert.equal(Math.round(data[2 * plane + 10 * INPUT + 10]), 200, 'R ends up in the third (BGR) plane');
  assert.equal(Math.round(data[0 * plane + 10 * INPUT + 10]), 0, 'B plane is empty');
  assert.equal(data[0 * plane + 400 * INPUT + 10], 114, 'area below the picture is padding');
});

test('decode maps a grid prediction back to a normalized box in the source frame', () => {
  const w = 640, h = 360, scale = INPUT / w;
  // person centred at input pixel (20.5*8, 10.5*8) = (164, 84), 40x80 px in input space
  const dets = decode(rawWith(20, 10, 0, 0.9, 0.9, 40, 80), scale, w, h, 0.4);
  assert.equal(dets.length, 1);
  const d = dets[0];
  assert.equal(d.label, 'person');
  assert.ok(Math.abs(d.score - 0.81) < 0.01);
  const cx = (d.box[0] + d.box[2] / 2) * w * scale;
  const cy = (d.box[1] + d.box[3] / 2) * h * scale;
  assert.ok(Math.abs(cx - 164) < 0.5 && Math.abs(cy - 84) < 0.5, `centre ${cx},${cy}`);
  assert.ok(Math.abs(d.box[2] * w * scale - 40) < 0.5);
});

test('decode ignores weak predictions and classes we do not care about', () => {
  assert.equal(decode(rawWith(5, 5, 0, 0.5, 0.5, 30, 60), 0.65, 640, 360, 0.4).length, 0, 'score 0.25 < 0.4');
  assert.equal(decode(rawWith(5, 5, 56, 0.95, 0.95, 30, 60), 0.65, 640, 360, 0.4).length, 0, 'class 56 = chair');
  assert.equal(decode(rawWith(5, 5, 2, 0.95, 0.95, 30, 60), 0.65, 640, 360, 0.4)[0].label, 'vehicle');
});

test('nms removes duplicates of the same kind but keeps different kinds', () => {
  const box = (x: number): Detection['box'] => [x, 0.2, 0.2, 0.4];
  const dets: Detection[] = [
    { label: 'person', cls: 'person', score: 0.9, box: box(0.3) },
    { label: 'person', cls: 'person', score: 0.7, box: box(0.31) }, // duplicate
    { label: 'person', cls: 'person', score: 0.6, box: box(0.7) }, // another person
    { label: 'vehicle', cls: 'car', score: 0.5, box: box(0.3) }, // same place, other kind
  ];
  const kept = nms(dets);
  assert.deepEqual(kept.map((d) => d.score), [0.9, 0.6, 0.5]);
});
