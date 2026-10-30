"""Errors, JSON, number/date parsing, filters, validation and rate limiting."""
import json
import math
import re
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool  # noqa: F401  (re-exported)

from . import config as cfg
from .geo import bbox_query, parse_bbox

UTC = timezone.utc


class HttpError(Exception):
    def __init__(self, status, message, extra=None):
        super().__init__(message)
        self.status, self.message, self.extra = status, message, extra or {}


def iso(dt):
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    dt = dt.astimezone(UTC)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def json_default(o):
    if isinstance(o, datetime):
        return iso(o)
    if isinstance(o, ObjectId):
        return str(o)
    if isinstance(o, (set, tuple)):
        return list(o)
    if isinstance(o, bytes):
        return o.decode("utf-8", "replace")
    if hasattr(o, "item"):  # numpy scalars
        return o.item()
    return str(o)


def dumps(data):
    return json.dumps(data, default=json_default, separators=(",", ":"))


def jresp(data, status=200, headers=None):
    return Response(dumps(data), status_code=status, media_type="application/json", headers=headers)


async def body_json(request: Request):
    raw = await request.body()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except ValueError:
        raise HttpError(400, "Request body is not valid JSON.")
    return data if isinstance(data, dict) else {}


def qd(request: Request):
    return dict(request.query_params)


def jsnum(v):
    """Like JavaScript Number(): returns a finite float or None."""
    if v is None or isinstance(v, bool):
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def num_or(v, default):
    n = jsnum(v)
    return n if n else default


def clamp(v, lo, hi):
    return min(hi, max(lo, v))


def parse_dt(v):
    """ISO string / epoch ms / datetime → aware UTC datetime, or None."""
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=UTC)
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        try:
            return datetime.fromtimestamp(v / 1000, UTC)
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(v, str):
        s = v.strip()
        try:
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
                return datetime.fromisoformat(s).replace(tzinfo=UTC)
            d = datetime.fromisoformat(s.replace("Z", "+00:00").replace("z", "+00:00"))
            return d if d.tzinfo else d.replace(tzinfo=UTC)
        except ValueError:
            return None
    return None


def parse_lnglat(lng, lat):
    x, y = jsnum(lng), jsnum(lat)
    if x is None or y is None:
        raise HttpError(400, "lng and lat must be numbers.")
    if x < -180 or x > 180:
        raise HttpError(400, "Longitude must be between -180 and 180.")
    if y < -90 or y > 90:
        raise HttpError(400, "Latitude must be between -90 and 90.")
    return x, y


def _list(v, allowed):
    return [s.strip() for s in str(v or "").split(",") if s.strip() in allowed]


def build_match(q):
    """Query-string filters → MongoDB match document, shared by every list, map, analytics, ML and export call."""
    m = {}
    types, sev, st = _list(q.get("type"), cfg.INCIDENT_TYPES), _list(q.get("severity"), cfg.SEVERITIES), _list(q.get("status"), cfg.STATUSES)
    if types:
        m["type"] = {"$in": types}
    if sev:
        m["severity"] = {"$in": sev}
    if st:
        m["status"] = {"$in": st}
    if q.get("area"):
        m["area"] = str(q["area"])
    ds = q.get("dataset")
    if ds:
        if ds == "none":
            m["datasetId"] = {"$exists": False}
        elif ObjectId.is_valid(str(ds)):
            m["datasetId"] = ObjectId(str(ds))
    r = {}
    if q.get("from") and parse_dt(q["from"]):
        r["$gte"] = parse_dt(q["from"])
    if q.get("to") and parse_dt(q["to"]):
        t = parse_dt(q["to"])
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(q["to"]).strip()):
            t = t.replace(hour=23, minute=59, second=59, microsecond=999000)
        r["$lte"] = t
    if r:
        m["reportedAt"] = r
    box = bbox_query(parse_bbox(q.get("bbox")))
    if box:
        m["location"] = box
    if q.get("search"):
        rx = re.escape(str(q["search"])[:80])
        m["$or"] = [{f: {"$regex": rx, "$options": "i"}} for f in ("incidentId", "description", "area")]
    return m


def validate_incident(body, partial=False):
    out, errors = {}, []
    if not partial or body.get("type") is not None:
        if body.get("type") not in cfg.INCIDENT_TYPES:
            errors.append(f"type must be one of: {', '.join(cfg.INCIDENT_TYPES)}")
        else:
            out["type"] = body["type"]
    if not partial or body.get("severity") is not None:
        if body.get("severity") not in cfg.SEVERITIES:
            errors.append(f"severity must be one of: {', '.join(cfg.SEVERITIES)}")
        else:
            out["severity"] = body["severity"]
    if body.get("status") is not None:
        if body["status"] not in cfg.STATUSES:
            errors.append(f"status must be one of: {', '.join(cfg.STATUSES)}")
        else:
            out["status"] = body["status"]
    if body.get("description") is not None:
        d = str(body["description"]).strip()
        if len(d) > 500:
            errors.append("description must be 500 characters or fewer")
        out["description"] = d
    if body.get("area") is not None and str(body["area"]).strip():
        out["area"] = str(body["area"]).strip()

    coords = None
    loc = body.get("location")
    if isinstance(loc, dict) and loc.get("coordinates") is not None:
        coords = loc["coordinates"]
    elif body.get("lng") is not None:
        coords = [body.get("lng"), body.get("lat")]
    if not partial or coords is not None:
        try:
            c = coords if isinstance(coords, (list, tuple)) and len(coords) >= 2 else [None, None]
            out["location"] = {"type": "Point", "coordinates": list(parse_lnglat(c[0], c[1]))}
        except HttpError as e:
            errors.append(e.message)

    if body.get("reportedAt") is not None:
        t = parse_dt(body["reportedAt"])
        if t is None:
            errors.append("reportedAt must be a valid date")
        elif t.timestamp() > time.time() + 300:
            errors.append("reportedAt cannot be in the future")
        else:
            out["reportedAt"] = t
    elif not partial:
        out["reportedAt"] = datetime.now(UTC)

    if errors:
        raise HttpError(400, "; ".join(errors), {"errors": errors})
    return out


class RateLimiter:
    """Small in-memory limiter (one process). Keyed by client IP."""

    def __init__(self, max_calls, window_s, message):
        self.max, self.window, self.message = max_calls, window_s, message
        self.hits, self.lock = defaultdict(deque), threading.Lock()

    def check(self, key):
        now = time.time()
        with self.lock:
            q = self.hits[key]
            while q and q[0] < now - self.window:
                q.popleft()
            if len(q) >= (self.max() if callable(self.max) else self.max):
                raise HttpError(429, self.message)
            q.append(now)


def client_ip(request: Request):
    return request.client.host if request.client else "unknown"
