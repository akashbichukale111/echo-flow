import math
from datetime import datetime, timezone
from typing import Protocol

LAT, LON = 18.5913, 73.7389
STAMP = "2026-05-15T14:00:00+05:30"

class WeatherProvider(Protocol):
    def get(self, at: datetime) -> dict: ...

class SolarProvider(Protocol):
    def get(self, at: datetime, lat: float, lon: float) -> dict: ...

class MapProvider(Protocol):
    def get(self) -> dict: ...

class RouteProvider(Protocol):
    def get(self) -> dict: ...

class ShadeProvider(Protocol):
    def ratio(self, a: dict, b: dict, sun: dict, removed: bool) -> float: ...

class ReliefProvider(Protocol):
    def get(self) -> list[dict]: ...

class TrafficProvider(Protocol):
    def delay(self, a: dict, b: dict, requested: float) -> float: ...

class SatelliteProvider(Protocol):
    def get(self) -> dict: ...

class GeocodingProvider(Protocol):
    """Real implementation: Amazon Location Places or any India-capable geocoder."""
    def search(self, text: str) -> list[dict]: ...

class POIProvider(Protocol):
    """Real implementation: public POI datasets (water, toilets, parks, transit, hospitals)."""
    def near(self, lat: float, lon: float, radius_m: float) -> list[dict]: ...

class LocationProvider(Protocol):
    """Demo: simulated journey. Real: explicit, opt-in device location; never persisted."""
    def current(self) -> dict | None: ...

def solar_position(at: datetime, lat: float, lon: float) -> dict:
    """Approximate geometric solar position, without atmospheric refraction."""
    utc = at.astimezone(timezone.utc)
    hour = utc.hour + utc.minute / 60 + utc.second / 3600
    year_days = 366 if utc.year % 4 == 0 and (
        utc.year % 100 != 0 or utc.year % 400 == 0
    ) else 365
    gamma = 2 * math.pi / year_days * (utc.timetuple().tm_yday - 1 + (hour - 12) / 24)
    eq = 229.18 * (
        0.000075 + 0.001868 * math.cos(gamma) - 0.032077 * math.sin(gamma)
        - 0.014615 * math.cos(2 * gamma) - 0.040849 * math.sin(2 * gamma)
    )
    decl = (
        0.006918 - 0.399912 * math.cos(gamma) + 0.070257 * math.sin(gamma)
        - 0.006758 * math.cos(2 * gamma) + 0.000907 * math.sin(2 * gamma)
        - 0.002697 * math.cos(3 * gamma) + 0.00148 * math.sin(3 * gamma)
    )
    solar_minutes = (hour * 60 + eq + 4 * lon) % 1440
    h = math.radians(solar_minutes / 4 - 180)
    p = math.radians(lat)
    sin_el = math.sin(p) * math.sin(decl) + math.cos(p) * math.cos(decl) * math.cos(h)
    elevation = math.degrees(math.asin(max(-1, min(1, sin_el))))
    azimuth = (
        math.degrees(math.atan2(
            math.sin(h), math.cos(h) * math.sin(p) - math.tan(decl) * math.cos(p)
        )) + 180
    ) % 360
    return {
        "azimuth": azimuth,
        "elevation": elevation,
        "direct_weight": max(0.0, sin_el),
        "timestamp": at.isoformat(),
        "source": "MODEL ESTIMATE",
        "method": "Fractional-year solar approximation; no refraction correction",
    }

def create_map() -> dict:
    nodes = []
    for row in range(5):
        for col in range(6):
            x, y = col * 140, row * 140
            nodes.append({
                "id": row * 6 + col,
                "name": f"Demo junction {row * 6 + col:02d}",
                "x": x, "y": y,
                "lat": LAT + y / 111320,
                "lon": LON + x / (111320 * math.cos(math.radians(LAT))),
            })
    edges = []
    for n in nodes:
        row, col = divmod(n["id"], 6)
        if col < 5:
            edges.append([n["id"], n["id"] + 1])
        if row < 4:
            edges.append([n["id"], n["id"] + 6])
    buildings = []
    for row in range(4):
        for col in range(5):
            buildings.append({
                "id": f"b-{row}-{col}",
                "x": col * 140 + 30,
                "y": row * 140 + 28,
                "w": 72, "d": 76,
                "h": 14 + ((row * 7 + col * 11) % 36),
            })
    trees = []
    for x in range(0, 701, 35):
        trees.append({"x": x, "y": 560, "r": 27})
        trees.append({"x": x, "y": 0, "r": 21})
    for x in range(175, 456, 35):
        trees.append({"x": x, "y": 140, "r": 20})
    for y in range(0, 561, 35):
        trees.append({"x": 0, "y": y, "r": 22})
        trees.append({"x": 700, "y": y, "r": 22})
    return {
        "nodes": nodes, "edges": edges, "buildings": buildings, "trees": trees,
        "width": 700, "height": 560,
        "source": "DEMO DATA",
        "coverage": "Synthetic 700 m × 560 m network anchored near Hinjewadi, Pune",
        "timestamp": STAMP,
    }

