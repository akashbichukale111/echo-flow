"""Tests for the real-data layer. All HTTP is mocked; nothing here touches the network."""
import math
from datetime import datetime, timezone

import httpx
from fastapi.testclient import TestClient

from main import create_app
from real import community as comm
from real.config import Settings
from real.location import LocationService, normalize_routes
from real.models import freshness
from real.overpass import parse_buildings, parse_relief
from real.relief import demo_relief, rank_relief
from real.satellite import pick_scene
from real.service import RealEngine, pick_modes
from real.shade import estimate_shade
from real.thermal import accumulate, score_route
from real.weather import WeatherService, normalize_weatherapi
from store import SQLiteStore

ORIG, D = (28.6315, 77.2167), (28.6129, 77.2295)


def settings(**kw):
    base = dict(provider_mode="real", demo_fallback=True, aws_region="ap-south-1",
                location_api_key="test-loc", weather_key="test-weather",
                weather_base="https://wx.test/v1", overpass_url="https://op.test/api",
                stac_url="https://stac.test/v1", bedrock_model="",
                open_meteo_url="https://om.test/v1/forecast")
    base.update(kw)
    return Settings(**base)


WX = {"location": {"name": "New Delhi"}, "current": {
    "last_updated_epoch": int(datetime.now(timezone.utc).timestamp()), "temp_c": 39.0, "feelslike_c": 44.0,
    "humidity": 30, "wind_kph": 9, "uv": 9, "cloud": 5, "precip_mm": 0, "vis_km": 4,
    "condition": {"text": "Sunny"}}}


def test_weather_normalization_and_labels():
    w = normalize_weatherapi(WX)
    assert w["temperatureC"] == 39.0 and w["feelsLikeC"] == 44.0
    assert w["source"] == "WeatherAPI" and w["sourceType"] == "PUBLIC_API"
    assert w["freshness"] == "LIVE"


def test_weather_falls_back_to_labelled_demo_on_failure():
    def boom(request):
        return httpx.Response(500)
    svc = WeatherService(settings(), httpx.Client(transport=httpx.MockTransport(boom)))
    w, ev = svc.get(*ORIG)
    assert w["sourceType"] == "DEMO_DATA" and ev["badge"] == "DEMO DATA"


def test_weather_real_never_leaks_key_in_evidence():
    svc = WeatherService(settings(), httpx.Client(transport=httpx.MockTransport(
        lambda r: httpx.Response(200, json=WX))))
    w, ev = svc.get(*ORIG)
    assert ev["badge"] == "PUBLIC DATA" and "test-weather" not in str((w, ev))


def test_demo_weather_is_deterministic():
    from real.weather import demo_weather
    at = datetime(2026, 6, 1, 14, 0, tzinfo=timezone.utc)
    assert demo_weather(*ORIG, at) == demo_weather(*ORIG, at)


def test_freshness_never_invents():
    assert freshness(None) == "UNKNOWN"
    assert freshness("2020-01-01T00:00:00Z") == "HISTORICAL"


AMZ = {"Routes": [
    {"Summary": {"Overview": {"Distance": 5200, "Duration": 1500}}, "Legs": [{"Geometry": {"LineString": [
        [77.2167, 28.6315], [77.2200, 28.6250], [77.2295, 28.6129]]}}]},
    {"Summary": {"Overview": {"Distance": 5900, "Duration": 1650}}, "Legs": [{"Geometry": {"LineString": [
        [77.2167, 28.6315], [77.2180, 28.6200], [77.2295, 28.6129]]}}]}]}


def test_route_normalization():
    rs = normalize_routes(AMZ, "Scooter")
    assert len(rs) == 2 and rs[0]["coords"][0] == (28.6315, 77.2167)  # lat, lon order
    assert rs[0]["distanceM"] == 5200 and rs[1]["alternative"] is True
    assert rs[0]["source"] == "Amazon Location"


def test_routes_fallback_labelled_demo_when_amazon_fails():
    svc = LocationService(settings(), httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(403))))
    routes, ev = svc.routes(ORIG, D)
    assert ev["sourceType"] == "DEMO_DATA" and all(r["sourceType"] == "DEMO_DATA" for r in routes)
    again, _ = svc.routes(ORIG, D)
    assert [r["coords"] for r in routes] == [r["coords"] for r in again]


