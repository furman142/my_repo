import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redact } from './redact.js';

test('redacts xiaomi key material from dial URLs', () => {
  const line =
    'xiaomi: dial xiaomi://123456:de@192.168.1.5?did=99&model=chuangmi.camera.046c04&client_private=abcdef0123&sign=XYZ&device_public=0011';
  const out = redact(line);
  assert.ok(!out.includes('abcdef0123'));
  assert.ok(!out.includes('XYZ'));
  assert.ok(!out.includes('0011'));
  assert.ok(!out.includes('123456'));
  assert.ok(out.includes('model=chuangmi.camera.046c04'));
});

test('redacts xiaomi V1 tokens and basic auth', () => {
  assert.equal(redact('token V1:AbCdEf123456=='), 'token V1:***');
  assert.equal(redact('http://user:pass@127.0.0.1:1984/api'), 'http://***:***@127.0.0.1:1984/api');
});

test('leaves ordinary text alone', () => {
  assert.equal(redact('[streams] stream c200 started'), '[streams] stream c200 started');
});
