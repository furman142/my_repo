import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { TileState } from '../lib/types';

interface Ctx {
  states: Record<string, TileState>;
  report: (id: string, state: TileState | null) => void;
}

const LiveCtx = createContext<Ctx>({ states: {}, report: () => {} });

/** Collects what each video tile actually observes, so the header can count truly-live cameras. */
export function LiveStatesProvider({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<Record<string, TileState>>({});
  const report = useCallback((id: string, state: TileState | null) => {
    setStates((prev) => {
      if (state === null) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return prev[id] === state ? prev : { ...prev, [id]: state };
    });
  }, []);
  const value = useMemo(() => ({ states, report }), [states, report]);
  return <LiveCtx.Provider value={value}>{children}</LiveCtx.Provider>;
}

export const useLiveStates = () => useContext(LiveCtx);
