// Small guards so a missing or odd API value can never crash a page.
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const safeNum = (v, d = 0) => (isNum(Number(v)) && v !== null && v !== '' ? Number(v) : d);
export const safeArr = (v) => (Array.isArray(v) ? v : []);
export const safeFixed = (v, digits = 4, fallback = '—') => (isNum(Number(v)) && v !== null && v !== '' ? Number(v).toFixed(digits) : fallback);
export const isLatLng = (p) => Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
/** GeoJSON [lng, lat] → Leaflet [lat, lng], or null */
export const toLatLng = (c) => (Array.isArray(c) && isLatLng([c[1], c[0]]) ? [c[1], c[0]] : null);
/** [w, s, e, n] → Leaflet bounds [[s, w], [n, e]], or null */
export const bboxToBounds = (b) => {
  if (!Array.isArray(b) || b.length !== 4 || !b.every(isNum)) return null;
  const [w, s, e, n] = b;
  const pad = 0.01;
  return [[s - (n - s < 0.02 ? pad : 0), w - (e - w < 0.02 ? pad : 0)], [n + (n - s < 0.02 ? pad : 0), e + (e - w < 0.02 ? pad : 0)]];
};
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
