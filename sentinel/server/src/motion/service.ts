/**
 * Runs one motion detector per camera.
 *
 *   go2rtc /api/stream.mp4 (SD substream) --HTTP--> SENTINEL --stdin--> ffmpeg --stdout--> RGB frames
 *
 * SENTINEL fetches the stream itself and pipes it into ffmpeg, so ffmpeg never sees the go2rtc
 * password (nothing secret on its command line). ffmpeg decodes the low-resolution substream and
 * emits 320×180 RGB frames at 2 fps — cheap even for H.265.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import jpeg from 'jpeg-js';
import { go2rtc } from '../go2rtc/client.js';
import { redact } from '../security/redact.js';
import { getSettings, type Camera } from '../settings/store.js';
import { EventTracker, MotionDetector, type Sensitivity } from './detect.js';
import { enforceEventRetention, newEventId, saveEvent, type MotionEvent } from './events.js';

const W = 320;
const H = 180;
const FPS = 2;
const FRAME_BYTES = W * H * 3;

let ffmpegPathCache: string | null = null;
async function ffmpegPath(): Promise<string> {
  if (process.env.FFMPEG_BIN) return process.env.FFMPEG_BIN;
  if (ffmpegPathCache) return ffmpegPathCache;
  try {
    const mod = (await import('ffmpeg-static')) as unknown as { default: string | null };
    if (mod.default) return (ffmpegPathCache = mod.default);
  } catch {
    /* not installed */
  }
  return (ffmpegPathCache = 'ffmpeg'); // system PATH
}

export type DetectorState = 'watching' | 'waiting' | 'stopped';

export interface ActiveMotion {
  id: string;
  camera: string;
  start: string;
}

/** Encode an RGB24 frame as JPEG, with the motion box drawn on it. */
export function thumbnail(rgb: Uint8Array, box: MotionEvent['box']): Buffer {
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    rgba[j] = rgb[i];
    rgba[j + 1] = rgb[i + 1];
    rgba[j + 2] = rgb[i + 2];
    rgba[j + 3] = 255;
  }
  if (box) {
    const x0 = Math.max(0, Math.floor(box[0] * W));
    const y0 = Math.max(0, Math.floor(box[1] * H));
    const x1 = Math.min(W - 1, Math.ceil((box[0] + box[2]) * W));
    const y1 = Math.min(H - 1, Math.ceil((box[1] + box[3]) * H));
    const px = (x: number, y: number) => {
      const j = (y * W + x) * 4;
      rgba[j] = 239;
      rgba[j + 1] = 68;
      rgba[j + 2] = 68;
    };
    for (let t = 0; t < 2; t++) {
      for (let x = x0; x <= x1; x++) {
        px(x, Math.min(H - 1, y0 + t));
        px(x, Math.max(0, y1 - t));
      }
      for (let y = y0; y <= y1; y++) {
        px(Math.min(W - 1, x0 + t), y);
        px(Math.max(0, x1 - t), y);
      }
    }
  }
  return jpeg.encode({ data: rgba, width: W, height: H }, 78).data;
}

class CameraDetector {
  state: DetectorState = 'waiting';
  lastError: string | null = null;
  active: ActiveMotion | null = null;
  private stopped = false;
  private ac: AbortController | null = null;
  private proc: ChildProcess | null = null;
  private backoffMs = 5000;
  private timer: NodeJS.Timeout | null = null;
  private detector: MotionDetector;
  private tracker = new EventTracker(8000);
  private peakFrame: Uint8Array | null = null;

  constructor(
    readonly camera: string,
    readonly stream: string,
    private sensitivity: Sensitivity,
    private emit: (type: 'start' | 'end', ev: MotionEvent | ActiveMotion) => void,
  ) {
    this.detector = new MotionDetector({ width: W, height: H, sensitivity });
  }

  setSensitivity(s: Sensitivity) {
    this.sensitivity = s;
    this.detector.setSensitivity(s);
  }

  start() {
    this.stopped = false;
    void this.run();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.ac?.abort();
    this.proc?.kill('SIGKILL');
    this.finishEvent(Date.now());
    this.state = 'stopped';
  }

