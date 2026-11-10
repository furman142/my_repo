import { Loader2, ServerCrash } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AlertToasts } from './components/AlertToasts';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { LiveStatesProvider } from './hooks/liveStates';
import { useStatus } from './hooks/useStatus';
import { api, setUnauthorizedHandler } from './lib/api';
import { useRoute } from './lib/router';
import { Dashboard } from './pages/Dashboard';
import { LiveCameras } from './pages/LiveCameras';
import { Login } from './pages/Login';
import { Events } from './pages/Events';
import { Recordings } from './pages/Recordings';
import { Settings } from './pages/Settings';
import { Stats } from './pages/Stats';

type Auth = { loginRequired: boolean; authenticated: boolean };

export function App() {
  const [auth, setAuth] = useState<Auth | null>(null);
  const [authError, setAuthError] = useState(false);

  const loadAuth = useCallback(async () => {
    try {
      setAuth(await api<Auth>('/api/auth/state'));
      setAuthError(false);
    } catch {
      setAuthError(true);
    }
  }, []);

  useEffect(() => {
    void loadAuth();
    setUnauthorizedHandler(() => setAuth((a) => (a ? { ...a, authenticated: false } : a)));
  }, [loadAuth]);

  if (authError) {
    return (
      <Center>
        <ServerCrash className="h-8 w-8 text-live" />
        <p className="text-ink-200">שרת SENTINEL לא זמין.</p>
        <button onClick={loadAuth} className="text-sm text-signal-glow underline">
          נסה שוב
        </button>
      </Center>
    );
  }
  if (!auth) {
    return (
      <Center>
        <Loader2 className="h-6 w-6 animate-spin text-signal" />
      </Center>
    );
  }
  if (auth.loginRequired && !auth.authenticated) return <Login onSuccess={loadAuth} />;
  return (
    <LiveStatesProvider>
      <Shell loginRequired={auth.loginRequired} />
    </LiveStatesProvider>
  );
}

function Shell({ loginRequired }: { loginRequired: boolean }) {
  const { route, navigate } = useRoute();
  const { status, error, refresh } = useStatus();

  return (
    <div className="min-h-screen">
      <Sidebar route={route} navigate={navigate} />
      <AlertToasts navigate={navigate} />
      <div className="lg:ps-60">
        <TopBar status={status} serverError={error} />
        <main className="mx-auto max-w-[1800px] px-4 pb-24 pt-5 sm:px-6 lg:pb-10">
          {!status ? (
            <Center>
              {error ? <p className="text-red-300">{error}</p> : <Loader2 className="h-6 w-6 animate-spin text-signal" />}
            </Center>
          ) : route === 'dashboard' ? (
            <Dashboard status={status} navigate={navigate} />
          ) : route === 'live' ? (
            <LiveCameras status={status} navigate={navigate} />
          ) : route === 'recordings' ? (
            <Recordings status={status} navigate={navigate} />
          ) : route === 'events' ? (
            <Events status={status} navigate={navigate} />
          ) : route === 'stats' ? (
            <Stats status={status} />
          ) : (
            <Settings status={status} refresh={refresh} loginRequired={loginRequired} />
          )}
        </main>
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6">{children}</div>;
}
