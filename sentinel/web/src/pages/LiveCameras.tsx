import { Columns2, Columns3, Square } from 'lucide-react';
import { CameraGrid } from '../components/CameraGrid';
import { useLocalPref } from '../hooks/useLocalPref';
import type { Route } from '../lib/router';
import type { SystemStatus } from '../lib/types';
import { cn } from '../lib/util';

const OPTIONS = [
  { n: 1, icon: Square, label: 'מצלמה בשורה' },
  { n: 2, icon: Columns2, label: 'שתיים בשורה' },
  { n: 3, icon: Columns3, label: 'שלוש בשורה' },
] as const;

/** Pure video wall: no statistics, just the cameras and a column switch. */
export function LiveCameras({ status, navigate }: { status: SystemStatus; navigate: (r: Route) => void }) {
  const [cols, setCols] = useLocalPref<1 | 2 | 3>('liveColumns', 2);
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-ink-100">מצלמות חיות</h1>
        <div className="flex overflow-hidden rounded-lg border border-ink-600" role="group" aria-label="פריסה">
          {OPTIONS.map(({ n, icon: Icon, label }) => (
            <button key={n} onClick={() => setCols(n)} aria-pressed={cols === n} title={label} aria-label={label} className={cn('px-3 py-1.5', cols === n ? 'bg-signal text-white' : 'text-ink-300 hover:bg-ink-800')}>
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>
      <CameraGrid status={status} columns={cols} navigate={navigate} />
    </>
  );
}
