"""Citizen journey layer on top of the deterministic engine.

All numbers come from engine.py. Text here is templated from those numbers;
no LLM is involved in distances, times, exposure, shade or relief ranking.
"""
import math
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

import delhi
from engine import (
    Engine, RouteUnavailable, constrained_path, environmental_rate, summarize,
)
from models import PlanRequest

NEEDS = (
    "WATER", "SHADE", "REST", "COOLING", "PUBLIC FACILITY", "EMERGENCY",
    "HOSPITAL", "FUEL", "FOOD", "TRANSIT", "ESSENTIAL SERVICES",
)
HEATWAVE_C = 40.0   # Illustrative demo threshold, NOT an official declaration.
JOURNEY_MODES = ("fastest", "rahat", "relief-priority", "balanced")
ENGINE_MODE = {"fastest": "fastest", "rahat": "thermal-safe",
               "relief-priority": "relief-priority", "balanced": "balanced"}
LABEL = {"fastest": "FASTEST", "rahat": "RAHAT", "relief-priority": "RELIEF PRIORITY",
         "balanced": "BALANCED"}

def classify(rate):
    """Documented thresholds on exposure units per minute (see docs/MODEL.md)."""
    if rate < 1.5:
        return "LOW"
    if rate < 2.1:
        return "MODERATE"
    if rate < 2.7:
        return "ELEVATED"
    return "HIGH"

class Stop(BaseModel):
    model_config = ConfigDict(extra="forbid")
    node: int = Field(ge=0, le=199)

class JourneyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    origin: int = Field(default=delhi.CP_NODE, ge=0, le=199)
    destination: int = Field(default=delhi.IG_NODE, ge=0, le=199)
    waypoints: list[Stop] = Field(default_factory=list, max_length=5)
    needs: list[Literal[NEEDS]] = Field(default_factory=list)
    travel_mode: Literal["walk", "cycle", "rider"] = "rider"
    departure: str = "2026-05-15T14:00:00+05:30"
    max_detour_pct: float = Field(default=60, ge=0, le=200)
    heatwave: bool = False
    delay_min: float = Field(default=0, ge=0, le=30)
    closed_relief: list[str] = Field(default_factory=list, max_length=20)

    def stops(self):
        return [self.origin, *[w.node for w in self.waypoints], self.destination]

    def leg_request(self, a, b):
        return PlanRequest(
            origin=a, destination=b, departure=self.departure,
            travel_mode=self.travel_mode, max_detour_pct=self.max_detour_pct,
            needs=list(self.needs), delay_min=self.delay_min,
            closed_relief=self.closed_relief,
            temp_offset_c=4.0 if self.heatwave else 0.0,
        )

class NeedRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    journey: JourneyRequest
    node: int = Field(ge=0, le=199)
    radius_m: float = Field(default=1000, ge=0, le=5000)
    destination: int | None = Field(default=None, ge=0, le=199)

class ChangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    journey: JourneyRequest
    change: Literal["traffic", "relief-closed", "heatwave", "later", "waypoint"]
    current_node: int | None = Field(default=None, ge=0, le=199)

def _poi_type_dist(items):
    """Nearest open relief per category, from engine-ranked items."""
    out = {}
    for label, test in (
        ("WATER", lambda p: p["water"]), ("SHADE", lambda p: p["shade"]),
        ("REST", lambda p: p["rest"]), ("COOLING", lambda p: p["cooling"]),
    ):
        match = [p for p in items if test(p)]
        if match:
            best = min(match, key=lambda p: p["distance"])
            out[label] = {
                "id": best["id"], "name": best["name"],
                "distance_m": best["distance"], "minutes": best["minutes"],
                "detour_minutes": best["detour_minutes"],
            }
        else:
            out[label] = None
    return out

