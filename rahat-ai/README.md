# RAHAT AI — Citizen Thermal Mobility & Relief Intelligence

"Don't just navigate the city. Navigate through its heat."

React + TypeScript (Vite, Three.js / React Three Fiber) frontend, FastAPI backend, deterministic
thermal/solar/shade/routing/relief engines, six-stage agent pipeline, optional Bedrock explanations,
SQLite (local) / DynamoDB (AWS) storage, AWS SAM template. Runs fully in **DEMO MODE** — no AWS
credentials needed. All map, weather and relief data is synthetic (Hinjewadi-anchored) and labelled.

## Quick start (two terminals)

Backend (Python 3.11+):
    cd services/api
    python -m venv .venv
    source .venv/bin/activate        # Windows: .venv\Scripts\activate
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000

Frontend (Node 20+):
    cd apps/web
    npm install
    npm run dev                       # open http://localhost:5173

Or: `docker compose up --build` and open http://localhost:8080.

## Verified in the build environment
- Backend: ruff clean, 18 pytest tests pass
- Frontend: TypeScript typecheck, ESLint, 4 Vitest tests, production build all pass
- Live API smoke test: health, plan, relief, scenario, trip start/advance/reroute, reports, explain
- NOT run: Playwright browser tests (browser download blocked), Docker, AWS deploy, Bedrock

## Pages
/ control room · /planner · /thermal-map · /exposure · /relief · /compare · /live-trip ·
/scenario · /community · /evidence · /settings

## API
GET /api/health, /api/bootstrap, /api/reports · POST /api/plan, /api/relief, /api/scenario,
/api/explain, /api/reports, /api/trips · GET /api/trips/{id} · POST /api/trips/{id}/action, /reroute
Interactive docs: http://localhost:8000/docs

## Rules built in
Engines compute every number; the LLM (Bedrock, optional) only explains and is output-guarded.
Output is "estimated environmental exposure" — never body temperature, dehydration or medical claims.
Community reports stay UNVERIFIED. Live trip is an explicit SIMULATED TRIP.

## Known limitations
Synthetic street grid (not the real Hinjewadi roads), uncalibrated exposure model, balanced and
thermal-safe routes can coincide on some inputs, no real Amazon Location map wired into the graph,
deployed AWS API is IAM-protected (browser needs a signing/Cognito layer), modals need a full
focus trap. See docs/MODEL.md and docs/DEMO.md.

## Journey OS update (Delhi flagship)
`/` is now the cinematic landing; `/journey/*` is the citizen journey experience (see docs/JOURNEY.md). The
original Pune modules remain at their existing paths. Delhi data is a schematic DEMO grid, not surveyed roads.
Added: 3D rider hero and heat-choice scene (2D fallback), multi-stop planner with search / map select and needs,
FASTEST / RAHAT / RELIEF PRIORITY routes, per-segment LOW-HIGH thermal classes with explanations, relief corridor,
I NEED RAHAT, Around Me, simulated live journey, What Changed proposals, heatwave scenario, evidence and provider
status. Backend: 34 pytest tests. Frontend: typecheck, ESLint, 10 Vitest tests, production build.
NOT verified here: browser/visual QA, Playwright e2e, mobile layout on a device, Docker, AWS deploy, Bedrock.

## Real-data mode (new)
Set `PROVIDER_MODE=real` and fill `.env` (copy `.env.example`; keys stay server-side). Open `/journey/real`
(Overview -> USE LIVE GPS). Every provider that fails falls back to clearly labelled DEMO DATA. Full details,
provider table and honest limits: `docs/REAL_DATA.md`. Backend: 76 pytest tests; frontend: 78 Vitest tests. Sentinel-2 NDVI and Landsat ST are computed from pixels (tested with synthetic rasters; live reads unverified here).

## RAHAT LIVE (real-world map) — `/journey/rahat-live`
Overview → **USE LIVE GPS** opens a full-screen real map (Amazon Location via MapLibre). The demo journey (`/journey/*`) is untouched.
- Map: `/api/live/map/*` is a backend proxy; `AWS_LOCATION_API_KEY` never reaches the browser.
- GPS: `getCurrentPosition` + `watchPosition`, real accuracy, follow / recenter. Never simulated.
- Search: debounced (260 ms, 2+ chars) Amazon Location Places with GPS bias, Enter + SEARCH button, map-click + reverse geocode.
- Route: Amazon Location road geometry -> existing `/api/real/analyze` (FASTEST / BALANCED / RAHAT WAY, thermal segments, shade, Sentinel-2, Landsat, relief).
- Live mode never shows demo data: failures show `MAP / ROUTE SERVICE UNAVAILABLE`, `LOCATION UNAVAILABLE`, `WEATHER DATA UNAVAILABLE`, etc.
- Needs `PROVIDER_MODE=real`, `AWS_LOCATION_API_KEY`, `WEATHERAPI_KEY` in `.env`. GPS requires https or localhost.
- NOT verified in the build environment: real browser GPS, live Amazon/WeatherAPI calls, visual QA.
