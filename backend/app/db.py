"""MongoDB connection (PyMongo), collections, indexes and small helpers."""
from datetime import datetime, timezone

from pymongo import ASCENDING, DESCENDING, GEOSPHERE, MongoClient
from pymongo.errors import OperationFailure

from . import config

_client = None
_db = None


def connect():
    global _client, _db
    _client = MongoClient(config.MONGODB_URI, tz_aware=True, tzinfo=timezone.utc, serverSelectionTimeoutMS=10000)
    _client.admin.command("ping")  # fail fast with a clear error
    try:
        _db = _client.get_default_database()
    except Exception:
        _db = _client["routewatch_db"]
    print(f"[db] connected to {_db.name}")
    return _db


def close():
    if _client:
        _client.close()


def database():
    return _db


def ping():
    try:
        _client.admin.command("ping")
        return True
    except Exception:
        return False


class _Cols:
    """C.incidents, C.users … → collections named exactly as in RouteWatch 1.x / 2.x (Node)."""
    def __getattr__(self, name):
        return _db[name]


C = _Cols()


def now():
    return datetime.now(timezone.utc)


def ensure_indexes():
    specs = [
        ("incidents", [("incidentId", ASCENDING)], {"unique": True}),
        ("incidents", [("location", GEOSPHERE)], {}),
        ("incidents", [("reportedAt", DESCENDING)], {}),
        ("incidents", [("severity", ASCENDING), ("status", ASCENDING)], {}),
        ("incidents", [("type", ASCENDING), ("reportedAt", DESCENDING)], {}),
        ("incidents", [("area", ASCENDING)], {}),
        ("incidents", [("datasetId", ASCENDING), ("reportedAt", DESCENDING)], {}),
        ("incidents", [("fingerprint", ASCENDING)], {"unique": True, "partialFilterExpression": {"fingerprint": {"$type": "string"}}}),
        ("users", [("email", ASCENDING)], {"unique": True}),
        ("areas", [("name", ASCENDING)], {"unique": True}),
        ("areas", [("boundary", GEOSPHERE)], {}),
        ("auditlogs", [("createdAt", DESCENDING)], {}),
        ("datasets", [("createdAt", DESCENDING)], {}),
        ("mlmodels", [("kind", ASCENDING), ("version", DESCENDING)], {}),
        ("geocaches", [("key", ASCENDING)], {"unique": True}),
    ]
    for coll, keys, opts in specs:
        try:
            _db[coll].create_index(keys, **opts)
        except OperationFailure as e:  # same index already exists with other options: keep the old one
            print(f"[db] index on {coll} {keys} left as is: {e.details.get('errmsg', e)[:90] if e.details else e}")


def next_seq(name="incident", step=1):
    """Atomic counter (readable IDs like INC-00042). Returns the LAST number of the reserved block."""
    doc = _db.counters.find_one_and_update({"_id": name}, {"$inc": {"seq": step}}, upsert=True, return_document=True)
    return doc["seq"]


def audit(user, action, incident_id=None, changes=None, note=None):
    doc = {
        "action": action,
        "incidentId": incident_id,
        "actor": user.get("_id") if user else None,
        "actorName": (user or {}).get("name") or "system",
        "changes": changes,
        "createdAt": now(),
    }
    if note:
        doc["note"] = str(note)[:300]
    _db.auditlogs.insert_one(doc)
