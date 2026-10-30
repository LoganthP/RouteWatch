"""Synthetic global demo data.
    python seed.py                       30,000 incidents across 12 cities
    python seed.py --count 60000
    python seed.py --keep-datasets       keep incidents you imported from files

Everything generated is SYNTHETIC (isSynthetic = true, source "Synthetic"). Severity follows a simple documented rule
(incident type + night-time + junction risk + random noise), so the ML models have a real but imperfect signal to learn."""
import argparse
import math
import random
import sys
from datetime import datetime, timedelta, timezone

from app import db
from app.auth import hash_password
from app.datasets.normalize import _zoned
from app.db import C, audit, now
from app.geo import area_label, tz_for

ap = argparse.ArgumentParser()
ap.add_argument("--count", type=int, default=30000)
ap.add_argument("--keep-datasets", action="store_true")
args = ap.parse_args()
COUNT = min(max(args.count, 100), 300000)
rng = random.Random(20261025)  # same "world" on every machine

CITIES = [("Mysuru", 12.3052, 76.6552, 3), ("Bengaluru", 12.9716, 77.5946, 2), ("Delhi", 28.6139, 77.209, 2), ("Mumbai", 19.076, 72.8777, 2),
          ("London", 51.5074, -0.1278, 1.5), ("New York", 40.7128, -74.006, 1.5), ("Tokyo", 35.6762, 139.6503, 1.5), ("Sydney", -33.8688, 151.2093, 1),
          ("Nairobi", -1.2921, 36.8219, 1), ("Sao Paulo", -23.5505, -46.6333, 1), ("Berlin", 52.52, 13.405, 1), ("Dubai", 25.2048, 55.2708, 1)]
MYSURU_JUNCTIONS = [(12.3052, 76.6552, 1.0), (12.3008, 76.6575, 0.8), (12.3055, 76.6435, 0.5), (12.334, 76.666, 1.1),
                    (12.322, 76.615, 0.7), (12.278, 76.629, 0.9), (12.285, 76.66, 0.6), (12.362, 76.642, 0.8)]
ZONES = [("Devaraja Mohalla", 12.3080, 76.6520), ("Vijayanagar", 12.3300, 76.6120), ("Gokulam", 12.3300, 76.6380), ("Jayalakshmipuram", 12.3400, 76.6260),
         ("Kuvempunagar", 12.2860, 76.6330), ("Saraswathipuram", 12.3060, 76.6270), ("Bannimantap", 12.3350, 76.6650), ("Nazarbad", 12.3060, 76.6690),
         ("Hebbal", 12.3550, 76.6150), ("Hootagalli", 12.3420, 76.5900), ("Ramakrishnanagar", 12.2850, 76.6080), ("JP Nagar", 12.2700, 76.6450),
         ("Siddhartha Layout", 12.2900, 76.6700), ("Udayagiri", 12.3300, 76.6900), ("Metagalli", 12.3620, 76.6400)]
HALF = 0.008
HOUR_W = [2, 1, 1, 1, 1, 2, 4, 7, 10, 10, 7, 5, 5, 5, 5, 6, 8, 10, 11, 10, 7, 5, 4, 3]  # local time
TYPES, TYPE_W = ["Accident", "Congestion", "Construction", "Road Closure", "Hazard", "Other"], [28, 34, 12, 8, 12, 6]
TYPE_BASE = {"Accident": 2.6, "Road Closure": 2.3, "Hazard": 2.0, "Construction": 1.7, "Other": 1.7, "Congestion": 1.3}
SEV = ["Low", "Medium", "High", "Critical"]
DESC = {"Accident": ["Two-vehicle collision", "Two-wheeler skid near median", "Rear-end collision at signal", "Car hit a divider", "Pedestrian hit at crossing", "Bus side-swiped a motorcycle"],
        "Congestion": ["Heavy queue at junction", "Slow-moving traffic, signal backed up", "Peak-hour gridlock", "Traffic backed up due to double parking"],
        "Construction": ["Lane narrowed for drainage work", "Road widening in progress", "Utility trench across one lane"],
        "Road Closure": ["Road closed for procession", "Diversion due to event", "Closed for emergency repair"],
        "Hazard": ["Large pothole on carriageway", "Fallen tree branch on road", "Waterlogging after rain", "Oil spill on lane"],
        "Other": ["Broken traffic signal", "Streetlight outage on stretch", "Vehicle breakdown blocking lane"]}

cities = []
for name, lat, lng, w in CITIES:
    j = MYSURU_JUNCTIONS if name == "Mysuru" else [(lat + rng.gauss(0, .03), lng + rng.gauss(0, .035), round(rng.random() * 1.2, 2)) for _ in range(8)]
    cities.append({"name": name, "lat": lat, "lng": lng, "w": w, "tz": tz_for(lng, lat), "junctions": j})
CITY_TOTAL = sum(c["w"] for c in cities)


def zone_for(lng, lat):
    best, best_d = None, 1e9
    for name, zl, zg in ZONES:
        if abs(lat - zl) <= HALF and abs(lng - zg) <= HALF and (lat - zl) ** 2 + (lng - zg) ** 2 < best_d:
            best, best_d = name, (lat - zl) ** 2 + (lng - zg) ** 2
    return best


