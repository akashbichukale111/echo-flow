from .engines import WaterBufferEngine
from .models import Record, Zone, now

LABEL_SOURCE_TYPE = {
    "REAL PUBLIC DATA": "PUBLIC DATA",
    "REAL GOVERNMENT BASELINE": "PUBLIC DATA",
    "DERIVED MODEL INPUT": "DERIVED MODEL INPUT",
    "SIMULATED OPERATIONAL DATA": "SIMULATED OPERATIONAL DATA",
    "DEMO DATA": "DEMO DATA",
    "OPERATOR INPUT": "OPERATOR INPUT",
    "MODEL OUTPUT": "MODEL OUTPUT",
    "AI RECOMMENDATION": "AI RECOMMENDATION",
}
LABEL_CONFIDENCE = {
    "REAL PUBLIC DATA": "MEDIUM", "REAL GOVERNMENT BASELINE": "MEDIUM",
    "OPERATOR INPUT": "MEDIUM",
}


def field_label(zone: Zone, field: str) -> str:
    """Honesty label of one zone input; unlabelled fields are operator-entered
    (or inherit the zone provenance label for seeded zones)."""
    return zone.field_labels.get(field) or (
        "DEMO DATA" if zone.provenance.source_type == "DEMO DATA"
        else "OPERATOR INPUT")


def _telemetry_records(context: dict | None) -> list[dict]:
    """Real public-data evidence found near the zone (never zone telemetry)."""
    if not context:
        return []
    records: list[dict] = []

    def add(obs: dict, influence: str, distance: float | None = None):
        where = obs.get("station_name", "")
        if distance is not None:
            where += f" ({distance} km from zone)"
        records.append(Record(
            source=f"{obs['source']} — {obs['parameter']} [{obs['freshness']['status']}]",
            source_type="PUBLIC DATA", timestamp=obs["timestamp"],
            confidence=obs.get("confidence", "MEDIUM"), location=where,
            value=obs["value"], unit=obs["unit"], influence=influence,
            data_label="REAL PUBLIC DATA").model_dump())

    groundwater = context.get("groundwater", {})
    for station in (groundwater.get("stations") or [])[:2]:
        add(station, "Contextual only; groundwater level is not tank storage",
            station.get("distance_km"))
    scada = context.get("scada", {})
    if scada.get("status") == "OK":
        wanted = {"Cumulative Gate Discharge", "Downstream Discharge (Canal)",
                  "Inflow Discharge", "Pond Level"}
        for obs in scada["latest"]:
            if obs["parameter"] in wanted and obs["unit"] in {"cusec", "m"}:
                add(obs, "Nearby upstream context; levels are not storage",
                    scada["station"].get("distance_km"))
    discharge = context.get("discharge", {})
    if discharge.get("status") == "OK":
        add(discharge["latest"], "Nearby gate-discharge context (derived gate sum)",
            discharge.get("distance_km"))
    baseline = context.get("supply_baseline", {})
    scheme = baseline.get("linked_scheme")
    if scheme:
        for field, label in (("capacity_mld", "Plant capacity"),
                             ("utilisation_mld", "Present utilisation"),
                             ("industrial_mld", "Industrial supply"),
                             ("domestic_mld", "Domestic supply")):
            if scheme.get(field) is not None:
                records.append(Record(
                    source=f"{scheme['source']} — {label}", source_type="PUBLIC DATA",
                    timestamp="baseline (no observation date)", confidence="MEDIUM",
                    location=f"{scheme['scheme']} (placement approximate)",
                    value=scheme[field], unit="MLD",
                    influence="Baseline supply context; not live telemetry",
                    data_label="REAL GOVERNMENT BASELINE").model_dump())
    return records


