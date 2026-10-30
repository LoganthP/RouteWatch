# RouteWatch backend (Python)

A Python (FastAPI) version of the RouteWatch API. It replaces **both** the Node `backend/` and the separate `ml-service/`:
the machine learning (DBSCAN, Random Forest, forecasting) now runs inside the same process, so there is **one server and one command**.

The API is identical, so the **website (`frontend/`) works unchanged**, and it uses the same MongoDB database, so you can switch between this and the Node backend without losing data (users, passwords, login tokens and incidents are compatible).

| | |
|---|---|
| Web framework | FastAPI + Uvicorn |
| Live updates | python-socketio (same events and path as before) |
| Database | PyMongo (MongoDB 6.0+ or Atlas) |
| ML | scikit-learn, statsmodels, pandas |
| Python | **3.10, 3.11, 3.12 or 3.13** (tested on 3.12) |

## 1. Setup (once)

**Windows (PowerShell or Command Prompt)**
```bat
cd backend-python
py -3.12 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

**macOS / Linux**
```bash
cd backend-python
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```
The install downloads about 400 MB (numpy, pandas, scikit-learn). If you already have the Node backend's `.env`, copy it over `.env`: the setting names are the same.

Open **`.env`** and set your database:
```env
# MongoDB Atlas (keep /routewatch_db before the "?", and use your own user and a NEW password)
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/routewatch_db?retryWrites=true&w=majority
# or local / Docker
# MONGODB_URI=mongodb://127.0.0.1:27017/routewatch_db
JWT_SECRET=paste-a-long-random-string   # python -c "import secrets; print(secrets.token_hex(32))"
```
For Atlas, allow your IP under **Security → Network Access**.

## 2. Load demo data

```bash
python seed.py                    # 30,000 synthetic incidents in 12 cities + demo accounts (about 25 seconds)
python seed.py --count 60000      # more data
python seed.py --keep-datasets    # keep incidents you imported from files
```
Already have data from the Node version? **Skip this step**: the Python backend reads the same collections. If that data came from RouteWatch 1.x (before time zones), run `python backfill.py` once.

Demo accounts: `admin@routewatch.local` / `Admin@123` and `user@routewatch.local` / `User@123`.

## 3. Start the API

```bash
python run.py              # http://localhost:5000
python run.py --reload     # development: restarts when code in app/ changes
# or, directly with uvicorn:
uvicorn app.main:app --host localhost --port 5000
```
You should see `[db] connected to routewatch_db` and `[api] RouteWatch API ready`.
Check **http://localhost:5000/api/health** → `{"ok":true,"db":"connected"}`. Interactive API docs: **http://localhost:5000/api/docs**.

> Use `--host localhost` (the default in `run.py`), not `127.0.0.1`: it listens on both IPv4 and IPv6, which the website's dev proxy needs on some machines.
> Run **one** worker (do not use `--workers`): upload sessions, import jobs and rate limits are kept in memory.

## 4. Use it with the website

Keep your existing `frontend/` folder. In a second terminal:
```bash
cd frontend
npm run dev                # http://localhost:5173
```
Do not run the old Node backend at the same time (both use port 5000), and you no longer need `ml-service/` at all.
(The old root command `npm run dev` also tries to start the Node backend and `ml-service`, so use the two terminals above instead.)

First steps: **AI insights → Severity model → Train model** (admin) once, then try **Run DBSCAN** and **Forecast**.

## 5. Tests

With the server running and the database seeded:
```bash
python tests/api_test.py                 # 85 checks: every endpoint, 9 upload formats, permissions, ML
python -m tests.test_ml                  # ML unit tests on synthetic data (does not touch your trained model)
python tests/large_file_test.py --rows 300000 --limit 50000 --sampling random
python tests/large_file_test.py --file path\to\US_Accidents_March23.csv --limit 100000 --sampling random
python benchmark.py                      # explain("executionStats"): index scan vs collection scan
```

## What is where

```
backend-python/
├─ run.py  seed.py  backfill.py  benchmark.py
├─ requirements.txt  .env.example
├─ app/
│  ├─ main.py            FastAPI app, Socket.IO, error handling, start-up (indexes, job recovery)
│  ├─ config.py  db.py  util.py  auth.py  geo.py  realtime.py
│  ├─ analytics.py       aggregation pipelines (summary, hotspots grid, temporal, severity, areas, bounds, explain)
│  ├─ routes_incidents.py  routes_misc.py  routes_ml.py
│  ├─ datasets/          resumable upload, readers (CSV, Excel, JSON, KML, GPX, PDF, ZIP), column detection, import job
│  └─ ml/                clustering.py (DBSCAN), severity.py (Random Forest), forecast.py (model selection by backtest)
├─ models/               trained severity model (created when you press "Train model")
└─ tests/                api_test.py, test_ml.py, large_file_test.py, fixtures/
```

## Settings (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `PORT`, `CLIENT_ORIGIN` | see `.env.example` | Same as the Node version |
| `SOCKET_CORS_ORIGINS` | `*` | Origins allowed to open the live-update connection (it only carries public events) |
| `UPLOAD_DIR`, `MODEL_DIR` | `.data`, `models` | Where uploads and the trained model are stored |
| `MAX_UPLOAD_MB` | 4096 | Largest upload |
| `MAX_INMEMORY_MB` | 200 | Size limit for Excel, JSON, GeoJSON, KML, GPX and PDF (they cannot be streamed; convert bigger ones to CSV) |
| `MAX_IMPORT_ROWS_ADMIN` / `_CITIZEN` | 500000 / 500 | Rows per import (citizen imports are saved as Pending) |
| `DB_QUOTA_MB` | 512 | Storage guard: imports stop at 80%; `0` turns it off |
| `GEOCODE_ENABLED`, `GEOCODE_MAX_PER_IMPORT` | true, 200 | Look up rows that have an address but no coordinates (OpenStreetMap, 1 per second) |
| `UPLOAD_INIT_RATE_LIMIT` | 200 | Upload starts allowed per IP every 15 minutes |

## How it differs from the Node version

* One process instead of two: ML runs in-process (it is imported the first time you use an AI page, which takes a few seconds).
* Same endpoints, same JSON, same Socket.IO events, same collections and indexes, same database. The MongoDB queries are the same pipelines.
* Passwords hashed by the Node version (bcryptjs) and login tokens signed by it (same `JWT_SECRET`) are accepted, and the other way round.
* PDF export uses fpdf2 instead of PDFKit; Excel reading uses openpyxl; the time zone of a coordinate comes from `tzfpy`.
* Measured on the same 1-million-row CSV: about 31,000 rows per second and 240 MB peak memory (the Node version: 23,000 rows per second and 420 MB).

## Troubleshooting

| Problem | Fix |
|---|---|
| `[db] connection failed` | Check `MONGODB_URI`; for Atlas allow your IP and check the password (special characters must be URL-encoded). |
| `pip install` fails on a very new Python | Use Python 3.10 to 3.13 (3.14 has no scikit-learn and numpy wheels pinned here yet). |
| The website says "API is not reachable" | The API is not running, or still running the old Node backend on port 5000. |
| Live updates (toasts) do not appear | Open the browser console; if it shows a blocked WebSocket, check `SOCKET_CORS_ORIGINS` and that the API runs on port 5000. |
| First AI request is slow | scikit-learn and statsmodels load on first use. |
| Import stopped at "storage limit" | Delete old datasets in the app, or lower the row limit. |
| Windows: `zoneinfo` or time zone errors | `pip install -r requirements.txt` again; it installs `tzdata`, which Windows needs. |
