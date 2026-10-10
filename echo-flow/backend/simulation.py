import math

import networkx as nx

from .domain import Assumptions, Intervention, State
from .scenarios import CANDIDATES, graph

CAPACITY_M3 = 8500.0
DRAIN_M3_MIN = 28.0  # synthetic C12 drain capacity at 0% blockage
HORIZON_MIN = 60
STEP_MIN = 10

_FLOOD_GRAPH = graph("flood")


def validate_mode(state: State, p: Intervention) -> None:
    if state.mode == "flood":
        if p.pump == 0.5:
            raise ValueError("Flood mode supports 0, 40, 60, 80 or 100% pump")
        if p.noncritical_shed or p.priority_power:
            raise ValueError("Power allocation belongs to Heat-Water mode")
    elif p.buffer is not None or not p.gate_open or p.road_closed or p.clear_drain:
        raise ValueError("Flood infrastructure controls are invalid in Heat-Water mode")


def routes(depth_a: float, depth_r7: float, closed: bool) -> dict:
    g = nx.Graph()
    for n in _FLOOD_GRAPH["nodes"]:
        if n["kind"] in ("command", "road", "hospital", "shelter", "zone"):
            g.add_node(n["id"])
    for e in _FLOOD_GRAPH["edges"]:
        if e["kind"] == "route":
            g.add_edge(e["source"], e["target"], weight=e["minutes"])

    blocked = []
    if closed or depth_r7 > 0.45:
        blocked.append("R7")
    if depth_a > 0.65:
        blocked.append("R8")
    g.remove_nodes_from(blocked)
    reached = nx.node_connected_component(g, "O")

    eta = None
    path: list[str] = []
    if "H1" in reached:
        eta = nx.shortest_path_length(g, "O", "H1", weight="weight")
        path = nx.shortest_path(g, "O", "H1", weight="weight")

    isolated = sum(
        n["population"] for n in _FLOOD_GRAPH["nodes"]
        if n["population"] and n["id"] not in reached
    )
    islands = [sorted(c) for c in nx.connected_components(g) if "O" not in c]
    return {
        "hospital_eta_min": eta,
        "hospital_timely": eta is not None and eta <= 18,
        "hospital_connected": "H1" in reached,
        "shelter_connected": "S1" in reached,
        "path": path,
        "blocked_roads": blocked,
        "isolated_population": isolated,
        "islands": islands,
        "phantom_island": isolated > 0,
    }


def flood_metrics(s: State, p: Intervention) -> dict:
    a = s.a_m3 / 10000
    b = s.b_m3 / 8000
    # Explicit synthetic coupling, not a calibrated hydraulic relationship.
    r7 = b + s.buffers_m3["B5"] / 10000
    route = routes(a, r7, p.road_closed)
    exposed_a = math.ceil(2800 * min(1, max(0, a - 0.15) / 0.6))
    exposed_b = math.ceil(1600 * min(1, max(0, b - 0.15) / 0.6))
    vulnerable = math.ceil(exposed_a * 0.35 + exposed_b * 0.4)
    return {
        "zone_a_depth_m": a,
        "zone_b_depth_m": b,
        "r7_depth_proxy_m": r7,
        "affected_population": exposed_a + exposed_b,
        "vulnerable_exposure": vulnerable,
        "equity_fraction": vulnerable / 1620,
        "damage_estimate_inr": (exposed_a + exposed_b) * 1500,
        "infrastructure_risk": min(1, max(a / 1.2, b)),
        "route": route,
    }


def constraints(mode: str, metrics: dict, s: State) -> list[dict]:
    def check(name: str, ok: bool, detail: str) -> dict:
        return {"name": name, "pass": bool(ok), "detail": detail}

    if mode == "flood":
        r = metrics["route"]
        return [
            check("Local flood depth", metrics["zone_a_depth_m"] <= 0.6,
                  "Zone A projected depth must be at most 0.60 m"),
            check("Downstream depth", metrics["zone_b_depth_m"] <= 0.45,
                  "Zone B projected depth must be at most 0.45 m"),
            check("Critical services", r["hospital_timely"],
                  "Hospital route must exist with modeled ETA at most 18 min"),
            check("Connectivity", r["isolated_population"] == 0 and r["shelter_connected"],
                  "No isolated population; shelter route must remain connected"),
            check("Capacity", all(v <= CAPACITY_M3 + 1e-6 for v in s.buffers_m3.values()),
                  "Each synthetic buffer holds at most 8,500 m3"),
            check("Equity", metrics["equity_fraction"] <= 0.65,
                  "EQUITY CONSTRAINT: at most 65% of synthetic vulnerable population exposed"),
        ]
    return [
        check("Transformer", metrics["transformer_load_fraction"] <= 1.05,
              "Transformer modeled load must be at most 105%"),
        check("Hospital water", s.water_m3 >= 400,
              "Shared water reserve must be at least 400 m3"),
        check("Cooling service", metrics["cooling_available"],
              "Water reserve and delivered noncritical power must support cooling"),
        check("Equity", metrics["service_loss_fraction"] <= 0.5,
              "EQUITY CONSTRAINT: noncritical power service loss must be at most 50%"),
    ]


