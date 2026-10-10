import logging
import os
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from mangum import Mangum
from pydantic import ValidationError

from agents import orchestrate, run_stage
from aws_adapters import BedrockExplainer
from engine import Engine, RouteUnavailable, constrained_path, summarize
from models import (
    PlanRequest, ReliefRequest, ReportRequest, ScenarioRequest,
    TripAction, TripReroute, TripStart,
)
from delhi import delhi_providers
from journey import build_router
from real.api import build_real_router
from real.livemap import build_livemap_router
from real.envfile import load_env_file
from real.service import RealEngine
from emergency.router import router as emergency_router
from providers import demo_providers
from store import Conflict, DynamoStore, SQLiteStore

load_env_file()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("rahat")


from fastapi.exceptions import RequestValidationError
from validation_handler import custom_validation_exception_handler

def create_app(store=None, providers=None, real_engine=None):

    # The legacy schematic engine (node-graph Delhi/Pune demo) always uses demo providers.
    # PROVIDER_MODE=real activates the separate real-data layer under /api/real/*, which falls
    # back to clearly labelled DEMO DATA per provider when a real provider is unavailable.
    providers = providers or demo_providers()
    if store is None:
        if os.getenv("STORE_MODE", "sqlite") == "dynamodb":
            store = DynamoStore(
                os.getenv("DYNAMODB_TABLE", ""),
                os.getenv("AWS_REGION", "ap-south-1"),
            )
        else:
            store = SQLiteStore(os.getenv("DATABASE_PATH", "rahat.db"))
    engine = Engine(providers)

    app = FastAPI(title="RAHAT AI", version="0.1.0")
    app.add_exception_handler(RequestValidationError, custom_validation_exception_handler)

    app.state.engine = engine
    router, _je = build_router(Engine(delhi_providers()))
    app.include_router(router)
    real_eng = real_engine or RealEngine(
        explainer=BedrockExplainer() if os.getenv("BEDROCK_MODEL_ID") else None)
    app.include_router(build_real_router(real_eng, store))
    app.include_router(build_livemap_router(real_eng))
    app.include_router(emergency_router)

    def calculate(q):
        return orchestrate(q, engine)

    def get_trip(ident):
        trip = store.get("trip", ident)
        if trip is None:
            raise HTTPException(404, "Trip not found")
        return trip

    @app.middleware("http")
    async def trace(request: Request, call_next):
        request_id = str(uuid4())
        try:
            response = await call_next(request)
        except Exception:
            logger.exception("Unhandled request failure request_id=%s", request_id)
            response = JSONResponse(
                status_code=503,
                content={"detail": "Service unavailable", "request_id": request_id},
            )
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(Conflict)
    async def conflict_handler(request, exc):
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.exception_handler(ValidationError)
    async def pydantic_handler(request, exc):
        return JSONResponse(status_code=422, content={
            "detail": "Some inputs are not valid: " + "; ".join(
                str(e["msg"]) for e in exc.errors()),
        })

    @app.exception_handler(RouteUnavailable)
    async def route_handler(request, exc):
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    @app.get("/api/health")
    def health():
        return {
            "status": "ok", "mode": "DEMO MODE",
            "model": "Uncalibrated deterministic environmental exposure model",
            "map": "Synthetic local geometry",
            "aws": "DynamoDB configured" if isinstance(store, DynamoStore)
                   else "Not connected",
            "ai": "Bedrock configured—not health-checked"
                  if os.getenv("BEDROCK_ENABLED") == "true"
                  else "Deterministic explanations",
            "data": "DEMO DATA",
        }

    @app.get("/api/bootstrap")
    def bootstrap():
        return {
            "map": providers.map.get(), "relief": providers.relief.get(),
            "defaults": PlanRequest().model_dump(mode="json"), "status": health(),
        }

    @app.post("/api/plan")
    def plan(q: PlanRequest):
        return calculate(q)

    @app.post("/api/relief")
    def relief(body: ReliefRequest):
        return {
            "node": body.node,
            "location_basis": "Synthetic network node; not live GPS navigation",
            "items": engine.relief(body.plan, body.node, body.radius_m),
        }

    @app.post("/api/scenario")
    def scenario(body: ScenarioRequest):
        return engine.scenario(body.base, body.scenario, calculate)

    @app.post("/api/explain")
    def explain(q: PlanRequest):
        context = calculate(q)
        if os.getenv("BEDROCK_ENABLED") != "true":
            return {"text": context["advisor"], "source": "DETERMINISTIC EXPLANATION"}
        try:
            return {
                "text": BedrockExplainer().explain(context),
                "source": "AI EXPLANATION",
            }
        except Exception:
            logger.exception("Bedrock explanation unavailable")
            return {
                "text": context["advisor"],
                "source": "DETERMINISTIC FALLBACK",
                "warning": "Bedrock unavailable or output failed validation",
            }

    @app.get("/api/reports")
    def reports():
        return {"items": store.list("report", 100)}

    @app.post("/api/reports", status_code=201)
    def report(body: ReportRequest):
        return store.create("report", str(uuid4()), {
            **body.model_dump(),
            "status": "UNVERIFIED",
            "source": "COMMUNITY REPORT",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    @app.post("/api/trips", status_code=201)
    def start(body: TripStart):
        context = calculate(body.plan)
        route = next(r for r in context["routes"] if r["mode"] == body.mode)
        return store.create("trip", str(uuid4()), {
            "request": body.plan.model_dump(mode="json"),
            "route": route, "cursor": 0, "current_node": body.plan.origin,
            "destination": body.plan.destination, "status": "RUNNING",
            "elapsed_minutes": 0.0, "cumulative_load": 0.0,
            "history": [], "rest_taken": False,
            "simulation": "SIMULATED TRIP — one segment per advance",
            "last_change": None,
        })

    @app.get("/api/trips/{ident}")
    def trip(ident: str):
        return get_trip(ident)

    @app.post("/api/trips/{ident}/action")
    def action(ident: str, body: TripAction):
        trip = get_trip(ident)
        if body.revision != trip["revision"]:
            raise Conflict("Trip changed; reload before retrying")
        if body.action == "end":
            trip["status"] = "ENDED"
        elif body.action == "pause":
            if trip["status"] != "RUNNING":
                raise HTTPException(409, "Only a running trip can be paused")
            trip["status"] = "PAUSED"
        elif body.action == "resume":
            if trip["status"] != "PAUSED":
                raise HTTPException(409, "Only a paused trip can be resumed")
            trip["status"] = "RUNNING"
        else:
            if trip["status"] != "RUNNING":
                raise HTTPException(409, "Trip is not running")
            route = trip["route"]
            if trip["cursor"] >= len(route["segments"]):
                trip["status"] = "ARRIVED"
            else:
                edge = route["segments"][trip["cursor"]]
                increment = edge["load"]
                duration = edge["minutes"]
                why = dict(edge["breakdown"])
                if (
                    route["rest_node"] is not None and not trip["rest_taken"]
                    and route["rest_node"] in (edge["a"], edge["b"])
                ):
                    increment += route["rest_load"]
                    duration += route["rest_minutes"]
                    why["Sheltered rest interval"] = route["rest_load"]
                    trip["rest_taken"] = True
                trip["cumulative_load"] += increment
                trip["elapsed_minutes"] += duration
                trip["current_node"] = edge["b"]
                trip["cursor"] += 1
                trip["history"].append({
                    "node": edge["b"], "increment": increment,
                    "cumulative": trip["cumulative_load"], "why": why,
                })
                if len(trip["history"]) > 200:
                    trip["history"] = trip["history"][-200:]
                if trip["cursor"] == len(route["segments"]):
                    trip["status"] = "ARRIVED"
        return store.update("trip", ident, body.revision, trip)

    @app.post("/api/trips/{ident}/reroute")
    def reroute(ident: str, body: TripReroute):
        trip = get_trip(ident)
        if body.revision != trip["revision"]:
            raise Conflict("Trip changed; reload before retrying")
        if trip["status"] not in ("RUNNING", "PAUSED"):
            raise HTTPException(409, "Only an active trip can be rerouted")
        values = body.plan.model_dump()
        values["origin"] = trip["current_node"]
        values["destination"] = trip["destination"]
        values["rest_min"] = 0
        if values["origin"] == values["destination"]:
            raise HTTPException(409, "Already at the destination")
        q = PlanRequest(**values)
        scan = engine.scan(q)
        fastest = constrained_path(
            scan["edges"], q.origin, q.destination, "fastest", q
        )
        fast_time = sum(e["minutes"] for e in fastest)
        if body.relief_id:
            poi = next(
                (p for p in providers.relief.get() if p["id"] == body.relief_id), None
            )
            if not poi or poi["status"] != "OPEN" or poi["id"] in q.closed_relief:
                raise HTTPException(422, "Relief point is unavailable")
            path = constrained_path(
                scan["edges"], q.origin, poi["node"], body.mode, q
            ) + constrained_path(
                scan["edges"], poi["node"], q.destination, body.mode, q
            )
            if sum(e["minutes"] for e in path) > (
                fast_time * (1 + q.max_detour_pct / 100) + 1e-8
            ):
                raise HTTPException(422, "Relief detour exceeds the configured allowance")
        else:
            path = constrained_path(
                scan["edges"], q.origin, q.destination, body.mode, q,
                fast_time * (1 + q.max_detour_pct / 100)
            )
        new_route = summarize(
            path, body.mode, q, providers.relief.get(), scan["weather"], fast_time
        )
        old_segments = trip["route"]["segments"][trip["cursor"]:]
        old_time = sum(e["minutes"] for e in old_segments)
        old_load = sum(e["load"] for e in old_segments)
        trip["last_change"] = {
            "reason": "User-confirmed relief detour" if body.relief_id
                      else "User-confirmed reassessment with current planner inputs",
            "old_remaining_nodes": [trip["current_node"]] + [e["b"] for e in old_segments],
            "new_remaining_nodes": new_route["nodes"],
            "time_difference": new_route["minutes"] - old_time,
            "exposure_difference": new_route["load"] - old_load,
            "geometry_changed": new_route["nodes"] != (
                [trip["current_node"]] + [e["b"] for e in old_segments]
            ),
        }
        trip["route"] = new_route
        trip["request"] = q.model_dump(mode="json")
        trip["cursor"] = 0
        trip["rest_taken"] = False
        return store.update("trip", ident, body.revision, trip)

    return app

app = create_app()
handler = Mangum(app)

def agent_handler(event, context):
    """Used by the included Step Functions state machine."""
    return run_stage(
        event["stage"], event["context"], Engine(demo_providers())
    )
