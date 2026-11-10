import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modelInfo, parseXiaomiSource } from './models.js';

test('accepts the exact go2rtc xiaomi URL shape', () => {
  const p = parseXiaomiSource('xiaomi://1234567890:de@192.168.1.23?did=987654321&model=chuangmi.camera.046c04');
  assert.deepEqual(p, {
    account: '1234567890',
    region: 'de',
    ip: '192.168.1.23',
    did: '987654321',
    model: 'chuangmi.camera.046c04',
  });
});

test('rejects anything that is not a plain xiaomi source', () => {
  for (const bad of [
    'exec:rm -rf /',
    'ffmpeg:virtual?video',
    'rtsp://192.168.1.2/live',
    'xiaomi://123:de@192.168.1.2?did=1&model=x.camera.y&client_private=aa',
    'xiaomi://123:zz@192.168.1.2?did=1&model=x.camera.y',
    'xiaomi://123:de@evil.com?did=1&model=x.camera.y',
  ]) {
    assert.equal(parseXiaomiSource(bad), null, bad);
  }
});

test('C200 is confirmed, unknown models are unverified', () => {
  assert.equal(modelInfo('chuangmi.camera.046c04').compat, 'confirmed');
  assert.equal(modelInfo('some.camera.unknown').compat, 'unverified');
});
