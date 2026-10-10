"""Public-data layer: real-file parsing, malformed input, units, freshness,
provenance, API filtering and data-honesty labelling."""
import json
import re
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.data_sources import registry
from app.data_sources.base import (
    DataUnavailable,
    freshness,
    parse_float,
    parse_time,
    raw_path,
)
from app.data_sources.delhi import DelhiGroundwaterProvider, short_name
from app.data_sources.discharge import MaharashtraDischargeProvider
from app.data_sources.mapping import zone_context
from app.data_sources.midc import MIDCWaterSupplyProvider
from app.data_sources.scada import MaharashtraScadaProvider, canonical
from app.data_sources.units import cusec_to_l_per_day, cusec_to_m3s, to_si
from app.main import create_app
from app.repositories import SQLiteRepository

NOW = datetime(2026, 10, 8, 6, 0, tzinfo=timezone.utc)
ALLOWED_LABELS = {
    "REAL PUBLIC DATA", "REAL GOVERNMENT BASELINE", "DERIVED MODEL INPUT",
    "SIMULATED OPERATIONAL DATA", "MODEL OUTPUT", "OPERATOR INPUT",
    "DEMO DATA", "AI RECOMMENDATION", None,
}
PILOT = {"X-WaterPulse-Workspace": "pilot"}


@pytest.fixture(autouse=True)
def fresh_registry():
    registry.reset()
    yield
    registry.reset()


@pytest.fixture
def client(tmp_path):
    repository = SQLiteRepository(str(tmp_path / "t.sqlite3"))
    with TestClient(create_app(repository)) as connection:
        yield connection


def write(tmp_path, name, text):
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    return path


# ------------------------------------------------------------ real datasets
def test_real_delhi_groundwater_parses():
    provider = DelhiGroundwaterProvider()
    summary = provider.summary(NOW)
    assert summary["stations"] == 14
    assert summary["observations"] == 8174
    assert summary["quality"]["skipped"] == {}
    assert summary["data_label"] == "REAL PUBLIC DATA"


def test_groundwater_latest_reading_and_provenance():
    latest = DelhiGroundwaterProvider().latest("DSIIDC", NOW)
    assert len(latest) == 1
    obs = latest[0]
    assert obs["timestamp"].startswith("2026-10-06T18:00:00+05:30")
    assert obs["value"] == pytest.approx(-17.721)
    for key in ("source", "source_type", "station_id", "station_name", "latitude",
                "longitude", "state", "district", "parameter", "value", "unit",
                "confidence", "freshness", "timestamp"):
        assert obs[key] not in (None, "") or key == "timestamp"
    assert obs["source_type"] == "PUBLIC DATA"
    assert "Sign convention" in obs["note"]


def test_groundwater_is_not_converted_to_storage():
    obs = DelhiGroundwaterProvider().latest(None, NOW)[0]
    assert obs["unit"] == "m" and obs["category"] == "GROUNDWATER_LEVEL"
    assert "storage" not in obs["parameter"].lower()


def test_groundwater_station_search_history_and_nearest():
    provider = DelhiGroundwaterProvider()
    assert [s["short_name"] for s in provider.stations("hiranki")] == [
        "Hiranki 11500", "Hiranki 12500", "Hiranki 16000"]
    history = provider.history("Daurala", limit=5, now=NOW)
    assert len(history) == 5
    assert history == sorted(history, key=lambda h: h["timestamp"])
    nearest = provider.nearest(28.77, 77.10, k=2, now=NOW)
    assert nearest[0]["distance_km"] <= nearest[1]["distance_km"]
    assert provider.nearest(0.5, 0.5, k=3, max_km=50) == []


def test_groundwater_trend_does_not_interpret_direction():
    trend = DelhiGroundwaterProvider().trend("DSIIDC", 30, NOW)
    assert trend["status"] == "OK"
    assert "not asserted" in trend["interpretation"]
    short = DelhiGroundwaterProvider().trend("Khera Khurd", 300, NOW)
    assert short["status"] == "INSUFFICIENT_HISTORY"


