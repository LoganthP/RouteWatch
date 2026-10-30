# RouteWatch — Phase 2 Baseline Performance & Latency Measurements

## 1. Backend API Test Suite (`npm run test:api`)
- **Total Test Cases**: 86
- **Passed**: 86 (100%)
- **Failed**: 0
- **Overall Status**: **PASS**

### Test Categories Executed
- Authentication & Sessions: 6 tests (health, invalid credentials 401, admin login, citizen login, bad token 401, duplicate registration 409)
- Geospatial Analytics & Spatial Queries: 16 tests (bounds multi-continent 230k items, summary facets, bbox hotspots in Mysuru/London/Antimeridian, temporal rollups across 5 granularities, rush hour timezone shifts, severity and area distributions)
- Incidents CRUD, Status Workflow & GeoNear: 15 tests (incident listing, pagination, sorting, status transitions, admin authorization gates, radial $geoNear queries, polygon containment)
- Reports & Audits: 7 tests (CSV stream export, PDF generation, audit log capturing CREATE/UPDATE/STATUS/DELETE actions)
- Multi-Format Datasets & Large File Importers: 32 tests (CSV chunked upload, TSV, TXT, GeoJSON, KML, GPX, ZIP archives, PDF extract, multi-sheet Excel with empty sheets, formulas, date serials, merged cells, corrupt rejection, 60MB streaming benchmark with 55,000 rows, background cancellation, batch purging)
- Machine Learning & Forecasting: 9 tests (DBSCAN clusters, Random Forest classifier training, feature extraction, real-time prediction with local timezone awareness, Holt-Winters time-series forecasting, model card inspection)
- Route Fallbacks: 1 test (unknown route 404 JSON format)

---

## 2. Playwright Page Load & UX Performance (Desktop 1440×900)

| Metric | Dashboard (`/`) | Live Map (`/map`) | Target Threshold |
|---|---|---|---|
| **Time to Interactive (TTI)** | 2,297 ms | 285 ms | $< 1,000\text{ ms}$ |
| **Time to Full Load** | 4,510 ms | 519 ms | $< 2,000\text{ ms}$ |
| **Total Requests** | 86 | 83 | $< 40$ |
| **Transferred Bytes** | 6,214.4 KB | 6,129.9 KB | $< 2,000\text{ KB}$ |
| **JS Bundle Transferred (Dev)**| 5,913.4 KB | 5,840.1 KB | Split via React.lazy |
| **Production Single Bundle** | 1,125.3 KB (329.4 KB gzip)| - | Code-split target |
| **Average FPS (5s Pan/Zoom)** | ~60 FPS | **7 FPS** (severely degraded)| $> 45\text{ FPS}$ |

### Slowest 3 Requests
#### Dashboard (`/`)
1. `GET /api/analytics/summary`: **1,856 ms** (0.6 KB, status 200)
2. `GET /@react-refresh`: **1,097 ms** (62.7 KB, status 200)
3. `GET /@vite/client`: **1,082 ms** (134.1 KB, status 200)

#### Live Map (`/map`)
1. `GET /api/incidents/map?bbox=...&zoom=2&limit=2500`: **2,258 ms** (1.0 KB, status 200)
2. `GET /api/areas?limit=300`: **1,295 ms** (21.2 KB, status 200)
3. `GET /api/areas?limit=300` (duplicate): **1,284 ms** (21.2 KB, status 200)

---

## 3. Backend Endpoint Latency Table (5 Sequential Runs)

