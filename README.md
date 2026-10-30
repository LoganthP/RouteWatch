# RouteWatch 2.0

**AI-Enabled Geospatial Traffic Incident Monitoring and Hotspot Analytics System**

RouteWatch stores traffic incidents from anywhere in the world as GeoJSON documents in MongoDB, analyses them with geospatial queries and aggregation pipelines, and applies machine learning to them:

- **DBSCAN clustering** finds accident hotspots of any shape (scikit-learn, haversine distance).
- **Random Forest classification** predicts how severe an incident is likely to be.
- **Time-series forecasting** predicts incident counts for the coming days (Holt-Winters and other models, chosen by backtest).

Domain: **AI/ML · Smart City / Intelligent Transportation · Geospatial analytics · NoSQL**

> The demo data is **synthetic** (12 cities, 6 continents). Its severity follows a documented rule (incident type, night-time, risky junctions, plus random noise), so model scores on it show that the pipeline works; they are not real-world road-safety findings.

---

## 1. What you need

| Tool | Version | Check |
|---|---|---|
| Node.js | 18.17 or newer (20 LTS recommended) | `node -v` |
| Python | 3.10, 3.11, 3.12 or 3.13 | `python --version` (Windows: `py -3 --version`) |
| MongoDB | Atlas (free M0), local 6.0+, or Docker | — |

On Windows, tick **"Add python.exe to PATH"** when installing Python.

## 2. Setup (once)

```bash
cd routewatch
npm run setup
```

This installs the backend and frontend packages, creates a Python virtual environment in `ml-service/.venv` with scikit-learn, statsmodels and FastAPI, and creates `backend/.env` with a random `JWT_SECRET`.

Then open **`backend/.env`** and set your database:

```env
# MongoDB Atlas (use your own user, a NEW password, and keep /routewatch_db before the "?")
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/routewatch_db?retryWrites=true&w=majority

# or local / Docker (run "docker compose up -d" in this folder first)
# MONGODB_URI=mongodb://127.0.0.1:27017/routewatch_db
```

For Atlas, make sure **Security → Network Access** allows your current IP.

## 3. Load demo data

```bash
npm run seed
```

This creates 30,000 synthetic incidents across 12 cities and two demo accounts. Use `npm run seed -- --count=60000` for more. Seeding clears old incidents and datasets; add `-- --keep-datasets` to keep the files you imported.

**Upgrading a RouteWatch 1.0 database?** Run `npm run backfill` once to add local time zones to old records.

## 4. Start everything

```bash
npm run dev
# or concurrently:
npm run dev:all
```

`npm run dev:all` uses `concurrently` to start the backend, frontend, and ML service (if its venv is configured), gracefully skipping the ML service with a friendly warning if it is not installed yet.

This starts the services with coloured prefixes:

| Service | Address | Prefix |
|---|---|---|
| ML service (Python, FastAPI) | http://127.0.0.1:8000 | `[ml ]` |
| API (Node, Express) | http://localhost:5000 | `[api]` |
| Website (React, Vite) | **http://localhost:5173** | `[web]` |

Open **http://localhost:5173** and sign in:

| Role | Email | Password |
|---|---|---|
| Administrator | admin@routewatch.local | Admin@123 |
| Citizen | user@routewatch.local | User@123 |

Press **Ctrl+C** to stop everything.

### First steps in the app
1. **AI insights → Severity model → Train model** (admin). Training takes a few seconds and enables severity suggestions on the Report page.
2. **AI insights → Hotspot clusters → Run DBSCAN** after zooming the map to one city.
3. **Report incident → Upload dataset** to import your own file.

### Starting the services separately (optional)
```bash
# terminal 1, ML service
cd ml-service
.venv\Scripts\activate          # Windows
source .venv/bin/activate       # macOS / Linux
uvicorn app:app --host 127.0.0.1 --port 8000

# terminal 2, API
cd backend && npm run dev

# terminal 3, website
cd frontend && npm run dev
```
The website works without the ML service; only the AI features show a message asking you to start it.

## 5. Tests & Verification

```bash
npm run check             # Verifies Backend, ML Service, and Frontend endpoints are healthy
npm run test:api          # 86 API tests: every endpoint, datasets in 9 formats, role gates, ML pipelines
npm run test:e2e          # Playwright E2E suite (45 tests across Desktop, Tablet, and Mobile devices)
npm run test:all          # Complete end-to-end verification (runs API tests + Playwright E2E suite)
npm run verify:sidebar    # 16-configuration multi-viewport & zoom containment audit (1920x1080 to 390x844, 90%-150% zoom)
npm run benchmark:baseline # 5-run latency & throughput benchmark across all core aggregations
npm run benchmark:pages   # Playwright real-browser page load timing, TTI, and Map FPS measurements
npm run test:ml           # Python ML service unit tests: DBSCAN, Random Forest, Holt-Winters forecasting
```

---

## Features