class JourneyEngine:
    def __init__(self, engine: Engine):
        self.engine = engine
        self.pois = engine.providers.relief.get()
        self.map = engine.providers.map.get()
        self.nodes = {n["id"]: n for n in self.map["nodes"]}

    def validate(self, req):
        for stop in req.stops():
            if stop not in self.nodes:
                raise RouteUnavailable("A selected stop is outside demo coverage")
        stops = req.stops()
        if any(a == b for a, b in zip(stops, stops[1:])):
            raise RouteUnavailable("Consecutive stops must differ")

    def plan(self, req):
        self.validate(req)
        stops = req.stops()
        legs = [req.leg_request(a, b) for a, b in zip(stops, stops[1:])]
        scan = self.engine.scan(legs[0])
        paths = {m: [] for m in JOURNEY_MODES}
        fast_total = 0.0
        for leg in legs:
            fastest = constrained_path(scan["edges"], leg.origin, leg.destination, "fastest", leg)
            fast_minutes = sum(e["minutes"] for e in fastest)
            fast_total += fast_minutes
            limit = fast_minutes * (1 + leg.max_detour_pct / 100)
            for mode in JOURNEY_MODES:
                paths[mode] += fastest if mode == "fastest" else constrained_path(
                    scan["edges"], leg.origin, leg.destination, ENGINE_MODE[mode], leg, limit,
                )
        q = legs[0]
        weather = scan["weather"]
        routes = []
        for mode in JOURNEY_MODES:
            r = summarize(paths[mode], ENGINE_MODE[mode], q, self.pois, weather, fast_total)
            r["id"] = mode
            r["label"] = LABEL[mode]
            r["mode"] = mode
            r["stops"] = stops
            self._decorate(r, req)
            routes.append(r)
        seen = {}
        for r in routes:
            key = tuple(r["nodes"])
            r["same_geometry_as"] = seen.get(key)
            seen.setdefault(key, r["id"])
        fastest_r = routes[0]
        for r in routes:
            r["delta_vs_fastest"] = {
                "minutes": r["minutes"] - fastest_r["minutes"],
                "distance": r["distance"] - fastest_r["distance"],
                "load": r["load"] - fastest_r["load"],
                "load_pct": (
                    (r["load"] - fastest_r["load"]) / fastest_r["load"] * 100
                    if fastest_r["load"] else 0.0
                ),
            }
        temp = weather["temperature_c"]
        return {
            "request": req.model_dump(), "weather": weather, "sun": scan["sun"],
            "routes": routes, "edges": scan["edges"],
            "heatwave": {
                "active": temp >= HEATWAVE_C, "threshold_c": HEATWAVE_C,
                "temperature_c": temp,
                "note": "Illustrative demo threshold; not an official heatwave declaration.",
            },
            "evidence": self.evidence(req, weather, scan["sun"]),
            "data_labels": ["DEMO DATA", "MODEL ESTIMATE", "SIMULATED JOURNEY"],
        }

    def _decorate(self, route, req):
        segs = route["segments"]
        for s in segs:
            s["heat_class"] = classify(s["rate"])
            s["explanation"] = self.explain_segment(s)
            s["nearby_relief"] = self._nearest(s["b"])
            s["a_lat"], s["a_lon"] = self.nodes[s["a"]]["lat"], self.nodes[s["a"]]["lon"]
            s["b_lat"], s["b_lon"] = self.nodes[s["b"]]["lat"], self.nodes[s["b"]]["lon"]
            s["source"] = "MODEL ESTIMATE"
            s["timestamp"] = req.departure
        route["timeline"] = [
            {"index": i, "heat_class": s["heat_class"], "minutes": s["minutes"],
             "shade": s["shade"], "reason": s["explanation"]}
            for i, s in enumerate(segs)
        ]
        route["corridor"] = self.corridor(route)
        route["needs_coverage"] = {
            need: sum(1 for pid in route["relief_ids"]
                      if need in next(p for p in self.pois if p["id"] == pid)["tags"])
            for need in req.needs
        }
        route["water_on_route"] = sum(
            1 for pid in route["relief_ids"] if next(p for p in self.pois if p["id"] == pid)["water"])
        route["rest_on_route"] = sum(
            1 for pid in route["relief_ids"] if next(p for p in self.pois if p["id"] == pid)["rest"])
        route["cooling_on_route"] = sum(
            1 for pid in route["relief_ids"] if next(p for p in self.pois if p["id"] == pid)["cooling"])
        route["shade_points_on_route"] = sum(
            1 for pid in route["relief_ids"] if next(p for p in self.pois if p["id"] == pid)["shade"])
        route["classes"] = {
            c: sum(1 for s in segs if s["heat_class"] == c)
            for c in ("LOW", "MODERATE", "ELEVATED", "HIGH")
        }
        route["confidence"] = "LOW: uncalibrated model on schematic demo geometry"

    def _nearest(self, node):
        n = self.nodes[node]
        best = None
        for p in self.pois:
            if p["status"] != "OPEN":
                continue
            d = math.hypot(self.nodes[p["node"]]["x"] - n["x"], self.nodes[p["node"]]["y"] - n["y"])
            if best is None or d < best["distance_m"]:
                best = {"id": p["id"], "name": p["name"], "type": p["type"], "distance_m": d}
        return best

    def explain_segment(self, s):
        cls = s["heat_class"]
        solar = s["solar_exposure"]
        shade = s["shade"] * 100
        if cls in ("HIGH", "ELEVATED"):
            lead = f"{cls.capitalize()} thermal load because of an estimated solar exposure index of {solar:.2f}, "
            lead += f"only {shade:.0f}% estimated shade and {s['minutes']:.1f} min on this segment."
        else:
            lead = f"{cls.capitalize()} thermal load: estimated shade is {shade:.0f}% and the solar exposure index is {solar:.2f}"
            lead += f" over {s['minutes']:.1f} min."
        if s["delay_minutes"] > 0:
            lead += f" Includes {s['delay_minutes']:.1f} min of demo traffic delay."
        return lead + " (MODEL ESTIMATE)"

    def corridor(self, route):
        """Ordered relief stages actually located on the route's nodes."""
        stages = []
        for n in route["nodes"]:
            for p in self.pois:
                if p["node"] == n and p["id"] in route["relief_ids"]:
                    kinds = [k for k, f in (("SHADE", p["shade"]), ("WATER", p["water"]),
                                            ("REST", p["rest"]), ("COOLING", p["cooling"])) if f]
                    stages.append({"poi": p["id"], "name": p["name"], "node": n,
                                   "kinds": kinds or [p["type"]],
                                   "source": p["source"]})
        return {"stages": stages, "label": "RAHAT RELIEF CORRIDOR",
                "complete": bool(stages)}

    def evidence(self, req, weather, sun):
        return [
            {"source": "DEMO DATA", "timestamp": req.departure,
             "coverage": "Schematic Delhi grid, Connaught Place to India Gate",
             "confidence": "Not field verified", "method": "Synthetic fixtures",
             "limitations": "No surveyed roads, no verified relief availability"},
            {"source": "MODEL ESTIMATE", "timestamp": req.departure,
             "coverage": "All route segments",
             "confidence": "Uncalibrated",
             "method": "Solar position + sampled building/canopy shadows + ambient index",
             "limitations": "Departure-time snapshot; exposure units are illustrative, not health predictions"},
            {"source": "SIMULATED JOURNEY", "timestamp": None, "coverage": "Live journey view",
             "confidence": "n/a", "method": "Segment-by-segment advance",
             "limitations": "Not GPS. No real location is read or stored"},
        ]

    # --- I NEED RAHAT / AROUND ME -------------------------------------------
    def need_rahat(self, req, node, radius, destination=None):
        self.validate(req)
        leg = req.leg_request(node if node != req.destination else req.origin,
                              destination if destination is not None else req.destination)
        leg = leg.model_copy(update={"origin": node, "destination": leg.destination})
        if leg.origin == leg.destination:
            raise RouteUnavailable("You are already at the destination")
        scan = self.engine.scan(leg)
        items = self.engine.relief(leg, node, radius, scan)
        for it in items:
            it["why"] = (
                f"{it['name']} is {it['distance']:.0f} m away, adds about {it['detour_minutes']:.1f} min "
                f"of detour and about {it['load_to_relief']:.1f} exposure units on the way (MODEL ESTIMATE)."
            )
        return {
            "node": node, "radius_m": radius, "items": items,
            "by_type": _poi_type_dist(items),
            "framing": "A nearby relief opportunity, not a medical assessment.",
            "source": "DEMO DATA + MODEL ESTIMATE",
        }

    def around(self, req, node, radius):
        other = req.destination if node != req.destination else req.origin
        scan = self.engine.scan(req.leg_request(node, other))
        out = []
        for p in self.pois:
            if p["status"] != "OPEN" or p["id"] in req.closed_relief:
                continue
            path = constrained_path(scan["edges"], node, p["node"], "fastest", req.leg_request(node, p["node"])) \
                if node != p["node"] else []
            d = sum(e["distance"] for e in path)
            if d <= radius:
                out.append({**p, "distance": d})
        return {"node": node, "radius_m": radius, "items": sorted(out, key=lambda x: x["distance"]),
                "source": "DEMO DATA"}

    # --- What changed / reroute proposal ------------------------------------
    def what_changed(self, req, change, current):
        before = self.plan(req)
        values = req.model_dump()
        reason = ""
        if change == "traffic":
            values["delay_min"] = min(30, req.delay_min + 8)
            reason = "Demo traffic delay increased on the Janpath-side link."
        elif change == "heatwave":
            values["heatwave"] = True
            reason = "Environmental scenario: +4 C demo temperature offset."
        elif change == "later":
            values["departure"] = "2026-05-15T16:00:00+05:30"
            reason = "Departure shifted two hours later."
        elif change == "relief-closed":
            used = [pid for r in before["routes"] if r["id"] == "rahat" for pid in r["relief_ids"]]
            if not used:
                raise RouteUnavailable("The RAHAT route has no relief point to close")
            values["closed_relief"] = sorted(set(req.closed_relief + [used[0]]))
            reason = f"Relief point {used[0]} reported unavailable (scenario)."
        else:
            raise RouteUnavailable("Unsupported change")
        after = self.plan(JourneyRequest(**values))
        b = next(r for r in before["routes"] if r["id"] == "rahat")
        a = next(r for r in after["routes"] if r["id"] == "rahat")
        return {
            "reason": reason, "before": b, "now": a,
            "geometry_changed": b["nodes"] != a["nodes"],
            "diff": {
                "minutes": a["minutes"] - b["minutes"],
                "distance": a["distance"] - b["distance"],
                "load": a["load"] - b["load"],
                "relief_count": a["relief_count"] - b["relief_count"],
                "shade": a["shade"] - b["shade"],
            },
            "proposal_only": True,
            "policy": "Nothing changes until the user accepts the alternative.",
            "updated_request": values,
        }

