"""Column auto-detection and value normalisation: turns arbitrary rows into RouteWatch incidents."""
import hashlib
import math
import re
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from zoneinfo import ZoneInfo

from .. import config as cfg
from ..geo import area_label, tz_for, valid_tz

UTC = timezone.utc
EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
NAN = float("nan")


def _key(s):
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


ALIASES = {
    "latitude": ["latitude", "lat", "startlat", "latdd", "gpslat", "gpslatitude", "ylat", "y", "endlat"],
    "longitude": ["longitude", "lng", "lon", "long", "startlng", "startlon", "londd", "gpslon", "gpslong", "gpslongitude", "xlon", "x", "endlng", "endlon"],
    "coordinates": ["coordinates", "coords", "latlng", "latlon", "latlong", "geolocation", "location", "geo", "point", "position", "gps", "wkt", "geometry"],
    "type": ["type", "incidenttype", "eventtype", "category", "incidentcategory", "accidenttype", "crashtype", "collisiontype", "incident", "event", "kind"],
    "severity": ["severity", "severitylevel", "priority", "injuryseverity", "crashseverity", "accidentseverity", "level", "impact"],
    "status": ["status", "incidentstatus"],
    "datetime": ["starttime", "datetime", "timestamp", "reportedat", "occurredat", "eventtime", "crashdate", "accidentdate", "date", "time", "when", "createdat", "created", "gpxtime", "kmltime"],
    "timezone": ["timezone", "tz", "timezoneid", "tzid"],
    "description": ["description", "desc", "details", "summary", "remarks", "notes", "comment", "comments", "name"],
    "area": ["city", "area", "locality", "neighborhood", "neighbourhood", "district", "ward", "borough", "zone", "town"],
    "region": ["state", "statecode", "province", "region", "county", "country"],
    "address": ["address", "fulladdress", "streetaddress", "street", "road", "place", "placename", "landmark"],
}
GEO_COLS = {"__lat": "latitude", "__lng": "longitude", "__time": "datetime", "__name": "description", "__desc": "description"}


def suggest_mapping(columns):
    """Best column for each field. Every column is used at most once."""
    by_key = {_key(c): c for c in columns}
    used, m = set(), {"area": []}
    for col, field in GEO_COLS.items():
        if col in columns and field not in m:
            m[field] = col
            used.add(col)
    for field in ("latitude", "longitude", "datetime", "timezone", "type", "severity", "status", "description", "coordinates", "address"):
        if field in m:
            continue
        for alias in ALIASES[field]:
            col = by_key.get(alias)
            if col and col not in used:
                m[field] = col
                used.add(col)
                break
    for group in (ALIASES["area"], ALIASES["region"]):  # one local column + one broader region ("Dallas, TX")
        for alias in group:
            col = by_key.get(alias)
            if col and col not in used:
                m["area"].append(col)
                used.add(col)
                break
    if "latitude" in m and "longitude" in m:
        m.pop("coordinates", None)
    return m


# ---------------------------------------------------------------- numbers and coordinates
_COMMA_DEC = re.compile(r"^-?\d+,\d+$")
_DMS = re.compile(r"""^(-?\d+(?:\.\d+)?)[°:\s]+(\d+(?:\.\d+)?)?['′:\s]*(\d+(?:\.\d+)?)?["″\s]*([NSEWnsew])?$""")
_WKT = re.compile(r"POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)", re.I)
_PAIR = re.compile(r"(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)")


def to_num(v):
    if v is None or v == "" or isinstance(v, bool):
        return NAN
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if _COMMA_DEC.match(s):
        s = s.replace(",", ".")
    try:
        n = float(s)
    except ValueError:
        return NAN
    return n if math.isfinite(n) else NAN


def _coord_value(v):
    n = to_num(v)
    if math.isfinite(n):
        return n
    m = _DMS.match(str(v).strip())
    if not m:
        return NAN
    val = abs(float(m.group(1))) + float(m.group(2) or 0) / 60 + float(m.group(3) or 0) / 3600
    return -val if str(m.group(1)).startswith("-") or (m.group(4) and m.group(4) in "SWsw") else val


def parse_pair(v):
    """'lat, lng', 'POINT(lng lat)' or [lng, lat] → (lng, lat) or None."""
    if v is None:
        return None
    if isinstance(v, (list, tuple)) and len(v) >= 2:
        return to_num(v[0]), to_num(v[1])
    s = str(v)
    m = _WKT.search(s)
    if m:
        return float(m.group(1)), float(m.group(2))
    m = _PAIR.search(s)
    return (float(m.group(2)), float(m.group(1))) if m else None


def check_coords(lng, lat):
    if not (math.isfinite(lng) and math.isfinite(lat)):
        return None, "missing or non-numeric coordinates"
    if abs(lat) > 90 and abs(lng) <= 90:
        lng, lat = lat, lng  # swapped columns
    if abs(lat) > 90 or abs(lng) > 180:
        return None, "coordinates out of range"
    if lat == 0 and lng == 0:
        return None, "coordinates are 0,0 (missing value)"
    return (round(lng, 6), round(lat, 6)), None


