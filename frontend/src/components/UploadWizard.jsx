import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CloudUpload, FileText, HardDrive, Map as MapIcon, ChartColumnBig, FileDown, RotateCcw, X, Play, CircleStop, CheckCircle2, TriangleAlert } from 'lucide-react';
import api, { download, errMsg } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ClayButton, ErrorBanner, Segmented, Spinner } from './ui';
import { fmtBytes, fmtDuration, fmtNum } from '../lib/format';
import { safeArr } from '../lib/safe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIELDS = [
  ['latitude', 'Latitude'], ['longitude', 'Longitude'], ['coordinates', 'Coordinates in one column ("lat, lng")'],
  ['datetime', 'Date and time'], ['timezone', 'Time zone column'], ['type', 'Incident type'], ['severity', 'Severity'],
  ['status', 'Status'], ['description', 'Description'], ['address', 'Address (used only when coordinates are missing)'],
];
const STEPS = ['Upload file', 'Map columns & scope', 'Import data'];

function StorageBar({ storage, projectedMB }) {
  if (!storage) return null;
  const quota = storage.quotaMB || 0;
  const used = storage.usedMB || 0;
  const dbMB = storage.dbStorageMB !== undefined ? storage.dbStorageMB : used;
  const filesMB = storage.filesMB !== undefined ? storage.filesMB : 0;
  const pctUsed = quota ? Math.min(100, (used / quota) * 100) : 0;
  const pctProj = quota && projectedMB ? Math.min(100 - pctUsed, (projectedMB / quota) * 100) : 0;
  const over80 = quota && used + (projectedMB || 0) >= quota * 0.8;
  const over90 = quota && used + (projectedMB || 0) >= quota * 0.9;
  return (
    <div className="rounded-2xl bg-white/70 px-4 py-3 shadow-clay-white">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
        <span className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-sky" />
          Storage: {used.toFixed(1)} MB{quota ? ` of ${quota} MB used (${pctUsed.toFixed(1)}%)` : ' used (no limit set)'}
          <span className="text-xs font-normal text-ink-soft">({dbMB.toFixed(1)} MB DB, {filesMB.toFixed(1)} MB files)</span>
        </span>
        {storage.tierName && (
          <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
            {storage.tierName}
          </span>
        )}
      </div>
      {storage.isAtlasM0 && (
        <p className="mb-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
          <strong>MongoDB Atlas M0 Free Tier (512 MB hard cap):</strong> The free tier limit cannot be expanded in software. To increase quota to 1 GB or higher, migrate to local MongoDB or upgrade to an Atlas paid tier (M10+).
        </p>
      )}
      {quota > 0 && (
        <div className="flex h-2.5 overflow-hidden rounded-full bg-[#EEF4FC] shadow-neu-in">
          <div className="h-full bg-sky" style={{ width: `${pctUsed}%` }} />
          <div className={`h-full ${over90 ? 'bg-rose-600' : over80 ? 'bg-coral' : 'bg-sun'}`} style={{ width: `${pctProj}%` }} />
        </div>
      )}
      {projectedMB ? <p className="mt-1 text-xs text-ink-soft">Projected addition: +{projectedMB.toFixed(1)} MB (~{(used + projectedMB).toFixed(1)} MB total)</p> : null}
      {over90 ? (
        <p className="mt-2 text-xs font-bold text-rose-600">CRITICAL: Storage would exceed 90% of quota! Reduce row count before importing.</p>
      ) : over80 ? (
        <p className="mt-2 text-xs font-bold text-coral">Warning: Storage would pass 80% of quota. The import stops automatically at 95% capacity; lower the row limit to fit.</p>
      ) : null}
    </div>
  );
}

