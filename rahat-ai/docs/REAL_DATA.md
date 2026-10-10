# RAHAT AI — real-data layer

The original schematic engine (node-graph Delhi/Pune demo, `/api/journey/*`, `/api/plan`) is untouched and
still 100% DEMO DATA. The real-data layer lives beside it:

- Backend: `services/api/real/` -> `/api/real/*`
- Frontend: `apps/web/src/real/` -> route `/journey/real` (button **USE LIVE GPS** on the Overview)

## Provider chain (REAL -> labelled DEMO fallback, per provider)
| Need | Real provider | Fallback | Notes |
|---|---|---|---|
| Places / reverse geocode | Amazon Location Places v2 (API key) | fixed demo landmarks | |
| Routes + alternatives | Amazon Location Routes v2 (API key) | deterministic synthetic routes | |
| Weather | WeatherAPI `current.json` (key stays on the server) | deterministic function of hour | cached 5 min |
| Sun position | SunCalc in the browser (sent with the request) | server approximation | |
| Solar radiation | Open-Meteo | none (omitted) | context only |
| Buildings / relief | OSM via Overpass (throttled 1.5 s, cached 30 min) | demo fixtures (labelled) | |
| Vegetation / surface temp | Planetary Computer STAC (SAS-signed COG window reads): Sentinel-2 L2A B04/B08 -> NDVI (SCL cloud mask); Landsat C2 L2 `lwir11` ST (scale/offset from STAC `raster:bands`, QA_PIXEL mask) | omitted (UNAVAILABLE) | bounded AOI <= ~6 km, decimated to <= 400 px, cached 6 h |
| Explanation | Bedrock (optional, number-free output guard) | deterministic template | never scores routes |

## What is modelled vs. observed
- Estimated shade = building footprints x SunCalc geometry. Heights are never invented: no height/levels means the
  building is ignored (or counted at LOW confidence only when an assumed height is passed).
- Sentinel-2: NDVI = (B08-B04)/(B08+B04) on reflectance; nodata, SCL cloud/shadow/cirrus, division by zero and
  out-of-range pixels are excluded. Reported: mean/median NDVI, vegetation fraction (NDVI >= 0.3), valid pixel fraction.
  It is green-cover context only; it does NOT change the thermal score (avoids double counting with OSM/shade).
- Landsat: lwir11 DN -> K with the asset's own scale/offset -> degC, QA_PIXEL-masked. OBSERVED SURFACE TEMPERATURE at overpass
  time, kept separate from WeatherAPI air temperature. It feeds one capped, separately named score term
  (`surfaceContext`, <= 0.25 u/min, only above 35 C) weighted by scene age: <= 14 d 1.0, <= 45 d 0.5, older 0.
- If pixels cannot be read, scene metadata is kept, `computed=false`, no number is shown, confidence is LOW.
- `modelConfidence` = weakest honest link (demo inputs, missing/stale satellite, shade confidence).
- Thermal load: uncalibrated deterministic units. Components: baseline, environmental heat, solar, shade reduction,
  surface context (only if a surface temperature is supplied), delay.
- Mapped relief never implies "open"; `availability` is UNKNOWN and `lastVerified` is null unless verified.

## Endpoints
`GET /api/real/status|search|reverse|weather|reports` · `POST /api/real/analyze|scenario|reassess|explain|reports|reports/{id}/confirm|evidence-snapshot`

## Not verified in the build environment
The sandbox blocks outbound traffic to Amazon Location, WeatherAPI, Overpass, Open-Meteo and Planetary Computer, so NO live
provider call was made. Satellite raster maths and the STAC->sign->read->stats pipeline are tested with synthetic arrays and
mocked STAC/SAS/COG readers. Run the live smoke test locally (see final report) and confirm the real `raster:bands` metadata.
Also not run: browser/visual QA, Playwright, device GPS, AWS deploy, Step Functions, DynamoDB/S3/Bedrock for the real layer.
