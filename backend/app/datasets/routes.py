"""Dataset upload API: resumable chunked upload, preview, import jobs, rejected-rows report."""
import os
from pathlib import Path

from bson import ObjectId
from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse

from .. import config as cfg
from ..auth import admin_only, protect
from ..db import C, now
from ..geo import valid_tz
from ..util import HttpError, RateLimiter, body_json, client_ip, jresp, jsnum, run_in_threadpool
from . import files as F
from . import importer as I
from . import sources as S
from .normalize import suggest_mapping

router = APIRouter(prefix="/api/datasets", dependencies=[Depends(protect)])
MB = 1024 * 1024
_init_limit = RateLimiter(lambda: cfg.LIMITS.upload_init_rate, 15 * 60, "Too many upload requests. Wait a few minutes and try again.")


def fmt(b):
    return f"{b / 1024 / MB:.2f} GB" if b >= 1024 * MB else f"{b / MB:.1f} MB"


@router.get("/limits")
def limits(user=Depends(protect)):
    L = cfg.LIMITS
    return jresp({"maxUploadMB": L.max_upload_mb, "maxRows": L.max_rows_admin if user.get("role") == "admin" else L.max_rows_citizen,
                  "maxInMemoryMB": L.max_inmemory_mb, "chunkSize": L.chunk_size, "quotaMB": L.quota_mb, "geocodeEnabled": L.geocode_enabled,
                  "geocodeMax": L.geocode_max, "formats": F.SUPPORTED,
                  "enums": {"types": cfg.INCIDENT_TYPES, "severities": cfg.SEVERITIES, "statuses": cfg.STATUSES}})


@router.get("/storage")
def storage():
    return jresp(I.storage_info())


# ---------------------------------------------------------------- chunked, resumable upload
@router.post("/upload/init")
async def upload_init(request: Request, user=Depends(protect)):
    _init_limit.check(client_ip(request))
    body = await body_json(request)

    def work():
        name, size = body.get("filename"), jsnum(body.get("size"))
        if not name or not size or size <= 0:
            raise HttpError(400, "filename and size are required.")
        kind = F.kind_of(name)
        if not kind:
            raise HttpError(400, f"Unsupported file type. Use one of: {', '.join(F.SUPPORTED)}.")
        if kind == "xls":
            raise HttpError(400, "Legacy .xls files are not supported. Save it as .xlsx or .csv.")
        L = cfg.LIMITS
        if size > L.max_upload_mb * MB:
            raise HttpError(413, f"This file is {fmt(size)}; the limit is {fmt(L.max_upload_mb * MB)}.")
        if kind in F.IN_MEMORY and size > L.max_inmemory_mb * MB:
            raise HttpError(413, f"{kind.upper()} files over {int(L.max_inmemory_mb)} MB are not supported (this one is {fmt(size)}). Convert it to CSV, which has no such limit.")
        meta = F.create_session(name, size, user["_id"], L.chunk_size)
        return {"uploadId": meta["id"], "chunkSize": meta["chunkSize"], "totalChunks": meta["totalChunks"]}
    return jresp(await run_in_threadpool(work), 201)


def _own_session(upload_id, user):
    meta = F.read_session(upload_id)
    if not meta:
        raise HttpError(404, "Upload session not found or expired. Start the upload again.")
    if meta["owner"] != str(user["_id"]):
        raise HttpError(403, "This upload belongs to another user.")
    return meta


@router.get("/upload/{upload_id}")
def upload_status(upload_id: str, user=Depends(protect)):
    meta = _own_session(upload_id, user)
    return jresp({"uploadId": meta["id"], "totalChunks": meta["totalChunks"], "chunkSize": meta["chunkSize"], "received": F.received_chunks(meta["id"])})


