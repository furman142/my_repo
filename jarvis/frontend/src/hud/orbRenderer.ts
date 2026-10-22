/**
 * Original Canvas renderer for the JARVIS orb: a luminous cyan core inside delicate concentric
 * tick / dashed / dotted rings and a drifting particle halo. Inspired by the reference video's
 * minimal aesthetic; all geometry is procedural (no third-party imagery).
 *
 * Pure function of (time, state, measured audio level/spectrum) so it is easy to reason about.
 */

import type { HudState } from "../app/stateMachine";

export interface OrbFrame {
  t: number; // seconds since mount
  state: HudState;
  /** 0..1 RMS level measured from the real mic (LISTENING) or real playback (SPEAKING). */
  level: number;
  /** Real analyser frequency bins (0..255) or null when no audio source is active. */
  spectrum: Uint8Array | null;
  /** 0..1 boot assembly progress. */
  boot: number;
  reducedMotion: boolean;
}

interface Palette {
  core: string;
  glow: [number, number, number];
  line: [number, number, number];
  accent: [number, number, number];
}

const CYAN: Palette = { core: "#f2feff", glow: [72, 220, 255], line: [120, 230, 255], accent: [120, 230, 255] };

function paletteFor(state: HudState): Palette {
  switch (state) {
    case "APPROVAL_REQUIRED":
      return { ...CYAN, accent: [255, 196, 92] };
    case "ERROR":
      return { core: "#ffe9ec", glow: [255, 92, 112], line: [255, 140, 150], accent: [255, 92, 112] };
    case "OFFLINE":
      return { core: "#cfdbe2", glow: [92, 120, 138], line: [110, 140, 158], accent: [110, 140, 158] };
    default:
      return CYAN;
  }
}

