"""Satellite evidence tests: NDVI, Landsat ST conversion, scene flow, freshness, score weighting.
All network and raster IO is mocked/synthetic."""
from datetime import datetime, timezone

import httpx
import numpy as np

from real.raster import (compute_ndvi, landsat_qa_bad, landsat_surface_temperature_c, ndvi_statistics,
                         scl_invalid_mask, st_statistics)
from real.satellite import SatelliteService, satellite_context, surface_weight
from real.stac_raster import bounded_aoi
from real.thermal import score_route
from tests.test_real import D, ORIG, settings

NOW = datetime(2026, 10, 8, tzinfo=timezone.utc)


def test_ndvi_known_values_and_nodata_and_div_zero():
    # scale 0.0001 offset -0.1 (Sentinel-2 L2A baseline>=4); red=1100->0.01 ... use simple reflectances
    red = np.array([[2000, 1000, 0, 5000]])
    nir = np.array([[6000, 1000, 3000, 5000]])
    nd, ok = compute_ndvi(red, nir, scale=0.0001, offset=0.0, nodata=0)
    assert round(nd[0, 0], 4) == 0.5            # (0.6-0.2)/(0.6+0.2)
    assert round(nd[0, 1], 4) == 0.0
    assert not ok[0, 2]                         # nodata red excluded
    assert round(nd[0, 3], 4) == 0.0
    both_zero, ok0 = compute_ndvi(np.array([[0]]), np.array([[0]]), 0.0001, 0.0, nodata=-1)
    assert not ok0[0, 0] and np.isnan(both_zero[0, 0])   # division by zero handled


def test_ndvi_refuses_unknown_scale_and_masks_clouds():
    assert compute_ndvi(np.ones((2, 2)), np.ones((2, 2)), None, None) == (None, None)
    red = np.full((1, 4), 1000)
    nir = np.full((1, 4), 5000)
    scl = np.array([[4, 9, 3, 5]])               # cloud high, cloud shadow invalid
    nd, ok = compute_ndvi(red, nir, 0.0001, 0.0, nodata=0, invalid_mask=scl_invalid_mask(scl))
    assert ok.tolist() == [[True, False, False, True]]
    st = ndvi_statistics(nd, ok)
    assert st["validPixelFraction"] == 0.5 and st["meanNdvi"] > 0.6 and st["vegetationFraction"] == 1.0


def test_ndvi_all_invalid_gives_none_not_zero():
    nd, ok = compute_ndvi(np.zeros((2, 2)), np.zeros((2, 2)), 0.0001, 0.0, nodata=0)
    st = ndvi_statistics(nd, ok)
    assert st["meanNdvi"] is None and st["validPixelFraction"] == 0.0


def test_landsat_conversion_uses_asset_scale_offset():
    # Collection 2 ST: K = DN*0.00341802 + 149.0 (values come from STAC raster:bands, passed in)
    dn = np.array([[44000, 0, 10000]])
    c, ok = landsat_surface_temperature_c(dn, scale=0.00341802, offset=149.0, nodata=0)
    assert round(c[0, 0], 2) == round(44000 * 0.00341802 + 149.0 - 273.15, 2)
    assert not ok[0, 1]
    assert not ok[0, 2]                          # 183 K is physically implausible for land surface


def test_landsat_never_guesses_scale_and_masks_qa():
    assert landsat_surface_temperature_c(np.array([[1]]), None, None) == (None, None)
    qa = np.array([[0, 1 << 3, 1 << 4, 1 << 6]])  # clear, cloud, shadow, (bit6 = clear-flag, not bad)
    assert landsat_qa_bad(qa).tolist() == [[False, True, True, False]]
    c, ok = landsat_surface_temperature_c(np.full((1, 4), 44000), 0.00341802, 149.0, 0,
                                          bad_mask=landsat_qa_bad(qa))
    st = st_statistics(c, ok)
    assert st["validPixelFraction"] == 0.5 and st["units"] == "degC" and 20 < st["meanC"] < 60


def test_bounded_aoi_is_capped():
    big = bounded_aoi([(28.0, 77.0), (29.0, 78.0)], 28.5, 77.5)
    assert big[2] - big[0] <= 0.0601 and big[3] - big[1] <= 0.0601
    pt = bounded_aoi(None, 28.6, 77.2)
    assert pt[0] < 77.2 < pt[2]


def _feature(sid, collection, dt, cloud, assets):
    return {"id": sid, "collection": collection, "bbox": [77, 28, 78, 29],
            "properties": {"datetime": dt, "eo:cloud_cover": cloud, "platform": "x"}, "assets": assets}