def simulate(initial: State, p: Intervention, assumptions: Assumptions,
             horizon: int = HORIZON_MIN) -> dict:
    validate_mode(initial, p)
    if horizon <= 0 or horizon % STEP_MIN:
        raise ValueError("Horizon must be a positive multiple of 10 minutes")

    s = initial.model_copy(deep=True)
    s.buffers_m3 = dict(initial.buffers_m3)
    trace: list[dict] = []
    echoes: list[dict] = []
    totals = {"rain_m3": 0.0, "outflow_m3": 0.0, "pumped_m3": 0.0, "retained_m3": 0.0}
    start_mass = s.a_m3 + s.b_m3 + sum(s.buffers_m3.values())
    before = flood_metrics(s, p) if s.mode == "flood" else None
    mass_error = None
    m: dict = {}

    for t in range(STEP_MIN, horizon + STEP_MIN, STEP_MIN):
        if s.mode == "flood":
            rainfall = s.rain_m3_min * assumptions.rain_factor * STEP_MIN
            s.a_m3 += rainfall
            pump = min(s.a_m3, 100 * p.pump * assumptions.pump_efficiency * STEP_MIN)
            s.a_m3 -= pump
            gravity = min(s.a_m3, 40 * STEP_MIN) if p.gate_open else 0
            s.a_m3 -= gravity

            retained = 0.0
            if p.buffer:
                room = max(0, CAPACITY_M3 - s.buffers_m3[p.buffer])
                retained = min(s.a_m3, 80 * STEP_MIN, room)
                s.a_m3 -= retained
                s.buffers_m3[p.buffer] += retained

            s.b_m3 += pump + gravity
            blockage = min(assumptions.unknown, 0.05) if p.clear_drain else assumptions.unknown
            discharged = min(s.b_m3, DRAIN_M3_MIN * (1 - blockage) * STEP_MIN)
            s.b_m3 -= discharged

            totals["rain_m3"] += rainfall
            totals["outflow_m3"] += discharged
            totals["pumped_m3"] += pump
            totals["retained_m3"] += retained
            m = flood_metrics(s, p)
            trace.append({
                "minute": t,
                "zone_a_depth_m": m["zone_a_depth_m"],
                "zone_b_depth_m": m["zone_b_depth_m"],
                "hospital_eta_min": m["route"]["hospital_eta_min"],
                "affected_population": m["affected_population"],
            })
        else:
            demand = s.base_kw * (1 + (s.temperature_c - 44) * 0.015)
            demand *= assumptions.rain_factor  # demand uncertainty in heat mode
            pump_kw = 400 * p.pump
            other_kw = demand * (1 - p.noncritical_shed)
            capacity = s.transformer_kw * (1 - assumptions.unknown)

            if p.priority_power:
                delivered_pump = min(pump_kw, capacity)
                delivered_other = min(other_kw, max(0, capacity - delivered_pump))
                requested = delivered_pump + delivered_other
            else:
                requested = pump_kw + other_kw
                fraction = min(1, capacity / max(requested, 1))
                delivered_pump = pump_kw * fraction
                delivered_other = other_kw * fraction

            inflow = 20 * (delivered_pump / 400) * assumptions.pump_efficiency * STEP_MIN
            wanted = 18 * STEP_MIN
            available = s.water_m3 + inflow
            consumed = min(available, wanted)
            s.water_m3 = available - consumed
            m = {
                "temperature_c": s.temperature_c,
                "power_demand_kw": requested,
                "transformer_capacity_kw": capacity,
                "transformer_load_fraction": requested / capacity,
                "power_reserve_kw": max(0, capacity - delivered_pump - delivered_other),
                "pump_capacity_m3_min": inflow / STEP_MIN,
                "water_reserve_m3": s.water_m3,
                "hospital_requirement_m3": 400,
                "cooling_available": s.water_m3 >= 200 and delivered_other >= 300,
                "service_loss_fraction": max(0, 1 - delivered_other / max(demand, 1)),
                "unserved_water_m3": wanted - consumed,
                "affected_population": math.ceil(4400 * max(0, 1 - s.water_m3 / 400)),
                "vulnerable_exposure": math.ceil(1620 * max(0, 1 - s.water_m3 / 400)),
                "damage_estimate_inr": (wanted - consumed) * 1000
                                       + max(0, demand - delivered_other) * 40,
            }
            trace.append({"minute": t, **m})
        s.elapsed_min += STEP_MIN

    if s.mode == "flood":
        end_mass = s.a_m3 + s.b_m3 + sum(s.buffers_m3.values())
        mass_error = end_mass - (start_mass + totals["rain_m3"] - totals["outflow_m3"])
        if abs(mass_error) > 1e-6:
            raise ArithmeticError("Flood mass balance failed")

        def echo(a: str, b: str, value: float, unit: str, label: str) -> None:
            if abs(value) > 1e-9:
                echoes.append({"source": a, "target": b, "value": value,
                               "unit": unit, "label": label})

        echo("P1", "A", -totals["pumped_m3"], "m3", "Pump removes water")
        echo("A", "C12", totals["pumped_m3"], "m3", "Pumped transfer")
        echo("C12", "B", totals["pumped_m3"], "m3", "Downstream receipt")
        if p.buffer:
            echo("A", p.buffer, totals["retained_m3"], "m3", "Storage used")
        echo("B5", "R7", (s.buffers_m3["B5"] - initial.buffers_m3["B5"]) / 10000,
             "m depth proxy", "Synthetic corridor coupling")
        echo("B", "R7", m["zone_b_depth_m"] - before["zone_b_depth_m"],
             "m", "Downstream road exposure")
        old_eta = before["route"]["hospital_eta_min"]
        new_eta = m["route"]["hospital_eta_min"]
        if new_eta != old_eta:
            echoes.append({"source": "R7", "target": "H1", "value": new_eta,
                           "unit": "min; null means disconnected",
                           "label": "Hospital route changed"})
        m["resource_cost_inr"] = (totals["pumped_m3"] * 0.6 + totals["retained_m3"] * 0.2
                                  + (500 if p.clear_drain else 0))
    else:
        m["resource_cost_inr"] = p.pump * 400 * horizon / 60 * 8
        echoes = [
            {"source": "Power", "target": "Transformer", "value": m["transformer_load_fraction"],
             "unit": "load fraction", "label": "Power stress"},
            {"source": "Transformer", "target": "Pump", "value": m["pump_capacity_m3_min"],
             "unit": "m3/min", "label": "Power-constrained pumping"},
            {"source": "Pump", "target": "Water", "value": s.water_m3 - initial.water_m3,
             "unit": "m3", "label": "Reserve change"},
            {"source": "Water", "target": "H1", "value": s.water_m3 - 400,
             "unit": "m3 above hospital threshold", "label": "Hospital reserve margin"},
            {"source": "Water", "target": "Cooling", "value": int(m["cooling_available"]),
             "unit": "available: 1/0", "label": "Cooling service"},
        ]

    checks = constraints(s.mode, m, s)
    accepted = all(c["pass"] for c in checks)
    loss = (sum(not c["pass"] for c in checks) * 1_000_000
            + m["affected_population"] * 20 + m["damage_estimate_inr"] + m["resource_cost_inr"])
    return {
        "source_type": "synthetic",
        "model_label": "SIMULATED ESTIMATE — uncalibrated lumped model",
        "intervention": p.model_dump(),
        "assumptions": assumptions.model_dump(),
        "before": initial.model_dump(),
        "after": s.model_dump(),
        "metrics": m,
        "trace": trace,
        "echoes": echoes,
        "checks": checks,
        "accepted": accepted,
        "loss": loss,
        "mass_balance_error_m3": mass_error,
        "flows": totals if s.mode == "flood" else None,
        "consequence_council": {
            "HYDRO": ({"a_m3": s.a_m3, "b_m3": s.b_m3, **totals}
                      if s.mode == "flood" else {"water_reserve_m3": s.water_m3}),
            "INFRASTRUCTURE": {k: v for k, v in m.items()
                               if "infrastructure" in k or "transformer" in k},
            "MOBILITY": m.get("route", {"scope": "Road mobility is not represented in the heat model"}),
            "SERVICE": {k: v for k, v in m.items()
                        if "hospital" in k or "cooling" in k or "water" in k},
            "HUMAN": {"affected_population": m["affected_population"],
                      "vulnerable_exposure": m["vulnerable_exposure"]},
        },
    }


