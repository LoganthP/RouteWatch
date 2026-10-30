/**
 * Global geo helpers: viewport boxes, time zones, and human-readable area names.
 * Nothing here is tied to one city.
 */
const tzlookup = require('tz-lookup');

const isLat = (v) => Number.isFinite(v) && v >= -90 && v <= 90;
const isLng = (v) => Number.isFinite(v) && v >= -180 && v <= 180;

function tzFor(lng, lat) {
  try { return tzlookup(lat, lng); } catch { return 'UTC'; }
}

/** "w,s,e,n" → {w,s,e,n} or null. Clamps to valid ranges. */
function parseBbox(str) {
  if (!str) return null;
  const p = String(str).split(',').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isFinite(x))) return null;
  let [w, s, e, n] = p;
  s = Math.max(-90, Math.min(90, s)); n = Math.max(-90, Math.min(90, n));
  if (s >= n) return null;
  if (e - w >= 360) { w = -180; e = 180; }
  const wrap = (x) => ((((x + 180) % 360) + 360) % 360) - 180;
  if (!(w === -180 && e === 180)) { w = wrap(w); e = wrap(e); if (e === -180) e = 180; }
  return { w, s, e, n };
}

const ring = (w, s, e, n) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];

/**
 * Bounding box → $geoWithin query using GeoJSON polygons (indexed by 2dsphere).
 * Boxes crossing the antimeridian are split in two. Very wide boxes are split
 * into <180° slices because 2dsphere polygons must be smaller than a hemisphere.
 */
function bboxQuery(b) {
  if (!b) return null;
  const spans = b.w <= b.e ? [[b.w, b.e]] : [[b.w, 180], [-180, b.e]];
  const slices = [];
  for (const [a, z] of spans) {
    const width = z - a;
    const parts = Math.max(1, Math.ceil(width / 90));
    for (let i = 0; i < parts; i++) {
      slices.push([a + (width * i) / parts, a + (width * (i + 1)) / parts]);
    }
  }
  // keep polygons a hair inside the poles to avoid degenerate edges
  const s = Math.max(b.s, -89.9);
  const n = Math.min(b.n, 89.9);
  const geometry = slices.length === 1
    ? { type: 'Polygon', coordinates: ring(slices[0][0], s, slices[0][1], n) }
    : { type: 'MultiPolygon', coordinates: slices.map(([a, z]) => ring(a, s, z, n)) };
  return { $geoWithin: { $geometry: geometry } };
}

/** Major world cities used to name areas when a dataset has no area column. */
const CITIES = [
  ['Mysuru', 12.2958, 76.6394], ['Bengaluru', 12.9716, 77.5946], ['Chennai', 13.0827, 80.2707],
  ['Hyderabad', 17.385, 78.4867], ['Mumbai', 19.076, 72.8777], ['Pune', 18.5204, 73.8567],
  ['Delhi', 28.6139, 77.209], ['Kolkata', 22.5726, 88.3639], ['Ahmedabad', 23.0225, 72.5714],
  ['Kochi', 9.9312, 76.2673], ['Coimbatore', 11.0168, 76.9558], ['Mangaluru', 12.9141, 74.856],
  ['Jaipur', 26.9124, 75.7873], ['Lucknow', 26.8467, 80.9462], ['Colombo', 6.9271, 79.8612],
  ['Dhaka', 23.8103, 90.4125], ['Karachi', 24.8607, 67.0011], ['Dubai', 25.2048, 55.2708],
  ['Riyadh', 24.7136, 46.6753], ['Istanbul', 41.0082, 28.9784], ['Cairo', 30.0444, 31.2357],
  ['Nairobi', -1.2921, 36.8219], ['Lagos', 6.5244, 3.3792], ['Johannesburg', -26.2041, 28.0473],
  ['London', 51.5074, -0.1278], ['Paris', 48.8566, 2.3522], ['Berlin', 52.52, 13.405],
  ['Madrid', 40.4168, -3.7038], ['Rome', 41.9028, 12.4964], ['Amsterdam', 52.3676, 4.9041],
  ['Moscow', 55.7558, 37.6173], ['Stockholm', 59.3293, 18.0686], ['Warsaw', 52.2297, 21.0122],
  ['New York', 40.7128, -74.006], ['Los Angeles', 34.0522, -118.2437], ['Chicago', 41.8781, -87.6298],
  ['Houston', 29.7604, -95.3698], ['Miami', 25.7617, -80.1918], ['San Francisco', 37.7749, -122.4194],
  ['Seattle', 47.6062, -122.3321], ['Toronto', 43.6532, -79.3832], ['Mexico City', 19.4326, -99.1332],
  ['Sao Paulo', -23.5505, -46.6333], ['Buenos Aires', -34.6037, -58.3816], ['Lima', -12.0464, -77.0428],
  ['Bogota', 4.711, -74.0721], ['Tokyo', 35.6762, 139.6503], ['Seoul', 37.5665, 126.978],
  ['Beijing', 39.9042, 116.4074], ['Shanghai', 31.2304, 121.4737], ['Hong Kong', 22.3193, 114.1694],
  ['Bangkok', 13.7563, 100.5018], ['Singapore', 1.3521, 103.8198], ['Jakarta', -6.2088, 106.8456],
  ['Manila', 14.5995, 120.9842], ['Kuala Lumpur', 3.139, 101.6869], ['Sydney', -33.8688, 151.2093],
  ['Melbourne', -37.8136, 144.9631], ['Auckland', -36.8485, 174.7633],
];

const toRad = (d) => (d * Math.PI) / 180;
function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(a));
}

const DIRS = ['North', 'North-east', 'East', 'South-east', 'South', 'South-west', 'West', 'North-west'];

/** Fast, offline area label: "Mysuru Central", "London North-east", or a grid label. */
function areaLabel(lng, lat) {
  let best = null;
  let bestD = Infinity;
  for (const [name, clat, clng] of CITIES) {
    if (Math.abs(clat - lat) > 1 || Math.abs(clng - lng) > 1.5) continue;
    const d = haversineKm(lat, lng, clat, clng);
    if (d < bestD) { bestD = d; best = [name, clat, clng]; }
  }
  if (best && bestD <= 40) {
    if (bestD < 2.5) return `${best[0]} Central`;
    const ang = (Math.atan2(lng - best[2], lat - best[1]) * 180) / Math.PI;
    return `${best[0]} ${DIRS[Math.round(((ang + 360) % 360) / 45) % 8]}`;
  }
  const f = (v, p, q) => `${Math.abs(v).toFixed(1)}${v >= 0 ? p : q}`;
  return `Grid ${f(lat, 'N', 'S')}, ${f(lng, 'E', 'W')}`;
}

module.exports = { isLat, isLng, tzFor, parseBbox, bboxQuery, CITIES, haversineKm, areaLabel };