S2_ASSETS = {k: {"href": f"https://blob.test/{k}.tif", "raster:bands": [{"scale": 0.0001, "offset": 0.0,
                                                                          "nodata": 0}]}
             for k in ("B04", "B08", "SCL")}
L_ASSETS = {"lwir11": {"href": "https://blob.test/st.tif",
                       "raster:bands": [{"scale": 0.00341802, "offset": 149.0, "nodata": 0}]},
            "qa_pixel": {"href": "https://blob.test/qa.tif"}}


def fake_reader(href, bbox, max_pixels=400, resampling="nearest"):
    arr = {"B04.tif": np.full((8, 8), 1500), "B08.tif": np.full((8, 8), 4500),
           "SCL.tif": np.full((8, 8), 4), "st.tif": np.full((8, 8), 45000),
           "qa.tif": np.zeros((8, 8), dtype="uint16")}[href.split("?")[0].rsplit("/", 1)[1]]
    return arr, {"scales": [None], "offsets": [None], "nodata": None}


def stac_client(features):
    def handler(request):
        if request.url.path.endswith("/search"):
            return httpx.Response(200, json={"features": features})
        if "/sas/v1/token/" in request.url.path:
            return httpx.Response(200, json={"token": "sv=fake", "msft:expiry": "2099-01-01T00:00:00Z"})
        return httpx.Response(404)
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_sentinel_ndvi_computed_end_to_end_and_cached():
    calls = {"n": 0}

    def counting(request):
        calls["n"] += 1
        return httpx.Response(200, json={"features": [
            _feature("S2-A", "sentinel-2-l2a", "2026-10-01T05:00:00Z", 8.0, S2_ASSETS)]})
    client = httpx.Client(transport=httpx.MockTransport(
        lambda r: counting(r) if r.url.path.endswith("/search") else
        httpx.Response(200, json={"token": "sv=fake", "msft:expiry": "2099-01-01T00:00:00Z"})))
    svc = SatelliteService(settings(), client, clock=lambda: NOW, reader=fake_reader)
    scene, ev = svc.vegetation(*ORIG)
    assert scene["stats"]["meanNdvi"] == 0.5 and scene["stats"]["cloudMaskApplied"] is True
    assert ev["computed"] is True and ev["badge"] == "PUBLIC DATA" and ev["freshness"] == "RECENT"
    assert ev["ageLabel"] == "SATELLITE DATA AGE: 7 DAYS" and ev["sceneId"] == "S2-A"
    assert "token" not in str(ev) and "sv=fake" not in str(ev)
    svc.vegetation(*ORIG)
    assert calls["n"] == 1                       # second call served from cache


def test_landsat_surface_temperature_extracted():
    feats = [_feature("LC-1", "landsat-c2-l2", "2026-09-28T05:00:00Z", 3.0, L_ASSETS)]
    svc = SatelliteService(settings(), stac_client(feats), clock=lambda: NOW, reader=fake_reader)
    scene, ev = svc.surface_temperature(*ORIG)
    expected = round(45000 * 0.00341802 + 149.0 - 273.15, 2)
    assert scene["stats"]["meanC"] == expected and scene["stats"]["units"] == "degC"
    assert "air temperature" in ev["limitations"].lower()


def test_pixel_failure_keeps_metadata_and_reports_unavailable():
    def bad_reader(*a, **k):
        raise OSError("blob unreachable")
    feats = [_feature("S2-A", "sentinel-2-l2a", "2026-10-01T05:00:00Z", 8.0, S2_ASSETS)]
    svc = SatelliteService(settings(), stac_client(feats), clock=lambda: NOW, reader=bad_reader)
    scene, ev = svc.vegetation(*ORIG)
    assert scene["stats"] is None and ev["computed"] is False and ev["confidence"] == "LOW"
    ctx = satellite_context(scene, None)
    assert ctx["sentinel2"]["meanNdvi"] is None and ctx["landsat"] is None   # never fabricated


def test_stac_failure_does_not_raise():
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(503)))
    scene, ev = SatelliteService(settings(), client, clock=lambda: NOW).vegetation(*ORIG)
    assert scene is None and ev["freshness"] == "UNKNOWN"


def test_stale_scene_lowers_confidence_and_weight():
    feats = [_feature("LC-OLD", "landsat-c2-l2", "2026-06-01T05:00:00Z", 3.0, L_ASSETS)]
    svc = SatelliteService(settings(), stac_client(feats), clock=lambda: NOW, reader=fake_reader)
    scene, ev = svc.surface_temperature(*ORIG)
    assert ev["stale"] is True and ev["confidence"] == "LOW" and ev["freshness"] == "HISTORICAL"
    assert surface_weight(scene) == 0.0


