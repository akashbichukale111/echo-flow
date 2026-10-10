import math

from .models import ScenarioInput, Zone

MODEL_VERSION = "water-balance-v1.0"

ASSUMPTIONS = [
    "Storage, incoming supply and reserve are gross liters.",
    "Demand is delivered consumer demand; loss applies to gross withdrawals.",
    "Gross withdrawal = delivered demand / (1 - loss fraction).",
    "Reserve is a fixed operator-configured volume, not a physical forecast.",
    "Demand, supply and loss remain constant between explicit scenario events.",
    "Rainfall and groundwater context do not add unmeasured water to storage.",
    "No storage-capacity, pressure, water-quality or hydraulic network model.",
    "Scenario impacts are conditional estimates, not guaranteed outcomes."
]

class WaterBufferEngine:
    @staticmethod
    def calculate(zone: Zone) -> dict:
        withdrawal = zone.demand_lpd / (1 - zone.loss_pct / 100)
        drain = withdrawal - zone.supply_lpd
        available = max(0.0, zone.storage_l - zone.reserve_l)
        days = 0.0 if available == 0 else (
            available / drain if drain > 0 else None
        )
        return {
            "model_version": MODEL_VERSION,
            "gross_withdrawal_lpd": withdrawal,
            "net_drawdown_lpd": drain,
            "estimated_loss_lpd": withdrawal - zone.demand_lpd,
            "usable_delivered_l": available * (1 - zone.loss_pct / 100),
            "storage_only_days": available * (1 - zone.loss_pct / 100)
                                 / zone.demand_lpd,
            "buffer_days": days,
            "reserve_l": zone.reserve_l,
            "confidence": "MEDIUM" if zone.provenance.confidence == "HIGH"
                          else "LOW",
            "assumptions": ASSUMPTIONS,
        }

class ShortageClockEngine:
    @staticmethod
    def calculate(days: float | None) -> dict:
        if days is None:
            return {
                "days": None, "hours": None,
                "action_window_hours": None,
                "label": "No depletion under constant-input assumptions"
            }
        hours = max(0, math.floor(days * 24))
        return {
            "days": hours // 24,
            "hours": hours % 24,
            "action_window_hours": max(0, hours - 24),
            "label": "Estimated time to configured reserve"
        }

class RiskEngine:
    @staticmethod
    def calculate(zone: Zone, buffer_days: float | None,
                  rainfall: str = "UNKNOWN",
                  groundwater: str = "UNKNOWN") -> dict:
        d = 1000 if buffer_days is None else buffer_days
        base = 75 if d < 1 else 55 if d < 3 else 35 if d < 7 else 10
        factors = {
            "buffer": base,
            "demand_trend": min(10, max(0, zone.demand_trend_pct) / 2),
            "supply_trend": min(10, max(0, -zone.supply_trend_pct) / 2),
            "loss": min(12, zone.loss_pct / 2),
            "rainfall_context": 4 if rainfall == "LOW" else 0,
            "groundwater_context": 4 if groundwater == "DECLINING" else 0,
            "criticality": (zone.criticality - 1) * 2,
        }
        score = min(100, round(sum(factors.values())))
        level = (
            "CRITICAL" if score >= 75 else
            "SHORTAGE APPROACHING" if score >= 50 else
            "WATCH" if score >= 30 else "STABLE"
        )
        return {
            "score": score, "level": level, "factors": factors,
            "label": "MODEL RISK ESTIMATE",
            "assumptions": [
                "Heuristic thresholds; not scientifically validated.",
                "Trend percentages are contextual inputs, not compounded.",
                "Missing environmental signals add no score and reduce context."
            ]
        }

class LossImpactEngine:
    @staticmethod
    def calculate(zone: Zone, reduction_pp: float) -> dict:
        new_loss = max(0, zone.loss_pct - reduction_pp)
        before = zone.demand_lpd / (1 - zone.loss_pct / 100)
        after = zone.demand_lpd / (1 - new_loss / 100)
        return {
            "new_loss_pct": new_loss,
            "avoided_withdrawal_lpd": before - after,
            "field_verification_required": True
        }

class TankerCapacityEngine:
    @staticmethod
    def calculate(zone: Zone, required_water_l: float,
                  operating_hours: float = 12) -> dict:
        travel = zone.distance_km / zone.speed_kph
        first_hours = (
            zone.refill_minutes / 60 + travel + zone.unload_minutes / 60
        )
        cycle = (
            zone.refill_minutes / 60 + 2 * travel
            + zone.unload_minutes / 60
        )
        per_tanker = (
            0 if operating_hours < first_hours
            else 1 + math.floor((operating_hours - first_hours) / cycle)
        )
        max_trips = zone.available_tankers * per_tanker
        trips = math.ceil(required_water_l / zone.tanker_capacity_l)
        return {
            "required_trips": trips,
            "available_tankers": zone.available_tankers,
            "first_delivery_hours": first_hours,
            "cycle_hours": cycle,
            "maximum_trips_in_window": max_trips,
            "delivery_capacity_l": max_trips * zone.tanker_capacity_l,
            "feasible_in_window": trips <= max_trips,
            "estimated_completion_hours": (
                first_hours + (
                    math.ceil(trips / zone.available_tankers) - 1
                ) * cycle if zone.available_tankers else None
            ),
            "assumptions": [
                "Tankers start empty and refill at a common source.",
                "Constant speed; no live traffic, queues or road routing.",
                "Source water availability and quality require approval.",
                "No live tanker telemetry is connected."
            ]
        }

