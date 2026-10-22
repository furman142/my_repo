/**
 * Web Audio plumbing: one shared AudioContext (unlocked on a user gesture), a playback chain
 * whose analyser measures the *actual* reply audio, and a mic analyser for LISTENING.
 */

let ctx: AudioContext | null = null;

export function audioContext(): AudioContext {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
  }
  return ctx;
}

/** Must be called from a user gesture (click/tap/keydown) — required by iOS Safari and Chrome autoplay. */
export async function unlockAudio(): Promise<void> {
  const c = audioContext();
  if (c.state === "suspended") await c.resume();
}

export interface LevelSource {
  level(): number;
  spectrum(): Uint8Array | null;
}

class AnalyserLevel implements LevelSource {
  private time: Uint8Array<ArrayBuffer>;
  private freq: Uint8Array<ArrayBuffer>;
  private smoothed = 0;

  constructor(public analyser: AnalyserNode) {
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.7;
    this.time = new Uint8Array(analyser.fftSize);
    this.freq = new Uint8Array(analyser.frequencyBinCount);
  }

  level(): number {
    this.analyser.getByteTimeDomainData(this.time);
    let sum = 0;
    for (const v of this.time) {
      const x = (v - 128) / 128;
      sum += x * x;
    }
    const rms = Math.sqrt(sum / this.time.length);
    const target = Math.min(1, rms * 3.2);
    this.smoothed += (target - this.smoothed) * 0.35;
    return this.smoothed;
  }

  spectrum(): Uint8Array {
    this.analyser.getByteFrequencyData(this.freq);
    return this.freq;
  }
}

/** Plays decoded reply audio deterministically: a new reply always stops the previous one. */
export class ReplyPlayer {
  private source: AudioBufferSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private meter: AnalyserLevel | null = null;
  private lastBuffer: AudioBuffer | null = null;
  private generation = 0;

  get active(): LevelSource | null {
    return this.source ? this.meter : null;
  }

  get canReplay(): boolean {
    return this.lastBuffer !== null;
  }

  async play(data: ArrayBuffer, onStart: () => void, onEnd: () => void): Promise<void> {
    const c = audioContext();
    const gen = ++this.generation;
    const buffer = await c.decodeAudioData(data.slice(0));
    if (gen !== this.generation) return; // superseded while decoding
    this.lastBuffer = buffer;
    this.start(buffer, gen, onStart, onEnd);
  }

  replay(onStart: () => void, onEnd: () => void): void {
    if (this.lastBuffer) this.start(this.lastBuffer, ++this.generation, onStart, onEnd);
  }

  private start(buffer: AudioBuffer, gen: number, onStart: () => void, onEnd: () => void): void {
    this.stopSource();
    const c = audioContext();
    if (!this.analyser) {
      this.analyser = c.createAnalyser();
      this.analyser.connect(c.destination);
      this.meter = new AnalyserLevel(this.analyser);
    }
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.connect(this.analyser);
    src.onended = () => {
      if (gen === this.generation) {
        this.source = null;
        onEnd();
      }
    };
    this.source = src;
    src.start();
    onStart();
  }

  private stopSource(): void {
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
      this.source = null;
    }
  }

  /** Interrupt playback (and any pending decode). */
  stop(): void {
    this.generation++;
    this.stopSource();
  }
}

export function micLevel(stream: MediaStream): { source: LevelSource; dispose: () => void } {
  const c = audioContext();
  const node = c.createMediaStreamSource(stream);
  const analyser = c.createAnalyser();
  node.connect(analyser); // not connected to destination: no echo
  const source = new AnalyserLevel(analyser);
  return { source, dispose: () => node.disconnect() };
}
