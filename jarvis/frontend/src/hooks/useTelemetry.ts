import { useEffect, useState } from "react";
import { api } from "../lib/api";

export interface Telemetry {
  cpu_percent: number;
  ram_percent: number;
  gpu: string;
}

/** Polls the backend's *real* host metrics (psutil / nvidia-smi). Paused while the tab is hidden. */
export function useTelemetry(enabled: boolean): Telemetry | null {
  const [data, setData] = useState<Telemetry | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const s = (await api.systemStatus()) as {
          cpu_percent: number; ram_percent: number;
          gpu: { state: string; gpus?: { utilization_percent: number | null; vram_used_mb: number | null;
            vram_total_mb: number | null }[] };
        };
        const g = s.gpu.state === "ready" ? s.gpu.gpus?.[0] : undefined;
        const gpu = g
          ? `${g.utilization_percent ?? "—"}% · ${g.vram_used_mb != null && g.vram_total_mb != null
            ? `${(g.vram_used_mb / 1024).toFixed(1)}/${(g.vram_total_mb / 1024).toFixed(0)} GB` : "—"}`
          : "n/a";
        if (!stop) setData({ cpu_percent: s.cpu_percent, ram_percent: s.ram_percent, gpu });
      } catch {
        if (!stop) setData(null);
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 10_000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [enabled]);
  return data;
}

export function useClock(timeZone: string, locale: string): string {
  const fmt = () => {
    try {
      return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date());
    } catch {
      return new Date().toLocaleTimeString().slice(0, 5);
    }
  };
  const [now, setNow] = useState(fmt);
  useEffect(() => {
    setNow(fmt());
    const id = window.setInterval(() => setNow(fmt()), 15_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeZone, locale]);
  return now;
}