def test_real_scada_parses_and_normalises_parameters():
    provider = MaharashtraScadaProvider()
    summary = provider.summary(NOW)
    assert summary["observations"] == 167 and summary["stations"] == 1
    assert "Reservoir storage volume" in summary["parameters_not_in_file"]
    names = {o["parameter"] for o in provider.latest(now=NOW)}
    assert {"Inflow Discharge", "Pond Level", "Cumulative Gate Discharge",
            "Downstream Discharge (Canal)", "Downstream Level (Canal)"} <= names
    assert provider.quality["unrecognised"] == []


def test_scada_latest_and_level_is_not_storage():
    provider = MaharashtraScadaProvider()
    latest = {(o["parameter"], o["unit"]): o for o in provider.latest(now=NOW)}
    cumulative = latest[("Cumulative Gate Discharge", "cusec")]
    assert cumulative["value"] == pytest.approx(2665.55)
    assert cumulative["timestamp"].startswith("2026-08-12T07:00")
    pond = latest[("Pond Level", "m")]
    assert pond["category"] == "LEVEL"
    assert "not storage" in pond["note"].lower() or "no valid reading" in pond["note"].lower()
    assert all(o["category"] != "STORAGE" for o in provider.latest(now=NOW))


def test_scada_internal_inconsistency_is_flagged():
    flags = MaharashtraScadaProvider().summary(NOW)["quality_flags"]
    assert flags and "inconsistent" in flags[0]


def test_scada_gate_channels_hidden_by_default_but_available():
    provider = MaharashtraScadaProvider()
    assert not any(o["parameter"].startswith("Gate ") for o in provider.latest(now=NOW))
    assert any(o["parameter"].startswith("Gate ")
               for o in provider.latest(now=NOW, include_gates=True))


def test_real_discharge_parses_and_reports_zero_honestly():
    provider = MaharashtraDischargeProvider()
    summary = provider.summary(NOW)
    assert summary["observations"] == 1976
    assert summary["all_zero_in_file"] is True
    latest = provider.latest(NOW)
    assert latest["timestamp"].startswith("2026-10-06T22:00")
    assert latest["value"] == 0 and latest["unit"] == "cusec"
    assert "DERIVED sum" in latest["note"]
    assert "does not by itself" in latest["note"]
    assert summary["largest_gap_hours"] > 900


def test_real_midc_parses_messy_values():
    provider = MIDCWaterSupplyProvider()
    summary = provider.summary()
    assert summary["schemes"] == 83
    shahad = provider.get(6)
    assert shahad["industrial_mld"] is None and shahad["domestic_mld"] == 125
    hinganghat = provider.get(62)
    assert hinganghat["capacity_mld"] is None
    assert any("Open well" in n for n in hinganghat["data_quality_notes"])
    nanded = provider.find_by_name("Nanded Water Supply Scheme")
    assert len(nanded) == 2
    assert all(any("more than once" in n for n in s["data_quality_notes"]) for s in nanded)
    islampur = provider.get(30)
    assert any("does not match" in n for n in islampur["data_quality_notes"])


def test_midc_is_baseline_never_live_and_placement_is_approximate():
    provider = MIDCWaterSupplyProvider()
    scheme = provider.get(25)
    assert scheme["data_label"] == "REAL GOVERNMENT BASELINE"
    assert scheme["timestamp"] is None
    assert scheme["freshness"]["status"] == "UNKNOWN"
    assert scheme["placement"].startswith("APPROXIMATE TOWN CENTROID")
    assert scheme["utilisation_pct"] == pytest.approx(36.7, abs=0.1)
    assert scheme["spare_capacity_mld"] == pytest.approx(1.9)
    unplaced = provider.get(5)
    assert unplaced["latitude"] is None and unplaced["placement"] == "NO COORDINATES IN SOURCE"


