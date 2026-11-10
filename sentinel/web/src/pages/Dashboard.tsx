import { Activity, Circle, HardDrive, WifiOff } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { CameraGrid } from '../components/CameraGrid';
import { useLiveStates } from '../hooks/liveStates';
import { api } from '../lib/api';
import type { Route } from '../lib/router';
import type { SystemStatus } from '../lib/types';
import { cn, formatGb } from '../lib/util';

export function Dashboard({ status, navigate }: { status: SystemStatus; navigate: (r: Route) => void }) {
  const { states } = useLiveStates();
  const real = status.cameras.filter((c) => !c.demo);
  const offline = real.filter((c) => states[c.id] === 'offline').length;
  const recording = Object.values(status.recording ?? {}).filter((s) => s === 'recording').length;
  const motionNow = Object.keys(status.motion ?? {}).length;
  const [today, setToday] = useState<{ events: number; bytes: number } | null>(null);

  useEffect(() => {
    const load = () =>
      api<{ totals: { eventsToday: number; storageBytes: number } }>('/api/stats?days=1')
        .then((s) => setToday({ events: s.totals.eventsToday, bytes: s.totals.storageBytes }))
        .catch(() => {});
    void load();
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <>
      {/* One compact status line: the video gets the space. */}
      <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="status-strip">
        {offline > 0 && <Stat icon={<WifiOff className="h-4 w-4" />} label="מנותקות" value={String(offline)} tone="bad" />}
        <Stat icon={<Circle className="h-3.5 w-3.5 fill-current" />} label="מוקלטות" value={String(recording)} tone={recording > 0 ? 'rec' : undefined} onClick={() => navigate('recordings')} />
        <Stat
          icon={<Activity className="h-4 w-4" />}
          label={motionNow > 0 ? 'תנועה עכשיו' : 'אירועים היום'}
          value={String(motionNow > 0 ? motionNow : (today?.events ?? 0))}
          tone={motionNow > 0 ? 'warn' : undefined}
          onClick={() => navigate('events')}
        />
        {today && today.bytes > 0 && <Stat icon={<HardDrive className="h-4 w-4" />} label="הקלטות" value={formatGb(today.bytes)} onClick={() => navigate('stats')} />}
        {status.go2rtc.state !== 'running' && <Stat icon={<WifiOff className="h-4 w-4" />} label="שרת שידורים" value={status.go2rtc.state} tone="bad" />}
      </div>
      <CameraGrid status={status} navigate={navigate} />
    </>
  );
}

function Stat({ icon, label, value, tone, onClick }: { icon: ReactNode; label: string; value: string; tone?: 'ok' | 'bad' | 'warn' | 'rec'; onClick?: () => void }) {
  const color = { ok: 'text-ok', bad: 'text-live', warn: 'text-warn', rec: 'text-red-300' }[tone ?? 'ok'];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={cn('flex items-center gap-2 rounded-xl border border-ink-700 bg-ink-900 px-3 py-2 text-sm', onClick && 'transition-colors hover:border-ink-500')}
    >
      <span className={tone ? color : 'text-ink-400'}>{icon}</span>
      <span className="text-ink-300">{label}</span>
      <span className={cn('font-mono font-semibold tabular-nums', tone ? color : 'text-ink-100')} dir="ltr">
        {value}
      </span>
    </Tag>
  );
}
