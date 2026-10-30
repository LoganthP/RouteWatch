import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Flame, Siren, Activity, Timer, MapPinned, Radio, FilePlus2, BrainCircuit, RefreshCw, ChevronDown } from 'lucide-react';
import { Rectangle } from 'react-leaflet';
import useApi, { useLiveRefresh } from '../lib/useApi';
import { BaseMap, FitBounds, HeatLayer, MapToolbar } from '../components/MapParts';
import api, { errMsg } from '../api/client';
import { ClayButton, ErrorBanner, SeverityPill, Spinner, TypeBadge } from '../components/ui';
import { SEV_COLOR } from '../lib/constants';
import { fmtNum, monthLabel, timeAgo } from '../lib/format';
import { safeArr } from '../lib/safe';
import { useAuth } from '../context/AuthContext';

const grid = { hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } } };
const cell = {
  hidden: { opacity: 0, y: 22, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 220, damping: 24 } },
};

function Tile({ className = '', children }) {
  return <motion.section variants={cell} className={`glass relative min-w-0 overflow-hidden p-5 ${className}`}>{children}</motion.section>;
}

function CardState({
  loading,
  error,
  empty,
  emptyMessage = 'No incidents yet — upload a dataset',
  onRetry,
  children,
  minHeight = 'min-h-[120px]',
}) {
  if (loading) {
    return (
      <div className={`flex flex-col items-center justify-center py-8 ${minHeight}`}>
        <Spinner />
      </div>
    );
  }
  if (error) {
    return (
      <div className={`flex flex-col items-center justify-center p-4 text-center ${minHeight}`}>
        <p className="text-sm font-semibold text-coral mb-2">{error}</p>
        {onRetry && (
          <ClayButton size="sm" variant="white" onClick={onRetry}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry
          </ClayButton>
        )}
      </div>
    );
  }
  if (empty) {
    return (
      <div className={`flex flex-col items-center justify-center p-4 text-center ${minHeight}`}>
        <p className="text-sm font-semibold text-ink-soft mb-3">{emptyMessage}</p>
        <Link to="/report">
          <ClayButton size="sm" variant="sun">
            Upload dataset
          </ClayButton>
        </Link>
      </div>
    );
  }
  return children;
}

function Metric({ icon: Icon, tint, label, value, note }) {
  return (
    <div className="flex h-full flex-col">
      <span className="grid h-11 w-11 place-items-center rounded-2xl shadow-clay-white" style={{ background: `${tint}26`, color: tint }}>
        <Icon className="h-5 w-5" />
      </span>
      <p className="mt-auto pt-5 font-display text-4xl font-extrabold leading-none">{value}</p>
      <p className="mt-1.5 font-semibold text-ink">{label}</p>
      {note && <p className="text-sm text-ink-soft">{note}</p>}
    </div>
  );
}

const ChartTip = ({ active, payload, label }) =>
  active && payload?.length ? (
    <div className="glass-strong px-3 py-2 text-sm">
      <p className="font-bold">{label}</p>
      {payload.map((p) => <p key={p.dataKey} style={{ color: p.color }}>{p.name}: {fmtNum(p.value)}</p>)}
    </div>
  ) : null;

