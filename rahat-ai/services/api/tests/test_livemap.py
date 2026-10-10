from fastapi.testclient import TestClient

from main import create_app


def test_live_map_style_unavailable_without_key(monkeypatch):
    monkeypatch.setenv("PROVIDER_MODE", "real")
    monkeypatch.setenv("AWS_LOCATION_API_KEY", "")
    c = TestClient(create_app())
    r = c.get("/api/live/map/style")
    assert r.status_code == 503 and "UNAVAILABLE" in r.json()["detail"]


def test_live_map_proxy_blocks_traversal_and_missing_key(monkeypatch):
    monkeypatch.setenv("PROVIDER_MODE", "real")
    monkeypatch.setenv("AWS_LOCATION_API_KEY", "")
    c = TestClient(create_app())
    assert c.get("/api/live/map/tiles/1/2/3").status_code == 503


def test_live_relief_never_returns_demo_fixtures(monkeypatch):
    monkeypatch.setenv("PROVIDER_MODE", "demo")
    c = TestClient(create_app())
    r = c.get("/api/live/relief?lat=18.52&lon=73.85")
    assert r.status_code == 200 and r.json()["items"] == [] and r.json()["available"] is False


def test_live_relief_reports_provider_failure_instead_of_empty_success(monkeypatch):
    """A failed Overpass call must read as 'unavailable', never as 'nothing mapped nearby'."""
    import real.overpass as ov
    monkeypatch.setenv("PROVIDER_MODE", "real")
    monkeypatch.setenv("AWS_LOCATION_API_KEY", "")
    c = TestClient(create_app())

    def boom(self, *a, **k):
        raise RuntimeError("overpass down")
    monkeypatch.setattr(ov.OverpassService, "_query", boom)
    r = c.get("/api/live/relief?lat=18.52&lon=73.85")
    assert r.status_code == 200
    body = r.json()
    assert body["items"] == [] and body["available"] is False
