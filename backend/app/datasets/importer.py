"""Background import job: stream rows → normalise → filter / sample → batch insert.
Progress goes to Socket.IO and the dataset document; cancel and the storage guard are checked between batches."""
import csv
import json
import random
import threading
import time
from datetime import datetime, timezone

from bson import ObjectId
from pymongo.errors import BulkWriteError

from .. import config as cfg
from ..analytics import bounds
from ..db import C, audit, database, next_seq, now
from ..realtime import emit
from . import files
from .geocode import geocode
from .normalize import finish_row, normalize_row, suggest_mapping, parse_date
from .sources import describe, rows_of

BATCH = 2000
MAX_REJECT_LINES = 50000
_jobs = {}  # datasetId → {"cancel": bool}


def storage_mb():
    st = database().command("dbStats")
    return ((st.get("dataSize") or 0) + (st.get("indexSize") or 0)) / (1024 * 1024)


def storage_info():
    used, count = storage_mb(), C.incidents.estimated_document_count()
    per_doc = 450
    try:
        st = database().command("collStats", "incidents")
        if count:
            per_doc = ((st.get("size") or 0) + (st.get("totalIndexSize") or 0)) / count
    except Exception:
        pass
    q = cfg.LIMITS.quota_mb
    return {"usedMB": round(used, 2), "quotaMB": q, "percent": round(used / q * 100, 1) if q else None, "incidents": count, "bytesPerIncident": round(per_doc or 450)}


def _date(s, end=False):
    d = parse_date(s, "UTC")
    if d and end and len(str(s).strip()) == 10:
        d = d.replace(hour=23, minute=59, second=59, microsecond=999000)
    return d


def in_scope(doc, raw, f):
    if not f:
        return True
    if f.get("from") and doc["reportedAt"] < (_date(f["from"]) or datetime.min.replace(tzinfo=timezone.utc)):
        return False
    if f.get("to") and doc["reportedAt"] > (_date(f["to"], True) or datetime.max.replace(tzinfo=timezone.utc)):
        return False
    if f.get("minSeverity") and cfg.SEVERITY_WEIGHT[doc["severity"]] < cfg.SEVERITY_WEIGHT.get(f["minSeverity"], 0):
        return False
    bb = f.get("bbox")
    if isinstance(bb, list) and len(bb) == 4:
        w, s, e, n = (float(x) for x in bb)
        x, y = doc["location"]["coordinates"]
        if y < s or y > n or (x < w or x > e if w <= e else (x < w and x > e)):
            return False
    if f.get("column") and f.get("values"):
        v = str(raw.get(f["column"]) if raw.get(f["column"]) is not None else "").strip().lower()
        if v not in {str(x).strip().lower() for x in f["values"]}:
            return False
    return True


def run_import(dataset_id, user, options):
    job = {"cancel": False}
    _jobs[str(dataset_id)] = job
    try:
        _run_import(dataset_id, user, options, job)
    except Exception as e:  # last resort: never leave a dataset stuck in "importing"
        print("[import] crashed:", repr(e))
        C.datasets.update_one({"_id": dataset_id}, {"$set": {"status": "failed", "statusNote": f"Import failed: {e}", "finishedAt": now()}})
        emit("dataset:progress", {"datasetId": str(dataset_id), "status": "failed", "progress": {}})
    finally:
        _jobs.pop(str(dataset_id), None)


