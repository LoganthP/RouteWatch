"""End-to-end API test (about 80 checks). Start the server and seed the database first, then:
    python tests/api_test.py
Options (environment):  API_URL=http://localhost:5000   FIXTURES=tests/fixtures"""
import os
import sys
import time
from pathlib import Path

import httpx

API = os.getenv("API_URL", "http://localhost:5000").rstrip("/") + "/api"
FIX = Path(os.getenv("FIXTURES") or Path(__file__).parent / "fixtures")
http = httpx.Client(timeout=300)
TOKENS = {"admin": "", "citizen": ""}
results = []
S = {}  # shared state between checks


def call(method, url, body=None, auth="admin", raw=None, headers=None):
    h = dict(headers or {})
    if auth:
        tok = TOKENS.get(auth, auth if auth not in TOKENS else "")
        if tok:
            h["Authorization"] = f"Bearer {tok}"
    r = http.request(method, API + url, json=body if raw is None else None, content=raw, headers=h)
    data = r.json() if "json" in r.headers.get("content-type", "") else r.text
    return r.status_code, data


def check(name):
    def deco(fn):
        t = time.time()
        try:
            note = fn() or ""
            results.append((name, "PASS", int((time.time() - t) * 1000), note))
        except Exception as e:  # noqa: BLE001
            results.append((name, "FAIL", int((time.time() - t) * 1000), str(e)[:150]))
        return fn
    return deco


def expect(cond, msg="failed"):
    if not cond:
        raise AssertionError(msg)


def status(r, code):
    expect(r[0] == code, f"expected {code}, got {r[0]} {str(r[1])[:110]}")
    return r[1]


def upload(file, auth="admin"):
    buf = (FIX / file).read_bytes()
    s, d = call("POST", "/datasets/upload/init", {"filename": file, "size": len(buf)}, auth)
    if s != 201:
        return s, d
    uid, cs, tc = d["uploadId"], d["chunkSize"], d["totalChunks"]
    for i in range(tc):
        s2, d2 = call("PUT", f"/datasets/upload/{uid}/chunk?index={i}", raw=buf[i * cs:(i + 1) * cs], auth=auth, headers={"Content-Type": "application/octet-stream"})
        if s2 != 200:
            return s2, d2
    return call("POST", f"/datasets/upload/{uid}/complete", auth=auth)


def import_and_wait(ds_id, body, auth="admin"):
    status(call("POST", f"/datasets/{ds_id}/import", body, auth), 202)
    for _ in range(240):
        time.sleep(0.5)
        d = call("GET", f"/datasets/{ds_id}", auth=auth)[1]
        if d["status"] not in ("importing", "uploaded"):
            return d
    raise AssertionError("import did not finish in 120 s")


# ------------------------------------------------------------------ auth + health
@check("health")
def _():
    d = status(call("GET", "/health", auth=None), 200)
    expect(d["db"] == "connected", "db not connected")


@check("login wrong password → 401")
def _(): status(call("POST", "/auth/login", {"email": "admin@routewatch.local", "password": "nope"}, None), 401)


@check("login admin")
def _():
    TOKENS["admin"] = status(call("POST", "/auth/login", {"email": "admin@routewatch.local", "password": "Admin@123"}, None), 200)["token"]


@check("login citizen")
def _():
    TOKENS["citizen"] = status(call("POST", "/auth/login", {"email": "user@routewatch.local", "password": "User@123"}, None), 200)["token"]


@check("me with bad token → 401")
def _(): status(call("GET", "/auth/me", auth="garbage"), 401)


@check("register duplicate → 409")
def _(): status(call("POST", "/auth/register", {"name": "x", "email": "admin@routewatch.local", "password": "123456"}, None), 409)


@check("register new user + login")
def _():
    email = f"tester{int(time.time())}@example.com"
    r = status(call("POST", "/auth/register", {"name": "Tester", "email": email, "password": "secret1"}, None), 201)
    expect(r["user"]["role"] == "user", "new accounts must be citizens")
    status(call("POST", "/auth/login", {"email": email, "password": "secret1"}, None), 200)


