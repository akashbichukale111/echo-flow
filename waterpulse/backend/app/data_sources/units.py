"""Documented unit conversions. Conversions are explicit, never silent."""

CUSEC_TO_M3_PER_S = 0.028316846592     # 1 ft3/s, exact by definition
FT_TO_M = 0.3048
M3_PER_S_TO_L_PER_DAY = 1000 * 86400   # 1 m3/s = 86,400,000 L/day

CONVERSION_NOTE = (
    "1 cusec = 1 ft³/s = 0.0283168 m³/s = 2,446,576 L/day. "
    "Converted values are DERIVED from the published cusec figure."
)


def cusec_to_m3s(value: float) -> float:
    return value * CUSEC_TO_M3_PER_S


def cusec_to_l_per_day(value: float) -> float:
    return cusec_to_m3s(value) * M3_PER_S_TO_L_PER_DAY


def to_si(value: float, unit: str) -> tuple[float | None, str | None]:
    """Return (value, unit) in SI-style units when a documented conversion
    exists; otherwise (None, None) so callers never show a guessed number."""
    u = unit.strip().lower()
    if u == "cusec":
        return cusec_to_m3s(value), "m³/s"
    if u in {"m3/sec", "m3/s", "m³/s"}:
        return value, "m³/s"
    if u == "ft":
        return value * FT_TO_M, "m"
    if u == "m":
        return value, "m"
    if u == "mm":
        return value, "mm"
    return None, None
