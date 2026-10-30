"""Address → coordinates via OpenStreetMap Nominatim: max 1 request per second, identifying User-Agent, permanent cache."""
import json
import os
import re
import time
import urllib.parse
import urllib.request

from ..db import C

_last = 0.0


def geocode(address):
    global _last
    key = re.sub(r"\s+", " ", str(address).lower()).strip()[:200]
    if not key:
        return None
    hit = C.geocaches.find_one({"key": key})
    if hit:
        return (hit["lng"], hit["lat"]) if hit.get("found") else None
    wait = 1.1 - (time.time() - _last)
    if wait > 0:
        time.sleep(wait)
    _last = time.time()
    contact = f" ({os.getenv('GEOCODE_EMAIL')})" if os.getenv("GEOCODE_EMAIL") else ""
    try:
        req = urllib.request.Request("https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"format": "json", "limit": 1, "q": key}),
                                     headers={"User-Agent": f"RouteWatch-academic/2.0{contact}", "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode())
    except Exception:
        return None  # transient failures are not cached
    if data:
        lng, lat = float(data[0]["lon"]), float(data[0]["lat"])
        C.geocaches.update_one({"key": key}, {"$set": {"key": key, "lng": lng, "lat": lat, "found": True}}, upsert=True)
        return lng, lat
    C.geocaches.update_one({"key": key}, {"$set": {"key": key, "found": False}}, upsert=True)
    return None
