import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend import audit
from backend.main import create_app
from backend.providers import base
from backend.repository import SQLiteRepository
from backend.service import Service

OM = {"current": {"temperature_2m": 30}, "hourly": {"precipitation": [10.0, 40.0, 20.0, 99.0],
      "precipitation_probability": [], "temperature_2m": []}}


def make(tmp_path):
    app = create_app(SQLiteRepository(str(tmp_path / "t.sqlite3")))
    return TestClient(app), app.state.service, str(tmp_path / "t.sqlite3")


def test_audit_chain_verifies_and_sink_matches(tmp_path):
    c, svc, _ = make(tmp_path)
    sid = c.post("/api/scenarios", json={"mode": "flood"}).json()["id"]
    c.post(f"/api/scenarios/{sid}/decision", json={})
    r = c.get(f"/api/scenarios/{sid}/audit/verify").json()
    assert r["valid"] and r["events"] > 5 and r["sink_consistent"] and r["head_hash"]


def test_tampering_with_document_is_detected(tmp_path):
    c, svc, path = make(tmp_path)
    sid = c.post("/api/scenarios", json={"mode": "flood"}).json()["id"]
    c.post(f"/api/scenarios/{sid}/decision", json={})
    db = sqlite3.connect(path)
    doc = json.loads(db.execute("SELECT document FROM scenarios").fetchone()[0])
    doc["audit"][2]["name"] = "Human approve"  # forged history
    db.execute("UPDATE scenarios SET document=?", (json.dumps(doc),)); db.commit(); db.close()
    r = c.get(f"/api/scenarios/{sid}/audit/verify").json()
    assert not r["valid"] and r["broken_at_seq"] == 3 and r["reason"] == "event content altered"


def test_deleting_an_event_is_detected(tmp_path):
    c, svc, _ = make(tmp_path)
    sid = c.post("/api/scenarios", json={"mode": "flood"}).json()["id"]
    c.post(f"/api/scenarios/{sid}/decision", json={})
    d = svc.get(sid)
    del d["audit"][1]
    assert not audit.verify_chain(d["audit"])["valid"]


def test_sqlite_sink_is_append_only(tmp_path):
    c, svc, path = make(tmp_path)
    c.post("/api/scenarios", json={"mode": "flood"})
    db = sqlite3.connect(path)
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        db.execute("UPDATE audit SET hash='x'")
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        db.execute("DELETE FROM audit")


def test_sink_failure_does_not_fail_request_and_is_reported(tmp_path):
    c, svc, _ = make(tmp_path)
    sid = c.post("/api/scenarios", json={"mode": "flood"}).json()["id"]
    class Broken(audit.NullSink):
        name = "broken"
        def append(self, *a): raise RuntimeError("down")
        def read(self, *a): raise RuntimeError("down")
    svc.sink = Broken()
    assert c.post(f"/api/scenarios/{sid}/decision", json={}).status_code == 200
    r = c.get(f"/api/scenarios/{sid}/audit/verify").json()
    assert r["valid"] and r["sink_consistent"] is False


def test_rainfall_applies_derived_input_and_invalidates_run(tmp_path, monkeypatch):
    c, svc, _ = make(tmp_path)
    sid = c.post("/api/scenarios", json={"mode": "flood"}).json()["id"]
    c.post(f"/api/scenarios/{sid}/decision", json={})
    monkeypatch.setattr(base, "transport", lambda *a, **k: (200, {}, json.dumps(OM).encode()))
    d = c.post(f"/api/scenarios/{sid}/rainfall-input", json={"lat": 19.07, "lon": 72.87}).json()
    assert d["state"]["rain_m3_min"] == 40.0  # max of first 3 hours (40 mm/h) x 60,000 m2 / 1000 / 60
    assert d["live_inputs"]["rain_m3_min"]["label"] == "DERIVED"
    assert d["state_revision"] == 1 and d["approval"] is None
    rid = d["run"]["id"]
    stale = c.post(f"/api/scenarios/{sid}/human-decision", json={"run_id": rid, "decision": "approve", "confirmed": True})
    assert stale.status_code == 409 and "stale" in stale.json()["detail"].lower()
    assert audit.verify_chain(d["audit"])["valid"]
    assert d["audit"][-1]["data"]["provenance"] == "REAL / PUBLIC"


