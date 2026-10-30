"""MongoDB aggregation pipelines behind the dashboard, maps and charts."""
import math

from . import config as cfg
from .db import C
from .geo import parse_bbox
from .util import build_match, clamp, jsnum, num_or

SEVERITIES = cfg.SEVERITIES
LNG = {"$arrayElemAt": ["$location.coordinates", 0]}
LAT = {"$arrayElemAt": ["$location.coordinates", 1]}
SEV_WEIGHT_EXPR = {"$switch": {"branches": [
    {"case": {"$eq": ["$severity", "Critical"]}, "then": 4},
    {"case": {"$eq": ["$severity", "High"]}, "then": 3},
    {"case": {"$eq": ["$severity", "Medium"]}, "then": 2}], "default": 1}}
DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
HEAT_W = {"Low": 0.35, "Medium": 0.55, "High": 0.8, "Critical": 1}


def sev_counters():
    return {s.lower(): {"$sum": {"$cond": [{"$eq": ["$severity", s]}, 1, 0]}} for s in SEVERITIES}


def _agg(pipeline):
    return list(C.incidents.aggregate(pipeline, allowDiskUse=True))


def _count(rows):
    return rows[0]["n"] if rows else 0


def cell_size(q):
    """Grid cell in degrees: explicit `cell`, else ~40 columns across the viewport, else from zoom."""
    c = jsnum(q.get("cell"))
    if c and c > 0:
        return clamp(c, 0.0005, 10)
    b = parse_bbox(q.get("bbox"))
    if b:
        width = b["e"] - b["w"] if b["w"] <= b["e"] else 360 - (b["w"] - b["e"])
        return clamp(width / 40, 0.001, 10)
    z = jsnum(q.get("zoom"))
    if z is not None:
        return clamp(360 / 2 ** z / 6, 0.001, 10)
    return 0.005


def hotspots(q):
    """Statistical baseline: grid-cell density; a cell is a hotspot when it is > 2 standard deviations above the mean."""
    match = build_match(q)
    cell = cell_size(q)
    limit = int(clamp(num_or(q.get("limit"), 300), 1, 2000))
    cells = _agg([
        {"$match": match},
        {"$project": {"severity": 1, "area": 1, "x": {"$floor": {"$divide": [LNG, cell]}}, "y": {"$floor": {"$divide": [LAT, cell]}}}},
        {"$group": {"_id": {"x": "$x", "y": "$y"}, "count": {"$sum": 1}, "score": {"$sum": SEV_WEIGHT_EXPR}, **sev_counters(), "areas": {"$addToSet": "$area"}}},
        {"$sort": {"count": -1}},
    ])
    n = len(cells) or 1
    mean = sum(c["count"] for c in cells) / n
    std = math.sqrt(sum((c["count"] - mean) ** 2 for c in cells) / n)
    threshold = max(5, math.ceil(mean + 2 * std))
    out = []
    for c in cells[:limit]:
        x, y = c["_id"]["x"], c["_id"]["y"]
        out.append({
            "center": [(x + 0.5) * cell, (y + 0.5) * cell],
            "bounds": [[y * cell, x * cell], [(y + 1) * cell, (x + 1) * cell]],
            "count": c["count"], "score": c["score"],
            "severity": {"low": c["low"], "medium": c["medium"], "high": c["high"], "critical": c["critical"]},
            "areas": c["areas"][:3], "isHotspot": c["count"] >= threshold,
        })
    return {
        "cellSizeDeg": round(cell, 5), "cellSizeKm": round(cell * 111.32, 2), "totalCells": len(cells),
        "mean": round(mean, 2), "stdDev": round(std, 2), "threshold": threshold,
        "hotspotCount": sum(1 for c in cells if c["count"] >= threshold), "cells": out,
    }


