"""Deterministic, explainable thermal scoring. Environmental context only: no body or medical claims.

Units are uncalibrated 'thermal load units' (u). Rate (u/min) per segment is the sum of named,
inspectable components so every change can be explained.
"""
import math

BASE_RATE = 0.6          # u/min of exertion in any outdoor conditions
HEAT_WEIGHT = 1.1        # scales (feels-like - 28C) / 12
SOLAR_WEIGHT = 1.4       # scales direct-sun factor
SHADE_BLOCK = 0.85       # share of the solar term removed in full estimated shade
SURFACE_WEIGHT = 0.25    # hard cap (u/min) of the observed-surface-temperature term. It is a SEPARATE named
                         # component (never merged into environmentalHeat, which uses WeatherAPI feels-like),
                         # only active above 35C, scaled by scene age (surface_scale) so stale scenes add 0.
RECOVERY_PER_MIN = {"REST": 0.9, "COOLING": 1.4, "SHADE": 0.7, "WATER": 0.5}  # u/min credited while stopped
CLASS_EDGES = (1.5, 2.1, 2.7)


def heat_norm(feels_like_c):
    return max(0.0, min(1.5, (feels_like_c - 28.0) / 12.0))


def solar_factor(elevation_deg, cloud_pct):
    if elevation_deg <= 0:
        return 0.0
    return math.sin(math.radians(elevation_deg)) * (1 - 0.7 * max(0.0, min(100.0, cloud_pct)) / 100)


def classify(rate):
    return ("LOW" if rate < CLASS_EDGES[0] else "MODERATE" if rate < CLASS_EDGES[1]
            else "ELEVATED" if rate < CLASS_EDGES[2] else "HIGH")


def segment_rate(weather, sun, shade, surface_c=None, surface_scale=1.0):
    heat = HEAT_WEIGHT * heat_norm(weather["feelsLikeC"])
    solar_raw = SOLAR_WEIGHT * solar_factor(sun["elevation"], weather.get("cloudPct", 0))
    solar = solar_raw * (1 - SHADE_BLOCK * shade)
    surf = 0.0
    if surface_c is not None and surface_c > 35:
        surf = SURFACE_WEIGHT * min(1.0, (surface_c - 35) / 15) * max(0.0, min(1.0, surface_scale))
    comp = {"baseline": BASE_RATE, "environmentalHeat": heat, "solarExposure": solar,
            "shadeReduction": -(solar_raw - solar), "surfaceContext": surf}
    return sum(v for k, v in comp.items() if k != "shadeReduction") , comp


def score_route(route, shade, weather, sun, delay_min=0.0, surface_c=None, surface_scale=1.0,
                shade_removed=False):
    """Returns route metrics. shade is estimate_shade() output."""
    segs = shade["segments"]
    total_len = sum(s["lengthM"] for s in segs) or 1.0
    minutes_total = route["durationS"] / 60.0
    load, used, weighted_shade = 0.0, 0.0, 0.0
    seg_out = []
    comp_sum = {"baseline": 0.0, "environmentalHeat": 0.0, "solarExposure": 0.0, "shadeReduction": 0.0,
                "surfaceContext": 0.0}
    for s in segs:
        minutes = minutes_total * s["lengthM"] / total_len
        sh = 0.0 if shade_removed else s["shade"]
        rate, comp = segment_rate(weather, sun, sh, surface_c, surface_scale)
        seg_load = rate * minutes
        load += seg_load
        used += minutes
        weighted_shade += sh * s["lengthM"]
        for k in comp_sum:
            comp_sum[k] += comp[k] * minutes
        seg_out.append({"start": s["start"], "end": s["end"], "lengthM": round(s["lengthM"], 1),
                        "minutes": round(minutes, 3), "shade": round(sh, 3), "rate": round(rate, 3),
                        "load": round(seg_load, 4), "class": classify(rate)})
    avg_rate = load / used if used else 0.0
    delay_load = avg_rate * max(0.0, delay_min)
    load += delay_load
    comp_sum["delay"] = delay_load
    return {
        "minutes": minutes_total + max(0.0, delay_min), "baseMinutes": minutes_total,
        "distanceM": route["distanceM"], "thermalLoad": round(load, 3),
        "avgRate": round(avg_rate, 3), "heatContext": classify(avg_rate),
        "estimatedShade": round(0.0 if shade_removed else weighted_shade / total_len, 3),
        "components": {k: round(v, 3) for k, v in comp_sum.items()}, "segments": seg_out,
    }


def explain_load(metrics, other=None, other_label="fastest"):
    """Human-readable, template-based reasons derived from the numbers (no LLM)."""
    c = metrics["components"]
    up, down = [], []
    if metrics["minutes"] > 25:
        up.append("longer duration")
    if c["solarExposure"] > c["baseline"] * 0.6:
        up.append("high solar exposure")
    if metrics["estimatedShade"] < 0.25:
        up.append("low estimated shade")
    if c["environmentalHeat"] > c["baseline"] * 0.6:
        up.append("elevated environmental heat")
    if c.get("delay", 0) > 0:
        up.append("traffic or delay time")
    if metrics["estimatedShade"] >= 0.4:
        down.append("estimated shaded segments")
    if c["shadeReduction"] < -0.5:
        down.append("direct-sun term reduced by shade")
    if other is not None:
        if metrics["minutes"] < other["minutes"]:
            down.append(f"shorter exposure than {other_label}")
        if metrics["thermalLoad"] < other["thermalLoad"]:
            down.append(f"lower estimated thermal load than {other_label}")
    return {"increasedBy": up, "reducedBy": down}


def accumulate(state, seg, minutes_here, relief_type=None, rest_min=0.0):
    """Advance cumulative exposure. state: {cumulative, history}. Returns new state; every step has a reason."""
    state = {"cumulative": state.get("cumulative", 0.0), "history": list(state.get("history", []))}
    add = seg["rate"] * minutes_here
    reason = [f"{minutes_here:.1f} min at {seg['rate']:.2f} u/min ({seg['class']} segment, "
              f"{round(seg['shade'] * 100)}% estimated shade)"]
    credit = 0.0
    if relief_type and rest_min > 0:
        credit = min(state["cumulative"] + add, RECOVERY_PER_MIN.get(relief_type, 0.3) * rest_min)
        reason.append(f"{rest_min:.0f} min at {relief_type.lower()} relief reduced load by {credit:.2f} u")
    state["cumulative"] = max(0.0, state["cumulative"] + add - credit)
    state["history"].append({"added": round(add, 3), "credit": round(credit, 3),
                             "cumulative": round(state["cumulative"], 3), "why": reason})
    state["history"] = state["history"][-200:]
    return state