def _run_import(dataset_id, user, options, job):
    ds = C.datasets.find_one({"_id": dataset_id})
    is_admin = user.get("role") == "admin"
    role_max = cfg.LIMITS.max_rows_admin if is_admin else cfg.LIMITS.max_rows_citizen
    scope = options.get("scope") or {}
    limit = max(1, min(int(scope.get("limit") or role_max), role_max))
    sampling = scope.get("sampling") if scope.get("sampling") in ("first", "every", "random") else "first"
    every_n = max(1, int(scope.get("everyN") or 1))
    norm = {"mapping": options["mapping"], "defaults": options["defaults"], "tzMode": options.get("tzMode") or "auto",
            "dayFirst": options.get("dayFirst", True) is not False, "forceStatus": None if is_admin else "Pending", "importTime": now()}

    reject_path = files.DIRS["reports"] / f"{dataset_id}.rejected.csv"
    reject_f = open(reject_path, "w", newline="", encoding="utf-8")
    rej = csv.writer(reject_f)
    rej.writerow(["row", "source", "reason", "data"])
    p = {"rowsRead": 0, "imported": 0, "skipped": 0, "duplicates": 0, "geocoded": 0, "rate": 0, "phase": "reading"}
    state = {"rej_lines": 0, "last_emit": 0.0, "last_save": 0.0, "stop": None}

    def reject(row, src, reason, raw):
        p["skipped"] += 1
        if state["rej_lines"] < MAX_REJECT_LINES:
            state["rej_lines"] += 1
            rej.writerow([row, src, reason, json.dumps(raw, default=str)[:300]])

    started = time.time()

    def report(force=False):
        t = time.time()
        p["rate"] = round(p["rowsRead"] / max(1.0, t - started))
        if force or t - state["last_emit"] > 0.8:
            state["last_emit"] = t
            emit("dataset:progress", {"datasetId": str(dataset_id), "status": "importing", "progress": p})
        if force or t - state["last_save"] > 3:
            state["last_save"] = t
            C.datasets.update_one({"_id": dataset_id}, {"$set": {"progress": p}})

    seen, batch, reservoir = set(), [], []
    counts = {"accepted": 0, "candidate": 0, "geocodes": 0}

    def flush():
        if not batch:
            return
        docs = batch[:]
        batch.clear()
        last = next_seq("incident", len(docs))
        stamp = now()
        for i, d in enumerate(docs):
            d.update({"incidentId": f"INC-{last - len(docs) + i + 1:05d}", "datasetId": ds["_id"], "source": "Dataset Upload", "reportedBy": user["_id"],
                      "isSynthetic": False, "createdAt": stamp, "updatedAt": stamp})
        try:
            p["imported"] += len(C.incidents.insert_many(docs, ordered=False).inserted_ids)
        except BulkWriteError as e:
            det = e.details or {}
            errs = det.get("writeErrors", [])
            dup = sum(1 for w in errs if w.get("code") == 11000)
            ins = det.get("nInserted", 0)
            p["imported"] += ins
            p["duplicates"] += dup
            p["skipped"] += max(0, len(docs) - ins - dup)
            if not errs:
                raise
        q = cfg.LIMITS.quota_mb
        if q > 0 and storage_mb() >= q * 0.8:
            state["stop"] = f"stopped: storage limit (80% of {int(q)} MB reached)"
        report()

    status, note, auto_mapped = "completed", None, []
    try:
        sources, _ = describe(ds["filePath"], ds["file"]["name"], ds["file"]["kind"], ds["file"]["size"])
        done = False
        for src in sources:
            if done:
                break
            opts, it = None, rows_of(src)
            try:
                for raw in it:
                    p["rowsRead"] += 1
                    if job["cancel"] or state["stop"]:
                        done = True
                        break
                    if opts is None:  # files inside one zip can have different columns
                        cols, m = set(raw), options["mapping"]
                        fits = (m.get("latitude") and m.get("longitude") and m["latitude"] in cols and m["longitude"] in cols) \
                            or (m.get("coordinates") and m["coordinates"] in cols) or (m.get("address") and m["address"] in cols)
                        opts = norm if fits else {**norm, "mapping": suggest_mapping(list(raw))}
                        if not fits:
                            auto_mapped.append(src.name)
                    res = normalize_row(raw, opts)
                    if "needsGeocode" in res:
                        L = cfg.LIMITS
                        if not L.geocode_enabled:
                            reject(p["rowsRead"], src.name, "no coordinates (address geocoding is disabled)", raw)
                            continue
                        if counts["geocodes"] >= L.geocode_max:
                            reject(p["rowsRead"], src.name, f"no coordinates; geocoding limit of {L.geocode_max} per import reached", raw)
                            continue
                        counts["geocodes"] += 1
                        c = geocode(res["needsGeocode"])
                        if not c:
                            reject(p["rowsRead"], src.name, f"address not found: {res['needsGeocode']}", raw)
                            continue
                        p["geocoded"] += 1
                        res = finish_row(raw, c, opts)
                    if "error" in res:
                        reject(p["rowsRead"], src.name, res["error"], raw)
                        continue
                    doc = res["doc"]
                    if not in_scope(doc, raw, scope.get("filters")):
                        continue
                    if doc["fingerprint"] in seen:
                        p["duplicates"] += 1
                        continue
                    counts["candidate"] += 1
                    if sampling == "every" and (counts["candidate"] - 1) % every_n != 0:
                        continue
                    if sampling == "random":  # reservoir sampling keeps a uniform sample of `limit` rows
                        if len(reservoir) < limit:
                            reservoir.append(doc)
                        else:
                            j = random.randrange(counts["candidate"])
                            if j < limit:
                                reservoir[j] = doc
                        if p["rowsRead"] % 5000 == 0:
                            report()
                        continue
                    seen.add(doc["fingerprint"])
                    batch.append(doc)
                    counts["accepted"] += 1
                    if len(batch) >= BATCH:
                        flush()
                    if counts["accepted"] >= limit:
                        done = True
                        break
                    if p["rowsRead"] % 5000 == 0:
                        report()
            finally:
                it.close()
        if sampling == "random" and not job["cancel"]:
            p["phase"] = "writing"
            for d in reservoir:
                if job["cancel"] or state["stop"]:
                    break
                if d["fingerprint"] in seen:
                    p["duplicates"] += 1
                    continue
                seen.add(d["fingerprint"])
                batch.append(d)
                if len(batch) >= BATCH:
                    flush()
        if not job["cancel"] and not state["stop"]:
            flush()
        if auto_mapped:
            note = f"Columns were auto-detected for: {', '.join(auto_mapped[:5])}{'…' if len(auto_mapped) > 5 else ''}."
        if job["cancel"]:
            status, note = "cancelled", "Cancelled by user. Rows imported before cancelling are kept with this dataset."
        elif state["stop"]:
            status, note = "stopped", state["stop"]
        elif not p["imported"] and not p["duplicates"]:
            status, note = "failed", "No rows could be imported. Download the rejected rows to see why."
        elif not p["imported"] and p["duplicates"]:
            note = f"All {p['duplicates']} rows were already in the database (duplicates are skipped)."
    except Exception as e:
        status = "failed"
        note = e.message if hasattr(e, "message") and getattr(e, "status", 500) < 500 else f"Import failed: {e}"
        if not hasattr(e, "message"):
            print("[import]", repr(e))
    finally:
        reject_f.close()
        files.remove_file(ds["filePath"])

    b = bounds({"dataset": str(dataset_id)})
    p["phase"] = "done"
    C.datasets.update_one({"_id": dataset_id}, {"$set": {"status": status, "statusNote": note, "progress": p, "rejectedCount": p["skipped"],
                                                         "finishedAt": now(), "filePath": None, **({"bbox": b["bbox"]} if b.get("bbox") else {})}})
    audit(user, "IMPORT", None, {"dataset": ds["name"], "status": status, "imported": p["imported"], "skipped": p["skipped"], "duplicates": p["duplicates"]}, note)
    emit("dataset:progress", {"datasetId": str(dataset_id), "status": status, "progress": p})
    emit("dataset:imported", {"datasetId": str(dataset_id), "name": ds["name"], "status": status, "imported": p["imported"], "bbox": b.get("bbox")})