export default function Dashboard() {
  const { user, isAdmin } = useAuth();

  // Fast single fetch: precomputed dashboard endpoint
  const dash = useApi('/dashboard', {}, { timeout: 10000 });

  // Graceful fallback to separate endpoints if /dashboard is unavailable
  const shouldFallback = Boolean(dash.error && !dash.data);
  const fbSummary = useApi(shouldFallback ? '/analytics/summary' : null, {}, { timeout: 12000 });
  const fbTrend = useApi(shouldFallback ? '/analytics/temporal' : null, { granularity: 'month' }, { timeout: 12000 });
  const fbHeat = useApi(shouldFallback ? '/analytics/heatmap' : null, { limit: 5000 }, { timeout: 12000 });
  const fbExtent = useApi(shouldFallback ? '/analytics/bounds' : null, {}, { timeout: 12000 });
  const fbHot = useApi(shouldFallback ? '/analytics/hotspots' : null, { limit: 40 }, { timeout: 12000 });
  const fbAreas = useApi(shouldFallback ? '/analytics/areas' : null, { limit: 5 }, { timeout: 12000 });
  const fbRecent = useApi(shouldFallback ? '/incidents' : null, { limit: 6 }, { timeout: 12000 });

  const summary = {
    loading: dash.loading && !dash.data,
    error: dash.error && !fbSummary.data ? (fbSummary.error || dash.error) : null,
    data: dash.data?.summary || fbSummary.data,
    reload: () => { dash.reload(); if (shouldFallback) fbSummary.reload(); },
  };

  const trend = {
    loading: dash.loading && !dash.data,
    error: dash.error && !fbTrend.data ? (fbTrend.error || dash.error) : null,
    data: dash.data?.trend || fbTrend.data,
    reload: () => { dash.reload(); if (shouldFallback) fbTrend.reload(); },
  };

  const heat = {
    loading: dash.loading && !dash.data,
    error: dash.error && !fbHeat.data ? (fbHeat.error || dash.error) : null,
    data: dash.data?.heat || fbHeat.data,
    reload: () => { dash.reload(); if (shouldFallback) fbHeat.reload(); },
  };

  const extent = {
    loading: dash.loading && !dash.data,
    error: dash.error && !fbExtent.data ? (fbExtent.error || dash.error) : null,
    data: dash.data?.extent || fbExtent.data,
    reload: () => { dash.reload(); if (shouldFallback) fbExtent.reload(); },
  };

  const hot = {
    loading: dash.loading && !dash.data,
    error: dash.error && !fbHot.data ? (fbHot.error || dash.error) : null,
    data: dash.data?.hot || fbHot.data,
    reload: () => { dash.reload(); if (shouldFallback) fbHot.reload(); },
  };

  const areas = {
    loading: dash.loading && !dash.data,
    error: dash.error && !fbAreas.data ? (fbAreas.error || dash.error) : null,
    data: dash.data?.areas || fbAreas.data,
    reload: () => { dash.reload(); if (shouldFallback) fbAreas.reload(); },
  };

  const recent = {
    loading: dash.loading && !dash.data,
    error: dash.error && !fbRecent.data ? (fbRecent.error || dash.error) : null,
    data: dash.data?.recent
      ? (Array.isArray(dash.data.recent) ? { items: dash.data.recent } : dash.data.recent)
      : fbRecent.data,
    reload: () => { dash.reload(); if (shouldFallback) fbRecent.reload(); },
  };

  const [outlook, setOutlook] = useState({ loading: true, data: null, error: null });
  const [live, setLive] = useState(0);

  const fetchOutlook = useCallback(() => {
    setOutlook({ loading: true, data: null, error: null });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    api.post('/ml/forecast', { horizon: 7 }, { signal: controller.signal })
      .then((r) => setOutlook({ loading: false, data: r.data, error: null }))
      .catch((e) => {
        const msg = (e.response?.status === 503 || e.response?.data?.code === 'AI_OFFLINE')
          ? 'AI forecasts are offline'
          : errMsg(e);
        setOutlook({ loading: false, data: null, error: msg });
      })
      .finally(() => clearTimeout(timeoutId));
  }, []);

  useEffect(() => {
    fetchOutlook();
  }, [fetchOutlook]);

  // Refetch on socket events or window focus
  useLiveRefresh((d) => {
    if (d?.kind === 'new') setLive((n) => n + 1);
    dash.reload();
  });

  const s = summary.data;
  const isDbEmpty = summary.data && summary.data.total === 0;
  const series = safeArr(trend.data?.series).slice(-12).map((r) => ({ ...r, label: monthLabel(r.label) }));
  const maxArea = Math.max(1, ...safeArr(areas.data).map((a) => a.total || 0));

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-semibold text-ink-soft">Hello, {user?.name?.split(' ')[0] || 'User'}</p>
          <h1 className="text-3xl font-extrabold sm:text-4xl">Today on the roads you watch</h1>
        </div>
        <Link to="/report">
          <ClayButton variant="sun">
            <FilePlus2 className="h-5 w-5" /> Report incident
          </ClayButton>
        </Link>
      </div>

      {summary.error && <ErrorBanner message={summary.error} onRetry={summary.reload} />}

      <motion.div variants={grid} initial="hidden" animate="show" className="grid auto-rows-[minmax(150px,auto)] grid-cols-1 gap-4 md:grid-cols-6 xl:grid-cols-12">
        {/* Map Card */}
        <Tile className="!p-0 md:col-span-6 xl:col-span-7 xl:row-span-3">
          <div className="absolute left-4 right-4 top-4 z-[500] flex flex-wrap items-center justify-between gap-2">
            <div className="glass-strong flex items-center gap-2 px-3.5 py-2">
              <MapPinned className="h-4 w-4 text-sky" />
              <span className="font-display font-bold">Incident density</span>
            </div>
            <Link to="/map" className="glass-strong px-3.5 py-2 text-sm font-bold text-sky-deep hover:bg-white">
              Open live map
            </Link>
          </div>
          <BaseMap className="h-[420px] w-full xl:h-full xl:min-h-[480px]" zoomPosition="bottomright">
            {extent.data?.bbox && <FitBounds bbox={extent.data.bbox} maxZoom={13} />}
            <MapToolbar dataBbox={extent.data?.bbox} className="absolute left-4 top-16 z-[1000]" />
            <HeatLayer points={heat.data} />
            {safeArr(hot.data?.cells).filter((c) => c.isHotspot).map((c) => (
              <Rectangle key={c.center.join()} bounds={c.bounds} pathOptions={{ color: '#FF4D6D', weight: 2, dashArray: '6 6', fillOpacity: 0.05 }} />
            ))}
          </BaseMap>
          {hot.data && (
            <div className="glass-strong absolute bottom-4 left-4 z-[500] max-w-[18rem] px-3.5 py-2.5 text-sm">
              <span className="font-bold">Dashed boxes</span> mark grid cells with more than 2 standard deviations above the average report count.
            </div>
          )}
        </Tile>

        {/* Total Incidents Tile */}
        <Tile className="md:col-span-6 xl:col-span-5 bg-gradient-to-br from-white/80 to-sky-soft/70">
          <CardState
            loading={summary.loading}
            error={summary.error}
            empty={isDbEmpty}
            onRetry={summary.reload}
            minHeight="min-h-[160px]"
          >
            {s && (
              <div className="flex h-full flex-col justify-between gap-4">
                <div className="flex items-center justify-between">
                  <p className="font-display text-lg font-bold">Total incidents</p>
                  <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-sky-deep shadow-clay-white">
                    +{fmtNum(s.lastWeek)} this week
                  </span>
                </div>
                <p className="font-display text-[clamp(3.5rem,7vw,5.5rem)] font-extrabold leading-none tracking-tight">
                  {fmtNum(s.total)}
                </p>
                <div className="lane w-full" />
                <div className="flex flex-wrap gap-2">
                  {safeArr(s.bySeverity).map((x, idx) => (
                    <span key={x.severity || idx} className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-xs font-bold">
                      <span className="h-2 w-2 rounded-full" style={{ background: SEV_COLOR[x.severity] }} />
                      {x.severity} {fmtNum(x.total)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </CardState>
        </Tile>

        {/* High Severity Metric */}
        <Tile className="md:col-span-3 xl:col-span-2 xl:row-span-1">
          <CardState loading={summary.loading} error={summary.error} empty={isDbEmpty} onRetry={summary.reload}>
            {s && <Metric icon={Siren} tint="#FF4D6D" label="High severity" value={fmtNum(s.highSeverity)} note="High + critical" />}
          </CardState>
        </Tile>

        {/* Active Reports Metric */}
        <Tile className="md:col-span-3 xl:col-span-3">
          <CardState loading={summary.loading} error={summary.error} empty={isDbEmpty} onRetry={summary.reload}>
            {s && <Metric icon={Activity} tint="#2E9BFF" label="Active reports" value={fmtNum(s.active)} note={`${fmtNum(s.pending)} awaiting verification`} />}
          </CardState>
        </Tile>

        {/* Hotspots Metric */}
        <Tile className="md:col-span-3 xl:col-span-2">
          <CardState loading={summary.loading} error={summary.error} empty={isDbEmpty} onRetry={summary.reload}>
            {s && <Metric icon={Flame} tint="#FF8A3D" label="Hotspots" value={fmtNum(s.hotspotZones)} note="Dense grid cells" />}
          </CardState>
        </Tile>

        {/* Avg Resolution Metric */}
        <Tile className="md:col-span-3 xl:col-span-3 bg-gradient-to-br from-white/80 to-mint-soft/80">
          <CardState loading={summary.loading} error={summary.error} empty={isDbEmpty} onRetry={summary.reload}>
            {s && <Metric icon={Timer} tint="#13A87C" label="Avg. time to resolve" value={s.avgResolutionHours != null ? `${s.avgResolutionHours} h` : '—'} note="Resolved incidents" />}
          </CardState>
        </Tile>

        {/* Monthly Trend Chart */}
        <Tile className="md:col-span-6 xl:col-span-7">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold">Monthly incident trend</h2>
            <Link to="/analytics" className="text-sm font-bold text-sky-deep hover:underline">
              More analytics
            </Link>
          </div>
          <div className="h-56">
            <CardState
              loading={trend.loading}
              error={trend.error}
              empty={isDbEmpty || series.length === 0}
              onRetry={trend.reload}
              minHeight="h-56"
            >
              {trend.data && (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ left: -18, right: 8, top: 6 }}>
                    <defs>
                      <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2E9BFF" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#2E9BFF" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="gCrit" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#FF4D6D" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#FF4D6D" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#dfe8f5" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#5B6B8C', fontSize: 12 }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fill: '#5B6B8C', fontSize: 12 }} />
                    <Tooltip content={<ChartTip />} />
                    <Area type="monotone" dataKey="total" name="All" stroke="#2E9BFF" strokeWidth={3} fill="url(#gTotal)" />
                    <Area type="monotone" dataKey="critical" name="Critical" stroke="#FF4D6D" strokeWidth={2.5} fill="url(#gCrit)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardState>
          </div>
        </Tile>

        {/* Severity Mix Donut */}
        <Tile className="md:col-span-3 xl:col-span-5">
          <h2 className="text-lg font-bold">Severity mix</h2>
          <CardState
            loading={summary.loading}
            error={summary.error}
            empty={isDbEmpty || !s?.bySeverity?.some((x) => x.total > 0)}
            onRetry={summary.reload}
            minHeight="h-48"
          >
            {s && (
              <div className="flex items-center gap-4">
                <div className="h-48 w-48 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={s.bySeverity} dataKey="total" nameKey="severity" innerRadius="58%" outerRadius="92%" paddingAngle={3} cornerRadius={8} stroke="none">
                        {s.bySeverity.map((x, idx) => <Cell key={x.severity || idx} fill={SEV_COLOR[x.severity]} />)}
                      </Pie>
                      <Tooltip formatter={(v) => fmtNum(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="w-full space-y-2.5">
                  {s.bySeverity.map((x, idx) => (
                    <li key={x.severity || idx} className="flex items-center justify-between text-sm">
                      <span className="inline-flex items-center gap-2 font-semibold">
                        <span className="h-3 w-3 rounded" style={{ background: SEV_COLOR[x.severity] }} />
                        {x.severity}
                      </span>
                      <span className="font-bold">{s.total ? Math.round((x.total / s.total) * 100) : 0}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardState>
        </Tile>

        {/* Top Areas */}
        <Tile className="md:col-span-3 xl:col-span-5">
          <h2 className="mb-4 text-lg font-bold">Areas with the most reports</h2>
          <CardState
            loading={areas.loading}
            error={areas.error}
            empty={isDbEmpty || !areas.data || areas.data.length === 0}
            onRetry={areas.reload}
            minHeight="min-h-[140px]"
          >
            {areas.data && (
              <ol className="space-y-3">
                {safeArr(areas.data).map((a, idx) => (
                  <li key={a.area || idx}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="font-semibold">{a.area}</span>
                      <span className="font-bold">{fmtNum(a.total)}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-white shadow-neu-in">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-sky to-lilac"
                        initial={{ width: 0 }}
                        animate={{ width: `${(a.total / maxArea) * 100}%` }}
                        transition={{ type: 'spring', stiffness: 90, damping: 20, delay: 0.4 }}
                      />
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardState>
        </Tile>

        {/* Live Feed / Latest Reports */}
        <Tile className="md:col-span-6 xl:col-span-7">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <Radio className="h-5 w-5 text-coral" /> Latest reports
            </h2>
            {live > 0 && (
              <span className="rounded-full bg-coral-soft px-2.5 py-1 text-xs font-bold text-coral">
                {live} new while you were here
              </span>
            )}
          </div>
          <CardState
            loading={recent.loading}
            error={recent.error}
            empty={isDbEmpty || !recent.data?.items?.length}
            onRetry={recent.reload}
            minHeight="min-h-[140px]"
          >
            {recent.data && (
              <ul className="divide-y divide-white/80">
                {safeArr(recent.data.items).map((d, idx) => (
                  <li key={d._id || d.incidentId || idx} className="flex items-center gap-3 py-2.5">
                    <TypeBadge value={d.type} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{d.description || d.type}</p>
                      <p className="text-xs text-ink-soft">{d.area}, {timeAgo(d.reportedAt)}</p>
                    </div>
                    <SeverityPill value={d.severity} />
                  </li>
                ))}
              </ul>
            )}
          </CardState>
        </Tile>

        {/* AI Outlook Card */}
        <Tile className="md:col-span-6 xl:col-span-12 bg-gradient-to-r from-white/80 via-lilac-soft/60 to-sky-soft/70">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div className="flex items-center gap-4 min-w-[14rem] flex-1">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-lilac text-white shadow-clay">
                <BrainCircuit className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-bold">AI outlook for the next 7 days</h2>
                {outlook.loading && <p className="text-sm text-ink-soft">Running the forecast model…</p>}
                {outlook.error && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-amber-600">{outlook.error}</span>
                      <button
                        type="button"
                        onClick={fetchOutlook}
                        className="inline-flex items-center gap-1 text-xs font-bold text-sky-deep underline hover:text-sky"
                      >
                        <RefreshCw className="h-3 w-3" /> Retry
                      </button>
                    </div>
                    {isAdmin && (
                      <details className="text-xs text-ink-soft cursor-pointer mt-1">
                        <summary className="font-semibold text-ink-soft hover:text-ink">How to start it</summary>
                        <div className="mt-1 p-2 rounded-xl bg-white/70 font-mono text-[11px] text-ink select-all">
                          cd ml-service && venv\Scripts\activate && uvicorn app:app --port 8000
                        </div>
                      </details>
                    )}
                  </div>
                )}
                {outlook.data && (
                  <p className="text-sm text-ink-soft">
                    {outlook.data.method}. Backtest error {outlook.data.backtest?.mae ?? '—'} incidents per day.
                  </p>
                )}
              </div>
            </div>

            {outlook.data && (
              <div className="flex flex-wrap items-end gap-6">
                <div>
                  <p className="font-display text-4xl font-extrabold leading-none">{fmtNum(Math.round(outlook.data.expected_total))}</p>
                  <p className="text-sm font-semibold text-ink-soft">expected incidents</p>
                </div>
                <div>
                  <p className="font-display text-2xl font-bold leading-none">{fmtNum(Math.round((outlook.data.recent_daily_avg || 0) * 7))}</p>
                  <p className="text-sm font-semibold text-ink-soft">last-4-weeks pace</p>
                </div>
              </div>
            )}

            <Link to="/ai" className="clay-btn-white clay-btn-sm shrink-0">
              Open AI insights
            </Link>
          </div>
        </Tile>
      </motion.div>
    </div>
  );
}
