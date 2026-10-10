"""Microsoft Planetary Computer public STAC: Sentinel-2 L2A NDVI and Landsat C2 L2 surface temperature.

Pipeline: AOI -> STAC search -> best scene (lowest cloud, newest) -> SAS-signed COG window reads ->
NDVI (B04/B08, SCL cloud mask) or ST (lwir11 scale/offset from STAC metadata, QA_PIXEL mask) -> statistics.

Integrity rules: scale/offset come only from asset metadata; if pixels cannot be read the scene metadata is
kept but ``stats`` is None and nothing numeric is claimed. Signed URLs/tokens are never stored or returned.
"""
import logging
from datetime import datetime, timedelta, timezone

import httpx

from .cache import TTLCache
from .models import evidence, freshness
from .stac_raster import Signer, bounded_aoi, landsat_st, read_window, sentinel2_ndvi

log = logging.getLogger("rahat.real")
STALE_DAYS = {"sentinel-2-l2a": 15, "landsat-c2-l2": 45}
SEARCH_DAYS = 120
SURFACE_FULL_DAYS, SURFACE_HALF_DAYS = 14, 45   # surface-temperature weight: 1.0 / 0.5 / 0.0 by scene age


def pick_scene(features: list[dict], now: datetime):
    """Lowest cloud cover wins, newest breaks ties. The raw STAC item is kept under ``_item`` (internal)."""
    best = None
    for f in features:
        p = f.get("properties", {})
        dt = p.get("datetime")
        if not dt:
            continue
        cloud = p.get("eo:cloud_cover")
        score = (cloud if cloud is not None else 100, -datetime.fromisoformat(dt.replace("Z", "+00:00")).timestamp())
        if best is None or score < best[0]:
            best = (score, f)
    if not best:
        return None
    f = best[1]
    p = f["properties"]
    acquired = p["datetime"]
    age = (now - datetime.fromisoformat(acquired.replace("Z", "+00:00"))).days
    return {"sceneId": f.get("id"), "acquired": acquired, "cloudCover": p.get("eo:cloud_cover"),
            "ageDays": age, "platform": p.get("platform"), "bbox": f.get("bbox"), "_item": f}


def surface_weight(scene) -> float:
    """How much an observed surface-temperature scene may influence the score (0 when stale/absent)."""
    if not scene or not scene.get("stats") or scene["stats"].get("meanC") is None:
        return 0.0
    age = scene.get("ageDays")
    if age is None:
        return 0.0
    return 1.0 if age <= SURFACE_FULL_DAYS else 0.5 if age <= SURFACE_HALF_DAYS else 0.0


def satellite_context(veg, lst) -> dict:
    """Normalized SatelliteContext fed into the RAHAT data layer. Missing values stay None, never invented."""
    s2 = l8 = None
    if veg:
        st = veg.get("stats") or {}
        s2 = {"sceneId": veg["sceneId"], "acquisitionDate": veg["acquired"], "cloudCover": veg["cloudCover"],
              "ageDays": veg["ageDays"], "meanNdvi": st.get("meanNdvi"), "medianNdvi": st.get("medianNdvi"),
              "vegetationFraction": st.get("vegetationFraction"), "validPixelFraction": st.get("validPixelFraction"),
              "freshness": veg.get("freshness", "UNKNOWN"), "aoi": veg.get("aoi")}
    if lst:
        st = lst.get("stats") or {}
        l8 = {"sceneId": lst["sceneId"], "acquisitionDate": lst["acquired"], "cloudCover": lst["cloudCover"],
              "ageDays": lst["ageDays"], "surfaceTemperatureC": st.get("meanC"), "medianC": st.get("medianC"),
              "validPixelFraction": st.get("validPixelFraction"), "freshness": lst.get("freshness", "UNKNOWN"),
              "aoi": lst.get("aoi"), "weight": surface_weight(lst)}
    return {"sentinel2": s2, "landsat": l8}