@router.put("/upload/{upload_id}/chunk")
async def upload_chunk(upload_id: str, request: Request, user=Depends(protect)):
    meta = await run_in_threadpool(_own_session, upload_id, user)
    idx = jsnum(request.query_params.get("index"))
    if idx is None or idx != int(idx) or idx < 0 or idx >= meta["totalChunks"]:
        raise HttpError(400, f"Chunk index must be 0 to {meta['totalChunks'] - 1}.")
    idx = int(idx)
    expected = meta["size"] - idx * meta["chunkSize"] if idx == meta["totalChunks"] - 1 else meta["chunkSize"]
    if int(request.headers.get("content-length") or 0) > meta["chunkSize"] + MB:
        raise HttpError(413, "Chunk is too large.")
    body = await request.body()
    if len(body) != expected:
        raise HttpError(400, f"Chunk {idx} should be {expected} bytes but was {len(body)}.")
    await run_in_threadpool(F.write_chunk, meta, idx, body)
    return jresp({"ok": True, "index": idx})


@router.delete("/upload/{upload_id}")
def upload_cancel(upload_id: str, user=Depends(protect)):
    _own_session(upload_id, user)
    F.remove_session(upload_id)
    return jresp({"cancelled": True})


@router.post("/upload/{upload_id}/complete")
def upload_complete(upload_id: str, user=Depends(protect)):
    """Assemble the chunks, check the real file type, read a preview and create the dataset."""
    meta = _own_session(upload_id, user)
    got = set(F.received_chunks(meta["id"]))
    if len(got) != meta["totalChunks"]:
        missing = [i for i in range(meta["totalChunks"]) if i not in got][:20]
        raise HttpError(409, f"Upload incomplete: missing chunks {', '.join(map(str, missing))}.", {"missing": missing})
    path = F.finalize_session(meta)
    try:
        if os.path.getsize(path) != meta["size"]:
            raise HttpError(400, f"Assembled file is {os.path.getsize(path)} bytes, expected {meta['size']}.")
        bad = F.verify_magic(path, meta["kind"])
        if bad:
            raise HttpError(400, bad)
        sources, warnings = S.describe(path, meta["filename"], meta["kind"], meta["size"])
        pv = S.preview(sources)
        preview = {**pv, "warnings": warnings, "sources": [{"name": s.name, "kind": s.kind, "size": s.size} for s in sources],
                   "suggestedMapping": suggest_mapping(pv["columns"])}
        doc = {"name": (Path(meta["filename"]).stem or "Dataset")[:120], "file": {"name": meta["filename"], "size": meta["size"], "kind": meta["kind"]},
               "sources": preview["sources"], "filePath": path, "preview": preview, "status": "uploaded",
               "progress": {"rowsRead": 0, "imported": 0, "skipped": 0, "duplicates": 0, "geocoded": 0, "rate": 0, "phase": "reading"},
               "rejectedCount": 0, "createdBy": user["_id"], "createdByName": user.get("name"), "createdAt": now(), "updatedAt": now()}
        C.datasets.insert_one(doc)
        return jresp({"datasetId": doc["_id"], "name": doc["name"], "preview": preview}, 201)
    except Exception:
        F.remove_file(path)
        raise


# ---------------------------------------------------------------- datasets
@router.get("")
def list_datasets():
    return jresp(list(C.datasets.find({}, {"filePath": 0, "preview": 0}).sort("createdAt", -1).limit(200)))


def _get_ds(id_, projection=None):
    if not ObjectId.is_valid(id_):
        raise HttpError(400, "Invalid dataset id.")
    ds = C.datasets.find_one({"_id": ObjectId(id_)}, projection)
    if not ds:
        raise HttpError(404, "Dataset not found.")
    return ds


@router.get("/{dataset_id}")
def get_dataset(dataset_id: str):
    ds = _get_ds(dataset_id, {"filePath": 0})
    return jresp({**ds, "running": I.is_running(ds["_id"])})


