# API (prefix `/api`)

In pilot mode every request needs `Authorization: Bearer <API_TOKEN>` (32+ chars).
Bodies are limited to 64 KB; `RATE_LIMIT_PER_MINUTE` requests/minute/client (default 180, process-local).

Workspaces: send `X-WaterPulse-Workspace: demo|pilot` (default follows `APP_MODE`). Zones,
actions and audit are separate per workspace; unknown values return 422.

| Method | Path | Purpose |
|---|---|---|
| GET | /health | Mode, storage, `physical_control: false`, provider status |
| GET | /zones | List zones |
| POST | /zones | Create zone (`ZoneInput`) |
| PUT | /zones/{id} | Update zone (needs `expected_version`; 409 on conflict) |
| GET | /zones/{id}/analysis | Model, clock, risk, diagnosis, `causes`, anomalies, scenarios, evidence (with `data_label`), validator, recommendation, `data_context` (nearby public telemetry, pilot only), `composition` (label of each model input), weather detail |
| GET | /zones/{id}/route | Tanker route: `ROUTED ESTIMATE` (Amazon Location) or `STRAIGHT-LINE (NOT A ROAD ROUTE)`; never live traffic |
| POST | /zones/{id}/scenarios | Recompute scenarios with `ScenarioInput` |
| POST | /zones/{id}/tankers | Tanker trips/timing for `required_water_l` |
| POST | /zones/{id}/explanation | Bedrock (or deterministic) explanation |
| GET | /actions | List actions |
| POST | /zones/{id}/actions | Draft an action (422 if scenario infeasible) |
| POST | /actions/{id}/decision | `approve`, `reject`, `modify` with a note |
| POST | /actions/{id}/execution | Record execution (requires APPROVED) |
| POST | /actions/{id}/verification | Enter before/after observation (requires EXECUTED) |
| GET | /audit | Audit trail |
| GET | /export | Workspace JSON download |

Errors: 401 unauthorized, 404 unknown id, 409 conflict/stale/state, 413 too large,
422 validation, 429 rate limited, 500 generic safe message. Interactive docs: `/docs`.

## Public data (read-only, never whole files)

| Method | Path | Filters |
|---|---|---|
| GET | /data/summary | Per-provider counts, freshness, quality flags, statement, not-connected list |
| GET | /data/groundwater | `station`, `q`, `state`, `district`, `start`, `end`, `history`, `latitude`+`longitude`(+`radius_km`), `limit` (≤2000) |
| GET | /data/scada | `parameter`, `station`, `district`, `category`, `state`, `start`, `end`, `history`, `include_gates`, `limit` |
| GET | /data/discharge | `history`, `gates`, `start`, `end`, `limit` |
| GET | /data/water-supply | `q`, `state`, `placed_only`, `limit` (≤500), `offset` |
| GET | /data/map | Compact markers for all layers; optional `latitude`,`longitude`,`radius_km` |

`start`/`end` accept ISO dates or datetimes (naive = IST); bad values return 422. A failing
provider returns HTTP 200 with
`{"status":"DATA_UNAVAILABLE","source":"…","message":"…","last_known":null}`; other endpoints
and the dashboard keep working.
