"""CWC / C-FLOOD adapter. No public endpoint is assumed: it only runs against an operator-supplied URL."""
import json
import os

from . import base

PURPOSE = "River water levels / flood forecast evidence (CWC / C-FLOOD)"
LIMITS = "Payload is passed through un-normalized; schema depends on the configured endpoint."


def fetch() -> base.ProviderResult:
    url = (os.getenv("CWC_API_URL") or os.getenv("CFLOOD_DATA_URL") or "").strip()
    if not url:
        return base.not_connected("cwc-cflood", PURPOSE,
                                  "CWC_API_URL / CFLOOD_DATA_URL is not configured", LIMITS)

    def call() -> base.ProviderResult:
        d = base.get_json(url)
        text = json.dumps(d)
        return base.ProviderResult(provider="cwc-cflood", status="LIVE", provenance=base.REAL, purpose=PURPOSE,
                                   source_url=url, fetched_at=base.utcnow(), limitations=LIMITS,
                                   data={"payload": d if len(text) < 20000 else None,
                                         "truncated": len(text) >= 20000})

    return base.guarded("cwc-cflood", PURPOSE, call, cache_key=f"cwc:{url}", ttl=300, limitations=LIMITS)
