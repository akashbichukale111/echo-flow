import heapq
import math
from datetime import timedelta
from itertools import count

from models import MODES, PlanRequest
from providers import LAT, LON

SPEED_M_PER_MIN = {"walk": 75.0, "cycle": 200.0, "rider": 300.0}

class RouteUnavailable(ValueError):
    pass

def environmental_rate(weather):
    # Illustrative environmental index. Not a physiological or clinical model.
    return (
        max(0.0, weather["temperature_c"] - 24.0) * 0.10
        + max(0.0, weather["humidity_pct"] - 40.0) * 0.006
    )

def segment_metrics(a, b, q, weather, sun, providers):
    distance = math.hypot(b["x"] - a["x"], b["y"] - a["y"])
    moving = distance / SPEED_M_PER_MIN[q.travel_mode]
    delay = providers.traffic.delay(a, b, q.delay_min)
    shade = providers.shade.ratio(a, b, sun, q.shade_removed)
    duration = moving + delay
    ambient_rate = environmental_rate(weather)
    direct_rate = 2.0 * sun["direct_weight"]
    ambient = moving * ambient_rate
    direct = moving * direct_rate
    shade_reduction = -direct * shade
    delay_load = delay * (ambient_rate + direct_rate * (1 - shade))
    total = ambient + direct + shade_reduction + delay_load
    orientation = math.degrees(math.atan2(
        b["x"] - a["x"], b["y"] - a["y"]
    )) % 360
    available = [
        p for p in providers.relief.get()
        if p["status"] == "OPEN" and p["id"] not in q.closed_relief
        and p["node"] in (a["id"], b["id"])
        and (not q.need_water or p["water"])
        and (not q.need_cooling or p["cooling"])
        and (not q.need_shade or p["shade"])
    ]
    need_access = len([
        p for p in providers.relief.get()
        if p["status"] == "OPEN" and p["id"] not in q.closed_relief
        and p["node"] in (a["id"], b["id"])
        and (not q.needs or set(q.needs) & set(p.get("tags", [])))
    ])
    return {
        "need_access": need_access,
        "a": a["id"], "b": b["id"], "distance": distance,
        "minutes": duration, "moving_minutes": moving, "delay_minutes": delay,
        "shade": shade, "solar_exposure": sun["direct_weight"] * (1 - shade),
        "load": total, "rate": total / duration if duration else 0,
        "relief_access": len(available),
        "road_orientation": orientation,
        "confidence": "Uncalibrated synthetic model",
        "breakdown": {
            "Ambient heat context": ambient,
            "Unshaded solar baseline": direct,
            "Estimated shade reduction": shade_reduction,
            "Traffic delay": delay_load,
        },
    }

def edge_cost(e, mode, q):
    base = e["minutes"] + e["distance"] / 10000
    if mode == "fastest":
        return base
    if mode == "relief-priority":
        # Bounded benefit (< base) keeps every edge cost positive.
        return (
            base + 0.9 * e["load"]
            - 0.7 * base * min(1, e.get("need_access", e["relief_access"]))
        )
    thermal = q.thermal_weight * e["load"] * (0.5 if mode == "balanced" else 1.0)
    shade_penalty = e["minutes"] * (1 - e["shade"]) if q.need_shade else 0
    benefit = (
        q.relief_weight * base * min(1, e["relief_access"])
        if mode == "balanced" else 0
    )
    # Benefit is bounded, so every edge remains nonnegative.
    return base + thermal + shade_penalty - benefit

def constrained_path(edges, origin, destination, mode, q, max_minutes=math.inf):
    if origin == destination:
        return []
    adjacency = {}
    for e in edges:
        adjacency.setdefault(e["a"], []).append(e)
    serial = count()
    heap = [(0.0, 0.0, next(serial), origin, [])]
    labels = {origin: [(0.0, 0.0)]}
    explored = 0
    while heap:
        cost, elapsed, _, node, path = heapq.heappop(heap)
        if (cost, elapsed) not in labels.get(node, []):
            continue
        if node == destination:
            return path
        explored += 1
        if explored > 100000:
            raise RouteUnavailable("Routing complexity limit exceeded")
        for edge in adjacency.get(node, []):
            new_time = elapsed + edge["minutes"]
            if new_time > max_minutes + 1e-8:
                continue
            new_cost = cost + edge_cost(edge, mode, q)
            target = edge["b"]
            old = labels.get(target, [])
            if any(c <= new_cost and t <= new_time for c, t in old):
                continue
            labels[target] = [
                (c, t) for c, t in old
                if not (new_cost <= c and new_time <= t)
            ] + [(new_cost, new_time)]
            heapq.heappush(
                heap, (new_cost, new_time, next(serial), target, path + [edge])
            )
    raise RouteUnavailable("No route satisfies the constraints")

