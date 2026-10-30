const mongoose = require('mongoose');
const { INCIDENT_TYPES, SEVERITIES, STATUSES } = require('../config/constants');
const { parseBbox, bboxQuery } = require('../services/geo');

const list = (v, allowed) =>
  String(v || '').split(',').map((s) => s.trim()).filter((s) => s && allowed.includes(s));

/**
 * Query-string filters → MongoDB match document. Shared by every list, map,
 * analytics, ML and export endpoint so all views answer the same question.
 */
function buildMatch(q = {}) {
  const match = {};
  const types = list(q.type, INCIDENT_TYPES);
  const sev = list(q.severity, SEVERITIES);
  const st = list(q.status, STATUSES);
  if (types.length) match.type = { $in: types };
  if (sev.length) match.severity = { $in: sev };
  if (st.length) match.status = { $in: st };
  if (q.area) match.area = String(q.area);

  if (q.dataset) {
    if (q.dataset === 'none') match.datasetId = { $exists: false };
    else if (mongoose.isValidObjectId(q.dataset)) match.datasetId = new mongoose.Types.ObjectId(String(q.dataset));
  }

  if (q.from || q.to) {
    const r = {};
    if (q.from && !isNaN(Date.parse(q.from))) r.$gte = new Date(q.from);
    if (q.to && !isNaN(Date.parse(q.to))) {
      const to = new Date(q.to);
      if (/^\d{4}-\d{2}-\d{2}$/.test(q.to)) to.setUTCHours(23, 59, 59, 999);
      r.$lte = to;
    }
    if (Object.keys(r).length) match.reportedAt = r;
  }

  const box = bboxQuery(parseBbox(q.bbox));
  if (box) match.location = box;

  if (q.search) {
    const rx = new RegExp(String(q.search).slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    match.$or = [{ incidentId: rx }, { description: rx }, { area: rx }];
  }
  return match;
}

module.exports = { buildMatch };