def summary(q):
    from datetime import datetime, timedelta, timezone
    match = build_match(q)
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    r = _agg([{"$match": match}, {"$facet": {
        "total": [{"$count": "n"}],
        "highSeverity": [{"$match": {"severity": {"$in": ["High", "Critical"]}}}, {"$count": "n"}],
        "active": [{"$match": {"status": {"$in": ["Pending", "Verified"]}}}, {"$count": "n"}],
        "pending": [{"$match": {"status": "Pending"}}, {"$count": "n"}],
        "lastWeek": [{"$match": {"reportedAt": {"$gte": week_ago}}}, {"$count": "n"}],
        "bySeverity": [{"$group": {"_id": "$severity", "total": {"$sum": 1}}}],
        "byStatus": [{"$group": {"_id": "$status", "total": {"$sum": 1}}}],
        "byType": [{"$group": {"_id": "$type", "total": {"$sum": 1}}}, {"$sort": {"total": -1}}],
        "avgResolution": [{"$match": {"status": "Resolved", "resolvedAt": {"$type": "date"}}},
                          {"$group": {"_id": None, "ms": {"$avg": {"$subtract": ["$resolvedAt", "$reportedAt"]}}}}],
    }}])
    r = r[0] if r else {}
    hs = hotspots(q)
    sev = {x["_id"]: x["total"] for x in r.get("bySeverity", [])}
    avg = r.get("avgResolution") or []
    return {
        "total": _count(r.get("total")), "highSeverity": _count(r.get("highSeverity")), "active": _count(r.get("active")),
        "pending": _count(r.get("pending")), "lastWeek": _count(r.get("lastWeek")), "hotspotZones": hs["hotspotCount"],
        "avgResolutionHours": round(avg[0]["ms"] / 3.6e6, 1) if avg and avg[0].get("ms") is not None else None,
        "bySeverity": [{"severity": s, "total": sev.get(s, 0)} for s in SEVERITIES],
        "byStatus": {x["_id"]: x["total"] for x in r.get("byStatus", [])},
        "byType": [{"type": x["_id"], "total": x["total"]} for x in r.get("byType", [])],
    }


def temporal(q):
    """Counts by hour / weekday / month / day, each incident in its own local time zone."""
    match = build_match(q)
    g = q.get("granularity") if q.get("granularity") in ("hour", "dayOfWeek", "month", "day", "weekhour") else "month"
    date = {"date": "$reportedAt", "timezone": cfg.TZ_EXPR}
    if g == "weekhour":
        rows = _agg([{"$match": match}, {"$group": {"_id": {"d": {"$dayOfWeek": date}, "h": {"$hour": date}}, "total": {"$sum": 1}}}])
        grid = [{"day": d, "hours": [0] * 24} for d in DAYS]
        for r in rows:
            grid[r["_id"]["d"] - 1]["hours"][r["_id"]["h"]] = r["total"]
        return {"granularity": g, "grid": grid, "max": max([r["total"] for r in rows], default=0)}
    key = ({"$hour": date} if g == "hour" else {"$dayOfWeek": date} if g == "dayOfWeek"
           else {"$dateToString": {"format": "%Y-%m-%d", **date}} if g == "day" else {"$dateToString": {"format": "%Y-%m", **date}})
    rows = _agg([{"$match": match}, {"$group": {"_id": key, "total": {"$sum": 1}, **sev_counters()}}, {"$sort": {"_id": 1}}])

    def shape(r, label):
        return {"label": label, "total": r["total"], "low": r["low"], "medium": r["medium"], "high": r["high"], "critical": r["critical"]}

    blank = lambda label: {"label": label, "total": 0, "low": 0, "medium": 0, "high": 0, "critical": 0}
    by = {r["_id"]: r for r in rows}
    if g == "hour":
        series = [shape(by[h], f"{h:02d}:00") if h in by else blank(f"{h:02d}:00") for h in range(24)]
    elif g == "dayOfWeek":
        series = [shape(by[i + 1], d) if (i + 1) in by else blank(d) for i, d in enumerate(DAYS)]
    else:
        series = [shape(r, r["_id"]) for r in rows if r["_id"]]
    return {"granularity": g, "series": series, "note": "Hours and days are in each incident's local time zone."}


def severity(q):
    match = build_match(q)
    r = _agg([{"$match": match}, {"$facet": {
        "distribution": [{"$group": {"_id": "$severity", "total": {"$sum": 1}}}],
        "byType": [{"$group": {"_id": "$type", "total": {"$sum": 1}, **sev_counters()}}, {"$sort": {"total": -1}}]}}])
    r = r[0] if r else {}
    dist = {d["_id"]: d["total"] for d in r.get("distribution", [])}
    return {"distribution": [{"severity": s, "total": dist.get(s, 0)} for s in SEVERITIES],
            "byType": [{"type": t["_id"], "total": t["total"], "low": t["low"], "medium": t["medium"], "high": t["high"], "critical": t["critical"]} for t in r.get("byType", [])]}


