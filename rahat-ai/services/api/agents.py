import math
import time

from models import PlanRequest

STAGES = ("scanner", "route", "relief", "validator", "advisor", "reassessment")

def deterministic_explanation(routes):
    fastest, safer, _ = routes
    if safer["load"] < fastest["load"] - 1e-8:
        return (
            "The thermal-safe candidate has lower model-estimated environmental "
            "exposure within the permitted travel-time detour. Shade and direct "
            "solar exposure are evaluated on the synthetic street geometry. "
            "This is a route comparison, not a guarantee of safety."
        )
    return (
        "The current constraints do not produce a lower-exposure thermal-safe "
        "candidate. Alternatives may share the same geometry. Increasing the "
        "detour allowance or changing departure time can change the result."
    )

def run_stage(stage, context, engine):
    started = time.perf_counter()
    q = PlanRequest(**context["request"])
    if stage == "scanner":
        context.update(engine.scan(q))
    elif stage == "route":
        context["routes"] = engine.routes(q, context)
    elif stage == "relief":
        context["relief"] = engine.relief(q, q.origin, scan=context)
    elif stage == "validator":
        for route in context["routes"]:
            if not route["segments"]:
                raise ValueError("Validator rejected an empty route")
            for key in ("distance", "minutes", "load", "shade"):
                if not math.isfinite(route[key]) or route[key] < 0:
                    raise ValueError("Validator rejected non-finite or negative metrics")
            if not 0 <= route["shade"] <= 1:
                raise ValueError("Validator rejected an invalid shade ratio")
            if abs(sum(route["breakdown"].values()) - route["load"]) > 1e-6:
                raise ValueError("Exposure explanation does not reconcile")
        context["validated"] = True
    elif stage == "advisor":
        if not context.get("validated"):
            raise ValueError("Advisor requires validated engine output")
        context["advisor"] = deterministic_explanation(context["routes"])
    elif stage == "reassessment":
        context["reassessment"] = {
            "rest_interval_exceeded": any(
                r["rest_interval_exceeded"] for r in context["routes"]
            ),
            "triggers": [
                "Departure-time change", "Traffic-delay change",
                "Shade change", "Relief closure", "User relief request",
            ],
            "policy": "Recompute a proposal; apply only after user confirmation",
        }
    else:
        raise ValueError("Unknown agent stage")
    context.setdefault("trace", []).append({
        "agent": stage, "status": "completed",
        "duration_ms": round((time.perf_counter() - started) * 1000, 3),
    })
    return context

def orchestrate(q, engine):
    context = {"request": q.model_dump(mode="json"), "trace": []}
    for stage in STAGES:
        run_stage(stage, context, engine)
    context["evidence"] = [
        {
            "source": "DEMO DATA",
            "timestamp": q.departure.isoformat(),
            "coverage": "Synthetic Hinjewadi-positioned demonstration network",
            "confidence": "Not field verified",
            "limitations": "No live weather, surveyed buildings, or verified relief availability",
        },
        {
            "source": "MODEL ESTIMATE",
            "timestamp": q.departure.isoformat(),
            "coverage": "All generated route segments",
            "confidence": "Uncalibrated",
            "limitations": (
                "Departure-time snapshot; approximate sun; sampled shadows; "
                "illustrative environmental exposure units, not health predictions"
            ),
        },
        {
            "source": "PUBLIC SATELLITE DATA",
            "timestamp": None,
            "coverage": "DATA UNAVAILABLE",
            "confidence": "Unavailable",
            "limitations": engine.providers.satellite.get()["limitations"],
        },
    ]
    return context