# ---------------------------------------------------------------- categorical values
_TYPE_RULES = [
    ("Accident", re.compile(r"accident|crash|collision|wreck|roll ?over|overturn|fatal|injur|pedestrian|hit and run|rear[- ]?end|skid")),
    ("Road Closure", re.compile(r"closure|closed|road ?block|blocked|diversion|detour|barricade")),
    ("Construction", re.compile(r"construct|road ?work|works|maintenance|repair|widening|paving|lane narrow")),
    ("Congestion", re.compile(r"congestion|jam|traffic|queue|slow|gridlock|delay|heavy|stalled|backed up")),
    ("Hazard", re.compile(r"hazard|pothole|debris|flood|water|oil|tree|animal|cattle|fog|ice|snow|fire|spill|obstruct|weather|landslide|breakdown|disabled vehicle")),
]


def norm_type(v, fallback):
    if v is None or v == "":
        return fallback
    s = str(v).strip()
    for t in cfg.INCIDENT_TYPES:
        if t.lower() == s.lower():
            return t
    low = s.lower()
    for t, rx in _TYPE_RULES:
        if rx.search(low):
            return t
    return fallback


def norm_severity(v, fallback):
    if v is None or v == "":
        return fallback
    n = to_num(v)
    if math.isfinite(n):
        if n <= 1:
            return "Low"
        if n <= 4:
            return cfg.SEVERITIES[int(math.floor(n + 0.5)) - 1]
        if n <= 10:
            return cfg.SEVERITIES[min(3, math.ceil(n / 10 * 4) - 1)]
        return fallback
    s = str(v).lower()
    if re.search(r"critical|fatal|extreme|catastroph|severe injury|killed|death", s):
        return "Critical"
    if re.search(r"high|major|severe|serious", s):
        return "High"
    if re.search(r"medium|moderate|mid|average", s):
        return "Medium"
    if re.search(r"low|minor|slight|light|property damage|pdo", s):
        return "Low"
    return fallback


def norm_status(v, fallback):
    if v is None or v == "":
        return fallback
    s = str(v).lower()
    for t in cfg.STATUSES:
        if t.lower() == s:
            return t
    if re.search(r"resolv|clear|closed|done|complete|fixed", s):
        return "Resolved"
    if re.search(r"reject|invalid|false|duplicate|spam", s):
        return "Rejected"
    if re.search(r"verif|confirm|active|ongoing|open", s):
        return "Verified"
    if re.search(r"pend|new|report|unverif", s):
        return "Pending"
    return fallback


# ---------------------------------------------------------------- dates and time zones
@lru_cache(maxsize=512)
def _zone(tz):
    try:
        return ZoneInfo(tz)
    except Exception:
        return None


def _zoned(y, mo, d, h, mi, s, us, tz):
    """Wall-clock time in `tz` → UTC (daylight-saving aware). None when the date does not exist."""
    try:
        dt = datetime(y, mo, d, h, mi, s, us)
    except ValueError:
        return None
    z = _zone(tz) if tz and tz != "UTC" else None
    return (dt.replace(tzinfo=z) if z else dt.replace(tzinfo=UTC)).astimezone(UTC)


_ISO_OFF = re.compile(r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?\s*(Z|z|[+-]\d{2}:?\d{2})$")
_ISO = re.compile(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(AM|PM)?)?", re.I)
_DMY = re.compile(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?", re.I)
_NUMERIC = re.compile(r"^\d+(\.\d+)?$")


def _us(frac):
    return int(str(frac or "0")[:6].ljust(6, "0"))


def parse_date(v, tz, day_first=True):
    """Many date formats → aware UTC datetime or None. Text without an offset is local time in `tz`."""
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        if v.tzinfo is not None:
            return v.astimezone(UTC)
        return _zoned(v.year, v.month, v.day, v.hour, v.minute, v.second, v.microsecond, tz)
    if isinstance(v, date):
        return _zoned(v.year, v.month, v.day, 0, 0, 0, 0, tz)
    if isinstance(v, (int, float)) or _NUMERIC.match(str(v).strip()):
        try:
            n = float(v)
        except ValueError:
            return None
        if 1e12 < n < 1e13:
            return datetime.fromtimestamp(n / 1000, UTC)
        if 1e9 < n < 1e10:
            return datetime.fromtimestamp(n, UTC)
        if 20000 < n < 80000:  # Excel serial date
            return parse_date(datetime(1899, 12, 30) + timedelta(days=n), tz, day_first)
        s = str(v).strip()
        if re.fullmatch(r"\d{8}", s):
            return _zoned(int(s[:4]), int(s[4:6]), int(s[6:8]), 0, 0, 0, 0, tz)
        return None
    s = str(v).strip()
    m = _ISO_OFF.match(s)
    if m:
        off = m.group(8)
        if off in ("Z", "z"):
            delta = timedelta(0)
        else:
            sign = -1 if off[0] == "-" else 1
            digits = off[1:].replace(":", "")
            delta = sign * timedelta(hours=int(digits[:2]), minutes=int(digits[2:]))
        try:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5)), int(m.group(6) or 0), _us(m.group(7)), tzinfo=timezone(delta)).astimezone(UTC)
        except ValueError:
            return None
    m = _ISO.match(s)
    if m:
        h = int(m.group(4) or 0)
        if m.group(8):
            h = (h % 12) + (12 if m.group(8).lower() == "pm" else 0)
        return _zoned(int(m.group(1)), int(m.group(2)), int(m.group(3)), h, int(m.group(5) or 0), int(m.group(6) or 0), _us(m.group(7)), tz)
    m = _DMY.match(s)
    if m:
        a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if y < 100:
            y += 2000 if y < 70 else 1900
        if a > 12:
            day, mon = a, b
        elif b > 12:
            day, mon = b, a
        elif day_first:
            day, mon = a, b
        else:
            day, mon = b, a
        h = int(m.group(4) or 0)
        if m.group(7):
            h = (h % 12) + (12 if m.group(7).lower() == "pm" else 0)
        return _zoned(y, mon, day, h, int(m.group(5) or 0), int(m.group(6) or 0), 0, tz)
    for fmt in ("%d %b %Y", "%d %B %Y", "%b %d, %Y", "%B %d, %Y", "%d %b %Y %H:%M", "%b %d, %Y %H:%M", "%a, %d %b %Y %H:%M:%S"):
        try:
            d = datetime.strptime(s, fmt)
            return _zoned(d.year, d.month, d.day, d.hour, d.minute, d.second, 0, tz)
        except ValueError:
            continue
    return None


