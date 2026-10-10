# WATERPULSE AI — Water Shortage Prevention OS

> **Predict the Shortage. Find the Loss. Simulate the Fix. Act Before the Tap Runs Dry.**

Core loop: **SEE → UNDERSTAND → SIMULATE → DECIDE → ACT → VERIFY**

WATERPULSE answers one decision question: *can we detect an approaching local water
shortage, explain why, simulate interventions, recommend a safer action, require human
approval, and verify whether it worked?* It is decision support. It never controls
infrastructure, and it does not claim live municipal telemetry it does not have.

## What is real, derived and simulated

**The four supplied datasets are real public/government datasets, but they are not
necessarily live municipal telemetry.** Their ages are always shown and computed against
the request-time clock.

| Tier (badge) | Meaning | Where it appears |
|---|---|---|
| 🟢 REAL PUBLIC DATA | An observation parsed from a supplied telemetry file | Delhi groundwater, Maharashtra SCADA, Maharashtra discharge, WeatherAPI |
| 🔵 REAL GOVERNMENT BASELINE | Published baseline figures with no observation date | MIDC plant capacity / utilisation / domestic / industrial MLD |
| 🟡 DERIVED MODEL INPUT | Calculated from real or operator values | Tanker distance, rainfall class from forecast, utilisation %, unit conversions |
| 🟠 SIMULATED OPERATIONAL DATA | Intentionally simulated operating state | Storage, reserve, loss %, source curtailment, tanker fleet in pilot zones |
| 🟣 MODEL OUTPUT | Deterministic WATERPULSE calculation | Water Buffer, Shortage Clock, scenarios, risk |
| ⚪ OPERATOR INPUT / ⚫ DEMO DATA | Values typed by an operator / demo workspace seed | Zone edits; demo workspace |

Not connected (and never fabricated): municipal live demand, live NRW, tanker GPS,
real-time traffic, exact leak locations, reservoir storage from water level, IMD, CGWB,
satellite.

## Architecture

```
React + MapLibre (UI)  →  FastAPI  →  deterministic engines  →  SQLite | DynamoDB
                              │            WaterBuffer · ShortageClock · Risk · Scenario
                              │            TankerCapacity · LossImpact · Validator
                              │            ActionPlanner · Verification
                              ├─ data_sources/  (backend-only CSV providers, lazy + cached)
                              │     Delhi groundwater · Maharashtra SCADA · discharge · MIDC
                              ├─ integrations   WeatherAPI (forecast) · Bedrock (explain only)
                              └─ routing        Amazon Location Routes (server-side key)
AWS (infra/template.yaml): HTTP API → Lambda → DynamoDB; private S3; Step Functions observer
```

* **Decision-support agents:** WaterWatcher, CauseAgent, LossAnalyzer, WhatIfAgent,
  ActionPlanner, Validator, VerificationAgent — deterministic, not autonomous.
* **Bedrock explains evidence only.** It cannot calculate, approve or execute; if it is
  unavailable a deterministic explanation is returned.
* **Human approval is enforced server-side**, with optimistic version conflicts,
  stale-plan rejection and an audit trail.
* **Two workspaces:** `demo` (offline synthetic seed) and `pilot` (zones anchored to the
  datasets). The top-bar switch sends `X-WaterPulse-Workspace`; they never mix data.
  `APP_MODE` picks the default and, when not `demo`, requires `API_TOKEN` on every call.

### How each dataset is used

| Dataset (`data/raw/`) | Provider | Use |
|---|---|---|
| `delhi_groundwater_2026_2030.csv` (14 stations, 6-hourly) | `DelhiGroundwaterProvider` | Nearby contextual evidence, latest/trend/nearest/search. Never converted to storage. Sign/datum not stated in file, so direction is not interpreted. |
| `maharashtra_scada_water_level_discharge.csv` | `MaharashtraScadaProvider` | Inflow / downstream discharge, downstream level, gate discharge, pond level, rainfall tags. Levels are never turned into storage. Flags internal inconsistencies. |
| `maharashtra_reservoir_discharge.csv` (50 gate columns, hourly) | `MaharashtraDischargeProvider` | Derived total gate discharge (cusec, with documented m³/s and L/day conversion). The file reports 0 cusec throughout; this does not show whether a canal is flowing. |
| `MIDCWaterSupplySchemes.csv` (83 rows) | `MIDCWaterSupplyProvider` | Baseline demand/supply anchor for Maharashtra pilot zones, plant headroom, tanker-source selection. No coordinates in source: map positions come from `data/reference/` (approximate town centroids, labelled). |

