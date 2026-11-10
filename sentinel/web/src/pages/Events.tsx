import { Activity, Bell, Film, Settings as SettingsIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { api } from '../lib/api';
import { requestJump } from '../lib/jump';
import type { Route } from '../lib/router';
import type { MotionEvent, SystemStatus } from '../lib/types';
import { cn } from '../lib/util';

const pad = (n: number) => String(n).padStart(2, '0');
const hms = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const dur = (s: string, e: string) => {
  const sec = Math.max(1, Math.round((new Date(e).getTime() - new Date(s).getTime()) / 1000));
  return sec < 60 ? `${sec} שנ׳` : `${Math.floor(sec / 60)}:${pad(sec % 60)} דק׳`;
};

export function Events({ status, navigate }: { status: SystemStatus; navigate: (r: Route) => void }) {
  const [days, setDays] = useState<Array<{ date: string; count: number }>>([]);
  const [date, setDate] = useState(today());
  const [camera, setCamera] = useState<string>('all');
  const [events, setEvents] = useState<MotionEvent[]>([]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [recDays, setRecDays] = useState<Record<string, string[]>>({});

  const names = useMemo(
    () => ({ sentinel_demo_1: 'DEMO 1', sentinel_demo_2: 'DEMO 2', ...Object.fromEntries(status.cameras.map((c) => [c.id, c.name])) }) as Record<string, string>,
    [status.cameras],
  );

  const load = useCallback(async () => {
    const [d, ev, ms, rd] = await Promise.all([
      api<Array<{ date: string; count: number }>>('/api/events/days'),
      api<{ events: MotionEvent[] }>(`/api/events?date=${date}`),
      api<{ enabled: boolean }>('/api/motion/status'),
      api<Record<string, string[]>>('/api/recordings/days'),
    ]);
    setDays(d);
    setEvents(ev.events);
    setEnabled(ms.enabled);
    setRecDays(rd);
  }, [date]);
  useEffect(() => {
    void load();
    const t = window.setInterval(load, 10_000);
    return () => window.clearInterval(t);
  }, [load]);

  const shown = camera === 'all' ? events : events.filter((e) => e.camera === camera);
  const cams = [...new Set(events.map((e) => e.camera))];
  const activeNow = Object.entries(status.motion ?? {});

  const openRecording = (e: MotionEvent) => {
    requestJump({ camera: e.camera, date, at: new Date(new Date(e.start).getTime() - 3000) });
    navigate('recordings');
  };

  return (
    <>
      <PageHeader
        title="אירועים"
        subtitle="תנועה שזוהתה מקומית מתוך הווידאו של המצלמות"
        actions={
          <select value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-ink-600 bg-ink-850 px-3 py-1.5 text-sm text-ink-100" aria-label="תאריך">
            {[{ date: today(), count: -1 }, ...days.filter((d) => d.date !== today())].map((d) => (
              <option key={d.date} value={d.date}>
                {d.date}
                {d.count >= 0 ? ` · ${d.count}` : ''}
              </option>
            ))}
          </select>
        }
      />

      {enabled === false && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-warn/30 bg-warn/5 p-4 text-sm text-ink-200">
          <Bell className="h-5 w-5 text-warn" />
          <span className="flex-1">זיהוי התנועה כבוי. הפעל אותו בהגדרות → "זיהוי תנועה והתראות".</span>
          <button onClick={() => navigate('settings')} className="inline-flex items-center gap-1.5 rounded-lg bg-signal px-3 py-1.5 text-white hover:bg-blue-500">
            <SettingsIcon className="h-4 w-4" /> להגדרות
          </button>
        </div>
      )}

      {activeNow.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-live/40 bg-live/10 px-4 py-3 text-sm">
          <span className="h-2 w-2 rounded-full bg-live animate-pulseDot" />
          <span className="font-medium text-red-200">תנועה עכשיו:</span>
          {activeNow.map(([cam, start]) => (
            <span key={cam} className="rounded-md border border-live/40 px-2 py-0.5 text-red-100">
              {names[cam] ?? cam} · מ-<span dir="ltr">{hms(new Date(start))}</span>
            </span>
          ))}
        </div>
      )}

      {cams.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {['all', ...cams].map((c) => (
            <button
              key={c}
              onClick={() => setCamera(c)}
              className={cn('rounded-lg border px-3 py-1 text-sm', camera === c ? 'border-signal bg-signal-soft/40 text-white' : 'border-ink-600 text-ink-300 hover:text-white')}
            >
              {c === 'all' ? `הכול (${events.length})` : `${names[c] ?? c} (${events.filter((e) => e.camera === c).length})`}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-ink-600 py-14 text-sm text-ink-400">
          <Activity className="h-7 w-7" />
          אין אירועי תנועה ביום הזה.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {shown.map((e) => {
            const hasRec = recDays[e.camera]?.includes(date);
            return (
              <article key={e.id} className="overflow-hidden rounded-xl border border-ink-700 bg-ink-900 animate-fadeIn">
                <div className="relative aspect-video bg-black">
                  {e.thumb ? (
                    <img src={`/api/events/thumb/${e.id}`} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-ink-500">
                      <Activity className="h-6 w-6" />
                    </div>
                  )}
                  <span className="absolute start-2 top-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-white" dir="ltr">
                    {hms(new Date(e.start))}
                  </span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink-100">{names[e.camera] ?? e.camera}</div>
                    <div className="flex items-center gap-2 text-[11px] text-ink-400">
                      <span>{dur(e.start, e.end)}</span>
                      <span className="h-1 w-12 overflow-hidden rounded bg-ink-700" title={`עוצמה ${Math.round(e.peak * 100)}%`}>
                        <span className="block h-full bg-warn" style={{ width: `${Math.min(100, e.peak * 400)}%` }} />
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => openRecording(e)}
                    disabled={!hasRec}
                    title={hasRec ? 'פתח את ההקלטה ברגע הזה' : 'אין הקלטה ליום הזה'}
                    className="inline-flex items-center gap-1 rounded-lg border border-ink-600 px-2 py-1 text-xs text-ink-200 hover:border-signal hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Film className="h-3.5 w-3.5" /> להקלטה
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
