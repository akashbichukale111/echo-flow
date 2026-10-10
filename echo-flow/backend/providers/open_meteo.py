"""Open-Meteo: weather / rain / forecast. No API key. Weather model output, not a gauge or flood extent."""
import os
from urllib.parse import urlencode

from . import base

PURPOSE = "Weather, rainfall and forecast input"
LIMITS = ("Forecast/analysis grid product. Precipitation is NOT observed flood extent "
          "and is not NASA IMERG.")


def check_coords(lat: float, lon: float) -> None:
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("Coordinates out of range")


def fetch(lat: float, lon: float) -> base.ProviderResult:
    check_coords(lat, lon)
    url = os.getenv("WEATHER_API_URL", "https://api.open-meteo.com/v1/forecast")
    query = urlencode({
        "latitude": round(lat, 4), "longitude": round(lon, 4), "timezone": "UTC",
        "current": "temperature_2m,precipitation,rain,wind_speed_10m",
        "hourly": "precipitation,precipitation_probability,temperature_2m",
        "forecast_hours": 24,
    })
    full = f"{url}?{query}"

    def call() -> base.ProviderResult:
        d = base.get_json(full)
        hourly = d.get("hourly") or {}
        precip = [p for p in hourly.get("precipitation", []) if isinstance(p, (int, float))]
        prob = [p for p in hourly.get("precipitation_probability", []) if isinstance(p, (int, float))]
        temp = [p for p in hourly.get("temperature_2m", []) if isinstance(p, (int, float))]
        if not d.get("current") and not precip:
            return base.ProviderResult(provider="open-meteo", status="UNAVAILABLE", purpose=PURPOSE,
                                       detail="Response contained no weather values", fetched_at=base.utcnow(),
                                       source_url=full, limitations=LIMITS)
        return base.ProviderResult(
            provider="open-meteo", status="LIVE", provenance=base.REAL, purpose=PURPOSE,
            source_url=full, fetched_at=base.utcnow(), limitations=LIMITS,
            data={
                "current": d.get("current"),
                "units": d.get("current_units"),
                "next_24h": {
                    "max_hourly_precip_mm": max(precip) if precip else None,
                    "total_precip_mm": round(sum(precip), 2) if precip else None,
                    "max_precip_probability_pct": max(prob) if prob else None,
                    "max_temperature_c": max(temp) if temp else None,
                    "hourly_precip_mm": precip,
                },
            })

    return base.guarded("open-meteo", PURPOSE, call, cache_key=f"om:{round(lat,2)}:{round(lon,2)}",
                        ttl=600, limitations=LIMITS)