def summarize(path, mode, q, pois, weather, fastest_minutes=0):
    nodes = [path[0]["a"]] + [e["b"] for e in path] if path else [q.origin]
    on_route = [
        p for p in pois
        if p["node"] in nodes and p["id"] not in q.closed_relief
        and p["status"] == "OPEN"
    ]
    eligible_rest = [p for p in on_route if p["rest"]]
    rest_minutes = q.rest_min if eligible_rest else 0.0
    # Rest does not erase historical exposure. It adds a lower-rate exposure interval.
    rest_load = rest_minutes * environmental_rate(weather) * 0.4
    distance = sum(e["distance"] for e in path)
    moving_time = sum(e["minutes"] for e in path)
    breakdown = {}
    for e in path:
        for key, value in e["breakdown"].items():
            breakdown[key] = breakdown.get(key, 0.0) + value
    if rest_minutes:
        breakdown["Sheltered rest interval"] = rest_load
    return {
        "mode": mode, "nodes": nodes, "segments": path,
        "minutes": moving_time + rest_minutes,
        "travel_minutes": moving_time,
        "distance": distance,
        "load": sum(e["load"] for e in path) + rest_load,
        "shade": (
            sum(e["shade"] * e["distance"] for e in path) / distance
            if distance else 0
        ),
        "solar_exposure": (
            sum(e["solar_exposure"] * e["minutes"] for e in path) / moving_time
            if moving_time else 0
        ),
        "relief_count": len(on_route), "relief_ids": [p["id"] for p in on_route],
        "rest_minutes": rest_minutes, "rest_load": rest_load,
        "rest_node": eligible_rest[0]["node"] if rest_minutes else None,
        "rest_unavailable": bool(q.rest_min and not eligible_rest),
        "rest_interval_exceeded": moving_time > q.rest_interval_min,
        "detour_minutes": moving_time - fastest_minutes,
        "breakdown": breakdown,
        "confidence": "Uncalibrated model; synthetic geometry and weather",
    }

class Engine:
    def __init__(self, providers):
        self.providers = providers

    def scan(self, q):
        weather = dict(self.providers.weather.get(q.departure))
        weather["temperature_c"] += q.temp_offset_c
        if q.temp_offset_c:
            weather["source"] = "DEMO DATA + SCENARIO OFFSET"
        network = self.providers.routes.get()
        lat0, lon0 = network.get("anchor", (LAT, LON))
        sun = self.providers.solar.get(q.departure, lat0, lon0)
        nodes = {n["id"]: n for n in network["nodes"]}
        if q.origin not in nodes or q.destination not in nodes:
            raise RouteUnavailable("Requested node is outside provider coverage")
        if not all(math.isfinite(weather[k]) for k in ("temperature_c", "humidity_pct")):
            raise ValueError("Weather provider returned invalid values")
        edges = []
        for a, b in network["edges"]:
            edges.append(segment_metrics(nodes[a], nodes[b], q, weather, sun, self.providers))
            edges.append(segment_metrics(nodes[b], nodes[a], q, weather, sun, self.providers))
        return {"weather": weather, "sun": sun, "edges": edges}

    def routes(self, q, scan):
        fastest = constrained_path(
            scan["edges"], q.origin, q.destination, "fastest", q
        )
        fast_minutes = sum(e["minutes"] for e in fastest)
        limit = fast_minutes * (1 + q.max_detour_pct / 100)
        result = []
        for mode in MODES:
            path = fastest if mode == "fastest" else constrained_path(
                scan["edges"], q.origin, q.destination, mode, q, limit
            )
            result.append(summarize(
                path, mode, q, self.providers.relief.get(),
                scan["weather"], fast_minutes
            ))
        return result

    def relief(self, q, node, radius=1000, scan=None):
        scan = scan or self.scan(q)
        direct = constrained_path(
            scan["edges"], node, q.destination, "fastest", q
        )
        direct_time = sum(e["minutes"] for e in direct)
        ranked = []
        for p in self.providers.relief.get():
            if p["status"] != "OPEN" or p["id"] in q.closed_relief:
                continue
            if q.need_water and not p["water"]:
                continue
            if q.need_cooling and not p["cooling"]:
                continue
            if q.need_shade and not p["shade"]:
                continue
            to_relief = constrained_path(scan["edges"], node, p["node"], "fastest", q)
            distance = sum(e["distance"] for e in to_relief)
            if distance > radius:
                continue
            onwards = constrained_path(
                scan["edges"], p["node"], q.destination, "fastest", q
            )
            minutes = sum(e["minutes"] for e in to_relief)
            detour = max(
                0, minutes + sum(e["minutes"] for e in onwards) - direct_time
            )
            load = sum(e["load"] for e in to_relief)
            score = minutes + 0.5 * load + detour - (
                0.5 * int(p["water"]) + 0.8 * int(p["cooling"])
                + 0.3 * int(p["shade"]) + 0.2 * int(p["rest"])
            )
            ranked.append({
                **p, "distance": distance, "minutes": minutes,
                "detour_minutes": detour, "load_to_relief": load,
                "rank_score": score,
            })
        return sorted(ranked, key=lambda x: (x["rank_score"], x["id"]))

    def scenario(self, base, scenario, orchestrate):
        values = base.model_dump()
        if scenario == "earlier":
            values["departure"] -= timedelta(hours=2)
        elif scenario == "later":
            values["departure"] += timedelta(hours=2)
        elif scenario == "traffic":
            values["delay_min"] = min(30, values["delay_min"] + 5)
        elif scenario == "shade-removed":
            values["shade_removed"] = True
        elif scenario == "station-closed":
            values["closed_relief"] = sorted(set(values["closed_relief"] + ["r6"]))
        elif scenario == "rest":
            values["rest_min"] = min(30, values["rest_min"] + 5)
        changed = PlanRequest(**values)
        before, after = orchestrate(base), orchestrate(changed)
        return {
            "before": before, "after": after,
            "delta": [
                {
                    "mode": a["mode"],
                    "minutes": a["minutes"] - b["minutes"],
                    "distance": a["distance"] - b["distance"],
                    "load": a["load"] - b["load"],
                    "shade": a["shade"] - b["shade"],
                    "relief_count": a["relief_count"] - b["relief_count"],
                }
                for b, a in zip(before["routes"], after["routes"])
            ],
        }
