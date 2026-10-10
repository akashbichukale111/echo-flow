"""Provider registry and fan-out. Each provider is isolated: one failure never blocks the others."""
from concurrent.futures import ThreadPoolExecutor

from . import base, cwc, nasa_gpm, open_meteo, opera_dswx, sachet, tavily


def live_context(lat: float, lon: float, alert_keyword: str = "", evidence_query: str = "") -> dict:
    open_meteo.check_coords(lat, lon)
    jobs = {
        "weather": lambda: open_meteo.fetch(lat, lon),
        "alerts": lambda: sachet.fetch(alert_keyword),
        "precipitation_imerg": lambda: nasa_gpm.fetch(lat, lon),
        "river_levels": lambda: cwc.fetch(),
        "satellite_water": lambda: opera_dswx.fetch(lat, lon),
    }
    if evidence_query.strip():
        jobs["evidence"] = lambda: tavily.fetch(evidence_query)

    def safe(name, fn):
        try:
            return fn()
        except Exception as exc:  # last-resort isolation
            return base.ProviderResult(provider=name, status="ERROR", detail=type(exc).__name__,
                                       fetched_at=base.utcnow())

    with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        futures = {k: pool.submit(safe, k, fn) for k, fn in jobs.items()}
        out = {k: f.result().as_dict() for k, f in futures.items()}
    return {"lat": lat, "lon": lon, "fetched_at": base.utcnow(), "providers": out}
