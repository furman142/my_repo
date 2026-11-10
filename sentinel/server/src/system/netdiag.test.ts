import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.GO2RTC_BIN = '/nonexistent';
const { inSubnet } = await import('./netdiag.js');

test('subnet check uses the interface netmask', () => {
  const lan = { iface: 'Wi-Fi', address: '192.168.1.20', netmask: '255.255.255.0' };
  assert.equal(inSubnet('192.168.1.77', lan), true);
  assert.equal(inSubnet('192.168.0.77', lan), false);
  assert.equal(inSubnet('10.0.0.5', { iface: 'e', address: '10.0.3.4', netmask: '255.255.0.0' }), true);
});
