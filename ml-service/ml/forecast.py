"""
Daily incident-count forecasting with automatic model selection.

Candidate models (Holt-Winters with weekly seasonality, Holt's damped trend,
seasonal naive, recent mean) are compared on a hold-out backtest; the one with
the lowest mean absolute error (MAE) is refitted on all data and used for the
forecast. The comparison table is returned so the choice is transparent.
"""
from __future__ import annotations

import warnings

import numpy as np
import pandas as pd
from statsmodels.tsa.holtwinters import ExponentialSmoothing

warnings.filterwarnings("ignore")

NAMES = {
    "holt_winters": "Holt-Winters (weekly seasonality, damped trend)",
    "holt": "Holt linear trend (damped)",
    "seasonal_naive": "Seasonal naive (same weekday last week)",
    "mean": "Recent mean (last 28 days)",
}


def _series(history: list[dict]) -> pd.Series:
    s = pd.Series({pd.Timestamp(h["date"]): float(h["count"]) for h in history}).sort_index()
    if s.empty:
        return s
    full = pd.date_range(s.index.min(), s.index.max(), freq="D")
    return s.reindex(full, fill_value=0.0)  # days with no incidents count as zero


def _candidates(n: int) -> list[str]:
    c = ["mean"]
    if n >= 14:
        c.append("seasonal_naive")
    if n >= 10:
        c.append("holt")
    if n >= 35:
        c.append("holt_winters")
    return c


def _fit_predict(train: pd.Series, horizon: int, method: str):
    """Forecast `horizon` days and return (forecast, in-sample fitted values)."""
    y = train.to_numpy()
    if method == "holt_winters":
        m = ExponentialSmoothing(train, trend="add", damped_trend=True, seasonal="add",
                                 seasonal_periods=7, initialization_method="estimated").fit()
        return m.forecast(horizon).to_numpy(), m.fittedvalues.to_numpy()
    if method == "holt":
        m = ExponentialSmoothing(train, trend="add", damped_trend=True, initialization_method="estimated").fit()
        return m.forecast(horizon).to_numpy(), m.fittedvalues.to_numpy()
    if method == "seasonal_naive":
        fitted = np.concatenate([np.full(7, y[:7].mean()), y[:-7]])
        return np.array([y[-7:][i % 7] for i in range(horizon)]), fitted
    mean = float(y[-28:].mean()) if len(y) else 0.0
    return np.full(horizon, mean), np.full(len(y), mean)


def run(history: list[dict], horizon: int = 14) -> dict:
    s = _series(history)
    horizon = int(max(1, min(horizon, 90)))
    if len(s) < 3:
        raise ValueError("Need at least 3 days of history to forecast.")

    hold = int(min(28, max(3, len(s) // 5)))
    scores = []
    if len(s) - hold >= 7:
        tr, truth = s.iloc[:-hold], s.iloc[-hold:].to_numpy()
        nz = truth > 0
        for m in _candidates(len(tr)):
            try:
                pred = np.clip(_fit_predict(tr, hold, m)[0], 0, None)
            except Exception:
                continue
            scores.append({
                "key": m, "method": NAMES[m],
                "mae": round(float(np.mean(np.abs(truth - pred))), 2),
                "mape": round(float(np.mean(np.abs((truth[nz] - pred[nz]) / truth[nz])) * 100), 1) if nz.any() else None,
            })
        scores.sort(key=lambda x: x["mae"])

    best = scores[0]["key"] if scores else _candidates(len(s))[-1]
    naive = next((x for x in scores if x["key"] == "seasonal_naive"), None)
    try:
        fc, fitted = _fit_predict(s, horizon, best)
    except Exception:
        best = "mean"
        fc, fitted = _fit_predict(s, horizon, best)
    fc = np.clip(fc, 0, None)

    y = s.to_numpy()
    resid = y[-len(fitted):] - fitted if len(fitted) else np.zeros(1)
    sd = float(np.std(resid)) if len(resid) > 1 else float(s.std() or 0)
    steps = np.arange(1, horizon + 1)
    band = 1.96 * sd * np.sqrt(1 + steps / 14)  # ~95% band, widening with the horizon
    days = pd.date_range(s.index.max() + pd.Timedelta(days=1), periods=horizon, freq="D")

    return {
        "method": NAMES[best],
        "history": [{"date": d.strftime("%Y-%m-%d"), "count": float(v)} for d, v in s.iloc[-120:].items()],
        "forecast": [{"date": d.strftime("%Y-%m-%d"), "count": round(float(v), 2),
                      "lower": round(float(max(0.0, v - b)), 2), "upper": round(float(v + b), 2)}
                     for d, v, b in zip(days, fc, band)],
        "expected_total": round(float(fc.sum()), 1),
        "recent_daily_avg": round(float(s.iloc[-28:].mean()), 2),
        "backtest": {"days": hold, "mae": scores[0]["mae"], "mape": scores[0]["mape"],
                     "naive_mae": naive["mae"] if naive else None, "candidates": scores} if scores else None,
        "history_days": int(len(s)),
    }