# --------------------------------------------------------- malformed input
def test_malformed_delhi_rows_are_skipped_and_counted(tmp_path):
    path = write(tmp_path, "gw.csv", (
        "Station,Latitude,Longitude,Data Acquisition Time,"
        "Groundwater Level Telemetry 6 Hourly (meter)\n"
        "New Delhi A A,28.5,77.0,01-01-2026 00:00,5.5\n"
        "New Delhi A A,28.5,77.0,not-a-date,5.6\n"
        "New Delhi A A,28.5,77.0,01-01-2026 06:00,\n"
        "New Delhi A A,28.5,77.0,01-01-2026 12:00,NA\n"
        "New Delhi B B,xx,yy,01-01-2026 12:00,3\n"
        ",28.5,77.0,01-01-2026 12:00,3\n"))
    provider = DelhiGroundwaterProvider(path)
    provider._load()
    assert provider.quality["accepted"] == 1
    assert provider.quality["skipped"] == {
        "bad_timestamp": 1, "missing_value": 2, "bad_coordinates": 1,
        "missing_station": 1}


@pytest.mark.parametrize("cls,header", [
    (DelhiGroundwaterProvider, "Station,Latitude\nA,1\n"),
    (MaharashtraScadaProvider, "timestamp,station_code\nx,y\n"),
    (MaharashtraDischargeProvider, "Station,Latitude,Longitude,Data Acquisition Time\nA,1,2,x\n"),
    (MIDCWaterSupplyProvider, "Sl. No.,Something else\n1,2\n"),
])
def test_missing_columns_raise_structured_unavailable(tmp_path, cls, header):
    provider = cls(write(tmp_path, "bad.csv", header))
    with pytest.raises(DataUnavailable) as caught:
        provider.summary() if cls is MIDCWaterSupplyProvider else provider.summary(NOW)
    payload = caught.value.payload()
    assert payload["status"] == "DATA_UNAVAILABLE" and payload["last_known"] is None
    assert "Missing required columns" in payload["message"]


def test_missing_file_is_unavailable(tmp_path):
    with pytest.raises(DataUnavailable):
        DelhiGroundwaterProvider(tmp_path / "nope.csv").summary(NOW)


def test_oversized_file_is_refused(tmp_path, monkeypatch):
    from app.data_sources import base
    monkeypatch.setattr(base, "MAX_CSV_BYTES", 10)
    path = write(tmp_path, "big.csv", "Station,Latitude\n" + "A,1\n" * 20)
    with pytest.raises(DataUnavailable):
        DelhiGroundwaterProvider(path).summary(NOW)


def test_discharge_rejects_unknown_units(tmp_path):
    path = write(tmp_path, "d.csv", (
        "Station,Latitude,Longitude,Data Acquisition Time,Gate-1 Discharge (m3s)\n"
        "A,1,2,01-01-2026 00:00,3\n"))
    with pytest.raises(DataUnavailable):
        MaharashtraDischargeProvider(path).summary(NOW)


def test_path_traversal_is_blocked():
    with pytest.raises(DataUnavailable):
        raw_path("../../etc/passwd")


# --------------------------------------------------- timestamps, units, age
def test_timestamp_parsing_assumes_ist():
    moment = parse_time("09-08-2026 06:00", ("%d-%m-%Y %H:%M",))
    assert moment.utcoffset() == timedelta(hours=5, minutes=30)
    assert moment.astimezone(timezone.utc).hour == 0
    assert parse_time("32-13-2026 00:00", ("%d-%m-%Y %H:%M",)) is None


@pytest.mark.parametrize("raw,expected", [
    ("1,234.5", 1234.5), ("  7 ", 7.0), ("NA", None), ("", None), ("-", None),
    ("nan", None), ("inf", None), ("Open well", None), (None, None)])
def test_parse_float(raw, expected):
    assert parse_float(raw) == expected


def test_unit_conversions_are_documented_values():
    assert cusec_to_m3s(1) == pytest.approx(0.0283168466)
    assert cusec_to_l_per_day(1) == pytest.approx(2_446_575.5, rel=1e-6)
    assert to_si(10, "cusec") == (pytest.approx(0.283168466), "m³/s")
    assert to_si(10, "ft") == (pytest.approx(3.048), "m")
    assert to_si(5, "m") == (5, "m")
    assert to_si(5, "furlong") == (None, None)


def test_discharge_conversion_is_labelled():
    summary = MaharashtraDischargeProvider().summary(NOW)
    assert "DERIVED" in summary["conversion"] and "L/day" in summary["conversion"]


