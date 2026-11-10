/**
 * Motion events storage: one JSON-lines file per local day + a JPEG thumbnail per event.
 *   <data>/events/<YYYY-MM-DD>.jsonl
 *   <data>/events/thumbs/<id>.jpg
 * Plain files, no database: easy to back up, inspect and delete.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { localDate } from '../recordings/recorder.js';

export interface MotionEvent {
  id: string;
  camera: string;
  start: string; // ISO
  end: string; // ISO
  peak: number; // max changed-area ratio (0..1)
  box: [number, number, number, number] | null; // normalized bounding box at peak
  thumb: boolean;
}

export const EVENTS_DIR = () => path.join(config.dataDir, 'events');
const THUMBS_DIR = () => path.join(EVENTS_DIR(), 'thumbs');
export const EVENT_ID = /^[0-9a-z_-]{8,80}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function newEventId(camera: string, start: Date): string {
  return `${camera}-${start.getTime().toString(36)}`;
}

export function saveEvent(ev: MotionEvent, thumbJpeg?: Buffer): void {
  mkdirSync(THUMBS_DIR(), { recursive: true });
  if (thumbJpeg) writeFileSync(path.join(THUMBS_DIR(), `${ev.id}.jpg`), thumbJpeg, { mode: 0o600 });
  appendFileSync(path.join(EVENTS_DIR(), `${localDate(new Date(ev.start))}.jsonl`), JSON.stringify(ev) + '\n', { mode: 0o600 });
}

export function thumbPath(id: string): string | null {
  if (!EVENT_ID.test(id)) return null;
  const p = path.join(THUMBS_DIR(), `${id}.jpg`);
  return existsSync(p) ? p : null;
}

export function eventDays(): string[] {
  if (!existsSync(EVENTS_DIR())) return [];
  return readdirSync(EVENTS_DIR())
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort()
    .reverse();
}

export function readEvents(date: string): MotionEvent[] {
  if (!DAY.test(date)) return [];
  const f = path.join(EVENTS_DIR(), `${date}.jsonl`);
  if (!existsSync(f)) return [];
  const out: MotionEvent[] = [];
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as MotionEvent);
    } catch {
      /* skip a torn last line after power loss */
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** Events in the last `days` days (newest day first). */
export function readRecentEvents(days: number): MotionEvent[] {
  return eventDays()
    .slice(0, days)
    .flatMap((d) => readEvents(d));
}

export function enforceEventRetention(retentionDays: number): void {
  const cutoff = localDate(new Date(Date.now() - retentionDays * 24 * 3600 * 1000));
  for (const d of eventDays()) {
    if (d >= cutoff) continue;
    for (const ev of readEvents(d)) rmSync(path.join(THUMBS_DIR(), `${ev.id}.jpg`), { force: true });
    rmSync(path.join(EVENTS_DIR(), `${d}.jsonl`), { force: true });
  }
  // Orphan thumbnails (e.g. day file deleted by hand).
  if (existsSync(THUMBS_DIR())) {
    const old = Date.now() - (retentionDays + 1) * 24 * 3600 * 1000;
    for (const f of readdirSync(THUMBS_DIR())) {
      const p = path.join(THUMBS_DIR(), f);
      if (statSync(p).mtimeMs < old) rmSync(p, { force: true });
    }
  }
}
