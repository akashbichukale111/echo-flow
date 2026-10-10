"""Estimated shade from OSM building footprints + sun position. A MODEL ESTIMATE, never guaranteed."""
import math

from .geo import split_polyline, to_xy

LEVEL_M = 3.0  # assumed storey height when only levels are mapped


def building_height(b):
    """(height_m, confidence). Never invents a height when none is mapped."""
    if b.get("heightM"):
        return float(b["heightM"]), "HIGH"
    if b.get("levels"):
        return float(b["levels"]) * LEVEL_M, "MEDIUM"
    return None, "LOW"


def _point_in_poly(x, y, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi, xj, yj = *poly[i], *poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def _ray_hits_poly(px, py, dx, dy, poly, max_d):
    """True if the ray from (px,py) toward the sun crosses the building footprint within max_d metres."""
    if _point_in_poly(px, py, poly):
        return True
    for i in range(len(poly)):
        ax, ay = poly[i]
        bx, by = poly[(i + 1) % len(poly)]
        ex, ey = bx - ax, by - ay
        den = dx * ey - dy * ex
        if abs(den) < 1e-12:
            continue
        t = ((ax - px) * ey - (ay - py) * ex) / den
        u = ((ax - px) * dy - (ay - py) * dx) / den
        if 0 <= t <= max_d and 0 <= u <= 1:
            return True
    return False


def estimate_shade(coords, buildings, sun, assumed_height_m=None):
    """Per-segment shaded fraction. coords: [(lat, lon)], sun: {elevation, azimuth(compass deg)}.

    A road sample is shaded when the ray toward the sun hits a building whose height is
    tall enough: building must satisfy distance_to_hit * tan(elevation) <= height.
    Buildings with no mapped height/levels only count if assumed_height_m is given (LOW confidence).
    """
    segs = split_polyline(coords, 60.0)
    ref = coords[0]
    if not segs:
        return {"segments": [], "fraction": 0.0, "confidence": "LOW", "buildingCount": 0}
    elev = sun["elevation"]
    if elev <= 0:  # night: no direct sun, so shade is not meaningful
        return {"segments": [{"shade": 0.0, "lengthM": s[2], "start": s[0], "end": s[1]} for s in segs],
                "fraction": 0.0, "confidence": "LOW", "buildingCount": len(buildings), "night": True}
    az = math.radians(sun["azimuth"])
    dx, dy = math.sin(az), math.cos(az)  # unit vector toward the sun, east/north metres
    tan_e = max(0.02, math.tan(math.radians(elev)))
    polys = []
    confs = []
    for b in buildings:
        h, conf = building_height(b)
        if h is None:
            if assumed_height_m is None:
                continue
            h, conf = assumed_height_m, "LOW"
        xy = [to_xy(la, lo, ref[0], ref[1]) for la, lo in b["ring"]]
        polys.append((xy, h / tan_e, h))
        confs.append(conf)
    out, total_len, shaded_len = [], 0.0, 0.0
    for (a, b, length) in segs:
        n = 5
        hit = 0
        for k in range(n):
            t = (k + 0.5) / n
            la, lo = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            px, py = to_xy(la, lo, ref[0], ref[1])
            if any(_ray_hits_poly(px, py, dx, dy, poly, reach) for poly, reach, _h in polys):
                hit += 1
        frac = hit / n
        out.append({"shade": frac, "lengthM": length, "start": a, "end": b})
        total_len += length
        shaded_len += frac * length
    conf = "LOW"
    if confs:
        share_high = sum(1 for c in confs if c == "HIGH") / len(confs)
        share_known = sum(1 for c in confs if c in ("HIGH", "MEDIUM")) / len(confs)
        conf = "HIGH" if share_high >= 0.6 else "MEDIUM" if share_known >= 0.5 else "LOW"
    return {"segments": out, "fraction": shaded_len / total_len if total_len else 0.0,
            "confidence": conf, "buildingCount": len(polys)}
