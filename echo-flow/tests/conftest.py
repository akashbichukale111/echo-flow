import pytest

from backend.providers import base, sachet


@pytest.fixture(autouse=True)
def clean_provider_state(monkeypatch):
    base.cache_clear()
    sachet._etag.clear()
    for var in ("TAVILY_API_KEY", "NASA_EARTHDATA_TOKEN", "CWC_API_URL", "CFLOOD_DATA_URL",
                "SACHET_CAP_RSS_URL", "WEATHER_API_URL", "ECHO_AUDIT_TABLE"):
        monkeypatch.delenv(var, raising=False)
    # No test may touch the real network: any un-mocked call fails loudly as UNAVAILABLE.
    def blocked(*a, **k):
        raise base.HttpFailure("UNAVAILABLE", "network blocked in tests")
    monkeypatch.setattr(base, "transport", blocked)
    yield
    base.cache_clear()
