from datetime import datetime
from uuid import uuid4

from fastapi import HTTPException

from .agents import (
    ActionPlanner,
    CauseAgent,
    LossAnalyzer,
    Validator,
    VerificationAgent,
    WaterWatcher,
    evidence_for,
    input_composition,
)
from .data_sources.mapping import zone_context
from .engines import RiskEngine, ScenarioEngine, ShortageClockEngine, VerificationEngine
from .integrations import environmental_context
from .models import (
    LABELLED_FIELDS,
    Record,
    ScenarioInput,
    Zone,
    ZoneInput,
    ZoneUpdate,
    now,
)


def locate(state: dict, zone_id: str) -> Zone:
    item = next((z for z in state["zones"] if z["id"] == zone_id), None)
    if not item:
        raise HTTPException(404, "Zone not found")
    return Zone.model_validate(item)

def find_action(state: dict, action_id: str) -> dict:
    action = next(
        (item for item in state["actions"] if item["id"] == action_id), None
    )
    if not action:
        raise HTTPException(404, "Action not found")
    return action

def audit(state, event, entity, detail):
    state["audit"].append({
        "id": str(uuid4()), "timestamp": now(),
        "event": event, "entity_id": entity, "detail": detail,
        "actor": "local-demo-operator-or-authenticated-pilot-token"
    })

def provenance(zone: ZoneInput) -> Record:
    return Record(
        source="Operator zone configuration", source_type="OPERATOR INPUT",
        timestamp=now(), confidence="MEDIUM", location=zone.location,
        value="Operator-entered operational values", unit="record",
        influence="Water balance, risk and scenario inputs",
        data_label="OPERATOR INPUT"
    )

def analyze(state: dict, zone_id: str,
            parameters: ScenarioInput | None = None,
            workspace: str = "demo") -> dict:
    zone = locate(state, zone_id)
    parameters = parameters or ScenarioInput()
    # Public telemetry is only attached in the pilot workspace; the demo
    # workspace stays fully offline and never mixes in real observations.
    data_context = (
        zone_context(zone.latitude, zone.longitude,
                     linked_scheme_sl=zone.linked_scheme_sl)
        if workspace == "pilot" else None)
    environment = environmental_context(zone, workspace, data_context)
    model = WaterWatcher.observe(zone)
    scenarios = ScenarioEngine.compare(
        zone, [Zone.model_validate(z) for z in state["zones"]], parameters
    )
    evidence = evidence_for(zone, environment, model, data_context)
    validator = Validator.validate(zone, scenarios)
    return {
        "zone": zone.model_dump(),
        "model": model,
        "clock": ShortageClockEngine.calculate(model["buffer_days"]),
        "risk": RiskEngine.calculate(
            zone, model["buffer_days"],
            str(environment["rainfall"]["value"]),
            str(environment["groundwater"]["value"])
        ),
        "diagnosis": CauseAgent.diagnose(zone, model),
        "causes": CauseAgent.causes(zone, model, environment, data_context),
        "workspace": workspace,
        "data_context": data_context,
        "composition": input_composition(zone),
        "anomalies": LossAnalyzer.analyze(zone),
        "environment": environment,
        "scenarios": scenarios,
        "evidence": evidence,
        "validator": validator,
        "recommendation": ActionPlanner.plan(
            zone, scenarios, evidence, validator
        ),
        "calculated_at": now()
    }

def save_zone(state: dict, payload: ZoneInput, zone_id: str | None = None):
    if zone_id:
        previous = locate(state, zone_id)
        if not isinstance(payload, ZoneUpdate) or \
                previous.version != payload.expected_version:
            raise HTTPException(409, "Zone changed; refresh before saving")
        values = payload.model_dump(exclude={"expected_version"})
        # Fields the operator changed become OPERATOR INPUT; untouched fields
        # keep their original honesty label.
        labels = dict(previous.field_labels)
        for name in LABELLED_FIELDS:
            if getattr(previous, name) != values.get(name):
                labels[name] = "OPERATOR INPUT"
        values["field_labels"] = labels
        zone = Zone(
            **values, id=zone_id, version=previous.version + 1,
            provenance=provenance(payload)
        )
        state["zones"] = [
            zone.model_dump() if item["id"] == zone_id else item
            for item in state["zones"]
        ]
    else:
        if len(state["zones"]) >= 30:
            raise HTTPException(409, "Pilot supports at most 30 zones")
        values = payload.model_dump()
        values["field_labels"] = {
            name: "OPERATOR INPUT" for name in LABELLED_FIELDS}
        zone = Zone(
            **values, id=str(uuid4()), version=1,
            provenance=provenance(payload)
        )
        state["zones"].append(zone.model_dump())
    audit(state, "ZONE_SAVED", zone.id, f"Version {zone.version}")
    return zone.model_dump()

