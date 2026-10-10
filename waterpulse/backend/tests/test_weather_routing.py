"""WeatherAPI forecast and Amazon Location routing adapters (HTTP mocked)."""
import dataclasses
import time

import httpx
import pytest

from app import integrations, routing
from app.config import settings
from app.models import Zone
from app.seed import seed_state


def patch(monkeypatch, **values):
    replacement = dataclasses.replace(settings, **values)
    monkeypatch.setattr(integrations, "settings", replacement)
    monkeypatch.setattr(routing, "settings", replacement)


@pytest.fixture
def zone():
    return Zone.model_validate(seed_state("pilot")["zones"][0])


class FakeResponse:
    def __init__(self, payload, status=200):
        self.payload, self.status = payload, status

    def raise_for_status(self):
        if self.status >= 400:
            raise httpx.HTTPStatusError("bad", request=None, response=None)

    def json(self):
        return self.payload


def weather_payload(precip=0.0, age=60):
    epoch = int(time.time()) - age
    day = lambda d, mm: {"date": d, "day": {
        "maxtemp_c": 34, "mintemp_c": 24, "totalprecip_mm": mm,
        "daily_chance_of_rain": 10, "condition": {"text": "Sunny"}}}
    return {"current": {"last_updated_epoch": epoch, "temp_c": 31.5, "precip_mm": 0,
                        "humidity": 48, "wind_kph": 11.2, "condition": {"text": "Sunny"}},
            "forecast": {"forecastday": [day("2026-10-08", precip), day("2026-10-09", 0),
                                          day("2026-10-10", 0)]}}


def fake_client(payload, status=200, calls=None):
    class Client:
        def __init__(self, *a, **k): ...
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def get(self, url, params=None):
            if calls is not None:
                calls.append((url, params))
            return FakeResponse(payload, status)
        def post(self, url, params=None, json=None):
            if calls is not None:
                calls.append((url, params, json))
            return FakeResponse(payload, status)
    return Client


def test_weather_detail_has_all_fields_and_labels(zone, monkeypatch):
    integrations._weather_cache.clear()
    patch(monkeypatch, weather_provider="weatherapi", weather_key="k")
    monkeypatch.setattr(integrations.httpx, "Client", fake_client(weather_payload(0.4)))
    env = integrations.environmental_context(zone, "pilot")
    detail = env["weather_detail"]
    assert detail["status"] == "OK" and detail["provider"] == "WeatherAPI"
    for key in ("temperature_c", "precip_mm", "humidity_pct", "wind_kph", "forecast",
                "observed_at", "freshness", "data_label"):
        assert key in detail
    assert detail["data_label"] == "REAL PUBLIC DATA"
    assert env["weather"]["source_type"] == "PUBLIC DATA"
    assert env["rainfall"]["value"] == "LOW"
    assert env["rainfall"]["data_label"] == "DERIVED MODEL INPUT"
    assert "not water inflow" in env["rainfall"]["influence"]


def test_rainfall_class_thresholds():
    assert integrations.rainfall_class(1.9) == "LOW"
    assert integrations.rainfall_class(5) == "MODERATE"
    assert integrations.rainfall_class(40) == "HIGH"


def test_weather_is_cached_between_calls(zone, monkeypatch):
    integrations._weather_cache.clear()
    patch(monkeypatch, weather_provider="weatherapi", weather_key="k")
    calls = []
    monkeypatch.setattr(integrations.httpx, "Client",
                        fake_client(weather_payload(), calls=calls))
    integrations.environmental_context(zone, "pilot")
    integrations.environmental_context(zone, "pilot")
    assert len(calls) == 1


def test_stale_weather_is_unavailable_never_demo(zone, monkeypatch):
    integrations._weather_cache.clear()
    patch(monkeypatch, weather_provider="weatherapi", weather_key="k")
    monkeypatch.setattr(integrations.httpx, "Client",
                        fake_client(weather_payload(age=9 * 3600)))
    env = integrations.environmental_context(zone, "pilot")
    assert env["weather"]["value"] == "DATA UNAVAILABLE"
    assert env["weather_detail"]["status"] == "DATA_UNAVAILABLE"
    assert env["weather"]["source_type"] != "DEMO DATA"


def test_pilot_without_weather_provider_is_unavailable(zone, monkeypatch):
    patch(monkeypatch, weather_provider="demo", weather_key="")
    env = integrations.environmental_context(zone, "pilot")
    assert env["weather"]["value"] == "DATA UNAVAILABLE"
    assert any("never substitutes demo" in s for s in env["status"])


def test_demo_workspace_weather_stays_labelled_demo(monkeypatch):
    patch(monkeypatch, weather_provider="demo")
    demo_zone = Zone.model_validate(seed_state("demo")["zones"][0])
    env = integrations.environmental_context(demo_zone, "demo")
    assert env["weather"]["source_type"] == "DEMO DATA"


# ----------------------------------------------------------------- routing
def route_payload():
    return {"Routes": [{"Legs": [{"Geometry": {"LineString": [[75.0, 18.1], [74.6, 18.15]]},
        "VehicleLegDetails": {"Summary": {"Overview": {"Distance": 61200, "Duration": 5400}}}}]}]}


def test_route_without_key_is_straight_line_and_labelled(zone, monkeypatch):
    patch(monkeypatch, location_key="")
    result = routing.estimate(zone)
    assert result["status"] == "STRAIGHT_LINE_ONLY"
    assert "NOT A ROAD ROUTE" in result["label"]
    assert result["duration_min"] is None
    assert "live traffic" in result["traffic"].lower()


def test_route_with_key_is_routed_estimate_and_key_not_exposed(zone, monkeypatch):
    routing._cache.clear()
    patch(monkeypatch, location_key="SECRET-KEY-123", location_region="ap-south-1")
    calls = []
    monkeypatch.setattr(routing.httpx, "Client", fake_client(route_payload(), calls=calls))
    result = routing.estimate(zone)
    assert result["label"] == "ROUTED ESTIMATE" and result["status"] == "OK"
    assert result["distance_km"] == 61.2 and result["duration_min"] == 90
    assert result["geometry"][0] == [75.0, 18.1]
    assert "SECRET-KEY-123" not in str(result)
    url, params, body = calls[0]
    assert url == "https://routes.geo.ap-south-1.amazonaws.com/v2/routes"
    assert params == {"key": "SECRET-KEY-123"}
    assert body["Origin"] == [zone.tanker_source_lon, zone.tanker_source_lat]
    assert "DepartNow" not in body  # live traffic is never requested


def test_route_failure_falls_back_without_claiming_road(zone, monkeypatch):
    routing._cache.clear()
    patch(monkeypatch, location_key="k")
    monkeypatch.setattr(routing.httpx, "Client", fake_client({}, status=403))
    result = routing.estimate(zone)
    assert result["status"] == "STRAIGHT_LINE_ONLY"
    assert "failed" in result["message"]


def test_route_requires_tanker_source():
    z = Zone.model_validate(seed_state("demo")["zones"][0])
    assert routing.estimate(z)["status"] == "UNAVAILABLE"


def test_route_endpoint(tmp_path):
    from fastapi.testclient import TestClient

    from app.main import create_app
    from app.repositories import SQLiteRepository
    with TestClient(create_app(SQLiteRepository(str(tmp_path / "r.db")))) as client:
        body = client.get("/api/zones/pilot-indapur/route",
                          headers={"X-WaterPulse-Workspace": "pilot"}).json()
        assert body["origin"]["name"] and body["destination"]["name"]
