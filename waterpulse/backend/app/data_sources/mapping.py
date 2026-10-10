"""Observation -> station -> evidence layer -> zone context.

Real datasets do not map one-to-one onto operating zones and no municipal zone
geometry exists. A zone therefore receives *nearby public telemetry*, with the
distance always shown, never telemetry "belonging" to the zone.
"""
from __future__ import annotations

from datetime import datetime

from . import registry
from .base import DataUnavailable, haversine_km

NEARBY_KM = 50.0


def _nearest_placed_schemes(latitude: float, longitude: float, k: int = 3,
                            exclude: int | None = None) -> list[dict]:
    provider = registry.get("water_supply")
    placed = [s for s in provider.schemes(placed_only=True, limit=500)
              if s["sl_no"] != exclude]
    ranked = sorted(placed, key=lambda s: haversine_km(
        latitude, longitude, s["latitude"], s["longitude"]))
    return [{**s, "distance_km": round(haversine_km(
        latitude, longitude, s["latitude"], s["longitude"]), 1)} for s in ranked[:k]]


def zone_context(latitude: float, longitude: float, now: datetime | None = None,
                 linked_scheme_sl: int | None = None) -> dict:
    notes = [
        "Nearby public telemetry is contextual evidence, not zone telemetry.",
        "Municipal live demand and NRW telemetry are not connected in this pilot.",
    ]
    context: dict = {"notes": notes, "radius_km": NEARBY_KM}

    # ------------------------------------------------------------ groundwater
    try:
        gw = registry.get("groundwater")
        near = gw.nearest(latitude, longitude, k=8, now=now)
        within = [n for n in near if n["distance_km"] <= NEARBY_KM]
        if within:
            # Lead with the most recent reading in range; a nearer but months-old
            # station is still listed (with its age) rather than hidden.
            within.sort(key=lambda n: (n["freshness"]["age_hours"]
                                       if n["freshness"]["age_hours"] is not None
                                       else float("inf"), n["distance_km"]))
            within = within[:4]
            lead = within[0]
            context["groundwater"] = {
                "status": "OK", "relevance": "NEARBY PUBLIC TELEMETRY",
                "lead_basis": "Most recent reading among stations within "
                              f"{NEARBY_KM:.0f} km",
                "stations": within,
                "trend": gw.trend(lead["station_id"], 30, now),
            }
        else:
            context["groundwater"] = {
                "status": "NO_NEARBY_TELEMETRY", "relevance": "NOT REPRESENTATIVE",
                "message": (f"No groundwater station within {NEARBY_KM:.0f} km; nearest is "
                            f"{near[0]['station_name']} at {near[0]['distance_km']} km."),
                "nearest": near[:1]}
    except DataUnavailable as error:
        context["groundwater"] = error.payload()

    # ------------------------------------------------------------------ SCADA
    try:
        scada = registry.get("scada")
        station = scada.nearest_station(latitude, longitude)
        if station and station["distance_km"] <= NEARBY_KM:
            context["scada"] = {
                "status": "OK", "relevance": "NEARBY PUBLIC TELEMETRY",
                "station": station,
                "latest": scada.latest(station["station_id"], now=now)}
        else:
            context["scada"] = {
                "status": "NO_NEARBY_TELEMETRY", "relevance": "NOT REPRESENTATIVE",
                "message": (f"No SCADA station within {NEARBY_KM:.0f} km"
                            + (f"; nearest is {station['station_name']} at "
                               f"{station['distance_km']} km." if station else "."))}
    except DataUnavailable as error:
        context["scada"] = error.payload()

    # -------------------------------------------------------------- discharge
    try:
        discharge = registry.get("discharge").latest(now)
        distance = haversine_km(latitude, longitude, discharge["latitude"],
                                discharge["longitude"])
        if distance <= NEARBY_KM:
            context["discharge"] = {"status": "OK", "relevance": "NEARBY PUBLIC TELEMETRY",
                                    "distance_km": round(distance, 1), "latest": discharge}
        else:
            context["discharge"] = {
                "status": "NO_NEARBY_TELEMETRY", "relevance": "NOT REPRESENTATIVE",
                "message": f"Discharge station is {distance:.0f} km away."}
    except DataUnavailable as error:
        context["discharge"] = error.payload()

    # --------------------------------------------------------- MIDC baseline
    try:
        provider = registry.get("water_supply")
        linked = provider.get(linked_scheme_sl) if linked_scheme_sl else None
        context["supply_baseline"] = {
            "status": "OK", "relevance": "REAL GOVERNMENT BASELINE",
            "linked_scheme": linked,
            "nearest_schemes": _nearest_placed_schemes(latitude, longitude, 3, linked_scheme_sl),
            "placement_note": "Scheme positions are approximate town centroids."}
    except DataUnavailable as error:
        context["supply_baseline"] = error.payload()
    return context