def areas(q):
    match = build_match(q)
    limit = int(clamp(num_or(q.get("limit"), 15), 1, 500))
    rows = _agg([
        {"$match": match},
        {"$group": {"_id": "$area", "total": {"$sum": 1}, **sev_counters(), "riskScore": {"$sum": SEV_WEIGHT_EXPR},
                    "lng": {"$avg": LNG}, "lat": {"$avg": LAT}, "w": {"$min": LNG}, "e": {"$max": LNG}, "s": {"$min": LAT}, "n": {"$max": LAT},
                    "resolvedMs": {"$avg": {"$cond": [{"$and": [{"$eq": ["$status", "Resolved"]}, {"$eq": [{"$type": "$resolvedAt"}, "date"]}]},
                                                         {"$subtract": ["$resolvedAt", "$reportedAt"]}, None]}}}},
        {"$sort": {"total": -1}}, {"$limit": limit}])
    return [{
        "area": r["_id"] or "Unassigned", "total": r["total"], "low": r["low"], "medium": r["medium"], "high": r["high"], "critical": r["critical"],
        "riskScore": r["riskScore"], "avgSeverity": round(r["riskScore"] / r["total"], 2) if r["total"] else 0,
        "avgResolutionHours": round(r["resolvedMs"] / 3.6e6, 1) if r.get("resolvedMs") else None,
        "center": [r["lng"], r["lat"]], "bbox": [r["w"], r["s"], r["e"], r["n"]],
    } for r in rows]


def heatmap(q):
    match = build_match(q)
    limit = int(clamp(num_or(q.get("limit"), 30000), 1, 60000))
    cur = C.incidents.find(match, {"location.coordinates": 1, "severity": 1, "_id": 0}).limit(limit)
    return [[d["location"]["coordinates"][1], d["location"]["coordinates"][0], HEAT_W.get(d.get("severity"), 0.4)]
            for d in cur if isinstance(d.get("location", {}).get("coordinates"), list)]


def bounds(q):
    match = build_match(q)
    r = _agg([{"$match": match}, {"$group": {"_id": None, "count": {"$sum": 1}, "w": {"$min": LNG}, "e": {"$max": LNG}, "s": {"$min": LAT}, "n": {"$max": LAT},
                                              "lng": {"$avg": LNG}, "lat": {"$avg": LAT}}}])
    if not r or not r[0]["count"]:
        return {"count": 0, "bbox": None, "center": None}
    r = r[0]
    return {"count": r["count"], "bbox": [r["w"], r["s"], r["e"], r["n"]], "center": [r["lng"], r["lat"]]}


def _stage_chain(plan):
    out, node = [], (plan or {}).get("queryPlan") or plan
    while node:
        if node.get("stage"):
            out.append(node["stage"])
        node = node.get("inputStage") or (node.get("inputStages") or [None])[0] or node.get("queryPlan")
    return " › ".join(out) or "unknown"


def _shape(label, ex):
    es, chain = ex.get("executionStats", {}), _stage_chain(ex.get("queryPlanner", {}).get("winningPlan"))
    return {"label": label, "stages": chain, "nReturned": es.get("nReturned"), "docsExamined": es.get("totalDocsExamined"),
            "keysExamined": es.get("totalKeysExamined"), "timeMs": es.get("executionTimeMillis"),
            "usedIndex": "IXSCAN" in chain or "GEO_NEAR" in chain}


def compare(lng=76.6394, lat=12.2958, radius=2000):
    """Same query with and without index support, using explain('executionStats')."""
    coll = C.incidents
    within = {"location": {"$geoWithin": {"$centerSphere": [[lng, lat], radius / 6378100]}}}
    near = {"location": {"$near": {"$geometry": {"type": "Point", "coordinates": [lng, lat]}, "$maxDistance": radius}}}
    attr = {"severity": "Critical", "status": "Pending"}
    NAT = [("$natural", 1)]
    list(coll.find(within).limit(1))  # warm-up
    r = {
        "near": coll.find(near).explain(), "within": coll.find(within).explain(),
        "within_scan": coll.find(within).hint(NAT).explain(),
        "attr": coll.find(attr).explain(), "attr_scan": coll.find(attr).hint(NAT).explain(),
    }
    return {
        "collectionSize": coll.estimated_document_count(), "params": {"lng": lng, "lat": lat, "radius": radius},
        "geo": [_shape("$near with 2dsphere index", r["near"]), _shape("$geoWithin with 2dsphere index", r["within"]), _shape("$geoWithin forced collection scan", r["within_scan"])],
        "attribute": [_shape("severity + status with compound index", r["attr"]), _shape("severity + status forced collection scan", r["attr_scan"])],
    }
