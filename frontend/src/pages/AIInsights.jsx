import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Circle, CircleMarker, Marker, Polygon, Tooltip as LTooltip } from 'react-leaflet';
import { BrainCircuit, Play, Sparkles, Target, TrendingUp, WifiOff, MousePointerClick } from 'lucide-react';
import api, { errMsg } from '../api/client';
import useApi from '../lib/useApi';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import FilterBar from '../components/FilterBar';
import { BaseMap, ClickToPick, FitBounds, MapToolbar, ViewportWatcher, pickIcon } from '../components/MapParts';
import { ClayButton, EmptyState, ErrorBanner, Glass, PageHeader, Segmented, Spinner } from '../components/ui';
import { SEVERITIES, SEV_COLOR, TYPES, emptyFilters, toParams } from '../lib/constants';
import { fmtDate, fmtNum } from '../lib/format';
import { isLatLng, safeArr, safeFixed } from '../lib/safe';

const axis = { tickLine: false, axisLine: false, tick: { fill: '#5B6B8C', fontSize: 12 } };
const RANK_COLORS = ['#FF4D6D', '#FF8A3D', '#FFC93C', '#9B8CFF', '#2E9BFF'];
const rankColor = (rank) => RANK_COLORS[Math.min(RANK_COLORS.length - 1, Math.floor((rank - 1) / 3))];
const hourLabel = (h) => (Number.isInteger(h) ? `${String(h).padStart(2, '0')}:00` : '—');

function Stat({ label, value, note, tint = '#1E2A44' }) {
  return (
    <div className="rounded-2xl bg-white/70 p-3.5 shadow-clay-white">
      <p className="font-display text-2xl font-extrabold" style={{ color: tint }}>{value}</p>
      <p className="text-xs font-bold text-ink-soft">{label}</p>
      {note && <p className="mt-0.5 text-[11px] text-ink-faint">{note}</p>}
    </div>
  );
}

