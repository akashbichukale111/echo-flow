"""Amazon Location route calculator, called SERVER-SIDE only (the key never reaches the browser).

Uses the route-calculator resource API (POST /routes/v0/calculators/{name}/calculate/route, key as query
parameter) — the schema documented for calculator resources such as `echo-flow-routes`.

Honesty rules: a failed call is reported as UNAVAILABLE/ERROR with no geometry; missing configuration is
NOT_CONNECTED. The API key is never logged, returned, or placed in `source_url`.
"""
from __future__ import annotations

import os
import re
from urllib.parse import quote, urlencode

from . import base

PROVIDER = "amazon-location-routes"
PURPOSE = "Road-route calculation between two chosen points"
LIMITS = ("Calculated by the routing service from its road network and typical travel times. It does NOT know "
          "about simulated or real flooding, closures or ECHO-FLOW state, and is not a safety assessment.")
MODES = ("Car", "Truck", "Walking")
_NAME = re.compile(r"^[A-Za-z0-9._-]{1,100}$")
_REGION = re.compile(r"^[a-z]{2}(?:-[a-z]+)+-\d$")


def config() -> tuple[str, str, str]:
    return (os.getenv("AMAZON_LOCATION_API_KEY", "").strip(),
            os.getenv("AMAZON_LOCATION_ROUTE_CALCULATOR", "").strip(),
            os.getenv("AMAZON_LOCATION_REGION", "").strip())


def _position(p) -> list[float] | None:
    if (isinstance(p, (list, tuple)) and len(p) >= 2 and all(isinstance(v, (int, float)) for v in p[:2])
            and -180 <= p[0] <= 180 and -90 <= p[1] <= 90):
        return [float(p[0]), float(p[1])]
    return None


def route(origin: tuple[float, float], destination: tuple[float, float], mode: str = "Car") -> base.ProviderResult:
    """origin / destination are (longitude, latitude)."""
    key, calc, region = config()
    missing = [n for n, v in (("AMAZON_LOCATION_API_KEY", key), ("AMAZON_LOCATION_ROUTE_CALCULATOR", calc),
                              ("AMAZON_LOCATION_REGION", region)) if not v]
    if missing:
        return base.not_connected(PROVIDER, PURPOSE, "Not configured on the backend: set " + ", ".join(missing),
                                  LIMITS)
    if not _NAME.match(calc) or not _REGION.match(region) or mode not in MODES:
        return base.ProviderResult(provider=PROVIDER, status="ERROR", purpose=PURPOSE, fetched_at=base.utcnow(),
                                   detail="Invalid routing configuration or travel mode; no request was sent",
                                   limitations=LIMITS)

    clean_url = f"https://routes.geo.{region}.amazonaws.com/routes/v0/calculators/{quote(calc)}/calculate/route"
    url = f"{clean_url}?{urlencode({'key': key})}"
    payload = {"DeparturePosition": list(origin), "DestinationPosition": list(destination), "TravelMode": mode,
               "DistanceUnit": "Kilometers", "IncludeLegGeometry": True}
    # Keys restricted by HTTP referrer reject server-side calls unless a matching Referer is sent.
    referer = os.getenv("AMAZON_LOCATION_REFERER", "").strip()
    headers = {"Referer": referer} if referer else {}

    def call() -> base.ProviderResult:
        try:
            d = base.post_json(url, payload, headers)
        except base.HttpFailure as exc:
            if exc.status in (401, 403):
                raise base.HttpFailure(
                    "UNAVAILABLE",
                    f"Authorization failed (HTTP {exc.status}): the key must allow geo:CalculateRoute on calculator "
                    f"'{calc}'; if it has a referrer restriction, set AMAZON_LOCATION_REFERER to a matching value.",
                    exc.status) from exc
            raise
        legs, summary = d.get("Legs"), d.get("Summary")
        line: list[list[float]] = []
        for leg in legs if isinstance(legs, list) else []:
            for p in ((leg.get("Geometry") or {}).get("LineString") or []):
                pos = _position(p)
                if pos:
                    line.append(pos)
        dist, secs = (summary or {}).get("Distance"), (summary or {}).get("DurationSeconds")
        if (len(line) < 2 or not isinstance(dist, (int, float)) or not isinstance(secs, (int, float))
                or (summary or {}).get("DistanceUnit") != "Kilometers"):
            return base.ProviderResult(provider=PROVIDER, status="UNAVAILABLE", purpose=PURPOSE,
                                       detail="Service responded but returned no usable route; none is shown",
                                       fetched_at=base.utcnow(), source_url=clean_url, limitations=LIMITS)
        return base.ProviderResult(
            provider=PROVIDER, status="LIVE", provenance=base.DERIVED, purpose=PURPOSE, source_url=clean_url,
            fetched_at=base.utcnow(), limitations=LIMITS,
            data={"distance_km": round(float(dist), 3), "duration_min": round(float(secs) / 60, 1),
                  "travel_mode": mode, "geometry": line, "data_source": (summary or {}).get("DataSource"),
                  "snapped_start": _position(legs[0].get("StartPosition")),
                  "snapped_end": _position(legs[-1].get("EndPosition"))})

    ck = f"route:{region}:{calc}:{mode}:{origin[0]:.5f},{origin[1]:.5f}:{destination[0]:.5f},{destination[1]:.5f}"
    return base.guarded(PROVIDER, PURPOSE, call, cache_key=ck, ttl=300, limitations=LIMITS)
