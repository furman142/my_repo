/**
 * Local object detection with YOLOX (Apache-2.0, Megvii) running on onnxruntime (MIT).
 * Everything stays on this computer: frames are never sent anywhere.
 *
 * Model: yolox_tiny.onnx from the official YOLOX release 0.1.1rc0 — input 1×3×416×416, BGR,
 * raw 0-255 values; output 1×3549×85 that still needs grid decoding (see `decode`).
 */

export type Label = 'person' | 'vehicle' | 'animal';

export interface Detection {
  label: Label;
  /** COCO class name, e.g. "car". */
  cls: string;
  score: number;
  /** x, y, w, h — normalized (0..1) to the source frame. */
  box: [number, number, number, number];
}

export const INPUT = 416;
const STRIDES = [8, 16, 32];
const NUM_CLASSES = 80;

/** COCO classes we care about. Everything else (chairs, plants, …) is ignored. */
const CLASSES: Record<number, { name: string; label: Label }> = {
  0: { name: 'person', label: 'person' },
  1: { name: 'bicycle', label: 'vehicle' },
  2: { name: 'car', label: 'vehicle' },
  3: { name: 'motorcycle', label: 'vehicle' },
  5: { name: 'bus', label: 'vehicle' },
  7: { name: 'truck', label: 'vehicle' },
  14: { name: 'bird', label: 'animal' },
  15: { name: 'cat', label: 'animal' },
  16: { name: 'dog', label: 'animal' },
};

/**
 * RGB24 frame → letterboxed 416×416 CHW float tensor in BGR order (padding value 114), as in
 * YOLOX's own preprocessing. Returns the scale used, to map boxes back.
 */
export function letterbox(rgb: Uint8Array, w: number, h: number): { data: Float32Array; scale: number } {
  const scale = Math.min(INPUT / w, INPUT / h);
  const nw = Math.round(w * scale);
  const nh = Math.round(h * scale);
  const plane = INPUT * INPUT;
  const data = new Float32Array(3 * plane).fill(114);
  for (let y = 0; y < nh; y++) {
    // bilinear sampling
    const sy = Math.min(h - 1, (y + 0.5) / scale - 0.5);
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(h - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(w - 1, (x + 0.5) / scale - 0.5);
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(w - 1, x0 + 1);
      const fx = sx - x0;
      const a = (y0 * w + x0) * 3;
      const b = (y0 * w + x1) * 3;
      const c = (y1 * w + x0) * 3;
      const d = (y1 * w + x1) * 3;
      const o = y * INPUT + x;
      for (let ch = 0; ch < 3; ch++) {
        const top = rgb[a + ch] * (1 - fx) + rgb[b + ch] * fx;
        const bot = rgb[c + ch] * (1 - fx) + rgb[d + ch] * fx;
        // RGB → BGR plane order
        data[(2 - ch) * plane + o] = top * (1 - fy) + bot * fy;
      }
    }
  }
  return { data, scale };
}

function iou(a: Detection['box'], b: Detection['box']): number {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a[2] * a[3] + b[2] * b[3] - inter || 1);
}

/** Per-label non-maximum suppression. */
export function nms(dets: Detection[], threshold = 0.45): Detection[] {
  const out: Detection[] = [];
  for (const d of [...dets].sort((a, b) => b.score - a.score)) {
    if (!out.some((k) => k.label === d.label && iou(k.box, d.box) > threshold)) out.push(d);
  }
  return out;
}

/**
 * Decode the raw YOLOX head output (rows of [cx, cy, w, h, objectness, 80 class scores] relative
 * to their grid cell) into boxes normalized to the source frame.
 */
export function decode(out: Float32Array, scale: number, w: number, h: number, minScore: number): Detection[] {
  const dets: Detection[] = [];
  const row = 5 + NUM_CLASSES;
  let i = 0;
  for (const stride of STRIDES) {
    const g = INPUT / stride;
    for (let gy = 0; gy < g; gy++) {
      for (let gx = 0; gx < g; gx++, i += row) {
        const obj = out[i + 4];
        if (obj < minScore) continue;
        let best = -1;
        let bestScore = 0;
        for (const key in CLASSES) {
          const s = out[i + 5 + Number(key)] * obj;
          if (s > bestScore) {
            bestScore = s;
            best = Number(key);
          }
        }
        if (best < 0 || bestScore < minScore) continue;
        const cx = ((out[i] + gx) * stride) / scale;
        const cy = ((out[i + 1] + gy) * stride) / scale;
        const bw = (Math.exp(out[i + 2]) * stride) / scale;
        const bh = (Math.exp(out[i + 3]) * stride) / scale;
        const x = Math.max(0, cx - bw / 2);
        const y = Math.max(0, cy - bh / 2);
        dets.push({
          label: CLASSES[best].label,
          cls: CLASSES[best].name,
          score: Math.round(bestScore * 1000) / 1000,
          box: [x / w, y / h, Math.min(w - x, bw) / w, Math.min(h - y, bh) / h],
        });
      }
    }
  }
  return nms(dets);
}

interface OrtSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>;
}

export class ObjectDetector {
  private busy = false;

  private constructor(
    private session: OrtSession,
    private Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown,
  ) {}

  /** Throws when the runtime or the model cannot be loaded; callers fall back to plain motion. */
  static async load(modelPath: string): Promise<ObjectDetector> {
    const ort = (await import('onnxruntime-node')) as unknown as {
      InferenceSession: { create(path: string, opts: object): Promise<OrtSession> };
      Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown;
      default?: unknown;
    };
    const api = (ort.default as typeof ort | undefined) ?? ort;
    // Two threads: fast enough (tens of ms per frame) without starving the video relay.
    const session = await api.InferenceSession.create(modelPath, { intraOpNumThreads: 2, interOpNumThreads: 1, executionProviders: ['cpu'] });
    return new ObjectDetector(session, api.Tensor);
  }

  get isBusy() {
    return this.busy;
  }

  async detect(rgb: Uint8Array, w: number, h: number, minScore = 0.4): Promise<Detection[]> {
    this.busy = true;
    try {
      const { data, scale } = letterbox(rgb, w, h);
      const input = new this.Tensor('float32', data, [1, 3, INPUT, INPUT]);
      const result = await this.session.run({ [this.session.inputNames[0]]: input });
      return decode(result[this.session.outputNames[0]].data, scale, w, h, minScore);
    } finally {
      this.busy = false;
    }
  }
}