def test_no_demo_route_when_fallback_disabled():
    svc = LocationService(settings(demo_fallback=False), httpx.Client(
        transport=httpx.MockTransport(lambda r: httpx.Response(500))))
    routes, _ = svc.routes(ORIG, D)
    assert routes == []


def square(lat, lon, half_m=20.0):
    dl = half_m / 111320
    dn = half_m / (111320 * math.cos(math.radians(lat)))
    return [(lat - dl, lon - dn), (lat - dl, lon + dn), (lat + dl, lon + dn), (lat + dl, lon - dn),
            (lat - dl, lon - dn)]


def test_shade_building_casts_shadow_on_road_and_height_gate():
    road = [(28.6000, 77.2000), (28.6000, 77.2020)]  # runs east-west
    # sun due south (azimuth 180), elevation 30: a tall building south of the road shades it
    bx = (28.6000 - 15 / 111320, 77.2010)
    tall = {"id": "t", "ring": square(*bx, 10), "heightM": 40.0, "levels": None}
    short = {"id": "s", "ring": square(*bx, 10), "heightM": 2.0, "levels": None}
    sun = {"elevation": 30.0, "azimuth": 180.0}
    assert estimate_shade(road, [tall], sun)["fraction"] > 0.0
    assert estimate_shade(road, [short], sun)["fraction"] == 0.0
    assert estimate_shade(road, [tall], {"elevation": -5, "azimuth": 180})["fraction"] == 0.0


def test_shade_confidence_levels_and_no_invented_height():
    road = [(28.6000, 77.2000), (28.6000, 77.2020)]
    ring = square(28.6000 - 15 / 111320, 77.2010, 10)
    sun = {"elevation": 30.0, "azimuth": 180.0}
    unknown = {"id": "u", "ring": ring, "heightM": None, "levels": None}
    res = estimate_shade(road, [unknown], sun)
    assert res["fraction"] == 0.0 and res["buildingCount"] == 0  # not guessed
    assert estimate_shade(road, [dict(unknown, heightM=30.0)], sun)["confidence"] == "HIGH"
    assert estimate_shade(road, [dict(unknown, levels=10)], sun)["confidence"] == "MEDIUM"
    assert estimate_shade(road, [unknown], sun, assumed_height_m=30.0)["confidence"] == "LOW"


def route_stub(coords, secs=1200, dist=4000):
    return {"coords": coords, "durationS": secs, "distanceM": dist}


def seg_shade(coords, f):
    from real.geo import split_polyline
    return {"segments": [{"shade": f, "lengthM": s[2], "start": s[0], "end": s[1]}
                         for s in split_polyline(coords, 60)]}


HOT = {"feelsLikeC": 44.0, "cloudPct": 0}
SUN = {"elevation": 70.0, "azimuth": 180.0}


def test_thermal_score_more_shade_lower_load_and_explained():
    coords = [(28.6000, 77.2000), (28.6000, 77.2100)]
    sunny = score_route(route_stub(coords), seg_shade(coords, 0.0), HOT, SUN)
    shady = score_route(route_stub(coords), seg_shade(coords, 0.8), HOT, SUN)
    assert shady["thermalLoad"] < sunny["thermalLoad"]
    assert shady["components"]["shadeReduction"] < 0
    # deterministic
    assert sunny == score_route(route_stub(coords), seg_shade(coords, 0.0), HOT, SUN)


def test_thermal_cooler_weather_and_night_lower_load():
    coords = [(28.6000, 77.2000), (28.6000, 77.2100)]
    hot = score_route(route_stub(coords), seg_shade(coords, 0.0), HOT, SUN)
    mild = score_route(route_stub(coords), seg_shade(coords, 0.0), {"feelsLikeC": 28.0, "cloudPct": 0}, SUN)
    night = score_route(route_stub(coords), seg_shade(coords, 0.0), HOT, {"elevation": -10, "azimuth": 0})
    assert mild["thermalLoad"] < hot["thermalLoad"] and night["thermalLoad"] < hot["thermalLoad"]


