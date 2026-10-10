"""Sun position (server-side fallback; the browser uses SunCalc) + Open-Meteo solar radiation context."""
import logging
from datetime import datetime, timezone

import httpx

from providers import solar_position  # existing deterministic approximation (kept, wrapped)

from .cache import TTLCache
from .models import evidence

log = logging.getLogger("rahat.real")


def sun_from_client(sun: dict | None, at: datetime, lat: float, lon: float):
    """Prefer SunCalc values sent by the browser; otherwise the server approximation."""
    if sun and sun.get("altitudeDeg") is not None and sun.get("azimuthDeg") is not None:
        ev = evidence("solar", "SunCalc", "MODEL_ESTIMATE", "HIGH", at.isoformat(),
                      "Geometric sun position; no atmospheric effects.", fresh="LIVE")
        return {"elevation": float(sun["altitudeDeg"]), "azimuth": float(sun["azimuthDeg"]) % 360,
                "source": "SunCalc"}, ev
    p = solar_position(at, lat, lon)
    ev = evidence("solar", "Server solar approximation (SunCalc unavailable)", "MODEL_ESTIMATE",
                  "MEDIUM", at.isoformat(), p["method"], fresh="LIVE")
    return {"elevation": p["elevation"], "azimuth": p["azimuth"], "source": ev["source"]}, ev


class OpenMeteoSolar:
    def __init__(self, settings, client: httpx.Client | None = None):
        self.s = settings
        self.client = client or httpx.Client(timeout=8.0)
        self.cache = TTLCache(ttl=900)

    def get(self, lat, lon):
        key = (round(lat, 2), round(lon, 2))
        if (hit := self.cache.get(key)) is not None:
            return hit
        if not self.s.real_enabled:
            return None, evidence("solarRadiation", "Open-Meteo", "PUBLIC_API", "LOW",
                                  limitations="Not queried (demo mode).", fresh="UNKNOWN")
        try:
            r = self.client.get(self.s.open_meteo_url, params={
                "latitude": lat, "longitude": lon, "timezone": "auto",
                "current": "shortwave_radiation,direct_radiation,diffuse_radiation,cloud_cover"})
            r.raise_for_status()
            cur = r.json()["current"]
            ctx = {"globalWm2": cur.get("shortwave_radiation"), "directWm2": cur.get("direct_radiation"),
                   "diffuseWm2": cur.get("diffuse_radiation"), "cloudPct": cur.get("cloud_cover"),
                   "observedAt": cur.get("time"), "source": "Open-Meteo", "sourceType": "PUBLIC_API"}
            out = (ctx, evidence("solarRadiation", "Open-Meteo", "PUBLIC_API", "MEDIUM",
                                 ctx["observedAt"], "Model-based radiation; not a local sensor.",
                                 fresh="LIVE"))
            self.cache.set(key, out)
            return out
        except Exception as exc:
            log.warning("Open-Meteo failed: %s", type(exc).__name__)
            return None, evidence("solarRadiation", "Open-Meteo", "PUBLIC_API", "LOW",
                                  limitations="Open-Meteo unavailable.", fresh="UNKNOWN")


__all__ = ["sun_from_client", "OpenMeteoSolar", "timezone"]
