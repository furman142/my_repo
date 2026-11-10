import { Activity, AlertTriangle, CircleCheck, CircleX, FlaskConical, Video } from 'lucide-react';
import { useClock } from '../hooks/useClock';
import { useLiveStates } from '../hooks/liveStates';
import type { SystemStatus } from '../lib/types';
import { cn, formatDate, formatTime } from '../lib/util';
import { Logo } from './Logo';

export function TopBar({ status, serverError }: { status: SystemStatus | null; serverError: string | null }) {
  const now = useClock();
  const { states } = useLiveStates();
  const cams = status?.cameras ?? [];
  const realCams = cams.filter((c) => !c.demo);
  const liveReal = realCams.filter((c) => states[c.id] === 'live').length;

  let sys: { label: string; tone: 'ok' | 'warn' | 'bad'; icon: typeof Activity };
  if (serverError) sys = { label: 'שרת SENTINEL לא זמין', tone: 'bad', icon: CircleX };
  else if (!status) sys = { label: 'טוען…', tone: 'warn', icon: Activity };
  else if (status.go2rtc.state !== 'running') sys = { label: `go2rtc: ${status.go2rtc.state}`, tone: 'bad', icon: CircleX };
  else if (realCams.length > 0 && liveReal < realCams.length) sys = { label: 'פעיל · חלק מהמצלמות לא משדרות', tone: 'warn', icon: AlertTriangle };
  else sys = { label: 'המערכת פעילה', tone: 'ok', icon: CircleCheck };

  const toneCls = { ok: 'text-ok border-ok/30', warn: 'text-warn border-warn/30', bad: 'text-live border-live/40' }[sys.tone];

  return (
    <header className="sticky top-0 z-20 border-b border-ink-700 bg-ink-950/90 backdrop-blur">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
        <div className="lg:hidden">
          <Logo compact />
        </div>
        <div className="hidden min-w-0 sm:block">
          <div className="font-mono text-xl font-medium tabular-nums tracking-wider text-ink-100" dir="ltr">
            {formatTime(now)}
          </div>
          <div className="truncate text-[11px] text-ink-400">{formatDate(now)}</div>
        </div>
        <div className="font-mono text-base tabular-nums text-ink-100 sm:hidden" dir="ltr">
          {formatTime(now)}
        </div>

        <div className="flex-1" />

        {status?.demoMode && (
          <span className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-warn/50 bg-warn/10 px-2.5 py-1 text-xs font-semibold text-warn">
            <FlaskConical className="h-3.5 w-3.5" /> <span className="hidden sm:inline">מצב הדגמה</span><span className="sm:hidden">DEMO</span>
          </span>
        )}

        <div className="flex items-center gap-2 rounded-md border border-ink-600 px-2.5 py-1 text-xs text-ink-200" title="מצלמות שמשדרות כרגע בדפדפן הזה">
          <Video className="h-3.5 w-3.5 text-signal-glow" />
          <span className="hidden sm:inline">מחוברות</span>
          <span className="font-mono tabular-nums" dir="ltr">
            {liveReal}/{realCams.length}
          </span>
        </div>

        <div className={cn('flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs', toneCls)}>
          <sys.icon className="h-3.5 w-3.5" />
          <span className="hidden md:inline">{sys.label}</span>
        </div>
      </div>
    </header>
  );
}