def test_delay_adds_explained_load():
    coords = [(28.6000, 77.2000), (28.6000, 77.2100)]
    base = score_route(route_stub(coords), seg_shade(coords, 0.2), HOT, SUN)
    late = score_route(route_stub(coords), seg_shade(coords, 0.2), HOT, SUN, delay_min=10)
    assert late["thermalLoad"] > base["thermalLoad"] and late["components"]["delay"] > 0


def test_exposure_accumulates_and_relief_credits():
    seg = {"rate": 2.0, "class": "MODERATE", "shade": 0.1}
    s = accumulate({}, seg, 5)
    assert math.isclose(s["cumulative"], 10.0)
    s2 = accumulate(s, seg, 0.0, relief_type="COOLING", rest_min=3)
    assert s2["cumulative"] < s["cumulative"] and "reduced load" in s2["history"][-1]["why"][-1]
    s3 = accumulate({"cumulative": 0.5}, seg, 0.0, relief_type="COOLING", rest_min=30)
    assert s3["cumulative"] >= 0.0  # never negative


def test_route_comparison_fastest_rahat_balanced():
    scored = [{"minutes": 30, "thermalLoad": 90}, {"minutes": 33, "thermalLoad": 60},
              {"minutes": 50, "thermalLoad": 20}]
    p = pick_modes(scored, 40)
    assert p["fastest"] == 0 and p["rahat"] == 1  # 50 min exceeds the 40% allowance
    assert pick_modes(scored, 100)["rahat"] == 2
    one = pick_modes(scored[:1], 40)
    assert one == {"fastest": 0, "balanced": 0, "rahat": 0}


def test_relief_ranking_prefers_near_available_and_demotes_unavailable():
    items = demo_relief(*ORIG)
    water = next(i for i in items if i["type"] == "WATER")
    gone = dict(water, id="gone", availability="REPORTED_UNAVAILABLE")
    ranked = rank_relief(items + [gone], *ORIG)
    ids = [r["id"] for r in ranked]
    assert ids.index(water["id"]) < ids.index("gone")
    assert ranked[0]["distanceMeters"] >= 0 and "distance" in ranked[0]["rankReasons"]
    assert all(r["lastVerified"] is None for r in ranked)  # never fabricated
    assert [r["type"] for r in rank_relief(items, *ORIG, wanted={"WATER"})] == ["WATER"]


def test_overpass_parsing_never_fabricates():
    b = parse_buildings({"elements": [
        {"type": "way", "id": 1, "tags": {"building": "yes", "height": "24 m"},
         "geometry": [{"lat": 1, "lon": 1}, {"lat": 1, "lon": 2}, {"lat": 2, "lon": 2}, {"lat": 1, "lon": 1}]},
        {"type": "way", "id": 2, "tags": {"building": "yes", "building:levels": "5"},
         "geometry": [{"lat": 1, "lon": 1}, {"lat": 1, "lon": 2}, {"lat": 2, "lon": 2}, {"lat": 1, "lon": 1}]},
        {"type": "way", "id": 3, "tags": {"building": "yes"},
         "geometry": [{"lat": 1, "lon": 1}, {"lat": 1, "lon": 2}, {"lat": 2, "lon": 2}, {"lat": 1, "lon": 1}]}]})
    assert [x["heightM"] for x in b] == [24.0, None, None] and b[1]["levels"] == 5.0 and b[2]["levels"] is None
    r = parse_relief({"elements": [
        {"type": "node", "id": 9, "lat": 28.6, "lon": 77.2, "tags": {"amenity": "drinking_water"}},
        {"type": "node", "id": 10, "lat": 28.6, "lon": 77.2, "tags": {"shop": "kiosk"}}]})
    assert len(r) == 1 and r[0]["type"] == "WATER" and r[0]["availability"] == "UNKNOWN"
    assert r[0]["lastVerified"] is None and "OpenStreetMap" in r[0]["attribution"]


