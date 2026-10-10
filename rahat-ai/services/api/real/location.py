"""Amazon Location (Places + Routes v2, API-key auth, backend side) with a deterministic demo fallback."""
import logging
import math

import httpx

from .geo import polyline_length
from .models import evidence

log = logging.getLogger("rahat.real")

DELHI = {"CP": (28.6315, 77.2167), "IG": (28.6129, 77.2295)}
DEMO_PLACES = [
    {"name": "India Gate, New Delhi", "lat": 28.6129, "lon": 77.2295},
    {"name": "Connaught Place, New Delhi", "lat": 28.6315, "lon": 77.2167},
    {"name": "AIIMS Delhi", "lat": 28.5672, "lon": 77.2100},
    {"name": "New Delhi Railway Station", "lat": 28.6430, "lon": 77.2197},
    {"name": "Lal Qila (Red Fort)", "lat": 28.6562, "lon": 77.2410},
    {"name": "Akshardham, Delhi", "lat": 28.6127, "lon": 77.2773},
]


def _pos(item):
    p = item.get("Position") or []
    return (float(p[1]), float(p[0])) if len(p) == 2 else None


def normalize_places(payload: dict) -> list[dict]:
    out = []
    for it in payload.get("ResultItems", []):
        pos = _pos(it)
        if not pos:
            continue
        label = (it.get("Address") or {}).get("Label") or it.get("Title") or "Unnamed place"
        out.append({"id": it.get("PlaceId"), "name": it.get("Title") or label, "label": label,
                    "lat": pos[0], "lon": pos[1], "source": "Amazon Location",
                    "sourceType": "PUBLIC_API"})
    return out


def normalize_routes(payload: dict, travel_mode: str) -> list[dict]:
    """Amazon Location CalculateRoutes (v2, LegGeometryFormat=Simple) -> RAHAT routes."""
    routes = []
    for i, r in enumerate(payload.get("Routes", [])):
        coords, legs, dist, dur = [], [], 0.0, 0.0
        for leg in r.get("Legs", []):
            line = (leg.get("Geometry") or {}).get("LineString") or []
            pts = [(float(p[1]), float(p[0])) for p in line]
            if not pts:
                continue
            ld = float((leg.get("VehicleLegDetails") or leg.get("PedestrianLegDetails") or {})
                       .get("Summary", {}).get("Overview", {}).get("Distance") or polyline_length(pts))
            lt = float((leg.get("VehicleLegDetails") or leg.get("PedestrianLegDetails") or {})
                       .get("Summary", {}).get("Overview", {}).get("Duration") or 0)
            legs.append({"distanceM": ld, "durationS": lt, "pointCount": len(pts)})
            coords += pts if not coords else pts[1:]
            dist += ld
            dur += lt
        if len(coords) < 2:
            continue
        summ = (r.get("Summary") or {}).get("Overview") or {}
        dist = float(summ.get("Distance") or dist or polyline_length(coords))
        dur = float(summ.get("Duration") or dur)
        if dur <= 0:  # provider gave no duration: derive from a stated nominal speed, flagged
            dur = dist / ({"Pedestrian": 1.3, "Scooter": 5.0}.get(travel_mode, 7.0))
        routes.append({"providerRouteId": f"amazon-{i}", "coords": coords, "distanceM": dist,
                       "durationS": dur, "legs": legs, "source": "Amazon Location",
                       "sourceType": "PUBLIC_API", "alternative": i > 0})
    return routes


def demo_route_variants(o, d) -> list[dict]:
    """OSRM real alternative routes, with forced waypoints for detours. DEMO DATA."""
    import httpx
    out = []
    def fetch_osrm(via_pt=None):
        try:
            coords = f"{o[1]},{o[0]};{via_pt[1]},{via_pt[0]};{d[1]},{d[0]}" if via_pt else f"{o[1]},{o[0]};{d[1]},{d[0]}"
            r = httpx.get(f"http://router.project-osrm.org/route/v1/driving/{coords}?overview=full&geometries=geojson&alternatives=true", timeout=5.0)
            data = r.json()
            if data.get("code") == "Ok" and "routes" in data:
                res = []
                for i, route in enumerate(data["routes"]):
                    pts = [(p[1], p[0]) for p in route["geometry"]["coordinates"]]
                    dist = float(route["distance"])
                    dur = float(route["duration"])
                    res.append({"providerRouteId": f"osrm-{len(out)}-{i}", "coords": pts, "distanceM": dist, "durationS": dur, "legs": [{"distanceM": dist, "durationS": dur, "pointCount": len(pts)}], "source": "OSRM Routing", "sourceType": "PUBLIC_API", "alternative": True})
                return res
        except Exception:
            pass
        return []

    # Get primary alternatives
    out.extend(fetch_osrm())
    
    # Force real street detours if we need more options
    if len(out) < 3:
        for bow in (0.2, -0.2):
            mid_t = 0.5
            lat = o[0] + (d[0] - o[0]) * mid_t
            lon = o[1] + (d[1] - o[1]) * mid_t
            off = bow * math.sin(math.pi * mid_t) * 0.02
            via = (lat + off * 0.7, lon - off)
            out.extend(fetch_osrm(via))
            if len(out) >= 3:
                break

    # If OSRM completely fails, return nothing rather than fake lines so we don't draw flying routes
    return out