# ------------------------------------------------------------------ analytics
@check("bounds span several continents")
def _():
    d = status(call("GET", "/analytics/bounds"), 200)
    expect(d["bbox"] and d["bbox"][2] - d["bbox"][0] > 100, "bbox too small")
    return f"{d['count']} incidents"


@check("summary")
def _(): expect(status(call("GET", "/analytics/summary"), 200)["total"] > 0, "no data")


@check("summary with empty filter has zeros")
def _():
    d = status(call("GET", "/analytics/summary?from=2001-01-01&to=2001-01-02"), 200)
    expect(d["total"] == 0 and len(d["bySeverity"]) == 4, "not zeroed")


@check("hotspots Mysuru bbox")
def _():
    d = status(call("GET", "/analytics/hotspots?bbox=76.5,12.2,76.8,12.4&zoom=12"), 200)
    expect(d["cells"], "no cells")
    return f"{d['hotspotCount']} hotspots"


@check("hotspots London bbox")
def _(): expect(status(call("GET", "/analytics/hotspots?bbox=-0.4,51.3,0.2,51.7"), 200)["cells"], "no cells")


@check("antimeridian bbox")
def _(): status(call("GET", "/analytics/summary?bbox=170,-50,-170,-30"), 200)


@check("bad bbox ignored")
def _(): status(call("GET", "/analytics/summary?bbox=a,b,c"), 200)


for g in ("hour", "dayOfWeek", "month", "day", "weekhour", "bogus"):
    check(f"temporal {g}")(lambda g=g: status(call("GET", f"/analytics/temporal?granularity={g}"), 200))


@check("local-time rush hour in Tokyo")
def _():
    series = status(call("GET", "/analytics/temporal?granularity=hour&bbox=139.3,35.4,140,36"), 200)["series"]
    peak = max(series, key=lambda x: x["total"])["label"]
    expect(peak in ("07:00", "08:00", "09:00", "16:00", "17:00", "18:00", "19:00", "20:00"), f"peak {peak}")
    return f"peak {peak} local"


@check("severity")
def _(): status(call("GET", "/analytics/severity"), 200)


@check("areas")
def _(): expect(status(call("GET", "/analytics/areas?limit=5"), 200)[0]["bbox"], "no bbox")


@check("heatmap")
def _(): expect(len(status(call("GET", "/analytics/heatmap?limit=100"), 200)) == 100, "wrong size")


@check("performance default point")
def _(): expect(status(call("GET", "/analytics/performance"), 200)["geo"][0]["usedIndex"], "no index")


@check("performance bad coords → 400")
def _(): status(call("GET", "/analytics/performance?lng=999&lat=0"), 400)


# ------------------------------------------------------------------ incidents
@check("incidents list")
def _(): expect(len(status(call("GET", "/incidents?limit=5&sort=severity&dir=asc"), 200)["items"]) == 5, "len")


@check("incidents NaN paging")
def _(): status(call("GET", "/incidents?page=abc&limit=xyz"), 200)


@check("map clusters at zoom 3")
def _(): expect(status(call("GET", "/incidents/map?zoom=3"), 200)["mode"] == "clusters", "mode")


@check("map points at zoom 14")
def _(): expect(status(call("GET", "/incidents/map?zoom=14&bbox=76.6,12.28,76.7,12.33"), 200)["mode"] == "points", "mode")


@check("nearby")
def _(): expect(status(call("GET", "/incidents/nearby?lng=76.6552&lat=12.3052&radius=2000"), 200)["items"], "empty")


@check("nearby missing coords → 400")
def _(): status(call("GET", "/incidents/nearby"), 400)


@check("within polygon")
def _():
    poly = {"type": "Polygon", "coordinates": [[[76.6, 12.28], [76.7, 12.28], [76.7, 12.33], [76.6, 12.33], [76.6, 12.28]]]}
    expect(status(call("POST", "/incidents/within", {"geometry": poly}), 200)["total"] > 0, "empty")
    status(call("POST", "/incidents/within", {"geometry": {"type": "Point"}}), 400)


