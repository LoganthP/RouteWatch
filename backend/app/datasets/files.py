"""Upload sessions (kept on disk, so a server restart never loses an upload), type checks and clean-up."""
import json
import os
import re
import shutil
import time
import uuid
from pathlib import Path

from .. import config as cfg

ROOT = cfg.UPLOAD_DIR
DIRS = {k: ROOT / k for k in ("uploads", "datasets", "reports")}
for _d in DIRS.values():
    _d.mkdir(parents=True, exist_ok=True)

EXT_KIND = {"csv": "csv", "tsv": "tsv", "txt": "txt", "json": "json", "geojson": "geojson", "kml": "kml", "gpx": "gpx",
            "xlsx": "xlsx", "xls": "xls", "pdf": "pdf", "zip": "zip"}
SUPPORTED = ["csv", "tsv", "txt", "xlsx", "json", "geojson", "kml", "gpx", "pdf", "zip"]
ARCHIVE_EXT = re.compile(r"\.(zip|rar|7z|gz|tgz|tar|bz2|xz)$", re.I)
IN_MEMORY = {"json", "geojson", "kml", "gpx", "pdf", "xlsx"}  # parsed as a whole, so size-capped


def ext_of(name):
    m = re.search(r"\.([a-z0-9]+)$", str(name).lower())
    return m.group(1) if m else ""


def kind_of(name):
    return EXT_KIND.get(ext_of(name))


def safe_name(name):
    return re.sub(r"[^\w.\- ]+", "_", str(name))[:120] or "upload"


def is_uuid(s):
    return bool(re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", str(s), re.I))


def verify_magic(path, kind):
    """The real file content must match the claimed type. Returns an error message or None."""
    with open(path, "rb") as f:
        head = f.read(8192)
    if not head:
        return "The file is empty."
    if head[:2] == b"MZ" or head[:4] == b"\x7fELF":
        return "Executable files are not allowed."
    if kind in ("zip", "xlsx"):
        return None if head[:4] == b"PK\x03\x04" else f"This is not a real {kind.upper()} file (content does not match the extension)."
    if kind == "pdf":
        return None if head[:5] == b"%PDF-" else "This is not a real PDF file."
    if kind == "xls":
        return None if head[:4] == b"\xd0\xcf\x11\xe0" else "This is not a real XLS file."
    if b"\x00" in head and head[:2] not in (b"\xff\xfe", b"\xfe\xff"):
        return "This file contains binary data, not text. Check the format."
    return None


def _dir(id_):
    return DIRS["uploads"] / id_


def create_session(filename, size, owner, chunk_size):
    sid = str(uuid.uuid4())
    (_dir(sid) / "chunks").mkdir(parents=True)
    meta = {"id": sid, "filename": safe_name(filename), "kind": kind_of(filename), "size": int(size), "chunkSize": chunk_size,
            "totalChunks": max(1, -(-int(size) // chunk_size)), "owner": str(owner), "createdAt": int(time.time() * 1000)}
    (_dir(sid) / "meta.json").write_text(json.dumps(meta))
    (_dir(sid) / "data.part").write_bytes(b"")
    return meta


def read_session(id_):
    if not is_uuid(id_):
        return None
    try:
        return json.loads((_dir(id_) / "meta.json").read_text())
    except Exception:
        return None


def received_chunks(id_):
    try:
        return sorted(int(n) for n in os.listdir(_dir(id_) / "chunks") if n.isdigit())
    except FileNotFoundError:
        return []


def write_chunk(meta, index, data):
    """Write one chunk at its byte offset: safe for parallel and repeated chunks."""
    with open(_dir(meta["id"]) / "data.part", "r+b") as f:
        f.seek(index * meta["chunkSize"])
        f.write(data)
    (_dir(meta["id"]) / "chunks" / str(index)).touch()


def finalize_session(meta):
    dest = DIRS["datasets"] / f"{meta['id']}.{ext_of(meta['filename'])}"
    os.replace(_dir(meta["id"]) / "data.part", dest)
    remove_session(meta["id"])
    return str(dest)


def remove_session(id_):
    if is_uuid(id_):
        shutil.rmtree(_dir(id_), ignore_errors=True)


def remove_file(p):
    if p:
        try:
            os.remove(p)
        except OSError:
            pass


def sweep(active=()):
    """Delete upload sessions and unused dataset files older than 24 hours."""
    cutoff = time.time() - 24 * 3600
    for d in (DIRS["uploads"], DIRS["datasets"]):
        for p in d.iterdir():
            try:
                if p.stat().st_mtime < cutoff and str(p) not in active:
                    shutil.rmtree(p, ignore_errors=True) if p.is_dir() else p.unlink()
            except OSError:
                pass
