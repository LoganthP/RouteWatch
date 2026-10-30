"""One-time upgrade for databases created by RouteWatch 1.x: adds each incident's time zone and replaces the old "Outer Mysuru" label.
    python backfill.py"""
from pymongo import UpdateOne

from app import db
from app.db import C
from app.geo import area_label, tz_for

db.connect()
db.ensure_indexes()
flt = {"$or": [{"tz": {"$exists": False}}, {"tz": None}, {"area": "Outer Mysuru"}]}
ops, n = [], 0
for d in C.incidents.find(flt, {"location": 1, "area": 1}):
    lng, lat = d["location"]["coordinates"]
    s = {"tz": tz_for(lng, lat)}
    if d.get("area") in ("Outer Mysuru", None, ""):
        s["area"] = area_label(lng, lat)
    ops.append(UpdateOne({"_id": d["_id"]}, {"$set": s}))
    if len(ops) == 2000:
        C.incidents.bulk_write(ops, ordered=False)
        n += len(ops)
        ops = []
        print(f"\r[backfill] {n}", end="")
if ops:
    C.incidents.bulk_write(ops, ordered=False)
    n += len(ops)
print(f"\n[backfill] updated {n} incidents")
