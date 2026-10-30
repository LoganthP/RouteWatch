"""Analytics, areas, exports and audit log."""
import csv
import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response, StreamingResponse

from . import analytics as A
from .auth import admin_only
from .db import C
from .geo import bbox_query
from .util import HttpError, build_match, clamp, iso, jresp, num_or, parse_lnglat, qd

router = APIRouter(prefix="/api")


# ---------------------------------------------------------------- analytics
for _name, _fn in (("summary", A.summary), ("hotspots", A.hotspots), ("temporal", A.temporal), ("severity", A.severity),
                   ("areas", A.areas), ("heatmap", A.heatmap), ("bounds", A.bounds)):
    def _make(fn):
        def handler(request: Request):
            return jresp(fn(qd(request)))
        return handler
    router.add_api_route(f"/analytics/{_name}", _make(_fn), methods=["GET"])


@router.get("/analytics/performance")
def performance(request: Request):
    q = qd(request)
    if q.get("lng") is not None and q.get("lat") is not None:
        lng, lat = parse_lnglat(q["lng"], q["lat"])
    else:
        c = A.bounds({}).get("center")
        lng, lat = c if c else (76.6394, 12.2958)
    radius = clamp(num_or(q.get("radius"), 2000), 100, 20000)
    return jresp(A.compare(lng, lat, radius))


# ---------------------------------------------------------------- areas
@router.get("/areas")
def list_areas(request: Request):
    """Areas come from the data itself (any city or country); stored polygons are attached when they exist."""
    q = qd(request)
    dynamic = A.areas({**q, "limit": num_or(q.get("limit"), 300)})
    stored = {a["name"]: a for a in C.areas.find()}
    return jresp([{"name": d["area"], "total": d["total"], "center": d["center"], "bbox": d["bbox"],
                   "boundary": (stored.get(d["area"]) or {}).get("boundary")} for d in dynamic])


@router.get("/areas/{name:path}/incidents")
def area_incidents(name: str, request: Request):
    q = qd(request)
    stored = C.areas.find_one({"name": name})
    if stored:
        boundary, bbox = stored["boundary"], None
        match = {**build_match(q), "location": {"$geoWithin": {"$geometry": boundary}}}
    else:
        info = A.areas({**q, "area": name, "limit": 1})
        if not info:
            raise HttpError(404, f'No incidents found for area "{name}".')
        bbox, pad = info[0]["bbox"], 0.002
        w, s, e, n = bbox
        boundary = {"type": "Polygon", "coordinates": [[[w - pad, s - pad], [e + pad, s - pad], [e + pad, n + pad], [w - pad, n + pad], [w - pad, s - pad]]]}
        match = {**build_match(q), "location": bbox_query({"w": w - pad, "s": s - pad, "e": e + pad, "n": n + pad})}
    items = list(C.incidents.find(match).sort("reportedAt", -1).limit(1500))
    return jresp({"area": {"name": name, "boundary": boundary, "bbox": bbox, "stored": bool(stored)}, "items": items, "total": C.incidents.count_documents(match)})


# ---------------------------------------------------------------- audit
@router.get("/audit")
def audit_log(request: Request, user=Depends(admin_only)):
    q = qd(request)
    flt = {"incidentId": q["incidentId"]} if q.get("incidentId") else {}
    return jresp(list(C.auditlogs.find(flt).sort("createdAt", -1).limit(int(min(num_or(q.get("limit"), 100), 500)))))


# ---------------------------------------------------------------- exports
@router.get("/reports/csv")
def export_csv(request: Request):
    match = build_match(qd(request))
    header = ["incidentId", "type", "severity", "status", "area", "longitude", "latitude", "reportedAt", "resolvedAt", "source", "description"]

    def rows():
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\n")
        w.writerow(header)
        yield buf.getvalue()
        for d in C.incidents.find(match).sort("reportedAt", -1):
            buf.seek(0)
            buf.truncate()
            co = (d.get("location") or {}).get("coordinates") or ["", ""]
            w.writerow([d.get("incidentId"), d.get("type"), d.get("severity"), d.get("status"), d.get("area"), co[0], co[1],
                        iso(d["reportedAt"]) if d.get("reportedAt") else "", iso(d["resolvedAt"]) if d.get("resolvedAt") else "", d.get("source"), d.get("description")])
            yield buf.getvalue()

    return StreamingResponse(rows(), media_type="text/csv; charset=utf-8", headers={
        "Content-Disposition": f'attachment; filename="routewatch-incidents-{int(datetime.now().timestamp() * 1000)}.csv"'})


def _pdf(q):
    from fpdf import FPDF
    s_ = lambda t: str(t).encode("latin-1", "replace").decode("latin-1")  # built-in PDF fonts are Latin-1 only
    summ, areas = A.summary(q), A.areas({**q, "limit": 10})
    recent = list(C.incidents.find(build_match(q)).sort("reportedAt", -1).limit(25))
    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(True, 15)
    pdf.add_page()

    def line(text, size=10, bold=False, color=(30, 42, 68), gap=0):
        pdf.set_font("Helvetica", "B" if bold else "", size)
        pdf.set_text_color(*color)
        pdf.multi_cell(0, size * 0.55 + 1, s_(text), new_x="LMARGIN", new_y="NEXT")
        pdf.ln(gap)

    line("RouteWatch incident report", 20, True, (46, 155, 255), 1)
    line(f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')} UTC", 10, False, (91, 107, 140))
    f = ", ".join(f"{k}={v}" for k, v in q.items() if v)
    line(f"Filters: {f}" if f else "Filters: none (all incidents)", 10, False, (91, 107, 140), 4)
    line("Summary", 14, True, gap=1)
    for t in (f"Total incidents: {summ['total']}", f"High or critical severity: {summ['highSeverity']}", f"Active (pending or verified): {summ['active']}",
              f"Hotspot zones (grid cells > 2 std-dev above mean): {summ['hotspotZones']}", f"Average resolution time: {summ['avgResolutionHours'] if summ['avgResolutionHours'] is not None else 'n/a'} hours"):
        line(t, 11)
    line("Severity distribution", 14, True, gap=1)
    for s in summ["bySeverity"]:
        line(f"{s['severity']}: {s['total']}", 11)
    pdf.ln(3)
    line("Areas with the most reports", 14, True, gap=1)
    for i, a in enumerate(areas, 1):
        line(f"{i}. {a['area']} - {a['total']} incidents (critical {a['critical']}, high {a['high']}), avg severity {a['avgSeverity']}", 10)
    pdf.ln(3)
    line("Most recent incidents", 14, True, gap=1)
    for d in recent:
        line(f"{d.get('incidentId')}  {iso(d['reportedAt'])[:16].replace('T', ' ')}  {d.get('type')} / {d.get('severity')} / {d.get('status')}  {d.get('area')}", 9)
    pdf.ln(3)
    line("Note: a high count of reports in an area does not by itself prove a road is more dangerous; traffic volume and reporting coverage also affect these numbers. Seeded data is synthetic.", 8, False, (133, 146, 173))
    return bytes(pdf.output())


@router.get("/reports/pdf")
def export_pdf(request: Request):
    data = _pdf(qd(request))
    return Response(data, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="routewatch-report-{int(datetime.now().timestamp() * 1000)}.pdf"'})