def test_satellite_scene_selection_and_metadata_only():
    now = datetime(2026, 10, 8, tzinfo=timezone.utc)
    scene = pick_scene([
        {"id": "a", "properties": {"datetime": "2026-09-01T05:00:00Z", "eo:cloud_cover": 40}},
        {"id": "b", "properties": {"datetime": "2026-09-20T05:00:00Z", "eo:cloud_cover": 5}}], now)
    assert scene["sceneId"] == "b" and scene["ageDays"] == 17 and pick_scene([], now) is None


def test_community_reports_never_self_promote_to_system_verified():
    r = comm.new_report("WATER HERE", 28.6, 77.2)
    assert r["status"] == "UNVERIFIED" and r["availability"] == "USER_REPORTED"
    r = comm.confirm(r, "a")
    r = comm.confirm(r, "a")  # same confirmer twice does not count
    assert r["status"] == "UNVERIFIED"
    r = comm.confirm(r, "b")
    assert r["status"] == "COMMUNITY_VERIFIED" and r["status"] != "SYSTEM_VERIFIED"


def test_negative_report_marks_nearby_item_unavailable():
    item = {"id": "w", "type": "WATER", "latitude": 28.6, "longitude": 77.2}
    rep = dict(comm.new_report("NO WATER", 28.6, 77.2), id="r1")
    out = comm.apply_negatives([item], [rep])
    assert out[0]["availability"] == "REPORTED_UNAVAILABLE"


def _engine(tmp_path, amazon_ok=True, wx_ok=True):
    def handler(request):
        host = request.url.host
        if host == "wx.test":
            return httpx.Response(200, json=WX) if wx_ok else httpx.Response(500)
        if "geo.ap-south-1" in host:
            return httpx.Response(200, json=AMZ) if amazon_ok else httpx.Response(403)
        return httpx.Response(500)
    c = httpx.Client(transport=httpx.MockTransport(handler))
    s = settings()
    from real.overpass import OverpassService
    from real.satellite import SatelliteService
    from real.solar import OpenMeteoSolar
    from real.cache import Throttle
    return RealEngine(s, WeatherService(s, c), LocationService(s, c),
                      OverpassService(s, c, Throttle(0, sleep=lambda _x: None)),
                      SatelliteService(s, c), OpenMeteoSolar(s, c))


def test_analyze_real_labels_and_never_breaks_on_failed_optional_providers(tmp_path):
    out = _engine(tmp_path).analyze(ORIG, D, sun={"altitudeDeg": 60, "azimuthDeg": 190})
    assert out["ok"] and out["dataMode"] == "REAL DATA"
    ev = out["evidence"]
    assert ev["route"]["source"] == "Amazon Location" and ev["weather"]["source"] == "WeatherAPI"
    assert ev["solar"]["source"] == "SunCalc" and ev["shade"]["sourceType"] == "MODEL_ESTIMATE"
    assert ev["buildings"]["confidence"] == "LOW" and ev["vegetation"]["freshness"] == "UNKNOWN"
    assert {r["id"] for r in out["routes"]} == {"fastest", "balanced", "rahat"}
    assert out["relief"] and all(i["sourceType"] == "DEMO_DATA" for i in out["relief"])  # labelled


def test_analyze_falls_back_to_demo_and_labels_it(tmp_path):
    out = _engine(tmp_path, amazon_ok=False, wx_ok=False).analyze(ORIG, D)
    assert out["ok"] and out["dataMode"] == "DEMO DATA"
    assert out["evidence"]["route"]["badge"] == "DEMO DATA" and out["evidence"]["weather"]["badge"] == "DEMO DATA"


def test_scenario_before_after_and_reassess(tmp_path):
    eng = _engine(tmp_path)
    res = eng.scenario_compare(ORIG, D, {"tempOffsetC": 3, "delayMin": 10}, sun={"altitudeDeg": 60, "azimuthDeg": 190})
    assert res["ok"] and all(r["after"]["thermalLoad"] > r["before"]["thermalLoad"] for r in res["rows"])
    out = eng.analyze(ORIG, D)
    rt = out["routes"][0]
    pos = {"lat": rt["coords"][1][0], "lon": rt["coords"][1][1]}
    a = eng.reassess(rt["coords"], rt["segments"], pos, {}, need_rahat=True, relief=out["relief"])
    assert "User pressed I NEED RAHAT" in a["triggers"] and a["shouldReassess"] and a["state"]["cumulative"] > 0
    far = eng.reassess(rt["coords"], rt["segments"], {"lat": 28.7, "lon": 77.3}, {})
    assert any(t.startswith("Off route") for t in far["triggers"])
    quiet = eng.reassess(rt["coords"], rt["segments"], pos, {"cumulative": 0.0}, elapsed_min=0.01)
    assert quiet["triggers"] == []  # no constant rerouting