def _start_import(user, dataset_id, body):
    ds = _get_ds(dataset_id)
    if ds.get("status") != "uploaded":
        raise HttpError(409, f"This dataset is {ds.get('status')}. Upload the file again to import it again.")
    if not ds.get("filePath") or not os.path.exists(ds["filePath"]):
        raise HttpError(410, "The uploaded file has expired (files are kept 24 hours). Upload it again.")
    if ds.get("createdBy") != user["_id"] and user.get("role") != "admin":
        raise HttpError(403, "Only the uploader can import this dataset.")
    mapping = body.get("mapping") if isinstance(body.get("mapping"), dict) else {}
    mapping["area"] = [c for c in (mapping.get("area") or []) if c] if isinstance(mapping.get("area"), list) else []
    if not ((mapping.get("latitude") and mapping.get("longitude")) or mapping.get("coordinates") or mapping.get("address") or mapping["area"]):
        raise HttpError(400, "Map latitude and longitude (or a coordinates, address or area column) before importing.")
    tz_mode = body.get("tzMode") or "auto"
    if tz_mode not in ("auto", "UTC") and not valid_tz(tz_mode):
        raise HttpError(400, f'Unknown time zone "{tz_mode}".')
    dflt = body.get("defaults") if isinstance(body.get("defaults"), dict) else {}
    defaults = {"type": dflt.get("type") if dflt.get("type") in cfg.INCIDENT_TYPES else "Other",
                "severity": dflt.get("severity") if dflt.get("severity") in cfg.SEVERITIES else "Medium",
                "status": dflt.get("status") if dflt.get("status") in cfg.STATUSES else "Verified"}
    role_max = cfg.LIMITS.max_rows_admin if user.get("role") == "admin" else cfg.LIMITS.max_rows_citizen
    sc = body.get("scope") if isinstance(body.get("scope"), dict) else {}
    scope = {"limit": int(max(1, min(jsnum(sc.get("limit")) or role_max, role_max))),
             "sampling": sc.get("sampling") if sc.get("sampling") in ("first", "every", "random") else "first",
             "everyN": int(max(1, min(jsnum(sc.get("everyN")) or 1, 100000))),
             "filters": sc.get("filters") if isinstance(sc.get("filters"), dict) else {}}
    C.datasets.update_one({"_id": ds["_id"]}, {"$set": {"status": "importing", "mapping": mapping, "scope": scope, "startedAt": now(), "updatedAt": now(),
                                                       "name": str(body.get("name") or ds["name"])[:120]}})
    I.start_import(ds["_id"], user, {"mapping": mapping, "defaults": defaults, "scope": scope, "tzMode": tz_mode, "dayFirst": body.get("dayFirst", True)})
    return {"datasetId": ds["_id"], "status": "importing", "limit": scope["limit"]}


@router.post("/{dataset_id}/import")
async def import_dataset(dataset_id: str, request: Request, user=Depends(protect)):
    return jresp(await run_in_threadpool(_start_import, user, dataset_id, await body_json(request)), 202)


@router.post("/{dataset_id}/cancel")
def cancel_import(dataset_id: str):
    ds = _get_ds(dataset_id)
    if not I.cancel(ds["_id"]):
        raise HttpError(409, "This dataset is not importing.")
    return jresp({"cancelling": True})


@router.get("/{dataset_id}/rejected.csv")
def rejected_csv(dataset_id: str):
    ds = _get_ds(dataset_id)
    p = F.DIRS["reports"] / f"{ds['_id']}.rejected.csv"
    if not p.exists():
        raise HttpError(404, "No rejected-rows file for this dataset.")
    return FileResponse(p, media_type="text/csv; charset=utf-8", filename=f"{F.safe_name(ds['name'])}-rejected-rows.csv")


@router.delete("/{dataset_id}")
def delete_dataset(dataset_id: str, user=Depends(admin_only)):
    ds = _get_ds(dataset_id)
    if I.is_running(ds["_id"]):
        raise HttpError(409, "Cancel the import before deleting this dataset.")
    if ds.get("status") == "deleting":
        raise HttpError(409, "This dataset is already being deleted.")
    F.remove_file(ds.get("filePath"))
    C.datasets.update_one({"_id": ds["_id"]}, {"$set": {"status": "deleting"}})
    I.start_delete(ds["_id"], user)
    return jresp({"deleting": True}, 202)
