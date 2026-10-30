"""ML self-test on synthetic data (does not touch your trained model):  python -m tests.test_ml"""
import os
import tempfile

os.environ["MODEL_DIR"] = tempfile.mkdtemp()  # keep the test model away from the real one
import numpy as np
import pandas as pd

from app.ml import clustering, forecast, severity

rng = np.random.default_rng(1)
pts = []
for clat, clng in [(12.305, 76.655), (12.334, 76.666), (12.28, 76.63)]:
    for _ in range(300):
        pts.append({"lat": clat + rng.normal(0, 0.0015), "lng": clng + rng.normal(0, 0.0015),
                    "severity": rng.choice(["Low", "Medium", "High", "Critical"]), "type": "Accident", "hour": int(rng.integers(0, 24))})
for _ in range(300):
    pts.append({"lat": 12.25 + rng.random() * 0.12, "lng": 76.57 + rng.random() * 0.13, "severity": "Low", "type": "Hazard", "hour": 3})
c = clustering.run(pts, eps_m=200, min_samples=15)
print("DBSCAN clusters:", c["n_clusters"], "noise:", c["noise_ratio"], "silhouette:", c["silhouette"], "suggested eps:", c["suggested_eps_m"])
assert c["n_clusters"] >= 3

rows = []
types = severity.TYPES
for _ in range(3000):
    t = rng.choice(types); h = int(rng.integers(0, 24))
    base = {"Accident": 2.6, "Congestion": 1.4, "Road Closure": 2.2}.get(t, 1.8) + (0.8 if h >= 22 or h <= 4 else 0)
    s = severity.LABELS[int(np.clip(round(base + rng.normal(0, 0.6)) - 1, 0, 3))]
    rows.append({"lat": 12.3 + rng.normal(0, .02), "lng": 76.65 + rng.normal(0, .02), "type": t, "hour": h,
                 "dow": int(rng.integers(1, 8)), "month": int(rng.integers(1, 13)), "severity": s})
m = severity.train(rows, n_estimators=80)
print("RF accuracy:", m["metrics"]["accuracy"], "baseline:", m["metrics"]["baseline_accuracy"], "top feature:", m["feature_importance"][0])
print("predict:", severity.predict([{"lat": 12.3, "lng": 76.65, "type": "Accident", "hour": 23, "dow": 7, "month": 5}])[0])

days = pd.date_range("2026-01-01", periods=196, freq="D")
hist = [{"date": d.strftime("%Y-%m-%d"), "count": 40 + 10 * np.sin(i / 7 * 2 * np.pi) + rng.normal(0, 3)} for i, d in enumerate(days)]
f = forecast.run(hist, 14)
print("forecast:", f["method"], "next14:", f["expected_total"], "backtest:", f["backtest"])
assert f["backtest"]["mae"] <= f["backtest"]["naive_mae"], "selected model must be at least as good as seasonal naive"
print("candidates:", [(c["key"], c["mae"]) for c in f["backtest"]["candidates"]])
print("ALL ML TESTS PASSED")
