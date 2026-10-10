"""Tavily: EVIDENCE SEARCH only. Never a source of coordinates, distance, capacity or hydraulics."""
import os

from . import base

PURPOSE = "Current public evidence search (municipal / emergency / candidate-location evidence)"
LIMITS = ("Search snippets are evidence to be verified by a human. Tavily is not geographic truth and "
          "is never used for coordinates, distance, capacity or hydraulic feasibility.")
URL = "https://api.tavily.com/search"


def fetch(query: str, max_results: int = 5) -> base.ProviderResult:
    key = os.getenv("TAVILY_API_KEY", "").strip()
    if not key:
        return base.not_connected("tavily", PURPOSE, "TAVILY_API_KEY is not configured", LIMITS)
    query = query.strip()[:300]
    if not query:
        raise ValueError("Query is required")

    def call() -> base.ProviderResult:
        d = base.post_json(URL, {"query": query, "search_depth": "basic",
                                 "max_results": max(1, min(max_results, 10)), "include_answer": False},
                           headers={"Authorization": f"Bearer {key}"})
        results = [{"title": r.get("title", ""), "url": r.get("url", ""),
                    "snippet": str(r.get("content", ""))[:500], "score": r.get("score")}
                   for r in d.get("results", []) if isinstance(r, dict)]
        return base.ProviderResult(provider="tavily", status="LIVE", provenance=base.REAL, purpose=PURPOSE,
                                   source_url=URL, fetched_at=base.utcnow(), limitations=LIMITS,
                                   data={"query": query, "results": results})

    return base.guarded("tavily", PURPOSE, call, cache_key=f"tavily:{query.lower()}", ttl=900,
                        limitations=LIMITS)