MAP = create_map()

class DemoMapProvider:
    def get(self):
        return MAP

class DemoRouteProvider:
    def get(self):
        return MAP

class DemoWeatherProvider:
    def get(self, at):
        local_hour = at.hour + at.minute / 60
        return {
            "temperature_c": round(31 + 7 * max(0, math.sin(
                math.pi * (local_hour - 6) / 14
            )), 2),
            "humidity_pct": 42,
            "source": "DEMO DATA",
            "timestamp": at.isoformat(),
            "limitations": "Synthetic weather, not a measurement or forecast",
        }

class DemoSolarProvider:
    def get(self, at, lat, lon):
        return solar_position(at, lat, lon)

def ray_box(x, y, dx, dy, box, max_distance):
    low, high = 0.0, max_distance
    for p, d, lower, upper in (
        (x, dx, box["x"], box["x"] + box["w"]),
        (y, dy, box["y"], box["y"] + box["d"]),
    ):
        if abs(d) < 1e-9:
            if not lower <= p <= upper:
                return False
        else:
            t1, t2 = (lower - p) / d, (upper - p) / d
            low, high = max(low, min(t1, t2)), min(high, max(t1, t2))
            if low > high:
                return False
    return high >= max(low, 0)

class ShadeBase:
    def __init__(self, geometry):
        self.geometry = geometry

    def ratio(self, a, b, sun, removed=False):
        if removed or sun["elevation"] <= 0:
            return 0.0
        az = math.radians(sun["azimuth"])
        dx, dy = math.sin(az), math.cos(az)
        tangent = max(0.01, math.tan(math.radians(sun["elevation"])))
        blocked = 0
        samples = 24
        for k in range(samples):
            t = (k + 0.5) / samples
            x = a["x"] + (b["x"] - a["x"]) * t
            y = a["y"] + (b["y"] - a["y"]) * t
            canopy = any(
                math.hypot(x - tree["x"], y - tree["y"]) <= tree["r"]
                for tree in self.geometry["trees"]
            )
            building = any(
                ray_box(x, y, dx, dy, box, box["h"] / tangent)
                for box in self.geometry["buildings"]
            )
            blocked += int(canopy or building)
        return blocked / samples

class DemoShadeProvider(ShadeBase):
    pass

class DemoReliefProvider:
    def get(self):
        descriptions = [
            ("r1", 1, "Demo water arcade", True, True, False, True),
            ("r2", 5, "Demo cooling room", True, True, True, True),
            ("r3", 12, "Demo rider rest", False, True, False, True),
            ("r4", 17, "Demo destination water", True, False, False, False),
            ("r5", 24, "Demo canopy stop", False, True, False, True),
            ("r6", 28, "Demo relief station", True, True, True, True),
        ]
        return [
            {
                "id": ident, "node": node, "name": name,
                "water": water, "shade": shade, "cooling": cooling, "rest": rest,
                "status": "OPEN", "source": "DEMO DATA",
                "confidence": "Synthetic fixture—not field verified",
                "last_updated": STAMP,
            }
            for ident, node, name, water, shade, cooling, rest in descriptions
        ]

class DemoTrafficProvider:
    def delay(self, a, b, requested):
        # Requested delay is incurred once on this specific bidirectional edge.
        return requested if {a["id"], b["id"]} == {14, 15} else 0.0

class DemoSatelliteProvider:
    def get(self):
        return {
            "status": "DATA UNAVAILABLE",
            "source": None,
            "limitations": "No satellite imagery or canopy dataset is connected",
        }

class Providers:
    def __init__(
        self, weather: WeatherProvider, solar: SolarProvider,
        map_provider: MapProvider, routes: RouteProvider, shade: ShadeProvider,
        relief: ReliefProvider, traffic: TrafficProvider,
        satellite: SatelliteProvider,
    ):
        self.weather = weather
        self.solar = solar
        self.map = map_provider
        self.routes = routes
        self.shade = shade
        self.relief = relief
        self.traffic = traffic
        self.satellite = satellite

def demo_providers():
    return Providers(
        DemoWeatherProvider(), DemoSolarProvider(), DemoMapProvider(),
        DemoRouteProvider(), DemoShadeProvider(MAP), DemoReliefProvider(),
        DemoTrafficProvider(), DemoSatelliteProvider(),
    )
