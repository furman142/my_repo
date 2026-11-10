import { ArrowLeft, CameraOff } from 'lucide-react';
import type { Route } from '../lib/router';
import type { SystemStatus } from '../lib/types';
import { cn } from '../lib/util';
import { CameraTile } from './CameraTile';
import { TileBoundary } from './TileBoundary';

export function CameraGrid({
  status,
  columns = 2,
  navigate,
}: {
  status: SystemStatus;
  columns?: 1 | 2;
  navigate: (r: Route) => void;
}) {
  if (status.cameras.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-ink-600 bg-ink-900/50 px-6 py-16 text-center">
        <CameraOff className="h-10 w-10 text-ink-400" />
        <div>
          <h2 className="text-lg font-semibold text-ink-100">עדיין לא חוברו מצלמות</h2>
          <p className="mt-1 max-w-md text-sm text-ink-300">
            התחבר לחשבון Xiaomi דרך הממשק הרשמי של go2rtc, ואז הוסף את ה-C200 וה-CW300 מתוך מסך ההגדרות. לא יוצג כאן שום שידור עד שיתקבל וידאו אמיתי.
          </p>
        </div>
        <button
          onClick={() => navigate('settings')}
          className="flex items-center gap-2 rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          לאשף חיבור המצלמות <ArrowLeft className="h-4 w-4" />
        </button>
      </div>
    );
  }
  return (
    <div className={cn('grid gap-4', columns === 2 ? 'xl:grid-cols-2' : 'grid-cols-1')}>
      {status.cameras.map((c) => (
        <TileBoundary key={c.id} name={c.name}>
          <CameraTile camera={c} defaultQuality={status.defaultQuality} transports={status.transports} recording={status.recording?.[c.id] === 'recording'} />
        </TileBoundary>
      ))}
    </div>
  );
}