const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a))})`;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (v: number) => 1 - Math.pow(1 - clamp01(v), 3);
const TAU = Math.PI * 2;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

interface Particle {
  r: number; // radius fraction
  a: number; // base angle
  speed: number; // rad/s
  size: number;
  tw: number; // twinkle phase
}

const PARTICLES: Particle[] = (() => {
  const rnd = mulberry32(7331);
  const out: Particle[] = [];
  for (let i = 0; i < 260; i++) {
    // Denser near the rings, thinning outward — like the reference halo.
    const r = 0.44 + Math.pow(rnd(), 1.7) * 0.4;
    out.push({ r, a: rnd() * TAU, speed: (rnd() - 0.5) * 0.05 + 0.012, size: 0.6 + rnd() * 1.5, tw: rnd() * TAU });
  }
  return out;
})();

/** Speed multiplier for ring drift per state. */
function tempo(state: HudState): number {
  switch (state) {
    case "THINKING":
    case "TRANSCRIBING":
      return 3.2;
    case "EXECUTING":
      return 2.4;
    case "LISTENING":
    case "SPEAKING":
      return 1.6;
    case "OFFLINE":
      return 0.25;
    default:
      return 1;
  }
}

export function drawOrb(ctx: CanvasRenderingContext2D, w: number, h: number, f: OrbFrame): void {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const R = (Math.min(w, h) / 2) * 0.94;
  const pal = paletteFor(f.state);
  const motion = f.reducedMotion ? 0 : 1;
  const tt = f.t * tempo(f.state) * motion;
  const level = clamp01(f.level);
  const breath = f.reducedMotion ? 0 : 0.5 + 0.5 * Math.sin(f.t * (f.state === "IDLE" ? 0.55 : 1.1));
  const layer = (delay: number) => easeOut((f.boot - delay) / 0.45);
  const dim = f.state === "OFFLINE" ? 0.45 : 1;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalCompositeOperation = "lighter";

  // ---- outer haze
  const hazeA = layer(0) * dim;
  const haze = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.95);
  haze.addColorStop(0, rgba(pal.glow, 0.32 * hazeA + level * 0.12));
  haze.addColorStop(0.35, rgba(pal.glow, 0.1 * hazeA));
  haze.addColorStop(1, rgba(pal.glow, 0));
  ctx.fillStyle = haze;
  ctx.fillRect(-R, -R, R * 2, R * 2);

  // ---- particle halo
  const pA = layer(0.45) * dim;
  if (pA > 0) {
    for (const p of PARTICLES) {
      const ang = p.a + tt * p.speed * 2;
      const rr = R * p.r * (0.92 + 0.08 * layer(0.45)) + (f.state === "SPEAKING" ? level * R * 0.03 * Math.sin(p.tw) : 0);
      const tw = f.reducedMotion ? 0.7 : 0.45 + 0.55 * Math.abs(Math.sin(f.t * 0.8 + p.tw));
      const fade = 1 - (p.r - 0.44) / 0.42;
      ctx.fillStyle = rgba(pal.line, (0.25 + 0.6 * fade) * tw * pA);
      ctx.beginPath();
      ctx.arc(Math.cos(ang) * rr, Math.sin(ang) * rr, p.size * (R / 400), 0, TAU);
      ctx.fill();
    }
  }

  ctx.lineCap = "round";
  const px = Math.max(0.6, R / 500);

  // ---- outer faint segmented circle + cardinal brackets
  const oA = layer(0.6) * dim;
  if (oA > 0) {
    ctx.strokeStyle = rgba(pal.line, 0.12 * oA);
    ctx.lineWidth = px;
    ctx.setLineDash([2 * px, 9 * px]);
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.86, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = rgba(pal.accent, 0.45 * oA);
    ctx.lineWidth = 1.4 * px;
    for (let i = 0; i < 4; i++) {
      const a0 = i * (TAU / 4) + tt * 0.02;
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.86, a0 - 0.05, a0 + 0.05);
      ctx.stroke();
    }
  }

  // ---- dotted ring
  const dA = layer(0.35) * dim;
  if (dA > 0) {
    const n = 140;
    const rr = R * 0.43;
    ctx.fillStyle = rgba(pal.line, 0.55 * dA);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU - tt * 0.03;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, (i % 10 === 0 ? 1.6 : 0.9) * px, 0, TAU);
      ctx.fill();
    }
  }

  // ---- dashed arcs (counter-rotating)
  const aA = layer(0.25) * dim;
  if (aA > 0) {
    ctx.strokeStyle = rgba(pal.line, 0.5 * aA);
    ctx.lineWidth = 1.2 * px;
    const rr = R * 0.37;
    for (let i = 0; i < 3; i++) {
      const a0 = i * (TAU / 3) - tt * 0.07;
      ctx.beginPath();
      ctx.arc(0, 0, rr, a0, a0 + 1.35);
      ctx.stroke();
    }
    ctx.setLineDash([1.5 * px, 4 * px]);
    ctx.strokeStyle = rgba(pal.line, 0.3 * aA);
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.395, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ---- radial tick ring (the signature element of the reference)
  const kA = layer(0.12) * dim;
  if (kA > 0) {
    const n = 90;
    const r0 = R * 0.25;
    const spin = tt * 0.045;
    ctx.lineWidth = 1.1 * px;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + spin;
      const major = i % 5 === 0;
      const len = R * (major ? 0.06 : 0.035);
      ctx.strokeStyle = rgba(pal.line, (major ? 0.75 : 0.42) * kA);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * (r0 + len), Math.sin(a) * (r0 + len));
      ctx.stroke();
    }
    ctx.strokeStyle = rgba(pal.line, 0.5 * kA);
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.32, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = rgba(pal.line, 0.3 * kA);
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.235, 0, TAU);
    ctx.stroke();
  }

  // ---- real audio spectrum ring (only from a live analyser; never synthesised)
  if (f.spectrum && (f.state === "SPEAKING" || f.state === "LISTENING")) {
    const bins = f.spectrum;
    const n = 96;
    const r0 = R * 0.325;
    ctx.lineWidth = 1.6 * px;
    for (let i = 0; i < n; i++) {
      // mirror the useful low/mid band around the circle
      const k = Math.floor(((i < n / 2 ? i : n - i) / (n / 2)) * bins.length * 0.55);
      const v = (bins[k] ?? 0) / 255;
      if (v < 0.04) continue;
      const a = (i / n) * TAU - Math.PI / 2;
      ctx.strokeStyle = rgba(pal.accent, 0.25 + v * 0.7);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * (r0 + v * R * 0.09), Math.sin(a) * (r0 + v * R * 0.09));
      ctx.stroke();
    }
  }

  // ---- thinking / transcribing sweep
  if ((f.state === "THINKING" || f.state === "TRANSCRIBING" || f.state === "EXECUTING") && !f.reducedMotion) {
    const a0 = f.t * (f.state === "EXECUTING" ? 2.2 : 3.4);
    const rr = R * 0.37;
    for (let i = 0; i < 14; i++) {
      ctx.strokeStyle = rgba(pal.accent, 0.85 * (1 - i / 14));
      ctx.lineWidth = 2.2 * px;
      ctx.beginPath();
      ctx.arc(0, 0, rr, a0 - i * 0.05, a0 - i * 0.05 + 0.05);
      ctx.stroke();
    }
  }

  // ---- approval: slow amber pulse ring
  if (f.state === "APPROVAL_REQUIRED") {
    const p = f.reducedMotion ? 0.6 : 0.5 + 0.5 * Math.sin(f.t * 2.4);
    ctx.strokeStyle = rgba(pal.accent, 0.35 + 0.4 * p);
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.arc(0, 0, R * (0.2 + 0.01 * p), 0, TAU);
    ctx.stroke();
  }

  // ---- listening rim reacting to the real microphone level
  if (f.state === "LISTENING") {
    ctx.strokeStyle = rgba(pal.line, 0.45 + level * 0.5);
    ctx.lineWidth = (1.5 + level * 3) * px;
    ctx.beginPath();
    ctx.arc(0, 0, R * (0.17 + level * 0.05), 0, TAU);
    ctx.stroke();
  }

  // ---- core
  const cA = layer(0) * dim;
  const coreR = R * (0.085 + 0.012 * breath + level * 0.05);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR * 3.4);
  glow.addColorStop(0, rgba(pal.glow, 0.95 * cA));
  glow.addColorStop(0.25, rgba(pal.glow, 0.55 * cA));
  glow.addColorStop(0.6, rgba(pal.glow, 0.14 * cA));
  glow.addColorStop(1, rgba(pal.glow, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, coreR * 3.4, 0, TAU);
  ctx.fill();

  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR);
  core.addColorStop(0, pal.core);
  core.addColorStop(0.55, rgba([230, 252, 255], 0.9 * cA));
  core.addColorStop(1, rgba(pal.glow, 0));
  ctx.globalAlpha = cA;
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, coreR, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.restore();
}
