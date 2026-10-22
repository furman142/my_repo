/**
 * Push-to-talk microphone capture with MediaRecorder. Picks a container the browser actually
 * supports (Chrome/Edge: WebM/Opus, iOS Safari: MP4/AAC); the backend decodes either.
 */

import { micLevel, type LevelSource } from "../../hud/audio";

const CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
export const MAX_RECORDING_MS = 30_000;

export function pickMimeType(isSupported: (t: string) => boolean): string {
  return CANDIDATES.find((t) => isSupported(t)) ?? "";
}

export function micSupported(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

export class PushToTalk {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private meter: { source: LevelSource; dispose: () => void } | null = null;
  private timer: number | undefined;
  private cancelled = false;

  get level(): LevelSource | null {
    return this.meter?.source ?? null;
  }

  async start(onAutoStop: () => void): Promise<void> {
    this.cancelled = false;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false,
    });
    const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType, audioBitsPerSecond: 64000 } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.meter = micLevel(this.stream);
    this.recorder.start(250);
    this.timer = window.setTimeout(onAutoStop, MAX_RECORDING_MS);
  }

  /** Stop and return the recording (or null if cancelled / empty). */
  stop(): Promise<Blob | null> {
    window.clearTimeout(this.timer);
    const rec = this.recorder;
    if (!rec || rec.state === "inactive") {
      this.release();
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      rec.onstop = () => {
        const type = rec.mimeType || this.chunks[0]?.type || "audio/webm";
        const blob = new Blob(this.chunks, { type });
        this.chunks = [];
        this.release();
        resolve(this.cancelled || blob.size < 1200 ? null : blob);
      };
      rec.stop();
    });
  }

  cancel(): void {
    this.cancelled = true;
    void this.stop();
  }

  private release(): void {
    this.meter?.dispose();
    this.meter = null;
    this.stream?.getTracks().forEach((t) => t.stop()); // turns the OS mic indicator off
    this.stream = null;
    this.recorder = null;
  }
}
