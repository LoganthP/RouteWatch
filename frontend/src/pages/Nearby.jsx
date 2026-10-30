import { useMemo, useState } from 'react';
import { Circle, GeoJSON, Marker, Rectangle, Tooltip } from 'react-leaflet';
import { Crosshair, LocateFixed, Radar, MousePointerClick } from 'lucide-react';
import useApi from '../lib/useApi';
import api, { errMsg } from '../api/client';
import { BaseMap, ClickToPick, FitBounds, IncidentMarkers, Legend, MapToolbar, pickIcon } from '../components/MapParts';
import { ClayButton, EmptyState, ErrorBanner, PageHeader, Segmented, SeverityPill, Spinner, StatusPill, TypeBadge } from '../components/ui';
import { MYSURU, SEVERITIES, SEV_COLOR } from '../lib/constants';
import { isLatLng, safeArr, safeFixed, toLatLng } from '../lib/safe';
import { fmtDist, fmtNum, timeAgo } from '../lib/format';
import L from '../lib/leaflet-setup';

const RADII = [{ value: 1000, label: '1 km' }, { value: 2000, label: '2 km' }, { value: 5000, label: '5 km' }];

function RadiusMode({ start }) {
  const [center, setCenter] = useState(start);
  const [radius, setRadius] = useState(2000);
  const [severity, setSeverity] = useState([]);
  const [activeOnly, setActiveOnly] = useState(false);
  const [locErr, setLocErr] = useState('');

  const params = {
    lat: safeFixed(center[0], 6, '0'), lng: safeFixed(center[1], 6, '0'), radius, limit: 300,
    ...(severity.length ? { severity: severity.join(',') } : {}),
    ...(activeOnly ? { status: 'Pending,Verified' } : {}),
  };
  const { data, loading, error } = useApi('/incidents/nearby', params);

  const locate = () => {
    setLocErr('');
    if (!navigator.geolocation) return setLocErr('This browser cannot share your location.');
    navigator.geolocation.getCurrentPosition(
      (p) => { const c = [p.coords.latitude, p.coords.longitude]; if (isLatLng(c)) setCenter(c); },
      () => setLocErr('Location permission was denied. Click on the map instead.')
    );
  };

  const bounds = useMemo(() => (isLatLng(center) ? L.latLng(center).toBounds(radius * 2.2) : null), [center, radius]);

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_26rem]">
      <div className="glass relative min-w-0 overflow-hidden p-2">
        <BaseMap className="h-[520px] w-full rounded-[22px] xl:h-full xl:min-h-[560px]" zoom={14} zoomPosition="topright">
          <ClickToPick onPick={(c) => isLatLng(c) && setCenter(c)} />
          {bounds && <FitBounds bounds={bounds} />}
          <MapToolbar className="absolute bottom-20 left-5 z-[1000]" />
          <Circle center={center} radius={radius} pathOptions={{ color: '#2E9BFF', weight: 2, dashArray: '8 8', fillColor: '#2E9BFF', fillOpacity: 0.08 }} />
          <Marker position={center} icon={pickIcon} />
          {data && <IncidentMarkers items={data.items} />}
        </BaseMap>
        <div className="glass-strong absolute left-5 top-5 z-[500] flex items-center gap-2 px-3.5 py-2 text-sm font-semibold">
          <MousePointerClick className="h-4 w-4 text-sky" /> Click the map to move the search point
        </div>
        <Legend className="absolute bottom-5 right-5 z-[500]" />
      </div>

      <div className="space-y-4">
        <div className="glass p-5">
          <p className="label">Search radius</p>
          <Segmented options={RADII} value={radius} onChange={setRadius} />
          <input type="range" min={250} max={10000} step={250} value={radius} onChange={(e) => setRadius(Number(e.target.value))}
            className="mt-4 w-full accent-sky" aria-label="Custom radius in metres" />
          <p className="text-sm text-ink-soft">{fmtDist(radius)}</p>

          <p className="label mt-4">Severity</p>
          <div className="flex flex-wrap gap-2">
            {SEVERITIES.map((s) => (
              <button key={s} type="button" className="neu-chip inline-flex items-center gap-1.5" data-on={severity.includes(s)}
                onClick={() => setSeverity((v) => (v.includes(s) ? v.filter((x) => x !== s) : [...v, s]))}>
                <span className="h-2 w-2 rounded-full" style={{ background: SEV_COLOR[s] }} />{s}
              </button>
            ))}
            <button type="button" className="neu-chip" data-on={activeOnly} onClick={() => setActiveOnly((v) => !v)}>Active only</button>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <ClayButton size="sm" variant="white" onClick={locate}><LocateFixed className="h-4 w-4 text-sky" /> Use my location</ClayButton>
            <span className="text-xs font-semibold text-ink-faint">{safeFixed(center[0])}, {safeFixed(center[1])}</span>
          </div>
          {locErr && <p className="mt-2 text-sm font-semibold text-coral">{locErr}</p>}
        </div>

        <ErrorBanner message={error} />
        {data && (
          <div className="grid grid-cols-3 gap-3">
            {[
              ['Found', data.stats?.total, '#2E9BFF'],
              ['Critical', data.stats?.critical, '#FF4D6D'],
              ['Active', data.stats?.active, '#13A87C'],
            ].map(([l, v, c]) => (
              <div key={l} className="glass p-3.5 text-center">
                <p className="font-display text-2xl font-extrabold" style={{ color: c }}>{fmtNum(v)}</p>
                <p className="text-xs font-bold text-ink-soft">{l}</p>
              </div>
            ))}
          </div>
        )}

        <div className="glass scroll-thin max-h-[440px] overflow-y-auto p-2">
          {loading && !data ? <Spinner label="Running $geoNear" /> : safeArr(data?.items).length ? (
            <ul>
              {safeArr(data.items).slice(0, 100).map((d) => (
                <li key={d._id} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-white/70">
                  <TypeBadge value={d.type} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{d.description || d.type}</p>
                    <p className="text-xs text-ink-soft">{d.area}, {timeAgo(d.reportedAt)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-extrabold text-sky-deep">{fmtDist(d.distance)}</p>
                    <SeverityPill value={d.severity} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Radar} title="Nothing reported in this circle">Widen the radius or move the point to a busier junction.</EmptyState>
          )}
        </div>
      </div>
    </div>
  );
}

function ZoneMode() {
  const zones = useApi('/areas', { limit: 300 });
  const [name, setName] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const list = safeArr(zones.data);

  const run = async (n) => {
    if (!n) return;
    setName(n); setError(''); setBusy(true);
    try { setResult((await api.get(`/areas/${encodeURIComponent(n)}/incidents`)).data); }
    catch (e) { setError(errMsg(e)); setResult(null); }
    finally { setBusy(false); }
  };
  const bounds = useMemo(() => {
    try { return result?.area?.boundary ? L.geoJSON(result.area.boundary).getBounds() : null; } catch { return null; }
  }, [result]);
  const shown = list.slice(0, 120);

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_26rem]">
      <div className="glass min-w-0 overflow-hidden p-2">
        <BaseMap className="h-[520px] w-full rounded-[22px] xl:h-full xl:min-h-[560px]">
          <MapToolbar className="absolute left-5 top-5 z-[1000]" />
          {!result && list[0]?.bbox && <FitBounds bbox={[
            Math.min(...shown.map((z) => z.bbox?.[0] ?? 180)), Math.min(...shown.map((z) => z.bbox?.[1] ?? 90)),
            Math.max(...shown.map((z) => z.bbox?.[2] ?? -180)), Math.max(...shown.map((z) => z.bbox?.[3] ?? -90))]} maxZoom={12} />}
          {shown.map((z) => {
            const on = z.name === name;
            const style = { color: on ? '#2E9BFF' : '#9B8CFF', weight: on ? 3 : 1.5, dashArray: '6 6', fillOpacity: on ? 0.12 : 0.04 };
            if (z.boundary) return <GeoJSON key={z.name + on} data={z.boundary} eventHandlers={{ click: () => run(z.name) }} style={style}><Tooltip sticky>{z.name}</Tooltip></GeoJSON>;
            if (!Array.isArray(z.bbox) || !z.bbox.every(Number.isFinite)) return null;
            return (
              <Rectangle key={z.name + on} bounds={[[z.bbox[1], z.bbox[0]], [z.bbox[3], z.bbox[2]]]} pathOptions={style} eventHandlers={{ click: () => run(z.name) }}>
                <Tooltip sticky>{z.name}: {fmtNum(z.total)}</Tooltip>
              </Rectangle>
            );
          })}
          {bounds && <FitBounds bounds={bounds} />}
          {result && <IncidentMarkers items={result.items} />}
        </BaseMap>
      </div>
      <div className="space-y-4">
        <div className="glass p-5">
          <label className="label" htmlFor="zone">Area</label>
          <select id="zone" className="neu-field" value={name} onChange={(e) => run(e.target.value)}>
            <option value="">Choose an area, or click one on the map</option>
            {list.map((z) => <option key={z.name} value={z.name}>{z.name} ({fmtNum(z.total)})</option>)}
          </select>
          <p className="mt-3 text-xs text-ink-faint">
            Areas come from your data (for example a city column) or from built-in demonstration zones. A stored polygon uses $geoWithin on that shape; other areas use the box around their incidents.
          </p>
        </div>
        <ErrorBanner message={error || zones.error} />
        {busy && <Spinner label="Running $geoWithin" />}
        {result && !busy && (
          <div className="glass p-5">
            <p className="font-display text-4xl font-extrabold">{fmtNum(result.total)}</p>
            <p className="font-semibold">incidents inside {result.area?.name}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {SEVERITIES.map((sv) => (
                <div key={sv} className="flex items-center justify-between rounded-xl bg-white/70 px-3 py-2 text-sm">
                  <SeverityPill value={sv} /><span className="font-bold">{fmtNum(safeArr(result.items).filter((d) => d.severity === sv).length)}</span>
                </div>
              ))}
            </div>
            <ul className="mt-4 space-y-2">
              {safeArr(result.items).slice(0, 6).map((d) => (
                <li key={d._id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{d.incidentId}, {d.type}</span><StatusPill value={d.status} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Nearby() {
  const [mode, setMode] = useState('radius');
  const extent = useApi('/analytics/bounds');
  const start = toLatLng(extent.data?.center) || (extent.data || extent.error ? MYSURU : null);
  return (
    <div>
      <PageHeader
        title="Nearby search"
        subtitle="Find reported incidents around a point, ordered by distance, or everything inside an area boundary."
        actions={<Segmented value={mode} onChange={setMode} options={[{ value: 'radius', label: 'Within a radius' }, { value: 'zone', label: 'Inside an area' }]} />}
      />
      {mode === 'radius' ? (start ? <RadiusMode start={start} /> : <Spinner label="Finding your data" />) : <ZoneMode />}
      <p className="mt-4 flex items-center gap-2 text-xs text-ink-faint"><Crosshair className="h-3.5 w-3.5" /> Coordinates are sent to MongoDB as [longitude, latitude].</p>
    </div>
  );
}