def test_rainfall_provider_down_leaves_scenario_unchanged(tmp_path):
    c, svc, _ = make(tmp_path)
    sid = c.post("/api/scenarios", json={"mode": "flood"}).json()["id"]
    r = c.post(f"/api/scenarios/{sid}/rainfall-input", json={"lat": 19.07, "lon": 72.87})
    assert r.status_code == 503 and r.json()["status"] == "PROVIDER_UNAVAILABLE"
    d = c.get(f"/api/scenarios/{sid}").json()
    assert d["state_revision"] == 0 and d["state"]["rain_m3_min"] == 80


def test_rainfall_rejected_for_heat_and_bad_coordinates(tmp_path):
    c, *_ = make(tmp_path)
    sid = c.post("/api/scenarios", json={"mode": "heat"}).json()["id"]
    assert c.post(f"/api/scenarios/{sid}/rainfall-input", json={"lat": 1, "lon": 1}).status_code == 409
    assert c.post(f"/api/scenarios/{sid}/rainfall-input", json={"lat": 999, "lon": 1}).status_code == 422


def test_live_context_endpoint_and_missing_keys(tmp_path):
    c, *_ = make(tmp_path)
    r = c.get("/api/live-context", params={"lat": 19.07, "lon": 72.87, "q": "flood"})
    assert r.status_code == 200
    p = r.json()["providers"]
    assert p["evidence"]["status"] == "NOT_CONNECTED"
    assert p["weather"]["status"] == "UNAVAILABLE"  # network blocked; reported, not faked
    assert c.get("/api/live-context", params={"lat": 500, "lon": 0}).status_code == 422


def test_integrations_never_leak_values(tmp_path, monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "super-secret-value")
    c, *_ = make(tmp_path)
    body = c.get("/api/integrations").text
    assert "super-secret-value" not in body and '"set":true' in body.replace(" ", "")


def test_health_is_honest_without_aws(tmp_path):
    c, *_ = make(tmp_path)
    h = c.get("/api/health").json()
    assert h["aws"].startswith("NOT USED") and h["bedrock"].startswith("NOT USED")
    assert "ONLINE" in h["audit_sink"] and h["config_issues"] == []


def test_coverage_does_not_overclaim(tmp_path):
    c, *_ = make(tmp_path)
    cov = c.get("/api/coverage").json()["challenges"]
    assert len(cov) == 7
    by = {x["challenge"]: x["engine"] for x in cov}
    assert by["Floods"] == "IMPLEMENTED"
    assert by["Water Leaks"] == by["Water Tankers"] == by["Groundwater"] == "PLANNED"


def test_deterministic_engine_runs_with_bedrock_unavailable(tmp_path, monkeypatch):
    monkeypatch.setenv("ECHO_AGENT_PROVIDER", "bedrock")
    monkeypatch.setenv("ECHO_BEDROCK_MODEL_ID", "x")
    import sys, types
    boom = types.ModuleType("boto3")
    boom.client = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no credentials"))
    monkeypatch.setitem(sys.modules, "boto3", boom)
    c, *_ = make(tmp_path)
    sid = c.post("/api/scenarios", json={"mode": "flood"}).json()["id"]
    run = c.post(f"/api/scenarios/{sid}/decision", json={}).json()["run"]
    assert run["simulation"]["metrics"] and len(run["plans"]) == 4  # numbers exist without Bedrock
    assert all(a["status"] == "ERROR" for a in run["agents"])
    assert run["safety"]["allowed"] is False  # Bedrock failure blocks approval; never fakes success
