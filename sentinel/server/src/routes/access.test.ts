import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.GO2RTC_BIN = '/nonexistent';
const { isTailscaleIp } = await import('./access.js');

test('detects Tailscale addresses (100.64.0.0/10)', () => {
  assert.equal(isTailscaleIp('100.101.102.103'), true);
  assert.equal(isTailscaleIp('100.64.0.1'), true);
  assert.equal(isTailscaleIp('100.128.0.1'), false);
  assert.equal(isTailscaleIp('192.168.1.5'), false);
});
