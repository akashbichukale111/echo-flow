"""Pure raster maths for satellite evidence. No network. Fully unit-testable.

Nothing here invents constants: scale/offset come from the STAC asset metadata (``raster:bands``)
or the file's own tags and are passed in. If they are unknown the caller gets ``None`` back.
"""
import numpy as np

VEG_NDVI_THRESHOLD = 0.3   # NDVI >= 0.3 counted as vegetated (common moderate-vegetation cut-off)
KELVIN_OFFSET = 273.15     # unit conversion K -> C (physical constant, not a data constant)

# Sentinel-2 L2A SCL classes treated as INVALID for vegetation statistics.
# 0 no data, 1 saturated/defective, 3 cloud shadow, 8 cloud med, 9 cloud high, 10 thin cirrus, 11 snow
SCL_INVALID = (0, 1, 3, 8, 9, 10, 11)
# Landsat QA_PIXEL bits: 0 fill, 1 dilated cloud, 2 cirrus, 3 cloud, 4 cloud shadow, 5 snow
LANDSAT_QA_BAD_BITS = (0, 1, 2, 3, 4, 5)


def _stats(values: np.ndarray, total: int) -> dict:
    n = int(values.size)
    return {"validPixelFraction": round(n / total, 4) if total else 0.0, "validPixels": n,
            "totalPixels": int(total)}


def compute_ndvi(red_dn, nir_dn, scale=None, offset=None, nodata=0, invalid_mask=None):
    """NDVI = (NIR - RED) / (NIR + RED) on reflectance. Returns (ndvi_array_with_nan, valid_bool_mask).

    Handles nodata, a caller supplied invalid mask (clouds), division by zero and out-of-range values.
    Returns (None, None) if scale/offset are unknown (we will not guess reflectance conversion).
    """
    if scale is None or offset is None:
        return None, None
    red = np.asarray(red_dn, dtype="float64")
    nir = np.asarray(nir_dn, dtype="float64")
    ok = (red != nodata) & (nir != nodata)
    if invalid_mask is not None:
        ok &= ~np.asarray(invalid_mask, dtype=bool)
    r = red * scale + offset
    n = nir * scale + offset
    denom = n + r
    ok &= np.abs(denom) > 1e-9
    ok &= (r >= -0.05) & (n >= -0.05)   # tiny negative reflectance tolerated; wildly negative = bad
    ndvi = np.full(red.shape, np.nan)
    ndvi[ok] = (n[ok] - r[ok]) / denom[ok]
    ok &= (ndvi >= -1.0) & (ndvi <= 1.0)
    ndvi[~ok] = np.nan
    return ndvi, ok


def ndvi_statistics(ndvi, valid):
    total = int(np.asarray(ndvi).size)
    vals = np.asarray(ndvi)[valid] if valid is not None else np.array([])
    out = _stats(vals, total)
    if vals.size == 0:
        out.update({"meanNdvi": None, "medianNdvi": None, "vegetationFraction": None})
        return out
    out.update({"meanNdvi": round(float(vals.mean()), 4), "medianNdvi": round(float(np.median(vals)), 4),
                "vegetationFraction": round(float((vals >= VEG_NDVI_THRESHOLD).mean()), 4),
                "vegetationThreshold": VEG_NDVI_THRESHOLD})
    return out


def scl_invalid_mask(scl):
    return np.isin(np.asarray(scl), SCL_INVALID)


def landsat_qa_bad(qa):
    qa = np.asarray(qa).astype("uint32")
    bad = np.zeros(qa.shape, dtype=bool)
    for b in LANDSAT_QA_BAD_BITS:
        bad |= (qa >> b) & 1 == 1
    return bad


def landsat_surface_temperature_c(st_dn, scale=None, offset=None, nodata=0, bad_mask=None):
    """DN -> Kelvin via asset scale/offset -> Celsius. Returns (celsius_with_nan, valid) or (None, None)."""
    if scale is None or offset is None:
        return None, None
    dn = np.asarray(st_dn, dtype="float64")
    ok = dn != nodata
    if bad_mask is not None:
        ok &= ~np.asarray(bad_mask, dtype=bool)
    kelvin = dn * scale + offset
    celsius = kelvin - KELVIN_OFFSET
    ok &= (celsius > -60.0) & (celsius < 90.0)   # physically plausible land surface range
    celsius = np.where(ok, celsius, np.nan)
    return celsius, ok


def st_statistics(celsius, valid):
    total = int(np.asarray(celsius).size)
    vals = np.asarray(celsius)[valid] if valid is not None else np.array([])
    out = _stats(vals, total)
    if vals.size == 0:
        out.update({"meanC": None, "medianC": None, "minC": None, "maxC": None})
        return out
    out.update({"meanC": round(float(vals.mean()), 2), "medianC": round(float(np.median(vals)), 2),
                "minC": round(float(vals.min()), 2), "maxC": round(float(vals.max()), 2), "units": "degC"})
    return out
