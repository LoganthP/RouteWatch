/**
 * APPROXIMATE demonstration zones for Mysuru.
 * Centres are rough locality positions; boundaries are simple boxes so the
 * project can demonstrate $geoWithin / $geoIntersects. They are NOT official
 * ward or municipal boundaries.
 * Format: [name, lat, lng]
 */
const ZONES = [
  ['Devaraja Mohalla', 12.3080, 76.6520],
  ['Vijayanagar', 12.3300, 76.6120],
  ['Gokulam', 12.3300, 76.6380],
  ['Jayalakshmipuram', 12.3400, 76.6260],
  ['Kuvempunagar', 12.2860, 76.6330],
  ['Saraswathipuram', 12.3060, 76.6270],
  ['Bannimantap', 12.3350, 76.6650],
  ['Nazarbad', 12.3060, 76.6690],
  ['Hebbal', 12.3550, 76.6150],
  ['Hootagalli', 12.3420, 76.5900],
  ['Ramakrishnanagar', 12.2850, 76.6080],
  ['JP Nagar', 12.2700, 76.6450],
  ['Siddhartha Layout', 12.2900, 76.6700],
  ['Udayagiri', 12.3300, 76.6900],
  ['Metagalli', 12.3620, 76.6400],
];

const HALF = 0.008; // ~0.9 km half-width boxes

function box(lat, lng, h = HALF) {
  return [[
    [lng - h, lat - h], [lng + h, lat - h], [lng + h, lat + h], [lng - h, lat + h], [lng - h, lat - h],
  ]];
}

const areaDocs = ZONES.map(([name, lat, lng]) => ({
  name,
  kind: 'Locality',
  center: [lng, lat],
  boundary: { type: 'Polygon', coordinates: box(lat, lng) },
}));

/** Fast in-memory assignment used by the seeder (mirrors $geoIntersects + nearest centre). */
function zoneFor(lng, lat) {
  let best = null;
  let bestD = Infinity;
  for (const [name, zl, zg] of ZONES) {
    if (Math.abs(lat - zl) <= HALF && Math.abs(lng - zg) <= HALF) {
      const d = (lat - zl) ** 2 + (lng - zg) ** 2;
      if (d < bestD) { bestD = d; best = name; }
    }
  }
  return best; // null when outside every demo zone
}

module.exports = { ZONES, areaDocs, zoneFor, HALF };
