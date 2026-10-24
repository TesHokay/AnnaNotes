import { liveQuery } from 'dexie';
import { useEffect, useState, type DependencyList } from 'react';

/**
 * Subscribes to a Dexie live query: the component re-renders whenever the queried tables change
 * (in this tab or another one). Returns `undefined` while loading.
 */
export function useLive<T>(query: () => Promise<T> | T, deps: DependencyList): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  useEffect(() => {
    const sub = liveQuery(query).subscribe({
      next: (v) => setValue(v),
      error: (err) => console.error('liveQuery failed', err),
    });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}
