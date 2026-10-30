"""Index scan vs collection scan with explain("executionStats").
    python benchmark.py [--lng 76.6552 --lat 12.3052 --radius 2000]"""
import argparse

from app import db
from app.analytics import compare

ap = argparse.ArgumentParser()
ap.add_argument("--lng", type=float, default=76.6552)
ap.add_argument("--lat", type=float, default=12.3052)
ap.add_argument("--radius", type=float, default=2000)
a = ap.parse_args()
db.connect()
r = compare(a.lng, a.lat, a.radius)
print(f"\nCollection size: {r['collectionSize']:,} documents\nPoint [{a.lng}, {a.lat}]  radius {a.radius:.0f} m\n")
for title, rows in (("Geospatial queries", r["geo"]), ("Attribute filter (severity=Critical, status=Pending)", r["attribute"])):
    print(title)
    print(f"{'query':45} {'plan':28} {'returned':>8} {'docs examined':>13} {'keys':>8} {'ms':>5}")
    for x in rows:
        print(f"{x['label']:45} {x['stages']:28} {x['nReturned']:>8} {x['docsExamined']:>13} {x['keysExamined']:>8} {x['timeMs']:>5}")
    print()
