import json
import logging
import os
import time
from collections import defaultdict, deque
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse

from . import config, providers
from .providers import amazon_location
from .coverage import CHALLENGES, SYSTEMS
from .domain import (CreateScenario, ExecuteRequest, HumanRequest, RainfallRequest, RouteRequest,
                     RunRequest, VerifyRequest)
from .repository import Conflict, repository
from .service import ProviderUnavailable, RuleViolation, Service

load_dotenv()
log = logging.getLogger("echo-flow")
logging.basicConfig(level=logging.INFO, format="%(message)s")


def create_app(repo=None) -> FastAPI:
    app = FastAPI(title="ECHO-FLOW", version="0.1.0")
    service = Service(repo or repository())
    app.state.service = service
    runtime = os.getenv("ECHO_RUNTIME", "local")
    origins = os.getenv("ECHO_ALLOWED_ORIGINS",
                        "http://localhost:5174,http://127.0.0.1:5174,http://localhost:8080,http://127.0.0.1:8080").split(",")

    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False,
                       allow_methods=["GET", "POST"],
                       allow_headers=["Content-Type", "Authorization"],
                       expose_headers=["X-Request-ID"])
    if runtime == "local":
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=os.getenv(
            "ECHO_ALLOWED_HOSTS", "localhost,127.0.0.1,testserver").split(","))

    windows: dict[str, deque] = defaultdict(deque)

    @app.middleware("http")
    async def observe(request: Request, call_next):
        request_id = str(uuid4())
        started = time.monotonic()
        ip = request.client.host if request.client else "unknown"
        window = windows[ip]
        while window and started - window[0] > 60:
            window.popleft()
        if len(window) >= 600:
            return JSONResponse({"detail": "Rate limit exceeded", "request_id": request_id},
                                status_code=429)
        window.append(started)
        if len(windows) > 1024:
            for key in list(windows):
                if not windows[key] or started - windows[key][-1] > 60:
                    del windows[key]
        if request.method == "POST":
            origin = request.headers.get("origin")
            if origin and origin not in origins:
                return JSONResponse({"detail": "Origin not permitted"}, status_code=403)
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        log.info(json.dumps({"request_id": request_id, "method": request.method,
                             "path": request.url.path, "status": response.status_code,
                             "latency_ms": round((time.monotonic() - started) * 1000, 2)}))
        return response

    @app.exception_handler(KeyError)
    async def missing_handler(_request, _exc):
        return JSONResponse({"detail": "Scenario not found"}, status_code=404)

    @app.exception_handler(Conflict)
    async def conflict_handler(_request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(RuleViolation)
    async def rule_handler(_request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(ProviderUnavailable)
    async def provider_handler(_request, exc):
        return JSONResponse({"detail": str(exc), "status": "PROVIDER_UNAVAILABLE"}, status_code=503)

    @app.exception_handler(ValueError)
    async def value_handler(_request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.exception_handler(Exception)
    async def failure_handler(_request, exc):
        log.error(json.dumps({"event": "request_failed", "error_type": type(exc).__name__}))
        return JSONResponse({"detail": "Backend operation failed; no success is assumed"},
                            status_code=503)

    def owner(request: Request) -> str:
        if runtime == "local":
            return "local-demo-commander"
        claims = (request.scope.get("aws.event", {}).get("requestContext", {})
                  .get("authorizer", {}).get("jwt", {}).get("claims", {}))
        if not claims.get("sub"):
            raise HTTPException(401, "Authenticated API Gateway identity required")
        return claims["sub"]

    def probe(fn) -> bool:
        try:
            return bool(fn())
        except Exception:
            return False

    @app.get("/api/health")
    def health():
        store = os.getenv("ECHO_STORE", "sqlite")
        agent_provider = os.getenv("ECHO_AGENT_PROVIDER", "local_rules")
        persistence = probe(service.repo.health)
        audit_ok = probe(service.sink.health)
        if runtime == "local":
            aws = "NOT USED — LOCAL DEVELOPMENT MODE"
        else:
            aws = ("CONNECTED — DynamoDB and S3 probes succeeded" if persistence
                   else "ERROR — DynamoDB/S3 probe failed")
        return {
            "api": "ONLINE",
            "simulation": "DETERMINISTIC SYNTHETIC MODEL",
            "persistence": "ONLINE" if persistence else "ERROR",
            "audit_sink": f"{service.sink.name}: " + ("ONLINE" if audit_ok else "NOT CONNECTED"),
            "agents": agent_provider,
            "bedrock": ("NOT USED — LOCAL DETERMINISTIC RULES" if agent_provider != "bedrock"
                        else "CONFIGURED — success is reported per agent run, not assumed here"),
            "runtime": runtime,
            "store": store,
            "aws": aws,
            "config_issues": config.runtime_issues(runtime, store, agent_provider),
        }

    @app.get("/api/coverage")
    def coverage():
        return {"systems": SYSTEMS, "challenges": CHALLENGES}

    @app.get("/api/integrations")
    def integrations():
        return {"integrations": config.integration_status(),
                "note": "Reports whether configuration is present. Values are never returned."}

    @app.get("/api/live-context")
    def live_context(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180),
                     alert_keyword: str = Query("", max_length=60), q: str = Query("", max_length=300)):
        return providers.live_context(lat, lon, alert_keyword, q)

    @app.post("/api/route")
    def calculate_route(body: RouteRequest):
        """Server-side Amazon Location route. HTTP 200 carries a status: only LIVE means a route was calculated."""
        return amazon_location.route(tuple(body.origin), tuple(body.destination), body.travel_mode).as_dict()

    @app.post("/api/scenarios/{sid}/rainfall-input")
    def rainfall_input(sid: str, body: RainfallRequest, request: Request):
        return service.apply_rainfall(sid, owner(request), body.lat, body.lon)

    @app.get("/api/scenarios/{sid}/audit/verify")
    def audit_verify(sid: str, request: Request):
        return service.verify_audit(sid, owner(request))

    @app.post("/api/scenarios", status_code=201)
    def new(body: CreateScenario, request: Request):
        return service.new(body.mode, owner(request))

    @app.get("/api/scenarios/{sid}")
    def get(sid: str, request: Request):
        return service.get(sid, owner(request))

    @app.get("/api/scenarios/{sid}/state")
    def state(sid: str, request: Request):
        return service.get(sid, owner(request))["state"]

    @app.get("/api/scenarios/{sid}/audit")
    def audit(sid: str, request: Request):
        return service.get(sid, owner(request))["audit"]

    def current_run(sid: str, request: Request) -> dict:
        d = service.get(sid, owner(request))
        if not d["run"]:
            raise RuleViolation("No analysis has been run yet; run the decision first")
        return d["run"]

    @app.get("/api/scenarios/{sid}/find-options")
    def find_options_view(sid: str, request: Request):
        return current_run(sid, request)["options"]

    @app.get("/api/scenarios/{sid}/counterfactual")
    def counterfactual_view(sid: str, request: Request):
        return current_run(sid, request)["plans"]

    @app.get("/api/scenarios/{sid}/robustness")
    def robustness_view(sid: str, request: Request):
        return current_run(sid, request)["robustness"]

    @app.get("/api/scenarios/{sid}/red-team")
    def red_team_view(sid: str, request: Request):
        return current_run(sid, request)["red_team"]

    @app.get("/api/scenarios/{sid}/voi")
    def voi_view(sid: str, request: Request):
        return current_run(sid, request)["voi"]

    def launch(sid: str, body: RunRequest, request: Request):
        actor = owner(request)
        d = service.get(sid, actor)
        if runtime == "local":
            return service.run(sid, actor, body.intervention)
        import boto3
        response = boto3.client("stepfunctions").start_execution(
            stateMachineArn=os.environ["ECHO_STATE_MACHINE_ARN"],
            name=f"echo-{uuid4()}",
            input=json.dumps({"scenario_id": sid, "owner": actor, "expected_version": d["version"],
                              "intervention": body.intervention.model_dump()
                              if body.intervention else None}))
        return JSONResponse({"execution_arn": response["executionArn"], "scenario_id": sid},
                            status_code=202)

    @app.post("/api/scenarios/{sid}/decision")
    def decision(sid: str, body: RunRequest, request: Request):
        return launch(sid, body, request)

    @app.post("/api/scenarios/{sid}/simulate")
    def simulation(sid: str, body: RunRequest, request: Request):
        return launch(sid, body, request)

    @app.post("/api/scenarios/{sid}/resimulate")
    def resimulate(sid: str, body: RunRequest, request: Request):
        return launch(sid, body, request)

    @app.get("/api/executions")
    def execution(arn: str, request: Request):
        if runtime != "aws":
            raise HTTPException(404, "AWS execution is unavailable in local mode")
        import boto3
        result = boto3.client("stepfunctions").describe_execution(executionArn=arn)
        data = json.loads(result["input"])
        service.get(data["scenario_id"], owner(request))
        return {"status": result["status"], "scenario_id": data["scenario_id"],
                "execution_arn": arn, "error": result.get("error")}

    @app.post("/api/scenarios/{sid}/verify")
    def verify(sid: str, body: VerifyRequest, request: Request):
        return service.verify(sid, owner(request), body.confirm_synthetic_measurement)

    @app.post("/api/scenarios/{sid}/human-decision")
    def human(sid: str, body: HumanRequest, request: Request):
        return service.human(sid, owner(request), body)

    @app.post("/api/scenarios/{sid}/execute")
    def execute(sid: str, body: ExecuteRequest, request: Request):
        return service.execute(sid, owner(request), body.run_id)

    @app.post("/api/scenarios/{sid}/safety-check")
    def safety(sid: str, body: ExecuteRequest, request: Request):
        d = service.get(sid, owner(request))
        r = service.verify_gate(d, body.run_id)
        return {"allowed": True, "run_id": r["id"], "scope": "SIMULATION AUTHORIZATION ONLY"}

    return app


app = create_app()
