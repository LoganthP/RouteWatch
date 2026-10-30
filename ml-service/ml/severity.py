"""
Severity prediction with a Random Forest classifier.

Features: incident type (one-hot), location, and cyclical encodings of local
hour, weekday and month, plus weekend / rush-hour / night flags. The model is
evaluated on a stratified hold-out set and compared with a majority-class
baseline so the reported accuracy is honest.
"""
from __future__ import annotations

import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_recall_fscore_support
from sklearn.model_selection import train_test_split

LABELS = ["Low", "Medium", "High", "Critical"]
TYPES = ["Accident", "Congestion", "Construction", "Road Closure", "Hazard", "Other"]
MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "severity_rf.joblib"

GROUPS = {  # feature → human-readable group for importance
    "lat": "Location", "lng": "Location",
    "hour_sin": "Hour of day", "hour_cos": "Hour of day", "is_rush": "Hour of day", "is_night": "Hour of day",
    "dow_sin": "Day of week", "dow_cos": "Day of week", "is_weekend": "Day of week",
    "month_sin": "Month", "month_cos": "Month",
}


def featurize(df: pd.DataFrame) -> pd.DataFrame:
    h = df["hour"].astype(float)
    d = df["dow"].astype(float)       # 1 = Sunday … 7 = Saturday (MongoDB $dayOfWeek)
    m = df["month"].astype(float)     # 1 … 12
    X = pd.DataFrame({
        "lat": df["lat"].astype(float),
        "lng": df["lng"].astype(float),
        "hour_sin": np.sin(2 * np.pi * h / 24), "hour_cos": np.cos(2 * np.pi * h / 24),
        "dow_sin": np.sin(2 * np.pi * d / 7), "dow_cos": np.cos(2 * np.pi * d / 7),
        "month_sin": np.sin(2 * np.pi * m / 12), "month_cos": np.cos(2 * np.pi * m / 12),
        "is_weekend": d.isin([1, 7]).astype(int),
        "is_rush": (h.between(7, 10) | h.between(16, 20)).astype(int),
        "is_night": ((h >= 22) | (h <= 4)).astype(int),
    })
    for t in TYPES:
        X[f"type_{t}"] = (df["type"] == t).astype(int)
    return X


def train(rows: list[dict], n_estimators: int = 200, max_depth: int = 16, seed: int = 42) -> dict:
    df = pd.DataFrame(rows)
    df = df[df["severity"].isin(LABELS)].dropna(subset=["lat", "lng", "hour", "dow", "month"])
    if len(df) < 200:
        raise ValueError(f"Need at least 200 labelled incidents to train; got {len(df)}.")
    present = [l for l in LABELS if (df["severity"] == l).sum() >= 2]
    if len(present) < 2:
        raise ValueError("Need at least two severity levels in the data to train a classifier.")
    df = df[df["severity"].isin(present)]

    X, y = featurize(df), df["severity"].to_numpy()
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, stratify=y, random_state=seed)

    t0 = time.time()
    clf = RandomForestClassifier(
        n_estimators=n_estimators, max_depth=max_depth, min_samples_leaf=5,
        class_weight=None, n_jobs=-1, random_state=seed,
    ).fit(X_tr, y_tr)
    secs = time.time() - t0

    pred = clf.predict(X_te)
    labels = [l for l in LABELS if l in clf.classes_]
    p, r, f, s = precision_recall_fscore_support(y_te, pred, labels=labels, zero_division=0)
    majority = pd.Series(y_tr).mode()[0]

    groups: dict[str, float] = {}
    for name, imp in zip(X.columns, clf.feature_importances_):
        g = "Incident type" if name.startswith("type_") else GROUPS.get(name, name)
        groups[g] = groups.get(g, 0.0) + float(imp)

    joblib.dump({"model": clf, "columns": list(X.columns), "labels": labels}, MODEL_PATH)
    return {
        "algorithm": "RandomForestClassifier",
        "params": {"n_estimators": n_estimators, "max_depth": max_depth, "min_samples_leaf": 5,
                   "class_weight": "balanced_subsample", "test_size": 0.2},
        "samples": {"train": int(len(X_tr)), "test": int(len(X_te))},
        "train_seconds": round(secs, 2),
        "metrics": {
            "accuracy": round(float(accuracy_score(y_te, pred)), 4),
            "macro_f1": round(float(f1_score(y_te, pred, average="macro", zero_division=0)), 4),
            "weighted_f1": round(float(f1_score(y_te, pred, average="weighted", zero_division=0)), 4),
            "baseline_accuracy": round(float((y_te == majority).mean()), 4),
            # severity is ordinal: how often is the prediction at most one level away?
            "within_one_level": round(float(np.mean(np.abs(
                np.array([LABELS.index(v) for v in pred]) - np.array([LABELS.index(v) for v in y_te])) <= 1)), 4),
            "baseline_label": str(majority),
            "labels": labels,
            "confusion_matrix": confusion_matrix(y_te, pred, labels=labels).tolist(),
            "per_class": [{"label": l, "precision": round(float(a), 3), "recall": round(float(b), 3),
                           "f1": round(float(c), 3), "support": int(d)} for l, a, b, c, d in zip(labels, p, r, f, s)],
        },
        "feature_importance": sorted(
            [{"feature": k, "importance": round(v, 4)} for k, v in groups.items()],
            key=lambda x: x["importance"], reverse=True),
    }


_cache = {"mtime": None, "bundle": None}


def load():
    if not MODEL_PATH.exists():
        return None
    mtime = MODEL_PATH.stat().st_mtime
    if _cache["mtime"] != mtime:
        _cache["bundle"], _cache["mtime"] = joblib.load(MODEL_PATH), mtime
    return _cache["bundle"]


def predict(rows: list[dict]) -> list[dict]:
    bundle = load()
    if bundle is None:
        raise FileNotFoundError("No trained severity model yet. Train it on the AI insights page first.")
    X = featurize(pd.DataFrame(rows))[bundle["columns"]]
    proba = bundle["model"].predict_proba(X)
    classes = list(bundle["model"].classes_)
    out = []
    for row in proba:
        probs = {c: round(float(v), 4) for c, v in zip(classes, row)}
        best = max(probs, key=probs.get)
        out.append({"severity": best, "confidence": probs[best], "probabilities": probs})
    return out