def test_explain_deterministic_never_medical(tmp_path):
    eng = _engine(tmp_path)
    text = eng.explain(eng.analyze(ORIG, D))["text"].lower()
    assert "not medical advice" in text
    assert not any(w in text for w in ("heatstroke", "dehydration", "guaranteed", "medically safe"))


def test_http_api_end_to_end(tmp_path, monkeypatch):
    monkeypatch.setenv("PROVIDER_MODE", "demo")
    app = create_app(SQLiteStore(str(tmp_path / "r.db")), real_engine=_engine(tmp_path))
    c = TestClient(app)
    body = {"origin": {"lat": ORIG[0], "lon": ORIG[1]}, "destination": {"lat": D[0], "lon": D[1]}}
    r = c.post("/api/real/analyze", json=body)
    assert r.status_code == 200 and r.json()["ok"]
    assert c.post("/api/real/analyze", json={**body, "extra": 1}).status_code == 422
    assert c.get("/api/real/search?q=India").status_code == 200
    rep = c.post("/api/real/reports", json={"kind": "WATER HERE", "lat": ORIG[0], "lon": ORIG[1]})
    assert rep.status_code == 201 and rep.json()["status"] == "UNVERIFIED"
    rid = rep.json()["id"]
    assert c.post(f"/api/real/reports/{rid}/confirm", json={"confirmerId": "x"}).json()["status"] == "UNVERIFIED"
    assert c.post("/api/real/scenario", json={"base": body, "scenario": {"tempOffsetC": 3}}).json()["ok"]
    assert c.post("/api/real/explain", json=body).json()["source"] == "DETERMINISTIC EXPLANATION"
    assert c.post("/api/real/evidence-snapshot", json=body).json()["dataMode"] == "REAL DATA"


def test_demo_fallback_shows_a_real_tradeoff_and_labels_it(tmp_path):
    out = _engine(tmp_path, amazon_ok=False, wx_ok=False).analyze(ORIG, D, sun={"altitudeDeg": 62, "azimuthDeg": 185})
    r = {x["id"]: x for x in out["routes"]}
    assert out["evidence"]["buildings"]["badge"] == "DEMO DATA"
    assert r["rahat"]["thermalLoad"] < r["fastest"]["thermalLoad"]
    assert r["rahat"]["estimatedShade"] > r["fastest"]["estimatedShade"]
    assert r["rahat"]["headline"] == "LOWER ESTIMATED THERMAL LOAD"
    assert r["rahat"]["minutes"] >= r["fastest"]["minutes"]
    again = _engine(tmp_path, amazon_ok=False, wx_ok=False).analyze(
        ORIG, D, sun={"altitudeDeg": 62, "azimuthDeg": 185})
    assert out["routes"] == again["routes"]  # same inputs -> identical numbers (only timestamps differ)


def test_real_route_without_osm_buildings_gets_no_invented_shade(tmp_path):
    out = _engine(tmp_path).analyze(ORIG, D, sun={"altitudeDeg": 62, "azimuthDeg": 185})
    assert out["dataMode"] == "REAL DATA" and all(x["estimatedShade"] == 0.0 for x in out["routes"])
    assert out["evidence"]["buildings"]["sourceType"] != "DEMO_DATA"


def test_api_keys_never_reach_logs(tmp_path, caplog):
    import logging
    caplog.set_level(logging.DEBUG)
    eng = _engine(tmp_path)
    eng.analyze(ORIG, D, sun={"altitudeDeg": 62, "azimuthDeg": 185})
    eng.location.search("India Gate")
    _engine(tmp_path, amazon_ok=False, wx_ok=False).analyze(ORIG, D)
    text = caplog.text
    assert "test-loc" not in text and "test-weather" not in text
