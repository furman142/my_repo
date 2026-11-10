import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.GO2RTC_BIN = '/nonexistent';
const { baseSource, buildSources } = await import('./streams.js');
const { parseXiaomiSource } = await import('./models.js');

const BASE = 'xiaomi://123:de@192.168.1.5?did=99&model=chuangmi.camera.046c04';

test('builds HD/SD sources with optional TCP transport', () => {
  assert.deepEqual(buildSources(BASE, 'auto'), { hd: BASE, sd: `${BASE}&subtype=sd` });
  assert.deepEqual(buildSources(BASE, 'tcp'), { hd: `${BASE}&transport=tcp`, sd: `${BASE}&subtype=sd&transport=tcp` });
});

test('base source strips only SENTINEL options and stays a valid xiaomi source', () => {
  assert.equal(baseSource(`${BASE}&subtype=sd&transport=tcp`), BASE);
  assert.ok(parseXiaomiSource(baseSource(`${BASE}&transport=tcp`)));
});