/* ---------------------------- DBSCAN ---------------------------- */
function Clustering({ params }) {
  const toast = useToast();
  const extent = useApi('/analytics/bounds', params);
  const [view, setView] = useState(null);
  const [useView, setUseView] = useState(true);
  const [eps, setEps] = useState(250);
  const [minSamples, setMinSamples] = useState(15);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setBusy(true); setError('');
    try {
      const filters = { ...params, ...(useView && view ? { bbox: view.bbox } : {}) };
      const r = await api.post('/ml/clusters', { eps_m: eps, min_samples: minSamples, filters }, { timeout: 200000 });
      setRes(r.data);
      if (!r.data.n_clusters) toast('No clusters found. Try a larger distance or fewer points per cluster.', 'info');
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  };
  const clusters = safeArr(res?.clusters);

  return (
    <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
      <Glass className="min-w-0 overflow-hidden p-2">
        <BaseMap className="h-[520px] w-full rounded-[22px] xl:h-[640px]">
          <ViewportWatcher onChange={setView} />
          {extent.data?.bbox && <FitBounds bbox={extent.data.bbox} maxZoom={13} />}
          <MapToolbar dataBbox={extent.data?.bbox} className="absolute left-4 top-4 z-[1000]" />
          {clusters.map((c) => {
            const color = rankColor(c.rank);
            const tip = <LTooltip sticky>#{c.rank} {c.area || 'Cluster'}: {fmtNum(c.size)} incidents, average severity {c.avg_severity}, peak {hourLabel(c.peak_hour)}</LTooltip>;
            if (safeArr(c.hull).length >= 3) {
              return <Polygon key={c.id} positions={c.hull} pathOptions={{ color, weight: 2.5, fillColor: color, fillOpacity: 0.22 }}>{tip}</Polygon>;
            }
            const ctr = [c.center?.[1], c.center?.[0]];
            return isLatLng(ctr) ? <Circle key={c.id} center={ctr} radius={Math.max(40, c.radius_m || 40)} pathOptions={{ color, fillOpacity: 0.22 }}>{tip}</Circle> : null;
          })}
          {clusters.slice(0, 25).map((c) => {
            const ctr = [c.center?.[1], c.center?.[0]];
            return isLatLng(ctr) ? (
              <CircleMarker key={`m${c.id}`} center={ctr} radius={11} pathOptions={{ color: '#fff', weight: 2, fillColor: rankColor(c.rank), fillOpacity: 1 }}>
                <LTooltip direction="top" permanent={c.rank <= 5} className="!rounded-lg !px-1.5 !py-0.5 !text-[11px] !font-bold">#{c.rank}</LTooltip>
              </CircleMarker>
            ) : null;
          })}
        </BaseMap>
      </Glass>

      <div className="space-y-4">
        <Glass className="p-5">
          <h2 className="text-xl font-bold">DBSCAN hotspot clustering</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Groups incidents that have at least <b>{minSamples}</b> neighbours within <b>{eps} m</b> (great-circle distance). It finds clusters of any shape and
            treats isolated reports as noise, so you do not choose the number of hotspots in advance, unlike K-means.
          </p>
          <p className="label mt-4">Neighbourhood distance (eps)</p>
          <Segmented value={eps} onChange={setEps} options={[100, 250, 500, 1000].map((v) => ({ value: v, label: v >= 1000 ? `${v / 1000} km` : `${v} m` }))} />
          <p className="label mt-4">Minimum incidents per cluster</p>
          <Segmented value={minSamples} onChange={setMinSamples} options={[5, 10, 15, 30].map((v) => ({ value: v, label: String(v) }))} />
          <button type="button" data-on={useView} onClick={() => setUseView((v) => !v)} className="neu-chip mt-4 w-full py-2">
            {useView ? 'Clustering the visible map area' : 'Clustering all matching incidents'}
          </button>
          <ClayButton className="mt-4 w-full" loading={busy} onClick={run}><Play className="h-4 w-4" /> Run DBSCAN</ClayButton>
          <ErrorBanner message={error} />
        </Glass>

        {res && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Clusters found" value={fmtNum(res.n_clusters)} tint="#FF4D6D" />
              <Stat label="Noise (not in a cluster)" value={`${Math.round((res.noise_ratio || 0) * 100)}%`} />
              <Stat label="Silhouette score" value={res.silhouette ?? '—'} note="−1 to 1; higher means tighter, better separated clusters" tint="#13A87C" />
              <Stat label="Suggested eps" value={res.suggested_eps_m ? `${Math.round(res.suggested_eps_m)} m` : '—'} note="k-distance elbow method" tint="#9B8CFF" />
            </div>
            <p className="text-xs text-ink-faint">
              {fmtNum(res.n_points)} incidents analysed{res.sampled ? `, a random sample of ${fmtNum(res.totalMatching)} matching` : ''}.
              {res.suggested_eps_m && Math.abs(res.suggested_eps_m - eps) > eps * 0.4 ? ' The suggested distance differs a lot from your setting; try a value near it.' : ''}
            </p>
            <Glass className="p-4">
              <h3 className="mb-2 font-bold">Highest-risk clusters</h3>
              {clusters.length ? (
                <ol className="scroll-thin max-h-80 space-y-2 overflow-y-auto pr-1">
                  {clusters.slice(0, 15).map((c) => (
                    <li key={c.id} className="flex items-center gap-3 rounded-2xl bg-white/60 px-3 py-2">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl font-display font-bold text-white shadow-clay" style={{ background: rankColor(c.rank) }}>{c.rank}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">{c.area || 'Unnamed area'}</p>
                        <p className="text-xs text-ink-soft">{c.top_type}, peak {hourLabel(c.peak_hour)} local, radius {Math.round(c.radius_m || 0)} m, critical {c.severity?.Critical ?? 0}</p>
                      </div>
                      <div className="text-right"><p className="font-display font-extrabold">{fmtNum(c.size)}</p><p className="text-[11px] text-ink-faint">risk {fmtNum(c.risk_score)}</p></div>
                    </li>
                  ))}
                </ol>
              ) : <p className="text-sm text-ink-soft">No dense groups at these settings.</p>}
            </Glass>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------------------- Random Forest ---------------------------- */
function SeverityModel({ params, online }) {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const model = useApi('/ml/severity/model');
  const [trees, setTrees] = useState(200);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pos, setPos] = useState(null);
  const [ptype, setPtype] = useState('Accident');
  const [when, setWhen] = useState(() => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); });
  const [pred, setPred] = useState(null);
  const extent = useApi('/analytics/bounds');

  const train = async () => {
    setBusy(true); setError('');
    try {
      const r = await api.post('/ml/severity/train', { n_estimators: trees, max_rows: 120000, filters: params }, { timeout: 620000 });
      toast(`Model v${r.data.version} trained: ${Math.round(r.data.metrics.accuracy * 100)}% accuracy`);
      model.reload();
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (!isLatLng(pos) || !model.data?.latest) return undefined;
    let alive = true;
    api.post('/ml/severity/predict', { lat: pos[0], lng: pos[1], type: ptype, datetime: new Date(when).toISOString() })
      .then((r) => alive && setPred(r.data)).catch((e) => alive && setPred({ error: errMsg(e) }));
    return () => { alive = false; };
  }, [pos, ptype, when, model.data]);

  const m = model.data?.latest;
  const met = m?.metrics;
  const labels = safeArr(met?.labels);
  const cm = safeArr(met?.confusion_matrix);
  const cmMax = Math.max(1, ...cm.flat());

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <div className="space-y-5">
        <Glass className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">Severity prediction (Random Forest)</h2>
              <p className="mt-1 max-w-xl text-sm text-ink-soft">
                Predicts how severe an incident is likely to be from its type, location and local time (hour, weekday, month, rush hour, night).
                Trained on 80% of the data and scored on the other 20%, and compared with always guessing the most common severity.
              </p>
            </div>
          </div>
          {isAdmin ? (
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div>
                <p className="label">Number of trees</p>
                <Segmented value={trees} onChange={setTrees} options={[100, 200, 400].map((v) => ({ value: v, label: String(v) }))} />
              </div>
              <ClayButton loading={busy} disabled={!online} onClick={train}><Sparkles className="h-4 w-4" /> {m ? 'Retrain model' : 'Train model'}</ClayButton>
            </div>
          ) : <p className="mt-3 text-sm text-ink-faint">An administrator trains the model.</p>}
          <p className="mt-2 text-xs text-ink-faint">Training uses the filters at the top of this page (up to 120,000 incidents).</p>
          <ErrorBanner message={error || model.error} />
        </Glass>

        {model.loading && !model.data ? <Spinner /> : !m ? (
          <Glass><EmptyState icon={BrainCircuit} title="No model trained yet">{isAdmin ? 'Press "Train model" to build the first version.' : 'Ask an administrator to train it.'}</EmptyState></Glass>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Accuracy" value={`${Math.round(met.accuracy * 100)}%`} tint="#13A87C" note={`baseline ${Math.round(met.baseline_accuracy * 100)}% (always "${met.baseline_label}")`} />
              <Stat label="Macro F1" value={met.macro_f1?.toFixed(2)} tint="#2E9BFF" note="balances all four classes" />
              <Stat label="Within one level" value={met.within_one_level != null ? `${Math.round(met.within_one_level * 100)}%` : '—'} tint="#9B8CFF" note="off by at most one severity step" />
              <Stat label="Model version" value={`v${m.version}`} note={`${fmtNum(m.samples?.train)} train, ${fmtNum(m.samples?.test)} test`} />
            </div>
            <Glass className="p-5">
              <h3 className="mb-1 font-bold">Confusion matrix (test set)</h3>
              <p className="mb-3 text-xs text-ink-soft">Rows are the real severity, columns the prediction. The diagonal is correct.</p>
              <div className="overflow-x-auto">
                <table className="text-center text-sm">
                  <thead><tr><th className="p-1" />{labels.map((l) => <th key={l} scope="col" className="p-1 text-xs font-bold text-ink-soft">{l}</th>)}</tr></thead>
                  <tbody>
                    {cm.map((row, i) => (
                      <tr key={labels[i]}>
                        <th scope="row" className="pr-2 text-right text-xs font-bold text-ink-soft">{labels[i]}</th>
                        {safeArr(row).map((v, j) => (
                          <td key={j} className="p-1">
                            <div className="grid h-12 w-16 place-items-center rounded-xl font-bold" style={{ background: i === j ? `rgba(43,217,166,${0.15 + (0.75 * v) / cmMax})` : `rgba(255,77,109,${(0.6 * v) / cmMax})` }}>{fmtNum(v)}</div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Glass>
          </>
        )}
      </div>

      <div className="space-y-5">
        {m && (
          <Glass className="p-5">
            <h3 className="mb-3 font-bold">What the model relies on (feature importance)</h3>
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={safeArr(m.featureImportance)} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid stroke="#dfe8f5" horizontal={false} />
                  <XAxis type="number" {...axis} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
                  <YAxis type="category" dataKey="feature" width={110} {...axis} tick={{ fill: '#1E2A44', fontSize: 12, fontWeight: 600 }} />
                  <Tooltip formatter={(v) => `${(v * 100).toFixed(1)}%`} />
                  <Bar dataKey="importance" radius={[0, 10, 10, 0]} barSize={22}>
                    {safeArr(m.featureImportance).map((f, i) => <Cell key={f.feature} fill={['#9B8CFF', '#2E9BFF', '#2BD9A6', '#FFC93C', '#FF8A3D'][i % 5]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="text-ink-soft">{['Severity', 'Precision', 'Recall', 'F1', 'Test rows'].map((h) => <th key={h} scope="col" className="px-2 py-1 font-bold">{h}</th>)}</tr></thead>
                <tbody>{safeArr(met?.per_class).map((r) => (
                  <tr key={r.label} className="border-t border-white/70">
                    <td className="px-2 py-1.5 font-bold"><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: SEV_COLOR[r.label] }} />{r.label}</td>
                    <td className="px-2 py-1.5">{r.precision}</td><td className="px-2 py-1.5">{r.recall}</td><td className="px-2 py-1.5">{r.f1}</td><td className="px-2 py-1.5">{fmtNum(r.support)}</td>
                  </tr>))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-ink-faint">Trained {fmtDate(m.createdAt)} by {m.trainedBy}, in {m.trainSeconds}s. {safeArr(model.data?.history).length > 1 ? `Earlier versions: ${model.data.history.slice(1, 4).map((h) => `v${h.version} ${Math.round((h.accuracy || 0) * 100)}%`).join(', ')}.` : ''}</p>
          </Glass>
        )}

        <Glass className="p-5">
          <h3 className="flex items-center gap-2 font-bold"><Target className="h-5 w-5 text-lilac" /> Try a prediction</h3>
          <p className="mb-3 text-sm text-ink-soft">Click a spot on the map, then pick a type and time.</p>
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <select className="neu-field py-2.5 text-sm" value={ptype} onChange={(e) => setPtype(e.target.value)} aria-label="Incident type">{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
            <input type="datetime-local" className="neu-field py-2.5 text-sm" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Date and time" />
          </div>
          <div className="overflow-hidden rounded-2xl shadow-clay-white">
            <BaseMap className="h-56 w-full">
              {extent.data?.bbox && <FitBounds bbox={extent.data.bbox} maxZoom={12} />}
              <MapToolbar className="absolute left-3 top-3 z-[1000]" />
              <ClickToPick onPick={(c) => isLatLng(c) && setPos(c)} />
              {isLatLng(pos) && <Marker position={pos} icon={pickIcon} />}
            </BaseMap>
          </div>
          {!pos && <p className="mt-3 flex items-center gap-2 text-sm text-ink-faint"><MousePointerClick className="h-4 w-4" /> No point chosen yet.</p>}
          {pred?.error && <p className="mt-3 text-sm text-coral">{pred.error}</p>}
          {pred?.probabilities && (
            <div className="mt-4 space-y-2">
              <p className="text-sm">At {safeFixed(pos?.[0], 3)}, {safeFixed(pos?.[1], 3)} ({pred.local?.tz}, {hourLabel(pred.local?.hour)} local): most likely <b>{pred.severity}</b>.</p>
              {SEVERITIES.map((s) => (
                <div key={s} className="flex items-center gap-2 text-sm">
                  <span className="w-16 font-semibold">{s}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-[#EEF4FC] shadow-neu-in"><div className="h-full rounded-full" style={{ width: `${(pred.probabilities[s] || 0) * 100}%`, background: SEV_COLOR[s] }} /></div>
                  <span className="w-12 text-right font-bold">{Math.round((pred.probabilities[s] || 0) * 100)}%</span>
                </div>
              ))}
            </div>
          )}
        </Glass>
      </div>
    </div>
  );
}

/* ---------------------------- Forecast ---------------------------- */
function Forecast({ params }) {
  const [horizon, setHorizon] = useState(14);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = JSON.stringify(params);

  useEffect(() => {
    let alive = true;
    setBusy(true); setError('');
    api.post('/ml/forecast', { horizon, filters: JSON.parse(key) }, { timeout: 120000 })
      .then((r) => alive && setRes(r.data))
      .catch((e) => { if (alive) { setError(errMsg(e)); setRes(null); } })
      .finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [horizon, key]);

  const chart = useMemo(() => {
    if (!res) return [];
    const hist = safeArr(res.history).slice(-60).map((h) => ({ date: h.date, actual: h.count }));
    const last = hist[hist.length - 1];
    const fc = safeArr(res.forecast).map((f) => ({ date: f.date, forecast: f.count, band: [f.lower, f.upper] }));
    if (last && fc.length) fc.unshift({ date: last.date, forecast: last.actual, band: [last.actual, last.actual] });
    const byDate = new Map();
    [...hist, ...fc].forEach((r) => byDate.set(r.date, { ...(byDate.get(r.date) || {}), ...r }));
    return [...byDate.values()].map((r) => ({ ...r, label: r.date.slice(5) }));
  }, [res]);
  const bt = res?.backtest;

  return (
    <div className="space-y-5">
      <Glass className="p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">Incident forecast</h2>
            <p className="max-w-2xl text-sm text-ink-soft">
              Daily incident counts for the filtered data. Several time-series models are tested on the most recent weeks; the most accurate one makes the forecast.
              The shaded band is an approximate 95% range.
            </p>
          </div>
          <Segmented value={horizon} onChange={setHorizon} options={[7, 14, 30].map((v) => ({ value: v, label: `${v} days` }))} />
        </div>
        <ErrorBanner message={error} />
        <div className="h-80">
          {busy && !res ? <Spinner label="Fitting models" /> : chart.length ? (
            <ResponsiveContainer>
              <ComposedChart data={chart} margin={{ left: -10, right: 10, top: 6 }}>
                <CartesianGrid stroke="#dfe8f5" vertical={false} />
                <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={24} />
                <YAxis {...axis} />
                <Tooltip contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 18px 40px -16px rgba(30,42,68,.35)' }}
                  formatter={(v, n) => (Array.isArray(v) ? [`${v[0]} to ${v[1]}`, '95% range'] : [v, n])} />
                <Area dataKey="band" stroke="none" fill="#9B8CFF" fillOpacity={0.22} name="95% range" isAnimationActive={false} />
                <Line dataKey="actual" name="Actual" stroke="#2E9BFF" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                <Line dataKey="forecast" name="Forecast" stroke="#9B8CFF" strokeWidth={3} strokeDasharray="6 5" dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : !error && <EmptyState icon={TrendingUp} title="No forecast yet" />}
        </div>
      </Glass>
      {res && (
        <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
          <div className="grid grid-cols-2 gap-3">
            <Stat label={`Expected in the next ${horizon} days`} value={fmtNum(Math.round(res.expected_total))} tint="#9B8CFF" />
            <Stat label="Recent daily average" value={res.recent_daily_avg} note="last 28 days" />
            <Stat label="Backtest error (MAE)" value={bt ? `${bt.mae} / day` : '—'} tint="#13A87C" note={bt ? `on the last ${bt.days} days` : 'not enough history'} />
            <Stat label="Seasonal-naive error" value={bt?.naive_mae != null ? `${bt.naive_mae} / day` : '—'} note="same weekday last week" />
          </div>
          <Glass className="p-5">
            <h3 className="mb-1 font-bold">Model comparison</h3>
            <p className="mb-3 text-xs text-ink-soft">Chosen: {res.method}. Lower error is better.</p>
            <table className="w-full text-left text-sm">
              <thead><tr className="text-ink-soft">{['Model', 'MAE / day', 'MAPE'].map((h) => <th key={h} scope="col" className="px-2 py-1 font-bold">{h}</th>)}</tr></thead>
              <tbody>{safeArr(bt?.candidates).map((c, i) => (
                <tr key={c.key} className={`border-t border-white/70 ${i === 0 ? 'font-bold' : ''}`}>
                  <td className="px-2 py-1.5">{i === 0 ? '✓ ' : ''}{c.method}</td><td className="px-2 py-1.5">{c.mae}</td><td className="px-2 py-1.5">{c.mape != null ? `${c.mape}%` : '—'}</td>
                </tr>))}
              </tbody>
            </table>
          </Glass>
        </div>
      )}
    </div>
  );
}

export default function AIInsights() {
  const [sp] = useSearchParams();
  const [tab, setTab] = useState('clusters');
  const [filters, setFilters] = useState(() => emptyFilters({ dataset: sp.get('dataset') || '' }));
  const status = useApi('/ml/status');
  const params = toParams(filters);
  const online = !!status.data?.online;

  return (
    <div>
      <PageHeader
        title="AI insights"
        subtitle="Machine learning on your incident data: DBSCAN hotspot clustering, a Random Forest severity model, and time-series forecasting."
        actions={<Segmented value={tab} onChange={setTab} options={[{ value: 'clusters', label: 'Hotspot clusters' }, { value: 'severity', label: 'Severity model' }, { value: 'forecast', label: 'Forecast' }]} />}
      />
      {status.data && !online && (
        <div className="mb-5 flex items-start gap-3 rounded-3xl bg-sun-soft/90 px-5 py-4 shadow-clay-white">
          <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-sun-deep" />
          <div className="text-sm">
            <p className="font-bold">The AI service is not running.</p>
            <p>Open a new terminal and run: <code className="rounded bg-white px-1.5 py-0.5">cd ml-service</code>, activate the virtual environment, then <code className="rounded bg-white px-1.5 py-0.5">uvicorn app:app --port 8000</code>. Then reload this page.</p>
          </div>
          <button type="button" className="ml-auto text-sm font-bold text-sky-deep hover:underline" onClick={status.reload}>Check again</button>
        </div>
      )}
      <div className="glass mb-5 p-5"><FilterBar value={filters} onChange={setFilters} defaultOpen={!!filters.dataset} /></div>
      {tab === 'clusters' && <Clustering params={params} />}
      {tab === 'severity' && <SeverityModel params={params} online={online} />}
      {tab === 'forecast' && <Forecast params={params} />}
    </div>
  );
}