@check("get unknown incident → 404")
def _(): status(call("GET", "/incidents/INC-99999999"), 404)


@check("areas list")
def _(): expect(len(status(call("GET", "/areas"), 200)) > 10, "few areas")


@check("area incidents (stored polygon)")
def _(): status(call("GET", "/areas/Vijayanagar/incidents"), 200)


@check("area incidents (dynamic)")
def _(): status(call("GET", "/areas/London%20Central/incidents"), 200)


@check("area unknown → 404")
def _(): status(call("GET", "/areas/Nowhere%20Land/incidents"), 404)


@check("create incident without auth → 401")
def _(): status(call("POST", "/incidents", {}, None), 401)


@check("create invalid → 400")
def _(): status(call("POST", "/incidents", {"type": "X", "severity": "Y"}), 400)


@check("create incident (Nairobi)")
def _():
    d = status(call("POST", "/incidents", {"type": "Hazard", "severity": "High", "description": "API test", "location": {"type": "Point", "coordinates": [36.82, -1.29]}}), 201)
    S["inc"] = d
    expect(d["tz"] == "Africa/Nairobi", f"tz {d['tz']}")
    return f"{d['incidentId']} in {d['area']}"


@check("citizen cannot change status → 403")
def _(): status(call("PATCH", f"/incidents/{S['inc']['incidentId']}/status", {"status": "Resolved"}, "citizen"), 403)


@check("admin resolve")
def _(): expect(status(call("PATCH", f"/incidents/{S['inc']['incidentId']}/status", {"status": "Resolved"}), 200)["resolvedAt"], "no resolvedAt")


@check("admin edit")
def _(): expect(status(call("PATCH", f"/incidents/{S['inc']['incidentId']}", {"severity": "Low", "description": "edited"}), 200)["severity"] == "Low", "not updated")


@check("get incident populates reporter")
def _(): expect(status(call("GET", f"/incidents/{S['inc']['incidentId']}"), 200)["reportedBy"]["name"], "no reporter name")


@check("admin delete")
def _(): status(call("DELETE", f"/incidents/{S['inc']['incidentId']}"), 200)


@check("audit log (admin)")
def _(): expect(status(call("GET", "/audit?limit=5"), 200), "empty")


@check("audit log citizen → 403")
def _(): status(call("GET", "/audit", auth="citizen"), 403)


@check("CSV export")
def _():
    s, d = call("GET", "/reports/csv?severity=Critical&bbox=76.5,12.2,76.8,12.4")
    expect(s == 200 and d.startswith("incidentId,"), "not csv")


@check("PDF export")
def _():
    r = http.get(API + "/reports/pdf?type=Accident", headers={"Authorization": f"Bearer {TOKENS['admin']}"})
    expect(r.status_code == 200 and r.content[:5] == b"%PDF-" and len(r.content) > 1000, "pdf")


# ------------------------------------------------------------------ datasets
@check("limits")
def _(): expect(status(call("GET", "/datasets/limits"), 200)["maxUploadMB"] > 1000, "limit")


@check("storage")
def _(): return f"{status(call('GET', '/datasets/storage'), 200)['usedMB']} MB used"


@check("upload too large → 413 with size")
def _(): expect("GB" in status(call("POST", "/datasets/upload/init", {"filename": "big.csv", "size": 5.2 * 1024 ** 4}), 413)["message"], "no size in message")


@check("unsupported type → 400")
def _(): status(call("POST", "/datasets/upload/init", {"filename": "x.exe", "size": 10}), 400)


@check("unknown session → 404 with clear message")
def _():
    r = call("PUT", "/datasets/upload/00000000-0000-4000-8000-000000000000/chunk?index=0", raw=b"x", headers={"Content-Type": "application/octet-stream"})
    expect("Upload session not found" in status(r, 404)["message"], str(r[1]))


@check("fake csv (exe) rejected")
def _(): status(upload("fake.csv"), 400)