def test_freshness_uses_dataset_cadence_and_never_says_live():
    observed = NOW - timedelta(hours=5)
    assert freshness(observed, 6, NOW)["status"] == "CURRENT"
    assert freshness(observed, 1, NOW)["status"] == "STALE"
    assert freshness(None, 1, NOW)["status"] == "UNKNOWN"
    assert freshness(NOW + timedelta(hours=3), 1, NOW)["status"] == "FUTURE-DATED"
    assert freshness(NOW - timedelta(days=60), 6, NOW)["age_label"] == "60d ago"


def test_station_name_cleaning():
    assert short_name("New Delhi Daurala Daurala") == "Daurala"
    assert short_name("New Delhi Hiranki Hiranki 11500") == "Hiranki 11500"
    assert canonical("DownStrem Discharge-2 Dam/Barrage") == (
        "Downstream Discharge #2 (Dam/Barrage)", "DISCHARGE")
    assert canonical("Weird Tag")[1] == "OTHER"


# ------------------------------------------------------------- zone mapping
def test_zone_context_distinguishes_nearby_from_unrelated():
    near_delhi = zone_context(28.77, 77.10, NOW)
    assert near_delhi["groundwater"]["status"] == "OK"
    assert near_delhi["groundwater"]["relevance"] == "NEARBY PUBLIC TELEMETRY"
    assert near_delhi["scada"]["status"] == "NO_NEARBY_TELEMETRY"
    assert near_delhi["scada"]["relevance"] == "NOT REPRESENTATIVE"
    near_solapur = zone_context(18.12, 75.02, NOW, linked_scheme_sl=25)
    assert near_solapur["scada"]["status"] == "OK"
    assert near_solapur["groundwater"]["status"] == "NO_NEARBY_TELEMETRY"
    assert near_solapur["supply_baseline"]["linked_scheme"]["scheme"].startswith("Indapur")


def test_lead_groundwater_station_is_most_recent_not_merely_nearest():
    stations = zone_context(28.77, 77.10, NOW)["groundwater"]["stations"]
    ages = [s["freshness"]["age_hours"] for s in stations]
    assert ages == sorted(ages)


# -------------------------------------------------------------- data API
def test_summary_endpoint_has_statement_and_four_providers(client):
    body = client.get("/api/data/summary").json()
    assert set(body["providers"]) == {"groundwater", "scada", "discharge", "water_supply"}
    assert "not necessarily live municipal telemetry" in body["statement"]
    assert "not connected" in body["not_connected"]["municipal_demand"]


def test_groundwater_endpoint_filters(client):
    body = client.get("/api/data/groundwater", params={"q": "hiranki"}).json()
    assert body["count"] == 3
    one = client.get("/api/data/groundwater", params={
        "station": "Daurala", "history": True, "limit": 3}).json()
    assert one["count"] == 3
    near = client.get("/api/data/groundwater", params={
        "latitude": 28.77, "longitude": 77.10, "radius_km": 10}).json()
    assert 1 <= near["count"] <= 5
    assert all(i["distance_km"] <= 10 for i in near["items"])
    assert client.get("/api/data/groundwater", params={"state": "Kerala"}).json()["count"] == 0
    assert client.get("/api/data/groundwater", params={"history": True}).status_code == 422
    assert client.get("/api/data/groundwater", params={
        "station": "DSIIDC", "history": True, "start": "garbage"}).status_code == 422


def test_scada_endpoint_filters_and_date_window(client):
    body = client.get("/api/data/scada", params={"parameter": "inflow"}).json()
    assert body["count"] == 3
    assert all(i["parameter"] == "Inflow Discharge" for i in body["items"])
    windowed = client.get("/api/data/scada", params={
        "parameter": "inflow", "start": "2026-08-12T07:30", "end": "2026-08-12T09:00"}).json()
    assert windowed["count"] == 1
    default = client.get("/api/data/scada").json()
    assert default["count"] < 40  # latest per parameter, not the 167 raw rows
    assert "Reservoir storage volume" in default["not_in_file"]


