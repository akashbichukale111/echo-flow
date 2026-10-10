import dataclasses

import httpx
import pytest
from fastapi.testclient import TestClient

from app import integrations
from app.config import settings
from app.integrations import (
    BedrockExplainer,
    CGWBProvider,
    IMDRainfallProvider,
    ProviderNotConfigured,
    environmental_context,
)
from app.main import create_app
from app.models import Zone
from app.repositories import SQLiteRepository
from app.seed import seed_state


def patch_settings(monkeypatch, **values):
    """Settings is a frozen dataclass: swap in a modified copy per module."""
    import app.main as main_module

    replacement = dataclasses.replace(settings, **values)
    monkeypatch.setattr(integrations, "settings", replacement)
    monkeypatch.setattr(main_module, "settings", replacement)


@pytest.fixture
def zone():
    return Zone.model_validate(seed_state()["zones"][0])


@pytest.fixture
def client(tmp_path):
    repository = SQLiteRepository(str(tmp_path / "t.sqlite3"))
    with TestClient(create_app(repository)) as connection:
        yield connection


def test_imd_and_cgwb_refuse_without_credentials(zone):
    with pytest.raises(ProviderNotConfigured):
        IMDRainfallProvider().read(zone)
    with pytest.raises(ProviderNotConfigured):
        CGWBProvider().read(zone)


def test_unimplemented_contract_never_fabricates(zone, monkeypatch):
    patch_settings(monkeypatch, imd_key="placeholder")
    with pytest.raises(ProviderNotConfigured):
        IMDRainfallProvider().read(zone)


def test_weather_failure_is_data_unavailable_not_demo(zone, monkeypatch):
    patch_settings(monkeypatch, weather_provider="weatherapi", weather_key="")
    context = environmental_context(zone)
    assert context["weather"]["value"] == "DATA UNAVAILABLE"
    assert context["weather"]["source_type"] != "DEMO DATA"


def test_weather_timeout_is_handled(zone, monkeypatch):
    patch_settings(monkeypatch, weather_provider="weatherapi", weather_key="k")

    class Boom:
        def __init__(self, *a, **k): ...
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def get(self, *a, **k): raise httpx.ConnectTimeout("timeout")

    monkeypatch.setattr(integrations.httpx, "Client", Boom)
    assert environmental_context(zone)["weather"]["value"] == "DATA UNAVAILABLE"


def test_bedrock_disabled_returns_deterministic_text(monkeypatch):
    patch_settings(monkeypatch, model="")
    result = BedrockExplainer().explain([], "summary text")
    assert result["enabled"] is False and result["text"] == "summary text"


def test_bedrock_failure_falls_back(monkeypatch):
    patch_settings(monkeypatch, model="some.model")
    import boto3

    def fail(*a, **k):
        raise RuntimeError("secret-bearing sdk error")

    monkeypatch.setattr(boto3, "client", fail)
    result = BedrockExplainer().explain([], "fallback summary")
    assert result["enabled"] is False
    assert "secret" not in result["text"]


def test_health_reports_no_physical_control(client):
    body = client.get("/api/health").json()
    assert body["physical_control"] is False and body["mode"] == "demo"


def test_tanker_endpoint(client):
    response = client.post(
        "/api/zones/ward-12/tankers", json={"required_water_l": 50_000}
    )
    assert response.status_code == 200
    assert response.json()["required_trips"] == 5


def test_unknown_zone_is_404(client):
    assert client.get("/api/zones/nope/analysis").status_code == 404


def test_security_headers_and_oversize_body(client):
    ok = client.get("/api/health")
    assert ok.headers["x-content-type-options"] == "nosniff"
    assert ok.headers["cache-control"] == "no-store"
    big = client.post("/api/zones", content=b"x" * 70_000,
                      headers={"Content-Type": "application/json"})
    assert big.status_code == 413


def test_pilot_mode_requires_token(tmp_path, monkeypatch):
    patch_settings(monkeypatch, mode="pilot", api_token="t" * 40)
    repository = SQLiteRepository(str(tmp_path / "p.sqlite3"))
    with TestClient(create_app(repository)) as connection:
        assert connection.get("/api/zones").status_code == 401
        good = connection.get(
            "/api/zones", headers={"Authorization": "Bearer " + "t" * 40}
        )
        assert good.status_code == 200


def test_rate_limit(client):
    codes = {client.get("/api/health").status_code for _ in range(190)}
    assert 429 in codes


def test_export_contains_no_secrets(client):
    text = client.get("/api/export").text.lower()
    assert "aws_secret" not in text and "api_key" not in text


def test_reject_before_execution_and_double_decision(client):
    action = client.post("/api/zones/ward-12/actions", json={
        "scenario": "tanker", "parameters": {}
    }).json()
    endpoint = f"/api/actions/{action['id']}/decision"
    assert client.post(endpoint, json={
        "decision": "reject", "note": "Not now"
    }).json()["status"] == "REJECTED"
    assert client.post(endpoint, json={
        "decision": "approve", "note": "Too late to approve"
    }).status_code == 409
