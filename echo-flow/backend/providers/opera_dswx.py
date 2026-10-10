"""NASA OPERA DSWx-S1 availability via the public CMR granule search (no credentials).

Reports whether surface-water products exist for the area/time. It does NOT download or analyse the
raster, and DSWx-S1 is a NASA product derived from Sentinel-1 SAR, not raw Sentinel-1.
"""
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from . import base

PURPOSE = "Satellite surface-water evidence availability (NASA OPERA DSWx-S1, from Sentinel-1 SAR)"
LIMITS = ("Granule availability metadata only: no raster downloaded, no flood extent computed. "
          "Surface water is not equivalent to flood depth.")
URL = "https://cmr.earthdata.nasa.gov/search/granules.json"


def fetch(lat: float, lon: float, days: int = 14, half_width_deg: float = 0.25) -> base.ProviderResult:
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("Coordinates out of range")
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=max(1, min(days, 60)))
    bbox = f"{lon-half_width_deg:.4f},{lat-half_width_deg:.4f},{lon+half_width_deg:.4f},{lat+half_width_deg:.4f}"
    q = urlencode({"short_name": "OPERA_L3_DSWX-S1_V1", "bounding_box": bbox,
                   "temporal": f"{start:%Y-%m-%dT%H:%M:%SZ},{end:%Y-%m-%dT%H:%M:%SZ}",
                   "page_size": 5, "sort_key": "-start_date"})
    full = f"{URL}?{q}"

    def call() -> base.ProviderResult:
        d = base.get_json(full)
        entries = (d.get("feed") or {}).get("entry") or []
        granules = [{"title": e.get("title"), "time_start": e.get("time_start"), "time_end": e.get("time_end"),
                     "id": e.get("id")} for e in entries]
        return base.ProviderResult(provider="nasa-opera-dswx-s1", status="LIVE", provenance=base.REAL,
                                   purpose=PURPOSE, source_url=full, fetched_at=base.utcnow(), limitations=LIMITS,
                                   detail="No granules in window" if not granules else "",
                                   data={"bounding_box": bbox, "window_days": days, "granules_returned": len(granules),
                                         "granules": granules})

    return base.guarded("nasa-opera-dswx-s1", PURPOSE, call, cache_key=f"dswx:{bbox}:{days}",
                        ttl=1800, limitations=LIMITS)
