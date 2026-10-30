"""AI / ML endpoints. scikit-learn and statsmodels run inside this same process (imported on first use)."""
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Request

from . import config as cfg
from .auth import admin_only, protect
from .db import C, audit, now
from .geo import tz_for
from .util import HttpError, body_json, build_match, clamp, jresp, num_or, parse_dt, parse_lnglat, qd, run_in_threadpool

router = APIRouter(prefix="/api/ml")
LOCAL = {"date": "$reportedAt", "timezone": cfg.TZ_EXPR}


def _features(q, max_n, extra=None):
    """Sample up to max_n incidents matching the filters, with local-time features."""
    match = build_match(q)
    total = C.incidents.count_documents(match)
    pipe = [{"$match": match}]
    if total > max_n:
        pipe.append({"$sample": {"size": int(max_n)}})
    proj = {"_id": 0, "lng": {"$arrayElemAt": ["$location.coordinates", 0]}, "lat": {"$arrayElemAt": ["$location.coordinates", 1]},
            "severity": 1, "type": 1, "hour": {"$hour": LOCAL}, **(extra or {})}
    pipe.append({"$project": proj})
    return list(C.incidents.aggregate(pipe, allowDiskUse=True)), total, total > max_n


@router.get("/status")
def status():
    latest = C.mlmodels.find_one({"kind": "severity-rf"}, sort=[("version", -1)])
    from .ml import severity
    return jresp({"online": True, "severityModelLoaded": severity.load() is not None, "latestModel": latest})


def _clusters(q, body):
    from .ml import clustering
    q = {**q, **(body.get("filters") or {})}
    eps = clamp(num_or(body.get("eps_m"), 250), 10, 20000)
    min_samples = int(clamp(num_or(body.get("min_samples"), 15), 2, 1000))
    max_pts = int(clamp(num_or(body.get("max_points"), 50000), 500, 100000))
    rows, total, sampled = _features(q, max_pts, {"area": 1})
    if not rows:
        raise HttpError(400, "No incidents match these filters. Clear a filter or zoom out.")
    return {**clustering.run(rows, eps, min_samples), "totalMatching": total, "sampled": sampled}


@router.post("/clusters")
async def clusters(request: Request, user=Depends(protect)):
    return jresp(await run_in_threadpool(_clusters, qd(request), await body_json(request)))


def _train(user, body):
    from .ml import severity
    q = body.get("filters") or {}
    max_rows = int(clamp(num_or(body.get("max_rows"), 120000), 1000, 200000))
    rows, total, sampled = _features(q, max_rows, {"dow": {"$dayOfWeek": LOCAL}, "month": {"$month": LOCAL}})
    try:
        res = severity.train(rows, int(num_or(body.get("n_estimators"), 200)), int(num_or(body.get("max_depth"), 16)))
    except ValueError as e:
        raise HttpError(400, str(e))
    last = C.mlmodels.find_one({"kind": "severity-rf"}, sort=[("version", -1)])
    doc = {"kind": "severity-rf", "version": (last or {}).get("version", 0) + 1, "algorithm": res["algorithm"], "params": res["params"],
           "metrics": res["metrics"], "featureImportance": res["feature_importance"], "samples": res["samples"],
           "filters": {**q, "totalMatching": total, "sampled": sampled}, "trainedBy": user.get("name"), "trainSeconds": res["train_seconds"],
           "createdAt": now(), "updatedAt": now()}
    C.mlmodels.insert_one(doc)
    audit(user, "TRAIN_MODEL", None, {"model": "severity-rf", "version": doc["version"], "accuracy": res["metrics"]["accuracy"]})
    return doc


@router.post("/severity/train")
async def train(request: Request, user=Depends(admin_only)):
    return jresp(await run_in_threadpool(_train, user, await body_json(request)), 201)


@router.get("/severity/model")
def model_card():
    versions = list(C.mlmodels.find({"kind": "severity-rf"}).sort("version", -1).limit(10))
    return jresp({"latest": versions[0] if versions else None,
                  "history": [{"version": v["version"], "accuracy": (v.get("metrics") or {}).get("accuracy"),
                               "macro_f1": (v.get("metrics") or {}).get("macro_f1"), "createdAt": v.get("createdAt")} for v in versions]})


def _predict(body):
    from .ml import severity
    lng, lat = parse_lnglat(body.get("lng"), body.get("lat"))
    if body.get("type") not in cfg.INCIDENT_TYPES:
        raise HttpError(400, f"type must be one of: {', '.join(cfg.INCIDENT_TYPES)}")
    when = parse_dt(body["datetime"]) if body.get("datetime") else now()
    if when is None:
        raise HttpError(400, "datetime is not a valid date.")
    tz = tz_for(lng, lat)
    local = when.astimezone(ZoneInfo(tz))
    p = {"hour": local.hour, "dow": local.isoweekday() % 7 + 1, "month": local.month, "tz": tz}  # dow: Sunday = 1 (same as MongoDB)
    try:
        out = severity.predict([{"lat": lat, "lng": lng, "type": body["type"], "hour": p["hour"], "dow": p["dow"], "month": p["month"]}])[0]
    except FileNotFoundError as e:
        raise HttpError(404, str(e))
    return {**out, "local": p}


@router.post("/severity/predict")
async def predict(request: Request, user=Depends(protect)):
    return jresp(await run_in_threadpool(_predict, await body_json(request)))


def _forecast(q, body):
    from datetime import timedelta
    from .ml import forecast
    q = {**q, **(body.get("filters") or {})}
    horizon = int(clamp(num_or(body.get("horizon"), 14), 1, 90))
    since = now() - timedelta(days=400)
    match = build_match(q)
    cur = match.get("reportedAt") or {}
    match["reportedAt"] = {**cur, "$gte": cur["$gte"] if cur.get("$gte") and cur["$gte"] > since else since}
    rows = list(C.incidents.aggregate([{"$match": match}, {"$group": {"_id": {"$dateToString": {"format": "%Y-%m-%d", **LOCAL}}, "count": {"$sum": 1}}}, {"$sort": {"_id": 1}}], allowDiskUse=True))
    history = [{"date": r["_id"], "count": r["count"]} for r in rows if r["_id"]]
    if len(history) < 3:
        raise HttpError(400, "Not enough daily history for these filters (need at least 3 days with incidents).")
    today = datetime.now().strftime("%Y-%m-%d")
    if history[-1]["date"] < today:
        history.append({"date": today, "count": 0})  # recent quiet days count as zero
    try:
        return forecast.run(history, horizon)
    except ValueError as e:
        raise HttpError(400, str(e))


@router.post("/forecast")
async def forecast_route(request: Request, user=Depends(protect)):
    return jresp(await run_in_threadpool(_forecast, qd(request), await body_json(request)))
