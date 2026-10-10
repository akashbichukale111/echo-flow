from itertools import permutations, product
from statistics import mean

import networkx as nx

from .domain import Assumptions, Intervention, State
from .simulation import find_options, simulate


def nominal(unknown: dict) -> Assumptions:
    return Assumptions(unknown=(unknown["low"] + unknown["high"]) / 2)


def plan_set(mode: str) -> dict[str, Intervention]:
    if mode == "flood":
        return {
            "PLAN 0 · NO ACTION": Intervention(),
            "PLAN A · PUMP": Intervention(pump=0.6),
            "PLAN B · BUFFER": Intervention(buffer="B6"),
            "PLAN C · BUFFER + PUMP": Intervention(pump=0.6, buffer="B6", gate_open=False),
        }
    return {
        "PLAN 0 · NO ACTION": Intervention(pump=1),
        "PLAN A · REDUCE PUMP": Intervention(pump=0.5),
        "PLAN B · SHED NONCRITICAL": Intervention(pump=1, noncritical_shed=0.25),
        "PLAN C · PRIORITY POWER": Intervention(pump=1, noncritical_shed=0.35, priority_power=True),
    }


def samples(unknown: dict) -> list[Assumptions]:
    return [
        Assumptions(rain_factor=r, pump_efficiency=e, unknown=u)
        for r, e, u in product((0.8, 0.9, 1, 1.1, 1.2), (0.9, 1.1), (unknown["low"], unknown["high"]))
    ]


def stress(state: State, p: Intervention, unknown: dict) -> dict:
    rows = []
    for a in samples(unknown):
        s = simulate(state, p, a)
        rows.append({
            "assumptions": a.model_dump(),
            "accepted": s["accepted"],
            "loss": s["loss"],
            "failed_constraints": [c["name"] for c in s["checks"] if not c["pass"]],
        })
    accepted = sum(r["accepted"] for r in rows)
    return {
        "acceptable": accepted,
        "total": len(rows),
        "fraction": accepted / len(rows),
        "mean_loss": mean(r["loss"] for r in rows),
        "worst": max(rows, key=lambda r: r["loss"]),
        "scenarios": rows,
        "method": "20 equally weighted deterministic stress cases; not probabilities",
    }


def information_value(stresses: dict[str, dict], mode: str) -> dict:
    names = list(stresses)
    n = len(stresses[names[0]]["scenarios"])
    baseline_name = min(names, key=lambda k: stresses[k]["mean_loss"])
    base = stresses[baseline_name]
    result = []
    labels = {
        "unknown": "C12 blockage" if mode == "flood" else "Transformer derating",
        "rain_factor": "Rainfall factor" if mode == "flood" else "Power demand factor",
        "pump_efficiency": "Pump efficiency",
    }
    for variable in ("unknown", "rain_factor", "pump_efficiency"):
        groups: dict[float, list[int]] = {}
        for i, r in enumerate(base["scenarios"]):
            groups.setdefault(r["assumptions"][variable], []).append(i)
        informed_loss = 0.0
        informed_safe = 0
        policies = []
        sensitivity_rows = {}
        for value, indexes in groups.items():
            sensitivity_rows[value] = sum(base["scenarios"][i]["accepted"] for i in indexes) / len(indexes)
        for value, indexes in groups.items():
            selected = min(names, key=lambda name: mean(
                stresses[name]["scenarios"][i]["loss"] for i in indexes))
            rows = [stresses[selected]["scenarios"][i] for i in indexes]
            informed_loss += sum(r["loss"] for r in rows) / n
            informed_safe += sum(r["accepted"] for r in rows)
            policies.append({"measurement": value, "conditional_plan": selected,
                             "cases": len(indexes)})
        result.append({
            "variable": labels[variable],
            "expected_loss_avoided": max(0, base["mean_loss"] - informed_loss),
            "adaptive_acceptance_fraction": informed_safe / n,
            "acceptance_change": informed_safe / n - base["fraction"],
            "baseline_plan_acceptance_by_value": [
                {"value": v, "acceptance_fraction": f} for v, f in sorted(sensitivity_rows.items())],
            "decision_sensitivity": max(sensitivity_rows.values()) - min(sensitivity_rows.values()),
            "conditional_policy": policies,
        })
    result.sort(key=lambda r: (r["expected_loss_avoided"], r["decision_sensitivity"]), reverse=True)
    return {
        "method": "Sample-based partial perfect-information value; equal weights are a "
                  "demo assumption, not forecast probabilities",
        "baseline_plan": baseline_name,
        "baseline_mean_loss": base["mean_loss"],
        "candidates": result,
        "highest_value": result[0]["variable"]
        if result[0]["expected_loss_avoided"] > 1e-9 or result[0]["decision_sensitivity"] > 1e-9 else None,
        "interpretation": "Expected loss avoided is the value of switching plans after learning a variable. "
                          "Decision sensitivity is how much the selected plan's acceptance depends on it, "
                          "so a variable can matter for the safety gate even if no plan switch is better.",
    }


