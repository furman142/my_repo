import { ChevronLeft, ChevronRight, Download, Film, Loader2, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { api } from '../lib/api';
import type { Route } from '../lib/router';
import type { Segment, SystemStatus } from '../lib/types';
import { cn, formatBytes } from '../lib/util';

const DAY_S = 24 * 3600;
const pad = (n: number) => String(n).padStart(2, '0');
const hms = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const secOfDay = (d: Date) => d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
const fileUrl = (cam: string, date: string, file: string, download = false) =>
  `/api/recordings/file/${cam}/${date}/${file}${download ? '?download=1' : ''}`;
const dateLabel = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('he-IL', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d));
};

export function Recordings({ status, navigate }: { status: SystemStatus; navigate: (r: Route) => void }) {
  const [days, setDays] = useState<Record<string, string[]> | null>(null);
  const [camera, setCamera] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const seekTo = useRef<number | null>(null);

  const names = useMemo(() => Object.fromEntries(status.cameras.map((c) => [c.id, c.name])), [status.cameras]);
  const recordingOn = Object.keys(status.recording ?? {}).length > 0;

  const loadDays = useCallback(async () => {
    const d = await api<Record<string, string[]>>('/api/recordings/days');
    setDays(d);
    setCamera((c) => (c && d[c] ? c : Object.keys(d)[0] ?? null));
  }, []);
  useEffect(() => {
    void loadDays();
  }, [loadDays]);

  useEffect(() => {
    if (!camera || !days?.[camera]) return;
    setDate((cur) => (cur && days[camera].includes(cur) ? cur : days[camera][0]));
  }, [camera, days]);

  const loadSegments = useCallback(async () => {
    if (!camera || !date) return;
    setLoading(true);
    try {
      setSegments(await api<Segment[]>(`/api/recordings/list?camera=${camera}&date=${date}`));
    } finally {
      setLoading(false);
    }
  }, [camera, date]);
  useEffect(() => {
    setCurrent(null);
    void loadSegments();
    const t = window.setInterval(loadSegments, 30_000); // today's list keeps growing
    return () => window.clearInterval(t);
  }, [loadSegments]);

  const seg = current !== null ? segments[current] : null;
  const playable = segments.map((s, i) => ({ s, i })).filter(({ s }) => !s.inProgress);

  const play = (i: number, offset = 0) => {
    seekTo.current = offset;
    setCurrent(i);
  };

  // Click on the timeline: play the segment covering that moment.
  const onTimeline = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * DAY_S;
    let best: { i: number; offset: number } | null = null;
    for (const { s, i } of playable) {
      const start = secOfDay(new Date(s.start));
      const end = start + (s.seconds ?? 600);
      if (t >= start && t < end) {
        best = { i, offset: t - start };
        break;
      }
      if (start > t && !best) best = { i, offset: 0 }; // next recording after a gap
    }
    if (best) play(best.i, best.offset);
  };

  const step = (dir: 1 | -1) => {
    if (current === null) return;
    const idx = playable.findIndex(({ i }) => i === current);
    const next = playable[idx + dir];
    if (next) play(next.i);
  };

  const remove = async () => {
    if (!seg || !camera || !date || !confirm(`למחוק את ההקלטה ${hms(new Date(seg.start))}?`)) return;
    await api(fileUrl(camera, date, seg.file), { method: 'DELETE' });
    setCurrent(null);
    await loadSegments();
    await loadDays();
  };

  if (days && Object.keys(days).length === 0) {
    return (
      <>
        <PageHeader title="הקלטות" subtitle="צפייה בהקלטות לפי תאריך ושעה" />
        <div className="max-w-2xl rounded-xl border border-ink-700 bg-ink-900 p-6 text-sm text-ink-300">
          <div className="mb-3 flex items-center gap-3">
            <Film className="h-5 w-5 text-signal-glow" />
            <h2 className="font-semibold text-ink-100">{recordingOn ? 'ההקלטה פעילה — הקובץ הראשון יופיע בעוד כמה דקות' : 'עדיין אין הקלטות'}</h2>
          </div>
          {!recordingOn && (
            <>
              <p>ההקלטה כבויה. הפעל אותה בהגדרות → "הקלטה", ובחר אילו מצלמות להקליט.</p>
              <button onClick={() => navigate('settings')} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-signal px-3 py-1.5 text-white hover:bg-blue-500">
                <SettingsIcon className="h-4 w-4" /> להגדרות ההקלטה
              </button>
            </>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="הקלטות" subtitle="בחר מצלמה ויום, ולחץ על ציר הזמן כדי לצפות ברגע מסוים" />

      {/* camera + date */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {Object.keys(days ?? {}).map((id) => (
          <button
            key={id}
            onClick={() => setCamera(id)}
            className={cn('rounded-lg border px-3 py-1.5 text-sm', camera === id ? 'border-signal bg-signal-soft/40 text-white' : 'border-ink-600 text-ink-300 hover:text-white')}
          >
            {names[id] ?? id}
          </button>
        ))}
        <div className="flex-1" />
        {camera && days?.[camera] && (
          <select value={date ?? ''} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-ink-600 bg-ink-850 px-3 py-1.5 text-sm text-ink-100" aria-label="תאריך">
            {days[camera].map((d) => (
              <option key={d} value={d}>
                {dateLabel(d)} · {d}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* timeline */}
      <div className="mb-4 rounded-xl border border-ink-700 bg-ink-900 p-4">
        <div className="relative h-10 cursor-pointer overflow-hidden rounded-md bg-ink-800" dir="ltr" onClick={onTimeline} role="slider" aria-label="ציר זמן של היום" aria-valuemin={0} aria-valuemax={24} aria-valuenow={0}>
          {segments.map((s, i) => {
            const start = secOfDay(new Date(s.start));
            const len = s.seconds ?? (s.inProgress ? Math.max(60, (Date.now() - new Date(s.start).getTime()) / 1000) : 600);
            return (
              <div
                key={s.file}
                className={cn('absolute inset-y-1.5 rounded-sm', i === current ? 'bg-signal-glow' : s.inProgress ? 'bg-live/70' : 'bg-signal/70')}
                style={{ left: `${(start / DAY_S) * 100}%`, width: `${Math.max(0.15, (len / DAY_S) * 100)}%` }}
                title={`${hms(new Date(s.start))}${s.inProgress ? ' (מוקלט עכשיו)' : ''}`}
              />
            );
          })}
          {[3, 6, 9, 12, 15, 18, 21].map((h) => (
            <div key={h} className="pointer-events-none absolute inset-y-0 w-px bg-ink-600/60" style={{ left: `${(h / 24) * 100}%` }} />
          ))}
        </div>
        <div className="relative mt-1 h-4 font-mono text-[10px] text-ink-400" dir="ltr">
          {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
            <span key={h} className="absolute -translate-x-1/2" style={{ left: `${(h / 24) * 100}%` }}>
              {pad(h)}
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        {/* player */}
        <div className="overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
          <div className="relative aspect-video bg-black">
            {seg && camera && date ? (
              <video
                key={seg.file}
                ref={videoRef}
                src={fileUrl(camera, date, seg.file)}
                controls
                autoPlay
                muted
                playsInline
                className="h-full w-full"
                onLoadedMetadata={(e) => {
                  if (seekTo.current) e.currentTarget.currentTime = seekTo.current;
                  seekTo.current = null;
                }}
                onEnded={() => step(1)}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-ink-400">
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'בחר רגע על ציר הזמן או הקלטה מהרשימה'}
              </div>
            )}
          </div>
          {seg && camera && date && (
            <div className="flex flex-wrap items-center gap-2 border-t border-ink-700 px-3 py-2 text-sm">
              <button onClick={() => step(-1)} className="rounded p-1.5 text-ink-200 hover:bg-white/10" aria-label="הקלטה קודמת">
                <ChevronRight className="h-4 w-4" />
              </button>
              <button onClick={() => step(1)} className="rounded p-1.5 text-ink-200 hover:bg-white/10" aria-label="הקלטה הבאה">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="font-mono text-ink-100" dir="ltr">
                {date} {hms(new Date(seg.start))}
              </span>
              <span className="text-ink-400">· {names[camera] ?? camera}</span>
              <div className="flex-1" />
              <a href={fileUrl(camera, date, seg.file, true)} className="inline-flex items-center gap-1.5 rounded-lg border border-ink-600 px-2.5 py-1 text-ink-200 hover:text-white">
                <Download className="h-4 w-4" /> הורדה
              </a>
              <button onClick={remove} className="inline-flex items-center gap-1.5 rounded-lg border border-live/40 px-2.5 py-1 text-red-300 hover:bg-live/10">
                <Trash2 className="h-4 w-4" /> מחיקה
              </button>
            </div>
          )}
        </div>

        {/* list */}
        <div className="max-h-[520px] overflow-y-auto rounded-xl border border-ink-700 bg-ink-900">
          {segments.length === 0 && !loading && <p className="p-4 text-sm text-ink-400">אין הקלטות ביום הזה.</p>}
          {[...segments]
            .map((s, i) => ({ s, i }))
            .reverse()
            .map(({ s, i }) => (
              <button
                key={s.file}
                disabled={s.inProgress}
                onClick={() => play(i)}
                className={cn(
                  'flex w-full items-center gap-3 border-b border-ink-800 px-4 py-2.5 text-start text-sm last:border-0',
                  i === current ? 'bg-signal-soft/40' : 'hover:bg-ink-800',
                  s.inProgress && 'cursor-default opacity-70',
                )}
              >
                <span className={cn('h-2 w-2 rounded-full', s.inProgress ? 'bg-live animate-pulseDot' : 'bg-signal')} />
                <span className="font-mono text-ink-100" dir="ltr">
                  {hms(new Date(s.start))}
                </span>
                <span className="text-ink-400">{s.inProgress ? 'מוקלט עכשיו' : s.seconds ? `${Math.round(s.seconds / 60) || '<1'} דק׳` : ''}</span>
                <span className="flex-1" />
                <span className="font-mono text-[11px] text-ink-400" dir="ltr">
                  {formatBytes(s.size)}
                </span>
              </button>
            ))}
        </div>
      </div>
      <p className="mt-3 text-xs text-ink-400">ההקלטות כוללות וידאו בלבד: go2rtc שומר MP4 עם H.264/H.265 ו-AAC, ואודיו Opus של מצלמות Xiaomi לא נשמר.</p>
    </>
  );
}