def make(i):
    r, city = rng.random() * CITY_TOTAL, cities[0]
    for c in cities:
        r -= c["w"]
        if r <= 0:
            city = c
            break
    risk = 0
    if rng.random() < 0.65:
        jl = city["junctions"][int(rng.random() * len(city["junctions"]))]
        risk, spread = jl[2], 0.0025 + rng.random() * 0.002
        lat, lng = jl[0] + rng.gauss(0, spread), jl[1] + rng.gauss(0, spread)
    else:
        lat, lng = city["lat"] + (rng.random() - .5) * .12, city["lng"] + (rng.random() - .5) * .14
    typ = rng.choices(TYPES, TYPE_W)[0]
    while True:  # weekdays are busier than weekends
        days_ago = int(rng.random() ** 1.15 * 365)
        base = datetime.now(timezone.utc) - timedelta(days=days_ago)
        wd = (base.weekday() + 1) % 7  # Sunday = 0
        if rng.random() < (0.6 if wd == 0 else 0.75 if wd == 6 else 1):
            break
    hour = rng.choices(range(24), HOUR_W)[0]
    reported = _zoned(base.year, base.month, base.day, hour, int(rng.random() * 60), 0, 0, city["tz"])
    if reported > now():
        reported -= timedelta(days=1)
    night = hour >= 22 or hour <= 4
    score = TYPE_BASE[typ] + (0.7 if night else 0) + risk * 0.9 + (0.25 if wd in (0, 6) and night else 0) + rng.gauss(0, 0.45)
    sev = SEV[min(3, max(0, int(math.floor(score + 0.5)) - 1))]
    age = (now() - reported).total_seconds() / 86400
    if age > 14:
        status = "Resolved" if rng.random() < 0.9 else ("Rejected" if rng.random() < 0.5 else "Verified")
    elif age > 2:
        status = rng.choices(["Resolved", "Verified", "Pending", "Rejected"], [55, 30, 10, 5])[0]
    else:
        status = rng.choices(["Pending", "Verified", "Resolved"], [50, 35, 15])[0]
    doc = {"incidentId": f"INC-{i + 1:05d}", "type": typ, "severity": sev, "status": status, "description": rng.choice(DESC[typ]),
           "area": (city["name"] == "Mysuru" and zone_for(lng, lat)) or area_label(lng, lat),
           "location": {"type": "Point", "coordinates": [round(lng, 6), round(lat, 6)]}, "tz": city["tz"], "reportedAt": reported,
           "source": "Synthetic", "isSynthetic": True, "createdAt": now(), "updatedAt": now()}
    if status == "Resolved":
        res = reported + timedelta(hours={"Critical": 2, "High": 4, "Medium": 8, "Low": 16}[sev] * (0.4 + rng.random() * 1.6))
        if res < now():
            doc["resolvedAt"] = res
    return doc


db.connect()
db.ensure_indexes()
print(f"[seed] generating {COUNT:,} SYNTHETIC incidents across {len(cities)} cities…")
C.incidents.delete_many({"datasetId": {"$exists": False}} if args.keep_datasets else {})
C.areas.delete_many({})
C.counters.delete_one({"_id": "incident"})
if not args.keep_datasets:
    C.datasets.delete_many({})
C.areas.insert_many([{"name": n, "kind": "Locality", "center": [g, l], "boundary": {"type": "Polygon", "coordinates": [[[g - HALF, l - HALF], [g + HALF, l - HALF], [g + HALF, l + HALF], [g - HALF, l + HALF], [g - HALF, l - HALF]]]},
                      "createdAt": now(), "updatedAt": now()} for n, l, g in ZONES])
for name, email, pw, role in (("Traffic Admin", "admin@routewatch.local", "Admin@123", "admin"), ("Demo Citizen", "user@routewatch.local", "User@123", "user")):
    C.users.update_one({"email": email}, {"$set": {"name": name, "password": hash_password(pw), "role": role, "updatedAt": now()}, "$setOnInsert": {"createdAt": now()}}, upsert=True)
print("[seed] demo users ready")
done = 0
while done < COUNT:
    n = min(5000, COUNT - done)
    C.incidents.insert_many([make(i) for i in range(done, done + n)], ordered=False)
    done += n
    sys.stdout.write(f"\r[seed] inserted {done:,}")
    sys.stdout.flush()
print()
last = C.incidents.find_one({"incidentId": {"$regex": "^INC-"}}, {"incidentId": 1}, sort=[("incidentId", -1)])
C.counters.update_one({"_id": "incident"}, {"$set": {"seq": max(COUNT, int(last["incidentId"][4:]) if last else 0)}}, upsert=True)
audit(C.users.find_one({"email": "admin@routewatch.local"}), "SEED", None, {"inserted": COUNT, "synthetic": True, "cities": len(cities)}, "Synthetic global demonstration dataset loaded")
print("[seed] incident indexes:", " | ".join("+".join(k for k, _ in ix["key"].items()) for ix in C.incidents.list_indexes()))
print("[seed] done. Log in with admin@routewatch.local / Admin@123")