def test_surface_weight_by_age():
    mk = lambda age: {"ageDays": age, "stats": {"meanC": 40.0}}  # noqa: E731
    assert surface_weight(mk(5)) == 1.0 and surface_weight(mk(30)) == 0.5 and surface_weight(mk(90)) == 0.0
    assert surface_weight(None) == 0.0 and surface_weight({"ageDays": 1, "stats": None}) == 0.0


def test_surface_temperature_is_separate_capped_term_in_score():
    from real.shade import estimate_shade
    route = {"coords": [(28.63, 77.21), (28.62, 77.22)], "durationS": 600, "distanceM": 1500}
    sh = estimate_shade(route["coords"], [], {"elevation": 60, "azimuth": 180})
    wx = {"feelsLikeC": 40.0, "cloudPct": 0}
    sun = {"elevation": 60, "azimuth": 180}
    base = score_route(route, sh, wx, sun)
    hot = score_route(route, sh, wx, sun, surface_c=50.0, surface_scale=1.0)
    half = score_route(route, sh, wx, sun, surface_c=50.0, surface_scale=0.5)
    none = score_route(route, sh, wx, sun, surface_c=50.0, surface_scale=0.0)
    assert none["thermalLoad"] == base["thermalLoad"]
    assert hot["components"]["environmentalHeat"] == base["components"]["environmentalHeat"]  # air temp untouched
    d_full, d_half = hot["thermalLoad"] - base["thermalLoad"], half["thermalLoad"] - base["thermalLoad"]
    assert 0 < d_half < d_full <= 0.25 * 10 + 1e-6      # cap: SURFACE_WEIGHT u/min * 10 min


def _sat_engine(tmp_path, lst_age):
    """Engine whose satellite layer returns computed scenes (no network)."""
    from tests.test_real import _engine

    class FakeSat:
        def vegetation(self, lat, lon, aoi=None):
            scene = {"sceneId": "S2-X", "acquired": "2026-10-01T05:00:00Z", "cloudCover": 4.0, "ageDays": 7,
                     "freshness": "RECENT", "aoi": aoi, "stats": {"meanNdvi": 0.31, "vegetationFraction": 0.4,
                                                                 "medianNdvi": 0.3, "validPixelFraction": 0.9}}
            return scene, {"key": "vegetation", "sourceType": "PUBLIC_API", "badge": "PUBLIC DATA",
                           "computed": True, "freshness": "RECENT", "confidence": "MEDIUM", "limitations": ""}

        def surface_temperature(self, lat, lon, aoi=None):
            scene = {"sceneId": "LC-X", "acquired": "2026-09-28T05:00:00Z", "cloudCover": 2.0, "ageDays": lst_age,
                     "freshness": "RECENT", "aoi": aoi, "stats": {"meanC": 48.0, "medianC": 47.5,
                                                                 "validPixelFraction": 0.8}}
            return scene, {"key": "surfaceTemperature", "sourceType": "PUBLIC_API", "badge": "PUBLIC DATA",
                           "computed": True, "freshness": "RECENT", "confidence": "MEDIUM", "limitations": ""}
    eng = _engine(tmp_path)
    eng.satellite = FakeSat()
    return eng


def test_satellite_values_reach_normalized_layer_and_score(tmp_path):
    fresh = _sat_engine(tmp_path, 5).analyze(ORIG, D, sun={"altitudeDeg": 60, "azimuthDeg": 190})
    stale = _sat_engine(tmp_path, 90).analyze(ORIG, D, sun={"altitudeDeg": 60, "azimuthDeg": 190})
    ctx = fresh["satelliteContext"]
    assert ctx["sentinel2"]["meanNdvi"] == 0.31 and ctx["landsat"]["surfaceTemperatureC"] == 48.0
    assert fresh["routes"][0]["components"]["surfaceContext"] > 0           # fresh scene contributes
    assert stale["routes"][0]["components"]["surfaceContext"] == 0          # stale scene excluded
    assert "excluded" in " ".join(stale["modelConfidence"]["reasons"])
    # air weather and surface temperature stay separate signals
    assert fresh["weather"]["temperatureC"] == stale["weather"]["temperatureC"]
    assert fresh["routes"][0]["components"]["environmentalHeat"] == stale["routes"][0]["components"]["environmentalHeat"]
