"""
RouteWatch ML service (FastAPI).

The Node API gathers the data from MongoDB and sends it here; this service
only does the machine learning, so it needs no database credentials.
Run:  uvicorn app:app --host 127.0.0.1 --port 8000
"""
from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import numpy as np
from fastapi import BackgroundTasks, FastAPI, HTTPException
from pydantic import BaseModel, Field

from ml import clustering, forecast, severity

app = FastAPI(title="RouteWatch ML service", version="2.0.0")

# In-memory registry of async training jobs
training_jobs: Dict[str, Dict[str, Any]] = {}


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
    last_trained = None
    if bundle and severity.MODEL_PATH.exists():
        try:
            mtime = severity.MODEL_PATH.stat().st_mtime
            last_trained = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
        except Exception:
            last_trained = None
    return {
        "ok": True,
        "severity_model": bool(bundle),
        "last_trained": last_trained,
        "numpy": np.__version__
    }


@app.post("/cluster")
def cluster(req: ClusterReq):
    if len(req.points) > 120_000:
        raise HTTPException(413, "Too many points for one clustering run (max 120,000).")
    return clustering.run([p.model_dump() for p in req.points], req.eps_m, req.min_samples)


def _execute_train_job(job_id: str, rows: list[dict], n_estimators: int, max_depth: int):
    try:
        training_jobs[job_id]["status"] = "running"
        t0 = time.time()
        result = severity.train(rows, n_estimators, max_depth)
        training_jobs[job_id]["status"] = "completed"
        training_jobs[job_id]["completed_at"] = time.time()
        training_jobs[job_id]["duration_seconds"] = round(time.time() - t0, 2)
        training_jobs[job_id]["result"] = result
    except Exception as e:
        training_jobs[job_id]["status"] = "failed"
        training_jobs[job_id]["completed_at"] = time.time()
        training_jobs[job_id]["error"] = str(e)


@app.post("/train")
def train_async(background_tasks: BackgroundTasks, req: TrainReq):
    job_id = str(uuid.uuid4())
    training_jobs[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "created_at": time.time(),
        "n_samples": len(req.rows)
    }
    background_tasks.add_task(
        _execute_train_job,
        job_id,
        [r.model_dump() for r in req.rows],
        req.n_estimators,
        req.max_depth,
    )
    return {
        "job_id": job_id,
        "status": "queued",
        "message": "Model training job submitted in background."
    }


@app.get("/train/{job_id}")
def get_train_status(job_id: str):
    job = training_jobs.get(job_id)
    if not job:
        raise HTTPException(404, f"Training job '{job_id}' not found.")
    return job


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
