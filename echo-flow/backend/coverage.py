"""Single source of truth for what is implemented. The UI renders this; it never overstates."""

# engine: IMPLEMENTED = working deterministic engine + full decision workflow
#         PARTIAL     = covered through another engine's model, without dedicated modelling
#         PLANNED     = not built; shown as coverage mode only
CHALLENGES = [
    {"id": 1, "challenge": "Heatwaves", "system": "RAHAT", "engine": "PARTIAL", "data": "SIMULATED",
     "live_context": "Open-Meteo temperature; NDMA SACHET alerts",
     "note": "Modeled as heat -> power demand -> transformer -> pump -> water. Thermal-exposure routing "
             "(Fastest / RAHAT / Relief Priority) is NOT built."},
    {"id": 2, "challenge": "Floods", "system": "ECHO-FLOW", "engine": "IMPLEMENTED", "data": "SIMULATED",
     "live_context": "Open-Meteo rainfall can be applied as a DERIVED input; SACHET alerts",
     "note": "Hero system. Lumped deterministic model on a synthetic graph; uncalibrated."},
    {"id": 3, "challenge": "Monsoon Waterlogging", "system": "ECHO-FLOW", "engine": "PARTIAL", "data": "SIMULATED",
     "live_context": "Open-Meteo rainfall",
     "note": "Covered by Zone A accumulation and drain C12 blockage; no urban-drainage calibration."},
    {"id": 4, "challenge": "Drought & Water Shortage", "system": "WATERPULSE", "engine": "PARTIAL",
     "data": "SIMULATED", "live_context": "None connected",
     "note": "Water-reserve depletion under power constraint only; no drought indices."},
    {"id": 5, "challenge": "Water Tankers", "system": "WATERPULSE", "engine": "PLANNED", "data": "NONE",
     "live_context": "None", "note": "No tanker logistics model exists. Coverage mode only."},
    {"id": 6, "challenge": "Water Leaks", "system": "WATERPULSE", "engine": "PLANNED", "data": "NONE",
     "live_context": "None", "note": "No leak detection exists. A leak is never claimed without evidence."},
    {"id": 7, "challenge": "Groundwater", "system": "WATERPULSE", "engine": "PLANNED", "data": "NONE",
     "live_context": "None", "note": "No groundwater data or model connected."},
]

SYSTEMS = [
    {"id": "echo-flow", "name": "ECHO-FLOW", "role": "Flood & Emergency Decision Intelligence", "route": "/echo-flow"},
    {"id": "rahat", "name": "RAHAT", "role": "Heat Intelligence", "route": "/rahat"},
    {"id": "waterpulse", "name": "WATERPULSE", "role": "Water Intelligence", "route": "/waterpulse"},
]
