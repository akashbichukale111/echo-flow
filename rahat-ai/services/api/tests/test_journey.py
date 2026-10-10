import pytest
from fastapi.testclient import TestClient

from delhi import CP_NODE, IG_NODE, delhi_providers
from engine import Engine, RouteUnavailable
from journey import (
    HEATWAVE_C, JourneyEngine, JourneyRequest, classify, places_search, provider_status,
)
from main import create_app
from store import SQLiteStore

@pytest.fixture
def je():
    return JourneyEngine(Engine(delhi_providers()))

@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(SQLiteStore(str(tmp_path / "j.db"))))

def route(plan, ident):
    return next(r for r in plan["routes"] if r["id"] == ident)

def test_three_required_routes_with_distinct_results(je):
    plan = je.plan(JourneyRequest(needs=["WATER", "SHADE"]))
    ids = [r["id"] for r in plan["routes"]]
    assert {"fastest", "rahat", "relief-priority"} <= set(ids)
    fast, rahat = route(plan, "fastest"), route(plan, "rahat")
    assert rahat["load"] < fast["load"] and rahat["shade"] > fast["shade"]
    assert rahat["minutes"] >= fast["minutes"] - 1e-9
    assert route(plan, "relief-priority")["relief_count"] >= fast["relief_count"]

def test_exposure_breakdown_reconciles(je):
    for r in je.plan(JourneyRequest())["routes"]:
        assert abs(sum(r["breakdown"].values()) - r["load"]) < 1e-6

def test_thermal_classes_documented_thresholds():
    assert [classify(x) for x in (1.0, 1.8, 2.4, 3.0)] == ["LOW", "MODERATE", "ELEVATED", "HIGH"]

def test_segment_explanation_uses_actual_values(je):
    seg = route(je.plan(JourneyRequest()), "fastest")["segments"][0]
    assert f"{seg['minutes']:.1f}" in seg["explanation"]
    assert f"{seg['solar_exposure']:.2f}" in seg["explanation"]
    assert "MODEL ESTIMATE" in seg["explanation"]
    assert seg["heat_class"] in ("LOW", "MODERATE", "ELEVATED", "HIGH")

def test_needs_change_relief_priority_scoring(je):
    a = route(je.plan(JourneyRequest(needs=["COOLING"])), "relief-priority")
    b = route(je.plan(JourneyRequest(needs=["FUEL"])), "relief-priority")
    assert a["needs_coverage"]["COOLING"] >= 1
    assert a["nodes"] != b["nodes"] or a["needs_coverage"] != b["needs_coverage"]

def test_multi_stop_visits_waypoint(je):
    plan = je.plan(JourneyRequest(waypoints=[{"node": 21}]))
    for r in plan["routes"]:
        assert 21 in r["nodes"]
        assert r["nodes"][0] == CP_NODE and r["nodes"][-1] == IG_NODE

def test_solar_changes_with_time(je):
    noon = je.plan(JourneyRequest())["sun"]["elevation"]
    eve = je.plan(JourneyRequest(departure="2026-05-15T18:45:00+05:30"))["sun"]["elevation"]
    assert noon > 50 and eve < 10

def test_heatwave_mode_threshold(je):
    assert not je.plan(JourneyRequest())["heatwave"]["active"]
    hot = je.plan(JourneyRequest(heatwave=True))["heatwave"]
    assert hot["active"] and hot["temperature_c"] >= HEATWAVE_C

def test_i_need_rahat_ranks_with_real_distances(je):
    result = je.need_rahat(JourneyRequest(), 21, 1000)
    assert result["items"] == sorted(result["items"], key=lambda x: x["rank_score"])
    assert all(p["distance"] <= 1000 for p in result["items"])
    assert "not a medical" in result["framing"]
    assert result["by_type"]["SHADE"]["distance_m"] > 0
    assert all("detour_minutes" in p and p["why"] for p in result["items"])

def test_around_me_radius_filter(client):
    small = client.get("/api/journey/around?node=21&radius_m=250").json()["items"]
    big = client.get("/api/journey/around?node=21&radius_m=1000").json()["items"]
    assert len(big) >= len(small) and all(i["distance"] <= 250 for i in small)
    assert client.get("/api/journey/around?node=21&radius_m=999").status_code == 422

def test_what_changed_is_proposal_with_real_diffs(je):
    out = je.what_changed(JourneyRequest(), "relief-closed", None)
    assert out["proposal_only"] and out["diff"]["relief_count"] == -1
    assert je.what_changed(JourneyRequest(), "heatwave", None)["diff"]["load"] > 0

def test_validation_errors_are_human_readable(client):
    r = client.post("/api/journey/plan", json={"origin": 5, "destination": 5})
    assert r.status_code == 422 and "differ" in r.json()["detail"]
    assert client.post("/api/journey/plan", json={"origin": 150}).status_code == 422
    assert client.post("/api/journey/plan", json={"needs": ["TELEPORT"]}).status_code == 422

def test_search_labels_demo_and_coverage():
    items = places_search("india")
    assert items[0]["name"] == "India Gate" and items[0]["node"] == IG_NODE
    assert items[0]["source"] == "DEMO DATA"
    assert places_search("aiims")[0]["inside_demo_coverage"] is False

def test_provider_status_never_claims_live():
    states = {p["state"] for p in provider_status()}
    assert states <= {"DEMO", "UNAVAILABLE"}
    assert "UNAVAILABLE" in states

def test_relief_points_are_labelled_demo(je):
    assert all(p["source"] == "DEMO DATA" and p["verification"].startswith("UNVERIFIED")
               for p in je.pois)

def test_unreachable_stop_rejected(je):
    with pytest.raises(RouteUnavailable):
        je.plan(JourneyRequest(waypoints=[{"node": 150}]))
