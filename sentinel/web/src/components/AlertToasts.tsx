import { Activity, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { Route } from '../lib/router';
import type { Alert } from '../lib/types';

const pad = (n: number) => String(n).padStart(2, '0');

/** In-app motion alerts (the desktop app additionally shows native notifications). */
export function AlertToasts({ navigate }: { navigate: (r: Route) => void }) {
  const [toasts, setToasts] = useState<Alert[]>([]);
  const since = useRef<number | null>(null);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const r = await api<{ seq: number; alerts: Alert[] }>(`/api/events/alerts?since=${since.current ?? 0}`);
        if (since.current === null) {
          since.current = r.seq; // don't replay old alerts when the page opens
          return;
        }
        since.current = r.seq;
        if (r.alerts.length && !stop) setToasts((t) => [...r.alerts, ...t].slice(0, 4));
      } catch {
        /* server restarting */
      }
    };
    void poll();
    const t = window.setInterval(poll, 3000);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!toasts.length) return;
    const t = window.setTimeout(() => setToasts((x) => x.slice(0, -1)), 12_000);
    return () => window.clearTimeout(t);
  }, [toasts]);

  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-20 start-4 z-40 flex w-72 flex-col gap-2 lg:bottom-6" role="status" aria-live="polite">
      {toasts.map((a) => {
        const d = new Date(a.start);
        return (
          <div key={a.seq} className="flex items-start gap-3 rounded-xl border border-warn/40 bg-ink-900/95 p-3 shadow-lg backdrop-blur animate-fadeIn">
            <Activity className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
            <button className="min-w-0 flex-1 text-start" onClick={() => navigate('events')}>
              <div className="text-sm font-medium text-ink-100">תנועה: {a.name}</div>
              <div className="font-mono text-[11px] text-ink-400" dir="ltr">
                {pad(d.getHours())}:{pad(d.getMinutes())}:{pad(d.getSeconds())}
              </div>
            </button>
            <button onClick={() => setToasts((t) => t.filter((x) => x.seq !== a.seq))} className="text-ink-400 hover:text-white" aria-label="סגור">
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