| Endpoint | Runs (ms) | Median | p95 / Cold | Response Size | Optimization Target |
|:---|:---:|:---:|:---:|:---:|:---|
| `GET /api/analytics/summary` | [2, 2, 2, 2, 1953] | 2 ms | **1,953 ms** | 0.6 KB | Precompute `dashboard_stats` |
| `GET /api/analytics/temporal?granularity=hour` | [2, 2, 3, 3, 514] | 3 ms | **514 ms** | 1.9 KB | LRU Cache + precomputation |
| `GET /api/analytics/temporal?granularity=dayOfWeek` | [1, 2, 2, 2, 550] | 2 ms | **550 ms** | 0.7 KB | LRU Cache + precomputation |
| `GET /api/analytics/temporal?granularity=month` | [1, 1, 2, 2, 561] | 2 ms | **561 ms** | 3.0 KB | LRU Cache + precomputation |
| `GET /api/analytics/temporal?granularity=day` | [2, 2, 2, 3, 690] | 2 ms | **690 ms** | 59.5 KB | Compression + precomputation |
| `GET /api/analytics/temporal?granularity=weekhour` | [1, 2, 2, 2, 715] | 2 ms | **715 ms** | 0.8 KB | LRU Cache |
| `GET /api/analytics/areas` | [2, 2, 2, 2, 1090] | 2 ms | **1,090 ms** | 3.6 KB | Precomputed area stats |
| `GET /api/analytics/hotspots?bbox=...` (Mysuru) | [1, 2, 3, 3, 60] | 3 ms | 60 ms | 10.9 KB | 2dsphere spatial index hit |
| `GET /api/analytics/hotspots?bbox=...` (London) | [2, 2, 2, 3, 31] | 2 ms | 31 ms | 11.1 KB | 2dsphere spatial index hit |
| `GET /api/analytics/hotspots?limit=40` (Global) | [2, 2, 3, 3, 1331] | 3 ms | **1,331 ms** | 8.6 KB | Global grid clustering cache |
| `GET /api/analytics/heatmap?limit=5000` | [3, 3, 5, 5, 852] | 5 ms | **852 ms** | 103.5 KB | In-memory cache + gzip |
| `GET /api/analytics/heatmap?limit=20000` | [3, 3, 4, 5, 918] | 4 ms | **918 ms** | 103.5 KB | Server-side cell aggregation |
| `GET /api/analytics/bounds` | [1, 2, 2, 2, 2] | 2 ms | 2 ms | 0.1 KB | Cached extent |
| `GET /api/incidents?limit=6` | [184, 186, 192, 219, 227] | 192 ms | 227 ms | 2.9 KB | Add compound index |

---

## 4. Lighthouse Desktop Audit Scores

| Page | Performance | Accessibility | Best Practices | SEO | Target |
|---|:---:|:---:|:---:|:---:|:---|
| **Dashboard (`/`)** | 74 | 93 | 100 | 82 | $\ge 90$ across all |
| **Live Map (`/map`)** | 73 | 93 | 100 | 82 | $\ge 90$ across all |

---

## 5. Query Execution Plan Analysis (`executionStats`)

### Query 1: Unindexed / Broad Date Sort (`GET /api/incidents?limit=6`)
- **Stage**: `LIMIT` over `COLLSCAN` / index scan on `reportedAt:-1`.
- **docsExamined**: 6 docs examined when sorting directly, but jumps to full collection scan when compound filters (e.g. `severity` + `reportedAt` or `status` + `reportedAt`) are queried without index alignment.
- **Root Cause**: Missing compound indexes for common filter combinations: `{ status: 1, reportedAt: -1 }` and `{ area: 1, status: 1, reportedAt: -1 }`.

### Query 2: Summary Facet (`GET /api/analytics/summary`)
- **Cold Execution Time**: ~1,950 ms on 230,000 documents.
- **Stage**: In-memory `$facet` aggregation pipeline executing 3 sub-pipelines (`$count`, `$match` severity, `$match` status) across the entire collection.
- **Root Cause**: Real-time aggregation over a massive dataset on every cold request. Solution: Precompute and store in dedicated `dashboard_stats` collection.

### Query 3: Map Viewport Clustered Query (`GET /api/incidents/map?zoom=2`)
- **Cold Execution Time**: 2,258 ms.
- **Root Cause**: Computes dynamic grid grouping ($floor division of coordinates) across 230,000 records on zoom $\le 12$.
- **FPS Impact on Map**: Leaflet rendering thousands of SVG DOM markers causes frame rate to drop to **7 FPS**.
- **Solution**: Set `preferCanvas: true` on Leaflet maps, cap maximum points to 2,000, and cache grid cell clusters server-side.
