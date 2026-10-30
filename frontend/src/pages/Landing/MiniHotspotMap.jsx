import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { TILE_URL, TILE_ATTR } from '../../lib/constants';

// Sample fallback coordinates (Mysuru & Mumbai centers) for instant zero-dependency display
const SAMPLE_POINTS = [
  [12.3052, 76.6552, 0.9],
  [12.3082, 76.6592, 0.8],
  [12.3012, 76.6512, 0.7],
  [12.3122, 76.6622, 0.85],
  [12.2982, 76.6482, 0.6],
  [12.3065, 76.6535, 0.95],
];

export default function MiniHotspotMap() {
  const [points, setPoints] = useState(SAMPLE_POINTS);

  useEffect(() => {
    // Attempt to load real heatmap points from public endpoint or fallback
    fetch('/api/analytics/heatmap?limit=300')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setPoints(data.slice(0, 150));
        }
      })
      .catch(() => {});
  }, []);

  const center = points[0] ? [points[0][0], points[0][1]] : [12.3052, 76.6552];

  return (
    <div className="relative h-full w-full min-h-[220px] overflow-hidden rounded-2xl">
      <MapContainer
        center={center}
        zoom={12}
        zoomControl={false}
        attributionControl={false}
        scrollWheelZoom={false}
        dragging={false}
        className="h-full w-full"
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
        {points.slice(0, 40).map((pt, i) => (
          <CircleMarker
            key={i}
            center={[pt[0], pt[1]]}
            radius={pt[2] ? pt[2] * 12 : 8}
            pathOptions={{
              color: '#FF4D6D',
              fillColor: '#FF4D6D',
              fillOpacity: 0.45,
              weight: 1.5,
            }}
          />
        ))}
      </MapContainer>

      {/* Floating map legend badge */}
      <div className="glass-strong absolute bottom-2.5 left-2.5 z-[1000] px-2.5 py-1 text-[11px] font-bold text-ink shadow-sm">
        <span className="inline-block h-2 w-2 rounded-full bg-coral mr-1.5" />
        Density Hotspot (&gt;2σ threshold)
      </div>
    </div>
  );
}

