"""Tanker route estimate via Amazon Location Routes (backend only).

The API key stays in server configuration. The result is always labelled
ROUTED ESTIMATE / ROAD ROUTE; live traffic is never claimed (the request does
not ask for it). If routing is unavailable a straight-line figure is returned
and labelled as such, never as a road route.
"""
from __future__ import annotations

import threading
from collections import OrderedDict

import httpx

from .config import settings
from .data_sources.base import haversine_km
from .models import Zone

_cache: OrderedDict[tuple, dict] = OrderedDict()
_lock = threading.Lock()
CACHE_SIZE = 128


def _endpoint() -> str:
    return f"https://routes.geo.{settings.location_region}.amazonaws.com/v2/routes"


def _parse(payload: dict) -> dict:
    route = payload["Routes"][0]
    distance_m = duration_s = 0.0
    coordinates: list[list[float]] = []
    for leg in route.get("Legs", []):
        details = leg.get("VehicleLegDetails") or {}
        summary = (details.get("Summary") or {}).get("Overview") or {}
        if "Distance" in summary and "Duration" in summary:
            distance_m += float(summary["Distance"])
            duration_s += float(summary["Duration"])
        else:
            for step in details.get("TravelSteps", []):
                distance_m += float(step.get("Distance", 0))
                duration_s += float(step.get("Duration", 0))
        line = (leg.get("Geometry") or {}).get("LineString")
        if line:
            coordinates.extend([float(p[0]), float(p[1])] for p in line)
    if distance_m <= 0:
        raise ValueError("Route response had no distance")
    return {"distance_km": round(distance_m / 1000, 1),
            "duration_min": round(duration_s / 60), "geometry": coordinates}


def _call(origin: tuple[float, float], destination: tuple[float, float],
          mode: str) -> dict:
    with httpx.Client(timeout=8, follow_redirects=False) as client:
        response = client.post(
            _endpoint(), params={"key": settings.location_key},
            json={"Origin": [origin[1], origin[0]],
                  "Destination": [destination[1], destination[0]],
                  "TravelMode": mode, "LegGeometryFormat": "Simple",
                  "LegAdditionalFeatures": ["Summary"]})
        response.raise_for_status()
        return response.json()


def estimate(zone: Zone) -> dict:
    if zone.tanker_source_lat is None or zone.tanker_source_lon is None:
        return {"status": "UNAVAILABLE", "label": "NO TANKER SOURCE CONFIGURED",
                "message": "Set a tanker source location on the zone to estimate a route."}
    origin = (zone.tanker_source_lat, zone.tanker_source_lon)
    destination = (zone.latitude, zone.longitude)
    base = {
        "origin": {"name": zone.tanker_source_name or "Tanker source",
                   "latitude": origin[0], "longitude": origin[1]},
        "destination": {"name": zone.name, "latitude": destination[0],
                        "longitude": destination[1]},
        "operator_distance_km": zone.distance_km,
        "traffic": "NOT INCLUDED — live traffic is not requested or claimed",
    }
    straight = round(haversine_km(*origin, *destination), 1)
    if settings.location_key:
        key = (round(origin[0], 4), round(origin[1], 4),
               round(destination[0], 4), round(destination[1], 4))
        with _lock:
            if key in _cache:
                _cache.move_to_end(key)
                return {**base, **_cache[key]}
        for mode in ("Truck", "Car"):
            try:
                parsed = _parse(_call(origin, destination, mode))
            except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
                continue
            result = {
                "status": "OK", "label": "ROUTED ESTIMATE",
                "provider": "Amazon Location Service (Routes v2)",
                "travel_mode": mode, "straight_line_km": straight, **parsed,
                "source_type": "PUBLIC DATA", "data_label": "DERIVED MODEL INPUT",
                "note": "Road route from the provider; not live tanker GPS."}
            with _lock:
                _cache[key] = result
                while len(_cache) > CACHE_SIZE:
                    _cache.popitem(last=False)
            return {**base, **result}
    return {
        **base, "status": "STRAIGHT_LINE_ONLY", "label": "STRAIGHT-LINE (NOT A ROAD ROUTE)",
        "provider": "none", "straight_line_km": straight,
        "distance_km": straight, "duration_min": None,
        "geometry": [[origin[1], origin[0]], [destination[1], destination[0]]],
        "message": ("Amazon Location routing is not configured or unavailable; "
                    "showing great-circle distance only."
                    if not settings.location_key else
                    "Amazon Location routing failed; showing great-circle distance only."),
        "data_label": "DERIVED MODEL INPUT",
    }
