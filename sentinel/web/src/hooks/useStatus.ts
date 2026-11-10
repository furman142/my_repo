import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { SystemStatus } from '../lib/types';

/** Polls the backend for go2rtc + camera status. `error` means the SENTINEL server itself is unreachable. */
export function useStatus(intervalMs = 3000) {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number>();

  const refresh = useCallback(async () => {
    try {
      setStatus(await api<SystemStatus>('/api/status'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    timer.current = window.setInterval(refresh, intervalMs);
    return () => window.clearInterval(timer.current);
  }, [refresh, intervalMs]);

  return { status, error, refresh };
}