def project(zone: Zone, events: list[dict], horizon: int = 30) -> dict:
    schedule: dict[float, list[dict]] = {}
    for event in events:
        schedule.setdefault(float(event["day"]), []).append(event)
    times = sorted({0.0, *range(1, horizon + 1), *schedule})
    storage = zone.storage_l
    loss = zone.loss_pct
    previous = 0.0
    first_shortage = 0.0 if storage <= zone.reserve_l else None
    points = []
    for day in times:
        drain = zone.demand_lpd / (1 - loss / 100) - zone.supply_lpd
        if first_shortage is None and drain > 0:
            crossing = previous + (storage - zone.reserve_l) / drain
            if crossing <= day:
                first_shortage = max(previous, crossing)
        storage = max(0, storage - drain * (day - previous))
        if day in schedule and day <= horizon:
            points.append({"day": day, "storage_l": storage})
        for event in schedule.get(day, []):
            storage += event.get("liters", 0)
            if "loss_pct" in event:
                loss = event["loss_pct"]
        if day <= horizon:
            points.append({"day": day, "storage_l": storage})
        previous = day
    drain = zone.demand_lpd / (1 - loss / 100) - zone.supply_lpd
    if first_shortage is None and drain > 0:
        first_shortage = previous + max(0, storage - zone.reserve_l) / drain
    return {
        "buffer_days": first_shortage,
        "projection": points,
        "horizon_days": horizon
    }

class ScenarioEngine:
    @staticmethod
    def compare(zone: Zone, zones: list[Zone],
                parameters: ScenarioInput) -> list[dict]:
        baseline = WaterBufferEngine.calculate(zone)["buffer_days"]
        tanker = TankerCapacityEngine.calculate(
            zone, max(1, zone.tanker_capacity_l
                      * zone.available_tankers
                      * parameters.trips_per_tanker), 72
        )
        tanker_events = [
            {
                "day": (
                    tanker["first_delivery_hours"]
                    + i * tanker["cycle_hours"]
                ) / 24,
                "liters": zone.available_tankers * zone.tanker_capacity_l
            }
            for i in range(parameters.trips_per_tanker)
            if zone.available_tankers > 0
        ]
        loss = LossImpactEngine.calculate(zone, parameters.loss_reduction_pp)
        donors = [z for z in zones if z.id != zone.id]
        donor = next(
            (z for z in donors if z.id == parameters.donor_zone_id), None
        )
        if parameters.donor_zone_id is None and donors:
            donor = max(donors, key=lambda z: z.storage_l - z.reserve_l)
        donor_buffer = None
        transfer_ok = False
        if donor:
            donor_after = donor.model_copy(
                update={"storage_l": donor.storage_l
                        - parameters.redistribution_l}
            )
            donor_buffer = WaterBufferEngine.calculate(
                donor_after
            )["buffer_days"]
            transfer_ok = (
                donor_after.storage_l >= donor.reserve_l
                and (donor_buffer is None
                     or donor_buffer >= parameters.donor_min_buffer_days)
            )
        descriptions = [
            ("no_action", "No action", [], True,
             "No additional resources", []),
            ("tanker", "Tanker deployment", tanker_events,
             bool(tanker_events),
             f"{zone.available_tankers * parameters.trips_per_tanker} trips",
             [] if tanker_events else ["No tanker deliveries configured"]),
            ("loss", "Loss intervention", [{
                "day": parameters.intervention_delay_hours / 24,
                "loss_pct": loss["new_loss_pct"]
             }], loss["new_loss_pct"] < zone.loss_pct,
             "Field inspection and repair team; costs not supplied",
             [] if loss["new_loss_pct"] < zone.loss_pct
             else ["No loss reduction configured"]),
            ("redistribution", "Water redistribution",
             [{"day": 2 / 24, "liters": parameters.redistribution_l}]
             if transfer_ok else [],
             transfer_ok and parameters.redistribution_l > 0,
             (f"{parameters.redistribution_l:,.0f} L from "
              f"{donor.name if donor else 'unavailable donor'}"),
             [] if transfer_ok else [
                 "Donor reserve or minimum-buffer constraint failed"
             ]),
        ]
        results = []
        for key, name, events, feasible, resources, constraints in descriptions:
            outcome = project(zone, events)
            days = outcome["buffer_days"]
            gain = (
                days - baseline
                if days is not None and baseline is not None else None
            )
            results.append({
                "id": key, "name": name, **outcome,
                "impact_days": gain, "feasible": feasible,
                "resources": resources, "constraints": constraints,
                "confidence": "LOW",
                "source_type": "MODEL OUTPUT",
                "assumptions": ASSUMPTIONS + [
                    "First reserve crossing is retained even if water arrives later.",
                    "Redistribution arrives after an assumed two hours.",
                    "Repair effectiveness and timing require field validation."
                ],
                "donor_zone_id": donor.id if key == "redistribution"
                                and donor else None,
                "donor_buffer_days": donor_buffer
                                     if key == "redistribution" else None
            })
        return results

class VerificationEngine:
    @staticmethod
    def compare(before: Zone, after: Zone,
                expected_days: float | None) -> dict:
        previous = WaterBufferEngine.calculate(before)
        current = WaterBufferEngine.calculate(after)
        a, b = previous["buffer_days"], current["buffer_days"]
        return {
            "before_buffer_days": a,
            "after_buffer_days": b,
            "change_days": b - a if a is not None and b is not None else None,
            "expected_buffer_days_at_plan_time": expected_days,
            "before_loss_pct": before.loss_pct,
            "after_loss_pct": after.loss_pct,
            "before_risk": RiskEngine.calculate(before, a),
            "after_risk": RiskEngine.calculate(after, b),
            "before_anomaly": before.observed_anomaly,
            "after_anomaly": after.observed_anomaly,
            "interpretation": (
                "Before/after model comparison using entered observations. "
                "Different observation times and conditions prevent causal "
                "attribution. Plan-time buffer is not a time-aligned forecast."
            )
        }