def linchpins(system_graph: dict) -> list[dict]:
    g = nx.DiGraph()
    g.add_nodes_from(n["id"] for n in system_graph["nodes"])
    g.add_edges_from((e["source"], e["target"]) for e in system_graph["edges"])
    base_pairs = sum(len(nx.descendants(g, n)) for n in g)
    result = []
    for node in g:
        without = g.copy()
        without.remove_node(node)
        remaining = sum(len(nx.descendants(without, n)) for n in without)
        result.append({
            "node": node,
            "reachable_pairs_lost_on_removal": base_pairs - remaining,
            "downstream_nodes": sorted(nx.descendants(g, node)),
            "scope": "Structural dependency reachability, not a physical failure forecast",
        })
    return sorted(result, key=lambda x: x["reachable_pairs_lost_on_removal"], reverse=True)


def breakpoint(state: State, p: Intervention) -> dict:
    rows = []
    for i in range(0, 91):
        value = i / 100
        result = simulate(state, p, Assumptions(unknown=value))
        rows.append({"value": value, "accepted": result["accepted"],
                     "failures": [c["name"] for c in result["checks"] if not c["pass"]]})
    transitions = [
        {"from": rows[i - 1]["value"], "to": rows[i]["value"], "failures": rows[i]["failures"]}
        for i in range(1, len(rows)) if rows[i - 1]["accepted"] and not rows[i]["accepted"]
    ]
    return {
        "resolution": 0.01,
        "variable": "blockage" if state.mode == "flood" else "derating",
        "transitions": transitions,
        "rows": rows,
        "scope": "Grid transition intervals, not an exact continuous threshold",
    }


def recovery(state: State, p: Intervention, a: Assumptions) -> dict:
    current = state.model_copy(deep=True)
    current.rain_m3_min = 0
    trajectory = []
    recovered_at = None
    for hour in range(1, 25):
        result = simulate(current, p, a)
        current = State.model_validate(result["after"])
        current.rain_m3_min = 0
        good = result["accepted"]
        if current.mode == "flood":
            good = good and current.a_m3 <= 1000 and current.b_m3 <= 800
        if good and recovered_at is None:
            recovered_at = hour
        trajectory.append({"hour": hour, "constraints_met": result["accepted"],
                           "recovery_target_met": good, "metrics": result["metrics"]})
    return {
        "hazard_assumption": "Rain stops immediately; heat persists in heat mode",
        "horizon_hours": 24,
        "first_target_hour": recovered_at,
        "not_recovered_within_horizon": recovered_at is None,
        "trajectory": trajectory,
        "limitation": "No repair crews or calibrated asset repair curves",
    }


def sequences(state: State, a: Assumptions) -> list[dict]:
    if state.mode != "flood":
        return []
    results = []
    for order in permutations(("pump", "gate", "road")):
        current = state.model_copy(deep=True)
        p = Intervention(buffer="B6")
        steps = []
        for action in order:
            changes = {"pump": {"pump": 0.6}, "gate": {"gate_open": False},
                       "road": {"road_closed": True}}[action]
            p = Intervention.model_validate({**p.model_dump(), **changes})
            result = simulate(current, p, a, horizon=20)
            current = State.model_validate(result["after"])
            steps.append({"action": action, "after": result["after"],
                          "accepted": result["accepted"], "route": result["metrics"]["route"]})
        results.append({"sequence": list(order), "intermediate_states": steps,
                        "unsafe_intervals": sum(not x["accepted"] for x in steps),
                        "final_state": current.model_dump()})
    return results


