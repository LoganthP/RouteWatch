<div align="center">

<img src="assets/banner.svg" alt="RouteWatch 2.0 banner" width="100%"/>

<a href="https://github.com/LoganthP/RouteWatch">
  <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=20&duration=3200&pause=900&color=38BDF8&center=true&vCenter=true&width=760&lines=Traffic+incidents+as+GeoJSON+in+MongoDB;DBSCAN+hotspots+of+any+shape;Random+Forest+severity+prediction;Backtested+time-series+forecasting;Anywhere+in+the+world%2C+up+to+4+GB+uploads" alt="Typing animation"/>
</a>

<br/>

![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20_LTS-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-2dsphere-47A248?style=for-the-badge&logo=mongodb&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.10--3.13-3776AB?style=for-the-badge&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![scikit-learn](https://img.shields.io/badge/scikit--learn-F7931E?style=for-the-badge&logo=scikitlearn&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?style=for-the-badge&logo=socketdotio&logoColor=white)
![Leaflet](https://img.shields.io/badge/Leaflet-199900?style=for-the-badge&logo=leaflet&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=for-the-badge&logo=playwright&logoColor=white)

![Domain](https://img.shields.io/badge/Domain-AI%2FML%20%C2%B7%20Smart%20City%20%C2%B7%20ITS-8b5cf6?style=flat-square)
![Tests](https://img.shields.io/badge/API%20tests-86-success?style=flat-square)
![E2E](https://img.shields.io/badge/Playwright%20E2E-45-success?style=flat-square)
![A11y](https://img.shields.io/badge/WCAG-2.1%20AA-blue?style=flat-square)
![Dashboard](https://img.shields.io/badge/Dashboard%20API-%3C35%20ms-orange?style=flat-square)

**[Quick Start](#-quick-start)** · **[Architecture](#-architecture)** · **[AI / ML](#-ai--ml-engine)** · **[Setup Guide](#-detailed-setup-guide)** · **[Troubleshooting](#-troubleshooting)**

</div>

<img src="assets/divider.svg" width="100%" alt=""/>

## 📖 Overview

**RouteWatch 2.0** stores traffic incidents from **anywhere in the world** as GeoJSON documents in **MongoDB**, analyses them with geospatial queries and aggregation pipelines, and applies **machine learning** on top:

| 🤖 Model | 🎯 Purpose | 🧰 Library |
|---|---|---|
| **DBSCAN** (haversine) | Finds accident hotspots of any shape | scikit-learn |
| **Random Forest** | Predicts how severe an incident is likely to be | scikit-learn |
| **Holt-Winters & friends** | Forecasts incident counts for the coming days, model chosen by backtest | statsmodels |

> [!NOTE]
> The demo data is **synthetic** (12 cities, 6 continents). Its severity follows a documented rule (incident type, night-time, risky junctions, plus random noise), so model scores on it show that the **pipeline works**. They are not real-world road-safety findings. Import a real dataset (for example *US Accidents*) for meaningful results.

<p align="center">
  <img src="assets/pipeline.svg" alt="Animated data flow between the React frontend, Express API, MongoDB and the FastAPI ML service" width="100%"/>
</p>

<img src="assets/divider.svg" width="100%" alt=""/>

## ✨ Features

| Area | What it does | Key technology |
|---|---|---|
| 📊 **Dashboard** | Bento grid: totals, severity mix, trend, top areas, live feed, global heatmap, 7-day AI outlook | Aggregation `$facet`, Socket.IO |
| 🗺️ **Live map** | Any city in the world; place search; clusters when zoomed out, markers when zoomed in; heatmap, hotspot grid, area outlines; *Analyze the visible area* | `$geoWithin` on the viewport, Leaflet |
| 📍 **Nearby search** | Incidents within 1, 2 or 5 km ordered by distance; incidents inside an area | `$geoNear`, `$geoWithin` |
| 📝 **Report incident** | Pin on map, type, severity, time, with an **AI severity suggestion** | `$geoIntersects`, Random Forest |
| 📤 **Upload dataset** | Up to 4 GB; CSV, TSV, Excel, JSON, GeoJSON, KML, GPX, text, text PDF, ZIP; resumable chunked upload; automatic column detection; row limit, sampling and filters; storage guard; rejected-rows report | Streaming parsers, batched `insertMany` |
| 🗂️ **Incidents** | Search, filter, sort, verify, resolve, reject, delete; CSV and PDF export | Indexed queries |
| 📈 **Analytics** | Hour, weekday and month patterns in **each incident's local time**; severity by type; area ranking; hotspot grid | `$hour` / `$dayOfWeek` with per-document `tz` |
| 🧠 **AI insights** | DBSCAN hotspots, Random Forest model card (confusion matrix, feature importance, version history), forecast with model comparison | scikit-learn, statsmodels |
| 🔬 **Query lab** | Index scan vs collection scan on live data | `explain("executionStats")` |
| 🧾 **Audit log** | Every verification, import, deletion and model training | `audit_logs` collection |

<img src="assets/divider.svg" width="100%" alt=""/>

## 🧰 Tech Stack

| Layer | Technology | Role |
|---|---|---|
| **Frontend** | React, Vite, React Router (lazy routes) | SPA with route code-splitting and vendor chunk isolation |
| | Leaflet (Canvas renderer) | Interactive world map, clusters, heatmap |
| | Recharts, Framer Motion | Charts and animations |
| **Backend** | Node.js 18.17+ (20 LTS recommended), Express | REST API, auth, uploads, import pipeline |
| | Socket.IO | Real-time incident broadcast |
| | JWT | Role-based authentication (Admin / Citizen) |
| **Database** | MongoDB (Atlas M0, local 6.0+, or Docker) | GeoJSON storage, `2dsphere` indexes, aggregation pipelines |
| **ML service** | Python 3.10 to 3.13, FastAPI, Uvicorn | Model-serving microservice |
| | scikit-learn | DBSCAN, Random Forest |
| | statsmodels | Holt-Winters and damped-trend forecasting |
| | joblib | Model persistence |
| **Quality** | Playwright, Axe-core, Lighthouse | E2E, accessibility, performance |
| **DevOps** | Docker Compose, `concurrently`, npm scripts | One-command setup and startup |

<img src="assets/divider.svg" width="100%" alt=""/>

## 🏗️ Architecture

### System overview

```mermaid
flowchart LR
    subgraph Client["🖥️ Browser"]
        UI["React + Vite<br/>Leaflet · Recharts · Framer Motion"]
    end

    subgraph API["⚙️ Node.js + Express :5000"]
        REST["REST API<br/>(gzip / deflate)"]
        WS["Socket.IO<br/>real-time broadcast"]
        IMP["Import pipeline<br/>streaming parsers"]
        CACHE["Dashboard cache<br/>refresh every 5 min"]
    end

    subgraph DB["🍃 MongoDB"]
        INC[("incidents<br/>2dsphere")]
        DS[("dashboard_stats")]
        ML[("mlmodels")]
        OTH[("users · datasets<br/>auditlogs · areas")]
    end

    subgraph PY["🐍 FastAPI ML service :8000"]
        DBS["DBSCAN<br/>haversine"]
        RF["Random Forest<br/>severity"]
        FC["Forecast<br/>Holt-Winters + backtest"]
    end

    UI -->|HTTPS / JSON| REST
    UI <-->|events| WS
    REST --> INC
    IMP --> INC
    CACHE --> DS
    REST --> DS
    REST --> ML
    REST --> OTH
    REST -->|features as JSON| DBS
    REST --> RF
    REST --> FC
    RF -.->|model versions| ML
```

### Request flow: AI severity suggestion

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant W as React App
    participant A as Express API
    participant M as MongoDB
    participant P as FastAPI ML

    U->>W: Drops pin, selects incident type
    W->>A: POST /api/ml/severity (lat, lng, type, time)
    A->>M: $geoIntersects area lookup + local timezone
    M-->>A: area, tz
    A->>P: features (sin/cos time, flags, one-hot type)
    P->>P: RandomForest.predict_proba()
    P-->>A: severity 1-4 + confidence
    A-->>W: suggestion
    W-->>U: "Suggested severity: 3 (82%)"
    U->>W: Confirms and submits
    W->>A: POST /api/incidents
    A->>M: insert GeoJSON Point
    A-->>W: 201 Created
    A--)W: Socket.IO: new incident (live feed)
```

### Dataset upload and import

```mermaid
flowchart TD
    A([Drop file ≤ 4 GB]) --> B[Chunked, resumable upload]
    B --> C{Format?}
    C -->|CSV / TSV / Excel / ZIP| D[Streaming parser]
    C -->|JSON / GeoJSON / KML / GPX / PDF| E["In-memory parser<br/>(≤ MAX_INMEMORY_MB)"]
    D --> F[Automatic column detection]
    E --> F
    F --> G["Import scope<br/>row limit · sampling · filters"]
    G --> H{Storage below<br/>80% of DB_QUOTA_MB?}
    H -->|No| X([Import stops safely])
    H -->|Yes| I["Batched insertMany<br/>fingerprint de-duplication"]
    I --> J[(incidents)]
    I --> K[Rejected-rows report]
    J --> L[Refresh dashboard_stats]
```

### Database model

```mermaid
erDiagram
    USERS ||--o{ INCIDENTS : reports
    USERS ||--o{ AUDITLOGS : performs
    DATASETS ||--o{ INCIDENTS : imports
    AREAS ||--o{ INCIDENTS : contains
    MLMODELS ||--o{ INCIDENTS : "aiSeverity"

    INCIDENTS {
        string incidentId UK
        string type
        int severity
        string status
        point location "GeoJSON [lng, lat]"
        string tz "IANA zone"
        date reportedAt
        string fingerprint UK
        int aiSeverity
    }
    DATASETS {
        string status
        object columnMapping
        object importScope
        object boundingBox
    }
    MLMODELS {
        string kind
        int version
        object metrics
        object featureImportance
    }
    AREAS {
        string name
        polygon boundary "2dsphere"
    }
    USERS {
        string email UK
        string role
    }
    AUDITLOGS {
        string action
        date at
    }
```

### Performance decisions

1. **Precomputed dashboard cache (`dashboard_stats`)**: warmed at server start and refreshed every 5 minutes, so `GET /api/dashboard` resolves in **under 35 ms** instead of 20+ seconds of cold aggregation over 230,000+ records.
2. **Canvas map rendering (`preferCanvas: true`)**: smooth 60 FPS with 5,000+ points.
3. **Route code-splitting and vendor chunks**: `React.lazy()` per route plus `vendor-react`, `vendor-charts`, `vendor-leaflet`, `vendor-motion`, for time-to-interactive under 400 ms.
4. **Adaptive viewport containment**: sidebar and profile cards stay visible from 1920×1080 down to mobile and at 150% zoom.
5. **Accessibility**: zero critical or serious Axe-core violations (WCAG 2.1 AA).

<img src="assets/divider.svg" width="100%" alt=""/>

## 🧠 AI / ML Engine

### 1. Hotspot detection: DBSCAN

- **Input**: incident coordinates (up to 50,000 per run, larger sets are randomly sampled), converted to radians.
- **Model**: `DBSCAN(eps = distance / Earth radius, min_samples, metric="haversine", algorithm="ball_tree")`.
- **Output per cluster**: size, centroid, convex-hull outline, 90th-percentile radius, severity mix, risk score (sum of severity weights 1 to 4), dominant type, peak local hour.
- **Quality**: silhouette score (haversine, up to 5,000 clustered points) and a suggested `eps` from the k-distance elbow method.
- **Versus the grid method**: the Analytics page flags a cell when its count is more than 2 standard deviations above the mean. DBSCAN does not depend on where grid lines fall and finds irregular shapes along roads.

### 2. Severity prediction: Random Forest

- **Features**: latitude, longitude; local hour, weekday and month as sine/cosine pairs; weekend, rush-hour and night flags; incident type (one-hot).
- **Model**: `RandomForestClassifier(n_estimators=200, max_depth=16, min_samples_leaf=5, class_weight="balanced_subsample")`.
- **Evaluation**: stratified 80/20 split. Reports accuracy, **majority-class baseline**, macro and weighted F1, **within-one-level accuracy** (severity is ordinal), per-class precision and recall, confusion matrix, grouped feature importance.
- **Registry**: every training run is stored as a new version in `mlmodels`; the model file is saved with joblib.

### 3. Forecasting: model selection by backtest

- **Series**: daily incident counts in local dates for the current filters, missing days filled with zero.
- **Candidates**: Holt-Winters (additive, damped trend, weekly seasonality), Holt's damped trend, seasonal naive, recent mean.
- **Selection**: each model is trained without the last 20% of days (up to 28) and scored with **MAE** and **MAPE**. The lowest MAE wins and is refitted on all data.
- **Output**: forecast with an approximate 95% band from residual spread.

<img src="assets/divider.svg" width="100%" alt=""/>

## ⚡ Quick Start

```bash
git clone https://github.com/LoganthP/RouteWatch.git
cd RouteWatch
npm run setup          # installs deps, creates ML venv, creates backend/.env
# edit backend/.env and set MONGODB_URI
npm run seed           # 30,000 synthetic incidents + 2 demo accounts
npm run dev:all        # starts ML service, API and website together
```

Open **http://localhost:5173** and sign in:

| Role | Email | Password |
|---|---|---|
| 🛡️ Administrator | `admin@routewatch.local` | `Admin@123` |
| 👤 Citizen | `user@routewatch.local` | `User@123` |

> [!WARNING]
> These are demo credentials for local use only. Change them before deploying anywhere public.

<img src="assets/divider.svg" width="100%" alt=""/>

## 🛠️ Detailed Setup Guide

### Step 1: Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | 18.17 or newer (20 LTS recommended) | `node -v` |
| Python | 3.10, 3.11, 3.12 or 3.13 | `python --version` (Windows: `py -3 --version`) |
| MongoDB | Atlas (free M0), local 6.0+, or Docker | `mongosh --version` or `docker --version` |
| Git | any recent version | `git --version` |

> On Windows, tick **"Add python.exe to PATH"** when installing Python.

### Step 2: Clone and install

```bash
git clone https://github.com/LoganthP/RouteWatch.git
cd RouteWatch
npm run setup
```

`npm run setup` does three things:

1. Installs the backend and frontend packages.
2. Creates a Python virtual environment in `ml-service/.venv` with scikit-learn, statsmodels and FastAPI.
3. Creates `backend/.env` with a random `JWT_SECRET`.

<details>
<summary><b>Prefer to install each part manually?</b></summary>

```bash
# Root tooling (concurrently, Playwright, scripts)
npm install

# Backend
cd backend && npm install && cd ..

# Frontend
cd frontend && npm install && cd ..

# ML service
cd ml-service
python -m venv .venv

# Windows (PowerShell)
.venv\Scripts\Activate.ps1
# macOS / Linux
source .venv/bin/activate

pip install --upgrade pip
pip install -r requirements.txt
cd ..
```

</details>

### Step 3: Configure the database and `.env`

Create or edit **`backend/.env`**:

```env
# ───────────── Server ─────────────
PORT=5000

# ───────────── Database ─────────────
# Option A: MongoDB Atlas (keep /routewatch_db before the "?")
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/routewatch_db?retryWrites=true&w=majority

# Option B: local MongoDB or Docker (run "docker compose up -d" first)
# MONGODB_URI=mongodb://127.0.0.1:27017/routewatch_db

# ───────────── Auth ─────────────
# npm run setup generates this for you. To make your own:
# node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_SECRET=replace_with_a_long_random_string

# ───────────── ML service ─────────────
ML_SERVICE_URL=http://127.0.0.1:8000

# ───────────── Uploads and import limits ─────────────
MAX_UPLOAD_MB=4096
MAX_INMEMORY_MB=200
MAX_IMPORT_ROWS_ADMIN=500000
MAX_IMPORT_ROWS_CITIZEN=500

# ───────────── Storage guard (0 turns it off) ─────────────
DB_QUOTA_MB=512

# ───────────── Geocoding (OpenStreetMap, 1 request per second) ─────────────
GEOCODE_ENABLED=true
GEOCODE_MAX_PER_IMPORT=200
```

| Variable | Default | Meaning |
|---|---|---|
| `MONGODB_URI` | none (required) | MongoDB connection string. Use your own user and a **new** password. |
| `JWT_SECRET` | generated | Secret used to sign login tokens. Never commit it. |
| `ML_SERVICE_URL` | `http://127.0.0.1:8000` | Where the Python service runs |
| `MAX_UPLOAD_MB` | `4096` | Largest upload |
| `MAX_INMEMORY_MB` | `200` | Size cap for formats that cannot stream (JSON, GeoJSON, KML, GPX, PDF) |
| `MAX_IMPORT_ROWS_ADMIN` / `_CITIZEN` | `500000` / `500` | Rows per import by role (citizen imports are saved as *Pending*) |
| `DB_QUOTA_MB` | `512` | Storage guard; imports stop at 80% of this value |
| `GEOCODE_ENABLED` / `GEOCODE_MAX_PER_IMPORT` | `true` / `200` | Look up rows that have an address but no coordinates |

> [!IMPORTANT]
> For **Atlas**, open *Security → Network Access* and allow your current IP, otherwise you will see `[db] connection failed`.
> Make sure `.env` is listed in `.gitignore` so credentials are never pushed.

**Local MongoDB with Docker:**

```bash
docker compose up -d      # starts MongoDB from the repo's docker-compose.yml
docker compose ps         # confirm it is running
```

### Step 4: Load demo data

```bash
npm run seed                          # 30,000 incidents, 12 cities, 2 demo accounts
npm run seed -- --count=60000         # more data
npm run seed -- --keep-datasets       # keep files you already imported
```

> Seeding clears old incidents and datasets. Upgrading from RouteWatch 1.0? Run `npm run backfill` once to add local time zones to old records.

### Step 5: Start the services

#### Option A: everything with one command

```bash
npm run dev:all       # or: npm run dev
```

`concurrently` starts all three services with coloured prefixes. If the ML virtual environment is not set up yet, the ML service is skipped with a friendly warning.

| Service | Address | Log prefix |
|---|---|---|
| 🐍 ML service (Python, FastAPI) | http://127.0.0.1:8000 | `[ml ]` |
| ⚙️ API (Node, Express) | http://localhost:5000 | `[api]` |
| 🌐 Website (React, Vite) | **http://localhost:5173** | `[web]` |

Press **Ctrl + C** to stop everything.

#### Option B: each service in its own terminal

**Terminal 1: ML service (FastAPI)**

```bash
cd ml-service

# activate the virtual environment
.venv\Scripts\Activate.ps1          # Windows PowerShell
# .venv\Scripts\activate.bat        # Windows cmd
# source .venv/bin/activate         # macOS / Linux

uvicorn app:app --host 127.0.0.1 --port 8000
# add --reload while developing
```

Windows shortcut using the included script:

```powershell
./start-ml.ps1
```

**Terminal 2: Backend (Express API)**

```bash
cd backend
npm run dev
```

**Terminal 3: Frontend (React + Vite)**

```bash
cd frontend
npm run dev
```

**From the project root, without activating the venv**

```bash
uvicorn app:app --port 8000 --app-dir ml-service
```

> The website works without the ML service. Only the AI features show a message asking you to start it.

#### Verify that everything is healthy

```bash
npm run check          # checks backend, ML service and frontend endpoints
curl http://127.0.0.1:8000/docs       # FastAPI interactive docs
curl http://localhost:5000/api/dashboard
```

### Step 6: First steps in the app

1. **AI insights → Severity model → Train model** (admin). Takes a few seconds and enables severity suggestions on the Report page.
2. **AI insights → Hotspot clusters → Run DBSCAN** after zooming the map to one city.
3. **Report incident → Upload dataset** to import your own file.

<img src="assets/divider.svg" width="100%" alt=""/>

## 📦 Uploading Large Datasets (for example US Accidents, about 2.9 GB)

1. **Report incident → Upload dataset**, then drop the CSV (or a ZIP of it).
2. `Start_Lat`, `Start_Lng`, `Start_Time`, `Severity` (1 to 4), `Description`, `City`, `State` and `Timezone` are detected automatically. Set **Default type** to *Accident*.
3. Under **Import scope**, choose a row limit around **200,000** with **Random** sampling, or filter by `State` (for example `CA`). The free Atlas tier holds 512 MB in total, roughly 450 bytes per incident including indexes.
4. Watch the storage bar. The import stops by itself at 80% of `DB_QUOTA_MB`.

A tested 185 MB, 1-million-row file uploaded in under 2 seconds locally and a 100,000-row random sample imported in about 50 seconds. Interrupted uploads resume with the **Resume upload** button.

## 🗄️ Database (`routewatch_db`)

| Collection | Holds | Indexes |
|---|---|---|
| `incidents` | type, severity, status, description, area, `location` (GeoJSON Point), `tz`, reportedAt, resolvedAt, source, datasetId, fingerprint, aiSeverity | `location 2dsphere`, `reportedAt`, `{severity,status}`, `{type,reportedAt}`, `area`, `{datasetId,reportedAt}`, unique partial `fingerprint`, unique `incidentId` |
| `dashboard_stats` | precomputed global metrics, trend series, heatmap points, hotspots, top areas, recent incidents | `_id` |
| `datasets` | uploaded file, status, column mapping, import scope, progress, bounding box | `createdAt` |
| `mlmodels` | model registry: version, metrics, feature importance, parameters | `{kind,version}` |
| `areas` | optional named polygons (demo zones in Mysuru) | `boundary 2dsphere` |
| `users`, `auditlogs`, `counters`, `geocaches` | accounts, history, ID sequence, address lookups | none |

> Coordinates are always stored as `[longitude, latitude]`.

<img src="assets/divider.svg" width="100%" alt=""/>

## 🧪 Tests and Verification

```bash
npm run check               # backend, ML service and frontend health
npm run test:api            # 86 API tests: endpoints, 9 dataset formats, role gates, ML pipelines
npm run test:e2e            # Playwright E2E: 45 tests on Desktop, Tablet and Mobile
npm run test:all            # API tests + Playwright E2E
npm run test:ml             # Python tests: DBSCAN, Random Forest, Holt-Winters
npm run verify:sidebar      # 16-configuration viewport and zoom containment audit
npm run benchmark:baseline  # 5-run latency and throughput benchmark
npm run benchmark:pages     # real-browser load timing, TTI and map FPS
```

## 📁 Project Structure

```text
RouteWatch/
├── backend/                 # Node.js + Express API, import pipeline, Socket.IO
├── frontend/                # React + Vite single-page app
├── ml-service/              # FastAPI service (DBSCAN, Random Forest, forecasting)
│   └── .venv/               # Python virtual environment (created by setup)
├── e2e/                     # Playwright end-to-end tests
├── scripts/                 # seed, backfill, check, benchmark helpers
├── docs/                    # Additional documentation
├── docker-compose.yml       # Local MongoDB
├── start-ml.ps1             # Windows helper to start the ML service
├── QA_REPORT.md             # Quality assurance report
└── package.json             # Root scripts: setup, seed, dev, dev:all, test:*
```

## ⚠️ Limitations

- More reports in an area do not by themselves prove a road is more dangerous; traffic volume and reporting habits matter.
- Model scores on synthetic data reflect the generator's rule, not real causes.
- The system analyses **reported incidents**. It does not measure live traffic speed.
- Scanned PDFs (images without text) and legacy `.xls` files cannot be read. Export them as CSV or `.xlsx`.
- Map tiles and place search use OpenStreetMap's free public services, which suit a college project but not heavy production traffic.

## 🩺 Troubleshooting

| Problem | Fix |
|---|---|
| `[db] connection failed` | Check `MONGODB_URI`. For Atlas, allow your IP under Network Access and verify the password. |
| Port 5000 / 8000 / 5173 busy (`EADDRINUSE`) | **Windows:** `Stop-Process -Id (Get-NetTCPConnection -LocalPort <port>).OwningProcess -Force`<br/>**Linux / macOS:** `lsof -ti:<port> \| xargs kill -9` |
| "The API is not reachable" | The `[api]` service is not running. Check the backend logs from `npm run dev`. |
| "The AI service is not running" | The `[ml ]` service is offline. Activate the venv and run `uvicorn app:app --port 8000 --app-dir ml-service`. |
| Python not found during setup | Install Python 3.12 and tick *Add to PATH*, then reopen the terminal. |
| PowerShell blocks venv activation | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once. |
| Grey map | Map tiles need an internet connection (OpenStreetMap raster tiles). |
| Import stopped at "storage limit" | Delete old datasets (*Report incident → Imported datasets*) or lower the row limit. |

<img src="assets/divider.svg" width="100%" alt=""/>

## 👨‍💻 Author

**Loganth P**, final-year B.E. Computer Science and Engineering, Vidyavardhaka College of Engineering, Mysuru.

[![GitHub](https://img.shields.io/badge/GitHub-LoganthP-181717?style=for-the-badge&logo=github)](https://github.com/LoganthP)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Loganth%20P-0A66C2?style=for-the-badge&logo=linkedin)](https://www.linkedin.com/in/loganth-p-158667280/)
[![Email](https://img.shields.io/badge/Email-loganthp55%40gmail.com-D14836?style=for-the-badge&logo=gmail&logoColor=white)](mailto:loganthp55@gmail.com)

<div align="center">

⭐ If you find RouteWatch useful, consider starring the repository.

</div>
