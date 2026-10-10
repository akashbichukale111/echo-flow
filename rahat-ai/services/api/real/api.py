"""FastAPI router for /api/real/*. Request bodies are validated; provider failures never raise to the UI."""
from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from . import community as comm
from .service import RealEngine


class LatLon(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class SunIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    altitudeDeg: float | None = Field(default=None)
    azimuthDeg: float | None = Field(default=None)


class ScenarioIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tempOffsetC: float = Field(default=0, ge=-10, le=10)
    shadeRemoved: bool = False
    delayMin: float = Field(default=0, ge=0, le=60)
    waterUnavailable: bool = False
    cloudPct: float | None = Field(default=None, ge=0, le=100)


class AnalyzeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    origin: LatLon
    destination: LatLon
    travelMode: Literal["walk", "cycle", "rider", "car"] = "rider"
    maxDetourPct: float = Field(default=40, ge=0, le=200)
    sun: SunIn | None = None
    scenario: ScenarioIn | None = None



class ScenarioCompareIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    base: AnalyzeIn
    scenario: ScenarioIn


class ReassessIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    routeCoords: list[tuple[float, float]] = Field(min_length=2, max_length=5000)
    segments: list[dict] = Field(max_length=5000)
    position: LatLon
    state: dict = Field(default_factory=dict)
    lastWeatherTempC: float | None = None
    weatherTempC: float | None = None
    delayMin: float = Field(default=0, ge=0, le=120)
    needRahat: bool = False
    elapsedMin: float = Field(default=1.0, ge=0, le=30)
    relief: list[dict] = Field(default_factory=list, max_length=300)
    reliefUnavailable: bool = False


class ReportIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal[comm.KINDS]
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    note: str = Field(default="", max_length=500)


class ConfirmIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirmerId: str = Field(min_length=1, max_length=64)


def build_real_router(engine: RealEngine, store):
    r = APIRouter(prefix="/api/real")

    def community_items(lat, lon):
        reports = store.list("rreport", 300) if store else []
        positives = [comm.as_relief(x) for x in reports if not x.get("negative")]
        return reports, positives

    @r.get("/status")
    def status():
        return engine.status()

    @r.get("/search")
    def search(q: str = "", lat: float | None = None, lon: float | None = None):
        items, ev = engine.location.search(q, (lat, lon) if lat is not None and lon is not None else None)
        return {"items": items, "evidence": ev}

    @r.get("/reverse")
    def reverse(lat: float, lon: float):
        return engine.location.reverse(lat, lon)

    @r.get("/weather")
    def weather(lat: float, lon: float):
        w, ev = engine.weather.get(lat, lon)
        return {"weather": w, "evidence": ev}

    def run(body: AnalyzeIn, scenario=None):
        reports, positives = community_items(body.origin.lat, body.origin.lon)
        kw = dict(travel=body.travelMode, sun=body.sun.model_dump() if body.sun else None,
                  max_detour_pct=body.maxDetourPct, community=positives)
        return kw, reports

    @r.post("/analyze")
    def analyze(body: AnalyzeIn):
        import time
        with open("request_log.txt", "a") as f:
            f.write(f"[{time.time()}] Received analyze: {body.model_dump_json()}\n")
        kw, reports = run(body)
        from .comm_apply import apply  # noqa: PLC0415
        try:
            out = engine.analyze((body.origin.lat, body.origin.lon), (body.destination.lat, body.destination.lon),
                                 scenario=body.scenario.model_dump() if body.scenario else None, **kw)
            with open("request_log.txt", "a") as f:
                f.write(f"[{time.time()}] Analyze success: {out.get('ok')}, demo={any(r.get('sourceType') == 'DEMO_DATA' for r in out.get('routes', [])) if out.get('routes') else 'none'}\n")
            return apply(out, reports) if out.get("ok") else out
        except Exception as e:
            with open("request_log.txt", "a") as f:
                f.write(f"[{time.time()}] Analyze error: {e}\n")
            raise

    @r.post("/scenario")
    def scenario(body: ScenarioCompareIn):
        kw, _ = run(body.base)
        return engine.scenario_compare((body.base.origin.lat, body.base.origin.lon),
                                       (body.base.destination.lat, body.base.destination.lon),
                                       body.scenario.model_dump(), **kw)

    @r.post("/reassess")
    def reassess(body: ReassessIn):
        if not body.segments:
            raise HTTPException(422, "segments are required")
        return engine.reassess(body.routeCoords, body.segments, body.position.model_dump(), body.state,
                               body.lastWeatherTempC, body.weatherTempC, body.delayMin, body.needRahat,
                               body.elapsedMin, body.relief, body.reliefUnavailable)

    @r.post("/explain")
    def explain(body: AnalyzeIn):
        kw, _ = run(body)
        out = engine.analyze((body.origin.lat, body.origin.lon), (body.destination.lat, body.destination.lon), **kw)
        if not out.get("ok"):
            return {"text": "Route data unavailable, so no explanation was generated.",
                    "source": "DETERMINISTIC EXPLANATION"}
        return engine.explain(out)

    @r.get("/reports")
    def reports(lat: float | None = None, lon: float | None = None, radius_m: float = 2000):
        items = store.list("rreport", 300) if store else []
        if lat is not None and lon is not None:
            from .geo import haversine
            items = [i for i in items if haversine(lat, lon, i["latitude"], i["longitude"]) <= radius_m]
        return {"items": items}

    @r.post("/reports", status_code=201)
    def report(body: ReportIn):
        if not store:
            raise HTTPException(503, "Report store unavailable")
        rep = comm.new_report(body.kind, body.lat, body.lon, body.note)
        return store.create("rreport", str(uuid4()), rep)

    @r.post("/reports/{ident}/confirm")
    def confirm(ident: str, body: ConfirmIn):
        rep = store.get("rreport", ident) if store else None
        if not rep:
            raise HTTPException(404, "Report not found")
        new = comm.confirm(rep, body.confirmerId)
        return store.update("rreport", ident, rep["revision"], new)

    @r.post("/evidence-snapshot")
    def snapshot(body: AnalyzeIn):
        """Persist an evidence snapshot (local store; S3/DynamoDB when STORE_MODE=dynamodb)."""
        kw, _ = run(body)
        out = engine.analyze((body.origin.lat, body.origin.lon), (body.destination.lat, body.destination.lon), **kw)
        if not out.get("ok") or not store:
            raise HTTPException(503, "Evidence unavailable")
        rec = store.create("evidence", str(uuid4()), {"evidence": out["evidence"], "dataMode": out["dataMode"],
                                                      "savedAt": datetime.now(timezone.utc).isoformat()})
        return {"id": rec["id"], "dataMode": out["dataMode"]}

    return r
