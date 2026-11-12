/**
 * Continuous recording to local disk.
 *
 * Each recorded camera pulls fragmented MP4 from go2rtc (`/api/stream.mp4?src=…&duration=N`) and
 * writes it straight to disk — no transcoding, no ffmpeg. Chromium plays these files with correct
 * duration and seeking when they are served with HTTP range support (verified).
 *
 * Layout:  <dir>/<cameraId>/<YYYY-MM-DD>/<HH-MM-SS>_<seconds>.mp4   (local time)
 *          <HH-MM-SS>.part.mp4 while a segment is being written.
 * Segments end on wall-clock boundaries (every `segmentMinutes`); the next segment starts a few
 * seconds before the current one ends, so there is no gap (go2rtc starts each file on a keyframe).
 *
 * Note: go2rtc's MP4 output carries H.264/H.265 and AAC only, so Opus audio (Xiaomi) is not
 * recorded — recordings are video-only.
 */
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, type WriteStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { go2rtc } from '../go2rtc/client.js';
import { redact } from '../security/redact.js';
import { getSettings } from '../settings/store.js';

export const RECORDINGS_DIR = () => process.env.SENTINEL_RECORDINGS_DIR || path.join(config.dataDir, 'recordings');

export type RecorderState = 'recording' | 'waiting' | 'stopped';

export interface RecorderStatus {
  cameraId: string;
  stream: string;
  state: RecorderState;
  since: string | null;
  lastError: string | null;
  currentFile: string | null;
}

const OVERLAP_START_S = 3; // next segment starts this many seconds before the boundary
const OVERLAP_END_S = 1; // current segment runs this long past the boundary
const MIN_SEGMENT_BYTES = 32 * 1024; // smaller = no real video, discard