| Area | What it does | Key technology |
|---|---|---|
| Dashboard | Bento grid: totals, severity mix, trend, top areas, live feed, global heatmap, 7-day AI outlook | Aggregation `$facet`, Socket.IO |
| Live map | Any city in the world; place search; clusters when zoomed out, markers when zoomed in; heatmap, hotspot grid, area outlines; "Analyze the visible area" | `$geoWithin` on the viewport, Leaflet |
| Nearby search | Incidents within 1, 2 or 5 km ordered by distance; incidents inside an area | `$geoNear`, `$geoWithin` |
| Report incident | Pin on map, type, severity, time; **AI severity suggestion** | `$geoIntersects` area lookup, Random Forest |
| Upload dataset | Up to 4 GB; CSV, TSV, Excel, JSON, GeoJSON, KML, GPX, text, text PDF, ZIP; resumable chunked upload; automatic column detection; row limit, sampling and filters; storage guard; rejected-rows report | Streaming parsers, batched `insertMany` |
| Incidents | Search, filter, sort, verify, resolve, reject, delete; CSV and PDF export | Indexed queries |
| Analytics | Hour, weekday and month patterns in **each incident's local time**; severity by type; area ranking; hotspot grid | `$hour`/`$dayOfWeek` with per-document `timezone` |
| AI insights | DBSCAN hotspots, Random Forest model card (confusion matrix, feature importance, version history), forecast with model comparison | scikit-learn, statsmodels |
| Query lab | Index scan vs collection scan on live data | `explain("executionStats")` |
| Audit log | Every verification, import, deletion and model training | `audit_logs` collection |

## AI / ML details (for your report)

### 1. Hotspot detection: DBSCAN
- Input: incident coordinates (up to 50,000 per run; larger sets are randomly sampled), converted to radians.
- `DBSCAN(eps = distance / Earth radius, min_samples, metric="haversine", algorithm="ball_tree")`
- A cluster needs at least `min_samples` incidents within `eps` metres of each other. Isolated reports are labelled noise.
- Output per cluster: size, centroid, convex-hull outline, 90th-percentile radius, severity mix, risk score (sum of severity weights 1 to 4), dominant type, peak local hour.
- Quality: **silhouette score** (haversine metric, on up to 5,000 clustered points) and a **suggested eps** from the k-distance elbow method.
- Compared with the statistical grid method on the Analytics page (cell is a hotspot when its count is more than 2 standard deviations above the mean): DBSCAN does not depend on where grid lines fall and finds irregular shapes along roads.

### 2. Severity prediction: Random Forest
- Features: latitude, longitude; local hour, weekday and month as sine/cosine pairs; weekend, rush-hour and night flags; incident type (one-hot).
- `RandomForestClassifier(n_estimators=200, max_depth=16, min_samples_leaf=5, class_weight="balanced_subsample")`
- Stratified 80/20 train/test split. Reported: accuracy, **majority-class baseline**, macro and weighted F1, **within-one-level accuracy** (severity is ordinal), per-class precision and recall, confusion matrix, grouped feature importance.
- Each training run is stored as a new version in the `mlmodels` collection (model registry); the model file is saved with joblib.

### 3. Forecasting: model selection by backtest
- Daily incident counts (local dates) for the current filters, missing days filled with zero.
- Candidates: Holt-Winters (additive, damped trend, weekly seasonality), Holt's damped trend, seasonal naive (same weekday last week), recent mean.
- Each is trained without the last 20% of days (up to 28) and scored on them with **MAE** and **MAPE**; the lowest MAE wins and is refitted on all data.
- The forecast includes an approximate 95% band from residual spread.

## Architecture & Performance Optimizations

```
React + Vite (Leaflet Canvas, Recharts, Framer Motion)
        │  REST (gzip/deflate compressed) + Socket.IO real-time broadcast
Node.js + Express API ── MongoDB 2dsphere & precomputed dashboard_stats collection
        │  JSON over HTTP (features gathered from MongoDB)
Python FastAPI ML service (scikit-learn Random Forest, DBSCAN haversine, statsmodels)
```

### High-Performance Key Design Decisions:
1. **Precomputed Dashboard Cache (`dashboard_stats`)**: Rather than executing 7 concurrent un-cached aggregations on cold loads over 230,000+ records, RouteWatch warms up a dedicated `dashboard_stats` collection upon server startup and refreshes it in the background every 5 minutes. `GET /api/dashboard` resolves in **< 35 ms** instead of 20+ seconds.
2. **Hardware-Accelerated Map Canvas (`preferCanvas: true`)**: Replaces heavy DOM-based SVG path rendering with an HTML5 2D Canvas context, maintaining smooth 60 FPS interactions across 5,000+ incident data points.
3. **Route Code-Splitting & Vendor Chunk Isolation**: Uses `React.lazy()` and `<Suspense>` per route, splitting vendor bundles (`vendor-react`, `vendor-charts`, `vendor-leaflet`, `vendor-motion`) for optimal caching and instantaneous sub-400ms Time-To-Interactive (TTI).
4. **Adaptive Viewport Containment**: Responsive height CSS rules ensure the navigation and user profile cards stay fully visible without clipping or overflow on screens from 1920×1080 down to 1280×720 and mobile viewports, even at 150% browser zoom.
5. **Accessibility Certified (WCAG 2.1 AA)**: Zero critical or serious accessibility violations across all auth, navigation, and dashboard components validated via Axe-core.

