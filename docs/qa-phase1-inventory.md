# RouteWatch — Phase 1 QA Inventory & System Matrix

## 1. Backend Route Inventory

| Method | Path | Auth Required | Role | Source File | Description |
|---|---|---|---|---|---|
| `GET` | `/api/health` | No | Public | `backend/src/server.js` | Backend health & MongoDB connection status |
| `POST` | `/api/auth/register` | No | Public | `backend/src/routes/auth.js` | User registration (default role: user) |
| `POST` | `/api/auth/login` | No | Public | `backend/src/routes/auth.js` | User login (returns JWT token & safe user) |
| `GET` | `/api/auth/me` | Yes | Any | `backend/src/routes/auth.js` | Current authenticated user profile |
| `GET` | `/api/incidents` | No | Public | `backend/src/routes/incidents.js` | Paginated, filtered incidents list |
| `GET` | `/api/incidents/map` | No | Public | `backend/src/routes/incidents.js` | Geo-clustered or raw incident points for map viewports |
| `GET` | `/api/incidents/nearby` | No | Public | `backend/src/routes/incidents.js` | GeoNear radial query ordered by distance |
| `POST` | `/api/incidents/within` | No | Public | `backend/src/routes/incidents.js` | Incidents within GeoJSON Polygon boundary |
| `GET` | `/api/incidents/:id` | No | Public | `backend/src/routes/incidents.js` | Single incident details by incidentId or _id |
| `POST` | `/api/incidents` | Yes | Any | `backend/src/routes/incidents.js` | Create incident report (citizen=Pending, admin=Verified) |
| `PATCH` | `/api/incidents/:id` | Yes | Admin | `backend/src/routes/incidents.js` | Update incident properties |
| `PATCH` | `/api/incidents/:id/status`| Yes | Admin | `backend/src/routes/incidents.js` | Transition status (Verified, Resolved, Rejected) |
| `DELETE`| `/api/incidents/:id` | Yes | Admin | `backend/src/routes/incidents.js` | Delete incident and audit action |
| `GET` | `/api/analytics/summary` | No | Public | `backend/src/routes/analytics.js` | Total, active, severity counts, and resolution stats |
| `GET` | `/api/analytics/hotspots` | No | Public | `backend/src/routes/analytics.js` | Grid-based spatial hotspot detection (>2 std-dev) |
| `GET` | `/api/analytics/temporal` | No | Public | `backend/src/routes/analytics.js` | Time series breakdown (hour, day, month, weekhour) |
| `GET` | `/api/analytics/severity` | No | Public | `backend/src/routes/analytics.js` | Severity level counts and percentages |
| `GET` | `/api/analytics/areas` | No | Public | `backend/src/routes/analytics.js` | Top areas by incident volume and bounding boxes |
| `GET` | `/api/analytics/heatmap` | No | Public | `backend/src/routes/analytics.js` | Weighted coordinate pairs for heat layer |
| `GET` | `/api/analytics/bounds` | No | Public | `backend/src/routes/analytics.js` | Global extent [w, s, e, n] and geographic centre |
| `GET` | `/api/analytics/performance` | No | Public | `backend/src/routes/analytics.js` | ExecutionStats comparing 2dsphere index vs COLLSCAN |
| `GET` | `/api/areas` | No | Public | `backend/src/routes/areas.js` | Dynamic data-driven areas + stored named polygons |
| `GET` | `/api/areas/:name/incidents` | No | Public | `backend/src/routes/areas.js` | Incidents bounded within an area polygon |
| `GET` | `/api/reports/csv` | No | Public | `backend/src/routes/reports.js` | Stream all filtered incidents as CSV |
| `GET` | `/api/reports/pdf` | No | Public | `backend/src/routes/reports.js` | Render executive summary PDF report |
| `GET` | `/api/audit` | Yes | Admin | `backend/src/routes/audit.js` | Audit trail of administrative and incident actions |
| `GET` | `/api/datasets/limits` | Yes | Any | `backend/src/routes/datasets.js` | Upload size, row caps, and formats supported |
| `GET` | `/api/datasets/storage` | Yes | Any | `backend/src/routes/datasets.js` | Storage directories, file counts, and disk usage |
| `POST` | `/api/datasets/upload/init` | Yes | Any | `backend/src/routes/datasets.js` | Initiate chunked session for dataset file |
| `GET` | `/api/datasets/upload/:uploadId` | Yes | Owner | `backend/src/routes/datasets.js` | Query uploaded chunk indexes for resumption |
| `PUT` | `/api/datasets/upload/:uploadId/chunk` | Yes | Owner | `backend/src/routes/datasets.js` | Stream binary file slice with index validation |
| `DELETE`| `/api/datasets/upload/:uploadId` | Yes | Owner | `backend/src/routes/datasets.js` | Cancel and delete active upload session |
| `POST` | `/api/datasets/upload/:uploadId/complete` | Yes | Owner | `backend/src/routes/datasets.js` | Reassemble, verify magic bytes, produce preview |
| `GET` | `/api/datasets` | Yes | Any | `backend/src/routes/datasets.js` | List uploaded/importing/completed datasets |
| `GET` | `/api/datasets/:id` | Yes | Any | `backend/src/routes/datasets.js` | Dataset metadata, schema preview, and progress |
| `POST` | `/api/datasets/:id/import` | Yes | Owner/Admin | `backend/src/routes/datasets.js` | Execute batch import with column mappings |
| `POST` | `/api/datasets/:id/cancel` | Yes | Any | `backend/src/routes/datasets.js` | Abort active dataset import pipeline |
| `GET` | `/api/datasets/:id/rejected.csv` | Yes | Any | `backend/src/routes/datasets.js` | Stream rejected row logs for validation errors |
| `DELETE`| `/api/datasets/:id` | Yes | Admin | `backend/src/routes/datasets.js` | Purge dataset metadata and imported incidents |
| `GET` | `/api/ml/status` | No | Public | `backend/src/routes/ml.js` | ML service connectivity and latest model metadata |
| `GET` | `/api/ml/health` | No | Public | `backend/src/routes/ml.js` | Direct health proxy to FastAPI service |
| `POST` | `/api/ml/clusters` | Yes | Any | `backend/src/routes/ml.js` | Spatial DBSCAN clustering via FastAPI |
| `POST` | `/api/ml/severity/train` | Yes | Admin | `backend/src/routes/ml.js` | Train Random Forest classifier on MongoDB samples |
| `GET` | `/api/ml/severity/model` | No | Public | `backend/src/routes/ml.js` | Inspect current trained severity model card |
| `POST` | `/api/ml/severity/predict` | No | Public | `backend/src/routes/ml.js` | Infer incident severity from location & local time |
| `POST` | `/api/ml/forecast` | No | Public | `backend/src/routes/ml.js` | Holt-Winters time-series forecast on daily volumes |

