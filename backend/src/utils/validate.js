const { INCIDENT_TYPES, SEVERITIES, STATUSES } = require('../config/constants');

function httpError(status, message, extra, code) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  if (extra) e.extra = extra;
  return e;
}

function parseLngLat(lng, lat) {
  const x = Number(lng);
  const y = Number(lat);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw httpError(400, 'lng and lat must be numbers.');
  if (x < -180 || x > 180) throw httpError(400, 'Longitude must be between -180 and 180.');
  if (y < -90 || y > 90) throw httpError(400, 'Latitude must be between -90 and 90.');
  return [x, y];
}

/** Validates an incident payload. partial=true for PATCH. Returns a clean object. */
function validateIncident(body, { partial = false } = {}) {
  const out = {};
  const errors = [];

  if (!partial || body.type !== undefined) {
    if (!INCIDENT_TYPES.includes(body.type)) errors.push(`type must be one of: ${INCIDENT_TYPES.join(', ')}`);
    else out.type = body.type;
  }
  if (!partial || body.severity !== undefined) {
    if (!SEVERITIES.includes(body.severity)) errors.push(`severity must be one of: ${SEVERITIES.join(', ')}`);
    else out.severity = body.severity;
  }
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) errors.push(`status must be one of: ${STATUSES.join(', ')}`);
    else out.status = body.status;
  }
  if (body.description !== undefined) {
    const d = String(body.description).trim();
    if (d.length > 500) errors.push('description must be 500 characters or fewer');
    out.description = d;
  }
  if (body.area !== undefined && String(body.area).trim()) out.area = String(body.area).trim();

  // Accept either GeoJSON location or plain lng/lat
  const coords = body.location?.coordinates ?? (body.lng !== undefined ? [body.lng, body.lat] : undefined);
  if (!partial || coords !== undefined) {
    try {
      out.location = { type: 'Point', coordinates: parseLngLat(coords?.[0], coords?.[1]) };
    } catch (e) {
      errors.push(e.message);
    }
  }

  if (body.reportedAt !== undefined) {
    const t = new Date(body.reportedAt); // string → BSON Date
    if (isNaN(t)) errors.push('reportedAt must be a valid date');
    else if (t.getTime() > Date.now() + 5 * 60 * 1000) errors.push('reportedAt cannot be in the future');
    else out.reportedAt = t;
  } else if (!partial) {
    out.reportedAt = new Date();
  }

  if (errors.length) {
    const e = httpError(400, errors.join('; '));
    e.errors = errors;
    throw e;
  }
  return out;
}

module.exports = { validateIncident, parseLngLat, httpError };