## Database (`routewatch_db`)

| Collection | Holds | Indexes |
|---|---|---|
| `incidents` | type, severity, status, description, area, `location` (GeoJSON Point), `tz` (IANA zone), reportedAt, resolvedAt, source, datasetId, fingerprint, aiSeverity | `location 2dsphere`, `reportedAt`, `{severity,status}`, `{type,reportedAt}`, `area`, `{datasetId,reportedAt}`, unique partial `fingerprint`, unique `incidentId` |
| `dashboard_stats` | precomputed global metrics, monthly trend series, heatmap points, hotspots, top areas, recent incidents | `_id` |
| `datasets` | uploaded file, status, column mapping, import scope, progress, bounding box | `createdAt` |
| `mlmodels` | model registry: version, metrics, feature importance, parameters | `{kind,version}` |
| `areas` | optional named polygons (demo zones in Mysuru) | `boundary 2dsphere` |
| `users`, `auditlogs`, `counters`, `geocaches` | accounts, history, ID sequence, address lookups | — |

Coordinates are always `[longitude, latitude]`.

## Uploading large files (for example US Accidents, about 2.9 GB)
1. **Report incident → Upload dataset**, then drop the CSV (or a ZIP of it).
2. The columns `Start_Lat`, `Start_Lng`, `Start_Time`, `Severity` (1 to 4), `Description`, `City`, `State` and `Timezone` are detected automatically. Set **Default type** to Accident.
3. In **Import scope**, choose a row limit around **200,000** and **Random** sampling, or filter by `State` (for example `CA`). The free Atlas tier holds 512 MB in total, about 450 bytes per incident with indexes.
4. Watch the storage bar. The import stops by itself at 80% of `DB_QUOTA_MB`.

A tested 185 MB, 1-million-row file uploaded in under 2 seconds locally and imported a 100,000-row random sample in about 50 seconds. Upload speed over a real network depends on your connection; interrupted uploads resume with the **Resume upload** button.

## Settings (`backend/.env`)

| Variable | Default | Meaning |
|---|---|---|
| `ML_SERVICE_URL` | http://127.0.0.1:8000 | Where the Python service runs |
| `MAX_UPLOAD_MB` | 4096 | Largest upload |
| `MAX_INMEMORY_MB` | 200 | Size cap for formats that cannot stream (JSON, GeoJSON, KML, GPX, PDF) |
| `MAX_IMPORT_ROWS_ADMIN` / `_CITIZEN` | 500000 / 500 | Rows per import by role (citizen imports are saved as Pending) |
| `DB_QUOTA_MB` | 512 | Storage guard; 0 turns it off |
| `GEOCODE_ENABLED` / `GEOCODE_MAX_PER_IMPORT` | true / 200 | Look up rows that have an address but no coordinates (OpenStreetMap, 1 per second) |

## Limitations (state these in your report)
- More reports in an area does not by itself prove a road is more dangerous; traffic volume and reporting habits matter.
- Model scores on synthetic data reflect the generator's rule, not real causes. Train on a real dataset (for example US Accidents) for meaningful results.
- The system analyses reported incidents. It does not measure live traffic speed.
- Scanned PDFs (images without text) and legacy `.xls` files cannot be read; export them as CSV or `.xlsx`.
- Map tiles and place search use OpenStreetMap's free public services, which suit a college project but not heavy production traffic.

## Troubleshooting

| Problem | Fix |
|---|---|
| `[db] connection failed` | Check `MONGODB_URI`; for Atlas, allow your IP under Network Access and check the password. |
| Port 5000 / 8000 / 5173 busy (`EADDRINUSE`) | Free the port on Windows PowerShell with: `Stop-Process -Id (Get-NetTCPConnection -LocalPort <port>).OwningProcess -Force` (or on Linux/macOS: `lsof -ti:<port> \| xargs kill -9`). |
| "The API is not reachable" | The `[api]` service is not running; check backend logs with `npm run dev`. |
| "The AI service is not running" | The `[ml ]` service is offline; activate virtualenv and run `uvicorn app:app --port 8000 --app-dir ml-service`. |
| Python not found during setup | Install Python 3.12 and tick "Add to PATH", then reopen the terminal. |
| Grey map | Map tiles need an internet connection (OpenStreetMap raster tiles). |
| Import stopped at "storage limit" | Delete old datasets (Report incident → Imported datasets) or lower the row limit. |