---

## 2. Frontend API Calls & Cross-Check Matrix

| Frontend File | Target URL | Method | Params / Body | Status / Alignment |
|---|---|---|---|---|
| `context/AuthContext.jsx` | `/auth/login` | `POST` | `{ email, password }` | Exact match |
| `context/AuthContext.jsx` | `/auth/register` | `POST` | `{ name, email, password }` | Exact match |
| `context/AuthContext.jsx` | `/auth/me` | `GET` | Headers: Bearer token | Exact match |
| `pages/Dashboard.jsx` | `/analytics/summary` | `GET` | `{}` | Exact match |
| `pages/Dashboard.jsx` | `/analytics/temporal`| `GET` | `{ granularity: 'month' }` | Exact match |
| `pages/Dashboard.jsx` | `/analytics/heatmap` | `GET` | `{ limit: 5000 }` | Exact match |
| `pages/Dashboard.jsx` | `/analytics/bounds` | `GET` | `{}` | Exact match |
| `pages/Dashboard.jsx` | `/analytics/hotspots`| `GET` | `{ limit: 40 }` | Exact match |
| `pages/Dashboard.jsx` | `/analytics/areas` | `GET` | `{ limit: 5 }` | Exact match |
| `pages/Dashboard.jsx` | `/incidents` | `GET` | `{ limit: 6 }` | Exact match |
| `pages/Dashboard.jsx` | `/ml/forecast` | `POST` | `{ horizon: 7 }` | Exact match |
| `pages/LiveMap.jsx` | `/incidents/map` | `GET` | `{ bbox, zoom, type, severity, status, from, to }` | Exact match |
| `pages/LiveMap.jsx` | `/analytics/bounds` | `GET` | `{}` | Exact match |
| `pages/LiveMap.jsx` | `/analytics/heatmap` | `GET` | `{ bbox, limit: 10000 }` | Exact match |
| `pages/LiveMap.jsx` | `/analytics/hotspots`| `GET` | `{ bbox, limit: 40 }` | Exact match |
| `pages/Nearby.jsx` | `/areas` | `GET` | `{}` | Exact match |
| `pages/Nearby.jsx` | `/areas/:name/incidents` | `GET` | `{}` | Exact match |
| `pages/Nearby.jsx` | `/incidents/nearby` | `GET` | `{ lng, lat, radius, type, severity }` | Exact match |
| `pages/ReportIncident.jsx`| `/incidents` | `POST` | `{ title, type, severity, description, location }` | Exact match |
| `pages/ReportIncident.jsx`| `/ml/severity/predict` | `POST` | `{ lng, lat, type, datetime }` | Exact match |
| `pages/Incidents.jsx` | `/incidents` | `GET` | `{ page, limit, type, severity, status, area, search, sort, dir }` | Exact match |
| `pages/Incidents.jsx` | `/incidents/:id/status`| `PATCH` | `{ status, note }` | Exact match |
| `pages/Incidents.jsx` | `/incidents/:id` | `DELETE` | Headers: Bearer token | Exact match |
| `pages/Incidents.jsx` | `/reports/csv` | `GET` | Stream download with query filters | Exact match |
| `pages/Incidents.jsx` | `/reports/pdf` | `GET` | Stream download with query filters | Exact match |
| `pages/Analytics.jsx` | `/analytics/summary` | `GET` | Filters `{ type, severity, area, from, to }` | Exact match |
| `pages/Analytics.jsx` | `/analytics/temporal`| `GET` | `{ granularity, ...filters }` | Exact match |
| `pages/Analytics.jsx` | `/analytics/severity`| `GET` | Filters `{ area, from, to }` | Exact match |
| `pages/Analytics.jsx` | `/analytics/areas` | `GET` | `{ limit: 10, ...filters }` | Exact match |
| `pages/Analytics.jsx` | `/analytics/bounds` | `GET` | Filters `{ ...filters }` | Exact match |
| `pages/AIInsights.jsx` | `/ml/status` | `GET` | `{}` | Exact match |
| `pages/AIInsights.jsx` | `/ml/severity/model` | `GET` | `{}` | Exact match |
| `pages/AIInsights.jsx` | `/ml/severity/train` | `POST` | `{ n_estimators, max_rows, max_depth }` | Exact match |
| `pages/AIInsights.jsx` | `/ml/severity/predict` | `POST` | `{ lng, lat, type, datetime }` | Exact match |
| `pages/AIInsights.jsx` | `/ml/clusters` | `POST` | `{ eps_m, min_samples, filters }` | Exact match |
| `pages/AIInsights.jsx` | `/ml/forecast` | `POST` | `{ horizon }` | Exact match |
| `pages/QueryLab.jsx` | `/analytics/performance` | `GET` | `{ lng, lat, radius }` | Exact match |
| `pages/QueryLab.jsx` | `/analytics/bounds` | `GET` | `{}` | Exact match |
| `pages/AuditLog.jsx` | `/audit` | `GET` | `{ limit: 100, incidentId }` | Exact match |
| `components/UploadWizard.jsx` | `/datasets/limits` | `GET` | `{}` | Exact match |
| `components/UploadWizard.jsx` | `/datasets/upload/init` | `POST` | `{ filename, size }` | Exact match |
| `components/UploadWizard.jsx` | `/datasets/upload/:id/chunk` | `PUT` | Raw binary chunk slice | Exact match |
| `components/UploadWizard.jsx` | `/datasets/upload/:id/complete` | `POST` | `{}` | Exact match |
| `components/UploadWizard.jsx` | `/datasets/:id/import` | `POST` | `{ mapping, defaults, scope, tzMode, dayFirst }` | Exact match |
| `components/UploadWizard.jsx` | `/datasets/:id/cancel` | `POST` | `{}` | Exact match |
| `components/DatasetsPanel.jsx` | `/datasets` | `GET` | `{}` | Exact match |
| `components/DatasetsPanel.jsx` | `/datasets/storage` | `GET` | `{}` | Exact match |
| `components/DatasetsPanel.jsx` | `/datasets/:id` | `DELETE` | Headers: Bearer token | Exact match |
| `components/DatasetsPanel.jsx` | `/datasets/:id/rejected.csv` | `GET` | Download stream | Exact match |