def evidence_for(zone: Zone, environmental: dict, model: dict,
                 data_context: dict | None = None) -> list[dict]:
    fields = [
        ("storage_l", "L", "Starting gross storage"),
        ("reserve_l", "L", "Configured shortage threshold"),
        ("demand_lpd", "L/day", "Delivered demand determines gross withdrawal"),
        ("supply_lpd", "L/day", "Offsets storage drawdown"),
        ("loss_pct", "%", "Converts delivered demand into gross withdrawal"),
        ("demand_trend_pct", "%", "Contextual heuristic risk factor"),
        ("supply_trend_pct", "%", "Contextual heuristic risk factor"),
        ("observed_anomaly", "flag", "Field-verification signal, not leak proof"),
    ]
    records = []
    for field, unit, influence in fields:
        label = field_label(zone, field)
        records.append(Record(
            source=f"{zone.provenance.source}: {field}",
            source_type=LABEL_SOURCE_TYPE.get(label, zone.provenance.source_type),
            timestamp=zone.provenance.timestamp,
            confidence=LABEL_CONFIDENCE.get(label, "LOW"),
            location=zone.location, value=getattr(zone, field), unit=unit,
            influence=influence, data_label=label
        ).model_dump())
    records.extend(environmental[key] for key in (
        "weather", "rainfall", "groundwater"
    ))
    records.extend(_telemetry_records(data_context))
    records.append(Record(
        source=model["model_version"], source_type="MODEL OUTPUT",
        timestamp=now(), confidence=model["confidence"],
        location=zone.location,
        value=model["buffer_days"] if model["buffer_days"] is not None
              else "No depletion under constant inputs",
        unit="days to reserve",
        influence="Scenario comparison and operational action window",
        data_label="MODEL OUTPUT"
    ).model_dump())
    return records


def input_composition(zone: Zone) -> list[dict]:
    """How much of the model input is real, derived or simulated."""
    names = {
        "storage_l": "Storage", "reserve_l": "Reserve threshold",
        "demand_lpd": "Delivered demand", "supply_lpd": "Incoming supply",
        "loss_pct": "NRW / loss", "distance_km": "Tanker distance",
        "available_tankers": "Tanker fleet",
    }
    return [{"field": f, "name": n, "label": field_label(zone, f),
             "value": getattr(zone, f)} for f, n in names.items()]

class WaterWatcher:
    @staticmethod
    def observe(zone: Zone) -> dict:
        return WaterBufferEngine.calculate(zone)