def test_discharge_endpoint_never_dumps_raw_file(client):
    body = client.get("/api/data/discharge").json()
    assert "items" not in body and body["latest"]["value"] == 0
    hist = client.get("/api/data/discharge", params={"history": True, "limit": 5}).json()
    assert len(hist["items"]) == 5
    capped = client.get("/api/data/discharge", params={"history": True, "limit": 99999})
    assert capped.status_code == 422


def test_water_supply_endpoint_paginates(client):
    first = client.get("/api/data/water-supply", params={"limit": 10}).json()
    second = client.get("/api/data/water-supply", params={"limit": 10, "offset": 10}).json()
    assert first["count"] == 10 and second["count"] == 10
    assert first["items"][0]["sl_no"] != second["items"][0]["sl_no"]
    assert first["data_label"] == "REAL GOVERNMENT BASELINE"
    hit = client.get("/api/data/water-supply", params={"q": "nashik"}).json()
    assert hit["count"] == 1


def test_map_endpoint_features_and_radius(client):
    body = client.get("/api/data/map").json()
    kinds = {f["kind"] for f in body["features"]}
    assert kinds == {"groundwater", "scada", "discharge", "water_supply"}
    assert body["count"] == len(body["features"]) < 100
    near = client.get("/api/data/map", params={
        "latitude": 18.12, "longitude": 75.02, "radius_km": 30}).json()
    assert {"scada", "discharge"} <= {f["kind"] for f in near["features"]}
    assert not any(f["kind"] == "groundwater" for f in near["features"])
    for feature in near["features"]:
        assert feature["source"] and feature["freshness"]["status"]


def test_failed_provider_degrades_only_its_endpoint(client, tmp_path):
    registry.override("groundwater", DelhiGroundwaterProvider(tmp_path / "missing.csv"))
    gone = client.get("/api/data/groundwater").json()
    assert gone["status"] == "DATA_UNAVAILABLE" and gone["last_known"] is None
    assert client.get("/api/data/scada").json()["status"] == "OK"
    summary = client.get("/api/data/summary").json()
    assert summary["providers"]["groundwater"]["status"] == "DATA_UNAVAILABLE"
    assert summary["providers"]["water_supply"]["schemes"] == 83
    assert client.get("/api/data/map").json()["layers"]["groundwater"]["status"] == "DATA_UNAVAILABLE"
    assert client.get("/api/zones/pilot-delhi-nw/analysis", headers=PILOT).status_code == 200


# ------------------------------------------------- honesty / provenance
LIVE_WORD = re.compile(r"\bLIVE\b|REAL-TIME|REALTIME|MUNICIPAL SENSOR|WARD TELEMETRY")


def all_label_values(node, found=None):
    found = [] if found is None else found
    if isinstance(node, dict):
        for key, value in node.items():
            if key in {"data_label", "label", "source_type"} and isinstance(value, str):
                found.append(value)
            if key == "status" and isinstance(value, str):
                found.append(value)
            all_label_values(value, found)
    elif isinstance(node, list):
        for item in node:
            all_label_values(item, found)
    return found


def test_no_fake_live_labels_anywhere(client):
    payloads = [
        client.get("/api/data/summary").json(), client.get("/api/data/map").json(),
        client.get("/api/data/groundwater").json(), client.get("/api/data/scada").json(),
        client.get("/api/data/discharge").json(), client.get("/api/data/water-supply").json(),
    ]
    for zone in client.get("/api/zones", headers=PILOT).json():
        payloads.append(client.get(f"/api/zones/{zone['id']}/analysis", headers=PILOT).json())
    for payload in payloads:
        for value in all_label_values(payload):
            assert not LIVE_WORD.search(value.upper()), value
            assert value in ALLOWED_LABELS | {
                "OK", "STALE", "CURRENT", "UNKNOWN", "DATA_UNAVAILABLE",
                "NO_NEARBY_TELEMETRY", "INSUFFICIENT_HISTORY", "PUBLIC DATA",
                "DERIVED MODEL INPUT", "SIMULATED OPERATIONAL DATA", "OPERATOR INPUT",
                "MODEL OUTPUT", "DEMO DATA", "AI RECOMMENDATION", "FUTURE-DATED",
                "CRITICAL", "WATCH", "STABLE", "SHORTAGE APPROACHING",
                "MODEL RISK ESTIMATE", "Estimated time to configured reserve",
                "NOT APPROVED", "DRAFT", "DRIVER", "CONTEXT",
            }, value


