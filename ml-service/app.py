"""
RouteWatch ML service (FastAPI).

The Node API gathers the data from MongoDB and sends it here; this service
only does the machine learning, so it needs no database credentials.
Run:  uvicorn app:app --host 127.0.0.1 --port 8000
"""
from __future__ import annotations

from typing import Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from ml import clustering, forecast, severity

app = FastAPI(title="RouteWatch ML service", version="2.0.0")


class Point(BaseModel):
    lat: float
    lng: float
    severity: str = "Low"
    type: str = "Other"
    hour: int = -1
    area: str = ""


class ClusterReq(BaseModel):
    points: list[Point]
    eps_m: float = Field(250, ge=10, le=20000)
    min_samples: int = Field(15, ge=2, le=1000)


class TrainRow(BaseModel):
    lat: float
    lng: float
    type: str
    hour: int
    dow: int
    month: int
    severity: str


class TrainReq(BaseModel):
    rows: list[TrainRow]
    n_estimators: int = Field(200, ge=10, le=600)
    max_depth: int = Field(16, ge=2, le=40)


class PredictRow(BaseModel):
    lat: float
    lng: float
    type: str
    hour: int
    dow: int
    month: int


class PredictReq(BaseModel):
    rows: list[PredictRow]


class Day(BaseModel):
    date: str
    count: float


class ForecastReq(BaseModel):
    history: list[Day]
    horizon: int = Field(14, ge=1, le=90)


@app.get("/health")
def health():
    bundle = severity.load()
    return {"ok": True, "severity_model": bool(bundle), "numpy": np.__version__}


@app.post("/cluster")
def cluster(req: ClusterReq):
    if len(req.points) > 120_000:
        raise HTTPException(413, "Too many points for one clustering run (max 120,000).")
    return clustering.run([p.model_dump() for p in req.points], req.eps_m, req.min_samples)


@app.post("/severity/train")
def train(req: TrainReq):
    try:
        return severity.train([r.model_dump() for r in req.rows], req.n_estimators, req.max_depth)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/severity/predict")
def predict(req: PredictReq):
    try:
        return {"predictions": severity.predict([r.model_dump() for r in req.rows])}
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))


@app.post("/forecast")
def run_forecast(req: ForecastReq):
    try:
        return forecast.run([d.model_dump() for d in req.history], req.horizon)
    except ValueError as e:
        raise HTTPException(400, str(e))
