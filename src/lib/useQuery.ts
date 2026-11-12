import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api.ts';

export interface QueryState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** true only on the very first load, so refreshes don't blank the page */
  initial: boolean;
  reload: () => void;
  setData: (updater: T | ((prev: T | null) => T | null)) => void;
}

/**
 * Fetches once per path and refetches when the path changes. A stale response
 * can never overwrite a newer one, which matters because search-as-you-type
 * fires many requests in quick succession.
 */
export function useQuery<T>(path: string | null, deps: unknown[] = []): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [initial, setInitial] = useState(true);
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (path === null) {
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    apiGet<T>(path)
      .then((d) => {
        if (mine !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (mine !== seq.current) return;
        setError(e instanceof ApiError ? e.message : 'Something went wrong loading this.');
      })
      .finally(() => {
        if (mine !== seq.current) return;
        setLoading(false);
        setInitial(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const update = useCallback((updater: T | ((prev: T | null) => T | null)) => {
    setData((prev) => (typeof updater === 'function' ? (updater as (p: T | null) => T | null)(prev) : updater));
  }, []);

  return { data, error, loading, initial, reload, setData: update };
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: { 'Content-Type': 'application/json' } });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text.slice(0, 200) };
    }
  }
  if (!res.ok) throw new ApiError(res.status, (body ?? {}) as Record<string, unknown>);
  return body as T;
}
