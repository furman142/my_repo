#!/usr/bin/env node
// Prints the go2rtc WebUI login (needed once, for "Add → Xiaomi"). Shown only on this terminal.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(ROOT, 'data', 'secrets.json');
if (!existsSync(file)) {
  console.error('No credentials yet — start SENTINEL once (npm start); they are generated on first run.');
  process.exit(1);
}
const s = JSON.parse(readFileSync(file, 'utf8'));
const port = process.env.GO2RTC_API_PORT || 1984;
console.log(`go2rtc WebUI:  http://127.0.0.1:${port}/   (only from this computer)`);
console.log(`username:      ${s.go2rtcUser}`);
console.log(`password:      ${s.go2rtcPassword}`);
console.log('\nDo not paste these anywhere. They protect the camera server on this computer.');
