import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.GO2RTC_BIN = '/nonexistent';
const { repairUserConfig } = await import('./manager.js');

test('removes the empty flow mapping go2rtc cannot patch', () => {
  const before = '# c1\n# c2\n# c3\nstreams: {}\n';
  assert.equal(repairUserConfig(before), '# c1\n# c2\n# c3\n');
});

test('keeps the xiaomi token and real streams untouched', () => {
  const text = '# c\nxiaomi:\n  "123": V1:abc\nstreams:\n  indoor:\n    - xiaomi://x\n';
  assert.equal(repairUserConfig(text), text);
});

test('handles CRLF files written on Windows', () => {
  assert.equal(repairUserConfig('# c\r\nstreams: {}\r\nxiaomi:\r\n'), '# c\r\nxiaomi:\r\n');
});
