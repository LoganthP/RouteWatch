from bson import ObjectId
from fastapi import APIRouter, Depends, Request

from . import config as cfg
from .analytics import cell_size
from .auth import admin_only, protect
from .db import C, audit, next_seq, now
from .geo import area_label, tz_for
from .realtime import emit
from .util import HttpError, body_json, build_match, clamp, jresp, jsnum, num_or, parse_lnglat, qd, run_in_threadpool, validate_incident

router = APIRouter(prefix="/api/incidents")


def resolve_area(lng, lat):
    """A stored named polygon wins ($geoIntersects); otherwise an offline city-based label."""
    try:
        hits = list(C.areas.find({"boundary": {"$geoIntersects": {"$geometry": {"type": "Point", "coordinates": [lng, lat]}}}}))
        if hits:
            hits.sort(key=lambda a: (a["center"][0] - lng) ** 2 + (a["center"][1] - lat) ** 2)
            return hits[0]["name"]
    except Exception:
        pass
    return area_label(lng, lat)


def _find_by_id(id_):
    q = {"_id": ObjectId(id_)} if len(id_) == 24 and ObjectId.is_valid(id_) else {"incidentId": id_}
    return C.incidents.find_one(q)


@router.get("")
def list_incidents(request: Request):
    q = qd(request)
    match = build_match(q)
    page = max(1, int(num_or(q.get("page"), 1)))
    limit = int(min(max(1, num_or(q.get("limit"), 20)), 500))
    sort = q.get("sort") if q.get("sort") in ("reportedAt", "severity", "type", "area", "status") else "reportedAt"
    d = 1 if q.get("dir") == "asc" else -1
    items = list(C.incidents.find(match).sort([(sort, d), ("_id", d)]).skip((page - 1) * limit).limit(limit))
    total = C.incidents.count_documents(match)
    return jresp({"items": items, "total": total, "page": page, "pages": -(-total // limit)})


@router.get("/map")
def map_points(request: Request):
    """Zoomed out → server-side grid clusters; zoomed in → individual markers."""
    q = qd(request)
    match = build_match(q)
    zoom = jsnum(q.get("zoom"))
    if zoom is not None and zoom < 12:
        cell = cell_size({"zoom": zoom})
        rows = list(C.incidents.aggregate([
            {"$match": match},
            {"$group": {"_id": {"x": {"$floor": {"$divide": [{"$arrayElemAt": ["$location.coordinates", 0]}, cell]}},
                                "y": {"$floor": {"$divide": [{"$arrayElemAt": ["$location.coordinates", 1]}, cell]}}},
                        "count": {"$sum": 1}, "lng": {"$avg": {"$arrayElemAt": ["$location.coordinates", 0]}},
                        "lat": {"$avg": {"$arrayElemAt": ["$location.coordinates", 1]}},
                        "critical": {"$sum": {"$cond": [{"$eq": ["$severity", "Critical"]}, 1, 0]}},
                        "high": {"$sum": {"$cond": [{"$eq": ["$severity", "High"]}, 1, 0]}},
                        "medium": {"$sum": {"$cond": [{"$eq": ["$severity", "Medium"]}, 1, 0]}}}},
            {"$sort": {"count": -1}}, {"$limit": 3000}], allowDiskUse=True))
        items = []
        for c in rows:
            counts = {"Low": c["count"] - c["critical"] - c["high"] - c["medium"], "Medium": c["medium"], "High": c["high"], "Critical": c["critical"]}
            dominant = "Low"
            for s in cfg.SEVERITIES:
                if counts[s] >= counts[dominant]:
                    dominant = s
            items.append({"lng": c["lng"], "lat": c["lat"], "count": c["count"], "severity": dominant, "critical": c["critical"]})
        return jresp({"mode": "clusters", "items": items, "total": sum(i["count"] for i in items)})
    limit = int(min(num_or(q.get("limit"), 2500), 10000))
    proj = {k: 1 for k in ("incidentId", "type", "severity", "status", "area", "location", "reportedAt", "description")}
    items = list(C.incidents.find(match, proj).sort("reportedAt", -1).limit(limit))
    return jresp({"mode": "points", "items": items, "limited": len(items) == limit})


@router.get("/nearby")
def nearby(request: Request):
    """$geoNear: incidents within a radius, nearest first."""
    q = qd(request)
    lng, lat = parse_lnglat(q.get("lng"), q.get("lat"))
    radius = clamp(num_or(q.get("radius"), 2000), 50, 50000)
    limit = int(min(num_or(q.get("limit"), 200), 2000))
    r = list(C.incidents.aggregate([
        {"$geoNear": {"near": {"type": "Point", "coordinates": [lng, lat]}, "key": "location", "distanceField": "distance",
                      "maxDistance": radius, "spherical": True, "query": build_match(q)}},
        {"$facet": {"items": [{"$limit": limit}], "stats": [{"$group": {
            "_id": None, "total": {"$sum": 1}, "avgDistance": {"$avg": "$distance"},
            "critical": {"$sum": {"$cond": [{"$eq": ["$severity", "Critical"]}, 1, 0]}},
            "high": {"$sum": {"$cond": [{"$eq": ["$severity", "High"]}, 1, 0]}},
            "active": {"$sum": {"$cond": [{"$in": ["$status", ["Pending", "Verified"]]}, 1, 0]}}}}]}}], allowDiskUse=True))[0]
    stats = r["stats"][0] if r["stats"] else {"total": 0, "avgDistance": 0, "critical": 0, "high": 0, "active": 0}
    stats.pop("_id", None)
    return jresp({"center": [lng, lat], "radius": radius, "items": r["items"], "stats": stats})


@router.post("/within")
async def within(request: Request):
    q, body = qd(request), await body_json(request)
    geom = body.get("geometry")
    if not isinstance(geom, dict) or geom.get("type") not in ("Polygon", "MultiPolygon"):
        raise HttpError(400, "Send a GeoJSON Polygon in body.geometry.")

    def work():
        match = {**build_match(q), "location": {"$geoWithin": {"$geometry": geom}}}
        try:
            items = list(C.incidents.find(match).sort("reportedAt", -1).limit(2000))
            return {"items": items, "total": C.incidents.count_documents(match)}
        except Exception as e:
            raise HttpError(400, f"Invalid polygon: {str(e)[:120]}")
    return jresp(await run_in_threadpool(work))


@router.get("/{incident_id}")
def get_incident(incident_id: str):
    doc = _find_by_id(incident_id)
    if not doc:
        raise HttpError(404, f"Incident {incident_id} was not found.")
    for f in ("reportedBy", "verifiedBy"):
        if doc.get(f):
            doc[f] = C.users.find_one({"_id": doc[f]}, {"name": 1})
    return jresp(doc)


def _create(user, body):
    data = validate_incident(body)
    is_admin = user.get("role") == "admin"
    lng, lat = data["location"]["coordinates"]
    seq = next_seq("incident")
    ai = body.get("aiSeverity")
    doc = {
        **data, "incidentId": f"INC-{seq:05d}", "area": data.get("area") or resolve_area(lng, lat), "tz": tz_for(lng, lat),
        "description": data.get("description", ""),
        "status": (data.get("status") or "Verified") if is_admin else "Pending",  # citizen reports wait for verification
        "source": "Admin" if is_admin else "User Report", "reportedBy": user["_id"], "isSynthetic": False,
        "createdAt": now(), "updatedAt": now(),
    }
    if is_admin:
        doc["verifiedBy"] = user["_id"]
    if ai in cfg.SEVERITIES:
        doc["aiSeverity"] = ai
    C.incidents.insert_one(doc)
    audit(user, "CREATE", doc["incidentId"], {"type": doc["type"], "severity": doc["severity"], "status": doc["status"]})
    emit("incident:new", doc)
    return doc


@router.post("")
async def create_incident(request: Request, user=Depends(protect)):
    return jresp(await run_in_threadpool(_create, user, await body_json(request)), 201)


def _update(user, id_, body):
    updates = validate_incident(body, partial=True)
    if "location" in updates:
        lng, lat = updates["location"]["coordinates"]
        if not body.get("area"):
            updates["area"] = resolve_area(lng, lat)
        updates["tz"] = tz_for(lng, lat)
    before = C.incidents.find_one({"incidentId": id_})
    if not before:
        raise HttpError(404, f"Incident {id_} was not found.")
    if updates.get("status") == "Resolved" and before.get("status") != "Resolved":
        updates["resolvedAt"] = now()
    updates["updatedAt"] = now()
    doc = C.incidents.find_one_and_update({"incidentId": id_}, {"$set": updates}, return_document=True)
    diff = {k: {"from": before.get(k), "to": v} for k, v in updates.items() if k != "updatedAt" and before.get(k) != v}
    audit(user, "UPDATE", doc["incidentId"], diff)
    emit("incident:updated", doc)
    return doc


@router.patch("/{incident_id}")
async def update_incident(incident_id: str, request: Request, user=Depends(admin_only)):
    return jresp(await run_in_threadpool(_update, user, incident_id, await body_json(request)))


def _set_status(user, id_, body):
    status = body.get("status")
    if status not in cfg.STATUSES:
        raise HttpError(400, f"status must be one of: {', '.join(cfg.STATUSES)}")
    doc = C.incidents.find_one({"incidentId": id_})
    if not doc:
        raise HttpError(404, f"Incident {id_} was not found.")
    frm = doc.get("status")
    upd, unset = {"status": status, "updatedAt": now()}, {}
    if status == "Verified":
        upd["verifiedBy"] = user["_id"]
    if status == "Resolved":
        upd["resolvedAt"] = now()
    else:
        unset["resolvedAt"] = ""
    doc = C.incidents.find_one_and_update({"incidentId": id_}, {"$set": upd, **({"$unset": unset} if unset else {})}, return_document=True)
    audit(user, "STATUS", id_, {"status": {"from": frm, "to": status}}, body.get("note"))
    emit("incident:updated", doc)
    return doc


@router.patch("/{incident_id}/status")
async def set_status(incident_id: str, request: Request, user=Depends(admin_only)):
    return jresp(await run_in_threadpool(_set_status, user, incident_id, await body_json(request)))


@router.delete("/{incident_id}")
def delete_incident(incident_id: str, user=Depends(admin_only)):
    doc = C.incidents.find_one_and_delete({"incidentId": incident_id})
    if not doc:
        raise HttpError(404, f"Incident {incident_id} was not found.")
    audit(user, "DELETE", doc["incidentId"], {"snapshot": {"type": doc.get("type"), "severity": doc.get("severity"), "area": doc.get("area")}})
    emit("incident:deleted", {"incidentId": doc["incidentId"]})
    return jresp({"deleted": doc["incidentId"]})
