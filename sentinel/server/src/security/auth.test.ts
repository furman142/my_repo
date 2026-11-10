import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// Isolate data/ for the test run.
process.env.GO2RTC_BIN = '/nonexistent';
const { config } = await import('../config.js');
config.dataDir = mkdtempSync(path.join(os.tmpdir(), 'sentinel-test-'));
(await import('../config.js')).paths.secrets = path.join(config.dataDir, 'secrets.json');
const auth = await import('./auth.js');

test('session tokens verify and expire', () => {
  const now = Date.now();
  const token = auth.issueSession(now);
  assert.equal(auth.verifySession(token, now + 1000), true);
  assert.equal(auth.verifySession(token, now + 31 * 24 * 3600 * 1000), false);
});

test('tampered session tokens are rejected', () => {
  const token = auth.issueSession();
  const [exp, sig] = token.split('.');
  assert.equal(auth.verifySession(`${Number(exp) + 1}.${sig}`), false);
  assert.equal(auth.verifySession(`${exp}.${sig.slice(0, -2)}xx`), false);
  assert.equal(auth.verifySession('garbage'), false);
  assert.equal(auth.verifySession(undefined), false);
});

test('host parsing strips ports and keeps IPv6 brackets', () => {
  assert.equal(auth.hostnameOf('LocalHost:8080'), 'localhost');
  assert.equal(auth.hostnameOf('[::1]:8080'), '[::1]');
  assert.equal(auth.hostnameOf(undefined), '');
});

test('default allowed hosts are loopback only', () => {
  const hosts = auth.allowedHostnames();
  assert.ok(hosts.has('localhost'));
  assert.ok(hosts.has('127.0.0.1'));
  assert.ok(!hosts.has('evil.example.com'));
});

test('login throttling kicks in after 5 failures', () => {
  const ip = '10.0.0.9';
  for (let i = 0; i < 5; i++) auth.recordLoginFailure(ip);
  assert.equal(auth.loginThrottled(ip), true);
  auth.clearLoginFailures(ip);
  assert.equal(auth.loginThrottled(ip), false);
});
