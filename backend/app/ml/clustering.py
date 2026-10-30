"""
Hotspot detection with DBSCAN on great-circle (haversine) distance.

DBSCAN groups points that have at least `min_samples` neighbours within `eps`
metres, finds clusters of any shape, and labels isolated reports as noise, so
the number of hotspots does not have to be chosen in advance (unlike K-means).
"""
from __future__ import annotations

import numpy as np
from scipy.spatial import ConvexHull
from sklearn.cluster import DBSCAN
from sklearn.metrics import silhouette_score
from sklearn.neighbors import NearestNeighbors

EARTH_M = 6_371_008.8
SEV_W = {"Low": 1, "Medium": 2, "High": 3, "Critical": 4}


def _haversine_m(lat1, lng1, lat2, lng2):
    lat1, lng1, lat2, lng2 = map(np.radians, (lat1, lng1, lat2, lng2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lng2 - lng1) / 2) ** 2
    return 2 * EARTH_M * np.arcsin(np.sqrt(a))


def suggest_eps(coords_rad: np.ndarray, min_samples: int, rng: np.random.Generator) -> float | None:
    """k-distance 'elbow' heuristic: distance to the k-th neighbour, sorted; pick max curvature."""
    n = len(coords_rad)
    if n < max(50, min_samples * 3):
        return None
    sample = coords_rad[rng.choice(n, size=min(n, 4000), replace=False)]
    k = min(min_samples, len(sample) - 1)
    nn = NearestNeighbors(n_neighbors=k + 1, metric="haversine", algorithm="ball_tree").fit(sample)
    d = np.sort(nn.kneighbors(sample)[0][:, -1]) * EARTH_M
    x = np.linspace(0, 1, len(d))
    y = (d - d.min()) / (d.max() - d.min() + 1e-12)
    knee = int(np.argmax(x - y))  # farthest point below the diagonal
    return float(np.clip(d[knee], 25, 5000))


def run(points, eps_m: float, min_samples: int, max_clusters: int = 300, seed: int = 42) -> dict:
    lat = np.array([p["lat"] for p in points], dtype=float)
    lng = np.array([p["lng"] for p in points], dtype=float)
    sev = np.array([p.get("severity", "Low") for p in points])
    typ = np.array([p.get("type", "Other") for p in points])
    hour = np.array([p.get("hour", -1) for p in points])
    area = np.array([p.get("area", "") for p in points])
    n = len(points)
    rng = np.random.default_rng(seed)

    if n < min_samples:
        return {"n_points": n, "n_clusters": 0, "noise_points": n, "noise_ratio": 1.0, "clusters": [],
                "silhouette": None, "suggested_eps_m": None, "eps_m": eps_m, "min_samples": min_samples}

    coords = np.radians(np.column_stack([lat, lng]))
    labels = DBSCAN(eps=eps_m / EARTH_M, min_samples=min_samples, metric="haversine",
                    algorithm="ball_tree", n_jobs=-1).fit_predict(coords)

    clusters = []
    for cid in sorted(set(labels) - {-1}):
        idx = np.where(labels == cid)[0]
        clat, clng = float(lat[idx].mean()), float(lng[idx].mean())
        dist = _haversine_m(clat, clng, lat[idx], lng[idx])
        w = np.array([SEV_W.get(s, 1) for s in sev[idx]])
        sev_counts = {s: int((sev[idx] == s).sum()) for s in SEV_W}
        types, tcounts = np.unique(typ[idx], return_counts=True)
        hours = hour[idx][hour[idx] >= 0]
        areas, acounts = np.unique(area[idx], return_counts=True)
        pts = np.unique(np.column_stack([lng[idx], lat[idx]]).round(6), axis=0)
        hull = None
        if len(pts) >= 3:
            try:
                h = ConvexHull(pts)
                hull = [[float(pts[v][1]), float(pts[v][0])] for v in h.vertices]  # [lat, lng] for Leaflet
            except Exception:  # collinear points
                hull = None
        clusters.append({
            "id": int(cid),
            "size": int(len(idx)),
            "center": [clng, clat],
            "radius_m": float(np.percentile(dist, 90)) if len(dist) else 0.0,
            "hull": hull,
            "severity": sev_counts,
            "avg_severity": round(float(w.mean()), 2),
            "risk_score": int(w.sum()),
            "top_type": str(types[np.argmax(tcounts)]),
            "peak_hour": int(np.bincount(hours.astype(int), minlength=24).argmax()) if len(hours) else None,
            "area": str(areas[np.argmax(acounts)]) if len(areas) else "",
        })
    clusters.sort(key=lambda c: c["risk_score"], reverse=True)
    for rank, c in enumerate(clusters, 1):
        c["rank"] = rank

    sil = None
    clustered = np.where(labels != -1)[0]
    if len(set(labels[clustered])) >= 2 and len(clustered) >= 10:
        pick = clustered if len(clustered) <= 5000 else rng.choice(clustered, size=5000, replace=False)
        try:
            sil = round(float(silhouette_score(coords[pick], labels[pick], metric="haversine")), 3)
        except Exception:
            sil = None

    noise = int((labels == -1).sum())
    return {
        "n_points": n,
        "n_clusters": len(clusters),
        "noise_points": noise,
        "noise_ratio": round(noise / n, 3),
        "silhouette": sil,
        "suggested_eps_m": suggest_eps(coords, min_samples, rng),
        "eps_m": eps_m,
        "min_samples": min_samples,
        "clusters": clusters[:max_clusters],
    }
