"""Normalized RAHAT data models shared by real and demo providers."""
from datetime import datetime, timezone

SOURCE_TYPES = ("PUBLIC_API", "USER_INPUT", "COMMUNITY_REPORT", "DEMO_DATA",
                "MODEL_ESTIMATE", "AI_EXPLANATION")
BADGE = {"PUBLIC_API": "PUBLIC DATA", "USER_INPUT": "USER INPUT",
         "COMMUNITY_REPORT": "COMMUNITY REPORT", "DEMO_DATA": "DEMO DATA",
         "MODEL_ESTIMATE": "MODEL ESTIMATE", "AI_EXPLANATION": "AI EXPLANATION"}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def freshness(observed_iso, now=None, live_min=30, recent_days=30):
    """LIVE / RECENT / HISTORICAL / UNKNOWN from a timestamp; never invented."""
    if not observed_iso:
        return "UNKNOWN"
    try:
        t = datetime.fromisoformat(str(observed_iso).replace("Z", "+00:00"))
    except ValueError:
        return "UNKNOWN"
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    age = ((now or datetime.now(timezone.utc)) - t).total_seconds()
    if age <= live_min * 60:
        return "LIVE"
    return "RECENT" if age <= recent_days * 86400 else "HISTORICAL"


def evidence(key, source, source_type, confidence, observed_at=None, limitations="",
             fresh=None, extra=None):
    out = {
        "key": key, "source": source, "sourceType": source_type,
        "badge": BADGE[source_type], "confidence": confidence,
        "observedAt": observed_at,
        "freshness": fresh if fresh is not None else freshness(observed_at),
        "limitations": limitations,
    }
    if extra:
        out.update(extra)
    return out