class LocationService:
    def __init__(self, settings, client: httpx.Client | None = None):
        self.s = settings
        self.client = client or httpx.Client(timeout=10.0)

    def _base(self, svc):
        return f"https://{svc}.geo.{self.s.aws_region}.amazonaws.com/v2"

    @property
    def live(self):
        return self.s.real_enabled and self.s.has_location

    def _post(self, svc, path, body):
        r = self.client.post(f"{self._base(svc)}{path}", params={"key": self.s.location_api_key},
                             json=body)
        r.raise_for_status()
        return r.json()

    def search(self, text, bias=None, limit=6):
        text = (text or "").strip()
        if self.live and text:
            try:
                body = {"QueryText": text, "MaxResults": limit, "Language": "en"}
                if bias:
                    body["BiasPosition"] = [bias[1], bias[0]]
                items = normalize_places(self._post("places", "/search-text", body))
                return items, evidence("places", "Amazon Location", "PUBLIC_API", "HIGH")
            except Exception as exc:
                log.warning("Amazon Location search failed: %s", type(exc).__name__)
        q = text.lower()
        hits = [dict(p, id=None, label=p["name"], source="Demo place fallback",
                     sourceType="DEMO_DATA") for p in DEMO_PLACES if q in p["name"].lower()]
        return hits[:limit], evidence("places", "Demo place fallback", "DEMO_DATA", "LOW",
                                      limitations="Fixed demo landmarks only.", fresh="UNKNOWN")

    def reverse(self, lat, lon):
        if self.live:
            try:
                data = self._post("places", "/reverse-geocode",
                                  {"QueryPosition": [lon, lat], "MaxResults": 1})
                items = data.get("ResultItems", [])
                if items:
                    label = (items[0].get("Address") or {}).get("Label") or items[0].get("Title")
                    return {"label": label, "source": "Amazon Location", "sourceType": "PUBLIC_API"}
            except Exception as exc:
                log.warning("Amazon Location reverse failed: %s", type(exc).__name__)
        return {"label": f"{lat:.4f}, {lon:.4f}", "source": "Coordinates",
                "sourceType": "USER_INPUT"}

    def routes(self, origin, dest, travel_mode="Scooter", alternatives=2):
        """origin/dest are (lat, lon). Returns (routes, evidence). Demo only if real fails."""
        aws_mode = "Scooter"
        if travel_mode in ("walk", "Pedestrian"):
            aws_mode = "Pedestrian"
        elif travel_mode in ("car", "Car"):
            aws_mode = "Car"
        elif travel_mode in ("truck", "Truck"):
            aws_mode = "Truck"
            
        if self.live:
            try:
                body = {"Origin": [origin[1], origin[0]], "Destination": [dest[1], dest[0]],
                        "TravelMode": aws_mode, "LegGeometryFormat": "Simple",
                        "MaxAlternatives": alternatives, "DepartNow": True}
                routes = normalize_routes(self._post("routes", "/routes", body), aws_mode)
                if routes:
                    return routes, evidence("route", "Amazon Location", "PUBLIC_API", "HIGH",
                                            limitations="Road geometry from provider; no live "
                                            "per-segment traffic in this model.")
            except Exception as exc:
                log.warning("Amazon Location routes failed: %s", type(exc).__name__)
            if not self.s.demo_fallback:
                return [], evidence("route", "Amazon Location", "PUBLIC_API", "LOW",
                                    limitations="Route provider unavailable.", fresh="UNKNOWN")
        routes = demo_route_variants(origin, dest)
        ev = evidence("route", "Demo route fallback", "DEMO_DATA", "LOW",
                      limitations="Synthetic geometry. Not a real road route.", fresh="UNKNOWN")
        if self.s.real_enabled:
            ev["note"] = "Amazon Location unavailable; DEMO route shown."
        return routes, ev


def demo_buildings(routes: list[dict]) -> list[dict]:
    """Deterministic synthetic buildings flanking the demo detour routes (DEMO DATA only).

    Used only when the route itself is a demo fallback, so the demo can show a shade trade-off.
    Real routes never receive these; with no OSM data a real route simply has 0% estimated shade.
    """
    out = []
    for r in routes:
        if r["providerRouteId"] == "demo-0":
            continue
        for i, (la, lo) in enumerate(r["coords"][1:-1:1]):
            for side, dy in ((0, -17e-5), (1, 17e-5)):  # a building each side of the road, ~19 m away
                h = 28.0 + ((i * 7 + side * 5) % 5) * 6.0
                d = 11e-5
                out.append({"id": f"demo-b-{r['providerRouteId']}-{i}-{side}", "heightM": h, "levels": None,
                            "ring": [(la + dy - d, lo - d), (la + dy - d, lo + d), (la + dy + d, lo + d),
                                     (la + dy + d, lo - d), (la + dy - d, lo - d)]})
    return out
