"""Global geo helpers: viewport boxes, time zones and readable area names."""
import math
from functools import lru_cache
from zoneinfo import ZoneInfo

try:
    from tzfpy import get_tz as _get_tz
except Exception:  # pragma: no cover
    _get_tz = None


@lru_cache(maxsize=512)
def valid_tz(name):
    try:
        ZoneInfo(name)
        return True
    except Exception:
        return False


@lru_cache(maxsize=300000)
def _tz_cell(lng, lat):
    name = ""
    if _get_tz:
        try:
            name = _get_tz(lng, lat) or ""
        except Exception:
            name = ""
    return name if name and valid_tz(name) else "UTC"


def tz_for(lng, lat):
    """IANA time zone of a point (cached on a ~1 km grid)."""
    return _tz_cell(round(float(lng), 2), round(float(lat), 2))


def parse_bbox(s):
    """'west,south,east,north' → dict or None. Clamps latitudes and wraps longitudes."""
    if not s:
        return None
    try:
        p = [float(x) for x in str(s).split(",")]
    except ValueError:
        return None
    if len(p) != 4 or not all(math.isfinite(x) for x in p):
        return None
    w, s_, e, n = p
    s_ = max(-90.0, min(90.0, s_))
    n = max(-90.0, min(90.0, n))
    if s_ >= n:
        return None
    if e - w >= 360:
        w, e = -180.0, 180.0
    if not (w == -180 and e == 180):
        wrap = lambda x: ((x + 180) % 360) - 180
        w, e = wrap(w), wrap(e)
        if e == -180:
            e = 180.0
    return {"w": w, "s": s_, "e": e, "n": n}


def _ring(w, s, e, n):
    return [[[w, s], [e, s], [e, n], [w, n], [w, s]]]


def bbox_query(b):
    """Box → $geoWithin with GeoJSON polygons (uses the 2dsphere index).
    Boxes crossing the antimeridian are split, and wide boxes are cut into <=90° slices
    because a 2dsphere polygon must be smaller than a hemisphere."""
    if not b:
        return None
    spans = [(b["w"], b["e"])] if b["w"] <= b["e"] else [(b["w"], 180.0), (-180.0, b["e"])]
    slices = []
    for a, z in spans:
        if z - a < 1e-6:
            a, z = a - 0.0005, z + 0.0005
        width = z - a
        parts = max(1, math.ceil(width / 90))
        for i in range(parts):
            slices.append((a + width * i / parts, a + width * (i + 1) / parts))
    s = max(b["s"], -89.9)
    n = min(b["n"], 89.9)
    if len(slices) == 1:
        geometry = {"type": "Polygon", "coordinates": _ring(slices[0][0], s, slices[0][1], n)}
    else:
        geometry = {"type": "MultiPolygon", "coordinates": [_ring(a, s, z, n) for a, z in slices]}
    return {"$geoWithin": {"$geometry": geometry}}


CITIES = [
    ("Mysuru", 12.2958, 76.6394), ("Bengaluru", 12.9716, 77.5946), ("Chennai", 13.0827, 80.2707),
    ("Hyderabad", 17.385, 78.4867), ("Mumbai", 19.076, 72.8777), ("Pune", 18.5204, 73.8567),
    ("Delhi", 28.6139, 77.209), ("Kolkata", 22.5726, 88.3639), ("Ahmedabad", 23.0225, 72.5714),
    ("Kochi", 9.9312, 76.2673), ("Coimbatore", 11.0168, 76.9558), ("Mangaluru", 12.9141, 74.856),
    ("Jaipur", 26.9124, 75.7873), ("Lucknow", 26.8467, 80.9462), ("Colombo", 6.9271, 79.8612),
    ("Dhaka", 23.8103, 90.4125), ("Karachi", 24.8607, 67.0011), ("Dubai", 25.2048, 55.2708),
    ("Riyadh", 24.7136, 46.6753), ("Istanbul", 41.0082, 28.9784), ("Cairo", 30.0444, 31.2357),
    ("Nairobi", -1.2921, 36.8219), ("Lagos", 6.5244, 3.3792), ("Johannesburg", -26.2041, 28.0473),
    ("London", 51.5074, -0.1278), ("Paris", 48.8566, 2.3522), ("Berlin", 52.52, 13.405),
    ("Madrid", 40.4168, -3.7038), ("Rome", 41.9028, 12.4964), ("Amsterdam", 52.3676, 4.9041),
    ("Moscow", 55.7558, 37.6173), ("Stockholm", 59.3293, 18.0686), ("Warsaw", 52.2297, 21.0122),
    ("New York", 40.7128, -74.006), ("Los Angeles", 34.0522, -118.2437), ("Chicago", 41.8781, -87.6298),
    ("Houston", 29.7604, -95.3698), ("Miami", 25.7617, -80.1918), ("San Francisco", 37.7749, -122.4194),
    ("Seattle", 47.6062, -122.3321), ("Toronto", 43.6532, -79.3832), ("Mexico City", 19.4326, -99.1332),
    ("Sao Paulo", -23.5505, -46.6333), ("Buenos Aires", -34.6037, -58.3816), ("Lima", -12.0464, -77.0428),
    ("Bogota", 4.711, -74.0721), ("Tokyo", 35.6762, 139.6503), ("Seoul", 37.5665, 126.978),
    ("Beijing", 39.9042, 116.4074), ("Shanghai", 31.2304, 121.4737), ("Hong Kong", 22.3193, 114.1694),
    ("Bangkok", 13.7563, 100.5018), ("Singapore", 1.3521, 103.8198), ("Jakarta", -6.2088, 106.8456),
    ("Manila", 14.5995, 120.9842), ("Kuala Lumpur", 3.139, 101.6869), ("Sydney", -33.8688, 151.2093),
    ("Melbourne", -37.8136, 144.9631), ("Auckland", -36.8485, 174.7633),
]
_DIRS = ["North", "North-east", "East", "South-east", "South", "South-west", "West", "North-west"]


def haversine_km(lat1, lng1, lat2, lng2):
    r = math.radians
    d_lat, d_lng = r(lat2 - lat1), r(lng2 - lng1)
    a = math.sin(d_lat / 2) ** 2 + math.cos(r(lat1)) * math.cos(r(lat2)) * math.sin(d_lng / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(a))


def area_label(lng, lat):
    """Offline label: 'Mysuru Central', 'London North-east', or a grid label far from any city."""
    best, best_d = None, float("inf")
    for name, clat, clng in CITIES:
        if abs(clat - lat) > 1 or abs(clng - lng) > 1.5:
            continue
        d = haversine_km(lat, lng, clat, clng)
        if d < best_d:
            best, best_d = (name, clat, clng), d
    if best and best_d <= 40:
        if best_d < 2.5:
            return f"{best[0]} Central"
        ang = math.degrees(math.atan2(lng - best[2], lat - best[1]))
        return f"{best[0]} {_DIRS[int(math.floor(((ang + 360) % 360) / 45 + 0.5)) % 8]}"
    f = lambda v, p, q: f"{abs(v):.1f}{p if v >= 0 else q}"
    return f"Grid {f(lat, 'N', 'S')}, {f(lng, 'E', 'W')}"
