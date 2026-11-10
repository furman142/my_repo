import { Columns2, Square } from 'lucide-react';
import { CameraGrid } from '../components/CameraGrid';
import { PageHeader } from '../components/PageHeader';
import { useLocalPref } from '../hooks/useLocalPref';
import type { Route } from '../lib/router';
import type { SystemStatus } from '../lib/types';
import { cn } from '../lib/util';

export function LiveCameras({ status, navigate }: { status: SystemStatus; navigate: (r: Route) => void }) {
  const [cols, setCols] = useLocalPref<1 | 2>('liveColumns', 1);
  return (
    <>
      <PageHeader
        title="מצלמות חיות"
        subtitle="תצוגה מורחבת. רחף מעל מצלמה לפקדים, או לחץ על מסך מלא."
        actions={
          <div className="flex overflow-hidden rounded-lg border border-ink-600" role="group" aria-label="פריסה">
            {([1, 2] as const).map((n) => (
              <button
                key={n}
                onClick={() => setCols(n)}
                aria-pressed={cols === n}
                title={n === 1 ? 'מצלמה בשורה' : 'שתיים בשורה'}
                className={cn('px-3 py-1.5', cols === n ? 'bg-signal text-white' : 'text-ink-300 hover:bg-ink-800')}
              >
                {n === 1 ? <Square className="h-4 w-4" /> : <Columns2 className="h-4 w-4" />}
              </button>
            ))}
          </div>
        }
      />
      <CameraGrid status={status} columns={cols} navigate={navigate} />
    </>
  );
}
