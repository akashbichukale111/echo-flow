# Architecture

```
React SPA (Vite)  --HTTPS-->  FastAPI  -->  Engines (deterministic)
                                 |-->  Repository: SQLite (local) | DynamoDB (AWS)
                                 |-->  Providers: demo | WeatherAPI | IMD* | CGWB*   (*interface only)
                                 `-->  Bedrock explainer (optional, explanation only)
AWS: API Gateway HTTP API -> Lambda (Mangum) -> DynamoDB ; S3 evidence bucket ;
     Step Functions observer workflow -> Lambda ; CloudWatch logs/X-Ray
```

## Backend modules (`backend/app`)
- `models.py` strict Pydantic models and the `Record` provenance type.
- `engines.py` WaterBufferEngine, ShortageClockEngine, RiskEngine, LossImpactEngine,
  TankerCapacityEngine, ScenarioEngine (+ `project`), VerificationEngine.
- `agents.py` WaterWatcher, CauseAgent, LossAnalyzer, WhatIfAgent, Validator, ActionPlanner,
  VerificationAgent. Deterministic; Bedrock is isolated in `integrations.BedrockExplainer`.
- `service.py` analysis and the action lifecycle (DRAFT -> APPROVED/REJECTED -> EXECUTED -> VERIFIED).
- `repositories.py` SQLite and DynamoDB with optimistic concurrency.
- `integrations.py` provider protocols and adapters.
- `main.py` API, CORS, auth (pilot), size and rate limits, safe errors.
- `lambda_handler.py`, `workflow.py` AWS entry points.

## Decision loop
WATCH (buffer) -> DIAGNOSE (drivers) -> SIMULATE (4 scenarios) -> VALIDATE (constraints,
missing info) -> APPROVE (human) -> ACT (execution recorded by a human) -> VERIFY
(operator-entered observation). Step Functions mirrors these stages as an observer and cannot
approve or execute.

## Design choices
- Actions snapshot all zone versions; a changed zone makes a plan stale (409).
- Every record carries source, source_type, timestamp, confidence, location, value, unit.
- Data classes: PUBLIC DATA, OPERATOR INPUT, DEMO DATA, MODEL OUTPUT, AI RECOMMENDATION.