def find_options(state: State, assumptions: Assumptions) -> list[dict]:
    if state.mode != "flood":
        return []
    output = []
    for c in CANDIDATES:
        distance = math.hypot(c["x"], c["y"])
        available = c["capacity_m3"] - state.buffers_m3.get(c["id"], 0)
        checks = [
            {"name": "Synthetic legal designation", "pass": c["legal"]},
            {"name": "Distance <= 3 km", "pass": distance <= 3000},
            {"name": "Hydraulic connection", "pass": c["connected"]},
            {"name": "Available capacity >= 4800 m3", "pass": available >= 4800},
            {"name": "Human exposure", "pass": c["exposure"] == "low"},
        ]
        precheck = all(x["pass"] for x in checks)
        consequence = None
        if c["id"] in ("B5", "B6") and precheck:
            consequence = simulate(
                state, Intervention(pump=0.6, gate_open=False, buffer=c["id"]), assumptions)
            checks += [
                {"name": "Hospital corridor",
                 "pass": consequence["metrics"]["route"]["hospital_timely"]},
                {"name": "Connectivity",
                 "pass": consequence["metrics"]["route"]["isolated_population"] == 0},
            ]
        output.append({
            **c,
            "distance_m": distance,
            "range": "0–500m" if distance <= 500 else "500m–1km" if distance <= 1000 else "1–3km",
            "available_capacity_m3": available,
            "precheck_pass": precheck,
            "status": "PASS" if all(x["pass"] for x in checks) else "FAIL",
            "checks": checks,
            "simulation": consequence,
            "disclosure": "Location and legal designation are synthetic fixtures",
        })
    return output
