"""Large-file upload + import check.  Start the server first, then for example:
    python tests/large_file_test.py --rows 300000 --limit 50000 --sampling random
    python tests/large_file_test.py --file C:\\data\\US_Accidents_March23.csv --limit 100000 --sampling random
Generates a US-Accidents-style CSV when --file is not given. The imported dataset is deleted at the end."""
import argparse
import os
import random
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

ap = argparse.ArgumentParser()
ap.add_argument("--file")
ap.add_argument("--rows", type=int, default=300000)
ap.add_argument("--limit", type=int, default=50000)
ap.add_argument("--sampling", default="random", choices=["first", "every", "random"])
ap.add_argument("--api", default=os.getenv("API_URL", "http://localhost:5000"))
a = ap.parse_args()
API = a.api.rstrip("/") + "/api"
http = httpx.Client(timeout=600)


def call(method, url, **kw):
    r = http.request(method, API + url, headers={"Authorization": f"Bearer {TOKEN}", **kw.pop("headers", {})}, **kw)
    return r.status_code, (r.json() if "json" in r.headers.get("content-type", "") else r.text)


TOKEN = http.post(API + "/auth/login", json={"email": "admin@routewatch.local", "password": "Admin@123"}).json()["token"]

path = a.file
if not path:
    path = str(Path(tempfile.gettempdir()) / "routewatch_big.csv")
    rnd = random.Random(3)
    cities = [("Los Angeles", "CA", 34.05, -118.24, "US/Pacific"), ("Houston", "TX", 29.76, -95.37, "US/Central"), ("Miami", "FL", 25.76, -80.19, "US/Eastern"), ("Seattle", "WA", 47.61, -122.33, "US/Pacific")]
    print(f"generating {a.rows:,} rows …")
    with open(path, "w", newline="") as f:
        f.write("ID,Source,Severity,Start_Time,End_Time,Start_Lat,Start_Lng,Distance(mi),Description,Street,City,County,State,Zipcode,Country,Timezone\n")
        for i in range(a.rows):
            c = rnd.choice(cities)
            f.write(f'A-{i},Source2,{rnd.choice("1234")},2022-{rnd.randint(1, 12):02d}-{rnd.randint(1, 28):02d} {rnd.randint(0, 23):02d}:{rnd.randint(0, 59):02d}:00,'
                    f'2022-01-01 00:00:00,{c[2] + rnd.gauss(0, .08):.6f},{c[3] + rnd.gauss(0, .08):.6f},0.01,"Accident on road segment {i}",Main St,{c[0]},County,{c[1]},90001,US,{c[4]}\n')
size = os.path.getsize(path)
print(f"file: {size / 1048576:.1f} MB")

t0 = time.time()
s, d = call("POST", "/datasets/upload/init", json={"filename": Path(path).name, "size": size})
assert s == 201, d
uid, cs, tc = d["uploadId"], d["chunkSize"], d["totalChunks"]


def send(i):
    with open(path, "rb") as f:
        f.seek(i * cs)
        data = f.read(cs)
    for attempt in range(3):
        s, r = call("PUT", f"/datasets/upload/{uid}/chunk?index={i}", content=data, headers={"Content-Type": "application/octet-stream"})
        if s == 200:
            return
        time.sleep(1 + attempt)
    raise RuntimeError(f"chunk {i} failed: {r}")


with ThreadPoolExecutor(3) as ex:
    list(ex.map(send, range(tc)))
print(f"uploaded {tc} chunks in {time.time() - t0:.1f}s")

t1 = time.time()
s, done = call("POST", f"/datasets/upload/{uid}/complete")
assert s == 201, done
print(f"check + preview: {time.time() - t1:.2f}s, about {done['preview']['estimatedRows']:,} rows, mapping: {done['preview']['suggestedMapping']}")

t2 = time.time()
s, r = call("POST", f"/datasets/{done['datasetId']}/import", json={"mapping": done["preview"]["suggestedMapping"], "defaults": {"type": "Accident"}, "scope": {"limit": a.limit, "sampling": a.sampling}})
assert s == 202, r
while True:
    time.sleep(2)
    ds = call("GET", f"/datasets/{done['datasetId']}")[1]
    p = ds["progress"]
    print(f"  {ds['status']:10} read {p['rowsRead']:>9,}  imported {p['imported']:>7,}  rejected {p['skipped']:>5,}  {p['rate']:,} rows/s")
    if ds["status"] != "importing":
        break
print(f"import finished: {ds['status']} in {time.time() - t2:.1f}s. {ds.get('statusNote') or ''}")
print("analytics total for this dataset:", call("GET", f"/analytics/summary?dataset={ds['_id']}")[1]["total"])
call("DELETE", f"/datasets/{ds['_id']}")
if not a.file:
    os.remove(path)
