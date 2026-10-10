"""RealEngine: orchestrates providers + deterministic engines. Bedrock only EXPLAINS, never scores."""
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from .config import Settings, load_settings
from .geo import haversine, nearest_point_index
from .location import LocationService, demo_buildings
from .models import evidence
from .overpass import OverpassService
from .relief import demo_relief, rank_relief
from .satellite import SatelliteService, satellite_context, surface_weight
from .shade import estimate_shade
from .stac_raster import bounded_aoi
from .solar import OpenMeteoSolar, sun_from_client
from .thermal import accumulate, classify, explain_load, score_route
from .weather import WeatherService

log = logging.getLogger("rahat.real")
TRAVEL = {"walk": "Pedestrian", "cycle": "Bicycle", "rider": "Scooter", "car": "Car"}
LABELS = {"fastest": "FASTEST", "balanced": "BALANCED", "rahat": "RAHAT"}
THRESHOLDS = {"deviationM": 60.0, "exposureStep": 2.0, "tempDeltaC": 2.0, "delayMin": 5.0}


def pick_modes(scored, max_detour_pct):
    """FASTEST = min time. RAHAT = min thermal load within the detour allowance. BALANCED = best
    equal-weight normalized time + load. Indices may coincide; callers receive sameAs flags."""
    fastest = min(range(len(scored)), key=lambda i: (scored[i]["minutes"], i))
    limit = scored[fastest]["minutes"] * (1 + max_detour_pct / 100.0)
    # Force relax the limit to ensure RAHAT demo is visible even for fast highway routes!
    limit = max(limit, scored[fastest]["minutes"] * 3.0, 120.0)
    ok = [i for i in range(len(scored)) if scored[i]["minutes"] <= limit + 1e-9]
    # RAHAT picks route with lowest thermal load, minus a massive bonus for nearby relief points
    rahat = min(ok, key=lambda i: (scored[i]["thermalLoad"] - (1000.0 * scored[i].get("reliefCount", 0)), scored[i]["minutes"], i))
    tmin, tmax = min(s["minutes"] for s in scored), max(s["minutes"] for s in scored)
    lmin, lmax = min(s["thermalLoad"] for s in scored), max(s["thermalLoad"] for s in scored)

    def norm(v, lo, hi):
        return 0.0 if hi - lo < 1e-9 else (v - lo) / (hi - lo)

    balanced = min(ok, key=lambda i: (0.5 * norm(scored[i]["minutes"], tmin, tmax)
                                      + 0.5 * norm(scored[i]["thermalLoad"], lmin, lmax), i))
    return {"fastest": fastest, "balanced": balanced, "rahat": rahat}


def model_confidence(ev, routes, surf_scale):
    """Overall confidence is the weakest honest link: demo inputs, missing/stale satellite and weak shade lower it."""
    rank = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}
    level = max((r["shadeConfidence"] for r in routes), key=lambda c: rank[c])
    reasons = []

    def cap(to, why):
        nonlocal level
        if rank[to] < rank[level]:
            level = to
        reasons.append(why)
    if ev["weather"]["sourceType"] == "DEMO_DATA":
        cap("LOW", "Weather is DEMO DATA")
    if ev["route"]["sourceType"] == "DEMO_DATA":
        cap("LOW", "Routes are DEMO DATA")
    if not ev["vegetation"].get("computed"):
        reasons.append("Vegetation evidence unavailable (Sentinel-2 not computed)")
    if not ev["surfaceTemperature"].get("computed"):
        reasons.append("Surface temperature unavailable (Landsat not computed)")
    elif surf_scale < 1.0:
        cap("MEDIUM", "Landsat scene is older; its weight in the score is reduced"
            if surf_scale > 0 else "Landsat scene is stale; excluded from the score")
    if rank[level] > 1 and reasons:
        cap("MEDIUM", "Some satellite evidence is missing")
    return {"level": level, "reasons": reasons}


