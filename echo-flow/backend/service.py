import json
import logging
from datetime import datetime, timezone

from . import audit as audit_log
from .agents import execute_agents
from .analysis import analyze
from .domain import Assumptions, HumanRequest, Intervention, Observation, State, now, uid
from .repository import Repository
from .providers import open_meteo
from .scenarios import CATCHMENT_AREA_M2, create
from .simulation import simulate

log = logging.getLogger("echo-flow")


class RuleViolation(ValueError):
    """A domain transition or authorization constraint was violated."""


class ProviderUnavailable(RuntimeError):
    """A real-data provider could not supply a usable value; nothing is assumed."""


class Service:
    def __init__(self, repo: Repository, sink=None):
        self.repo = repo
        self.sink = sink if sink is not None else audit_log.sink_for(repo)

    def event(self, d: dict, name: str, source: str, data: dict) -> None:
        prev = d["audit"][-1]["hash"] if d["audit"] else audit_log.GENESIS
        d["audit"].append(audit_log.seal({
            "id": uid(), "timestamp": now(), "name": name, "source": source,
            "status": "COMPLETE",
            "data_reference": f"scenario:{d['id']}:revision:{d['state_revision']}",
            "data": data,
        }, prev, len(d["audit"]) + 1))

    def _save(self, d: dict, version: int, first_new_event: int) -> dict:
        saved = self.repo.save(d, version)
        self._flush(saved, first_new_event)
        return saved

    def _flush(self, d: dict, first_new_event: int) -> None:
        # Sink write happens only after the scenario write succeeded, so a lost optimistic-concurrency
        # race can never leave orphan audit events. The embedded hash chain stays authoritative; any
        # sink failure is logged and surfaced by audit verification (sink_consistent=false).
        try:
            self.sink.append(d["id"], d["audit"][first_new_event:])
        except Exception as exc:
            log.error(json.dumps({"event": "audit_sink_failure", "error_type": type(exc).__name__}))

    def verify_audit(self, sid: str, owner: str | None) -> dict:
        d = self.get(sid, owner)
        report = audit_log.verify_chain(d["audit"])
        try:
            stored = self.sink.read(sid)
            report["sink"] = self.sink.name
            report["sink_events"] = len(stored)
            report["sink_consistent"] = (
                len(stored) == len(d["audit"])
                and all(a["hash"] == b["hash"] for a, b in zip(stored, d["audit"])))
        except Exception as exc:
            report.update({"sink": self.sink.name, "sink_events": None, "sink_consistent": False,
                           "sink_error": type(exc).__name__})
        return report

    def new(self, mode: str, owner: str) -> dict:
        d = create(mode, owner)
        self.event(d, "Scenario created", "scenario-engine", d["metadata"])
        self.repo.create(d)
        self._flush(d, 0)
        return d

    def get(self, sid: str, owner: str | None = None) -> dict:
        d = self.repo.get(sid)
        if owner is not None and d["owner"] != owner:
            raise KeyError(sid)
        return d

    def build_run(self, d: dict, intervention: Intervention | None = None,
                  execution_id: str | None = None) -> dict:
        result = analyze(State.model_validate(d["state"]), d["unknown"], d["graph"], intervention)
        result.update({
            "id": uid(), "created_at": now(),
            "state_revision": d["state_revision"],
            "knowledge_revision": d["knowledge_revision"],
            "aws_execution_id": execution_id,
            "input_state": d["state"],
            "previous_learning": d["learning"][-1:] or [],
        })
        result["agents"] = execute_agents(result)
        agent_ok = all(a["status"] == "COMPLETE" for a in result["agents"])
        result["safety"]["checks"].append({
            "name": "Reasoning execution", "pass": agent_ok,
            "detail": "All configured reasoning adapters must complete"})
        result["safety"]["allowed"] = result["safety"]["allowed"] and agent_ok
        d["approval"] = None
        d["run"] = result
        d["runs"].append({k: result[k] for k in (
            "id", "created_at", "selected_plan", "state_revision", "knowledge_revision",
            "intervention")} | {"allowed": result["safety"]["allowed"]})

        for name, key in [
            ("Candidates evaluated", "options"), ("Counterfactuals simulated", "plans"),
            ("Agents executed", "agents"), ("Intervention echoes calculated", "simulation"),
            ("Robustness evaluated", "robustness"), ("Red team completed", "red_team"),
            ("Information value calculated", "voi"), ("Safety gate evaluated", "safety"),
        ]:
            self.event(d, name, "decision-engine",
                       {"run_id": result["id"], "result_reference": f"runs/{result['id']}/{key}"})
        return result

    def run(self, sid: str, owner: str | None, intervention: Intervention | None = None,
            execution_id: str | None = None, expected_version: int | None = None) -> dict:
        d = self.get(sid, owner)
        version = d["version"]
        n0 = len(d["audit"])
        if expected_version is not None and expected_version != version:
            raise RuleViolation("Scenario changed before workflow execution")
        self.build_run(d, intervention, execution_id)
        return self._save(d, version, n0)

    def verify(self, sid: str, owner: str, confirmed: bool) -> dict:
        if not confirmed:
            raise RuleViolation("Synthetic measurement confirmation is required")
        d = self.get(sid, owner)
        version = d["version"]
        n0 = len(d["audit"])
        # Controlled synthetic observation, not a real sensor or fetched fact.
        measurement = 0.2 if d["state"]["mode"] == "flood" else 0.1
        observation = Observation(label=f"SIMULATED VERIFICATION: {d['unknown']['name']}",
                                  value=measurement, unit="fraction").model_dump()
        d["observations"].append(observation)
        d["unknown"].update({"low": max(0, measurement - 0.02),
                             "high": min(0.95, measurement + 0.02), "verified": True})
        d["knowledge_revision"] += 1
        d["approval"] = None
        self.event(d, "Synthetic observation verified", owner, observation)
        return self._save(d, version, n0)

    def current(self, d: dict, run_id: str) -> dict:
        r = d["run"]
        if not r or r["id"] != run_id:
            raise RuleViolation("Run is not the current decision run")
        if r["state_revision"] != d["state_revision"] or r["knowledge_revision"] != d["knowledge_revision"]:
            raise RuleViolation("Run is stale; re-simulate first")
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(r["created_at"])).total_seconds()
        if age > d["decision_window_seconds"]:
            raise RuleViolation("Decision window expired; re-simulate")
        return r

    def verify_gate(self, d: dict, run_id: str) -> dict:
        r = self.current(d, run_id)
        p = Intervention.model_validate(r["intervention"])
        fresh = analyze(State.model_validate(d["state"]), d["unknown"], d["graph"], p)
        failed = [c["name"] for c in fresh["safety"]["checks"] if not c["pass"]]
        if failed:
            raise RuleViolation("ACTION BLOCKED: " + "; ".join(failed))
        if any(a["status"] != "COMPLETE" for a in r["agents"]):
            raise RuleViolation("ACTION BLOCKED: configured agent execution failed")
        return r

    def human(self, sid: str, owner: str, request: HumanRequest) -> dict:
        d = self.get(sid, owner)
        version = d["version"]
        n0 = len(d["audit"])
        r = self.current(d, request.run_id)
        if request.decision == "approve":
            if not request.confirmed:
                raise RuleViolation("Explicit approval confirmation is required")
            self.verify_gate(d, request.run_id)
            d["approval"] = {"run_id": r["id"], "actor": owner, "timestamp": now(),
                             "state_revision": d["state_revision"],
                             "knowledge_revision": d["knowledge_revision"]}
        elif request.decision == "reject":
            if not request.reason.strip():
                raise RuleViolation("Rejection reason is required")
            d["approval"] = None
            r["rejected"] = True
        else:
            if request.intervention is None:
                raise RuleViolation("Modified intervention is required")
            old = r["intervention"]
            self.build_run(d, request.intervention)
            self.event(d, "Human modification", owner, {
                "from_run": r["id"], "to_run": d["run"]["id"],
                "changes": {k: {"before": old[k], "after": v}
                            for k, v in request.intervention.model_dump().items() if old[k] != v},
            })
        self.event(d, f"Human {request.decision}", owner,
                   {"run_id": request.run_id, "reason": request.reason})
        return self._save(d, version, n0)

    def execute(self, sid: str, owner: str, run_id: str) -> dict:
        d = self.get(sid, owner)
        version = d["version"]
        n0 = len(d["audit"])
        r = self.verify_gate(d, run_id)
        approval = d["approval"]
        if not approval or approval["run_id"] != run_id or approval["actor"] != owner or r.get("rejected"):
            raise RuleViolation("A current human approval is required")
        if r.get("executed"):
            raise RuleViolation("This run was already executed")

        p = Intervention.model_validate(r["intervention"])
        truth = 0.2 if d["state"]["mode"] == "flood" else 0.1
        observed = simulate(State.model_validate(d["state"]), p,
                            Assumptions(unknown=truth, pump_efficiency=0.97))
        keys = ("a_m3", "b_m3") if d["state"]["mode"] == "flood" else ("water_m3",)
        errors = {k: observed["after"][k] - r["simulation"]["after"][k] for k in keys}
        normalized = max(abs(errors[k]) / max(1, abs(r["simulation"]["after"][k])) for k in keys)
        learning = {
            "run_id": run_id, "source_type": "synthetic",
            "prediction_error": errors, "maximum_relative_error": normalized,
            "drift_flag": normalized > 0.1,
            "confidence_adjustment": "REDUCE" if normalized > 0.1 else "UNCHANGED",
            "assumption_failure": "Synthetic observed pump efficiency differs from nominal forecast efficiency",
            "next_cycle_instruction": "Retain pump-efficiency stress range; "
                                      "do not treat one observation as calibration",
        }
        d["learning"].append(learning)
        previous = d["state"]
        d["state"] = observed["after"]
        d["state_revision"] += 1
        d["approval"] = None
        r["executed"] = True
        for item in d["runs"]:
            if item["id"] == run_id:
                item["executed"] = True
        d["action_result"] = {
            "label": "SIMULATED ACTION — NO PHYSICAL INFRASTRUCTURE CONTROL",
            "run_id": run_id, "previous_state": previous,
            "observed_result": observed, "learning": learning,
        }
        self.event(d, "Simulated action executed", owner,
                   {"run_id": run_id, "new_state_revision": d["state_revision"]})
        self.event(d, "Prediction compared with synthetic observation", "decision-evolution", learning)
        return self._save(d, version, n0)

    def apply_rainfall(self, sid: str, owner: str, lat: float, lon: float) -> dict:
        """REAL / PUBLIC rainfall (Open-Meteo) -> DERIVED rain inflow -> deterministic simulation input.

        The conversion uses a SIMULATED catchment area, so the resulting inflow is labelled DERIVED.
        Bumping state_revision makes any earlier run stale and clears approval.
        """
        d = self.get(sid, owner)
        if d["state"]["mode"] != "flood":
            raise RuleViolation("Live rainfall applies to the flood scenario only")
        version, n0 = d["version"], len(d["audit"])
        res = open_meteo.fetch(lat, lon)
        if res.status != "LIVE":
            raise ProviderUnavailable(f"Open-Meteo {res.status}: {res.detail or 'no data'}; scenario unchanged")
        hourly = (res.data.get("next_24h") or {}).get("hourly_precip_mm") or []
        window = hourly[:3]
        if not window:
            raise ProviderUnavailable("Open-Meteo returned no hourly precipitation; scenario unchanged")
        mm_h = float(max(window))
        inflow = round(mm_h * CATCHMENT_AREA_M2 / 1000 / 60, 4)
        before = d["state"]["rain_m3_min"]
        d["state"]["rain_m3_min"] = inflow
        d["state_revision"] += 1
        d["approval"] = None
        d.setdefault("live_inputs", {})["rain_m3_min"] = {
            "label": "DERIVED", "inputs": "REAL / PUBLIC precipitation x SIMULATED catchment area",
            "source": res.provider, "fetched_at": res.fetched_at, "mm_per_hour": mm_h,
            "catchment_area_m2": CATCHMENT_AREA_M2, "window_hours": len(window), "cached": res.cached}
        self.event(d, "Live rainfall applied to scenario state", owner, {
            "provider": res.provider, "provenance": res.provenance, "lat": lat, "lon": lon,
            "max_precip_mm_per_hour_next_3h": mm_h, "catchment_area_m2": CATCHMENT_AREA_M2,
            "rain_m3_min_before": before, "rain_m3_min_after": inflow,
            "fetched_at": res.fetched_at, "limitations": res.limitations})
        return self._save(d, version, n0)
