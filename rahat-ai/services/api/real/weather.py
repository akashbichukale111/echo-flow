"""WeatherAPI (backend-only key) -> normalized RAHAT weather model; deterministic demo fallback."""
import math
from datetime import datetime, timezone

import httpx

from .cache import TTLCache
from .models import evidence, freshness, now_iso


def normalize_weatherapi(payload: dict) -> dict:
    cur = payload["current"]
    loc = payload.get("location", {})
    observed = None
    if cur.get("last_updated_epoch"):
        observed = datetime.fromtimestamp(cur["last_updated_epoch"], timezone.utc).isoformat()
    w = {
        "temperatureC": float(cur["temp_c"]),
        "feelsLikeC": float(cur.get("feelslike_c", cur["temp_c"])),
        "humidityPct": float(cur.get("humidity", 0)),
        "windKph": float(cur.get("wind_kph", 0)),
        "uvIndex": float(cur.get("uv", 0)),
        "cloudPct": float(cur.get("cloud", 0)),
        "precipitationMm": float(cur.get("precip_mm", 0)),
        "visibilityKm": float(cur.get("vis_km", 10)),
        "condition": (cur.get("condition") or {}).get("text", "Unknown"),
        "observedAt": observed,
        "place": loc.get("name"),
        "source": "WeatherAPI", "sourceType": "PUBLIC_API",
    }
    w["freshness"] = freshness(observed)
    return w


def demo_weather(lat: float, lon: float, at: datetime) -> dict:
    """Deterministic: a pure function of (hour, lat). Never random."""
    h = at.hour + at.minute / 60
    base = 31 + 8 * max(0.0, math.sin(math.pi * (h - 6) / 14))
    return {
        "temperatureC": round(base, 1), "feelsLikeC": round(base + 3.0, 1),
        "humidityPct": 40.0, "windKph": 8.0,
        "uvIndex": round(max(0.0, 9 * math.sin(math.pi * (h - 6) / 12)), 1) if 6 < h < 18 else 0.0,
        "cloudPct": 10.0, "precipitationMm": 0.0, "visibilityKm": 6.0,
        "condition": "Demo clear sky", "observedAt": None, "place": None,
        "source": "Demo weather fallback", "sourceType": "DEMO_DATA", "freshness": "UNKNOWN",
    }


class WeatherService:
    def __init__(self, settings, client: httpx.Client | None = None, clock=None):
        self.s = settings
        self.client = client or httpx.Client(timeout=8.0)
        self.cache = TTLCache(ttl=300)
        self.clock = clock or (lambda: datetime.now(timezone.utc))

    def get(self, lat: float, lon: float):
        """Returns (weather, evidence). Falls back to DEMO DATA on any failure."""
        key = (round(lat, 2), round(lon, 2))
        hit = self.cache.get(key)
        if hit:
            return hit
        result = None
        if self.s.real_enabled and self.s.has_weather:
            try:
                r = self.client.get(f"{self.s.weather_base}/current.json",
                                    params={"key": self.s.weather_key, "q": f"{lat},{lon}", "aqi": "no"})
                r.raise_for_status()
                w = normalize_weatherapi(r.json())
                result = (w, evidence("weather", "WeatherAPI", "PUBLIC_API", "HIGH", w["observedAt"],
                                      "Point observation near the location; not street-level."))
            except Exception as exc:  # never log the request (it carries the key)
                import logging
                logging.getLogger("rahat.real").warning("WeatherAPI failed: %s", type(exc).__name__)
        if result is None:
            w = demo_weather(lat, lon, self.clock())
            result = (w, evidence("weather", w["source"], "DEMO_DATA", "LOW", None,
                                  "Synthetic weather. Not a measurement or forecast.", fresh="UNKNOWN"))
            result[1]["note"] = ("Weather unavailable: WeatherAPI not configured or failed."
                                 if self.s.real_enabled else "Demo mode.")
            return result  # demo results are not cached, so recovery is immediate
        self.cache.set(key, result)
        return result


__all__ = ["WeatherService", "normalize_weatherapi", "demo_weather", "now_iso"]
