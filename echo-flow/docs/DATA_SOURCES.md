# Data sources

Provenance labels: **REAL / PUBLIC**, **SIMULATED**, **DERIVED**, **AI REASONING**. They are never mixed.

| Source | Role | Auth | Status in this build |
|---|---|---|---|
| Open-Meteo | Weather, rain, forecast, temperature | none | Implemented (`backend/providers/open_meteo.py`), mocked-tested. Forecast grid product — not a gauge, not IMERG, not flood extent |
| NDMA SACHET | Official CAP/RSS alerts | none | Implemented, ETag/If-None-Match polling, `defusedxml` parsing. Keyword (not geometric) area match |
| Tavily | Evidence search only | `TAVILY_API_KEY` | Implemented; NOT_CONNECTED without a key. Never used for coordinates, distance, capacity or hydraulics |
| NASA GPM IMERG Early | Precipitation | `NASA_EARTHDATA_TOKEN` (server-side) | **Adapter boundary only.** Returns NOT_CONNECTED; no value invented |
| CWC / C-FLOOD | River levels / forecast | operator URL | Pass-through to `CWC_API_URL`/`CFLOOD_DATA_URL` only; no endpoint is assumed |
| NASA OPERA DSWx-S1 | Surface-water evidence | none (CMR search) | **Availability metadata only** — no raster downloaded or analysed. Derived from Sentinel-1 SAR; surface water ≠ flood depth |
| Scenario state, graph, coefficients | Model inputs | — | SIMULATED, uncalibrated |
| Model metrics, plans, robustness, VOI | Outputs | — | DERIVED |
| Bedrock agent summaries | Explanation | IAM | AI REASONING (only when `ECHO_AGENT_PROVIDER=bedrock` and the call succeeded) |

## Provider contract
Every provider returns `ProviderResult(status, provenance, data, detail, fetched_at, latency_ms, cached, limitations)`,
status ∈ `LIVE | NOT_CONNECTED | UNAVAILABLE | ERROR`. https only, 8 s timeout, 2 MB cap, TTL cache, 429 cooldown,
failures logged, never raised into the decision system.

## Live rainfall → simulation
`POST /api/scenarios/{id}/rainfall-input`: max hourly precipitation (mm/h) over the next 3 h from Open-Meteo ×
`CATCHMENT_AREA_M2` (60,000, a SIMULATED assumption) → `rain_m3_min`. Labelled DERIVED, audited, bumps
`state_revision` so earlier runs go stale and approval is cleared. If the provider fails the scenario is unchanged (503).

## Remaining steps to finish unconnected sources
- **IMERG**: obtain Earthdata token, choose GES DISC OPeNDAP/subset or PPS path, implement fetch + decode in `nasa_gpm.py`, verify against the live endpoint, add a fixture test.
- **CWC/C-FLOOD**: confirm an official endpoint and schema, set `CWC_API_URL`, add a normalizer.
- **DSWx raster**: download granule from the returned link with Earthdata auth, compute extent over the AOI, store under `satellite/` in S3.
- **Amazon Location**: map + routing are implemented (see `docs/AMAZON_LOCATION.md`); remaining work is verifying them against the live service and replacing the synthetic demo anchor with real, sourced geometry if a real study area is chosen.
