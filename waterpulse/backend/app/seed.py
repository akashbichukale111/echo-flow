"""Seed workspaces.

demo  : the original offline demonstration zones (every field DEMO DATA).
pilot : zones anchored to the supplied public datasets. Where the datasets
        provide a value (MIDC plant utilisation) it is used and labelled
        REAL GOVERNMENT BASELINE. Everything the datasets cannot provide
        (storage, reserve, loss, source curtailment, tanker fleet) is an
        explicitly labelled SIMULATED OPERATIONAL DATA assumption.
"""
from .data_sources import registry
from .data_sources.base import DataUnavailable, haversine_km
from .data_sources.midc import MLD_TO_LPD
from .models import LABELLED_FIELDS, Record, Zone, now

WORKSPACES = ("demo", "pilot")


def _labels(**overrides: str) -> dict[str, str]:
    base = {name: "DEMO DATA" for name in LABELLED_FIELDS}
    base.update(overrides)
    return base


def _demo_zones() -> list[dict]:
    timestamp = now()
    specifications = [
        ("ward-12", "Demo Ward 12", 2_400_000, 620_000, 500_000, 8, True),
        ("zone-02", "Demo Zone 02", 1_200_000, 450_000, 280_000, 10, False),
        ("zone-03", "Demo Zone 03", 650_000, 500_000, 260_000, 14, False),
        ("zone-04", "Demo Zone 04", 210_000, 420_000, 150_000, 18, False),
    ]
    zones = []
    for index, (ident, name, storage, demand, supply, loss, anomaly) in enumerate(
        specifications
    ):
        zone = Zone(
            id=ident, version=1, name=name,
            location="Pune / illustrative demonstration locality",
            latitude=18.52 + (index // 2) * 0.018,
            longitude=73.84 + (index % 2) * 0.023,
            storage_l=storage, demand_lpd=demand, supply_lpd=supply,
            loss_pct=loss, reserve_l=240_000 if index == 0 else 100_000,
            tanker_capacity_l=10_000, available_tankers=3,
            refill_minutes=30, distance_km=8, speed_kph=25,
            unload_minutes=20, demand_trend_pct=14,
            supply_trend_pct=-8, criticality=3,
            observed_anomaly=anomaly,
            priority_facilities="No verified facility geometry supplied",
            notes="Synthetic inputs and illustrative zone geometry.",
            field_labels=_labels(),
            provenance=Record(
                source="Waterpulse versioned demo seed",
                source_type="DEMO DATA", timestamp=timestamp,
                confidence="LOW", location="Pune demonstration",
                value="Synthetic operational zone", unit="record",
                influence="Demonstration only; not municipal measurements",
                data_label="DEMO DATA",
            )
        )
        zones.append(zone.model_dump())
    return zones


# (id, display name, MIDC Sl. No. or None, curtailment %, storage days,
#  reserve days, loss %, tankers, tanker litres, anomaly flag)
_PILOT = [
    ("pilot-indapur", "Indapur MIDC supply zone", 25, 30, 1.5, 0.5, 12, 12, 12_000, True),
    ("pilot-sangli", "Sangli-Miraj Industrial supply zone", 29, 5, 1.4, 0.5, 9, 8, 12_000, False),
    ("pilot-baramati", "Baramati MIDC supply zone", 23, 0, 2.0, 0.5, 5, 10, 12_000, False),
]
_TANKER_MIN_SPARE_MLD = 2.0


def _tanker_source(zone_lat: float, zone_lon: float, exclude: int):
    """Nearest placed MIDC scheme with spare plant capacity (derived from the
    baseline). Placement is approximate; the name says so."""
    try:
        schemes = registry.get("water_supply").schemes(placed_only=True, limit=500)
    except DataUnavailable:
        return None
    pool = [s for s in schemes if s["sl_no"] != exclude
            and (s["spare_capacity_mld"] or 0) >= _TANKER_MIN_SPARE_MLD]
    if not pool:
        return None
    best = min(pool, key=lambda s: haversine_km(
        zone_lat, zone_lon, s["latitude"], s["longitude"]))
    return best


def _pilot_zones() -> list[dict]:
    timestamp = now()
    zones = []
    try:
        provider = registry.get("water_supply")
    except DataUnavailable:
        provider = None
    for (ident, name, sl, curtail, storage_days, reserve_days, loss,
         tankers, tanker_l, anomaly) in _PILOT:
        scheme = provider.get(sl) if provider else None
        if scheme is None or scheme["utilisation_mld"] is None \
                or scheme["latitude"] is None:
            continue  # never invent a baseline that the dataset cannot supply
        demand = scheme["utilisation_mld"] * MLD_TO_LPD
        supply = demand * (1 - curtail / 100)
        source = _tanker_source(scheme["latitude"], scheme["longitude"], sl)
        distance = (round(haversine_km(
            scheme["latitude"], scheme["longitude"],
            source["latitude"], source["longitude"]), 1) if source else 10.0)
        labels = _labels()
        labels.update({k: "SIMULATED OPERATIONAL DATA" for k in LABELLED_FIELDS})
        labels.update({
            "demand_lpd": "REAL GOVERNMENT BASELINE",
            "distance_km": "DERIVED MODEL INPUT" if source else "SIMULATED OPERATIONAL DATA",
        })
        if curtail == 0:
            labels["supply_lpd"] = "REAL GOVERNMENT BASELINE"
        zone = Zone(
            id=ident, version=1, name=name,
            location=f"{scheme['scheme']} — approximate town centroid, Maharashtra",
            latitude=scheme["latitude"], longitude=scheme["longitude"],
            demand_lpd=demand, supply_lpd=supply,
            storage_l=demand * storage_days, reserve_l=demand * reserve_days,
            loss_pct=loss, tanker_capacity_l=tanker_l, available_tankers=tankers,
            refill_minutes=30, distance_km=distance, speed_kph=30, unload_minutes=25,
            demand_trend_pct=6, supply_trend_pct=-10 if curtail else 0, criticality=3,
            observed_anomaly=anomaly,
            priority_facilities="No verified facility geometry supplied",
            notes=(
                f"Baseline: MIDC present utilisation {scheme['utilisation_mld']:g} MLD "
                f"(capacity {scheme['capacity_mld'] if scheme['capacity_mld'] is not None else 'n/a'} MLD) "
                "treated as a delivered-demand proxy. "
                + (f"Supply = baseline with a SIMULATED {curtail}% source curtailment. "
                   if curtail else "Supply equals the baseline utilisation. ")
                + "Storage, reserve, loss and tanker fleet are SIMULATED OPERATIONAL "
                  "DATA assumptions; no municipal telemetry is connected."),
            field_labels=labels, linked_scheme_sl=sl,
            tanker_source_name=(f"{source['scheme']} (approximate town centroid)"
                                if source else ""),
            tanker_source_lat=source["latitude"] if source else None,
            tanker_source_lon=source["longitude"] if source else None,
            provenance=Record(
                source="MIDC baseline + simulated operational assumptions",
                source_type="SIMULATED OPERATIONAL DATA", timestamp=timestamp,
                confidence="LOW", location=scheme["scheme"],
                value="Baseline demand with simulated operating state", unit="record",
                influence="Pilot zone inputs; see per-field labels",
                data_label="SIMULATED OPERATIONAL DATA",
            ),
        )
        zones.append(zone.model_dump())
    # Delhi locality: real groundwater nearby, everything else simulated.
    delhi = Zone(
        id="pilot-delhi-nw", version=1, name="North-West Delhi locality (simulated supply)",
        location="Illustrative point near Sultanpur Dabas / Libaspur, Delhi",
        latitude=28.77, longitude=77.10, demand_lpd=4_000_000, supply_lpd=3_400_000,
        storage_l=6_000_000, reserve_l=2_000_000, loss_pct=15,
        tanker_capacity_l=10_000, available_tankers=15, refill_minutes=30,
        distance_km=9.0, speed_kph=25, unload_minutes=25, demand_trend_pct=8,
        supply_trend_pct=-6, criticality=3, observed_anomaly=False,
        priority_facilities="No verified facility geometry supplied",
        notes=("Delhi supply/demand figures are SIMULATED OPERATIONAL DATA; the supplied "
               "datasets contain no Delhi supply baseline. The value of this zone is the "
               "REAL nearby groundwater telemetry shown as contextual evidence."),
        field_labels=_labels(**{k: "SIMULATED OPERATIONAL DATA" for k in LABELLED_FIELDS}),
        provenance=Record(
            source="Simulated operating state; real nearby groundwater context",
            source_type="SIMULATED OPERATIONAL DATA", timestamp=timestamp,
            confidence="LOW", location="North-West Delhi illustrative point",
            value="Simulated operational zone", unit="record",
            influence="Pilot zone inputs; see per-field labels",
            data_label="SIMULATED OPERATIONAL DATA"),
    )
    zones.append(delhi.model_dump())
    return zones


def seed_state(workspace: str = "demo") -> dict:
    zones = _pilot_zones() if workspace == "pilot" else _demo_zones()
    return {"zones": zones, "actions": [], "audit": []}