def analyze(state: State, unknown: dict, system_graph: dict,
            custom: Intervention | None = None) -> dict:
    a = nominal(unknown)
    options = find_options(state, a)
    plans = plan_set(state.mode)
    if custom is not None:
        plans["HUMAN MODIFIED PLAN"] = custom

    simulations = {name: simulate(state, p, a) for name, p in plans.items()}
    stresses = {name: stress(state, p, unknown) for name, p in plans.items()}
    selected = "HUMAN MODIFIED PLAN" if custom is not None else min(
        plans, key=lambda name: stresses[name]["mean_loss"])
    p = plans[selected]
    chosen = simulations[selected]
    robust = stresses[selected]
    red = {
        "provider": "deterministic adversarial stress adapter",
        "challenged_plan": selected,
        "worst_tested_case": robust["worst"],
        "failure_conditions": robust["worst"]["failed_constraints"],
        "required_verification": unknown["name"],
        "limitations": "Only modeled variables were challenged. "
                       "Passing this test does not prove real-world safety.",
    }

    minimum = []
    for intensity in ((0.4, 0.5, 0.6, 0.8, 1) if state.mode == "heat" else (0.4, 0.6, 0.8, 1)):
        candidate = Intervention.model_validate({**p.model_dump(), "pump": intensity})
        tested = stress(state, candidate, unknown)
        minimum.append({"pump": intensity, "acceptable": tested["acceptable"],
                        "total": tested["total"],
                        "meets_95_percent_constraint": tested["fraction"] >= 0.95})

    gates = list(chosen["checks"])
    gates += [
        {"name": "Uncertainty verified",
         "pass": unknown["verified"] and unknown["high"] - unknown["low"] <= 0.08,
         "detail": f"Verify synthetic {unknown['name']}; remaining interval width must be at most 0.08"},
        {"name": "Robustness", "pass": robust["fraction"] >= 0.95,
         "detail": "At least 95% of enumerated stress cases must meet constraints"},
        {"name": "Red team", "pass": robust["fraction"] >= 0.95,
         "detail": "Modeled red-team failures must remain within robustness limit"},
    ]
    if p.buffer:
        feasible = next((o for o in options if o["id"] == p.buffer), None)
        gates.append({"name": "Buffer feasibility",
                      "pass": bool(feasible and feasible["status"] == "PASS"),
                      "detail": "Selected buffer must pass deterministic candidate checks"})

    return {
        "selected_plan": selected,
        "selection_method": "Lowest mean synthetic loss across 20 stress cases; "
                            "this is a proposal, not an automatic authorization",
        "intervention": p.model_dump(),
        "options": options,
        "no_feasible_buffer": state.mode == "flood" and not any(o["status"] == "PASS" for o in options),
        "plans": simulations,
        "simulation": chosen,
        "robustness": stresses,
        "red_team": red,
        "voi": information_value(stresses, state.mode),
        "minimum_intervention": {
            "trials": minimum,
            "minimum_modeled_pump": next((r["pump"] for r in minimum if r["meets_95_percent_constraint"]), None),
        },
        "breakpoint": breakpoint(state, p),
        "linchpins": linchpins(system_graph),
        "chronos": sequences(state, a),
        "recovery": recovery(State.model_validate(chosen["after"]), p, a),
        "model_doubt": {
            "confidence": "UNCALIBRATED SYNTHETIC MODEL",
            "missing": [] if unknown["verified"] else [unknown["name"]],
            "uncertainty_interval": [unknown["low"], unknown["high"]],
            "assumptions": [
                "Lumped-volume model, not spatial fluid dynamics",
                "Synthetic capacities, populations and road thresholds",
                "Equal-weight stress grid is not a forecast distribution",
                "B5 corridor coupling is a synthetic linear depth proxy",
                "Economic coefficients are synthetic estimates",
            ],
        },
        "safety": {"allowed": all(c["pass"] for c in gates), "checks": gates,
                   "scope": "SIMULATION AUTHORIZATION ONLY"},
    }
