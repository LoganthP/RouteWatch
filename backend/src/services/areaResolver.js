const Area = require('../models/Area');
const { areaLabel } = require('./geo');

/**
 * Name the area for a point: a stored named polygon ($geoIntersects) wins,
 * otherwise an offline label from the nearest major city, otherwise a grid label.
 */
async function resolveArea([lng, lat]) {
  try {
    const hits = await Area.find({
      boundary: { $geoIntersects: { $geometry: { type: 'Point', coordinates: [lng, lat] } } },
    }).lean();
    if (hits.length) {
      hits.sort((a, b) =>
        (a.center[0] - lng) ** 2 + (a.center[1] - lat) ** 2 - ((b.center[0] - lng) ** 2 + (b.center[1] - lat) ** 2));
      return hits[0].name;
    }
  } catch { /* fall through */ }
  return areaLabel(lng, lat);
}

module.exports = { resolveArea };
