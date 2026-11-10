import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { api } from '../lib/api';
import type { SystemStatus } from '../lib/types';
import { cn, formatGb } from '../lib/util';

interface Stats {
  days: string[];
  eventsPerDay: Record<string, number>;
  recordedHoursPerDay: Record<string, number>;
  byHour: number[];
  perCamera: Record<string, { events: number; recordedSeconds: number; lastEvent: string | null; bytes: number }>;
  totals: { eventsToday: number; eventsInRange: number; recordedHoursToday: number; storageBytes: number };
}

// Dark-surface steps of one blue ramp (sequential: dim = little, bright = a lot).
const SERIES = '#3987e5';
const RAMP = ['#0d366b', '#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'];
const pad = (n: number) => String(n).padStart(2, '0');
const shortDay = (d: string) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;

export function Stats({ status }: { status: SystemStatus }) {
  const [range, setRange] = useState<7 | 14 | 30>(14);
  const [camera, setCamera] = useState<string>('all');
  const [data, setData] = useState<Stats | null>(null);
  const names = useMemo(
    () => ({ sentinel_demo_1: 'DEMO 1', sentinel_demo_2: 'DEMO 2', ...Object.fromEntries(status.cameras.map((c) => [c.id, c.name])) }) as Record<string, string>,
    [status.cameras],
  );

  const load = useCallback(async () => {
    setData(await api<Stats>(`/api/stats?days=${range}${camera !== 'all' ? `&camera=${camera}` : ''}`));
  }, [range, camera]);
  useEffect(() => {
    void load();
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  const cams = data ? Object.keys(data.perCamera) : [];

  return (
    <>
      <PageHeader title="סטטיסטיקה" subtitle="פעילות מחושבת מאירועי התנועה וההקלטות שנשמרו במחשב" />

      {/* filters: one row above the charts */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-ink-600 text-sm" role="group" aria-label="טווח">
          {([7, 14, 30] as const).map((r) => (
            <button key={r} onClick={() => setRange(r)} aria-pressed={range === r} className={cn('px-3 py-1.5', range === r ? 'bg-signal text-white' : 'text-ink-300 hover:bg-ink-800')}>
              {r} ימים
            </button>
          ))}
        </div>
        {cams.length > 1 && (
          <select value={camera} onChange={(e) => setCamera(e.target.value)} className="rounded-lg border border-ink-600 bg-ink-850 px-3 py-1.5 text-sm text-ink-100" aria-label="מצלמה">
            <option value="all">כל המצלמות</option>
            {cams.map((c) => (
              <option key={c} value={c}>
                {names[c] ?? c}
              </option>
            ))}
          </select>
        )}
      </div>

      {!data ? null : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="אירועי תנועה היום" value={String(data.totals.eventsToday)} />
            <Tile label={`אירועים ב-${range} ימים`} value={String(data.totals.eventsInRange)} />
            <Tile label="שעות הוקלטו היום" value={String(data.totals.recordedHoursToday)} />
            <Tile label="נפח הקלטות" value={formatGb(data.totals.storageBytes)} />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <ChartCard title="אירועי תנועה ליום">
              <Bars days={data.days} values={data.days.map((d) => data.eventsPerDay[d])} unit="אירועים" />
            </ChartCard>
            <ChartCard title="שעות הקלטה ליום">
              <Bars days={data.days} values={data.days.map((d) => data.recordedHoursPerDay[d])} unit="שעות" />
            </ChartCard>
          </div>

          <ChartCard title="מתי יש תנועה — לפי שעה ביום">
            <HourHeat values={data.byHour} />
          </ChartCard>

          <ChartCard title="לפי מצלמה">
            {cams.length === 0 ? (
              <p className="text-sm text-ink-400">אין עדיין נתונים.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-ink-400">
                    <tr>
                      <th className="py-1.5 text-start font-normal">מצלמה</th>
                      <th className="py-1.5 text-start font-normal">אירועים</th>
                      <th className="py-1.5 text-start font-normal">שעות הקלטה</th>
                      <th className="py-1.5 text-start font-normal">נפח</th>
                      <th className="py-1.5 text-start font-normal">אירוע אחרון</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cams.map((c) => {
                      const r = data.perCamera[c];
                      const last = r.lastEvent ? new Date(r.lastEvent) : null;
                      return (
                        <tr key={c} className="border-t border-ink-700">
                          <td className="py-2 text-ink-100">{names[c] ?? c}</td>
                          <td className="py-2 font-mono tabular-nums text-ink-200">{r.events}</td>
                          <td className="py-2 font-mono tabular-nums text-ink-200">{(r.recordedSeconds / 3600).toFixed(1)}</td>
                          <td className="py-2 font-mono text-ink-200" dir="ltr" style={{ textAlign: 'right' }}>
                            {formatGb(r.bytes)}
                          </td>
                          <td className="py-2 font-mono text-ink-300" dir="ltr" style={{ textAlign: 'right' }}>
                            {last ? `${shortDay(last.toISOString().slice(0, 10))} ${pad(last.getHours())}:${pad(last.getMinutes())}` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </ChartCard>
        </div>
      )}
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 px-4 py-3">
      <div className="text-[11px] text-ink-400">{label}</div>
      <div className="mt-1 font-mono text-2xl font-medium tabular-nums text-ink-100" dir="ltr" style={{ textAlign: 'right' }}>
        {value}
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-ink-700 bg-ink-900 p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink-100">{title}</h2>
      {children}
    </section>
  );
}

/** Single-series column chart, time runs left→right; hover shows the exact value. */
function Bars({ days, values, unit }: { days: string[]; values: number[]; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...values);
  const nice = niceMax(max);
  const H = 160;
  return (
    <div dir="ltr" className="relative">
      <div className="flex">
        <div className="flex w-8 shrink-0 flex-col justify-between pe-1 text-right font-mono text-[10px] text-ink-400" style={{ height: H }}>
          <span>{fmt(nice)}</span>
          <span>{fmt(nice / 2)}</span>
          <span>0</span>
        </div>
        <div className="relative flex-1" style={{ height: H }}>
          {[0, 0.5, 1].map((f) => (
            <div key={f} className="absolute inset-x-0 border-t border-ink-700/70" style={{ top: `${f * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {values.map((v, i) => (
              <div key={days[i]} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <div
                  className="w-full rounded-t-[4px] transition-opacity"
                  style={{ height: `${(v / nice) * 100}%`, minHeight: v > 0 ? 2 : 0, background: SERIES, opacity: hover === null || hover === i ? 1 : 0.55 }}
                />
              </div>
            ))}
          </div>
          {hover !== null && (
            <div
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-ink-600 bg-ink-850 px-2 py-1 text-xs text-ink-100 shadow"
              style={{ left: `${((hover + 0.5) / values.length) * 100}%` }}
            >
              <span className="font-mono">{shortDay(days[hover])}</span> · <b className="font-mono">{fmt(values[hover])}</b> <span dir="rtl">{unit}</span>
            </div>
          )}
        </div>
      </div>
      <div className="ms-8 mt-1 flex font-mono text-[10px] text-ink-400">
        {days.map((d, i) => (
          <span key={d} className="flex-1 text-center">
            {i % Math.ceil(days.length / 7) === 0 || i === days.length - 1 ? shortDay(d) : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 24 cells, one-hue sequential ramp; the exact count is in the tooltip and the label row. */
function HourHeat({ values }: { values: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...values);
  const step = (v: number) => (v === 0 || max === 0 ? null : RAMP[Math.min(RAMP.length - 1, Math.floor((v / max) * (RAMP.length - 1) + 0.0001))]);
  return (
    <div dir="ltr" className="relative">
      <div className="grid gap-[2px]" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
        {values.map((v, h) => (
          <div
            key={h}
            className="relative aspect-square rounded-[4px] border border-ink-700"
            style={{ background: step(v) ?? 'transparent' }}
            onMouseEnter={() => setHover(h)}
            onMouseLeave={() => setHover(null)}
            aria-label={`${pad(h)}:00 — ${v}`}
          />
        ))}
      </div>
      <div className="mt-1 grid font-mono text-[10px] text-ink-400" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
        {values.map((_, h) => (
          <span key={h} className="text-center">
            {h % 3 === 0 ? pad(h) : ''}
          </span>
        ))}
      </div>
      {hover !== null && (
        <div className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-ink-600 bg-ink-850 px-2 py-1 text-xs text-ink-100 shadow" style={{ left: `${((hover + 0.5) / 24) * 100}%` }}>
          <span className="font-mono">
            {pad(hover)}:00–{pad((hover + 1) % 24)}:00
          </span>{' '}
          · <b className="font-mono">{values[hover]}</b> <span dir="rtl">אירועים</span>
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-ink-400" dir="rtl">
        מעט
        {RAMP.map((c) => (
          <span key={c} className="h-2.5 w-4 rounded-sm" style={{ background: c }} />
        ))}
        הרבה
      </div>
    </div>
  );
}

function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