def places_search(q):
    q = q.strip().lower()[:60]
    out = []
    for name, lat, lon in delhi.PLACES:
        if not q or q in name.lower():
            nearest = min(delhi.DELHI_MAP["nodes"], key=lambda n: (n["lat"] - lat) ** 2 + ((n["lon"] - lon) * 0.88) ** 2)
            d = math.hypot(nearest["lat"] - lat, (nearest["lon"] - lon) * 0.88) * 111320
            inside = d <= 400
            out.append({
                "name": name, "lat": lat, "lon": lon, "inside_demo_coverage": inside,
                "node": nearest["id"] if inside else None,
                "snapped_distance_m": d if inside else None,
                "source": "DEMO DATA",
                "note": None if inside else "Outside the schematic demo area; a real geocoder/router would handle it.",
            })
    return out

def build_router(engine):
    je = JourneyEngine(engine)
    router = APIRouter(prefix="/api/journey")

    @router.get("/bootstrap")
    def bootstrap():
        return {
            "map": je.map, "relief": je.pois, "needs": list(NEEDS),
            "defaults": JourneyRequest().model_dump(),
            "heatwave_threshold_c": HEATWAVE_C,
            "providers": provider_status(),
        }

    @router.post("/plan")
    def plan(req: JourneyRequest):
        return je.plan(req)

    @router.get("/search")
    def search(q: str = ""):
        return {"items": places_search(q)}

    @router.post("/need-rahat")
    def need(body: NeedRequest):
        return je.need_rahat(body.journey, body.node, body.radius_m, body.destination)

    @router.get("/around")
    def around(node: int, radius_m: float = 500):
        if radius_m not in (250, 500, 1000, 2000):
            raise HTTPException(422, "Radius must be 250, 500, 1000 or 2000 metres")
        if node not in je.nodes:
            raise HTTPException(422, "Selected point is outside demo coverage")
        return je.around(JourneyRequest(), node, radius_m)

    @router.post("/what-changed")
    def changed(body: ChangeRequest):
        return je.what_changed(body.journey, body.change, body.current_node)

    @router.get("/nearest-node")
    def nearest(lat: float, lon: float):
        n = min(je.map["nodes"], key=lambda n: (n["lat"] - lat) ** 2 + ((n["lon"] - lon) * 0.88) ** 2)
        d = math.hypot(n["lat"] - lat, (n["lon"] - lon) * 0.88) * 111320
        return {"node": n["id"] if d <= 400 else None, "distance_m": d, "name": n["name"],
                "inside_demo_coverage": d <= 400}

    return router, je

def provider_status():
    names = ["MapProvider", "GeocodingProvider", "RouteProvider", "WeatherProvider",
             "TrafficProvider", "SolarProvider", "ShadeProvider", "ReliefProvider",
             "POIProvider", "SatelliteProvider", "LocationProvider"]
    impl = {
        "SolarProvider": ("DEMO", "Deterministic solar model (MODEL ESTIMATE)"),
        "ShadeProvider": ("DEMO", "Ray-sampled buildings and canopy (MODEL ESTIMATE)"),
        "SatelliteProvider": ("UNAVAILABLE", "No satellite or canopy dataset connected"),
        "LocationProvider": ("DEMO", "Simulated journey; browser location is opt-in only"),
    }
    return [{"name": n, "state": impl.get(n, ("DEMO", "Synthetic demo fixture"))[0],
             "detail": impl.get(n, ("DEMO", "Synthetic demo fixture"))[1],
             "real_mode": "Set PROVIDER_MODE=real and register an adapter in providers.py"}
            for n in names]

# keep a reference so linting sees the import used
_ = environmental_rate
