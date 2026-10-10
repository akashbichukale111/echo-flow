import math

import pytest
from fastapi.testclient import TestClient

from agents import orchestrate
from aws_adapters import AmazonLocationRoutes, BedrockExplainer
from engine import Engine, RouteUnavailable, constrained_path
from main import create_app
from models import PlanRequest
from providers import (
    LAT, LON, DemoWeatherProvider, demo_providers, solar_position,
)
from store import SQLiteStore

@pytest.fixture
def engine():
    return Engine(demo_providers())

@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(SQLiteStore(str(tmp_path / "test.db"))))

def test_solar_day_night():
    from datetime import datetime
    day = solar_position(datetime.fromisoformat("2026-05-15T12:00:00+05:30"), LAT, LON)
    night = solar_position(datetime.fromisoformat("2026-05-15T00:00:00+05:30"), LAT, LON)
    assert day["elevation"] > 60
    assert night["elevation"] < 0
    assert night["direct_weight"] == 0
    assert 0 <= day["azimuth"] < 360

def test_shade_and_breakdown(engine):
    q = PlanRequest()
    scan = engine.scan(q)
    assert all(0 <= e["shade"] <= 1 for e in scan["edges"])
    assert any(e["shade"] > 0 for e in scan["edges"])
    for e in scan["edges"]:
        assert math.isclose(sum(e["breakdown"].values()), e["load"])
        assert e["load"] >= 0

def test_no_shade(engine):
    scan = engine.scan(PlanRequest(shade_removed=True))
    assert all(e["shade"] == 0 for e in scan["edges"])

def test_routing_and_detour(engine):
    q = PlanRequest(max_detour_pct=0)
    context = orchestrate(q, engine)
    fastest = context["routes"][0]
    assert len(context["routes"]) == 3
    for route in context["routes"]:
        assert route["nodes"][0] == q.origin
        assert route["nodes"][-1] == q.destination
        assert route["travel_minutes"] <= fastest["travel_minutes"] + 1e-8

def test_empty_graph():
    with pytest.raises(RouteUnavailable):
        constrained_path([], 0, 1, "fastest", PlanRequest())

def test_relief_filter_and_closed(engine):
    q = PlanRequest(need_water=True, closed_relief=["r1", "r2", "r4", "r6"])
    assert engine.relief(q, 12) == []

def test_relief_no_nearby(engine):
    assert engine.relief(PlanRequest(), 14, radius=0) == []

def test_relief_rank(engine):
    points = engine.relief(PlanRequest(), 12)
    assert points
    assert [p["rank_score"] for p in points] == sorted(p["rank_score"] for p in points)
    assert all(p["detour_minutes"] >= 0 for p in points)

def test_scenario_recalculates(engine):
    result = engine.scenario(
        PlanRequest(), "shade-removed", lambda q: orchestrate(q, engine)
    )
    assert result["after"]["request"]["shade_removed"] is True
    assert all(r["shade"] == 0 for r in result["after"]["routes"])

def test_agent_order(engine):
    context = orchestrate(PlanRequest(), engine)
    assert [t["agent"] for t in context["trace"]] == [
        "scanner", "route", "relief", "validator", "advisor", "reassessment"
    ]
    assert context["validated"] is True

def test_api_and_validation(client):
    assert client.get("/api/health").json()["mode"] == "DEMO MODE"
    assert client.post("/api/plan", json={}).status_code == 200
    assert client.post("/api/plan", json={"origin": -1}).status_code == 422
    assert client.post("/api/plan", json={"origin": 2, "destination": 2}).status_code == 422
    assert client.post("/api/plan", json={"departure": "2026-05-15T14:00:00"}).status_code == 422
    assert client.post("/api/plan", json={"unknown": 1}).status_code == 422

def test_trip_accumulation_and_revision(client):
    trip = client.post("/api/trips", json={"plan": {}, "mode": "balanced"}).json()
    updated = client.post(
        f"/api/trips/{trip['id']}/action",
        json={"revision": 0, "action": "advance"}
    )
    assert updated.status_code == 200
    current = updated.json()
    assert current["cumulative_load"] > 0
    assert current["current_node"] != trip["current_node"]
    duplicate = client.post(
        f"/api/trips/{trip['id']}/action",
        json={"revision": 0, "action": "advance"}
    )
    assert duplicate.status_code == 409
    assert client.get(f"/api/trips/{trip['id']}").json()["revision"] == 1

def test_reroute_and_history_preserved(client):
    trip = client.post("/api/trips", json={"plan": {}, "mode": "fastest"}).json()
    trip = client.post(
        f"/api/trips/{trip['id']}/action",
        json={"revision": trip["revision"], "action": "advance"}
    ).json()
    previous_load = trip["cumulative_load"]
    result = client.post(
        f"/api/trips/{trip['id']}/reroute",
        json={"revision": trip["revision"], "plan": {"delay_min": 5}, "mode": "balanced"}
    )
    assert result.status_code == 200
    assert result.json()["cumulative_load"] == previous_load
    assert result.json()["last_change"] is not None

def test_report_is_unverified(client):
    result = client.post("/api/reports", json={"node": 2, "kind": "NO WATER"})
    assert result.status_code == 201
    assert result.json()["status"] == "UNVERIFIED"
    assert len(client.get("/api/reports").json()["items"]) == 1

def test_missing_bedrock_key(monkeypatch):
    monkeypatch.delenv("BEDROCK_MODEL_ID", raising=False)
    with pytest.raises(ValueError, match="not configured"):
        BedrockExplainer().explain({"validated": True})

def test_location_adapter():
    class Fake:
        def calculate_routes(self, **kwargs):
            assert kwargs["Origin"] == [73.7, 18.5]
            assert kwargs["LegGeometryFormat"] == "Simple"
            return {"Routes": []}
    assert AmazonLocationRoutes(Fake()).calculate(
        [73.7, 18.5], [73.71, 18.51]
    ) == {"Routes": []}
    with pytest.raises(ValueError):
        AmazonLocationRoutes(Fake()).calculate([900, 18], [73, 18])

def test_provider_failure(tmp_path):
    class BrokenWeather(DemoWeatherProvider):
        def get(self, at):
            raise RuntimeError("test provider failure")
    providers = demo_providers()
    providers.weather = BrokenWeather()
    client = TestClient(
        create_app(SQLiteStore(str(tmp_path / "broken.db")), providers),
        raise_server_exceptions=False,
    )
    assert client.post("/api/plan", json={}).status_code == 503

def test_unconfigured_provider_mode_never_claims_real(monkeypatch, tmp_path):
    # Contract changed with the real-data layer: a non-demo mode no longer aborts startup. The
    # legacy engine stays DEMO DATA and the real layer reports REAL only when it is enabled AND
    # credentialed, so an unconfigured mode can never be mistaken for live data.
    monkeypatch.setenv("PROVIDER_MODE", "unconfigured-live")
    app = create_app(SQLiteStore(str(tmp_path / "mode.db")))
    client = TestClient(app)
    assert client.get("/api/health").json()["data"] == "DEMO DATA"
    status = client.get("/api/real/status").json()
    assert status["mode"] == "DEMO"
    assert status["providers"]["amazonLocation"] == "not configured"