  private retry() {
    if (this.stopped) return;
    this.state = 'waiting';
    this.timer = setTimeout(() => void this.run(), this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
  }

  private async run() {
    if (this.stopped) return;
    const bin = await ffmpegPath();
    this.ac = new AbortController();
    try {
      const q = new URLSearchParams({ src: this.stream, video: 'all' });
      const res = await go2rtc.raw(`/api/stream.mp4?${q}`, { signal: this.ac.signal } as RequestInit, 24 * 3600 * 1000);
      if (!res.ok || !res.body) throw new Error((await res.text()).trim() || res.statusText);

      const proc = spawn(
        bin,
        ['-hide_banner', '-loglevel', 'error', '-fflags', 'nobuffer', '-i', 'pipe:0', '-an', '-vf', `fps=${FPS},scale=${W}:${H}`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'],
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
      );
      this.proc = proc;
      let stderr = '';
      proc.stderr!.on('data', (d) => (stderr = (stderr + d.toString()).slice(-400)));
      const input = Readable.fromWeb(res.body as never);
      input.on('error', () => proc.stdin!.destroy());
      proc.stdin!.on('error', () => input.destroy());
      input.pipe(proc.stdin!);

      let buf: Buffer = Buffer.alloc(0);
      proc.stdout!.on('data', (chunk: Buffer) => {
        buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
        while (buf.length >= FRAME_BYTES) {
          const frame = buf.subarray(0, FRAME_BYTES);
          buf = buf.subarray(FRAME_BYTES);
          this.onFrame(new Uint8Array(frame));
        }
      });

      const code: number | null = await new Promise((resolve) => {
        proc.on('exit', resolve);
        proc.on('error', (err) => {
          stderr = String(err.message);
          resolve(-1);
        });
      });
      this.ac.abort();
      if (!this.stopped) this.lastError = redact(stderr.trim() || `ffmpeg exited (${code})`).slice(0, 300);
    } catch (err) {
      if (!this.stopped) this.lastError = redact(String((err as Error).message ?? err)).slice(0, 300);
    } finally {
      this.proc = null;
      this.finishEvent(Date.now());
      this.retry();
    }
  }

  private onFrame(rgb: Uint8Array) {
    if (this.state !== 'watching') {
      this.state = 'watching';
      this.lastError = null;
      this.backoffMs = 5000;
    }
    const now = Date.now();
    const r = this.detector.push(rgb);
    const prevPeak = this.tracker.active?.peak ?? -1;
    const what = this.tracker.update(r, now);
    if (what === 'start') {
      this.peakFrame = rgb.slice();
      const start = new Date(now);
      this.active = { id: newEventId(this.camera, start), camera: this.camera, start: start.toISOString() };
      this.emit('start', this.active);
    } else if (this.tracker.active && this.tracker.active.peak > prevPeak && now - this.tracker.active.start < 4000) {
      this.peakFrame = rgb.slice(); // best thumbnail within the first seconds
    } else if (what === 'end') {
      this.finishEvent(now);
    }
  }

  private finishEvent(now: number) {
    const a = this.tracker.close();
    if (!a || !this.active) {
      this.active = null;
      return;
    }
    const ev: MotionEvent = {
      id: this.active.id,
      camera: this.camera,
      start: new Date(a.start).toISOString(),
      end: new Date(Math.max(a.last, a.start + 1000)).toISOString(),
      peak: Math.round(a.peak * 10000) / 10000,
      box: a.box,
      thumb: !!this.peakFrame,
    };
    try {
      saveEvent(ev, this.peakFrame ? thumbnail(this.peakFrame, a.box) : undefined);
    } catch {
      /* disk full etc. — keep detecting */
    }
    this.peakFrame = null;
    this.active = null;
    this.emit('end', ev);
    void now;
  }
}

// ---------------------------------------------------------------------------------------
class MotionService extends EventEmitter {
  private detectors = new Map<string, CameraDetector>();
  private cleanup: NodeJS.Timeout | null = null;

  /** Which go2rtc stream to analyse: the SD substream when there is one (much cheaper). */
  private static streamFor(c: Pick<Camera, 'stream' | 'streamSd'>) {
    return c.streamSd ?? c.stream;
  }

  reconcile() {
    const s = getSettings();
    const wanted = new Map<string, { stream: string; sens: Sensitivity }>();
    if (s.motion.enabled) {
      for (const c of s.cameras) {
        if (c.enabled && c.motion !== 'off') wanted.set(c.id, { stream: MotionService.streamFor(c), sens: c.motion });
      }
      if (s.demoMode) {
        wanted.set('sentinel_demo_1', { stream: 'sentinel_demo_1', sens: 'medium' });
        wanted.set('sentinel_demo_2', { stream: 'sentinel_demo_2', sens: 'medium' });
      }
    }
    for (const [id, d] of this.detectors) {
      const w = wanted.get(id);
      if (!w || w.stream !== d.stream) {
        d.stop();
        this.detectors.delete(id);
      } else d.setSensitivity(w.sens);
    }
    for (const [id, w] of wanted) {
      if (this.detectors.has(id)) continue;
      const d = new CameraDetector(id, w.stream, w.sens, (type, ev) => this.emit(type === 'start' ? 'motion-start' : 'motion-end', ev));
      this.detectors.set(id, d);
      d.start();
    }
  }

  start() {
    this.reconcile();
    const clean = () => enforceEventRetention(getSettings().motion.retentionDays);
    clean();
    this.cleanup = setInterval(clean, 6 * 3600 * 1000);
  }

  stop() {
    if (this.cleanup) clearInterval(this.cleanup);
    for (const d of this.detectors.values()) d.stop();
    this.detectors.clear();
  }

  status() {
    return [...this.detectors.values()].map((d) => ({ camera: d.camera, stream: d.stream, state: d.state, lastError: d.lastError, active: d.active }));
  }

  activeMotion(): ActiveMotion[] {
    return [...this.detectors.values()].map((d) => d.active).filter((a): a is ActiveMotion => !!a);
  }
}

export const motion = new MotionService();
