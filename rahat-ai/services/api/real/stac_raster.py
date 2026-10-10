"""Windowed COG reads from Planetary Computer assets (signed). Bounded AOI + decimated reads."""
import logging
import time

import numpy as np

from .raster import (compute_ndvi, landsat_qa_bad, landsat_surface_temperature_c, ndvi_statistics,
                     scl_invalid_mask, st_statistics)

log = logging.getLogger("rahat.real")
MAX_PIXELS = 400          # longest side of the read window after decimation
MAX_AOI_DEG = 0.06        # ~6 km cap; larger route boxes are shrunk around their centre


def bounded_aoi(coords, lat, lon, pad=0.004):
    """[west,south,east,north] around the route (or the point), padded and capped."""
    if coords:
        lats = [c[0] for c in coords]
        lons = [c[1] for c in coords]
        s, n, w, e = min(lats) - pad, max(lats) + pad, min(lons) - pad, max(lons) + pad
    else:
        s, n, w, e = lat - 0.01, lat + 0.01, lon - 0.01, lon + 0.01
    cy, cx = (s + n) / 2, (w + e) / 2
    hy, hx = min((n - s) / 2, MAX_AOI_DEG / 2), min((e - w) / 2, MAX_AOI_DEG / 2)
    return [round(cx - hx, 5), round(cy - hy, 5), round(cx + hx, 5), round(cy + hy, 5)]


def asset_scale_offset(asset: dict):
    """From STAC ``raster:bands`` (authoritative). Returns (scale, offset, nodata) or Nones."""
    rb = (asset or {}).get("raster:bands") or []
    if not rb:
        return None, None, None
    b = rb[0]
    return b.get("scale"), b.get("offset"), b.get("nodata")


class Signer:
    """SAS token per collection from the Planetary Computer data API, cached until near expiry."""
    def __init__(self, base, client):
        self.base, self.client, self._t = base, client, {}

    def sign(self, href, collection):
        tok = self._t.get(collection)
        if not tok or tok[1] - time.time() < 120:
            r = self.client.get(f"{self.base}/sas/v1/token/{collection}")
            r.raise_for_status()
            j = r.json()
            exp = j.get("msft:expiry")
            ts = time.time() + 1800
            if exp:
                from datetime import datetime
                ts = datetime.fromisoformat(exp.replace("Z", "+00:00")).timestamp()
            tok = (j["token"], ts)
            self._t[collection] = tok
        sep = "&" if "?" in href else "?"
        return f"{href}{sep}{tok[0]}"


def read_window(href, bbox_lonlat, max_pixels=MAX_PIXELS, resampling="nearest"):
    """Read a bbox (EPSG:4326) from a COG as a 2-D array. Returns (array, dataset_tags)."""
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import transform_bounds
    from rasterio.windows import from_bounds

    with rasterio.open(href) as ds:
        left, bottom, right, top = transform_bounds("EPSG:4326", ds.crs, *bbox_lonlat)
        win = from_bounds(left, bottom, right, top, transform=ds.transform)
        win = win.intersection(rasterio.windows.Window(0, 0, ds.width, ds.height))
        if win.width < 1 or win.height < 1:
            raise ValueError("AOI outside scene footprint")
        scale = max(win.width, win.height) / max_pixels
        scale = max(scale, 1.0)
        shape = (max(1, int(win.height / scale)), max(1, int(win.width / scale)))
        arr = ds.read(1, window=win, out_shape=shape, resampling=getattr(Resampling, resampling),
                      boundless=False)
        tags = {"scales": ds.scales, "offsets": ds.offsets, "nodata": ds.nodata}
        return arr, tags


def resize_nearest(a, shape):
    if a.shape == shape:
        return a
    yi = (np.arange(shape[0]) * a.shape[0] / shape[0]).astype(int)
    xi = (np.arange(shape[1]) * a.shape[1] / shape[1]).astype(int)
    return a[np.ix_(yi, xi)]


def sentinel2_ndvi(item, bbox, signer, reader=read_window):
    assets = item["assets"]
    for k in ("B04", "B08"):
        if k not in assets:
            raise KeyError(f"asset {k} missing")
    t0 = time.time()
    coll = item.get("collection", "sentinel-2-l2a")
    red, tags = reader(signer.sign(assets["B04"]["href"], coll), bbox)
    nir, _ = reader(signer.sign(assets["B08"]["href"], coll), bbox)
    nir = resize_nearest(nir, red.shape)
    sc_r, off_r, nodata = asset_scale_offset(assets["B04"])
    sc_n, off_n, _ = asset_scale_offset(assets["B08"])
    if sc_r is None:   # fall back to the file's own tags, else give up (never guess)
        sc_r, off_r = (tags["scales"] or [None])[0], (tags["offsets"] or [None])[0]
        sc_n, off_n = sc_r, off_r
    if sc_r != sc_n or off_r != off_n:
        raise ValueError("RED/NIR scale or offset mismatch")
    inval, cloud_mask_used = None, False
    if "SCL" in assets:
        try:
            scl, _ = reader(signer.sign(assets["SCL"]["href"], coll), bbox, resampling="nearest")
            inval = scl_invalid_mask(resize_nearest(scl, red.shape))
            cloud_mask_used = True
        except Exception as exc:  # SCL is optional: continue unmasked and say so
            log.warning("SCL read failed: %s", type(exc).__name__)
    ndvi, valid = compute_ndvi(red, nir, sc_r, off_r, nodata=nodata if nodata is not None else 0,
                               invalid_mask=inval)
    if ndvi is None:
        raise ValueError("reflectance scale/offset unknown")
    stats = ndvi_statistics(ndvi, valid)
    stats.update({"cloudMaskApplied": cloud_mask_used, "processingSeconds": round(time.time() - t0, 2),
                  "bands": {"red": "B04", "nir": "B08"}, "scale": sc_r, "offset": off_r})
    return stats


def landsat_st(item, bbox, signer, reader=read_window):
    assets = item["assets"]
    if "lwir11" not in assets:
        raise KeyError("asset lwir11 missing")
    t0 = time.time()
    coll = item.get("collection", "landsat-c2-l2")
    st, tags = reader(signer.sign(assets["lwir11"]["href"], coll), bbox)
    scale, offset, nodata = asset_scale_offset(assets["lwir11"])
    if scale is None:
        scale, offset = (tags["scales"] or [None])[0], (tags["offsets"] or [None])[0]
    bad, qa_used = None, False
    if "qa_pixel" in assets:
        try:
            qa, _ = reader(signer.sign(assets["qa_pixel"]["href"], coll), bbox)
            bad = landsat_qa_bad(resize_nearest(qa, st.shape))
            qa_used = True
        except Exception as exc:
            log.warning("QA_PIXEL read failed: %s", type(exc).__name__)
    c, valid = landsat_surface_temperature_c(st, scale, offset, nodata=nodata if nodata is not None else 0,
                                             bad_mask=bad)
    if c is None:
        raise ValueError("ST scale/offset unknown")
    stats = st_statistics(c, valid)
    stats.update({"qaMaskApplied": qa_used, "processingSeconds": round(time.time() - t0, 2),
                  "asset": "lwir11", "scale": scale, "offset": offset})
    return stats