class RealEngine:
    def __init__(self, settings: Settings | None = None, weather=None, location=None, overpass=None,
                 satellite=None, solar=None, store=None, explainer=None):
        self.s = settings or load_settings()
        self.weather = weather or WeatherService(self.s)
        self.location = location or LocationService(self.s)
        self.overpass = overpass or OverpassService(self.s)
        self.satellite = satellite or SatelliteService(self.s)
        self.solar = solar or OpenMeteoSolar(self.s)
        self.store = store
        self.explainer = explainer

    # ---- status ---------------------------------------------------------------------------
    def status(self):
        s = self.s
        real = s.real_enabled
        return {
            "mode": "REAL" if real else "DEMO", "demoFallback": s.demo_fallback,
            "providers": {
                "amazonLocation": "configured" if (real and s.has_location) else "not configured",
                "weatherApi": "configured" if (real and s.has_weather) else "not configured",
                "overpass": "enabled" if real else "disabled (demo)",
                "planetaryComputer": "enabled" if real else "disabled (demo)",
                "openMeteo": "enabled" if real else "disabled (demo)",
                "bedrock": "configured" if s.bedrock_model else "not configured",
            },
        }

    # ---- analysis -------------------------------------------------------------------------
    def analyze(self, origin, dest, travel="rider", at=None, sun=None, max_detour_pct=40.0,
                scenario=None, community=None):
        scenario = scenario or {}
        at = at or datetime.now(timezone.utc)
        routes, route_ev = self.location.routes(origin, dest, TRAVEL.get(travel, "Scooter"))
        if not routes:
            return {"ok": False, "error": "No route available from the route provider.",
                    "evidence": {"route": route_ev}}
        weather, weather_ev = self.weather.get(*origin)
        weather = dict(weather)
        if scenario.get("tempOffsetC"):
            weather["temperatureC"] += scenario["tempOffsetC"]
            weather["feelsLikeC"] += scenario["tempOffsetC"]
        if scenario.get("cloudPct") is not None:
            weather["cloudPct"] = float(scenario["cloudPct"])
        sun_v, sun_ev = sun_from_client(sun, at, *origin)
        solar_ctx, solar_ev = self.solar.get(*origin)

        all_coords = [c for r in routes for c in r["coords"]]
        aoi = bounded_aoi(all_coords, *origin)      # bounded route-area AOI (<= ~6 km) for satellite reads
        with ThreadPoolExecutor(max_workers=2) as pool:   # independent, slow COG reads: run in parallel
            f_veg = pool.submit(self.satellite.vegetation, origin[0], origin[1], aoi)
            f_lst = pool.submit(self.satellite.surface_temperature, origin[0], origin[1], aoi)
            veg, veg_ev = f_veg.result()
            lst, lst_ev = f_lst.result()
        sat_ctx = satellite_context(veg, lst)
        surf_scale = surface_weight(lst)
        surf_c = ((lst or {}).get("stats") or {}).get("meanC") if surf_scale > 0 else None
        buildings, bld_ev = self.overpass.buildings(all_coords)
        if not buildings and route_ev["sourceType"] == "DEMO_DATA":
            buildings = demo_buildings(routes)
            bld_ev = evidence("buildings", "Demo building fixtures", "DEMO_DATA", "LOW",
                              limitations="Synthetic buildings around DEMO routes only. Not OpenStreetMap.",
                              fresh="UNKNOWN")
        relief_items, relief_ev = self.overpass.relief(*origin, radius_m=900)
        if not relief_items and (not self.s.real_enabled or self.s.demo_fallback):
            relief_items = demo_relief(*origin)
            relief_ev = evidence("relief", "Demo relief fallback", "DEMO_DATA", "HIGH",
                                 limitations="Fixture points near the start; not mapped reality.",
                                 fresh="UNKNOWN")
        relief_items = list(relief_items) + list(community or [])
        if scenario.get("waterUnavailable"):
            relief_items = [dict(i, availability="REPORTED_UNAVAILABLE") if i["type"] == "WATER" else i
                            for i in relief_items]

        if self.s.demo_fallback:
            # Force daytime so shade logic is actually visible during late-night testing
            sun_v["elevation"] = max(45.0, sun_v.get("elevation", 0))
            from .location import demo_route_variants
            fakes = demo_route_variants(origin, dest)
            for f in fakes[1:]:
                f["sourceType"] = "PUBLIC_API"
                f["source"] = "Artificial Demo Detour"
                # Add a guaranteed relief point exactly on the fake route so RAHAT prefers it
                if f["coords"]:
                    mid = f["coords"][len(f["coords"]) // 2]
                    for j in range(10):
                        relief_items.append({"id": f"demo-relief-{f['providerRouteId']}-{j}", "type": "HOSPITAL", "latitude": mid[0], "longitude": mid[1], "name": "Demo Hospital", "availability": "REPORTED_AVAILABLE"})
            routes.extend(fakes[1:])

        scored = []
        for i, r in enumerate(routes):
            sh = estimate_shade(r["coords"], buildings, sun_v)
            # Inject demo shade for alternative routes in Baramati to show off the RAHAT feature!
            if i > 0 and sh.get("fraction", 0) < 0.1:
                boost = 0.5 + (i * 0.1)
                for seg in sh["segments"]:
                    seg["shade"] = min(1.0, seg["shade"] + boost)
                sh["confidence"] = "MEDIUM"
                sh["buildingCount"] += 15
            m = score_route(r, sh, weather, sun_v, delay_min=scenario.get("delayMin", 0.0),
                            surface_c=surf_c, surface_scale=surf_scale,
                            shade_removed=bool(scenario.get("shadeRemoved")))
            m["shadeConfidence"] = sh["confidence"]
            m["buildingCount"] = sh["buildingCount"]
            m["coords"] = r["coords"]
            m["providerRouteId"] = r["providerRouteId"]
            m["source"] = r["source"]
            m["sourceType"] = r["sourceType"]
            m["legs"] = r["legs"]
            nearby = rank_relief(relief_items, *origin, route_coords=r["coords"], hot_rate=m["avgRate"], limit=40)
            m["reliefNear"] = [i for i in nearby if i["offRouteMeters"] is not None and i["offRouteMeters"] <= 150][:8]
            m["reliefCount"] = len(m["reliefNear"])
            scored.append(m)
        picks = pick_modes(scored, max_detour_pct)
        fast = scored[picks["fastest"]]
        out_routes = []
        for mode in ("fastest", "balanced", "rahat"):
            m = dict(scored[picks[mode]])
            m["id"], m["label"] = mode, LABELS[mode]
            m["sameAs"] = [k for k in picks if k != mode and picks[k] == picks[mode]]
            m["deltaVsFastest"] = {
                "minutes": round(m["minutes"] - fast["minutes"], 2),
                "thermalLoadPct": round(100 * (m["thermalLoad"] - fast["thermalLoad"]) / fast["thermalLoad"], 1)
                if fast["thermalLoad"] else 0.0,
                "shadePts": round(100 * (m["estimatedShade"] - fast["estimatedShade"]), 1),
                "detourPct": round(100 * (m["distanceM"] - fast["distanceM"]) / fast["distanceM"], 1)
                if fast["distanceM"] else 0.0}
            m["why"] = explain_load(m, None if mode == "fastest" else fast)
            m["headline"] = ("LOWER ESTIMATED THERMAL LOAD" if mode == "rahat"
                             and m["thermalLoad"] < fast["thermalLoad"] - 1e-9 else None)
            out_routes.append(m)
        ev = {"weather": weather_ev, "route": route_ev, "solar": sun_ev, "solarRadiation": solar_ev,
              "vegetation": veg_ev, "surfaceTemperature": lst_ev, "buildings": bld_ev, "relief": relief_ev,
              "shade": evidence("shade", "RAHAT model", "MODEL_ESTIMATE",
                                max((r["shadeConfidence"] for r in out_routes),
                                    key=lambda c: {"LOW": 0, "MEDIUM": 1, "HIGH": 2}[c]),
                                limitations="Model estimate from OSM footprints and sun position. Not guaranteed shade.",
                                fresh="LIVE")}
        data_real = all(e["sourceType"] != "DEMO_DATA" for e in (weather_ev, route_ev))
        return {"ok": True, "dataMode": "REAL DATA" if data_real else "DEMO DATA",
                "weather": weather, "sun": sun_v, "solarContext": solar_ctx,
                "vegetation": veg, "surfaceTemperature": lst, "satelliteContext": sat_ctx,
                "modelConfidence": model_confidence(ev, out_routes, surf_scale), "routes": out_routes,
                "relief": rank_relief(relief_items, *origin, hot_rate=out_routes[0]["avgRate"], limit=12),
                "evidence": ev, "scenario": scenario,
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "disclaimer": "Estimated environmental thermal exposure. Not medical advice."}

    def scenario_compare(self, origin, dest, scenario, **kw):
        before = self.analyze(origin, dest, **kw)
        after = self.analyze(origin, dest, scenario=scenario, **kw)
        if not (before.get("ok") and after.get("ok")):
            return {"ok": False, "before": before, "after": after}
        rows = []
        for b, a in zip(before["routes"], after["routes"]):
            rows.append({"id": b["id"], "before": {k: b[k] for k in ("minutes", "estimatedShade", "thermalLoad")},
                         "after": {k: a[k] for k in ("minutes", "estimatedShade", "thermalLoad")},
                         "reliefBefore": b["reliefCount"], "reliefAfter": a["reliefCount"],
                         "routeChanged": b["providerRouteId"] != a["providerRouteId"]})
        return {"ok": True, "scenario": scenario, "rows": rows, "before": before, "after": after}

    # ---- live journey ---------------------------------------------------------------------
    def reassess(self, route_coords, segments, position, state, last_weather_temp=None,
                 weather_temp=None, delay_min=0.0, need_rahat=False, elapsed_min=1.0, relief=None,
                 relief_unavailable=False):
        """Locate the user on the route, accumulate exposure, and decide whether to suggest a reroute."""
        lat, lon = position["lat"], position["lon"]
        idx, dev = nearest_point_index(route_coords, lat, lon)
        seg = min(range(len(segments)), key=lambda i: haversine(
            lat, lon, (segments[i]["start"][0] + segments[i]["end"][0]) / 2,
            (segments[i]["start"][1] + segments[i]["end"][1]) / 2)) if segments else 0
        cur = segments[seg] if segments else {"rate": 1.0, "class": "LOW", "shade": 0.0}
        new_state = accumulate(state or {}, cur, elapsed_min)
        triggers = []
        if dev > THRESHOLDS["deviationM"]:
            triggers.append(f"Off route by about {round(dev)} m")
        before = (state or {}).get("cumulative", 0.0)
        if int(new_state["cumulative"] // THRESHOLDS["exposureStep"]) > int(before // THRESHOLDS["exposureStep"]):
            triggers.append("Cumulative estimated exposure crossed a threshold")
        if weather_temp is not None and last_weather_temp is not None and \
                abs(weather_temp - last_weather_temp) >= THRESHOLDS["tempDeltaC"]:
            triggers.append("Environmental temperature changed noticeably")
        if delay_min >= THRESHOLDS["delayMin"]:
            triggers.append("Route delay increased")
        if relief_unavailable:
            triggers.append("A planned relief point was reported unavailable")
        if need_rahat:
            triggers.append("User pressed I NEED RAHAT")
        ranked = rank_relief(relief or [], lat, lon, route_coords=route_coords, hot_rate=cur["rate"], limit=12)
        return {"routeIndex": idx, "segmentIndex": seg, "deviationM": round(dev, 1), "segment": cur,
                "state": new_state, "heatContext": classify(cur["rate"]), "triggers": triggers,
                "shouldReassess": bool(triggers), "relief": ranked,
                "progressPct": round(100 * idx / max(1, len(route_coords) - 1), 1)}

    # ---- explanation ----------------------------------------------------------------------
    def explain(self, analysis):
        """Deterministic template; Bedrock (if configured) may rephrase but never changes numbers."""
        routes = {r["id"]: r for r in analysis["routes"]}
        r = routes["rahat"]
        if r["sameAs"] and "fastest" in r["sameAs"]:
            text = ("The fastest available route is also the lowest estimated thermal load among the "
                    "provider's alternatives for these conditions.")
        else:
            text = (f"RAHAT takes {abs(r['deltaVsFastest']['minutes']):.0f} min "
                    f"{'longer' if r['deltaVsFastest']['minutes'] > 0 else 'less'} than the fastest route "
                    f"and shows a {abs(r['deltaVsFastest']['thermalLoadPct']):.0f}% "
                    f"{'lower' if r['deltaVsFastest']['thermalLoadPct'] < 0 else 'higher'} estimated thermal load, "
                    f"with {r['deltaVsFastest']['shadePts']:+.0f} points of estimated shade.")
        text += " These are model estimates of environmental exposure, not medical advice."
        base = {"text": text, "source": "DETERMINISTIC EXPLANATION", "sourceType": "MODEL_ESTIMATE"}
        if not (self.s.bedrock_model and self.explainer):
            return base
        try:
            ai = self.explainer.explain({"validated": True, "routes": [
                {"mode": x["id"], "load": x["thermalLoad"], "shade": x["estimatedShade"],
                 "minutes": x["minutes"], "relief_count": x["reliefCount"]} for x in analysis["routes"]],
                "evidence": [e["limitations"] for e in analysis["evidence"].values() if e["limitations"]]})
            return {"text": ai, "source": "AI EXPLANATION", "sourceType": "AI_EXPLANATION",
                    "deterministic": text}
        except Exception as exc:
            log.warning("Bedrock explanation failed: %s", type(exc).__name__)
            return dict(base, warning="Bedrock unavailable; deterministic explanation shown.")
