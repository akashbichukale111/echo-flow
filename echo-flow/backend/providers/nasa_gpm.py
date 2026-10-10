"""NASA GPM / IMERG Early Run adapter boundary.

Credentials (NASA_EARTHDATA_TOKEN) must stay server-side. This adapter deliberately does NOT yet
download/decode IMERG granules: without a verified live fetch path it reports NOT_CONNECTED instead of
guessing. Remaining deployment step is documented in docs/DATA_SOURCES.md. Open-Meteo supplies
rainfall in the meantime and is labelled as such everywhere.
"""
import os

from . import base

PURPOSE = "Near-real-time precipitation (NASA GPM IMERG Early Run)"
LIMITS = "Precipitation estimate only; not observed flood extent."


def fetch(lat: float, lon: float) -> base.ProviderResult:
    if not os.getenv("NASA_EARTHDATA_TOKEN", "").strip():
        return base.not_connected("nasa-gpm-imerg", PURPOSE,
                                  "NASA_EARTHDATA_TOKEN is not configured", LIMITS)
    return base.not_connected(
        "nasa-gpm-imerg", PURPOSE,
        "Credentials present, but the IMERG granule fetch/decode path is not implemented in this build; "
        "no precipitation value is invented", LIMITS)