export default function UploadWizard() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [limits, setLimits] = useState(null);
  const [storage, setStorage] = useState(null);
  const [file, setFile] = useState(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState('');
  const [up, setUp] = useState(null); // { uploadId, chunkSize, totalChunks, sent, speed, eta, state }
  const [ds, setDs] = useState(null); // { datasetId, name, preview }
  const [form, setForm] = useState(null);
  const [job, setJob] = useState(null);
  const ctl = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    api.get('/datasets/limits').then((r) => setLimits(r.data)).catch((e) => setError(errMsg(e)));
    api.get('/datasets/storage').then((r) => setStorage(r.data)).catch(() => {});
  }, []);

  const pickFile = (f) => {
    setError('');
    if (!f) return;
    const ext = (f.name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
    if (limits && !limits.formats.includes(ext)) return setError(`".${ext || '?'}" files are not supported. Use: ${limits.formats.join(', ')}.`);
    if (limits && f.size > limits.maxUploadMB * 1024 * 1024) return setError(`This file is ${fmtBytes(f.size)}; the limit is ${fmtBytes(limits.maxUploadMB * 1024 * 1024)}.`);
    if (!f.size) return setError('This file is empty.');
    setFile(f); setUp(null);
  };

  /* ---------- resumable chunked upload ---------- */
  const runUpload = useCallback(async (resume) => {
    setError('');
    const controller = new AbortController();
    ctl.current = controller;
    let session = resume && up?.uploadId ? up : null;
    try {
      if (!session) {
        const r = await api.post('/datasets/upload/init', { filename: file.name, size: file.size }, { signal: controller.signal });
        session = { ...r.data };
      }
      const st = await api.get(`/datasets/upload/${session.uploadId}`, { signal: controller.signal });
      const done = new Set(safeArr(st.data.received));
      const sizeOf = (i) => Math.min(session.chunkSize, file.size - i * session.chunkSize);
      let confirmed = [...done].reduce((s, i) => s + sizeOf(i), 0);
      const inflight = new Map();
      const t0 = Date.now(); const base = confirmed;
      const report = () => {
        const sent = confirmed + [...inflight.values()].reduce((a, b) => a + b, 0);
        const secs = (Date.now() - t0) / 1000;
        const speed = secs > 0.5 ? (sent - base) / secs : 0;
        setUp({ ...session, sent, speed, eta: speed ? (file.size - sent) / speed : null, state: 'uploading' });
      };
      report();
      const queue = Array.from({ length: session.totalChunks }, (_, i) => i).filter((i) => !done.has(i));
      const sendOne = async (i) => {
        const blob = file.slice(i * session.chunkSize, i * session.chunkSize + sizeOf(i));
        for (let attempt = 1; ; attempt += 1) {
          try {
            await api.put(`/datasets/upload/${session.uploadId}/chunk`, blob, {
              params: { index: i }, headers: { 'Content-Type': 'application/octet-stream' }, signal: controller.signal, timeout: 120000,
              onUploadProgress: (e) => { inflight.set(i, e.loaded || 0); report(); },
            });
            inflight.delete(i); confirmed += blob.size; report();
            return;
          } catch (e) {
            inflight.delete(i);
            if (controller.signal.aborted) throw e;
            const s = e.response?.status;
            if (s === 404) throw Object.assign(new Error(errMsg(e)), { sessionLost: true });
            if (s && s < 500 && s !== 408 && s !== 429) throw e; // a real client error: retrying will not help
            if (attempt >= 3) throw Object.assign(new Error(`Chunk ${i + 1} of ${session.totalChunks} failed 3 times: ${errMsg(e)}`), { resumable: true });
            await sleep(1000 * 2 ** (attempt - 1));
          }
        }
      };
      const worker = async () => { while (queue.length) await sendOne(queue.shift()); };
      await Promise.all([worker(), worker(), worker()]);
      setUp({ ...session, sent: file.size, speed: 0, eta: 0, state: 'checking' });
      const c = await api.post(`/datasets/upload/${session.uploadId}/complete`, null, { signal: controller.signal, timeout: 300000 });
      const pv = c.data.preview;
      setDs(c.data);
      const role = limits?.maxRows || 500;
      setForm({
        name: c.data.name,
        mapping: { ...pv.suggestedMapping, area: safeArr(pv.suggestedMapping.area) },
        defaults: { type: pv.suggestedMapping.type ? 'Other' : 'Accident', severity: 'Medium', status: 'Verified' },
        dayFirst: true, tzMode: 'auto', customTz: '',
        scope: { limit: Math.min(role, 200000), sampling: 'first', everyN: 10, filters: { from: '', to: '', column: '', values: '', minSeverity: '' } },
      });
      setStep(1);
      setUp(null);
    } catch (e) {
      if (controller.signal.aborted) return;
      if (e.sessionLost) { setUp(null); setError(`${e.message} Press "Upload and preview" to start again.`); return; }
      setUp((u) => (u ? { ...u, state: e.resumable ? 'paused' : 'failed' } : u));
      setError(errMsg(e));
    }
  }, [file, up, limits]);

  const cancelUpload = async () => {
    ctl.current?.abort();
    if (up?.uploadId) await api.delete(`/datasets/upload/${up.uploadId}`).catch(() => {});
    setUp(null); toast('Upload cancelled', 'info');
  };

  /* ---------- import ---------- */
  const columns = safeArr(ds?.preview?.columns);
  const est = ds?.preview?.estimatedRows;
  const setMap = (k, v) => setForm((f) => ({ ...f, mapping: { ...f.mapping, [k]: v || undefined } }));
  const setScope = (k, v) => setForm((f) => ({ ...f, scope: { ...f.scope, [k]: v } }));
  const setFilter = (k, v) => setForm((f) => ({ ...f, scope: { ...f.scope, filters: { ...f.scope.filters, [k]: v } } }));
  const expectedRows = useMemo(() => {
    if (!form) return 0;
    const lim = Number(form.scope.limit) || 0;
    const pool = est || lim;
    const sampled = form.scope.sampling === 'every' ? Math.ceil(pool / Math.max(1, Number(form.scope.everyN) || 1)) : pool;
    return Math.min(lim, sampled);
  }, [form, est]);
  const projectedMB = storage ? (expectedRows * (storage.bytesPerIncident || 450)) / (1024 * 1024) : 0;
  const hasLocation = form && ((form.mapping.latitude && form.mapping.longitude) || form.mapping.coordinates || form.mapping.address || form.mapping.area?.length);

  const startImport = async () => {
    setError('');
    const f = form.scope.filters;
    const body = {
      name: form.name, mapping: form.mapping, defaults: form.defaults, dayFirst: form.dayFirst,
      tzMode: form.tzMode === 'custom' ? form.customTz.trim() : form.tzMode,
      scope: {
        limit: Number(form.scope.limit), sampling: form.scope.sampling, everyN: Number(form.scope.everyN),
        filters: {
          ...(f.from ? { from: f.from } : {}), ...(f.to ? { to: f.to } : {}), ...(f.minSeverity ? { minSeverity: f.minSeverity } : {}),
          ...(f.column && f.values.trim() ? { column: f.column, values: f.values.split(',').map((x) => x.trim()).filter(Boolean) } : {}),
        },
      },
    };
    try {
      await api.post(`/datasets/${ds.datasetId}/import`, body);
      setJob({ status: 'importing', progress: { rowsRead: 0, imported: 0, skipped: 0, duplicates: 0, geocoded: 0, rate: 0, phase: 'reading' }, started: Date.now() });
      setStep(2);
    } catch (e) { setError(errMsg(e)); }
  };

  // live progress: socket events + polling fallback
  useEffect(() => {
    if (step !== 2 || !ds) return undefined;
    let alive = true;
    const id = String(ds.datasetId);
    const onEvt = (e) => {
      const d = e.detail;
      if (d?.datasetId !== id) return;
      setJob((j) => ({ ...j, status: d.status, progress: { ...j?.progress, ...d.progress } }));
    };
    window.addEventListener('rw:dataset-progress', onEvt);
    const poll = async () => {
      while (alive) {
        try {
          const r = await api.get(`/datasets/${id}`);
          if (!alive) break;
          setJob((j) => ({ ...j, status: r.data.status, statusNote: r.data.statusNote, bbox: r.data.bbox, rejectedCount: r.data.rejectedCount, progress: { ...j?.progress, ...r.data.progress } }));
          if (!['importing', 'uploaded'].includes(r.data.status)) {
            api.get('/datasets/storage').then((s) => alive && setStorage(s.data)).catch(() => {});
            break;
          }
        } catch { /* keep polling */ }
        await sleep(2000);
      }
    };
    poll();
    return () => { alive = false; window.removeEventListener('rw:dataset-progress', onEvt); };
  }, [step, ds]);

  const cancelImport = async () => {
    try { await api.post(`/datasets/${ds.datasetId}/cancel`); toast('Stopping the import…', 'info'); } catch (e) { toast(errMsg(e), 'error'); }
  };
  const reset = () => { setStep(0); setFile(null); setDs(null); setForm(null); setJob(null); setUp(null); setError(''); };
  const p = job?.progress || {};
  const running = job && ['importing'].includes(job.status);
  const readPct = est ? Math.min(100, (p.rowsRead / est) * 100) : null;

  return (
    <div className="glass p-5 sm:p-7">
      <ol className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-white/70 pb-5">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2.5">
            <span className={`grid h-9 w-9 place-items-center rounded-full font-display font-bold ${i === step ? 'bg-sky text-white shadow-clay' : i < step ? 'bg-mint text-white' : 'bg-white text-ink-soft shadow-clay-white'}`}>
              {i < step ? <CheckCircle2 className="h-5 w-5" /> : i + 1}
            </span>
            <span className={`font-semibold ${i === step ? 'text-ink' : 'text-ink-soft'}`}>{label}</span>
          </li>
        ))}
      </ol>
      <ErrorBanner message={error} />

      {/* ---------------- step 1 ---------------- */}
      {step === 0 && (
        <div className="space-y-5">
          <StorageBar storage={storage} />
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); pickFile(e.dataTransfer.files?.[0]); }}
            className={`grid place-items-center gap-3 rounded-[28px] border-2 border-dashed px-6 py-12 text-center transition-colors ${drag ? 'border-sky bg-sky-soft/60' : 'border-white bg-white/40'}`}
          >
            <span className="grid h-16 w-16 place-items-center rounded-3xl bg-white text-sky shadow-clay-white"><CloudUpload className="h-8 w-8" /></span>
            <p className="font-display text-xl font-bold">Drop a dataset file here, or <button type="button" className="text-sky-deep underline" onClick={() => inputRef.current?.click()}>browse</button></p>
            <p className="max-w-xl text-sm text-ink-soft">
              CSV, TSV, Excel (.xlsx), JSON, GeoJSON, KML, GPX, text with coordinates, text-based PDF tables, or a ZIP of these.
              {limits ? ` Up to ${fmtBytes(limits.maxUploadMB * 1024 * 1024)}. Large files upload in ${fmtBytes(limits.chunkSize)} chunks and resume if the connection drops.` : ''}
              {' '}To combine several files, put them in one ZIP.
            </p>
            <input ref={inputRef} type="file" className="hidden" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }}
              accept=".csv,.tsv,.txt,.xlsx,.json,.geojson,.kml,.gpx,.pdf,.zip" />
          </div>

          {file && (
            <div className="rounded-3xl bg-white/70 p-4 shadow-clay-white">
              <div className="flex flex-wrap items-center gap-3">
                <FileText className="h-5 w-5 text-sky" />
                <span className="min-w-0 flex-1 truncate font-semibold">{file.name}</span>
                <span className="text-sm font-bold text-ink-soft">{fmtBytes(file.size)}</span>
                {!up && <button type="button" onClick={() => setFile(null)} className="grid h-8 w-8 place-items-center rounded-xl hover:bg-coral-soft" aria-label="Remove file"><X className="h-4 w-4" /></button>}
              </div>
              {up && (
                <div className="mt-3">
                  <div className="h-3 overflow-hidden rounded-full bg-[#EEF4FC] shadow-neu-in">
                    <motion.div className="h-full rounded-full bg-gradient-to-r from-sky to-mint" animate={{ width: `${(up.sent / file.size) * 100}%` }} transition={{ ease: 'linear', duration: 0.3 }} />
                  </div>
                  <p className="mt-2 text-sm text-ink-soft">
                    {up.state === 'checking' ? 'Checking the file and reading a preview…'
                      : up.state === 'paused' ? `Paused at ${fmtBytes(up.sent)} of ${fmtBytes(file.size)}. Resume when the connection is back.`
                        : up.state === 'failed' ? 'Upload stopped.'
                          : `${((up.sent / file.size) * 100).toFixed(1)}%, ${fmtBytes(up.sent)} of ${fmtBytes(file.size)}${up.speed ? `, ${fmtBytes(up.speed)}/s, about ${fmtDuration(up.eta)} left` : ''}`}
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-3">
            {up && up.state === 'uploading' && <ClayButton variant="white" onClick={cancelUpload}><X className="h-4 w-4" /> Cancel upload</ClayButton>}
            {up && up.state === 'paused' && <ClayButton variant="white" onClick={() => runUpload(true)}><RotateCcw className="h-4 w-4 text-sky" /> Resume upload</ClayButton>}
            <ClayButton variant="sun" disabled={!file || (up && ['uploading', 'checking'].includes(up.state))} loading={up && ['uploading', 'checking'].includes(up.state)} onClick={() => runUpload(false)}>
              <CloudUpload className="h-5 w-5" /> Upload and preview
            </ClayButton>
          </div>
        </div>
      )}

      {/* ---------------- step 2 ---------------- */}
      {step === 1 && ds && form && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <div>
              <label className="label" htmlFor="ds-name">Dataset name</label>
              <input id="ds-name" className="neu-field" value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="self-end rounded-2xl bg-white/70 px-4 py-3 text-sm shadow-clay-white">
              <p className="font-bold">{safeArr(ds.preview.sources).length} file{safeArr(ds.preview.sources).length === 1 ? '' : 's'}{est ? `, about ${fmtNum(est)} rows` : ''}</p>
              <p className="text-ink-soft">{safeArr(ds.preview.sources).map((s) => s.name).slice(0, 3).join(', ')}</p>
            </div>
          </div>
          {safeArr(ds.preview.warnings).length > 0 && (
            <p className="rounded-2xl bg-sun-soft/80 px-4 py-3 text-sm">{ds.preview.warnings.join(' ')}</p>
          )}

          <div>
            <p className="label">First rows of {ds.preview.previewSource}</p>
            <div className="scroll-thin max-h-64 overflow-auto rounded-2xl bg-white/70 shadow-neu-in">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-white"><tr>{columns.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2 font-bold text-ink-soft">{c}</th>)}</tr></thead>
                <tbody>
                  {safeArr(ds.preview.sample).slice(0, 10).map((r, i) => (
                    <tr key={i} className="border-t border-white">{columns.map((c) => <td key={c} className="max-w-[14rem] truncate whitespace-nowrap px-3 py-1.5">{String(r[c] ?? '')}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section>
              <h3 className="mb-3 text-lg font-bold">Which column holds what?</h3>
              <p className="mb-3 text-sm text-ink-soft">Columns were detected automatically. Change anything that looks wrong. Files inside a ZIP that have different columns are detected separately.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {FIELDS.map(([k, label]) => (
                  <div key={k} className={k === 'coordinates' || k === 'address' ? 'sm:col-span-2' : ''}>
                    <label className="label" htmlFor={`m-${k}`}>{label}</label>
                    <select id={`m-${k}`} className="neu-field py-2.5 text-sm" value={form.mapping[k] || ''} onChange={(e) => setMap(k, e.target.value)}>
                      <option value="">Not in this file</option>
                      {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                ))}
                {[0, 1].map((i) => (
                  <div key={`area${i}`}>
                    <label className="label" htmlFor={`m-area${i}`}>{i === 0 ? 'Area (e.g. city)' : 'Region (e.g. state)'}</label>
                    <select id={`m-area${i}`} className="neu-field py-2.5 text-sm" value={form.mapping.area?.[i] || ''}
                      onChange={(e) => { const a = [...(form.mapping.area || [])]; a[i] = e.target.value; setForm({ ...form, mapping: { ...form.mapping, area: a.filter(Boolean) } }); }}>
                      <option value="">Not in this file</option>
                      {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              {!hasLocation && <p className="mt-3 rounded-2xl bg-coral-soft px-4 py-2.5 text-sm font-semibold">Choose latitude and longitude (or a coordinates, address or area column) so incidents can be placed on the map.</p>}

              <h4 className="mb-2 mt-5 font-bold">When a value is missing</h4>
              <div className="grid gap-3 sm:grid-cols-3">
                {[['type', limits?.enums.types], ['severity', limits?.enums.severities], ...(isAdmin ? [['status', limits?.enums.statuses]] : [])].map(([k, opts]) => (
                  <div key={k}>
                    <label className="label capitalize" htmlFor={`d-${k}`}>Default {k}</label>
                    <select id={`d-${k}`} className="neu-field py-2.5 text-sm" value={form.defaults[k]} onChange={(e) => setForm({ ...form, defaults: { ...form.defaults, [k]: e.target.value } })}>
                      {safeArr(opts).map((o) => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              {!isAdmin && <p className="mt-2 text-xs text-ink-faint">Your imported incidents are saved as Pending until an administrator verifies them.</p>}

              <h4 className="mb-2 mt-5 font-bold">Dates</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="tzmode">Times without a zone are in</label>
                  <select id="tzmode" className="neu-field py-2.5 text-sm" value={form.tzMode} onChange={(e) => setForm({ ...form, tzMode: e.target.value })}>
                    <option value="auto">Local time where each incident happened</option>
                    <option value="UTC">UTC</option>
                    <option value="custom">A specific time zone…</option>
                  </select>
                  {form.tzMode === 'custom' && <input className="neu-field mt-2 py-2.5 text-sm" placeholder="e.g. Asia/Kolkata" value={form.customTz} onChange={(e) => setForm({ ...form, customTz: e.target.value })} />}
                </div>
                <div>
                  <p className="label">Dates like 03/04/2024 mean</p>
                  <Segmented value={form.dayFirst} onChange={(v) => setForm({ ...form, dayFirst: v })} options={[{ value: true, label: '3 April' }, { value: false, label: 'March 4' }]} />
                </div>
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-lg font-bold">Import scope</h3>
              <p className="mb-3 text-sm text-ink-soft">Large files rarely fit a free database. Import a sample or a filtered part of the file.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="limit">Row limit (max {fmtNum(limits?.maxRows)})</label>
                  <input id="limit" type="number" min={1} max={limits?.maxRows} className="neu-field py-2.5" value={form.scope.limit}
                    onChange={(e) => setScope('limit', Math.max(1, Math.min(Number(e.target.value) || 1, limits?.maxRows || 1)))} />
                </div>
                <div>
                  <p className="label">Which rows</p>
                  <Segmented value={form.scope.sampling} onChange={(v) => setScope('sampling', v)} options={[{ value: 'first', label: 'First N' }, { value: 'every', label: 'Every Nth' }, { value: 'random', label: 'Random' }]} />
                </div>
                {form.scope.sampling === 'every' && (
                  <div>
                    <label className="label" htmlFor="everyn">Take one row in every</label>
                    <input id="everyn" type="number" min={1} className="neu-field py-2.5" value={form.scope.everyN} onChange={(e) => setScope('everyN', Math.max(1, Number(e.target.value) || 1))} />
                  </div>
                )}
                <div>
                  <label className="label" htmlFor="sf-from">Only from</label>
                  <input id="sf-from" type="date" className="neu-field px-3 py-2.5 text-sm" value={form.scope.filters.from} onChange={(e) => setFilter('from', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="sf-to">Only until</label>
                  <input id="sf-to" type="date" className="neu-field px-3 py-2.5 text-sm" value={form.scope.filters.to} onChange={(e) => setFilter('to', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="sf-col">Only rows where column</label>
                  <select id="sf-col" className="neu-field py-2.5 text-sm" value={form.scope.filters.column} onChange={(e) => setFilter('column', e.target.value)}>
                    <option value="">(no column filter)</option>
                    {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="sf-vals">is one of (comma-separated)</label>
                  <input id="sf-vals" className="neu-field py-2.5 text-sm" placeholder="e.g. CA, TX" disabled={!form.scope.filters.column} value={form.scope.filters.values} onChange={(e) => setFilter('values', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="sf-min">Minimum severity</label>
                  <select id="sf-min" className="neu-field py-2.5 text-sm" value={form.scope.filters.minSeverity} onChange={(e) => setFilter('minSeverity', e.target.value)}>
                    <option value="">Any</option>
                    {safeArr(limits?.enums.severities).map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div className="mt-4 rounded-2xl bg-sky-soft/70 px-4 py-3 text-sm">
                Up to <span className="font-bold">{fmtNum(expectedRows)}</span> rows will be imported{est ? ` from about ${fmtNum(est)}` : ''}{form.scope.filters.column || form.scope.filters.from || form.scope.filters.to || form.scope.filters.minSeverity ? ', fewer after your filters' : ''}. Rows already in the database are skipped as duplicates.
              </div>
              <div className="mt-3"><StorageBar storage={storage} projectedMB={projectedMB} /></div>
            </section>
          </div>

          <div className="flex flex-wrap justify-between gap-3">
            <ClayButton variant="white" onClick={reset}>Upload a different file</ClayButton>
            <ClayButton variant="sun" disabled={!hasLocation || (form.tzMode === 'custom' && !form.customTz.trim())} onClick={startImport}><Play className="h-5 w-5" /> Start import</ClayButton>
          </div>
        </div>
      )}

      {/* ---------------- step 3 ---------------- */}
      {step === 2 && job && (
        <div className="space-y-5">
          {running ? (
            <>
              <div className="flex items-center gap-3">
                <Spinner label="" />
                <div>
                  <p className="font-display text-xl font-bold">{p.phase === 'writing' ? 'Writing the random sample to the database…' : 'Reading and importing rows…'}</p>
                  <p className="text-sm text-ink-soft">You can leave this page; the import keeps running on the server.</p>
                </div>
              </div>
              {readPct !== null && (
                <div className="h-3 overflow-hidden rounded-full bg-[#EEF4FC] shadow-neu-in">
                  <motion.div className="h-full rounded-full bg-gradient-to-r from-sky to-mint" animate={{ width: `${readPct}%` }} />
                </div>
              )}
            </>
          ) : (
            <div className={`flex items-start gap-3 rounded-3xl px-5 py-4 shadow-clay-white ${job.status === 'completed' ? 'bg-mint-soft' : job.status === 'failed' ? 'bg-coral-soft' : 'bg-sun-soft'}`}>
              {job.status === 'completed' ? <CheckCircle2 className="mt-0.5 h-6 w-6 text-mint-deep" /> : <TriangleAlert className="mt-0.5 h-6 w-6 text-coral" />}
              <div>
                <p className="font-display text-xl font-bold">
                  {job.status === 'completed' ? 'Import finished' : job.status === 'cancelled' ? 'Import cancelled' : job.status === 'stopped' ? 'Import stopped' : 'Import failed'}
                </p>
                {job.statusNote && <p className="text-sm">{job.statusNote}</p>}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ['Rows read', p.rowsRead, '#2E9BFF'], ['Imported', p.imported, '#13A87C'], ['Rejected', p.skipped, '#FF4D6D'],
              ['Duplicates', p.duplicates, '#9B8CFF'], ['Geocoded', p.geocoded, '#E8A800'], ['Rows / second', p.rate, '#1E2A44'],
            ].map(([l, v, c]) => (
              <div key={l} className="rounded-2xl bg-white/70 p-3 text-center shadow-clay-white">
                <p className="font-display text-2xl font-extrabold" style={{ color: c }}>{fmtNum(v)}</p>
                <p className="text-xs font-bold text-ink-soft">{l}</p>
              </div>
            ))}
          </div>
          <StorageBar storage={storage} />

          <div className="flex flex-wrap gap-3">
            {running ? (
              <ClayButton variant="white" onClick={cancelImport}><CircleStop className="h-4 w-4 text-coral" /> Cancel import</ClayButton>
            ) : (
              <>
                {p.imported > 0 && <ClayButton onClick={() => navigate(`/map?dataset=${ds.datasetId}`)}><MapIcon className="h-4 w-4" /> View on map</ClayButton>}
                {p.imported > 0 && <ClayButton variant="sun" onClick={() => navigate(`/analytics?dataset=${ds.datasetId}`)}><ChartColumnBig className="h-4 w-4" /> Analyze this dataset</ClayButton>}
                {p.skipped > 0 && (
                  <ClayButton variant="white" onClick={() => download(`/datasets/${ds.datasetId}/rejected.csv`, {}, 'rejected-rows.csv').catch((e) => toast(errMsg(e), 'error'))}>
                    <FileDown className="h-4 w-4 text-coral" /> Download rejected rows
                  </ClayButton>
                )}
                <ClayButton variant="white" onClick={reset}><CloudUpload className="h-4 w-4 text-sky" /> Upload another file</ClayButton>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