class CauseAgent:
    @staticmethod
    def diagnose(zone: Zone, model: dict) -> dict:
        drain = model["net_drawdown_lpd"]
        return {
            "primary_driver": (
                "Supply/demand imbalance" if drain > 0
                else "Supply meets estimated gross withdrawal"
            ),
            "summary": (
                f"Gross withdrawal is {model['gross_withdrawal_lpd']:,.0f} L/day; "
                f"incoming supply is {zone.supply_lpd:,.0f} L/day. "
                f"Estimated net drawdown is {drain:,.0f} L/day."
            ),
            "secondary_signal": (
                "Suspected water-loss anomaly; field verification required"
                if zone.observed_anomaly else
                "No anomaly observation has been entered"
            ),
            "source_type": "MODEL OUTPUT"
        }

    @staticmethod
    def causes(zone: Zone, model: dict, environment: dict,
               data_context: dict | None = None) -> list[dict]:
        """3-5 evidence-linked contributors. Drivers come from the
        deterministic balance; context signals are explicitly non-causal."""
        out: list[dict] = []
        supply_label = field_label(zone, "supply_lpd")
        loss_label = field_label(zone, "loss_pct")
        gap = zone.demand_lpd - zone.supply_lpd
        if gap > 0:
            out.append({
                "id": "supply-shortfall", "kind": "DRIVER",
                "title": "Incoming supply is below delivered demand",
                "detail": (f"Supply {zone.supply_lpd:,.0f} L/day vs demand "
                           f"{zone.demand_lpd:,.0f} L/day: shortfall {gap:,.0f} L/day "
                           f"({100 * gap / zone.demand_lpd:.0f}% of demand)."),
                "label": supply_label,
                "evidence": ["supply_lpd", "demand_lpd"]})
        loss_l = model["estimated_loss_lpd"]
        if loss_l > 0:
            out.append({
                "id": "loss-uplift", "kind": "DRIVER",
                "title": "Losses raise gross withdrawal above delivered demand",
                "detail": (f"At {zone.loss_pct:g}% loss, gross withdrawal is "
                           f"{model['gross_withdrawal_lpd']:,.0f} L/day — "
                           f"{loss_l:,.0f} L/day more than delivered demand."),
                "label": loss_label, "evidence": ["loss_pct", "demand_lpd"]})
        if model["net_drawdown_lpd"] > 0:
            out.append({
                "id": "net-drawdown", "kind": "DRIVER",
                "title": "Net drawdown is consuming usable storage",
                "detail": (f"Net drawdown {model['net_drawdown_lpd']:,.0f} L/day against "
                           f"usable storage above reserve of "
                           f"{max(0, zone.storage_l - zone.reserve_l):,.0f} L."),
                "label": "MODEL OUTPUT", "evidence": ["storage_l", "reserve_l"]})
        if zone.observed_anomaly:
            out.append({
                "id": "suspected-loss", "kind": "CONTEXT",
                "title": "Suspected water-loss anomaly flagged (unverified)",
                "detail": "An operator anomaly flag is set. Field verification is "
                          "required; no leak location or size is claimed.",
                "label": field_label(zone, "observed_anomaly"),
                "evidence": ["observed_anomaly"]})
        context = data_context or {}
        scheme = (context.get("supply_baseline") or {}).get("linked_scheme")
        if scheme and scheme.get("utilisation_pct") is not None:
            out.append({
                "id": "plant-headroom", "kind": "CONTEXT",
                "title": "Plant capacity headroom (government baseline)",
                "detail": (f"{scheme['scheme']} reports {scheme['utilisation_mld']:g} of "
                           f"{scheme['capacity_mld']:g} MLD in use "
                           f"({scheme['utilisation_pct']:g}%); spare capacity "
                           f"{scheme['spare_capacity_mld']:g} MLD. Baseline, not live."),
                "label": "REAL GOVERNMENT BASELINE", "evidence": ["MIDC baseline"]})
        scada = context.get("scada") or {}
        if scada.get("status") == "OK":
            canal = next((o for o in scada["latest"]
                          if o["parameter"] == "Cumulative Gate Discharge"
                          and o["unit"] == "cusec"), None)
            if canal:
                out.append({
                    "id": "nearby-canal", "kind": "CONTEXT",
                    "title": "Nearby canal release observed upstream (context only)",
                    "detail": (f"{canal['station_name']} ({scada['station']['distance_km']} km): "
                               f"cumulative gate discharge {canal['value']:,.0f} cusec at "
                               f"{canal['freshness']['age_label']} — {canal['freshness']['status']}. "
                               "Not proof of this zone's source condition."),
                    "label": "REAL PUBLIC DATA", "evidence": ["SCADA"]})
        groundwater = context.get("groundwater") or {}
        if groundwater.get("status") == "OK":
            lead = groundwater["stations"][0]
            trend = groundwater.get("trend") or {}
            change = (f"; change over {trend['span_days']:g} d: {trend['change']:+.2f} m "
                      "(as published; direction not interpreted)"
                      if trend.get("status") == "OK" else "")
            out.append({
                "id": "nearby-groundwater", "kind": "CONTEXT",
                "title": "Nearby groundwater telemetry (context only)",
                "detail": (f"{lead['station_name']} ({lead['distance_km']} km): "
                           f"{lead['value']:g} m, {lead['freshness']['age_label']} — "
                           f"{lead['freshness']['status']}{change}."),
                "label": "REAL PUBLIC DATA", "evidence": ["Delhi groundwater"]})
        rain = environment.get("rainfall", {})
        if rain.get("value") == "LOW":
            out.append({
                "id": "low-rain", "kind": "CONTEXT",
                "title": "Little rain forecast over the next 3 days",
                "detail": "Forecast precipitation is below 2 mm. Rain is not added to storage.",
                "label": "DERIVED MODEL INPUT", "evidence": ["WeatherAPI forecast"]})
        drivers = [c for c in out if c["kind"] == "DRIVER"]
        priority = ["nearby-canal", "plant-headroom", "nearby-groundwater",
                    "suspected-loss", "low-rain"]
        contexts = sorted((c for c in out if c["kind"] == "CONTEXT"),
                          key=lambda c: priority.index(c["id"]))
        ranked = (drivers + contexts)[:5]
        for index, cause in enumerate(ranked, start=1):
            cause["rank"] = index
        return ranked


