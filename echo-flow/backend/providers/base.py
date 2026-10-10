"""Shared provider plumbing: result contract, timeouts, TTL cache, rate-limit cooldown.

Every provider returns a ProviderResult and NEVER raises into the decision system.
Status vocabulary (shown verbatim in the UI):
  LIVE          real response received from the upstream source just now (or from cache, see `cached`)
  NOT_CONNECTED required configuration/credentials are absent; nothing was requested
  UNAVAILABLE   upstream was reachable in principle but timed out / rate-limited / returned nothing usable
  ERROR         unexpected failure (logged)
"""
from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

log = logging.getLogger("echo-flow.providers")

REAL = "REAL / PUBLIC"
SIMULATED = "SIMULATED"
DERIVED = "DERIVED"
AI = "AI REASONING"
PROVENANCE_LABELS = (REAL, SIMULATED, DERIVED, AI)

DEFAULT_TIMEOUT = 8.0
MAX_BYTES = 2_000_000


@dataclass
class ProviderResult:
    provider: str
    status: str
    provenance: str = REAL
    purpose: str = ""
    detail: str = ""
    data: Any = None
    source_url: str = ""
    fetched_at: str = ""
    latency_ms: float = 0.0
    cached: bool = False
    limitations: str = ""

    def as_dict(self) -> dict:
        return asdict(self)


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def not_connected(provider: str, purpose: str, detail: str, limitations: str = "") -> ProviderResult:
    return ProviderResult(provider=provider, status="NOT_CONNECTED", purpose=purpose,
                          detail=detail, fetched_at=utcnow(), limitations=limitations)


class HttpFailure(Exception):
    def __init__(self, kind: str, detail: str, status: int | None = None, retry_after: float | None = None):
        super().__init__(detail)
        self.kind, self.detail, self.status, self.retry_after = kind, detail, status, retry_after


def transport(method: str, url: str, headers: dict, body: bytes | None, timeout: float) -> tuple[int, dict, bytes]:
    """Single network seam. Tests replace this function; nothing else touches the network."""
    if not url.startswith("https://"):
        raise HttpFailure("ERROR", "Only https:// upstream URLs are permitted")
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (https enforced above)
            raw = resp.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                raise HttpFailure("ERROR", "Upstream response exceeded size limit")
            return resp.status, {k.lower(): v for k, v in resp.headers.items()}, raw
    except urllib.error.HTTPError as exc:
        hdrs = {k.lower(): v for k, v in (exc.headers or {}).items()}
        if exc.code == 304:
            return 304, hdrs, b""
        retry = None
        try:
            retry = float(hdrs.get("retry-after", ""))
        except ValueError:
            pass
        raise HttpFailure("UNAVAILABLE", f"HTTP {exc.code}", exc.code, retry) from exc
    except (TimeoutError, urllib.error.URLError, OSError) as exc:
        raise HttpFailure("UNAVAILABLE", f"{type(exc).__name__}: upstream unreachable or timed out") from exc


_cache: dict[str, tuple[float, Any]] = {}
_cooldown: dict[str, float] = {}


def cache_get(key: str, ttl: float):
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < ttl:
        return hit[1]
    return None


def cache_put(key: str, value: Any) -> None:
    if len(_cache) > 256:
        _cache.clear()
    _cache[key] = (time.monotonic(), value)


def cache_clear() -> None:
    _cache.clear()
    _cooldown.clear()


def guarded(provider: str, purpose: str, fn: Callable[[], ProviderResult], *,
            cache_key: str | None = None, ttl: float = 300.0, limitations: str = "") -> ProviderResult:
    """Run one provider call with cache, rate-limit cooldown, timing and failure isolation."""
    if cache_key:
        hit = cache_get(cache_key, ttl)
        if hit is not None:
            return ProviderResult(**{**hit.as_dict(), "cached": True})
    if _cooldown.get(provider, 0) > time.monotonic():
        return ProviderResult(provider=provider, status="UNAVAILABLE", purpose=purpose,
                              detail="Rate-limited upstream; cooling down before retry",
                              fetched_at=utcnow(), limitations=limitations)
    started = time.monotonic()
    try:
        result = fn()
    except HttpFailure as exc:
        if exc.status == 429:
            _cooldown[provider] = time.monotonic() + min(exc.retry_after or 60.0, 600.0)
        log.warning(json.dumps({"event": "provider_failure", "provider": provider,
                                "kind": exc.kind, "detail": exc.detail}))
        result = ProviderResult(provider=provider, status=exc.kind, purpose=purpose,
                                detail=exc.detail, fetched_at=utcnow(), limitations=limitations)
    except Exception as exc:  # providers must never crash the decision system
        log.error(json.dumps({"event": "provider_error", "provider": provider,
                              "error_type": type(exc).__name__}))
        result = ProviderResult(provider=provider, status="ERROR", purpose=purpose,
                                detail=f"Unexpected {type(exc).__name__}; no data assumed",
                                fetched_at=utcnow(), limitations=limitations)
    result.latency_ms = round((time.monotonic() - started) * 1000, 1)
    if cache_key and result.status == "LIVE":
        cache_put(cache_key, result)
    return result


def get_json(url: str, headers: dict | None = None, timeout: float = DEFAULT_TIMEOUT) -> dict:
    status, _h, raw = transport("GET", url, {"Accept": "application/json", **(headers or {})}, None, timeout)
    return json.loads(raw)


def post_json(url: str, payload: dict, headers: dict | None = None, timeout: float = DEFAULT_TIMEOUT) -> dict:
    body = json.dumps(payload).encode()
    status, _h, raw = transport("POST", url, {"Content-Type": "application/json",
                                              "Accept": "application/json", **(headers or {})}, body, timeout)
    return json.loads(raw)
