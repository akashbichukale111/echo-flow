"""Graceful configuration validation. Reports presence only; never returns or logs a value."""
import os

# (env var, integration, required for, secret?)
VARIABLES = [
    ("AWS_REGION", "aws", "AWS SDK region (also AWS_DEFAULT_REGION)", False),
    ("ECHO_BEDROCK_MODEL_ID", "bedrock", "Agent reasoning via Amazon Bedrock", False),
    ("TAVILY_API_KEY", "tavily", "Evidence search", True),
    ("NASA_EARTHDATA_TOKEN", "nasa-gpm-imerg", "IMERG precipitation (adapter not yet fetching)", True),
    ("NASA_PPS_USERNAME", "nasa-gpm-imerg", "IMERG PPS access (alternative)", False),
    ("NASA_PPS_PASSWORD", "nasa-gpm-imerg", "IMERG PPS access (alternative)", True),
    ("SACHET_CAP_RSS_URL", "ndma-sachet", "Official alerts (defaults to the public feed)", False),
    ("CWC_API_URL", "cwc-cflood", "River levels / flood forecast", False),
    ("CFLOOD_DATA_URL", "cwc-cflood", "Inundation forecast evidence", False),
    ("WEATHER_API_URL", "open-meteo", "Weather (defaults to public Open-Meteo)", False),
    ("AMAZON_LOCATION_API_KEY", "amazon-location", "Server-side route calculation (POST /api/route)", True),
    ("AMAZON_LOCATION_ROUTE_CALCULATOR", "amazon-location", "Route calculator resource name", False),
    ("AMAZON_LOCATION_REGION", "amazon-location", "Amazon Location region for the resources", False),
    ("ECHO_BUCKET", "s3", "Scenario snapshots", False),
    ("ECHO_TABLE", "dynamodb", "Scenario version pointers", False),
    ("ECHO_AUDIT_TABLE", "dynamodb-audit", "Append-only audit table", False),
    ("ECHO_STATE_MACHINE_ARN", "step-functions", "Decision workflow", False),
]

# Integrations that work without any configuration.
DEFAULTED = {"ndma-sachet": "public RSS feed", "open-meteo": "public API, no key", "nasa-opera-dswx-s1": "public CMR search"}


def integration_status() -> list[dict]:
    present: dict[str, list[dict]] = {}
    for var, integ, purpose, secret in VARIABLES:
        present.setdefault(integ, []).append(
            {"variable": var, "set": bool(os.getenv(var, "").strip()), "secret": secret, "purpose": purpose})
    rows = []
    for integ, vars_ in present.items():
        rows.append({"integration": integ, "variables": vars_, "any_configured": any(v["set"] for v in vars_),
                     "works_unconfigured": integ in DEFAULTED, "note": DEFAULTED.get(integ, "")})
    for integ, note in DEFAULTED.items():
        if integ not in present:
            rows.append({"integration": integ, "variables": [], "any_configured": False,
                         "works_unconfigured": True, "note": note})
    return rows


def runtime_issues(runtime: str, store: str, agent_provider: str) -> list[str]:
    issues = []
    if store == "dynamodb":
        for v in ("ECHO_TABLE", "ECHO_BUCKET"):
            if not os.getenv(v):
                issues.append(f"{v} is required when ECHO_STORE=dynamodb")
    if agent_provider == "bedrock" and not os.getenv("ECHO_BEDROCK_MODEL_ID"):
        issues.append("ECHO_BEDROCK_MODEL_ID is required when ECHO_AGENT_PROVIDER=bedrock")
    if runtime == "aws" and not os.getenv("ECHO_ALLOWED_ORIGINS"):
        issues.append("ECHO_ALLOWED_ORIGINS should be set explicitly in AWS runtime")
    return issues
