import math
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.engines import (
    LossImpactEngine,
    RiskEngine,
    ScenarioEngine,
    ShortageClockEngine,
    TankerCapacityEngine,
    VerificationEngine,
    WaterBufferEngine,
    project,
)
from app.integrations import (
    DemoGroundwaterProvider,
    DemoRainfallProvider,
    DemoWeatherProvider,
)
from app.main import create_app
from app.models import ScenarioInput, Zone, ZoneInput
from app.repositories import SQLiteRepository
from app.seed import seed_state


@pytest.fixture
def zone():
    return Zone.model_validate(seed_state()["zones"][0])

@pytest.fixture
def client(tmp_path):
    repository = SQLiteRepository(str(tmp_path / "test.sqlite3"))
    with TestClient(create_app(repository)) as connection:
        yield connection

def test_water_balance(zone):
    model = WaterBufferEngine.calculate(zone)
    assert model["buffer_days"] == pytest.approx(12.42)
    assert model["storage_only_days"] == pytest.approx(3.20516129)
    assert model["gross_withdrawal_lpd"] == pytest.approx(620000 / .92)

def test_stable_supply(zone):
    stable = zone.model_copy(update={"supply_lpd": 1_000_000})
    assert WaterBufferEngine.calculate(stable)["buffer_days"] is None

def test_already_at_reserve(zone):
    empty = zone.model_copy(update={"storage_l": zone.reserve_l})
    assert WaterBufferEngine.calculate(empty)["buffer_days"] == 0

def test_shortage_clock():
    assert ShortageClockEngine.calculate(3.8)["days"] == 3
    assert ShortageClockEngine.calculate(3.8)["hours"] == 19
    assert ShortageClockEngine.calculate(None)["days"] is None

def test_risk(zone):
    assert RiskEngine.calculate(zone, .2)["level"] == "CRITICAL"
    assert RiskEngine.calculate(zone, 20)["score"] < \
        RiskEngine.calculate(zone, .2)["score"]

def test_loss_engine(zone):
    outcome = LossImpactEngine.calculate(zone, 4)
    assert outcome["new_loss_pct"] == 4
    assert outcome["avoided_withdrawal_lpd"] > 0

def test_tankers(zone):
    outcome = TankerCapacityEngine.calculate(zone, 100001)
    assert outcome["required_trips"] == 11
    assert outcome["first_delivery_hours"] > 0

def test_no_tankers(zone):
    outcome = TankerCapacityEngine.calculate(
        zone.model_copy(update={"available_tankers": 0}), 100000
    )
    assert not outcome["feasible_in_window"]
    assert outcome["estimated_completion_hours"] is None

def test_scenarios(zone):
    zones = [Zone.model_validate(z) for z in seed_state()["zones"]]
    outcomes = ScenarioEngine.compare(zone, zones, ScenarioInput())
    assert len(outcomes) == 4
    baseline, tanker, loss, redistribution = outcomes
    assert tanker["buffer_days"] > baseline["buffer_days"]
    assert loss["buffer_days"] > baseline["buffer_days"]
    assert not redistribution["feasible"]

def test_late_delivery_does_not_erase_shortage(zone):
    baseline = WaterBufferEngine.calculate(zone)["buffer_days"]
    result = project(zone, [{"day": baseline + 1, "liters": 1_000_000}])
    assert result["buffer_days"] == pytest.approx(baseline)

def test_verification(zone):
    after = zone.model_copy(update={"loss_pct": 4})
    result = VerificationEngine.compare(zone, after, 15)
    assert result["change_days"] > 0

@pytest.mark.parametrize("field,value", [
    ("loss_pct", 100), ("demand_lpd", 0),
    ("storage_l", -1), ("available_tankers", 1.5),
    ("supply_lpd", math.inf)
])
def test_validation(zone, field, value):
    values = zone.model_dump(exclude={"id", "version", "provenance"})
    values[field] = value
    with pytest.raises(ValidationError):
        ZoneInput.model_validate(values)

def test_demo_provider_provenance(zone):
    for provider in (
        DemoRainfallProvider(), DemoWeatherProvider(),
        DemoGroundwaterProvider()
    ):
        assert provider.read(zone).source_type == "DEMO DATA"

def test_analysis_and_evidence(client):
    result = client.get("/api/zones/ward-12/analysis")
    assert result.status_code == 200
    payload = result.json()
    assert payload["model"]["buffer_days"] == pytest.approx(12.42)
    assert len(payload["evidence"]) >= 10
    assert payload["recommendation"]["confidence"] == "LOW"

def test_save_and_persist(client, zone):
    body = zone.model_dump(exclude={"id", "version", "provenance"})
    body["name"] = "Operator Zone"
    response = client.post("/api/zones", json=body)
    assert response.status_code == 201
    created = response.json()
    assert created["provenance"]["source_type"] == "OPERATOR INPUT"
    assert any(z["id"] == created["id"]
               for z in client.get("/api/zones").json())

def test_reject_bad_api_payload(client):
    response = client.post("/api/zones", json={"name": "invalid"})
    assert response.status_code == 422

def test_human_approval_and_verification(client):
    response = client.post("/api/zones/ward-12/actions", json={
        "scenario": "loss", "parameters": {}, "note": "Inspect first"
    })
    assert response.status_code == 201
    action = response.json()
    endpoint = f"/api/actions/{action['id']}"
    assert client.post(endpoint + "/execution", json={
        "note": "Not approved yet"
    }).status_code == 409
    assert client.post(endpoint + "/decision", json={
        "decision": "approve", "note": "Demo operator approves investigation"
    }).json()["status"] == "APPROVED"
    assert client.post(endpoint + "/execution", json={
        "note": "Simulated field intervention recorded"
    }).json()["status"] == "EXECUTED"
    assert client.post(endpoint + "/verification", json={
        "storage_l": 2_400_000, "supply_lpd": 500_000,
        "demand_lpd": 620_000, "loss_pct": 4,
        "anomaly_observed": False,
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "simulated": True, "note": "Synthetic post-intervention observation"
    }).json()["status"] == "VERIFIED"

def test_stale_plan_cannot_be_approved(client, zone):
    action = client.post("/api/zones/ward-12/actions", json={
        "scenario": "loss", "parameters": {}
    }).json()
    body = zone.model_dump(exclude={"id", "version", "provenance"})
    body.update(expected_version=1, storage_l=2_300_000)
    assert client.put("/api/zones/ward-12", json=body).status_code == 200
    result = client.post(f"/api/actions/{action['id']}/decision", json={
        "decision": "approve", "note": "Attempt approval after inputs changed"
    })
    assert result.status_code == 409

def test_export_is_read_only(client):
    assert client.get("/api/export").status_code == 200
    assert client.get("/api/audit").status_code == 200
