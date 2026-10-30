/**
 * Address → coordinates via OpenStreetMap Nominatim, respecting its usage policy:
 * max 1 request/second, identifying User-Agent, and a permanent cache.
 */
const GeoCache = require('../../models/GeoCache');

let last = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geocode(address) {
  const key = String(address).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!key) return null;
  const hit = await GeoCache.findOne({ key }).lean();
  if (hit) return hit.found ? [hit.lng, hit.lat] : null;

  const wait = 1100 - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const contact = process.env.GEOCODE_EMAIL ? ` (${process.env.GEOCODE_EMAIL})` : '';
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': `RouteWatch-academic/2.0${contact}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null; // do not cache transient failures
    const data = await res.json();
    const found = Array.isArray(data) && data[0];
    const doc = found ? { key, lng: Number(data[0].lon), lat: Number(data[0].lat), found: true } : { key, found: false };
    await GeoCache.updateOne({ key }, doc, { upsert: true });
    return found ? [doc.lng, doc.lat] : null;
  } catch {
    return null;
  }
}

module.exports = { geocode };
