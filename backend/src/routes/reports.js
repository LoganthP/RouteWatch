const router = require('express').Router();
const PDFDocument = require('pdfkit');
const Incident = require('../models/Incident');
const { asyncHandler } = require('../middleware/error');
const { buildMatch } = require('../utils/filters');
const A = require('../services/analytics');

const esc = (v) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/* GET /api/reports/csv — streams every matching incident as CSV */
router.get('/csv', asyncHandler(async (req, res) => {
  const match = buildMatch(req.query);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="routewatch-incidents-${Date.now()}.csv"`);
  res.write('incidentId,type,severity,status,area,longitude,latitude,reportedAt,resolvedAt,source,description\n');
  const cursor = Incident.find(match).sort({ reportedAt: -1 }).lean().cursor();
  for await (const d of cursor) {
    res.write([
      d.incidentId, d.type, d.severity, d.status, d.area,
      d.location.coordinates[0], d.location.coordinates[1],
      d.reportedAt?.toISOString(), d.resolvedAt?.toISOString() || '', d.source, d.description,
    ].map(esc).join(',') + '\n');
  }
  res.end();
}));

/* GET /api/reports/pdf — summary report with key tables */
router.get('/pdf', asyncHandler(async (req, res) => {
  const [sum, areas, recent] = await Promise.all([
    A.summary(req.query),
    A.areas({ ...req.query, limit: 10 }),
    Incident.find(buildMatch(req.query)).sort({ reportedAt: -1 }).limit(25).lean(),
  ]);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="routewatch-report-${Date.now()}.pdf"`);
  const doc = new PDFDocument({ margin: 48, size: 'A4' });
  doc.pipe(res);

  const ink = '#1E2A44';
  const sky = '#2E9BFF';
  doc.fillColor(sky).fontSize(22).text('RouteWatch incident report');
  doc.fillColor('#5B6B8C').fontSize(10).text(`Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`);
  const f = Object.entries(req.query).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(', ');
  doc.text(f ? `Filters: ${f}` : 'Filters: none (all incidents)');
  doc.moveDown();

  doc.fillColor(ink).fontSize(14).text('Summary');
  doc.fontSize(11)
    .text(`Total incidents: ${sum.total}`)
    .text(`High or critical severity: ${sum.highSeverity}`)
    .text(`Active (pending or verified): ${sum.active}`)
    .text(`Hotspot zones (grid cells > 2 std-dev above mean): ${sum.hotspotZones}`)
    .text(`Average resolution time: ${sum.avgResolutionHours ?? 'n/a'} hours`);
  doc.moveDown();

  doc.fontSize(14).text('Severity distribution');
  doc.fontSize(11);
  sum.bySeverity.forEach((s) => doc.text(`${s.severity}: ${s.total}`));
  doc.moveDown();

  doc.fontSize(14).text('Areas with the most reports');
  doc.fontSize(10);
  areas.forEach((a, i) =>
    doc.text(`${i + 1}. ${a.area} — ${a.total} incidents (critical ${a.critical}, high ${a.high}), avg severity ${a.avgSeverity}`)
  );
  doc.moveDown();

  doc.fontSize(14).text('Most recent incidents');
  doc.fontSize(9);
  recent.forEach((d) =>
    doc.text(`${d.incidentId}  ${d.reportedAt.toISOString().slice(0, 16).replace('T', ' ')}  ${d.type} / ${d.severity} / ${d.status}  ${d.area}`)
  );
  doc.moveDown();
  doc.fillColor('#8592AD').fontSize(8).text(
    'Note: a high count of reports in an area does not by itself prove a road is more dangerous; traffic volume and reporting coverage also affect these numbers. Seeded data is synthetic.'
  );
  doc.end();
}));

module.exports = router;