### Cross-Check Observations
- Zero dead frontend routes: every call made in frontend maps to an active Express endpoint.
- Intentional API-only backend routes:
  - `POST /api/incidents/within`: programmatic boundary queries / GIS integrations.
  - `PATCH /api/incidents/:id`: full record property updates (frontend uses dedicated `/status` endpoint for status transitions).
  - `GET /api/incidents/:id`: single ID lookup for detailed incident modal / API inspection.
  - `GET /api/datasets/upload/:uploadId` and `DELETE /api/datasets/upload/:uploadId`: session recovery and cancellation.

---

## 3. Interactive Element Checklist

| Page | Interactive Element | Trigger / Event | Expected Backend Call | State & UI Feedback |
|---|---|---|---|---|
| **Dashboard** | "Report incident" button | Click | None | Navigates to `/report` |
| **Dashboard** | "Open live map" link | Click | None | Navigates to `/map` |
| **Dashboard** | Map Pan / Zoom | Moveend | None (Dashboard uses pre-fetched extent/heat) | Re-centers and zooms viewport |
| **Dashboard** | Metric Card Retry Buttons | Click on error | `GET /analytics/summary` | Shows spinner, updates metric on success |
| **Dashboard** | Monthly Trend "More analytics" | Click | None | Navigates to `/analytics` |
| **Dashboard** | Latest Reports List Item | Click | None | Navigates to `/incidents` |
| **Dashboard** | AI Forecast "Open AI insights" | Click | None | Navigates to `/ai` |
| **Live Map** | Search Box | Input / Debounce | `GET /incidents/map?bbox=...` | Moves map to geocoded or area coordinates |
| **Live Map** | Filter Dropdowns (Type, Severity) | Select option | `GET /incidents/map?type=...` | Re-fetches map markers / clusters |
| **Live Map** | Date Range Picker | Date change | `GET /incidents/map?from=...&to=...` | Re-filters markers by timestamp |
| **Live Map** | Cluster Marker | Click | None | Zooms map into cluster bounding area |
| **Live Map** | Single Incident Pin | Click | None | Opens Leaflet popup with details and action buttons |
| **Live Map** | Layer Switcher | Toggle (Clusters/Heat/Hotspots) | `GET /analytics/heatmap` or `/hotspots` | Toggles rendering layer visibility |
| **Nearby** | Location Search Input | Enter address | Geocodes via Nominatim / Area list | Moves center marker to address |
| **Nearby** | "Use my location" button | Click | HTML5 Geolocation | Sets user coordinate, fetches `/incidents/nearby` |
| **Nearby** | Radius Slider | Drag (500m - 20km) | `GET /incidents/nearby?radius=...` | Re-draws radius buffer, updates incident count |
| **Nearby** | Incident List Card | Hover / Click | None | Highlights corresponding pin on the map |
| **Report Incident**| Single Report Form Inputs | Change title/type/desc | None | Form state update |
| **Report Incident**| Map Coordinate Picker | Click map | None | Sets [lng, lat] coordinate fields |
| **Report Incident**| "Suggest Severity" button | Click | `POST /ml/severity/predict` | Populates severity field with model suggestion |
| **Report Incident**| Submit Report button | Click | `POST /incidents` | Disables button, emits socket, shows success toast |
| **Upload Wizard** | File Drop Zone | Drop file | `POST /datasets/upload/init` | Validates file size & format, starts chunks |
| **Upload Wizard** | Column Mapping Selectors | Select dropdown | None | Updates mapping schema state |
| **Upload Wizard** | "Start Import" button | Click | `POST /datasets/:id/import` | Triggers background worker, shows progress bar |
| **Upload Wizard** | "Cancel Import" button | Click | `POST /datasets/:id/cancel` | Sends cancel signal, stops worker |
| **Incidents** | Search text & filters | Input / change | `GET /incidents?search=...` | Updates table rows with pagination |
| **Incidents** | Status Dropdown (Admin) | Select status | `PATCH /incidents/:id/status` | Updates badge color, emits socket, updates audit |
| **Incidents** | Delete Button (Admin) | Click | `DELETE /incidents/:id` | Shows confirmation, deletes row, shows toast |
| **Incidents** | "Export CSV" button | Click | `GET /reports/csv` | Triggers browser CSV file download |
| **Incidents** | "Export PDF" button | Click | `GET /reports/pdf` | Triggers browser PDF file download |
| **Analytics** | Granularity Buttons (Hour/Day/Month)| Click | `GET /analytics/temporal?granularity=...` | Re-renders AreaChart time-series |
| **AI Insights** | Predict Severity Button | Click | `POST /ml/severity/predict` | Shows confidence bar and local timezone context |
| **AI Insights** | Retrain Model Button (Admin) | Click | `POST /ml/severity/train` | Shows training spinner, updates model metrics |
| **AI Insights** | DBSCAN Clustering Run | Click | `POST /ml/clusters` | Renders clustered hotspots on insight map |
| **Query Lab** | Preset Benchmark Run | Click | `GET /analytics/performance` | Displays executionStats (docsExamined, ms, stage) |
| **Audit Log** | Filter by Action / Incident | Change input | `GET /audit?action=...` | Displays chronological audit event cards |
| **Auth** | Admin Demo Fill Button | Click | None | Fills `admin@routewatch.local` / `Admin@123` |
| **Auth** | Citizen Demo Fill Button | Click | None | Fills `user@routewatch.local` / `Citizen@123` |
| **Auth** | Sign in / Sign up Submit | Click | `POST /auth/login` or `/auth/register` | Sets `rw_token` in localStorage, redirects to `/` |
| **Layout** | Logout Arrow Button | Click | `POST /auth/logout` (local) | Clears localStorage token, redirects to `/login` |

