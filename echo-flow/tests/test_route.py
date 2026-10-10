import json

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.providers import amazon_location, base
from backend.repository import SQLiteRepository

SECRET = "v1.public.SECRET-KEY-VALUE"
GOOD = {
    "Legs": [{"StartPosition": [72.8001, 19.0001], "EndPosition": [72.9001, 19.1001],
              "Geometry": {"LineString": [[72.8001, 19.0001], [72.85, 19.05], [72.9001, 19.1001]]}}],
    "Summary": {"Distance": 18.4, "DistanceUnit": "Kilometers", "DurationSeconds": 1500, "DataSource": "Esri"},
}


def client(tmp_path):
    return TestClient(create_app(SQLiteRepository(str(tmp_path / "r.sqlite3"))))


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("AMAZON_LOCATION_API_KEY", SECRET)
    monkeypatch.setenv("AMAZON_LOCATION_ROUTE_CALCULATOR", "echo-flow-routes")
    monkeypatch.setenv("AMAZON_LOCATION_REGION", "us-east-1")
    monkeypatch.delenv("AMAZON_LOCATION_REFERER", raising=False)


BODY = {"origin": [72.8, 19.0], "destination": [72.9, 19.1]}


def test_not_connected_without_configuration(tmp_path, monkeypatch):
    for v in ("AMAZON_LOCATION_API_KEY", "AMAZON_LOCATION_ROUTE_CALCULATOR", "AMAZON_LOCATION_REGION"):
        monkeypatch.delenv(v, raising=False)
    r = client(tmp_path).post("/api/route", json=BODY).json()
    assert r["status"] == "NOT_CONNECTED" and r["data"] is None
    assert "AMAZON_LOCATION_API_KEY" in r["detail"]


def test_successful_route_uses_documented_request_and_hides_key(tmp_path, configured, monkeypatch):
    seen = {}

    def t(method, url, headers, body, timeout):
        seen.update(method=method, url=url, body=json.loads(body))
        return 200, {}, json.dumps(GOOD).encode()
    monkeypatch.setattr(base, "transport", t)
    r = client(tmp_path).post("/api/route", json=BODY).json()
    assert seen["method"] == "POST"
    assert seen["url"].startswith("https://routes.geo.us-east-1.amazonaws.com/routes/v0/calculators/"
                                  "echo-flow-routes/calculate/route?key=")
    assert seen["body"]["DeparturePosition"] == [72.8, 19.0] and seen["body"]["IncludeLegGeometry"] is True
    assert r["status"] == "LIVE" and r["provenance"] == "DERIVED"
    assert r["data"]["distance_km"] == 18.4 and r["data"]["duration_min"] == 25.0
    assert len(r["data"]["geometry"]) == 3
    assert "does not know" in r["limitations"].lower()
    assert SECRET not in json.dumps(r)


@pytest.mark.parametrize("status", [401, 403, 500])
def test_http_failure_is_never_reported_as_success(tmp_path, configured, monkeypatch, status):
    def t(*a, **k):
        raise base.HttpFailure("UNAVAILABLE", f"HTTP {status}", status)
    monkeypatch.setattr(base, "transport", t)
    r = client(tmp_path).post("/api/route", json=BODY).json()
    assert r["status"] == "UNAVAILABLE" and r["data"] is None
    assert SECRET not in json.dumps(r)
    if status in (401, 403):
        assert "geo:CalculateRoute" in r["detail"]


def test_malformed_or_empty_response_shows_no_route(tmp_path, configured, monkeypatch):
    monkeypatch.setattr(base, "transport", lambda *a, **k: (200, {}, json.dumps({"Legs": [], "Summary": {}}).encode()))
    r = client(tmp_path).post("/api/route", json=BODY).json()
    assert r["status"] == "UNAVAILABLE" and r["data"] is None


def test_invalid_configuration_sends_nothing(tmp_path, configured, monkeypatch):
    monkeypatch.setenv("AMAZON_LOCATION_ROUTE_CALCULATOR", "bad/../name")
    r = amazon_location.route((72.8, 19.0), (72.9, 19.1))
    assert r.status == "ERROR"


def test_route_request_validation(tmp_path):
    c = client(tmp_path)
    assert c.post("/api/route", json={"origin": [200, 0], "destination": [1, 1]}).status_code == 422
    assert c.post("/api/route", json={"origin": [1, 1], "destination": [1, 1]}).status_code == 422
    assert c.post("/api/route", json={**BODY, "travel_mode": "Boat"}).status_code == 422
    assert c.post("/api/route", json={**BODY, "extra": 1}).status_code == 422


def test_referer_header_is_forwarded_when_configured(tmp_path, configured, monkeypatch):
    monkeypatch.setenv("AMAZON_LOCATION_REFERER", "http://127.0.0.1:5174/")
    seen = {}

    def t(method, url, headers, body, timeout):
        seen.update(headers)
        return 200, {}, json.dumps(GOOD).encode()
    monkeypatch.setattr(base, "transport", t)
    assert amazon_location.route((72.8, 19.0), (72.9, 19.1)).status == "LIVE"
    assert seen["Referer"] == "http://127.0.0.1:5174/"
