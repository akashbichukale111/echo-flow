"""Small geodesy helpers (local equirectangular metres; accurate at city scale)."""
import math

R = 6371000.0


def haversine(a_lat, a_lon, b_lat, b_lon):
    p = math.pi / 180
    dlat, dlon = (b_lat - a_lat) * p, (b_lon - a_lon) * p
    h = math.sin(dlat / 2) ** 2 + math.cos(a_lat * p) * math.cos(b_lat * p) * math.sin(dlon / 2) ** 2
    return 2 * R * math.asin(min(1.0, math.sqrt(h)))


def to_xy(lat, lon, ref_lat, ref_lon):
    """Metres east (x) and north (y) of the reference point."""
    x = math.radians(lon - ref_lon) * R * math.cos(math.radians(ref_lat))
    y = math.radians(lat - ref_lat) * R
    return x, y


def polyline_length(coords):
    return sum(haversine(a[0], a[1], b[0], b[1]) for a, b in zip(coords, coords[1:]))


def split_polyline(coords, max_m=60.0):
    """Split a [lat, lon] polyline into ordered segments no longer than max_m."""
    segs = []
    for a, b in zip(coords, coords[1:]):
        d = haversine(a[0], a[1], b[0], b[1])
        n = max(1, math.ceil(d / max_m))
        for k in range(n):
            t0, t1 = k / n, (k + 1) / n
            segs.append((
                (a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0),
                (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1),
                d / n,
            ))
    return segs


def nearest_point_index(coords, lat, lon):
    best, idx = float("inf"), 0
    for i, c in enumerate(coords):
        d = haversine(lat, lon, c[0], c[1])
        if d < best:
            best, idx = d, i
    return idx, best
