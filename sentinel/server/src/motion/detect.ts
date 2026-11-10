/**
 * Frame-difference motion detection on small frames (pure functions, unit-tested).
 *
 * Input: RGB24 frames (e.g. 320×180 at 2 fps, from the camera's SD substream via ffmpeg).
 * 1. Downsample to a coarse grayscale grid (4×4 pixel cells) – kills sensor noise and JPEG/HEVC
 *    blocking artefacts.
 * 2. Compare against a slowly adapting background (exponential moving average).
 * 3. A cell "changed" if it differs from the background by more than `cellThreshold` levels.
 * 4. Motion = changed-cell ratio above the sensitivity threshold for `confirmFrames` frames.
 * 5. A huge change (> `lightingRatio`) is a lighting change (IR night-mode switch, lights on,
 *    clouds) — the background is reset and no motion is reported.
 */

export type Sensitivity = 'low' | 'medium' | 'high';

export const SENSITIVITY_RATIO: Record<Sensitivity, number> = {
  low: 0.04,
  medium: 0.015,
  high: 0.006,
};

export interface DetectorOptions {
  width: number;
  height: number;
  cell?: number; // pixels per grid cell side
  cellThreshold?: number; // gray levels
  sensitivity?: Sensitivity;
  confirmFrames?: number;
  warmupFrames?: number;
  lightingRatio?: number;
  bgAlpha?: number; // background adaptation per frame (no motion)
}

export interface FrameResult {
  ratio: number; // changed cells / all cells
  motion: boolean; // confirmed motion on this frame
  lighting: boolean; // frame classified as lighting change
  box: [number, number, number, number] | null; // normalized x, y, w, h of changed cells
}

export class MotionDetector {
  readonly gw: number;
  readonly gh: number;
  private bg: Float32Array | null = null;
  private frames = 0;
  private streak = 0;
  private o: Required<DetectorOptions>;

  constructor(opts: DetectorOptions) {
    this.o = {
      cell: 4,
      cellThreshold: 18,
      sensitivity: 'medium',
      confirmFrames: 2,
      warmupFrames: 6,
      lightingRatio: 0.5,
      bgAlpha: 0.05,
      ...opts,
    };
    this.gw = Math.floor(this.o.width / this.o.cell);
    this.gh = Math.floor(this.o.height / this.o.cell);
  }

  setSensitivity(s: Sensitivity) {
    this.o.sensitivity = s;
  }

  /** Coarse grayscale grid from an RGB24 frame. */
  grid(rgb: Uint8Array): Float32Array {
    const { width, cell } = this.o;
    const g = new Float32Array(this.gw * this.gh);
    const n = cell * cell;
    for (let gy = 0; gy < this.gh; gy++) {
      for (let gx = 0; gx < this.gw; gx++) {
        let sum = 0;
        for (let y = gy * cell; y < gy * cell + cell; y++) {
          let i = (y * width + gx * cell) * 3;
          for (let x = 0; x < cell; x++, i += 3) sum += 0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2];
        }
        g[gy * this.gw + gx] = sum / n;
      }
    }
    return g;
  }

  push(rgb: Uint8Array): FrameResult {
    const g = this.grid(rgb);
    this.frames++;
    if (!this.bg || this.frames <= this.o.warmupFrames) {
      this.bg = this.bg ? blend(this.bg, g, 0.5) : g;
      return { ratio: 0, motion: false, lighting: false, box: null };
    }

    let changed = 0;
    let minX = this.gw, minY = this.gh, maxX = -1, maxY = -1;
    for (let y = 0; y < this.gh; y++) {
      for (let x = 0; x < this.gw; x++) {
        const k = y * this.gw + x;
        if (Math.abs(g[k] - this.bg[k]) > this.o.cellThreshold) {
          changed++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const ratio = changed / g.length;

    if (ratio > this.o.lightingRatio) {
      this.bg = g; // new lighting conditions
      this.streak = 0;
      return { ratio, motion: false, lighting: true, box: null };
    }

    const over = ratio >= SENSITIVITY_RATIO[this.o.sensitivity];
    this.streak = over ? this.streak + 1 : 0;
    const motion = this.streak >= this.o.confirmFrames;
    // Adapt slowly; much slower while something is moving so it is not absorbed.
    this.bg = blend(this.bg, g, over ? this.o.bgAlpha / 10 : this.o.bgAlpha);
    const box: FrameResult['box'] =
      changed > 0 ? [minX / this.gw, minY / this.gh, (maxX - minX + 1) / this.gw, (maxY - minY + 1) / this.gh] : null;
    return { ratio, motion, lighting: false, box };
  }
}

function blend(bg: Float32Array, g: Float32Array, a: number): Float32Array {
  const out = new Float32Array(bg.length);
  for (let i = 0; i < bg.length; i++) out[i] = bg[i] * (1 - a) + g[i] * a;
  return out;
}

/**
 * Turns per-frame motion flags into events: starts on the first confirmed frame, ends after
 * `endAfterMs` without motion.
 */
export class EventTracker {
  active: { start: number; last: number; peak: number; box: FrameResult['box']; peakAt: number } | null = null;

  constructor(
    private endAfterMs = 8000,
    /** Split very long activity (a tree in the wind) into separate events. */
    private maxEventMs = 5 * 60_000,
  ) {}

  /** Returns 'start' | 'end' | null for this frame. */
  update(r: FrameResult, now: number): 'start' | 'end' | null {
    if (this.active && now - this.active.start >= this.maxEventMs) return 'end';
    if (r.motion) {
      if (!this.active) {
        this.active = { start: now, last: now, peak: r.ratio, box: r.box, peakAt: now };
        return 'start';
      }
      this.active.last = now;
      if (r.ratio > this.active.peak) {
        this.active.peak = r.ratio;
        this.active.box = r.box;
        this.active.peakAt = now;
      }
      return null;
    }
    if (this.active && now - this.active.last >= this.endAfterMs) return 'end';
    return null;
  }

  close() {
    const a = this.active;
    this.active = null;
    return a;
  }
}
