import { BarChart3, Bell, Film, LayoutDashboard, Settings, Video } from 'lucide-react';
import type { Route } from '../lib/router';
import { cn } from '../lib/util';
import { Logo } from './Logo';

export const NAV: Array<{ id: Route; label: string; icon: typeof Video }> = [
  { id: 'dashboard', label: 'לוח בקרה', icon: LayoutDashboard },
  { id: 'live', label: 'מצלמות', icon: Video },
  { id: 'recordings', label: 'הקלטות', icon: Film },
  { id: 'events', label: 'אירועים', icon: Bell },
  { id: 'stats', label: 'סטטיסטיקה', icon: BarChart3 },
  { id: 'settings', label: 'הגדרות', icon: Settings },
];

/** Slim icon rail on desktop (the video gets the width), bottom bar on phones. */
export function Sidebar({ route, navigate, badges }: { route: Route; navigate: (r: Route) => void; badges?: Partial<Record<Route, boolean>> }) {
  return (
    <>
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-[84px] flex-col items-center border-e border-ink-700 bg-ink-900 lg:flex">
        <div className="flex h-14 items-center">
          <Logo compact />
        </div>
        <nav className="flex w-full flex-1 flex-col gap-1 px-2 pt-2" aria-label="ניווט ראשי">
          {NAV.map((item) => {
            const active = route === item.id;
            return (
              <button
                key={item.id}
                onClick={() => navigate(item.id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-[11px] transition-colors',
                  active ? 'bg-signal-soft/50 text-white' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-100',
                )}
              >
                {active && <span className="absolute inset-y-2.5 start-0 w-0.5 rounded-full bg-signal" />}
                <span className="relative">
                  <item.icon className={cn('h-5 w-5', active && 'text-signal-glow')} />
                  {badges?.[item.id] && <span className="absolute -end-1 -top-1 h-2 w-2 rounded-full bg-warn animate-pulseDot" />}
                </span>
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="pb-3 text-center text-[10px] leading-tight text-ink-500" title="המערכת נגישה רק מהרשת המקומית">
          <span className="mx-auto mb-1 block h-1.5 w-1.5 rounded-full bg-ok" />
          מקומי
        </div>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-ink-700 bg-ink-900/95 backdrop-blur lg:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} aria-label="ניווט ראשי">
        {NAV.map((item) => {
          const active = route === item.id;
          return (
            <button key={item.id} onClick={() => navigate(item.id)} aria-current={active ? 'page' : undefined} className={cn('flex min-w-0 flex-1 flex-col items-center gap-1 py-2 text-[10px]', active ? 'text-signal-glow' : 'text-ink-400')}>
              <span className="relative">
                <item.icon className="h-5 w-5" />
                {badges?.[item.id] && <span className="absolute -end-1 -top-1 h-2 w-2 rounded-full bg-warn" />}
              </span>
              <span className="max-w-full truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
