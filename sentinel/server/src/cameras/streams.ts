import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { paths } from '../config.js';
import { go2rtc } from '../go2rtc/client.js';
import type { Camera } from '../settings/store.js';
import { parseXiaomiSource } from './models.js';

/** Strip SENTINEL-added options so only the exact go2rtc device URL remains. */
export function baseSource(src: string): string {
  return src.replace(/&(subtype|transport)=[^&]*/g, '');
}

/** HD + SD go2rtc sources for a camera. Options are documented in go2rtc (subtype) or read from its code (transport). */
export function buildSources(base: string, transport: 'auto' | 'tcp') {
  const t = transport === 'tcp' ? '&transport=tcp' : '';
  return { hd: `${base}${t}`, sd: `${base}&subtype=sd${t}` };
}

/** The full source lives only in data/go2rtc.yaml (go2rtc masks the account id in its API). */
export function readBaseSource(stream: string): string | null {
  try {
    const doc = YAML.parse(readFileSync(paths.go2rtcConfig, 'utf8')) as { streams?: Record<string, string | string[]> };
    const v = doc?.streams?.[stream];
    const src = Array.isArray(v) ? v[0] : v;
    if (typeof src !== 'string') return null;
    const base = baseSource(src);
    return parseXiaomiSource(base) ? base : null;
  } catch {
    return null;
  }
}

export async function applyStreams(camera: Camera, base: string): Promise<void> {
  const s = buildSources(base, camera.transport);
  await go2rtc.putStream(camera.stream, s.hd);
  if (camera.streamSd) await go2rtc.putStream(camera.streamSd, s.sd);
}
