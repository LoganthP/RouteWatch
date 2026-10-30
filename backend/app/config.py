"""Settings, read from environment variables (and backend/.env)."""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _num(name, default):
    raw = os.getenv(name, "")
    try:
        return float(raw) if raw.strip() != "" else default
    except ValueError:
        return default


def _path(name, default):
    p = Path(os.getenv(name) or default)
    p = p if p.is_absolute() else (BASE_DIR / p)
    p.mkdir(parents=True, exist_ok=True)
    return p.resolve()


INCIDENT_TYPES = ["Accident", "Congestion", "Construction", "Road Closure", "Hazard", "Other"]
SEVERITIES = ["Low", "Medium", "High", "Critical"]
STATUSES = ["Pending", "Verified", "Resolved", "Rejected"]
SOURCES = ["User Report", "Admin", "Synthetic", "Dataset Upload"]
SEVERITY_WEIGHT = {"Low": 1, "Medium": 2, "High": 3, "Critical": 4}
TZ_EXPR = {"$ifNull": ["$tz", "UTC"]}  # each incident is analysed in its own local time

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017/routewatch_db")
PORT = int(_num("PORT", 5000))
JWT_SECRET = os.getenv("JWT_SECRET") or "dev-only-secret-change-me"
JWT_EXPIRES_IN = os.getenv("JWT_EXPIRES_IN", "7d")
UPLOAD_DIR = _path("UPLOAD_DIR", ".data")
MODEL_DIR = _path("MODEL_DIR", "models")


def _origins():
    raw = os.getenv("CLIENT_ORIGIN", "http://localhost:5173")
    out = [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
    for o in list(out):  # localhost and 127.0.0.1 are the same machine
        if "://localhost" in o:
            out.append(o.replace("://localhost", "://127.0.0.1"))
    return sorted(set(out))


CLIENT_ORIGINS = _origins()


def _socket_origins():
    """Socket.IO only broadcasts public, read-only events, so any origin may connect by default
    (Vite may pick another port than 5173). Set SOCKET_CORS_ORIGINS=http://a.com,http://b.com to restrict it."""
    raw = os.getenv("SOCKET_CORS_ORIGINS", "*").strip()
    return "*" if raw in ("", "*") else [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]


SOCKET_ORIGINS = _socket_origins()


class _Limits:
    """Read on every access so changes to .env apply after a restart without code edits."""
    chunk_size = 8 * 1024 * 1024

    @property
    def max_upload_mb(self): return _num("MAX_UPLOAD_MB", 4096)
    @property
    def max_zip_entries(self): return int(_num("MAX_ZIP_ENTRIES", 50))
    @property
    def max_uncompressed_mb(self): return _num("MAX_UNCOMPRESSED_MB", 8192)
    @property
    def max_rows_admin(self): return int(_num("MAX_IMPORT_ROWS_ADMIN", 500000))
    @property
    def max_rows_citizen(self): return int(_num("MAX_IMPORT_ROWS_CITIZEN", 500))
    @property
    def max_inmemory_mb(self): return _num("MAX_INMEMORY_MB", 200)
    @property
    def quota_mb(self): return _num("DB_QUOTA_MB", 512)
    @property
    def geocode_enabled(self): return os.getenv("GEOCODE_ENABLED", "true").lower() == "true"
    @property
    def geocode_max(self): return int(_num("GEOCODE_MAX_PER_IMPORT", 200))
    @property
    def upload_init_rate(self): return int(_num("UPLOAD_INIT_RATE_LIMIT", 200))


LIMITS = _Limits()
