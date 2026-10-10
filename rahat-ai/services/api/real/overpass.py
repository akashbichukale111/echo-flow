"""OpenStreetMap via Overpass: buildings (footprints/height/levels) and relief POIs. Cached + throttled."""
import logging

import httpx

from .cache import Throttle, TTLCache, round_key
from .geo import haversine
from .models import evidence

log = logging.getLogger("rahat.real")
ATTRIB = "© OpenStreetMap contributors (ODbL)"

RELIEF_TAGS = [
    ('amenity', 'drinking_water', "WATER"), ('amenity', 'water_point', "WATER"),
    ('man_made', 'water_tap', "WATER"), ('amenity', 'fountain', "WATER"),
    ('leisure', 'park', "SHADE"), ('amenity', 'shelter', "REST"),
    ('highway', 'rest_area', "REST"), ('amenity', 'hospital', "HOSPITAL"),
    ('amenity', 'clinic', "HOSPITAL"), ('highway', 'bus_stop', "TRANSIT"),
    ('public_transport', 'platform', "TRANSIT"),
]


def bbox_of(coords, pad_m=150.0):
    lats, lons = [c[0] for c in coords], [c[1] for c in coords]
    dlat = pad_m / 111320.0
    dlon = pad_m / (111320.0 * max(0.2, __import__("math").cos(__import__("math").radians(lats[0]))))
    return min(lats) - dlat, min(lons) - dlon, max(lats) + dlat, max(lons) + dlon


def parse_buildings(payload: dict) -> list[dict]:
    out = []
    for el in payload.get("elements", []):
        tags, geom = el.get("tags", {}), el.get("geometry")
        if el.get("type") != "way" or not geom or "building" not in tags or len(geom) < 4:
            continue
        height = None
        try:
            if "height" in tags:
                height = float(str(tags["height"]).replace("m", "").strip())
        except ValueError:
            height = None
        levels = None
        try:
            if "building:levels" in tags:
                levels = float(tags["building:levels"])
        except ValueError:
            levels = None
        out.append({"id": f"w{el['id']}", "ring": [(g["lat"], g["lon"]) for g in geom],
                    "heightM": height, "levels": levels})
    return out


def parse_relief(payload: dict) -> list[dict]:
    out = []
    for el in payload.get("elements", []):
        tags = el.get("tags", {})
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lon = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat is None or lon is None:
            continue
        kind = next((k for (t, v, k) in RELIEF_TAGS if tags.get(t) == v), None)
        if tags.get("shelter") == "yes" and kind is None:
            kind = "REST"
        if kind is None:
            continue
        out.append({"id": f"osm-{el['type'][0]}{el['id']}", "type": kind,
                    "name": tags.get("name") or {"WATER": "Mapped water point", "SHADE": "Mapped park",
                                                 "REST": "Mapped shelter/rest", "HOSPITAL": "Mapped medical facility",
                                                 "TRANSIT": "Mapped transit stop", "COOLING": "Mapped cooling"}[kind],
                    "latitude": float(lat), "longitude": float(lon), "source": "OpenStreetMap",
                    "sourceType": "PUBLIC_API", "status": "MAPPED", "confidence": "MEDIUM",
                    "availability": "UNKNOWN", "lastVerified": None, "freshness": "UNKNOWN",
                    "attribution": ATTRIB})
    return out


class OverpassService:
    def __init__(self, settings, client: httpx.Client | None = None, throttle=None):
        self.s = settings
        self.client = client or httpx.Client(timeout=25.0, headers={"User-Agent": "RAHAT-AI/1.0"})
        self.cache = TTLCache(ttl=1800)
        self.throttle = throttle or Throttle(1.5)

    def _query(self, q):
        self.throttle.wait()
        r = self.client.post(self.s.overpass_url, data={"data": q})
        r.raise_for_status()
        return r.json()

    def buildings(self, coords):
        s, w, n, e = bbox_of(coords)
        key = ("b", *round_key(s, w, n, e, nd=3))
        if (hit := self.cache.get(key)) is not None:
            return hit
        if not self.s.real_enabled:
            return [], evidence("buildings", "OpenStreetMap", "PUBLIC_API", "LOW",
                                limitations="Not queried (demo mode).", fresh="UNKNOWN")
        try:
            q = f'[out:json][timeout:20];way["building"]({s},{w},{n},{e});out geom 400;'
            res = parse_buildings(self._query(q))
            ev = evidence("buildings", "OpenStreetMap + Overpass", "PUBLIC_API",
                          "MEDIUM" if res else "LOW", limitations=ATTRIB + ". Heights often missing.")
            ev["count"] = len(res)
            self.cache.set(key, (res, ev))
            return res, ev
        except Exception as exc:
            log.warning("Overpass buildings failed: %s", type(exc).__name__)
            return [], evidence("buildings", "OpenStreetMap + Overpass", "PUBLIC_API", "LOW",
                                limitations="Overpass unavailable: shade uses no building data.",
                                fresh="UNKNOWN")

    def relief(self, lat, lon, radius_m=800):
        key = ("r", *round_key(lat, lon, nd=3), radius_m)
        if (hit := self.cache.get(key)) is not None:
            return hit
        if not self.s.real_enabled:
            return [], evidence("relief", "OpenStreetMap + Overpass", "PUBLIC_API", "LOW",
                                limitations="Not queried (demo mode).", fresh="UNKNOWN")
        try:
            parts = "".join(f'nwr["{t}"="{v}"](around:{radius_m},{lat},{lon});' for t, v, _ in RELIEF_TAGS)
            parts += f'nwr["shelter"="yes"](around:{radius_m},{lat},{lon});'
            items = parse_relief(self._query(f"[out:json][timeout:20];({parts});out center 200;"))
            for it in items:
                it["distanceMeters"] = round(haversine(lat, lon, it["latitude"], it["longitude"]))
            ev = evidence("relief", "OpenStreetMap + Overpass", "PUBLIC_API", "MEDIUM",
                          limitations="Mapped does not mean open or working. " + ATTRIB)
            ev["count"] = len(items)
            self.cache.set(key, (items, ev))
            return items, ev
        except Exception as exc:
            log.warning("Overpass relief failed: %s", type(exc).__name__)
            ev = evidence("relief", "OpenStreetMap + Overpass", "PUBLIC_API", "LOW",
                          limitations="Overpass unavailable: no mapped relief.", fresh="UNKNOWN")
            ev["unavailable"] = True  # lets callers tell "provider failed" apart from "nothing mapped nearby"
            return [], ev