def test_every_real_observation_carries_full_provenance(client):
    items = client.get("/api/data/groundwater").json()["items"]
    items += client.get("/api/data/scada").json()["items"]
    for obs in items:
        assert obs["source"] and obs["source_type"] == "PUBLIC DATA"
        assert obs["data_label"] == "REAL PUBLIC DATA"
        assert obs["timestamp"] and obs["unit"] and obs["confidence"]
        assert obs["freshness"]["status"] in {"CURRENT", "STALE"}
        assert obs["latitude"] is not None and obs["longitude"] is not None


def test_demo_workspace_stays_demo_and_pilot_never_uses_demo_values(client):
    demo = client.get("/api/zones/ward-12/analysis").json()
    assert demo["data_context"] is None and demo["workspace"] == "demo"
    assert {r["source_type"] for r in demo["evidence"] if r["unit"] != "days to reserve"} \
        >= {"DEMO DATA"}
    for zone in client.get("/api/zones", headers=PILOT).json():
        analysis = client.get(f"/api/zones/{zone['id']}/analysis", headers=PILOT).json()
        assert analysis["workspace"] == "pilot"
        assert not any(r["source_type"] == "DEMO DATA" for r in analysis["evidence"])
        assert analysis["environment"]["weather"]["value"] == "DATA UNAVAILABLE"
        assert analysis["environment"]["rainfall"]["value"] == "DATA UNAVAILABLE"


def test_pilot_zone_inputs_are_labelled_by_origin(client):
    zone = client.get("/api/zones/pilot-indapur", headers=PILOT) if False else next(
        z for z in client.get("/api/zones", headers=PILOT).json() if z["id"] == "pilot-indapur")
    labels = zone["field_labels"]
    assert labels["demand_lpd"] == "REAL GOVERNMENT BASELINE"
    assert labels["supply_lpd"] == "SIMULATED OPERATIONAL DATA"
    assert labels["storage_l"] == "SIMULATED OPERATIONAL DATA"
    assert labels["distance_km"] == "DERIVED MODEL INPUT"
    assert zone["demand_lpd"] == pytest.approx(1_100_000)  # MIDC utilisation 1.1 MLD
    assert zone["provenance"]["source_type"] == "SIMULATED OPERATIONAL DATA"
    assert "no municipal telemetry" in zone["notes"].lower()


def test_operator_edit_relabels_only_changed_fields(client):
    zone = next(z for z in client.get("/api/zones", headers=PILOT).json()
                if z["id"] == "pilot-indapur")
    update = {k: v for k, v in zone.items() if k not in {"id", "version", "provenance"}}
    update["loss_pct"] = 9.0
    update["expected_version"] = zone["version"]
    saved = client.put("/api/zones/pilot-indapur", json=update, headers=PILOT).json()
    assert saved["field_labels"]["loss_pct"] == "OPERATOR INPUT"
    assert saved["field_labels"]["demand_lpd"] == "REAL GOVERNMENT BASELINE"


def test_unknown_field_label_rejected(client):
    zone = client.get("/api/zones", headers=PILOT).json()[0]
    update = {k: v for k, v in zone.items() if k not in {"id", "version", "provenance"}}
    update["field_labels"] = {"nonsense": "DEMO DATA"}
    update["expected_version"] = zone["version"]
    assert client.put(f"/api/zones/{zone['id']}", json=update, headers=PILOT).status_code == 422


def test_causes_are_labelled_and_context_is_not_causal(client):
    analysis = client.get("/api/zones/pilot-indapur/analysis", headers=PILOT).json()
    causes = analysis["causes"]
    assert 3 <= len(causes) <= 5
    assert [c["rank"] for c in causes] == list(range(1, len(causes) + 1))
    assert all(c["label"] in ALLOWED_LABELS for c in causes)
    canal = next(c for c in causes if c["id"] == "nearby-canal")
    assert canal["label"] == "REAL PUBLIC DATA" and "Not proof" in canal["detail"]
    assert canal["kind"] == "CONTEXT"


