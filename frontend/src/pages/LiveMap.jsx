import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GeoJSON, Rectangle, Tooltip } from 'react-leaflet';
import { Layers, ScanSearch } from 'lucide-react';
import useApi, { useLiveRefresh } from '../lib/useApi';
import FilterBar from '../components/FilterBar';
import { BaseMap, ClusterMarkers, FitBounds, HeatLayer, IncidentMarkers, Legend, MapToolbar, ViewportWatcher } from '../components/MapParts';
import { ErrorBanner } from '../components/ui';
import { emptyFilters, toParams } from '../lib/constants';
import { fmtNum } from '../lib/format';
import { safeArr } from '../lib/safe';

const LAYERS = [
  { key: 'markers', label: 'Incidents' },
  { key: 'heat', label: 'Density heatmap' },
  { key: 'grid', label: 'Hotspot grid' },
  { key: 'zones', label: 'Area outlines' },
];

export default function LiveMap() {
  const [sp] = useSearchParams();
  const [filters, setFilters] = useState(() => emptyFilters({ dataset: sp.get('dataset') || '' }));
  const [layers, setLayers] = useState({ markers: true, heat: false, grid: false, zones: false });
  const [visibleOnly, setVisibleOnly] = useState(false);
  const [view, setView] = useState(null); // { bbox, zoom }
  const params = toParams(filters);
  const scoped = visibleOnly && view ? { ...params, bbox: view.bbox } : params;

  const extent = useApi('/analytics/bounds', params);
  // markers always follow the viewport so zooming in loads the detail you are looking at
  const markers = useApi('/incidents/map', view ? { ...params, bbox: view.bbox, zoom: view.zoom, limit: 2500 } : null, { skip: !layers.markers || !view });
  const heat = useApi('/analytics/heatmap', scoped, { skip: !layers.heat });
  const grid = useApi('/analytics/hotspots', view ? { ...params, bbox: view.bbox, limit: 600 } : null, { skip: !layers.grid || !view });
  const zones = useApi('/areas', { ...params, limit: 80 }, { skip: !layers.zones });
  const visible = useApi('/analytics/summary', scoped, { skip: !visibleOnly || !view });
  useLiveRefresh(() => { markers.reload(); extent.reload(); });

  const maxCount = Math.max(1, ...safeArr(grid.data?.cells).map((c) => c.count || 0));
  const fitKey = useMemo(() => extent.data?.bbox, [extent.data]);
  const isClusters = markers.data?.mode === 'clusters';

  return (
    <div className="relative h-[calc(100vh-7.5rem)] min-h-[560px] lg:h-[calc(100vh-4rem)]">
      <div className="glass h-full overflow-hidden !rounded-[32px] p-2">
        <BaseMap zoomPosition="bottomleft" className="h-full w-full rounded-[26px]">
          <ViewportWatcher onChange={setView} />
          {fitKey && <FitBounds bbox={fitKey} maxZoom={14} />}
          <MapToolbar dataBbox={fitKey} className="absolute right-4 top-4 z-[1000]" />
          {layers.zones && safeArr(zones.data).map((z) => (z.boundary ? (
            <GeoJSON key={`b-${z.name}`} data={z.boundary} style={{ color: '#9B8CFF', weight: 2, dashArray: '5 6', fillColor: '#9B8CFF', fillOpacity: 0.06 }}>
              <Tooltip sticky>{z.name}: {fmtNum(z.total)} incidents</Tooltip>
            </GeoJSON>
          ) : Array.isArray(z.bbox) && z.bbox.every(Number.isFinite) && (
            <Rectangle key={`r-${z.name}`} bounds={[[z.bbox[1], z.bbox[0]], [z.bbox[3], z.bbox[2]]]} pathOptions={{ color: '#9B8CFF', weight: 1.5, dashArray: '5 6', fillOpacity: 0.04 }}>
              <Tooltip sticky>{z.name}: {fmtNum(z.total)} incidents</Tooltip>
            </Rectangle>
          )))}
          {layers.grid && safeArr(grid.data?.cells).map((c) => (
            <Rectangle key={c.center.join()} bounds={c.bounds}
              pathOptions={{ color: c.isHotspot ? '#FF4D6D' : '#FFFFFF', weight: c.isHotspot ? 2 : 0.5, fillColor: c.isHotspot ? '#FF4D6D' : '#FF8A3D', fillOpacity: 0.12 + 0.55 * (c.count / maxCount) }}>
              <Tooltip>{fmtNum(c.count)} reports{c.isHotspot ? ', hotspot' : ''}<br />{safeArr(c.areas).join(', ')}</Tooltip>
            </Rectangle>
          ))}
          {layers.heat && <HeatLayer points={heat.data} />}
          {layers.markers && markers.data && (isClusters ? <ClusterMarkers items={markers.data.items} /> : <IncidentMarkers items={markers.data.items} />)}
        </BaseMap>
      </div>

      <div className="pointer-events-none absolute inset-y-4 left-4 z-[600] flex w-[min(86%,22rem)] flex-col gap-3">
        <div className="glass-strong scroll-thin pointer-events-auto max-h-full overflow-y-auto p-5">
          <h1 className="text-2xl font-extrabold">Live map</h1>
          <p className="mb-4 text-sm text-ink-soft">
            {!markers.data ? 'Loading incidents in view…'
              : isClusters ? `${fmtNum(markers.data.total)} incidents in view, grouped. Zoom in to see each one.`
                : `${fmtNum(safeArr(markers.data.items).length)} incidents in view${markers.data.limited ? ' (latest 2,500)' : ''}.`}
          </p>
          <ErrorBanner message={markers.error || heat.error || grid.error || extent.error} />

          <button type="button" data-on={visibleOnly} aria-pressed={visibleOnly} onClick={() => setVisibleOnly((v) => !v)}
            className="neu-chip mb-4 inline-flex w-full items-center justify-center gap-2 py-2.5">
            <ScanSearch className="h-4 w-4 text-sky" /> {visibleOnly ? 'Analyzing the visible area' : 'Analyze the visible area only'}
          </button>
          {visibleOnly && visible.data && (
            <div className="mb-4 grid grid-cols-3 gap-2 text-center">
              {[['In view', visible.data.total, '#2E9BFF'], ['High+', visible.data.highSeverity, '#FF4D6D'], ['Hotspots', visible.data.hotspotZones, '#FF8A3D']].map(([l, v, c]) => (
                <div key={l} className="rounded-2xl bg-white/70 px-2 py-2 shadow-clay-white">
                  <p className="font-display text-xl font-extrabold" style={{ color: c }}>{fmtNum(v)}</p>
                  <p className="text-[11px] font-bold text-ink-soft">{l}</p>
                </div>
              ))}
            </div>
          )}

          <p className="label flex items-center gap-1.5"><Layers className="h-4 w-4" /> Layers</p>
          <div className="mb-5 flex flex-wrap gap-2">
            {LAYERS.map((l) => (
              <button key={l.key} type="button" className="neu-chip" data-on={layers[l.key]} aria-pressed={layers[l.key]}
                onClick={() => setLayers((st) => ({ ...st, [l.key]: !st[l.key] }))}>{l.label}</button>
            ))}
          </div>
          {layers.grid && grid.data && (
            <p className="mb-4 rounded-2xl bg-coral-soft/70 px-3 py-2 text-xs font-semibold">
              {grid.data.cellSizeKm} km cells for this view. Red outlines are hotspots: at least {grid.data.threshold} reports (mean {grid.data.mean}, standard deviation {grid.data.stdDev}).
            </p>
          )}
          <FilterBar value={filters} onChange={setFilters} compact defaultOpen={!!filters.dataset} />
        </div>
      </div>
      <Legend className="absolute bottom-6 right-6 z-[600]" />
    </div>
  );
}
