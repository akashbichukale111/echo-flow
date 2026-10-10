import json

import pytest

from backend import providers
from backend.providers import base, cwc, nasa_gpm, open_meteo, opera_dswx, sachet, tavily

RSS = b"""<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Heat Wave Warning - Vidarbha</title><description>Severe heat</description>
<link>https://sachet.ndma.gov.in/a.xml</link><pubDate>Mon, 01 Jan 2026 10:00:00 +0530</pubDate></item>
<item><title>Thunderstorm - Kerala</title><description>Lightning</description><link>https://x/b.xml</link></item>
</channel></rss>"""

OM = {"current": {"temperature_2m": 31.2, "precipitation": 0.4}, "current_units": {"temperature_2m": "C"},
      "hourly": {"precipitation": [0.0, 2.5, 7.0, 1.0], "precipitation_probability": [10, 60, 90, 20],
                 "temperature_2m": [30, 31, 32, 31]}}


def reply(payload, status=200, headers=None):
    body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
    return lambda *a, **k: (status, headers or {}, body)


def test_open_meteo_live_and_cached(monkeypatch):
    calls = []
    def t(method, url, headers, body, timeout):
        calls.append(url)
        return 200, {}, json.dumps(OM).encode()
    monkeypatch.setattr(base, "transport", t)
    r = open_meteo.fetch(19.07, 72.87)
    assert r.status == "LIVE" and r.provenance == "REAL / PUBLIC"
    assert r.data["next_24h"]["max_hourly_precip_mm"] == 7.0
    assert "not observed flood extent" in r.limitations.lower()
    again = open_meteo.fetch(19.07, 72.87)
    assert again.cached and len(calls) == 1


def test_open_meteo_rejects_bad_coordinates():
    with pytest.raises(ValueError):
        open_meteo.fetch(120, 0)


def test_timeout_is_unavailable_not_exception():
    r = open_meteo.fetch(19.07, 72.87)  # conftest blocks network
    assert r.status == "UNAVAILABLE" and r.data is None


def test_rate_limit_triggers_cooldown(monkeypatch):
    n = {"c": 0}
    def t(*a, **k):
        n["c"] += 1
        raise base.HttpFailure("UNAVAILABLE", "HTTP 429", 429, 30)
    monkeypatch.setattr(base, "transport", t)
    assert open_meteo.fetch(1, 1).status == "UNAVAILABLE"
    second = open_meteo.fetch(2, 2)
    assert "cooling down" in second.detail and n["c"] == 1


def test_non_json_is_error_not_crash(monkeypatch):
    monkeypatch.setattr(base, "transport", reply(b"<html>nope</html>"))
    assert open_meteo.fetch(1, 1).status == "ERROR"


def test_sachet_parse_filter_and_etag(monkeypatch):
    seen = []
    def t(method, url, headers, body, timeout):
        seen.append(headers.get("If-None-Match"))
        if headers.get("If-None-Match") == "abc":
            return 304, {}, b""
        return 200, {"etag": "abc"}, RSS
    monkeypatch.setattr(base, "transport", t)
    r = sachet.fetch("heat")
    assert r.status == "LIVE" and r.data["total_in_feed"] == 2
    assert [a["title"] for a in r.data["alerts"]] == ["Heat Wave Warning - Vidarbha"]
    base.cache_clear()  # force revalidation path; keep ETag store
    r2 = sachet.fetch("")
    assert seen == [None, "abc"] and "304" in r2.detail and r2.data["total_in_feed"] == 2


def test_sachet_rejects_entity_bomb(monkeypatch):
    bomb = b'<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "x"><!ENTITY b "&a;&a;&a;">]><rss><channel><item><title>&b;</title></item></channel></rss>'
    monkeypatch.setattr(base, "transport", reply(bomb))
    assert sachet.fetch().status == "ERROR"


def test_tavily_not_connected_without_key():
    r = tavily.fetch("flood relief camp")
    assert r.status == "NOT_CONNECTED" and "TAVILY_API_KEY" in r.detail


def test_tavily_live_is_evidence_only(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-test")
    captured = {}
    def t(method, url, headers, body, timeout):
        captured.update(headers=headers, body=json.loads(body))
        return 200, {}, json.dumps({"results": [{"title": "t", "url": "https://u", "content": "c", "score": .9}]}).encode()
    monkeypatch.setattr(base, "transport", t)
    r = tavily.fetch("mumbai flood shelters")
    assert r.status == "LIVE" and r.data["results"][0]["url"] == "https://u"
    assert "never used for coordinates" in r.limitations
    assert captured["headers"]["Authorization"] == "Bearer tvly-test"
    assert "tvly-test" not in json.dumps(r.as_dict())  # secret never echoed back


def test_gpm_never_invents_precipitation(monkeypatch):
    assert nasa_gpm.fetch(1, 1).status == "NOT_CONNECTED"
    monkeypatch.setenv("NASA_EARTHDATA_TOKEN", "t")
    r = nasa_gpm.fetch(1, 1)
    assert r.status == "NOT_CONNECTED" and r.data is None and "not implemented" in r.detail


def test_cwc_requires_configured_url(monkeypatch):
    assert cwc.fetch().status == "NOT_CONNECTED"
    monkeypatch.setenv("CWC_API_URL", "https://example.test/levels.json")
    monkeypatch.setattr(base, "transport", reply({"stations": [1]}))
    r = cwc.fetch()
    assert r.status == "LIVE" and r.data["payload"] == {"stations": [1]}


def test_plain_http_upstream_is_refused(monkeypatch):
    monkeypatch.undo()
    with pytest.raises(base.HttpFailure):
        base.transport("GET", "http://insecure.test", {}, None, 1)


def test_dswx_is_availability_only(monkeypatch):
    monkeypatch.setattr(base, "transport", reply({"feed": {"entry": [{"title": "OPERA_L3_DSWx-S1_X", "time_start": "t"}]}}))
    r = opera_dswx.fetch(19.07, 72.87)
    assert r.status == "LIVE" and r.data["granules_returned"] == 1
    assert "no raster downloaded" in r.limitations.lower()


def test_live_context_isolates_failures(monkeypatch):
    def t(method, url, headers, body, timeout):
        if "open-meteo" in url:
            return 200, {}, json.dumps(OM).encode()
        raise base.HttpFailure("UNAVAILABLE", "boom")
    monkeypatch.setattr(base, "transport", t)
    ctx = providers.live_context(19.07, 72.87, evidence_query="x")
    p = ctx["providers"]
    assert p["weather"]["status"] == "LIVE"
    assert p["alerts"]["status"] == "UNAVAILABLE"
    assert p["precipitation_imerg"]["status"] == "NOT_CONNECTED"
    assert p["evidence"]["status"] == "NOT_CONNECTED"