def create_action(state, zone_id, payload):
    # Deterministic action creation deliberately avoids external provider calls
    # inside the repository transaction.
    zone = locate(state, zone_id)
    scenarios = ScenarioEngine.compare(
        zone, [Zone.model_validate(z) for z in state["zones"]],
        payload.parameters
    )
    scenario = next(s for s in scenarios if s["id"] == payload.scenario)
    if not scenario["feasible"]:
        raise HTTPException(422, "Scenario fails resource or donor constraints")
    action = {
        "id": str(uuid4()), "zone_id": zone_id,
        "zone_version": zone.version,
        "workspace_zone_versions": {
            z["id"]: z["version"] for z in state["zones"]
        },
        "status": "DRAFT", "scenario": payload.scenario,
        "parameters": payload.parameters.model_dump(),
        "expected": scenario,
        "before": zone.model_dump(),
        "created_at": now(),
        "history": [{
            "timestamp": now(), "event": "DRAFT",
            "note": payload.note or "Operator requested a decision-support plan"
        }],
        "verification": None
    }
    state["actions"].append(action)
    audit(state, "ACTION_DRAFTED", action["id"], payload.scenario)
    return action

def ensure_current(state, action):
    current = {z["id"]: z["version"] for z in state["zones"]}
    if current != action["workspace_zone_versions"]:
        raise HTTPException(
            409, "Zone inputs changed since planning; create a fresh plan"
        )

def decide_action(state, action_id, payload):
    action = find_action(state, action_id)
    if action["status"] != "DRAFT":
        raise HTTPException(409, "Only draft plans can be reviewed")
    ensure_current(state, action)
    if payload.decision == "modify":
        if not payload.scenario:
            raise HTTPException(422, "Choose a scenario to modify the draft")
        zone = locate(state, action["zone_id"])
        scenarios = ScenarioEngine.compare(
            zone, [Zone.model_validate(z) for z in state["zones"]],
            ScenarioInput.model_validate(action["parameters"])
        )
        scenario = next(s for s in scenarios if s["id"] == payload.scenario)
        if not scenario["feasible"]:
            raise HTTPException(422, "Modified scenario is infeasible")
        action["scenario"] = payload.scenario
        action["expected"] = scenario
    else:
        action["status"] = (
            "APPROVED" if payload.decision == "approve" else "REJECTED"
        )
    action["history"].append({
        "timestamp": now(),
        "event": payload.decision.upper(),
        "note": payload.note
    })
    audit(state, payload.decision.upper(), action_id, payload.note)
    return action

def execute_action(state, action_id, payload):
    action = find_action(state, action_id)
    if action["status"] != "APPROVED":
        raise HTTPException(409, "Explicit approval is required first")
    ensure_current(state, action)
    action["status"] = "EXECUTED"
    action["executed_at"] = now()
    action["history"].append({
        "timestamp": now(), "event": "EXECUTION_RECORDED",
        "note": payload.note
    })
    audit(state, "EXECUTION_RECORDED", action_id, payload.note)
    return action

def verify_action(state, action_id, payload):
    action = find_action(state, action_id)
    if action["status"] != "EXECUTED":
        raise HTTPException(409, "Record execution before verification")
    if payload.observed_at < datetime.fromisoformat(action["executed_at"]):
        raise HTTPException(422, "Observation must follow recorded execution")
    before = Zone.model_validate(action["before"])
    after = before.model_copy(update={
        "storage_l": payload.storage_l, "supply_lpd": payload.supply_lpd,
        "demand_lpd": payload.demand_lpd, "loss_pct": payload.loss_pct,
        "observed_anomaly": payload.anomaly_observed,
        "provenance": Record(
            source="Operator verification entry",
            source_type=("SIMULATED OPERATIONAL DATA" if payload.simulated
                         else "OPERATOR INPUT"),
            timestamp=payload.observed_at.isoformat(),
            confidence="LOW" if payload.simulated else "MEDIUM",
            location=before.location, value=payload.note, unit="observation",
            influence="Before/after comparison; not proof of causation",
            data_label="SIMULATED OPERATIONAL DATA" if payload.simulated
            else "OPERATOR INPUT"
        )
    })
    result = VerificationEngine.compare(
        before, after, action["expected"]["buffer_days"]
    )
    action["verification"] = {
        **result, "simulated": payload.simulated,
        "observed_at": payload.observed_at.isoformat(),
        "recorded_at": now(),
        "provenance": after.provenance.model_dump(),
        "observation": after.model_dump(),
        "summary": VerificationAgent.summarize(result, payload.simulated),
        "note": payload.note
    }
    action["status"] = "VERIFIED"
    action["history"].append({
        "timestamp": now(), "event": "VERIFIED", "note": payload.note
    })
    audit(state, "VERIFIED", action_id, payload.note)
    return action
