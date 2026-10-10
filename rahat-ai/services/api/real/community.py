"""Community reports. They never become authoritative on their own."""
from datetime import datetime, timezone

KINDS = ("SHADE HERE", "WATER HERE", "COOLING HERE", "REST POINT", "NO WATER", "SHADE REMOVED",
         "STATION CLOSED")
STATUSES = ("UNVERIFIED", "COMMUNITY_VERIFIED", "SYSTEM_VERIFIED")
TYPE_OF = {"SHADE HERE": "SHADE", "WATER HERE": "WATER", "COOLING HERE": "COOLING", "REST POINT": "REST"}
NEGATIVE = {"NO WATER": "WATER", "SHADE REMOVED": "SHADE", "STATION CLOSED": None}
CONFIRMATIONS_NEEDED = 2


def new_report(kind, lat, lon, note="", now=None):
    if kind not in KINDS:
        raise ValueError("Unknown report type")
    return {"kind": kind, "latitude": lat, "longitude": lon, "note": note[:500],
            "type": TYPE_OF.get(kind) or NEGATIVE.get(kind), "negative": kind in NEGATIVE,
            "source": "COMMUNITY_REPORT", "sourceType": "COMMUNITY_REPORT",
            "status": "UNVERIFIED", "confidence": "LOW", "availability": "USER_REPORTED",
            "reportedAt": (now or datetime.now(timezone.utc)).isoformat(),
            "confirmations": [], "lastVerified": None}


def confirm(report, confirmer_id):
    """Distinct confirmers promote UNVERIFIED -> COMMUNITY_VERIFIED. SYSTEM_VERIFIED is never set here."""
    r = dict(report)
    if confirmer_id not in r["confirmations"]:
        r["confirmations"] = [*r["confirmations"], confirmer_id]
    if r["status"] == "UNVERIFIED" and len(r["confirmations"]) >= CONFIRMATIONS_NEEDED:
        r["status"] = "COMMUNITY_VERIFIED"
        r["confidence"] = "MEDIUM"
    return r


def as_relief(report):
    """Positive reports become low-confidence relief items; negative ones are returned separately."""
    return {"id": f"report-{report['id']}", "type": report["type"], "name": report["kind"].title(),
            "latitude": report["latitude"], "longitude": report["longitude"],
            "source": "COMMUNITY_REPORT", "sourceType": "COMMUNITY_REPORT", "status": report["status"],
            "confidence": report["confidence"], "availability": "USER_REPORTED",
            "lastVerified": report.get("lastVerified"), "freshness": "RECENT",
            "reportedAt": report["reportedAt"]}


def apply_negatives(items, reports, radius_m=60):
    """A negative report marks nearby items REPORTED_UNAVAILABLE (still shown, ranked down, labelled)."""
    from .geo import haversine
    out = []
    for it in items:
        it = dict(it)
        for r in reports:
            if r.get("negative") and (r["type"] in (None, it["type"])) and haversine(
                    it["latitude"], it["longitude"], r["latitude"], r["longitude"]) <= radius_m:
                it["availability"] = "REPORTED_UNAVAILABLE"
                it["reportNote"] = f"{r['kind']} · {r['status']} · community report"
        out.append(it)
    return out
