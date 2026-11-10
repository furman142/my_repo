import { Bell, Film, LayoutDashboard, Settings, Video } from 'lucide-react';
import type { Route } from '../lib/router';
import { cn } from '../lib/util';
import { Logo } from './Logo';

export const NAV: Array<{ id: Route; label: string; icon: typeof Video; phase2?: boolean }> = [
  { id: 'dashboard', label: 'לוח בקרה', icon: LayoutDashboard },
  { id: 'live', label: 'מצלמות חיות', icon: Video },
  { id: 'recordings', label: 'הקלטות', icon: Film },
  { id: 'events', label: 'אירועים', icon: Bell, phase2: true },
  { id: 'settings', label: 'הגדרות', icon: Settings },
];

export function Sidebar({ route, navigate }: { route: Route; navigate: (r: Route) => void }) {
  return (
    <>
      {/* desktop */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-60 flex-col border-e border-ink-700 bg-ink-900 lg:flex">
        <div className="flex h-16 items-center border-b border-ink-700 px-5">
          <Logo />
        </div>
        <nav className="flex-1 space-y-1 p-3" aria-label="ניווט ראשי">
          {NAV.map((item) => {
            const active = route === item.id;
            return (
              <button
                key={item.id}
                onClick={() => navigate(item.id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                  active ? 'bg-signal-soft/50 text-white' : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100',
                )}
              >
                {active && <span className="absolute inset-y-2 start-0 w-0.5 rounded-full bg-signal" />}
                <item.icon className={cn('h-[18px] w-[18px]', active ? 'text-signal-glow' : '')} />
                <span className="flex-1 text-start">{item.label}</span>
                {item.phase2 && <span className="rounded border border-ink-600 px-1.5 font-mono text-[9px] text-ink-400">שלב 2</span>}
              </button>
            );
          })}
        </nav>
        <div className="border-t border-ink-700 p-4 text-[11px] leading-relaxed text-ink-400">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" />
            רשת מקומית בלבד · פרטי
          </div>
        </div>
      </aside>

      {/* mobile bottom bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-ink-700 bg-ink-900/95 backdrop-blur lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="ניווט ראשי"
      >
        {NAV.map((item) => {
          const active = route === item.id;
          return (
            <button
              key={item.id}
              onClick={() => navigate(item.id)}
              aria-current={active ? 'page' : undefined}
              className={cn('flex flex-1 flex-col items-center gap-1 py-2 text-[10px]', active ? 'text-signal-glow' : 'text-ink-400')}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </button>
          );
        })}
      </nav>
    </>
  );
}
