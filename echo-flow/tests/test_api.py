from fastapi.testclient import TestClient

from backend.main import create_app
from backend.repository import SQLiteRepository


def client(tmp_path):
    return TestClient(create_app(SQLiteRepository(str(tmp_path / "api.sqlite3"))))


def test_api_health_and_validation(tmp_path):
    c = client(tmp_path)
    assert c.get("/api/health").status_code == 200
    assert c.post("/api/scenarios", json={"mode": "invalid"}).status_code == 422
    assert c.get("/api/scenarios/missing").status_code == 404


def test_api_hero(tmp_path):
    c = client(tmp_path)
    d = c.post("/api/scenarios", json={"mode": "flood"}).json()
    sid = d["id"]

    response = c.post(f"/api/scenarios/{sid}/decision", json={})
    assert response.status_code == 200
    d = response.json()
    assert d["run"]["simulation"]["echoes"]
    assert len(d["run"]["plans"]) == 4
    assert c.get(f"/api/scenarios/{sid}/find-options").status_code == 200
    assert c.get(f"/api/scenarios/{sid}/red-team").status_code == 200

    denied = c.post(f"/api/scenarios/{sid}/execute", json={"run_id": d["run"]["id"]})
    assert denied.status_code == 409

    assert c.post(f"/api/scenarios/{sid}/verify",
                  json={"confirm_synthetic_measurement": True}).status_code == 200

    d = c.post(f"/api/scenarios/{sid}/decision", json={}).json()
    rid = d["run"]["id"]
    approved = c.post(f"/api/scenarios/{sid}/human-decision",
                      json={"run_id": rid, "decision": "approve", "confirmed": True})
    assert approved.status_code == 200

    executed = c.post(f"/api/scenarios/{sid}/execute", json={"run_id": rid})
    assert executed.status_code == 200
    assert executed.json()["state_revision"] == 1

    again = c.post(f"/api/scenarios/{sid}/resimulate", json={})
    assert again.status_code == 200
    assert again.json()["run"]["state_revision"] == 1
    assert len(c.get(f"/api/scenarios/{sid}/audit").json()) > 10


def test_untrusted_origin_rejected(tmp_path):
    c = client(tmp_path)
    r = c.post("/api/scenarios", json={"mode": "flood"}, headers={"Origin": "https://untrusted.example"})
    assert r.status_code == 403
