import { useCallback, useEffect, useState } from 'react';
import { ApiError } from './api';

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: (updater: (prev: T | null) => T | null) => void;
}

/**
 * Small data-fetching hook with loading + error states.
 * `fn` should be a stable reference (wrap in useCallback at the call site).
 */
export function useFetch<T>(fn: () => Promise<T>): FetchState<T> {
  const [data, setRaw] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fn()
      .then((res) => {
        if (active) setRaw(res);
      })
      .catch((e: unknown) => {
        if (!active) return;
        const msg =
          e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Đã xảy ra lỗi';
        setError(msg);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn, tick]);

  const setData = useCallback((updater: (prev: T | null) => T | null) => {
    setRaw((prev) => updater(prev));
  }, []);

  return { data, loading, error, reload, setData };
}

/** Extract a human-readable message from an unknown thrown value. */
export function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Đã xảy ra lỗi không xác định';
}
