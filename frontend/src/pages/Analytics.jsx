import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Legend as RLegend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Rectangle, Tooltip as LTooltip } from 'react-leaflet';
import { Info, ScanSearch } from 'lucide-react';
import useApi from '../lib/useApi';
import FilterBar from '../components/FilterBar';
import { BaseMap, FitBounds, MapToolbar, ViewportWatcher } from '../components/MapParts';
import { ErrorBanner, Glass, PageHeader, Segmented, Spinner } from '../components/ui';
import { SEV_COLOR, emptyFilters, toParams } from '../lib/constants';
import { fmtNum, monthLabel } from '../lib/format';
import { safeArr } from '../lib/safe';

const axis = { tickLine: false, axisLine: false, tick: { fill: '#5B6B8C', fontSize: 12 } };
const SEV_KEYS = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['critical', 'Critical']];

function Section({ title, subtitle, actions, className = '', children }) {
  return (
    <Glass className={`min-w-0 p-5 sm:p-6 ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{title}</h2>
          {subtitle && <p className="text-sm text-ink-soft">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </Glass>
  );
}

function StackedSeverityBars({ data, xKey }) {
  return (
    <ResponsiveContainer>
      <BarChart data={data} margin={{ left: -14, right: 6 }}>
        <CartesianGrid stroke="#dfe8f5" vertical={false} />
        <XAxis dataKey={xKey} {...axis} interval="preserveStartEnd" />
        <YAxis {...axis} />
        <Tooltip cursor={{ fill: 'rgba(46,155,255,.08)' }} contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 18px 40px -16px rgba(30,42,68,.35)' }} />
        <RLegend iconType="circle" wrapperStyle={{ fontSize: 13, fontWeight: 600 }} />
        {SEV_KEYS.map(([k, label], i) => (
          <Bar key={k} dataKey={k} name={label} stackId="s" fill={SEV_COLOR[label]} radius={i === 3 ? [6, 6, 0, 0] : 0} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function WeekHourGrid({ data }) {
  if (!data) return <Spinner />;
  const color = (v) => {
    const t = data.max ? v / data.max : 0;
    if (t === 0) return '#F1F6FD';
    if (t < 0.35) return `rgba(127,211,255,${0.35 + t})`;
    if (t < 0.65) return `rgba(255,201,60,${0.45 + t * 0.5})`;
    if (t < 0.85) return '#FF8A3D';
    return '#FF4D6D';
  };
  return (
    <div className="scroll-thin overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="ml-12 grid grid-cols-24 text-[10px] font-bold text-ink-faint" style={{ gridTemplateColumns: 'repeat(24,1fr)' }}>
          {Array.from({ length: 24 }, (_, h) => <span key={h} className="text-center">{h % 3 === 0 ? h : ''}</span>)}
        </div>
        {safeArr(data.grid).map((row) => (
          <div key={row.day} className="mt-1 flex items-center gap-2">
            <span className="w-10 text-right text-xs font-bold text-ink-soft">{row.day}</span>
            <div className="grid flex-1 gap-1" style={{ gridTemplateColumns: 'repeat(24,1fr)' }}>
              {row.hours.map((v, h) => (
                <div key={h} title={`${row.day} ${h}:00, ${v} incidents`} className="aspect-square rounded-md" style={{ background: color(v) }} />
              ))}
            </div>
          </div>
        ))}
        <p className="ml-12 mt-2 text-xs text-ink-faint">Hour of day in each incident's local time. Darker cells had more reports.</p>
      </div>
    </div>
  );
}

export default function Analytics() {
  const [sp] = useSearchParams();
  const [filters, setFilters] = useState(() => emptyFilters({ dataset: sp.get('dataset') || '' }));
  const [gran, setGran] = useState('hour');
  const [cell, setCell] = useState('auto');
  const [visibleOnly, setVisibleOnly] = useState(false);
  const [view, setView] = useState(null);
  const base = toParams(filters);
  const p = visibleOnly && view ? { ...base, bbox: view.bbox } : base;

  const extent = useApi('/analytics/bounds', base);
  const temporal = useApi('/analytics/temporal', { ...p, granularity: gran });
  const weekhour = useApi('/analytics/temporal', { ...p, granularity: 'weekhour' });
  const sev = useApi('/analytics/severity', p);
  const areas = useApi('/analytics/areas', { ...p, limit: 12 });
  const hot = useApi('/analytics/hotspots', view ? { ...base, bbox: view.bbox, ...(cell === 'auto' ? {} : { cell }), limit: 600 } : null, { skip: !view });

  const series = safeArr(temporal.data?.series).map((r) => ({ ...r, label: gran === 'month' ? monthLabel(r.label) : r.label }));
  const maxCount = Math.max(1, ...safeArr(hot.data?.cells).map((c) => c.count || 0));
  const maxRisk = Math.max(1, ...safeArr(areas.data).map((a) => a.riskScore || 0));

  return (
    <div>
      <PageHeader title="Analytics" subtitle="Every chart here is computed by a MongoDB aggregation pipeline on the server. Times are each incident's local time."
        actions={(
          <button type="button" data-on={visibleOnly} aria-pressed={visibleOnly} onClick={() => setVisibleOnly((v) => !v)} className="neu-chip inline-flex items-center gap-2 py-2.5">
            <ScanSearch className="h-4 w-4 text-sky" /> {visibleOnly ? 'Charts follow the hotspot map view' : 'Analyze only the hotspot map view'}
          </button>
        )} />
      <div className="glass mb-5 p-5"><FilterBar value={filters} onChange={setFilters} /></div>
      <ErrorBanner message={temporal.error || sev.error || areas.error || hot.error} />

      <div className="grid gap-5 xl:grid-cols-12">
        <Section className="xl:col-span-8" title="When incidents are reported"
          subtitle="Counts grouped with $hour, $dayOfWeek or $dateToString, split by severity."
          actions={<Segmented value={gran} onChange={setGran} options={[{ value: 'hour', label: 'By hour' }, { value: 'dayOfWeek', label: 'By weekday' }, { value: 'month', label: 'By month' }]} />}>
          <div className="h-80">{temporal.data ? <StackedSeverityBars data={series} xKey="label" /> : <Spinner />}</div>
        </Section>

        <Section className="xl:col-span-4" title="Severity distribution" subtitle="$group on severity">
          {sev.data ? (
            <div className="h-80">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={sev.data.distribution} dataKey="total" nameKey="severity" innerRadius="48%" outerRadius="80%" paddingAngle={3} cornerRadius={10} stroke="none">
                    {safeArr(sev.data.distribution).map((d) => <Cell key={d.severity} fill={SEV_COLOR[d.severity]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => fmtNum(v)} />
                  <RLegend iconType="circle" wrapperStyle={{ fontSize: 13, fontWeight: 600 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : <Spinner />}
        </Section>

        <Section className="xl:col-span-7" title="Weekday and hour pattern" subtitle="$dayOfWeek and $hour grouped together">
          <WeekHourGrid data={weekhour.data} />
        </Section>

        <Section className="xl:col-span-5" title="Severity by incident type" subtitle="Conditional $sum per severity inside one $group">
          <div className="h-72">{sev.data ? <StackedSeverityBars data={sev.data.byType} xKey="type" /> : <Spinner />}</div>
        </Section>

        <Section className="xl:col-span-7" title="Hotspot grid"
          subtitle={hot.data ? `${fmtNum(hot.data.totalCells)} cells of about ${hot.data.cellSizeKm} km in this view. ${hot.data.hotspotCount} hotspots at ${hot.data.threshold}+ reports. For the AI method, see AI insights.` : 'Coordinates bucketed with $floor, then grouped'}
          actions={<Segmented value={cell} onChange={setCell} options={[{ value: 'auto', label: 'Auto' }, { value: 0.003, label: '330 m' }, { value: 0.005, label: '550 m' }, { value: 0.01, label: '1.1 km' }]} />}>
          <div className="overflow-hidden rounded-3xl shadow-clay-white">
            <BaseMap className="h-[420px] w-full">
              <ViewportWatcher onChange={setView} />
              {extent.data?.bbox && <FitBounds bbox={extent.data.bbox} maxZoom={13} />}
              <MapToolbar dataBbox={extent.data?.bbox} className="absolute left-4 top-4 z-[1000]" />
              {safeArr(hot.data?.cells).map((c) => (
                <Rectangle key={`${cell}-${c.center.join()}`} bounds={c.bounds}
                  pathOptions={{ color: c.isHotspot ? '#FF4D6D' : '#ffffff', weight: c.isHotspot ? 2 : 0.4, fillColor: c.isHotspot ? '#FF4D6D' : '#2E9BFF', fillOpacity: 0.1 + 0.6 * (c.count / maxCount) }}>
                  <LTooltip>{fmtNum(c.count)} reports, risk score {fmtNum(c.score)}<br />{safeArr(c.areas).join(', ')}</LTooltip>
                </Rectangle>
              ))}
            </BaseMap>
          </div>
        </Section>

        <Section className="xl:col-span-5" title="Top hotspot cells" subtitle="Sorted by report count">
          {hot.data ? (
            <ol className="scroll-thin max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {safeArr(hot.data.cells).slice(0, 12).map((c, i) => (
                <li key={c.center.join()} className="flex items-center gap-3 rounded-2xl bg-white/60 px-3.5 py-2.5">
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl font-display font-bold ${c.isHotspot ? 'bg-coral text-white shadow-clay' : 'bg-sky-soft text-sky-deep'}`}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{safeArr(c.areas).join(', ') || 'Unnamed'}</p>
                    <p className="text-xs text-ink-soft">{Number(c.center?.[1]).toFixed(4)}, {Number(c.center?.[0]).toFixed(4)}. Critical {c.severity?.critical ?? 0}, high {c.severity?.high ?? 0}</p>
                  </div>
                  <span className="font-display text-lg font-extrabold">{fmtNum(c.count)}</span>
                </li>
              ))}
            </ol>
          ) : <Spinner />}
        </Section>

        <Section className="xl:col-span-12" title="Area ranking" subtitle="Risk score weights each report by severity (low 1, medium 2, high 3, critical 4).">
          {areas.data ? (
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="text-ink-soft">
                    {['Area', 'Reports', 'Critical', 'High', 'Avg. severity', 'Avg. hours to resolve', 'Risk score'].map((h) => <th key={h} scope="col" className="px-3 py-2 font-bold">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {safeArr(areas.data).map((a) => (
                    <tr key={a.area} className="border-t border-white/70">
                      <td className="px-3 py-2.5 font-bold">{a.area}</td>
                      <td className="px-3 py-2.5">{fmtNum(a.total)}</td>
                      <td className="px-3 py-2.5 font-semibold text-coral">{fmtNum(a.critical)}</td>
                      <td className="px-3 py-2.5 font-semibold text-tangerine">{fmtNum(a.high)}</td>
                      <td className="px-3 py-2.5">{a.avgSeverity}</td>
                      <td className="px-3 py-2.5">{a.avgResolutionHours ?? '—'}</td>
                      <td className="w-[28%] px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white shadow-neu-in">
                            <div className="h-full rounded-full bg-gradient-to-r from-sun to-coral" style={{ width: `${(a.riskScore / maxRisk) * 100}%` }} />
                          </div>
                          <span className="w-14 text-right font-bold">{fmtNum(a.riskScore)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Spinner />}
          <p className="mt-4 flex items-start gap-2 rounded-2xl bg-sun-soft/80 px-4 py-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-sun-deep" />
            More reports in an area does not by itself prove a road is more dangerous. Traffic volume and how many people report from that area both affect these counts.
          </p>
        </Section>
      </div>
    </div>
  );
}
