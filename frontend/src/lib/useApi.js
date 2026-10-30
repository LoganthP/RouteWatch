import { useCallback, useEffect, useRef, useState } from 'react';
import api, { errMsg } from '../api/client';

/** GET helper with 12s timeout & AbortController; refetches when `params` change or reload() is called. */
export default function useApi(path, params, { skip = false, timeout = 12000 } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!skip);
  const [error, setError] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);
  const key = JSON.stringify(params || {});
  const seq = useRef(0);

  const reload = useCallback(() => {
    setReloadNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (skip || !path) {
      setLoading(false);
      return undefined;
    }

    let active = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeout);

    const id = ++seq.current;
    setLoading(true);
    setError('');

    api.get(path, {
      params: JSON.parse(key),
      signal: controller.signal,
    })
      .then((r) => {
        if (active && id === seq.current) {
          setData(r.data);
          setError('');
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active && id === seq.current) {
          if (e.name === 'CanceledError' || e.code === 'ERR_CANCELED' || e.message?.includes('canceled')) {
            setError('Request timed out (12s limit).');
          } else {
            setError(errMsg(e));
          }
          setLoading(false);
        }
      })
      .finally(() => {
        clearTimeout(timeoutId);
      });

    return () => {
      active = false;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [path, key, skip, timeout, reloadNonce]);

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
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
