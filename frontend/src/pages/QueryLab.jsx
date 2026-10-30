import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Circle, Marker } from 'react-leaflet';
import { Gauge, Play } from 'lucide-react';
import api, { errMsg } from '../api/client';
import { BaseMap, ClickToPick, FlyTo, MapToolbar, pickIcon } from '../components/MapParts';
import useApi from '../lib/useApi';
import { isLatLng, safeArr, safeFixed, toLatLng } from '../lib/safe';
import { ClayButton, EmptyState, ErrorBanner, Glass, PageHeader, Segmented } from '../components/ui';
import { MYSURU } from '../lib/constants';
import { fmtNum } from '../lib/format';

function ResultBlock({ title, rows }) {
  const chart = safeArr(rows).map((r) => ({ name: r.usedIndex ? 'Index' : 'Scan', label: r.label, docs: r.docsExamined, keys: r.keysExamined, ms: r.timeMs, idx: r.usedIndex }));
  return (
    <Glass className="p-5 sm:p-6">
      <h2 className="mb-1 text-xl font-bold">{title}</h2>
      <p className="mb-4 text-sm text-ink-soft">Documents examined per query. Lower means the database did less work.</p>
      <div className="h-56">
        <ResponsiveContainer>
          <BarChart data={chart} layout="vertical" margin={{ left: 10, right: 30 }}>
            <CartesianGrid stroke="#dfe8f5" horizontal={false} />
            <XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: '#5B6B8C', fontSize: 12 }} />
            <YAxis type="category" dataKey="label" width={210} tickLine={false} axisLine={false} tick={{ fill: '#1E2A44', fontSize: 12, fontWeight: 600 }} />
            <Tooltip formatter={(v) => fmtNum(v)} cursor={{ fill: 'rgba(46,155,255,.08)' }} />
            <Bar dataKey="docs" name="Docs examined" radius={[0, 10, 10, 0]} barSize={26}>
              {chart.map((c) => <Cell key={c.label} fill={c.idx ? '#2BD9A6' : '#FF4D6D'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="scroll-thin mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="text-ink-soft">{['Query', 'Plan', 'Returned', 'Keys examined', 'Docs examined', 'Time'].map((h) => <th key={h} scope="col" className="px-3 py-2 font-bold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {safeArr(rows).map((r) => (
              <tr key={r.label} className="border-t border-white/70">
                <td className="px-3 py-2.5 font-semibold">{r.label}</td>
                <td className="px-3 py-2.5"><code className={`rounded-lg px-2 py-1 text-xs font-bold ${r.usedIndex ? 'bg-mint-soft text-mint-deep' : 'bg-coral-soft text-coral'}`}>{r.stages}</code></td>
                <td className="px-3 py-2.5">{fmtNum(r.nReturned)}</td>
                <td className="px-3 py-2.5">{fmtNum(r.keysExamined)}</td>
                <td className="px-3 py-2.5 font-bold">{fmtNum(r.docsExamined)}</td>
                <td className="px-3 py-2.5">{r.timeMs} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Glass>
  );
}

export default function QueryLab() {
  const [center, setCenter] = useState(MYSURU); // always a valid [lat, lng]
  const extent = useApi('/analytics/bounds');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    const c = toLatLng(extent.data?.center);
    if (c && !touched) setCenter(c);
  }, [extent.data, touched]);
  const pick = (c) => { if (isLatLng(c)) { setTouched(true); setCenter(c); } };
  const [radius, setRadius] = useState(2000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const run = async () => {
    setBusy(true); setError('');
    try {
      const { data } = await api.get('/analytics/performance', { params: { lat: center[0], lng: center[1], radius } });
      setResult(data);
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title="Query lab" subtitle={'Run the same query with and without index support and compare MongoDB explain("executionStats") output.'} />
      <div className="grid gap-5 xl:grid-cols-[1fr_1.1fr]">
        <Glass className="overflow-hidden p-2">
          <BaseMap center={center} zoom={13} className="h-[360px] w-full rounded-[22px]">
            <ClickToPick onPick={pick} />
            <FlyTo center={center} zoom={13} />
            <MapToolbar className="absolute left-4 top-4 z-[1000]" />
            <Circle center={center} radius={radius} pathOptions={{ color: '#2E9BFF', dashArray: '8 8', fillOpacity: 0.08 }} />
            <Marker position={center} icon={pickIcon} />
          </BaseMap>
        </Glass>
        <Glass className="flex flex-col p-6">
          <p className="label">Radius</p>
          <Segmented value={radius} onChange={setRadius} options={[{ value: 1000, label: '1 km' }, { value: 2000, label: '2 km' }, { value: 5000, label: '5 km' }]} />
          <p className="label mt-5">Queries that will run</p>
          <pre className="scroll-thin overflow-x-auto rounded-2xl bg-[#EEF4FC] p-4 text-xs leading-relaxed text-ink shadow-neu-in">{`db.incidents.find({ location: { $near: {
  $geometry: { type: "Point", coordinates: [${safeFixed(center[1])}, ${safeFixed(center[0])}] },
  $maxDistance: ${radius} } } }).explain("executionStats")

db.incidents.find({ location: { $geoWithin: {
  $centerSphere: [[${safeFixed(center[1])}, ${safeFixed(center[0])}], ${radius} / 6378100] } } })
  // run once normally, once with .hint({ $natural: 1 })

db.incidents.find({ severity: "Critical", status: "Pending" })
  // compound index vs .hint({ $natural: 1 })`}</pre>
          <ClayButton className="mt-5 self-start" loading={busy} onClick={run}><Play className="h-4 w-4" /> Run comparison</ClayButton>
          <p className="mt-3 text-xs text-ink-faint">Click the map to change the point. Timings vary between runs; documents examined is the steadier measure.</p>
        </Glass>
      </div>

      <div className="mt-5 space-y-5">
        <ErrorBanner message={error} />
        {result ? (
          <>
            <p className="font-semibold text-ink-soft">Collection size: <span className="font-display text-lg font-extrabold text-ink">{fmtNum(result.collectionSize)}</span> documents</p>
            <ResultBlock title="Geospatial search" rows={result.geo} />
            <ResultBlock title="Attribute filter" rows={result.attribute} />
          </>
        ) : (
          <Glass><EmptyState icon={Gauge} title="No comparison yet">Pick a point and radius, then run the comparison to see index scans against full collection scans.</EmptyState></Glass>
        )}
      </div>
    </div>
  );
}
