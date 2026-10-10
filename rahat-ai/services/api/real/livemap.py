"""RAHAT LIVE map proxy. The Amazon Location API key stays on the server: the browser only ever
sees /api/live/map/* URLs. Style descriptor, glyphs, sprites and tiles are fetched server-side."""
import re

import httpx
from fastapi import APIRouter, HTTPException, Request, Response

from .config import load_settings

PLACEHOLDER = "__RAHAT_MAP__"
_client = httpx.Client(timeout=15.0)


def build_livemap_router(engine=None) -> APIRouter:
    r = APIRouter(prefix="/api/live")

    def base():
        s = load_settings()
        if not (s.real_enabled and s.has_location):
            raise HTTPException(503, "MAP / ROUTE SERVICE UNAVAILABLE: Amazon Location is not configured.")
        return s, f"https://maps.geo.{s.aws_region}.amazonaws.com/v2"

    @r.get("/map/style")
    def style(theme: str = "Dark"):
        s, b = base()
        theme = "Light" if theme == "Light" else "Dark"
        try:
            resp = _client.get(f"{b}/styles/Standard/descriptor",
                               params={"color-scheme": theme, "key": s.location_api_key})
            resp.raise_for_status()
        except Exception:
            raise HTTPException(503, "MAP / ROUTE SERVICE UNAVAILABLE") from None
        text = resp.text.replace(b, PLACEHOLDER)
        text = re.sub(r"([?&])key=[^&\"']*&?", r"\1", text)  # never forward a key to the browser
        return Response(text, media_type="application/json", headers={"Cache-Control": "public, max-age=600"})

    @r.get("/relief")
    def relief(lat: float, lon: float, radius_m: float = 1200):
        """Mapped relief points around a real GPS fix. Never returns demo fixtures."""
        if engine is None or not engine.s.real_enabled:
            return {"items": [], "available": False, "evidence": None}
        from .relief import rank_relief
        radius_m = max(200.0, min(radius_m, 2500.0))
        items, ev = engine.overpass.relief(lat, lon, radius_m=radius_m)
        items = [i for i in items if i.get("sourceType") != "DEMO_DATA"]
        ok = ev.get("sourceType") != "DEMO_DATA" and not ev.get("unavailable")
        return {"items": rank_relief(items, lat, lon, limit=60) if items else [], "available": ok, "evidence": ev}

    @r.get("/map/{path:path}")
    def proxy(path: str, request: Request):
        s, b = base()
        if ".." in path:
            raise HTTPException(400, "Bad path")
        params = {k: v for k, v in request.query_params.items() if k != "key"}
        params["key"] = s.location_api_key
        try:
            resp = _client.get(f"{b}/{path}", params=params)
        except Exception:
            raise HTTPException(503, "MAP / ROUTE SERVICE UNAVAILABLE") from None
        if resp.status_code >= 400:
            raise HTTPException(resp.status_code if resp.status_code in (400, 403, 404) else 503, "Map tile unavailable")
        return Response(resp.content, media_type=resp.headers.get("content-type", "application/octet-stream"),
                        headers={"Cache-Control": "public, max-age=3600"})

    return r
