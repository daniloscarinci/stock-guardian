/**
 * Reads data from the database into a component.
 *
 * Small on purpose. A query-caching library earns its keep against a network -
 * deduplication, retries, stale-while-revalidate, background refetching. None of
 * that applies to a SQLite file on the same device, where a query returns in
 * under a millisecond and the only invalidation signal needed is "something was
 * written". So: run the query, track loading and error, re-run when the inputs
 * or the revision counter change.
 *
 * The database stays the single source of truth. Nothing here holds a domain
 * value that also lives in a table.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  readonly data: T | undefined;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly reload: () => void;
}

export function useAsyncData<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  // Guards against a slow earlier query resolving after a faster later one and
  // overwriting it - the classic out-of-order result bug in a search box.
  const requestId = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const id = ++requestId.current;
    let cancelled = false;

    setLoading(true);
    loadRef
      .current()
      .then((result) => {
        if (cancelled || id !== requestId.current) return;
        setData(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled || id !== requestId.current) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      })
      .finally(() => {
        if (cancelled || id !== requestId.current) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  return { data, loading, error, reload };
}

/**
 * Delays a rapidly changing value.
 *
 * The original application re-queried, re-rendered the whole table AND rebuilt
 * all 194 catalog entries on every keystroke. Debouncing the search term keeps
 * typing responsive without that.
 */
export function useDebounced<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debounced;
}
