import { existsSync, readFileSync, renameSync } from 'node:fs';
import { z } from 'zod';
import { paths } from '../config.js';
import { ensureDataDir, writePrivate } from '../security/secrets.js';

export const CAMERA_ID = /^[a-z][a-z0-9_]{0,31}$/;

export const cameraSchema = z.object({
  id: z.string().regex(CAMERA_ID),
  /** Display name shown in the dashboard. */
  name: z.string().trim().min(1).max(40),
  /** Xiaomi model id as reported by the Xiaomi cloud, e.g. chuangmi.camera.046c04. */
  model: z.string().max(64).default(''),
  /** Xiaomi device id (did) — identifies the physical camera. */
  did: z.string().max(40).default(''),
  /** Friendly product name, e.g. "Xiaomi Smart Camera C200". */
  product: z.string().max(64).default(''),
  location: z.enum(['indoor', 'outdoor']).default('indoor'),
  /** go2rtc stream name for main quality. */
  stream: z.string().regex(CAMERA_ID),
  /** go2rtc stream name for the low-quality substream (null = not configured). */
  streamSd: z.string().regex(CAMERA_ID).nullable().default(null),
  enabled: z.boolean().default(true),
  /** Xiaomi P2P transport: auto = camera decides (often UDP), tcp = force TCP (go2rtc `transport=tcp`). */
  transport: z.enum(['auto', 'tcp']).default('auto'),
});

export const settingsSchema = z.object({
  version: z.literal(1).default(1),
  cameras: z.array(cameraSchema).max(16).default([]),
  defaultQuality: z.enum(['hd', 'sd']).default('hd'),
  /** Demo mode shows go2rtc test patterns, clearly labelled DEMO. */
  demoMode: z.boolean().default(false),
});

export type Camera = z.infer<typeof cameraSchema>;
export type Settings = z.infer<typeof settingsSchema>;

let current: Settings | null = null;

export function getSettings(): Settings {
  if (current) return current;
  ensureDataDir();
  if (existsSync(paths.settings)) {
    try {
      current = settingsSchema.parse(JSON.parse(readFileSync(paths.settings, 'utf8')));
      return current;
    } catch {
      // Keep the broken file for inspection, start clean.
      renameSync(paths.settings, `${paths.settings}.broken-${Date.now()}`);
    }
  }
  current = settingsSchema.parse({});
  saveSettings(current);
  return current;
}

export function saveSettings(next: Settings): Settings {
  const valid = settingsSchema.parse(next);
  const ids = new Set<string>();
  for (const c of valid.cameras) {
    if (ids.has(c.id)) throw new Error(`duplicate camera id ${c.id}`);
    ids.add(c.id);
  }
  ensureDataDir();
  const tmp = `${paths.settings}.tmp`;
  writePrivate(tmp, JSON.stringify(valid, null, 2));
  renameSync(tmp, paths.settings); // atomic replace
  current = valid;
  return valid;
}

/** Every go2rtc stream name the browser is allowed to open. */
export function allowedStreams(s: Settings = getSettings()): Set<string> {
  const out = new Set<string>();
  for (const c of s.cameras) {
    if (!c.enabled) continue;
    out.add(c.stream);
    if (c.streamSd) out.add(c.streamSd);
  }
  if (s.demoMode) {
    out.add('sentinel_demo_1');
    out.add('sentinel_demo_2');
  }
  return out;
}
