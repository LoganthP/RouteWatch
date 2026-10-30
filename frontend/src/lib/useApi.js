import { useCallback, useEffect, useRef, useState } from 'react';
import api, { errMsg } from '../api/client';

// Client-side SWR cache for instant page loads
const clientCache = new Map();

/** GET helper with 12s timeout & AbortController; serves stale cache instantly while revalidating. */
export default function useApi(path, params, { skip = false, timeout = 12000, staleTime = 30000 } = {}) {
  const key = path ? `${path}:${JSON.stringify(params || {})}` : '';
  const initialEntry = clientCache.get(key);

  const [data, setData] = useState(() => (initialEntry ? initialEntry.data : null));
  const [loading, setLoading] = useState(() => (!skip && (!initialEntry || Date.now() - initialEntry.ts > staleTime)));
  const [error, setError] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);
  const seq = useRef(0);

  const reload = useCallback(() => {
    setReloadNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (skip || !path) {
      setLoading(false);
      return undefined;
    }

    const cached = clientCache.get(key);
    if (cached && cached.data) {
      setData(cached.data);
      if (Date.now() - cached.ts < staleTime && reloadNonce === 0) {
        setLoading(false);
        return undefined;
      }
    }

    let active = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeout);

    const id = ++seq.current;
    if (!data && !cached) setLoading(true);
    setError('');

    api.get(path, {
      params: params || {},
      signal: controller.signal,
    })
      .then((r) => {
        if (active && id === seq.current) {
          setData(r.data);
          clientCache.set(key, { data: r.data, ts: Date.now() });
          setError('');
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active && id === seq.current) {
          // If aborted due to new params / debounce, silently ignore
          if (e.name === 'CanceledError' || e.code === 'ERR_CANCELED' || e.message?.includes('canceled')) {
            return;
          }
          setError(errMsg(e));
          setLoading(false);
        }
      })
      .finally(() => {
        clearTimeout(timeoutId);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [path, key, reloadNonce, skip, timeout, staleTime]);

  return { data, loading, error, reload, setData };
}

/** Re-run a callback when socket reports changes or window regains focus (throttled). */
export function useLiveRefresh(cb) {
  const ref = useRef(cb);
  ref.current = cb;

  useEffect(() => {
    let t;
    let lastFocus = 0;

    const h = (e) => {
      clearTimeout(t);
      t = setTimeout(() => ref.current(e.detail || {}), 600);
    };

    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocus > 10000) {
        lastFocus = now;
        ref.current({ kind: 'focus' });
      }
    };

    window.addEventListener('rw:incident', h);
    window.addEventListener('rw:incidents:changed', h);
    window.addEventListener('focus', onFocus);

    return () => {
      clearTimeout(t);
      window.removeEventListener('rw:incident', h);
      window.removeEventListener('rw:incidents:changed', h);
      window.removeEventListener('focus', onFocus);
    };
  }, []);
}

/** Debounce a changing value. */
export function useDebounced(value, ms = 400) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