# ---------------------------------------------------------------- rows
def normalize_row(raw, opts):
    """One raw row → {'doc': incident} | {'error': reason} | {'needsGeocode': address}."""
    m = opts.get("mapping") or {}
    get = lambda col: raw.get(col) if col else None
    lng = lat = NAN
    if m.get("latitude") and m.get("longitude"):
        lat, lng = _coord_value(get(m["latitude"])), _coord_value(get(m["longitude"]))
    if not (math.isfinite(lat) and math.isfinite(lng)) and m.get("coordinates"):
        p = parse_pair(get(m["coordinates"]))
        if p:
            lng, lat = p
    coords = coord_err = None
    if math.isfinite(lat) and math.isfinite(lng):
        coords, coord_err = check_coords(lng, lat)
    if not coords:
        parts = [get(m.get("address"))] + [get(c) for c in (m.get("area") or [])]
        addr = ", ".join(str(x).strip() for x in parts if x is not None and str(x).strip())
        if addr and not coord_err:
            return {"needsGeocode": addr[:200]}
        return {"error": coord_err or "no coordinates and no address to geocode"}
    return finish_row(raw, coords, opts)


def finish_row(raw, coords, opts):
    lng, lat = coords
    m, d = opts.get("mapping") or {}, opts.get("defaults") or {}
    get = lambda col: raw.get(col) if col else None
    row_tz = str(get(m.get("timezone")) or "").strip()
    loc_tz = tz_for(lng, lat)
    mode = opts.get("tzMode") or "auto"
    parse_tz = (row_tz if valid_tz(row_tz) else loc_tz) if mode == "auto" else mode

    if m.get("datetime"):
        raw_dt = get(m["datetime"])
        reported = parse_date(raw_dt, parse_tz, opts.get("dayFirst", True) is not False)
        if not reported:
            return {"error": f'unreadable date "{str(raw_dt if raw_dt is not None else "")[:40]}"'}
        if reported.timestamp() > datetime.now(UTC).timestamp() + 300:
            return {"error": "date is in the future"}
        if reported.year < 1970:
            return {"error": "date is before 1970"}
    else:
        reported = opts.get("importTime") or datetime.now(UTC)

    typ = norm_type(get(m.get("type")), d.get("type") or "Other")
    sev = norm_severity(get(m.get("severity")), d.get("severity") or "Medium")
    status = opts.get("forceStatus") or norm_status(get(m.get("status")), d.get("status") or "Verified")
    parts, seen = [], set()
    for c in (m.get("area") or []):
        x = get(c)
        if x is not None and str(x).strip() and str(x).strip() not in seen:
            seen.add(str(x).strip())
            parts.append(str(x).strip())
    ms = (reported - EPOCH) // timedelta(milliseconds=1)
    doc = {
        "type": typ, "severity": sev, "status": status,
        "description": str(get(m.get("description")) or "").strip()[:500],
        "area": (", ".join(parts) or area_label(lng, lat))[:120],
        "location": {"type": "Point", "coordinates": [lng, lat]},
        "tz": row_tz if valid_tz(row_tz) else loc_tz,
        "reportedAt": reported,
        "fingerprint": hashlib.sha1(f"{lng:.5f}|{lat:.5f}|{ms}|{typ}".encode()).hexdigest()[:24],
    }
    if status == "Resolved":
        doc["resolvedAt"] = reported
    return {"doc": doc}