const pad = (n: number) => String(n).padStart(2, '0');
export const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localTime = (d: Date) => `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;

/** Seconds from `now` until the next multiple of `segmentMinutes` on the wall clock. */
export function secondsToBoundary(now: Date, segmentMinutes: number): number {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const next = (Math.floor(minutes / segmentMinutes) + 1) * segmentMinutes;
  const s = (next - minutes) * 60 - now.getSeconds() - now.getMilliseconds() / 1000;
  return Math.max(5, Math.round(s));
}

class CameraRecorder {
  state: RecorderState = 'waiting';
  since: string | null = null;
  lastError: string | null = null;
  currentFile: string | null = null;
  private stopped = false;
  private active = new Set<AbortController>();
  private backoffMs = 5000;
  private nextTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly cameraId: string,
    readonly stream: string,
  ) {}

  start() {
    this.stopped = false;
    void this.segment();
  }

  async stop() {
    this.stopped = true;
    if (this.nextTimer) clearTimeout(this.nextTimer);
    for (const c of this.active) c.abort();
    this.state = 'stopped';
  }

  private scheduleRetry() {
    if (this.stopped) return;
    this.state = 'waiting';
    this.nextTimer = setTimeout(() => void this.segment(), this.backoffMs);
    // Each attempt costs a Xiaomi cloud request: back off up to 5 minutes for unreachable cameras.
    this.backoffMs = Math.min(this.backoffMs * 2, 300_000);
  }

  /** Record one segment; schedules the following one shortly before this one ends. */
  private async segment() {
    if (this.stopped) return;
    const { segmentMinutes } = getSettings().recording;
    const startedAt = new Date();
    // SENTINEL_TEST_SEGMENT_SECONDS: tests only, to exercise rotation quickly.
    const testSeg = Number(process.env.SENTINEL_TEST_SEGMENT_SECONDS) || 0;
    const untilBoundary = testSeg || secondsToBoundary(startedAt, segmentMinutes);
    const duration = untilBoundary + OVERLAP_END_S;

    const dir = path.join(RECORDINGS_DIR(), this.cameraId, localDate(startedAt));
    mkdirSync(dir, { recursive: true });
    const base = localTime(startedAt);
    const partPath = path.join(dir, `${base}.part.mp4`);

    const ac = new AbortController();
    this.active.add(ac);
    let out: WriteStream | null = null;
    let handedOver = false;
    const handOver = () => {
      // Start the next segment slightly before this one ends (seamless files).
      if (handedOver || this.stopped) return;
      handedOver = true;
      void this.segment();
    };
    const handoverTimer = setTimeout(handOver, Math.max(1, untilBoundary - OVERLAP_START_S) * 1000);

    try {
      const q = new URLSearchParams({ src: this.stream, duration: String(duration), video: 'all' });
      const res = await go2rtc.raw(`/api/stream.mp4?${q}`, { signal: ac.signal } as RequestInit, (duration + 60) * 1000);
      if (!res.ok || !res.body) throw new Error((await res.text()).trim() || res.statusText);
      out = createWriteStream(partPath, { mode: 0o600 });
      if (this.state !== 'recording') this.since = new Date().toISOString();
      this.state = 'recording';
      this.lastError = null;
      this.currentFile = path.relative(RECORDINGS_DIR(), partPath);
      await pipeline(Readable.fromWeb(res.body as never), out);
    } catch (err) {
      if (!this.stopped) this.lastError = redact(String((err as Error).message ?? err)).slice(0, 300);
    } finally {
      clearTimeout(handoverTimer);
      this.active.delete(ac);
      const ok = finalizeSegment(partPath, startedAt);
      if (ok) {
        this.backoffMs = 5000;
        this.lastError = null;
        // Stream ended early (camera dropped): continue right away with a new segment.
        if (!handedOver && !this.stopped) handOver();
      } else if (!handedOver) {
        // Nothing usable arrived (camera offline / go2rtc error): retry with backoff.
        this.currentFile = null;
        this.scheduleRetry();
      }
    }
  }
}

/** Rename `HH-MM-SS.part.mp4` to `HH-MM-SS_<seconds>.mp4`, or delete it when empty. */
export function finalizeSegment(partPath: string, startedAt?: Date): boolean {
  if (!existsSync(partPath)) return false;
  const st = statSync(partPath);
  if (st.size < MIN_SEGMENT_BYTES) {
    rmSync(partPath, { force: true });
    return false;
  }
  const begin = startedAt?.getTime() ?? st.birthtimeMs ?? st.mtimeMs;
  const seconds = Math.max(1, Math.round((st.mtimeMs - begin) / 1000));
  const finalPath = partPath.replace(/\.part\.mp4$/, `_${seconds}.mp4`);
  renameSync(partPath, finalPath);
  return true;
}

/** Leftover .part files from a crash/power loss: finalize them on startup. */
function recoverPartFiles() {
  const root = RECORDINGS_DIR();
  if (!existsSync(root)) return;
  for (const cam of readdirSync(root)) {
    const camDir = path.join(root, cam);
    if (!statSync(camDir).isDirectory()) continue;
    for (const day of readdirSync(camDir)) {
      const dayDir = path.join(camDir, day);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !statSync(dayDir).isDirectory()) continue;
      for (const f of readdirSync(dayDir)) {
        const m = /^(\d{2})-(\d{2})-(\d{2})\.part\.mp4$/.exec(f);
        if (!m) continue;
        const [y, mo, d] = day.split('-').map(Number);
        finalizeSegment(path.join(dayDir, f), new Date(y, mo - 1, d, +m[1], +m[2], +m[3]));
      }
    }
  }
}

// ---------------------------------------------------------------------------------------
/** Keep recording this long after motion stops (motion mode). */
export const MOTION_POSTROLL_MS = 30_000;

interface MotionSource {
  on(event: 'motion-start' | 'motion-end', fn: (ev: { camera: string }) => void): unknown;
}

class RecordingService {
  private recorders = new Map<string, CameraRecorder>();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private midnightTimer: NodeJS.Timeout | null = null;
  private started = false;
  private motionActive = new Set<string>();
  private holdUntil = new Map<string, number>();

  /** Motion-triggered mode: start a recorder when motion starts, stop after the post-roll. */
  attachMotion(src: MotionSource) {
    src.on('motion-start', ({ camera }) => {
      this.motionActive.add(camera);
      if (getSettings().recording.mode === 'motion') this.reconcile();
    });
    src.on('motion-end', ({ camera }) => {
      this.motionActive.delete(camera);
      this.holdUntil.set(camera, Date.now() + MOTION_POSTROLL_MS);
      setTimeout(() => this.reconcile(), MOTION_POSTROLL_MS + 200);
    });
  }

  private wantsNow(id: string): boolean {
    if (getSettings().recording.mode !== 'motion') return true;
    return this.motionActive.has(id) || (this.holdUntil.get(id) ?? 0) > Date.now();
  }

  /** Start/stop recorders so they match the current settings. */
  reconcile() {
    const s = getSettings();
    const wanted = new Map<string, string>();
    if (s.recording.enabled) {
      for (const c of s.cameras) if (c.enabled && c.record) wanted.set(c.id, c.stream);
      if (s.demoMode) {
        wanted.set('sentinel_demo_1', 'sentinel_demo_1');
        wanted.set('sentinel_demo_2', 'sentinel_demo_2');
      }
      for (const id of [...wanted.keys()]) if (!this.wantsNow(id)) wanted.delete(id);
    }
    for (const [id, rec] of this.recorders) {
      if (wanted.get(id) !== rec.stream) {
        void rec.stop();
        this.recorders.delete(id);
      }
    }
    for (const [id, stream] of wanted) {
      if (this.recorders.has(id)) continue;
      const rec = new CameraRecorder(id, stream);
      this.recorders.set(id, rec);
      rec.start();
    }
  }

  async start() {
    if (this.started) return;
    this.started = true;
    mkdirSync(RECORDINGS_DIR(), { recursive: true });
    recoverPartFiles();
    // Give go2rtc a moment to come up so the first segment does not start with an error.
    for (let i = 0; i < 40 && !(await go2rtc.ping()); i++) await new Promise((r) => setTimeout(r, 250));
    this.reconcile();
    void enforceRetention();
    this.cleanupTimer = setInterval(() => void enforceRetention(), 10 * 60_000);
    this.scheduleMidnight();
  }

  /** End-of-day cleanup: one minute after local midnight, every day. */
  private scheduleMidnight() {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 1, 0).getTime();
    this.midnightTimer = setTimeout(() => {
      void enforceRetention();
      this.scheduleMidnight();
    }, next - now.getTime());
    this.midnightTimer.unref?.();
  }

  async stop() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.midnightTimer) clearTimeout(this.midnightTimer);
    await Promise.all([...this.recorders.values()].map((r) => r.stop()));
    this.recorders.clear();
    this.started = false;
  }

  status(): RecorderStatus[] {
    return [...this.recorders.values()].map((r) => ({
      cameraId: r.cameraId,
      stream: r.stream,
      state: r.state,
      since: r.since,
      lastError: r.lastError,
      currentFile: r.currentFile,
    }));
  }
}

export const recordings = new RecordingService();

// ---------------------------------------------------------------------------------------
export interface SegmentFile {
  camera: string;
  date: string;
  file: string;
  full: string;
  start: Date;
  seconds: number | null;
  size: number;
  inProgress: boolean;
}

const FILE_RE = /^(\d{2})-(\d{2})-(\d{2})(?:_(\d+))?(\.part)?\.mp4$/;

export function listSegments(camera?: string, date?: string): SegmentFile[] {
  const root = RECORDINGS_DIR();
  if (!existsSync(root)) return [];
  const out: SegmentFile[] = [];
  const cams = camera ? [camera] : readdirSync(root);
  for (const cam of cams) {
    const camDir = path.join(root, cam);
    if (!existsSync(camDir) || !statSync(camDir).isDirectory()) continue;
    const days = date ? [date] : readdirSync(camDir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    for (const day of days) {
      const dayDir = path.join(camDir, day);
      if (!existsSync(dayDir)) continue;
      const [y, mo, d] = day.split('-').map(Number);
      for (const f of readdirSync(dayDir)) {
        const m = FILE_RE.exec(f);
        if (!m) continue;
        const full = path.join(dayDir, f);
        const st = statSync(full);
        out.push({
          camera: cam,
          date: day,
          file: f,
          full,
          start: new Date(y, mo - 1, d, +m[1], +m[2], +m[3]),
          seconds: m[4] ? Number(m[4]) : null,
          size: st.size,
          inProgress: !!m[5],
        });
      }
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Whole calendar days are kept and deleted together, at the end of the day (local midnight):
 * with retentionDays = 2, today and yesterday are kept, and when a new day starts the day before
 * yesterday is deleted in one go. Returns the timestamp before which recordings are deleted.
 */
export function retentionCutoff(now: Date, retentionDays: number): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (retentionDays - 1)).getTime();
}

/** Delete whole days beyond retentionDays, then oldest-first until under maxGb. */
export async function enforceRetention(): Promise<{ deleted: number }> {
  const { retentionDays, maxGb } = getSettings().recording;
  const all = listSegments().filter((s) => !s.inProgress);
  const cutoff = retentionCutoff(new Date(), retentionDays);
  let deleted = 0;
  let total = listSegments().reduce((a, s) => a + s.size, 0);
  const maxBytes = maxGb * 1024 ** 3;
  for (const s of all) {
    if (s.start.getTime() < cutoff || total > maxBytes) {
      rmSync(s.full, { force: true });
      total -= s.size;
      deleted++;
    }
  }
  // Remove empty day/camera folders.
  const root = RECORDINGS_DIR();
  if (existsSync(root)) {
    for (const cam of readdirSync(root)) {
      const camDir = path.join(root, cam);
      if (!statSync(camDir).isDirectory()) continue;
      for (const day of readdirSync(camDir)) {
        const dayDir = path.join(camDir, day);
        if (statSync(dayDir).isDirectory() && readdirSync(dayDir).length === 0) rmSync(dayDir, { recursive: true, force: true });
      }
    }
  }
  return { deleted };
}