Real data → zone mapping: observation → station → evidence layer → zone context.
There is no municipal zone geometry, so zones receive **nearby public telemetry** (50 km
radius, distance always shown); otherwise the UI says *no nearby telemetry* instead of
pretending. The lead groundwater station is the most recent reading in range, not merely
the nearest.

## Setup

Prerequisites: Python 3.12+, Node 20+.

```bash
cp .env.example .env            # fill only what you have
cp frontend/.env.example frontend/.env.local   # add VITE_MAPTILER_KEY
./scripts/dev.sh                # API :8000 + UI :5173 (generates an API_TOKEN if unset)
```

Manual run:

```bash
cd backend && pip install -r requirements.txt
APP_MODE=pilot API_TOKEN=<32+ chars> uvicorn app.main:app --port 8000
cd frontend && npm install && DEV_PROXY_API_TOKEN=<same token> npm run dev
```

Or run `APP_MODE=demo` (no token) for the offline demo workspace.

### Environment variables (names only)

Backend: `APP_MODE`, `DATABASE_PATH`, `ALLOWED_ORIGINS`, `API_TOKEN`, `RATE_LIMIT_PER_MINUTE`,
`DATA_DIR`. AWS: `AWS_REGION`, `DYNAMODB_TABLE`, `EVIDENCE_BUCKET`, `BEDROCK_MODEL_ID`.
Weather: `WEATHER_PROVIDER=weatherapi`, `WEATHER_API_KEY`. Routing: `AMAZON_LOCATION_KEY`,
`AMAZON_LOCATION_REGION`. Frontend: `VITE_MAPTILER_KEY`, `VITE_API_BASE`.
Dev only: `DEV_PROXY_API_TOKEN` (read by the Vite dev server; not bundled).
`VITE_MAPTILER_KEY` is browser-visible by design — restrict it by domain in MapTiler.
Without it the map falls back to OpenStreetMap tiles; without WebGL (or with
`localStorage["waterpulse-map"]="schematic"`) an offline keyboard-accessible schematic is used.

## Tests

```bash
cd backend && pytest -q && ruff check .
cd frontend && npm run typecheck && npm run lint && npm test && npm run build
cd frontend && npm run test:e2e
```

`npm test` runs UI tests against a **live API**: start one first
(`RATE_LIMIT_PER_MINUTE=5000 APP_MODE=demo uvicorn app.main:app --port 8000` in `backend/`).
`npm run test:e2e` starts the API and UI itself. If Playwright cannot download browsers
(restricted network), set `PLAYWRIGHT_CHROMIUM_PATH` to any Chromium binary.

## AWS deployment

See `AWS_SETUP.md`. `infra/template.yaml` (validated with cfn-lint) defines API Gateway HTTP
API with throttling and access logs, two Lambda functions (arm64, `sam build` bundles the
datasets via `backend/Makefile`), DynamoDB (SSE, PITR), a private versioned encrypted S3
bucket with a TLS-only policy, a Step Functions observer, log groups with retention and
least-privilege IAM (DynamoDB Get/Put only; Bedrock InvokeModel on one ARN). Provider
secrets are CloudFormation `NoEcho` parameters — acceptable for a pilot; use Secrets
Manager for production. **This repository has not been deployed by its author.**

## Known limitations

* Pilot zone supply curtailment, storage, reserve, loss and tanker fleet are simulated
  assumptions; only MIDC utilisation is real baseline.
* All four datasets are archived files; every one is STALE relative to its reporting
  cadence at the time of writing, and the UI says so.
* MIDC has no coordinates; map positions are approximate town centroids.
* Water Buffer assumes constant inputs; it is not a hydraulic forecast.
* Auth is a single bearer token and a process-local rate limiter — not SSO/RBAC.
* The evidence S3 bucket is provisioned but the application does not yet write to it.
* Amazon Location response parsing follows the documented Routes v2 schema but has been
  verified only against mocked responses (no key was available during development).
* The WeatherAPI adapter is verified against mocked responses only.