def run_delete(dataset_id, user):
    """Delete a dataset's incidents in batches without blocking the API."""
    ds = C.datasets.find_one({"_id": dataset_id})
    if not ds:
        return
    deleted = 0
    while True:
        ids = [d["_id"] for d in C.incidents.find({"datasetId": ds["_id"]}, {"_id": 1}).limit(10000)]
        if not ids:
            break
        deleted += C.incidents.delete_many({"_id": {"$in": ids}}).deleted_count
        emit("dataset:progress", {"datasetId": str(dataset_id), "status": "deleting", "progress": {"deleted": deleted}})
    C.datasets.delete_one({"_id": ds["_id"]})
    files.remove_file(str(files.DIRS["reports"] / f"{dataset_id}.rejected.csv"))
    audit(user, "DELETE_DATASET", None, {"dataset": ds["name"], "deleted": deleted})
    emit("dataset:deleted", {"datasetId": str(dataset_id), "deleted": deleted})


def start_import(dataset_id, user, options):
    threading.Thread(target=run_import, args=(dataset_id, user, options), daemon=True, name=f"import-{dataset_id}").start()


def start_delete(dataset_id, user):
    def work():
        try:
            run_delete(dataset_id, user)
        except Exception as e:
            print("[delete] crashed:", repr(e))
    threading.Thread(target=work, daemon=True, name=f"delete-{dataset_id}").start()


def cancel(dataset_id):
    j = _jobs.get(str(dataset_id))
    if j:
        j["cancel"] = True
    return bool(j)


def is_running(dataset_id):
    return str(dataset_id) in _jobs


def recover_jobs():
    """After a restart: imports cannot resume (marked failed); interrupted deletions continue."""
    r = C.datasets.update_many({"status": "importing"}, {"$set": {"status": "failed", "statusNote":
        "The server restarted during this import. Rows imported before the restart are kept; delete the dataset or upload the file again."}})
    if r.modified_count:
        print(f"[datasets] marked {r.modified_count} interrupted import(s) as failed")
    for d in C.datasets.find({"status": "deleting"}):
        start_delete(d["_id"], None)
