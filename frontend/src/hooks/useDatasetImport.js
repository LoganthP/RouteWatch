// RouteWatch — React hook for the "Upload dataset" wizard (Upload files → Map columns & scope → Import data).
// Plug into your existing Report page UI; it only manages state, so your current styling stays.
import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadDataset, startImport, cancelImport, getInsights, watchImport } from '../lib/datasetUpload';

/**
 * @param {object} opts
 * @param {() => object} opts.getHeaders  e.g. () => ({ Authorization: `Bearer ${token}` })
 * @param {import('socket.io-client').Socket} [opts.socket]  your existing socket (optional; falls back to polling)
 * @param {string} [opts.baseUrl='/api/datasets']
 */
export function useDatasetImport({ getHeaders = () => ({}), socket, baseUrl = '/api/datasets' } = {}) {
  const [step, setStep] = useState(1);                 // 1 upload, 2 map, 3 import
  const [upload, setUpload] = useState(null);          // { phase, percent, loaded, total, speedBps, etaSec }
  const [dataset, setDataset] = useState(null);
  const [entries, setEntries] = useState([]);          // files found + auto-detected mapping
  const [selections, setSelections] = useState({});    // entryId -> { include, mapping }
  const [progress, setProgress] = useState(null);      // import progress
  const [insights, setInsights] = useState(null);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);
  const unwatchRef = useRef(null);
  const opts = { baseUrl, getHeaders };

  useEffect(() => () => { abortRef.current?.abort(); unwatchRef.current?.(); }, []);

  const start = useCallback(async (file) => {
    setError(null); setUpload({ phase: 'uploading', percent: 0, loaded: 0, total: file.size });
    abortRef.current = new AbortController();
    try {
      const res = await uploadDataset(file, { ...opts, signal: abortRef.current.signal, onProgress: setUpload });
      setDataset(res.dataset);
      setEntries(res.entries);
      setSelections(Object.fromEntries(res.entries.filter((e) => !e.skipped)
        .map((e) => [e.id, { include: true, mapping: e.proposal }])));
      setStep(2);
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message);
      setUpload(null);
    }
  }, [baseUrl, getHeaders]);

  const cancelUpload = useCallback(() => abortRef.current?.abort(), []);

  /** Change one file's mapping, e.g. updateMapping(id, { kind: 'skip' }) or { columns: { area: 'District' } } */
  const updateMapping = useCallback((entryId, patch) => setSelections((s) => {
    const cur = s[entryId]; if (!cur) return s;
    const mapping = { ...cur.mapping, ...patch, columns: { ...cur.mapping.columns, ...(patch.columns || {}) } };
    return { ...s, [entryId]: { ...cur, mapping, include: patch.kind === 'skip' ? false : cur.include } };
  }), []);
  const toggleEntry = useCallback((entryId, include) => setSelections((s) => ({ ...s, [entryId]: { ...s[entryId], include } })), []);

  const runImport = useCallback(async () => {
    if (!dataset) return;
    setError(null); setStep(3); setProgress({ status: 'queued', percent: 0 });
    const chosen = Object.entries(selections).filter(([, v]) => v.include).map(([entryId, v]) => ({ entryId, mapping: v.mapping }));
    try {
      await startImport(dataset._id, chosen, opts);
      unwatchRef.current?.();
      unwatchRef.current = watchImport(socket, dataset._id, async (p) => {
        setProgress((prev) => ({ ...prev, ...p }));
        if (p.status === 'ready') { unwatchRef.current?.(); setInsights((await getInsights(dataset._id, opts)).insights); }
        if (['failed', 'interrupted'].includes(p.status)) { unwatchRef.current?.(); setError(p.error || 'Import stopped — press Retry'); }
      }, opts);
    } catch (e) { setError(e.message); setStep(2); }
  }, [dataset, selections, socket, baseUrl, getHeaders]);

  const stopImport = useCallback(() => dataset && cancelImport(dataset._id, opts), [dataset]);

  const reset = useCallback(() => {
    unwatchRef.current?.(); setStep(1); setUpload(null); setDataset(null); setEntries([]);
    setSelections({}); setProgress(null); setInsights(null); setError(null);
  }, []);

  return { step, upload, dataset, entries, selections, progress, insights, error,
    start, cancelUpload, updateMapping, toggleEntry, runImport, stopImport, retry: runImport, reset };
}
