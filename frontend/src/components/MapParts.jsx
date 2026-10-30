import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import { Search, Maximize2, Loader2 } from 'lucide-react';
import L from '../lib/leaflet-setup';
import 'leaflet.heat';
import { SEV_COLOR, TILE_ATTR, TILE_URL, WORLD_VIEW } from '../lib/constants';
import { fmtDate, fmtNum } from '../lib/format';
import { bboxToBounds, isLatLng, toLatLng } from '../lib/safe';
import { SeverityPill, StatusPill } from './ui';

export function BaseMap({ center, zoom, bounds, className = '', children, zoomControl = true, zoomPosition = 'bottomright', ...rest }) {
  const init = isLatLng(center) ? { center, zoom: zoom ?? 13 } : WORLD_VIEW;
  const b = bounds ? bboxToBounds(bounds) : null;
  const [mapKey] = useState(() => 'map-' + Math.random().toString(36).slice(2, 9));
  return (
    <MapContainer
      key={mapKey}
      {...(b ? { bounds: b } : { center: init.center, zoom: init.zoom })}
      preferCanvas worldCopyJump minZoom={2} className={className} scrollWheelZoom zoomControl={false} {...rest}
    >
      <TileLayer url={TILE_URL} attribution={TILE_ATTR} maxZoom={19} />
      {zoomControl && <ZoomControl position={zoomPosition} />}
      {children}
    </MapContainer>
  );
}

/** Canvas circle markers for individual incidents (invalid coordinates are skipped). */
export function IncidentMarkers({ items, onSelect }) {
  return (items || []).map((d) => {
    const pos = toLatLng(d?.location?.coordinates);
    if (!pos) return null;
    return (
      <CircleMarker
        key={d._id || d.incidentId}
        center={pos}
        radius={d.severity === 'Critical' ? 8 : d.severity === 'High' ? 7 : 6}
        pathOptions={{ color: '#ffffff', weight: 1.5, fillColor: SEV_COLOR[d.severity] || '#2E9BFF', fillOpacity: 0.9 }}
        eventHandlers={onSelect ? { click: () => onSelect(d) } : undefined}
      >
        {!onSelect && (
          <Popup>
            <div className="min-w-[200px] space-y-1.5">
              <p className="font-display text-base font-bold text-ink">{d.type}</p>
              <p className="text-xs text-ink-soft">{d.incidentId} in {d.area}</p>
              <div className="flex gap-1.5"><SeverityPill value={d.severity} /><StatusPill value={d.status} /></div>
              {d.description && <p className="text-sm text-ink">{d.description}</p>}
              <p className="text-xs text-ink-faint">{fmtDate(d.reportedAt)}</p>
              {Number.isFinite(d.distance) && <p className="text-xs font-bold text-sky-deep">{Math.round(d.distance)} m away</p>}
            </div>
          </Popup>
        )}
      </CircleMarker>
    );
  });
}

/** Server-side grid clusters shown as numbered clay bubbles at low zoom. */
export function ClusterMarkers({ items }) {
  const map = useMap();
  const max = Math.max(1, ...(items || []).map((c) => c.count || 0));
  return (items || []).map((c, i) => {
    const pos = [c.lat, c.lng];
    if (!isLatLng(pos)) return null;
    const size = 26 + Math.round(26 * Math.sqrt((c.count || 1) / max));
    const icon = L.divIcon({
      className: '',
      iconSize: [size, size],
      html: `<div style="width:${size}px;height:${size}px;border-radius:999px;display:grid;place-items:center;font:700 ${size > 40 ? 13 : 11}px Manrope,sans-serif;color:#1E2A44;background:${SEV_COLOR[c.severity] || '#2E9BFF'};border:3px solid #fff;box-shadow:0 10px 18px -8px rgba(30,42,68,.55), inset 0 -3px 0 rgba(0,0,0,.12), inset 0 2px 0 rgba(255,255,255,.5)">${c.count >= 1000 ? `${(c.count / 1000).toFixed(c.count >= 10000 ? 0 : 1)}k` : c.count}</div>`,
    });
    return (
      <Marker key={`${c.lng}-${c.lat}-${i}`} position={pos} icon={icon}
        eventHandlers={{ click: () => map.flyTo(pos, Math.min(map.getZoom() + 3, 14), { duration: 0.6 }) }}>
        <Tooltip>{fmtNum(c.count)} incidents{c.critical ? `, ${fmtNum(c.critical)} critical` : ''}. Click to zoom in.</Tooltip>
      </Marker>
    );
  });
}

/** Leaflet.heat density layer. points: [[lat,lng,intensity], …] */
export function HeatLayer({ points, radius = 22, blur = 18 }) {
  const map = useMap();
  useEffect(() => {
    const pts = (points || []).filter((p) => isLatLng(p));
    if (!pts.length) return undefined;
    const layer = L.heatLayer(pts, {
      radius, blur, maxZoom: 16, minOpacity: 0.35,
      gradient: { 0.2: '#7FD3FF', 0.45: '#2BD9A6', 0.65: '#FFC93C', 0.82: '#FF8A3D', 1: '#FF4D6D' },
    }).addTo(map);
    return () => { map.removeLayer(layer); };
  }, [map, points, radius, blur]);
  return null;
}

export function ClickToPick({ onPick }) {
  useMapEvents({ click: (e) => onPick([e.latlng.lat, e.latlng.lng]) });
  return null;
}

