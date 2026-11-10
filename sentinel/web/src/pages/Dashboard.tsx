import { CameraGrid } from '../components/CameraGrid';
import { PageHeader } from '../components/PageHeader';
import { useLiveStates } from '../hooks/liveStates';
import type { Route } from '../lib/router';
import type { SystemStatus } from '../lib/types';

export function Dashboard({ status, navigate }: { status: SystemStatus; navigate: (r: Route) => void }) {
  const { states } = useLiveStates();
  const real = status.cameras.filter((c) => !c.demo);
  const live = real.filter((c) => states[c.id] === 'live').length;
  const offline = real.filter((c) => states[c.id] === 'offline').length;

  return (
    <>
      <PageHeader title="לוח בקרה" subtitle="שידור חי מכל המצלמות" />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="מצלמות מוגדרות" value={String(real.length)} />
        <Stat label="משדרות עכשיו" value={String(live)} tone={live > 0 ? 'ok' : undefined} />
        <Stat label="מנותקות" value={String(offline)} tone={offline > 0 ? 'bad' : undefined} />
        <Stat label="שרת שידורים" value={status.go2rtc.state === 'running' ? `go2rtc ${status.go2rtc.version ?? ''}` : status.go2rtc.state} mono tone={status.go2rtc.state === 'running' ? undefined : 'bad'} />
      </div>
      <CameraGrid status={status} navigate={navigate} />
    </>
  );
}

function Stat({ label, value, tone, mono }: { label: string; value: string; tone?: 'ok' | 'bad'; mono?: boolean }) {
  const color = tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-live' : 'text-ink-100';
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 px-4 py-3">
      <div className="text-[11px] text-ink-400">{label}</div>
      <div className={`mt-1 truncate ${mono ? 'font-mono text-sm' : 'font-mono text-2xl'} font-medium tabular-nums ${color}`} dir="ltr" style={{ textAlign: 'right' }}>
        {value}
      </div>
    </div>
  );
}
