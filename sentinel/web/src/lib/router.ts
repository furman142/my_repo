import { useEffect, useState } from 'react';

export type Route = 'dashboard' | 'live' | 'recordings' | 'events' | 'stats' | 'settings';

const PATHS: Record<Route, string> = {
  dashboard: '/',
  live: '/live',
  recordings: '/recordings',
  events: '/events',
  stats: '/stats',
  settings: '/settings',
};

function fromPath(p: string): Route {
  const hit = (Object.entries(PATHS) as Array<[Route, string]>).find(([, path]) => path === p);
  return hit ? hit[0] : 'dashboard';
}

export function useRoute() {
  const [route, setRoute] = useState<Route>(() => fromPath(location.pathname));
  useEffect(() => {
    const onPop = () => setRoute(fromPath(location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = (r: Route) => {
    if (r === route) return;
    history.pushState(null, '', PATHS[r]);
    setRoute(r);
    window.scrollTo(0, 0);
  };
  return { route, navigate };
}
