import { ArrowLeft, CameraOff } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useLocalPref } from '../hooks/useLocalPref';
import type { Route } from '../lib/router';
import type { SystemStatus } from '../lib/types';
import { cn } from '../lib/util';
import { CameraTile } from './CameraTile';
import { TileBoundary } from './TileBoundary';

/**
 * The video wall. Two layouts, switched without re-creating the players:
 *  - grid:  equal tiles
 *  - focus: one large camera with the others in a strip beside it (double-click a tile or use
 *           its focus button)
 */
export function CameraGrid({ status, columns = 2, navigate }: { status: SystemStatus; columns?: 1 | 2 | 3; navigate: (r: Route) => void }) {
  const [focusPref, setFocus] = useLocalPref<string | null>('focus', null);
  const cams = status.cameras;
  const focus = cams.length > 1 && cams.some((c) => c.id === focusPref) ? focusPref : null;

  if (cams.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-ink-600 bg-ink-900/50 px-6 py-16 text-center">
        <CameraOff className="h-10 w-10 text-ink-400" />
        <div>
          <h2 className="text-lg font-semibold text-ink-100">עדיין לא חוברו מצלמות</h2>
          <p className="mt-1 max-w-md text-sm text-ink-300">
            התחבר לחשבון Xiaomi דרך הממשק הרשמי של go2rtc, ואז הוסף את המצלמות מתוך מסך ההגדרות. לא יוצג כאן שום שידור עד שיתקבל וידאו אמיתי.
          </p>
        </div>
        <button onClick={() => navigate('settings')} className="flex items-center gap-2 rounded-lg bg-signal px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">
          לאשף חיבור המצלמות <ArrowLeft className="h-4 w-4" />
        </button>
      </div>
    );
  }

  const others = cams.length - 1;
  return (
    <div
      className={cn(
        'grid gap-3',
        focus ? 'lg:grid-cols-4' : columns === 1 ? 'grid-cols-1' : columns === 3 ? 'lg:grid-cols-2 2xl:grid-cols-3' : 'lg:grid-cols-2',
      )}
    >
      {cams.map((c) => {
        const isFocus = focus === c.id;
        return (
          <div key={c.id} className={cn('min-w-0', isFocus && 'focus-main')} style={isFocus ? ({ '--rows': Math.max(1, Math.min(others, 3)) } as CSSProperties) : undefined}>
            <TileBoundary name={c.name}>
              <CameraTile
                camera={c}
                defaultQuality={status.defaultQuality}
                transports={status.transports}
                recording={status.recording?.[c.id] === 'recording'}
                motion={!!status.motion?.[c.id]}
                talkEnabled={status.talk}
                compact={!!focus && !isFocus}
                focused={isFocus}
                onFocus={cams.length > 1 ? () => setFocus(isFocus ? null : c.id) : undefined}
              />
            </TileBoundary>
          </div>
        );
      })}
    </div>
  );
}