@check("zip-slip rejected")
def _(): status(upload("evil.zip"), 400)


@check("wrong chunk size → 400")
def _():
    uid = status(call("POST", "/datasets/upload/init", {"filename": "a.csv", "size": 100}), 201)["uploadId"]
    status(call("PUT", f"/datasets/upload/{uid}/chunk?index=0", raw=b"short", headers={"Content-Type": "application/octet-stream"}), 400)


@check("resume: status lists received chunks")
def _():
    size = 9 * 1024 * 1024
    d = status(call("POST", "/datasets/upload/init", {"filename": "r.csv", "size": size}), 201)
    uid = d["uploadId"]
    status(call("PUT", f"/datasets/upload/{uid}/chunk?index=1", raw=b"A" * (size - d["chunkSize"]), headers={"Content-Type": "application/octet-stream"}), 200)
    expect(status(call("GET", f"/datasets/upload/{uid}"), 200)["received"] == [1], "received list")
    status(call("POST", f"/datasets/upload/{uid}/complete"), 409)
    status(call("DELETE", f"/datasets/upload/{uid}"), 200)


IMPORTED = {}
for fname, opts, min_rows in (("us_accidents_sample.csv", {"defaults": {"type": "Accident"}}, 3), ("mixed.xlsx", {}, 3), ("london.geojson", {}, 2), ("bundle.zip", {}, 5),
                              ("table.pdf", {}, 3), ("points.kml", {}, 1), ("track.gpx", {}, 1), ("coords.txt", {}, 2)):
    @check(f"upload + import {fname}")
    def _(fname=fname, opts=opts, min_rows=min_rows):
        up = status(upload(fname), 201)
        ds = import_and_wait(up["datasetId"], {"mapping": up["preview"]["suggestedMapping"], **opts, "scope": {"limit": 100000}})
        expect(ds["status"] == "completed", f"{ds['status']}: {ds.get('statusNote')}")
        expect(ds["progress"]["imported"] >= min_rows, f"imported {ds['progress']['imported']}")
        IMPORTED[fname] = ds
        return f"{ds['progress']['imported']} imported, {ds['progress']['skipped']} rejected"


@check("re-import same file counts duplicates")
def _():
    up = status(upload("us_accidents_sample.csv"), 201)
    ds = import_and_wait(up["datasetId"], {"mapping": up["preview"]["suggestedMapping"], "defaults": {"type": "Accident"}, "scope": {}})
    expect(ds["progress"]["duplicates"] >= 3, f"dups {ds['progress']['duplicates']}")
    IMPORTED["dup"] = ds


@check("scope: column filter + every Nth")
def _():
    up = status(upload("scope.csv"), 201)
    ds = import_and_wait(up["datasetId"], {"mapping": up["preview"]["suggestedMapping"], "scope": {"sampling": "every", "everyN": 2, "filters": {"column": "State", "values": ["CA"]}}})
    expect(ds["progress"]["imported"] == 5, f"imported {ds['progress']['imported']}")
    IMPORTED["scope"] = ds


@check("scope: random sample limit")
def _():
    up = status(upload("scope.csv"), 201)
    ds = import_and_wait(up["datasetId"], {"mapping": up["preview"]["suggestedMapping"], "scope": {"sampling": "random", "limit": 7}})
    expect(ds["progress"]["imported"] + ds["progress"]["duplicates"] == 7, f"imported {ds['progress']['imported']} + dup {ds['progress']['duplicates']}")
    IMPORTED["random"] = ds


@check("citizen import capped + Pending")
def _():
    up = status(upload("scope.csv", "citizen"), 201)
    ds = import_and_wait(up["datasetId"], {"mapping": up["preview"]["suggestedMapping"], "scope": {"limit": 999999}}, "citizen")
    first = status(call("GET", f"/incidents?dataset={ds['_id']}&limit=1"), 200)["items"][0]
    expect(first["status"] == "Pending", "not pending")
    IMPORTED["citizen"] = ds


