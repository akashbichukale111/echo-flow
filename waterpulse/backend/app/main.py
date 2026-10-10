import hmac
import json
import logging
import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from . import routing, service

logger = logging.getLogger("waterpulse")
from .config import settings
from .data_api import router as data_router
from .engines import TankerCapacityEngine
from .integrations import BedrockExplainer
from .models import (
    ActionDecision,
    CreateAction,
    ExecutionInput,
    ScenarioInput,
    TankerInput,
    VerificationInput,
    ZoneInput,
    ZoneUpdate,
)
from .repositories import CapacityError, ConflictError, check, create_repository


def create_app(repository=None):
    @asynccontextmanager
    async def lifespan(application):
        if settings.mode != "demo" and len(settings.api_token) < 32:
            raise RuntimeError("Pilot mode requires an API_TOKEN of 32+ characters")
        yield

    app = FastAPI(
        title="WATERPULSE AI", version="1.0.0",
        lifespan=lifespan,
        description="Water operations decision support; no physical control API."
    )
    app.state.repo = repository or create_repository()
    app.include_router(data_router)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.origins),
        allow_methods=["GET", "POST", "PUT"],
        allow_headers=["Authorization", "Content-Type", "X-WaterPulse-Workspace"],
        allow_credentials=False
    )
    rates = defaultdict(deque)
    rate_lock = threading.Lock()

    @app.middleware("http")
    async def security(request: Request, call_next):
        if request.method == "OPTIONS":
            return await call_next(request)
        if settings.mode != "demo":
            expected = f"Bearer {settings.api_token}"
            actual = request.headers.get("authorization", "")
            if not hmac.compare_digest(actual, expected):
                return JSONResponse({"detail": "Unauthorized"}, status_code=401)
        content_length = request.headers.get("content-length", "0")
        try:
            if int(content_length) > 64_000:
                return JSONResponse(
                    {"detail": "Request too large"}, status_code=413
                )
        except ValueError:
            return JSONResponse(
                {"detail": "Invalid request size"}, status_code=400
            )
        # Bound requests without trusting Content-Length.
        body = await request.body()
        if len(body) > 64_000:
            return JSONResponse({"detail": "Request too large"}, status_code=413)
        client = request.client.host if request.client else "unknown"
        current = time.monotonic()
        with rate_lock:
            # Bound cardinality. This limiter is intentionally process-local.
            if len(rates) > 10_000:
                rates.clear()
            bucket = rates[client]
            while bucket and current - bucket[0] > 60:
                bucket.popleft()
            if len(bucket) >= settings.rate_limit_per_minute:
                return JSONResponse(
                    {"detail": "Rate limit exceeded"}, status_code=429,
                    headers={"Retry-After": "60"}
                )
            bucket.append(current)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(ConflictError)
    async def conflict_handler(request, error):
        return JSONResponse({"detail": str(error)}, status_code=409)

    @app.exception_handler(CapacityError)
    async def capacity_handler(request, error):
        return JSONResponse({"detail": str(error)}, status_code=409)

    @app.exception_handler(Exception)
    async def exception_handler(request, error):
        logger.error("Unhandled application failure: %s", type(error).__name__)
        return JSONResponse(
            {"detail": "Operation failed; retry or contact the operator"},
            status_code=500
        )

    def workspace_of(request: Request) -> str:
        try:
            return check(request.headers.get("x-waterpulse-workspace"))
        except ValueError:
            raise HTTPException(422, "Workspace must be 'demo' or 'pilot'") from None

    def read(request: Request):
        return app.state.repo.read(workspace_of(request))

    def mutate(request: Request, callback):
        return app.state.repo.mutate(callback, workspace_of(request))

    @app.get("/api/health")
    def health(request: Request):
        return {
            "status": "available",
            "mode": settings.mode,
            "workspace": workspace_of(request),
            "workspaces": ["demo", "pilot"],
            "storage": "DynamoDB" if settings.table else "SQLite",
            "physical_control": False,
            "weather_provider": settings.weather_provider,
            "weather_configured": bool(
                settings.weather_provider == "weatherapi" and settings.weather_key),
            "routing_configured": bool(settings.location_key),
            "bedrock_configured": bool(settings.model)
        }

    @app.get("/api/zones")
    def zones(request: Request):
        return read(request)["zones"]

    @app.post("/api/zones", status_code=201)
    def create_zone(request: Request, payload: ZoneInput):
        return mutate(request, lambda state: service.save_zone(state, payload))

    @app.put("/api/zones/{zone_id}")
    def update_zone(request: Request, zone_id: str, payload: ZoneUpdate):
        return mutate(
            request, lambda state: service.save_zone(state, payload, zone_id)
        )

    @app.get("/api/zones/{zone_id}/analysis")
    def analysis(request: Request, zone_id: str):
        return service.analyze(
            read(request), zone_id, workspace=workspace_of(request))

    @app.get("/api/zones/{zone_id}/route")
    def route(request: Request, zone_id: str):
        return routing.estimate(service.locate(read(request), zone_id))

    @app.post("/api/zones/{zone_id}/scenarios")
    def scenarios(request: Request, zone_id: str, payload: ScenarioInput):
        return service.analyze(
            read(request), zone_id, payload,
            workspace=workspace_of(request))["scenarios"]

    @app.post("/api/zones/{zone_id}/tankers")
    def tankers(request: Request, zone_id: str, payload: TankerInput):
        return TankerCapacityEngine.calculate(
            service.locate(read(request), zone_id),
            payload.required_water_l, payload.operating_hours
        )

    @app.post("/api/zones/{zone_id}/explanation")
    def explanation(request: Request, zone_id: str):
        result = service.analyze(
            read(request), zone_id, workspace=workspace_of(request))
        return BedrockExplainer().explain(
            result["evidence"], result["diagnosis"]["summary"]
        )

    @app.get("/api/actions")
    def actions(request: Request):
        return read(request)["actions"]

    @app.post("/api/zones/{zone_id}/actions", status_code=201)
    def draft(request: Request, zone_id: str, payload: CreateAction):
        return mutate(
            request,
            lambda state: service.create_action(state, zone_id, payload)
        )

    @app.post("/api/actions/{action_id}/decision")
    def decision(request: Request, action_id: str, payload: ActionDecision):
        return mutate(
            request,
            lambda state: service.decide_action(state, action_id, payload)
        )

    @app.post("/api/actions/{action_id}/execution")
    def execute(request: Request, action_id: str, payload: ExecutionInput):
        return mutate(
            request,
            lambda state: service.execute_action(state, action_id, payload)
        )

    @app.post("/api/actions/{action_id}/verification")
    def verify(request: Request, action_id: str, payload: VerificationInput):
        return mutate(
            request,
            lambda state: service.verify_action(state, action_id, payload)
        )

    @app.get("/api/audit")
    def audit(request: Request):
        return read(request)["audit"]

    @app.get("/api/export")
    def export(request: Request):
        return Response(
            json.dumps(read(request), indent=2, allow_nan=False),
            media_type="application/json",
            headers={
                "Content-Disposition":
                    'attachment; filename="waterpulse-workspace.json"'
            }
        )

    return app

app = create_app()
