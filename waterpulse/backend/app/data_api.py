"""Read-only public-data endpoints. Never returns whole raw files: every list
is filtered, limited and labelled; a failing provider yields a structured
DATA_UNAVAILABLE payload instead of an error page."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from .data_sources import registry
from .data_sources.base import (
    IST,
    DataUnavailable,
    clamp_limit,
    display_time,
    haversine_km,
)

router = APIRouter(prefix="/api/data", tags=["public data"])



def Text():  # a fresh Query object per parameter; sharing one instance aliases them
    return Query(default=None, max_length=80)


Station = Text

LEGEND = [
    {"label": "REAL PUBLIC DATA", "meaning": "Observation from a supplied public telemetry file"},
    {"label": "REAL GOVERNMENT BASELINE", "meaning": "Published baseline figures; not live telemetry"},
    {"label": "DERIVED MODEL INPUT", "meaning": "Calculated from real or operator values"},
    {"label": "SIMULATED OPERATIONAL DATA", "meaning": "Intentionally simulated operating assumption"},
    {"label": "MODEL OUTPUT", "meaning": "Deterministic WATERPULSE calculation"},
]


def when(text: str | None, name: str) -> datetime | None:
    if not text:
        return None
    try:
        moment = datetime.fromisoformat(text)
    except ValueError as error:
        raise HTTPException(422, f"{name} must be an ISO date or datetime") from error
    return moment if moment.tzinfo else moment.replace(tzinfo=IST)


def now() -> datetime:
    return datetime.now(timezone.utc)


def wrap(source_name: str, items: list, provider, **extra) -> dict:
    return {"status": "OK", "source": source_name, "count": len(items),
            "items": items, **extra}


@router.get("/summary")
def summary():
    moment = now()
    providers = {
        "groundwater": registry.safe(lambda: registry.get("groundwater").summary(moment),
                                     "Delhi groundwater"),
        "scada": registry.safe(lambda: registry.get("scada").summary(moment),
                               "Maharashtra SCADA"),
        "discharge": registry.safe(lambda: registry.get("discharge").summary(moment),
                                   "Maharashtra discharge"),
        "water_supply": registry.safe(lambda: registry.get("water_supply").summary(),
                                      "MIDC water supply"),
    }
    return {
        "generated_at": moment.isoformat(),
        "generated_display": display_time(moment),
        "providers": providers,
        "legend": LEGEND,
        "not_connected": {
            "municipal_demand": "Municipal live demand telemetry is not connected in this pilot.",
            "nrw": "Live non-revenue-water telemetry is not connected; loss is an operator "
                   "input, derived estimate or simulated scenario value.",
            "tanker_gps": "No live tanker GPS.",
        },
        "statement": ("The four supplied datasets are real public/government datasets, "
                      "but they are not necessarily live municipal telemetry."),
    }


@router.get("/groundwater")
def groundwater(
    station: str | None = Station(), q: str | None = Text(), state: str | None = Text(),
    district: str | None = Text(), start: str | None = Text(), end: str | None = Text(),
    history: bool = False, latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
    radius_km: float | None = Query(default=None, gt=0, le=2000),
    limit: int | None = Query(default=None, ge=1, le=2000),
):
    def run():
        provider = registry.get("groundwater")
        moment = now()
        if history:
            if not station:
                raise HTTPException(422, "history requires a station")
            items = provider.history(station, when(start, "start"), when(end, "end"),
                                     limit, moment)
        elif latitude is not None and longitude is not None:
            items = provider.nearest(latitude, longitude, clamp_limit(limit, 5, 20),
                                     radius_km, moment)
        else:
            items = provider.latest(station or q, moment, limit)
        if state and state.lower() != "delhi":
            items = []
        if district:
            items = [i for i in items if i["district"].lower() == district.lower()]
        return wrap(provider.summary(moment)["source"], items, provider,
                    data_label="REAL PUBLIC DATA",
                    note=provider.summary(moment)["note"])
    return registry.safe(run, "Delhi groundwater")


@router.get("/scada")
def scada(
    parameter: str | None = Text(), station: str | None = Station(),
    district: str | None = Text(), category: str | None = Text(),
    state: str | None = Text(), start: str | None = Text(), end: str | None = Text(),
    history: bool = False, include_gates: bool = False,
    limit: int | None = Query(default=None, ge=1, le=1000),
):
    def run():
        provider = registry.get("scada")
        moment = now()
        if state and state.lower() != "maharashtra":
            items = []
        elif history or parameter or start or end or category or district:
            items = provider.query(parameter, station, district, category,
                                   when(start, "start"), when(end, "end"), limit, moment)
        else:
            items = provider.latest(station, moment, include_gates)[:clamp_limit(limit, 100, 1000)]
        info = provider.summary(moment)
        return wrap(info["source"], items, provider, data_label="REAL PUBLIC DATA",
                    stations=provider.stations(moment), coverage_note=info["note"],
                    not_in_file=info["parameters_not_in_file"])
    return registry.safe(run, "Maharashtra SCADA")


@router.get("/discharge")
def discharge(
    history: bool = False, gates: bool = False, start: str | None = Text(),
    end: str | None = Text(), limit: int | None = Query(default=None, ge=1, le=2000),
):
    def run():
        provider = registry.get("discharge")
        moment = now()
        info = provider.summary(moment)
        out = {"status": "OK", "source": info["source"], "data_label": "REAL PUBLIC DATA",
               "latest": provider.latest(moment), "summary": info}
        if history:
            out["items"] = provider.history(when(start, "start"), when(end, "end"),
                                            limit, moment)
        if gates:
            out["gates"] = provider.gates_at(None)
        return out
    return registry.safe(run, "Maharashtra discharge")


@router.get("/water-supply")
def water_supply(
    q: str | None = Text(), state: str | None = Text(), placed_only: bool = False,
    limit: int | None = Query(default=None, ge=1, le=500),
    offset: int = Query(default=0, ge=0, le=10_000),
):
    def run():
        provider = registry.get("water_supply")
        items = [] if state and state.lower() != "maharashtra" else provider.schemes(
            q, placed_only, limit, offset)
        info = provider.summary()
        return wrap(info["source"], items, provider, data_label="REAL GOVERNMENT BASELINE",
                    note=info["note"], totals={
                        k: info[k] for k in ("schemes", "placed_on_map", "total_capacity_mld",
                                             "total_utilisation_mld", "total_domestic_mld",
                                             "total_industrial_mld")},
                    offset=offset)
    return registry.safe(run, "MIDC water supply")


def _feature(kind, ident, name, lat, lon, label, headline, observed, freshness, source,
             **extra):
    return {"id": ident, "kind": kind, "name": name, "latitude": lat, "longitude": lon,
            "data_label": label, "headline": headline, "timestamp": observed,
            "freshness": freshness, "source": source, **extra}


@router.get("/map")
def map_features(
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
    radius_km: float | None = Query(default=None, gt=0, le=3000),
):
    """Compact marker set for the map: one feature per station or scheme."""
    moment = now()
    features: list[dict] = []
    layers: dict[str, dict] = {}

    def keep(lat, lon):
        if latitude is None or longitude is None or radius_km is None:
            return True
        return haversine_km(latitude, longitude, lat, lon) <= radius_km

    try:
        for obs in registry.get("groundwater").latest(None, moment, 200):
            if keep(obs["latitude"], obs["longitude"]):
                features.append(_feature(
                    "groundwater", obs["station_id"], obs["station_name"], obs["latitude"],
                    obs["longitude"], obs["data_label"],
                    {"parameter": obs["parameter"], "value": obs["value"], "unit": obs["unit"]},
                    obs["timestamp"], obs["freshness"], obs["source"],
                    confidence=obs["confidence"], district=obs["district"], note=obs["note"]))
        layers["groundwater"] = {"status": "OK"}
    except DataUnavailable as error:
        layers["groundwater"] = error.payload()
    try:
        scada = registry.get("scada")
        for station in scada.stations(moment):
            if not keep(station["latitude"], station["longitude"]):
                continue
            latest = scada.latest(station["station_id"], moment)
            pick = next((o for o in latest if o["parameter"] == "Cumulative Gate Discharge"
                         and o["unit"] == "cusec"), latest[0] if latest else None)
            features.append(_feature(
                "scada", station["station_id"], station["station_name"],
                station["latitude"], station["longitude"], "REAL PUBLIC DATA",
                {"parameter": pick["parameter"], "value": pick["value"], "unit": pick["unit"]}
                if pick else None, station["last_observed"], station["freshness"],
                "NWDP Maharashtra Surface Water SCADA", confidence="MEDIUM",
                district=station["district"]))
        layers["scada"] = {"status": "OK"}
    except DataUnavailable as error:
        layers["scada"] = error.payload()
    try:
        latest = registry.get("discharge").latest(moment)
        if keep(latest["latitude"], latest["longitude"]):
            features.append(_feature(
                "discharge", latest["station_id"], latest["station_name"], latest["latitude"],
                latest["longitude"], "REAL PUBLIC DATA",
                {"parameter": latest["parameter"], "value": latest["value"],
                 "unit": latest["unit"]}, latest["timestamp"], latest["freshness"],
                latest["source"], confidence=latest["confidence"],
                district=latest["district"], note=latest["note"]))
        layers["discharge"] = {"status": "OK"}
    except DataUnavailable as error:
        layers["discharge"] = error.payload()
    try:
        for scheme in registry.get("water_supply").schemes(placed_only=True, limit=500):
            if keep(scheme["latitude"], scheme["longitude"]):
                features.append(_feature(
                    "water_supply", scheme["scheme_id"], scheme["scheme"], scheme["latitude"],
                    scheme["longitude"], "REAL GOVERNMENT BASELINE",
                    {"parameter": "Present utilisation", "value": scheme["utilisation_mld"],
                     "unit": "MLD"}, None, scheme["freshness"], scheme["source"],
                    confidence="LOW", placement=scheme["placement"],
                    capacity_mld=scheme["capacity_mld"],
                    utilisation_pct=scheme["utilisation_pct"],
                    industrial_mld=scheme["industrial_mld"],
                    domestic_mld=scheme["domestic_mld"]))
        layers["water_supply"] = {"status": "OK"}
    except DataUnavailable as error:
        layers["water_supply"] = error.payload()
    return {"generated_at": moment.isoformat(), "count": len(features),
            "features": features, "layers": layers}