def test_workspaces_are_isolated(client):
    assert client.get("/api/zones").json()[0]["id"] == "ward-12"
    assert client.get("/api/zones", headers=PILOT).json()[0]["id"] == "pilot-indapur"
    assert client.get("/api/zones", headers={"X-WaterPulse-Workspace": "bogus"}).status_code == 422


# --------------------------------------------- approval flow in pilot data
def make_plan(client, scenario="tanker"):
    return client.post("/api/zones/pilot-indapur/actions", headers=PILOT, json={
        "scenario": scenario, "parameters": {}}).json()


def test_human_approval_enforced_server_side_in_pilot(client):
    action = make_plan(client)
    assert action["status"] == "DRAFT"
    blocked = client.post(f"/api/actions/{action['id']}/execution", headers=PILOT,
                          json={"note": "try to skip approval"})
    assert blocked.status_code == 409
    client.post(f"/api/actions/{action['id']}/decision", headers=PILOT,
                json={"decision": "approve", "note": "reviewed"})
    executed = client.post(f"/api/actions/{action['id']}/execution", headers=PILOT,
                           json={"note": "dispatched by operator"})
    assert executed.json()["status"] == "EXECUTED"


def test_actions_do_not_leak_between_workspaces(client):
    action = make_plan(client)
    assert client.get("/api/actions").json() == []
    assert [a["id"] for a in client.get("/api/actions", headers=PILOT).json()] == [action["id"]]
    cross = client.post(f"/api/actions/{action['id']}/decision",
                        json={"decision": "approve", "note": "wrong workspace"})
    assert cross.status_code == 404


def test_stale_plan_rejected_after_zone_edit(client):
    action = make_plan(client)
    zone = next(z for z in client.get("/api/zones", headers=PILOT).json()
                if z["id"] == "pilot-indapur")
    update = {k: v for k, v in zone.items() if k not in {"id", "version", "provenance"}}
    update["storage_l"] = zone["storage_l"] + 1000
    update["expected_version"] = zone["version"]
    client.put("/api/zones/pilot-indapur", json=update, headers=PILOT)
    stale = client.post(f"/api/actions/{action['id']}/decision", headers=PILOT,
                        json={"decision": "approve", "note": "too late"})
    assert stale.status_code == 409


def test_verification_labels_simulated_vs_operator(client):
    action = make_plan(client)
    client.post(f"/api/actions/{action['id']}/decision", headers=PILOT,
                json={"decision": "approve", "note": "approved after review"})
    client.post(f"/api/actions/{action['id']}/execution", headers=PILOT,
                json={"note": "executed"})
    payload = {"storage_l": 1_900_000, "supply_lpd": 800_000, "demand_lpd": 1_100_000,
               "loss_pct": 12, "anomaly_observed": False,
               "observed_at": datetime.now(timezone.utc).isoformat(),
               "simulated": True, "note": "post action reading"}
    done = client.post(f"/api/actions/{action['id']}/verification", headers=PILOT,
                       json=payload).json()
    assert done["verification"]["summary"].startswith("SIMULATED VERIFICATION")
    assert done["verification"]["provenance"]["source_type"] == "SIMULATED OPERATIONAL DATA"
    assert "causal" in done["verification"]["interpretation"]


def test_pilot_mode_without_token_still_blocks_data_endpoints(tmp_path, monkeypatch):
    import dataclasses

    from app import main as main_module
    from app.config import settings
    monkeypatch.setattr(main_module, "settings", dataclasses.replace(
        settings, mode="pilot", api_token="t" * 40))
    repository = SQLiteRepository(str(tmp_path / "p.sqlite3"))
    with TestClient(create_app(repository)) as connection:
        assert connection.get("/api/data/summary").status_code == 401
        ok = connection.get("/api/data/summary",
                            headers={"Authorization": "Bearer " + "t" * 40})
        assert ok.status_code == 200


def test_data_responses_are_json_serialisable_and_bounded(client):
    for path in ("/api/data/groundwater", "/api/data/scada", "/api/data/water-supply",
                 "/api/data/map", "/api/data/discharge"):
        text = client.get(path).text
        json.loads(text)
        assert len(text) < 250_000, path
