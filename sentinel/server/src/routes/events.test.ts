import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.GO2RTC_BIN = '/nonexistent';
process.env.SENTINEL_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'sentinel-ev-'));
const { alertMatches, alertPolicy } = await import('./events.js');
const { saveSettings, getSettings } = await import('../settings/store.js');

test('which recognised objects trigger an alert', () => {
  assert.equal(alertMatches('person', 'person'), true);
  assert.equal(alertMatches('person', 'vehicle'), false);
  assert.equal(alertMatches('person', 'animal'), false);
  assert.equal(alertMatches('objects', 'vehicle'), true);
  assert.equal(alertMatches('objects', 'animal'), false);
  assert.equal(alertMatches('motion', 'person'), false, 'motion policy alerts at motion start, not again');
  assert.equal(alertMatches('off', 'person'), false);
});

test('person-only policy falls back to any motion while recognition is unavailable', () => {
  const cam = { id: 'yard', name: 'Yard', model: '', did: '', product: '', location: 'outdoor' as const, stream: 'yard', streamSd: null, enabled: true, transport: 'auto' as const, record: true, motion: 'medium' as const, alerts: true, alertOn: 'person' as const };
  saveSettings({ ...getSettings(), cameras: [cam], motion: { ...getSettings().motion, enabled: true, objects: true } });
  // The model is not loaded in this test, so alerts must not silently stop.
  assert.equal(alertPolicy('yard'), 'motion');
  saveSettings({ ...getSettings(), cameras: [{ ...cam, alerts: false }] });
  assert.equal(alertPolicy('yard'), 'off');
});