export function FlyTo({ center, zoom }) {
  const map = useMap();
  const key = isLatLng(center) ? `${center[0].toFixed(5)},${center[1].toFixed(5)},${zoom}` : '';
  useEffect(() => {
    if (key) map.flyTo(center, zoom ?? map.getZoom(), { duration: 0.8 });
  }, [map, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Fit to [w,s,e,n] or Leaflet bounds, once per distinct value. */
export function FitBounds({ bbox, bounds, maxZoom = 15 }) {
  const map = useMap();
  const b = bounds || bboxToBounds(bbox);
  const key = b ? JSON.stringify(b.map ? b : [b.getSouthWest(), b.getNorthEast()]) : '';
  useEffect(() => {
    if (!b) return;
    try { map.fitBounds(b, { padding: [36, 36], maxZoom }); } catch { /* invalid bounds */ }
  }, [map, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Reports the visible box "w,s,e,n" and zoom after the user stops moving the map. */
export function ViewportWatcher({ onChange, delay = 400 }) {
  const map = useMap();
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    let t;
    const emit = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const b = map.getBounds();
        const w = Math.max(-180, b.getWest()); const e = Math.min(180, b.getEast());
        cb.current({ bbox: [w, b.getSouth(), e, b.getNorth()].map((v) => +v.toFixed(5)).join(','), zoom: map.getZoom() });
      }, delay);
    };
    map.on('moveend', emit);
    map.whenReady(emit);
    return () => { clearTimeout(t); map.off('moveend', emit); };
  }, [map, delay]);
  return null;
}

/** Floating toolbar: place search (any city) + fit to data. */
export function MapToolbar({ dataBbox, className = '' }) {
  const map = useMap();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const box = useRef(null);
  useEffect(() => { if (box.current) { L.DomEvent.disableClickPropagation(box.current); L.DomEvent.disableScrollPropagation(box.current); } }, []);

  useEffect(() => {
    if (q.trim().length < 3) { setResults([]); setMsg(''); return undefined; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setBusy(true); setMsg('');
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`, { signal: ctl.signal, headers: { Accept: 'application/json' } });
        const data = await r.json();
        setResults(Array.isArray(data) ? data : []);
        if (!data.length) setMsg('No places found.');
      } catch (e) { if (e.name !== 'AbortError') setMsg('Place search is unavailable right now.'); }
      finally { setBusy(false); }
    }, 500);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);

  const go = (r) => {
    const bb = (r.boundingbox || []).map(Number); // [s, n, w, e]
    if (bb.length === 4 && bb.every(Number.isFinite)) map.flyToBounds([[bb[0], bb[2]], [bb[1], bb[3]]], { maxZoom: 14, duration: 0.9 });
    else if (isLatLng([+r.lat, +r.lon])) map.flyTo([+r.lat, +r.lon], 13);
    setResults([]); setQ(r.display_name.split(',')[0]);
  };
  const fit = () => { const b = bboxToBounds(dataBbox); if (b) map.flyToBounds(b, { padding: [36, 36], maxZoom: 15, duration: 0.9 }); };

  return (
    <div ref={box} className={`w-[min(100%,20rem)] ${className}`}>
      <div className="glass-strong flex items-center gap-2 px-3 py-1.5">
        {busy ? <Loader2 className="h-4 w-4 animate-spin text-sky" /> : <Search className="h-4 w-4 text-sky" />}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any city or place" aria-label="Search a place"
          className="w-full bg-transparent py-1 text-sm font-semibold outline-none placeholder:text-ink-faint" />
        {dataBbox && (
          <button type="button" onClick={fit} title="Fit to data" aria-label="Fit map to data" className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white text-sky shadow-clay-white hover:text-sky-deep">
            <Maximize2 className="h-4 w-4" />
          </button>
        )}
      </div>
      {(results.length > 0 || msg) && (
        <ul className="glass-strong mt-2 max-h-64 overflow-auto p-1.5 text-sm">
          {msg && <li className="px-3 py-2 text-ink-soft">{msg}</li>}
          {results.map((r) => (
            <li key={r.place_id}>
              <button type="button" onClick={() => go(r)} className="w-full rounded-xl px-3 py-2 text-left hover:bg-sky-soft">
                <span className="font-bold">{r.display_name.split(',')[0]}</span>
                <span className="block truncate text-xs text-ink-soft">{r.display_name.split(',').slice(1).join(',')}</span>
              </button>
            </li>
          ))}
          <li className="px-3 pt-1 text-[10px] text-ink-faint">Search by OpenStreetMap Nominatim</li>
        </ul>
      )}
    </div>
  );
}

/** Road-sign-like pin used for picked locations */
export const pickIcon = L.divIcon({
  className: 'pin-drop',
  html: `<svg width="34" height="44" viewBox="0 0 34 44" xmlns="http://www.w3.org/2000/svg">
    <path d="M17 43C17 43 32 27 32 16.5C32 8 25.3 2 17 2S2 8 2 16.5C2 27 17 43 17 43Z" fill="#2E9BFF" stroke="#fff" stroke-width="3"/>
    <rect x="11" y="10.5" width="12" height="12" rx="2" transform="rotate(45 17 16.5)" fill="#FFC93C" stroke="#1E2A44" stroke-width="2"/>
  </svg>`,
  iconSize: [34, 44],
  iconAnchor: [17, 43],
});

export function Legend({ className = '' }) {
  return (
    <div className={`glass-strong flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-xs font-bold ${className}`}>
      {Object.entries(SEV_COLOR).map(([k, c]) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full ring-2 ring-white" style={{ background: c }} /> {k}
        </span>
      ))}
    </div>
  );
}

/** Data extent for the current filters → [w,s,e,n] */
export function useBboxMemo(data) {
  return useMemo(() => (Array.isArray(data?.bbox) && data.bbox.every(Number.isFinite) ? data.bbox : null), [data]);
}
