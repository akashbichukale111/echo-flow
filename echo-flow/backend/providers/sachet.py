"""NDMA SACHET public CAP RSS feed. ETag-aware polling; official alerts, not model output."""
import os

from defusedxml import ElementTree as ET

from . import base

PURPOSE = "Official disaster alerts (NDMA SACHET CAP/RSS)"
DEFAULT_URL = "https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml"
LIMITS = "Alert text is reported as published. Area matching is by keyword only, not geometry."
_etag: dict[str, tuple[str, list]] = {}


def parse(xml_bytes: bytes) -> list[dict]:
    root = ET.fromstring(xml_bytes)
    items = []
    for it in root.iter("item"):
        def t(name: str) -> str:
            el = it.find(name)
            return (el.text or "").strip() if el is not None and el.text else ""
        items.append({"title": t("title"), "description": t("description")[:600],
                      "link": t("link"), "published": t("pubDate"), "category": t("category"),
                      "author": t("author")})
    return items


def fetch(keyword: str = "", limit: int = 20) -> base.ProviderResult:
    url = os.getenv("SACHET_CAP_RSS_URL", DEFAULT_URL)

    def call() -> base.ProviderResult:
        headers = {"Accept": "application/rss+xml, application/xml"}
        known = _etag.get(url)
        if known:
            headers["If-None-Match"] = known[0]
        status, hdrs, raw = base.transport("GET", url, headers, None, base.DEFAULT_TIMEOUT)
        if status == 304 and known:
            items, revalidated = known[1], True
        else:
            items, revalidated = parse(raw), False
            if hdrs.get("etag"):
                _etag[url] = (hdrs["etag"], items)
        kw = keyword.strip().lower()
        matched = [i for i in items if not kw or kw in (i["title"] + " " + i["description"]).lower()]
        return base.ProviderResult(
            provider="ndma-sachet", status="LIVE", provenance=base.REAL, purpose=PURPOSE,
            source_url=url, fetched_at=base.utcnow(), limitations=LIMITS,
            detail="Feed revalidated via ETag (304)" if revalidated else "Feed downloaded",
            data={"total_in_feed": len(items), "keyword": keyword or None,
                  "alerts": matched[:max(1, min(limit, 50))]})

    return base.guarded("ndma-sachet", PURPOSE, call, cache_key=f"sachet:{url}:{keyword.lower()}",
                        ttl=120, limitations=LIMITS)
