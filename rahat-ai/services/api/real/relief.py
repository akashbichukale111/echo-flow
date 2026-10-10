"""Relief ranking over the normalized relief model (OSM mapped + community + demo)."""
from .geo import haversine, nearest_point_index

TYPE_WEIGHT = {"WATER": 1.0, "SHADE": 0.9, "REST": 0.9, "COOLING": 1.0, "HOSPITAL": 0.8, "TRANSIT": 0.6}
CONF = {"HIGH": 1.0, "MEDIUM": 0.75, "LOW": 0.4}
AVAIL = {"AVAILABLE": 1.0, "USER_REPORTED": 0.6, "UNKNOWN": 0.5, "REPORTED_UNAVAILABLE": 0.0}
FRESH = {"LIVE": 1.0, "RECENT": 0.8, "HISTORICAL": 0.5, "UNKNOWN": 0.6}
DEMO_RELIEF_OFFSETS = [  # deterministic demo fixtures near the origin: (type, dlat, dlon, name)
    ("WATER", 0.0012, 0.0008, "Demo water point"), ("SHADE", -0.0009, 0.0011, "Demo canopy stop"),
    ("REST", 0.0016, -0.0010, "Demo rest shelter"), ("COOLING", -0.0020, -0.0014, "Demo cooling room"),
    ("HOSPITAL", 0.0030, 0.0020, "Demo clinic"), ("TRANSIT", 0.0007, -0.0018, "Demo bus stop"),
]


def demo_relief(lat, lon):
    return [{"id": f"demo-relief-{i}", "type": t, "name": n, "latitude": lat + dy, "longitude": lon + dx,
             "source": "Demo relief fallback", "sourceType": "DEMO_DATA", "status": "DEMO",
             "confidence": "LOW", "availability": "UNKNOWN", "lastVerified": None, "freshness": "UNKNOWN"}
            for i, (t, dy, dx, n) in enumerate(DEMO_RELIEF_OFFSETS)]


def rank_relief(items, lat, lon, route_coords=None, hot_rate=None, wanted=None, limit=12):
    """Higher score = better. Components are returned so the ranking is explainable."""
    out = []
    for it in items:
        if wanted and it["type"] not in wanted:
            continue
        dist = haversine(lat, lon, it["latitude"], it["longitude"])
        off_route = None
        if route_coords:
            _i, off_route = nearest_point_index(route_coords, it["latitude"], it["longitude"])
        proximity = 1.0 / (1.0 + dist / 300.0)
        access = 1.0 if off_route is None else 1.0 / (1.0 + off_route / 200.0)
        thermal = 1.0 + (0.3 if (hot_rate or 0) >= 2.1 and it["type"] in ("SHADE", "COOLING", "WATER") else 0.0)
        score = (proximity * 0.4 + access * 0.15) * TYPE_WEIGHT.get(it["type"], 0.5) * thermal \
            + 0.15 * CONF.get(it.get("confidence", "LOW"), 0.4) \
            + 0.15 * FRESH.get(it.get("freshness", "UNKNOWN"), 0.6)
        score *= AVAIL.get(it.get("availability", "UNKNOWN"), 0.5)
        r = dict(it)
        r.update({"distanceMeters": round(dist), "offRouteMeters": None if off_route is None else round(off_route),
                  "score": round(score, 4), "rankReasons": {
                      "distance": round(proximity, 3), "routeAccessibility": round(access, 3),
                      "confidence": it.get("confidence"), "freshness": it.get("freshness"),
                      "availability": it.get("availability")},
                  "note": "Mapped does not mean open." if it.get("sourceType") == "PUBLIC_API" else ""})
        out.append(r)
    out.sort(key=lambda x: (-x["score"], x["distanceMeters"], x["id"]))
    return out[:limit]