class SatelliteService:
    def __init__(self, settings, client: httpx.Client | None = None, clock=None, reader=None):
        self.s = settings
        self.client = client or httpx.Client(timeout=5.0)
        self.cache = TTLCache(ttl=6 * 3600)
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.reader = reader or read_window
        data_base = self.s.stac_url.rsplit("/stac/", 1)[0]    # https://planetarycomputer.microsoft.com/api
        self.signer = Signer(data_base, self.client)

    def _search(self, collection, aoi):
        now = self.clock()
        body = {"collections": [collection], "bbox": aoi,
                "datetime": f"{(now - timedelta(days=SEARCH_DAYS)).strftime('%Y-%m-%d')}/{now.strftime('%Y-%m-%d')}",
                "limit": 30, "query": {"eo:cloud_cover": {"lt": 60}}}
        r = self.client.post(f"{self.s.stac_url}/search", json=body)
        r.raise_for_status()
        return pick_scene(r.json().get("features", []), now)

    def _process(self, collection, scene, aoi):
        item = scene.pop("_item")
        item.setdefault("collection", collection)
        if collection == "sentinel-2-l2a":
            return sentinel2_ndvi(item, aoi, self.signer, reader=self.reader)
        return landsat_st(item, aoi, self.signer, reader=self.reader)

    def _one(self, aoi, collection, label, source, limits):
        ck = (collection, *[round(v, 3) for v in aoi])
        if (hit := self.cache.get(ck)) is not None:
            return hit
        if not self.s.real_enabled:
            return None, evidence(label, source, "PUBLIC_API", "LOW", limitations="Not queried (demo mode).",
                                  fresh="UNKNOWN", extra={"computed": False})
        try:
            scene = self._search(collection, aoi)
            if not scene:
                return None, evidence(label, source, "PUBLIC_API", "LOW", limitations="No suitable scene found.",
                                      fresh="UNKNOWN", extra={"computed": False})
        except Exception as exc:
            log.warning("STAC %s search failed: %s", collection, type(exc).__name__)
            return None, evidence(label, source, "PUBLIC_API", "LOW",
                                  limitations="Planetary Computer unavailable; continuing without.",
                                  fresh="UNKNOWN", extra={"computed": False})
        scene["aoi"] = aoi
        # displayed/stale age = calendar days between acquisition date and today (consistent across the UI)
        scene["ageDays"] = (self.clock().date() - datetime.fromisoformat(
            scene["acquired"].replace("Z", "+00:00")).date()).days
        stats, note = None, ""
        try:
            stats = self._process(collection, scene, aoi)
        except Exception as exc:   # pixel failure: keep scene metadata, claim nothing numeric
            scene.pop("_item", None)
            log.warning("STAC %s pixel processing failed: %s", collection, type(exc).__name__)
            note = " Pixel processing failed; no numeric value is claimed."
        scene["stats"] = stats
        stale = scene["ageDays"] > STALE_DAYS[collection]
        cloud = scene["cloudCover"]
        valid = (stats or {}).get("validPixelFraction") or 0.0
        conf = "MEDIUM" if (stats and not stale and cloud is not None and cloud < 30 and valid >= 0.5) else "LOW"
        ev = evidence(label, source, "PUBLIC_API", conf, scene["acquired"], limits + note,
                      extra={"cloudCover": cloud, "ageDays": scene["ageDays"], "sceneId": scene["sceneId"],
                             "stale": stale, "computed": stats is not None, "aoi": aoi,
                             "ageLabel": f"SATELLITE DATA AGE: {scene['ageDays']} DAYS",
                             "processingSeconds": (stats or {}).get("processingSeconds"),
                             "observationType": "OBSERVED SATELLITE DATA"})
        ev["freshness"] = freshness(scene["acquired"], self.clock(), live_min=0, recent_days=STALE_DAYS[collection])
        scene["freshness"] = ev["freshness"]
        self.cache.set(ck, (scene, ev))
        return scene, ev

    def vegetation(self, lat, lon, aoi=None):
        return self._one(aoi or bounded_aoi(None, lat, lon), "sentinel-2-l2a", "vegetation", "Sentinel-2 L2A",
                         "VEGETATION EVIDENCE (NDVI from B08/B04, observed satellite data). Not street-level shade, "
                         "not real-time, not guaranteed tree cover.")

    def surface_temperature(self, lat, lon, aoi=None):
        return self._one(aoi or bounded_aoi(None, lat, lon), "landsat-c2-l2", "surfaceTemperature",
                         "Landsat C2 L2 ST",
                         "OBSERVED SURFACE TEMPERATURE at overpass time. Not air temperature, not body temperature, "
                         "not a medical measure.")
