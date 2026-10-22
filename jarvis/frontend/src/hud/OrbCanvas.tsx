import { useEffect, useRef } from "react";
import type { HudState } from "../app/stateMachine";
import type { LevelSource } from "./audio";
import { drawOrb } from "./orbRenderer";

interface Props {
  state: HudState;
  /** Returns the currently active, *real* audio source (mic or playback), if any. */
  getSource: () => LevelSource | null;
  bootMs: number;
}

const BOOT_SECONDS = 2.4;

export function OrbCanvas({ state, getSource, bootMs }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const sourceRef = useRef(getSource);
  sourceRef.current = getSource;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let raf = 0;
    let last = 0;
    const started = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const s = stateRef.current;
      const reducedMotion = !!reduced?.matches;
      // Idle + reduced motion: ~10 fps is plenty; otherwise full rate.
      const minDelta = reducedMotion || s === "OFFLINE" ? 100 : 0;
      if (now - last < minDelta) return;
      last = now;
      const src = s === "LISTENING" || s === "SPEAKING" ? sourceRef.current() : null;
      const elapsed = (now - started) / 1000;
      drawOrb(ctx, canvas.width, canvas.height, {
        t: elapsed,
        state: s,
        level: src ? src.level() : 0,
        spectrum: src ? src.spectrum() : null,
        boot: bootMs <= 0 ? 1 : Math.min(1, elapsed / BOOT_SECONDS),
        reducedMotion,
      });
    };

    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(frame); // no GPU work while hidden
    };
    document.addEventListener("visibilitychange", onVisibility);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [bootMs]);

  return <canvas ref={canvasRef} className="orb-canvas" aria-hidden="true" data-state={state} />;
}