@check("dataset filter on analytics")
def _():
    ds = IMPORTED["bundle.zip"]
    expect(status(call("GET", f"/analytics/summary?dataset={ds['_id']}"), 200)["total"] == ds["progress"]["imported"], "total mismatch")


@check("rejected rows CSV")
def _():
    s, d = call("GET", f"/datasets/{IMPORTED['us_accidents_sample.csv']['_id']}/rejected.csv")
    expect(s == 200 and len(d.splitlines()) >= 3, "no rows")


@check("citizen cannot delete dataset → 403")
def _(): status(call("DELETE", f"/datasets/{IMPORTED['scope']['_id']}", auth="citizen"), 403)


@check("delete datasets (batched)")
def _():
    for ds in IMPORTED.values():
        status(call("DELETE", f"/datasets/{ds['_id']}"), 202)
    for _ in range(60):
        time.sleep(0.3)
        if not call("GET", "/datasets")[1]:
            break
    expect(status(call("GET", f"/incidents?dataset={IMPORTED['us_accidents_sample.csv']['_id']}"), 200)["total"] == 0, "incidents left behind")


# ------------------------------------------------------------------ ML (runs inside the API process)
@check("ML: status")
def _(): expect(status(call("GET", "/ml/status"), 200)["online"], "offline")


@check("ML: DBSCAN clusters (Mysuru)")
def _():
    d = status(call("POST", "/ml/clusters", {"eps_m": 250, "min_samples": 15, "filters": {"bbox": "76.5,12.2,76.8,12.4"}}), 200)
    expect(d["n_clusters"] > 0, "no clusters")
    return f"{d['n_clusters']} clusters, silhouette {d['silhouette']}"


@check("ML: empty filter → 400")
def _(): status(call("POST", "/ml/clusters", {"filters": {"from": "2001-01-01", "to": "2001-01-02"}}), 400)


@check("ML: citizen cannot train → 403")
def _(): status(call("POST", "/ml/severity/train", {}, "citizen"), 403)


@check("ML: train Random Forest")
def _():
    m = status(call("POST", "/ml/severity/train", {"max_rows": 30000, "n_estimators": 120}), 201)["metrics"]
    expect(m["accuracy"] > m["baseline_accuracy"], f"acc {m['accuracy']} <= baseline {m['baseline_accuracy']}")
    return f"acc {m['accuracy']} vs baseline {m['baseline_accuracy']}, macro-F1 {m['macro_f1']}"


@check("ML: predict")
def _():
    d = status(call("POST", "/ml/severity/predict", {"lng": 76.6552, "lat": 12.3052, "type": "Accident", "datetime": "2026-10-25T08:00:00Z"}), 200)
    expect(d["severity"] and d["local"]["tz"] == "Asia/Kolkata" and d["local"]["hour"] == 13, str(d))
    return f"{d['severity']} ({round(d['confidence'] * 100)}%)"


@check("ML: predict bad type → 400")
def _(): status(call("POST", "/ml/severity/predict", {"lng": 1, "lat": 1, "type": "Meteor"}), 400)


@check("ML: forecast")
def _():
    d = status(call("POST", "/ml/forecast", {"horizon": 14}), 200)
    expect(len(d["forecast"]) == 14, "length")
    return f"{d['method']}; backtest MAE {d['backtest']['mae']} vs naive {d['backtest']['naive_mae']}"


@check("ML: model card")
def _(): expect(status(call("GET", "/ml/severity/model"), 200)["latest"], "no model")


@check("unknown route → 404 JSON")
def _(): expect(status(call("GET", "/nope", auth=None), 404)["message"], "no message")


w = max(len(r[0]) for r in results)
print(f"{'check':{w}}  result  ms     note")
for name, res, ms, note in results:
    print(f"{name:{w}}  {res:6}  {ms:<6} {note}")
failed = [r for r in results if r[1] == "FAIL"]
print(f"\n{len(results) - len(failed)}/{len(results)} passed" + (f", {len(failed)} FAILED" if failed else ""))
sys.exit(1 if failed else 0)
