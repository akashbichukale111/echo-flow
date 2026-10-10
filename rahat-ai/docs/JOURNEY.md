# RAHAT Journey OS (Delhi demo)

Flagship experience at `/` and `/journey/*`. The original Pune/Hinjewadi modules are untouched at their old paths
(`/planner`, `/thermal-map`, ...), reachable from the left rail.

## Flow
Landing (3D rider) → Start journey (stops, search or map select, needs) → Heat choice (3D) → Route planner
(FASTEST / RAHAT / RELIEF PRIORITY / BALANCED, segment inspector, relief corridor) → START JOURNEY
(simulated) → I NEED RAHAT → relief detour proposal → WHAT CHANGED? → Evidence / Settings.

## What is deterministic
`engine.py` (unchanged core) + `journey.py`: solar position, sampled shade, ambient index, routing, relief ranking.
Explanations in the UI are string templates over those numbers. No LLM output is displayed in demo mode.

## Thermal classes (exposure units per minute, `journey.classify`)
LOW < 1.5 ≤ MODERATE < 2.1 ≤ ELEVATED < 2.7 ≤ HIGH. Illustrative thresholds on an uncalibrated index.

## Heatwave mode
Scenario toggle adds +4 °C to the demo temperature. Active when temperature ≥ 40 °C. This threshold is illustrative and
is NOT an official heatwave declaration.

## Needs
WATER, SHADE, REST, COOLING, PUBLIC FACILITY, EMERGENCY, HOSPITAL, FUEL, FOOD, TRANSIT, ESSENTIAL SERVICES are soft
preferences. They change the RELIEF PRIORITY edge cost and the "needs met" counts. They do not remove routes.

## Providers
Protocols in `services/api/providers.py`: Map, Geocoding, Route, Weather, Traffic, Solar, Shade, Relief, POI,
Satellite, Location. Demo implementations: `providers.py` (Pune) and `delhi.py` (Delhi). Real mode = new
classes passed to `Engine(Providers(...))`; the UI and `journey.py` do not change.

## API
GET /api/journey/bootstrap, /search?q=, /around?node=&radius_m=, /nearest-node?lat=&lon=
POST /api/journey/plan, /need-rahat, /what-changed. Reports: POST /api/reports with `"city":"delhi"`.
