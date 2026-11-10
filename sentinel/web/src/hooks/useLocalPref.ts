import { useEffect, useState } from 'react';

/** Per-browser UI preference (layout, last quality). Server settings live in data/settings.json. */
export function useLocalPref<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`sentinel:${key}`);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`sentinel:${key}`, JSON.stringify(value));
    } catch {
      /* private mode */
    }
  }, [key, value]);
  return [value, setValue] as const;
}