class LossAnalyzer:
    @staticmethod
    def analyze(zone: Zone) -> list[dict]:
        if not zone.observed_anomaly:
            return []
        return [{
            "id": f"anomaly-{zone.id}",
            "location": zone.location,
            "latitude": zone.latitude, "longitude": zone.longitude,
            "severity": "INVESTIGATE",
            "title": "Suspected Water-Loss Anomaly",
            "confidence": "LOW",
            "timestamp": zone.provenance.timestamp,
            "source_type": zone.provenance.source_type,
            "supporting_signals": [
                "Anomaly flag in zone operational record",
                f"Entered distribution loss estimate: {zone.loss_pct}%"
            ],
            "recommended_verification": (
                "Check meter calibration and time alignment; compare inlet "
                "and outlet balances; inspect pressure and visible losses. "
                "No exact leak location or sensor-derived confidence is claimed."
            )
        }]

class Validator:
    @staticmethod
    def validate(zone: Zone, scenarios: list[dict]) -> dict:
        return {
            "valid": True,
            "confidence": "LOW",
            "missing_information": [
                "Calibrated interval meter readings",
                "Hydraulic connectivity and pressure constraints",
                "Source water quality and tanker loading availability",
                "Repair feasibility, costs and crew availability",
                "Verified recipient/donor transfer permissions"
            ],
            "checks": {
                "input_validation": True,
                "provenance_present": bool(zone.provenance.source),
                "reserve_configured": zone.reserve_l >= 0,
                "scenario_constraints_evaluated": len(scenarios) == 4
            }
        }

class WhatIfAgent:
    @staticmethod
    def rank(scenarios: list[dict]) -> dict:
        candidates = [s for s in scenarios if s["feasible"]]
        return max(
            candidates,
            key=lambda s: float("inf") if s["buffer_days"] is None
            else s["buffer_days"]
        )

class ActionPlanner:
    @staticmethod
    def plan(zone: Zone, scenarios: list[dict],
             evidence: list[dict], validator: dict) -> dict:
        best = WhatIfAgent.rank(scenarios)
        return {
            "scenario": best["id"],
            "title": f"Investigate: {best['name'].lower()}",
            "reasoning_summary": (
                "Ranked by estimated recipient-zone time to reserve among "
                "scenarios passing model constraints. Cost, water quality and "
                "hydraulic feasibility are not optimized."
            ),
            "expected_impact_days": best["impact_days"],
            "evidence_count": len(evidence),
            "confidence": "LOW",
            "source_type": "MODEL OUTPUT",
            "source": "Deterministic action planner; LLM not required",
            "assumptions": best["assumptions"],
            "missing_information": validator["missing_information"],
            "recommended_human_verification": [
                "Validate operational inputs and reserve threshold.",
                "Inspect the suspected loss area before assuming repair savings.",
                "Confirm safety, source quality, permissions and resources.",
                "Approve a plan explicitly; record execution separately."
            ],
            "approval_state": "NOT APPROVED"
        }

class VerificationAgent:
    @staticmethod
    def summarize(result: dict, simulated: bool) -> str:
        return (
            ("SIMULATED VERIFICATION. " if simulated else
             "OPERATOR-ENTERED VERIFICATION. ")
            + result["interpretation"]
        )