---

## 4. Socket.IO Events Matrix

| Direction | Event Name | Payload Format | Triggering Action | Handling Component | State / UI Effect |
|---|---|---|---|---|---|
| **Backend $\rightarrow$ Frontend** | `incident:new` | `Incident` object | `POST /api/incidents` | `Layout.jsx` | Displays toast notification with incident ID |
| **Backend $\rightarrow$ Frontend** | `incident:updated` | `Incident` object | `PATCH /api/incidents/:id`, `/status` | `Layout.jsx` | Dispatches `rw:incident` custom window event |
| **Backend $\rightarrow$ Frontend** | `incident:deleted` | `{ incidentId: string }` | `DELETE /api/incidents/:id` | `Layout.jsx` | Dispatches `rw:incident` custom window event |
| **Backend $\rightarrow$ Frontend** | `incidents:changed`| `{ event, payload }` | Any incident mutation | `useApi.js` (`useLiveRefresh`) | Invalidates client queries, re-fetches cards |
| **Backend $\rightarrow$ Frontend** | `dataset:progress` | `{ datasetId, progress, rate, status }` | Background importer batch | `UploadWizard.jsx`, `DatasetsPanel.jsx` | Updates progress bar % and import rate in real-time |
| **Backend $\rightarrow$ Frontend** | `dataset:imported` | `Dataset` object | Importer completion | `DatasetsPanel.jsx` | Re-fetches dataset list, shows completion badge |
| **Backend $\rightarrow$ Frontend** | `dataset:deleted` | `{ datasetId }` | `DELETE /api/datasets/:id` | `DatasetsPanel.jsx` | Removes dataset card from panel list |

