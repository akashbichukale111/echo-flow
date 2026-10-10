"""Shared primitives for the public-data layer.

Nothing in this package fabricates values. Every observation is parsed from a
supplied CSV and keeps its source, timestamp, unit and a freshness verdict
computed against the request-time clock (never against the file itself).
"""
from __future__ import annotations

import csv
import math
import os
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

IST = timezone(timedelta(hours=5, minutes=30))
MAX_CSV_BYTES = 25 * 1024 * 1024  # refuse unexpectedly large inputs

DATA_LABEL_PUBLIC = "REAL PUBLIC DATA"
DATA_LABEL_BASELINE = "REAL GOVERNMENT BASELINE"


class DataUnavailable(Exception):
    """A provider cannot serve data; carries a structured, UI-safe payload."""

    def __init__(self, source: str, message: str):
        super().__init__(message)
        self.source = source
        self.message = message

    def payload(self) -> dict:
        return {
            "status": "DATA_UNAVAILABLE", "source": self.source,
            "message": self.message, "last_known": None,
        }


def data_dir() -> Path:
    configured = os.getenv("DATA_DIR")
    if configured:
        return Path(configured).resolve()
    here = Path(__file__).resolve()
    # Lambda bundle: /var/task/data ; repository: <repo>/data
    for candidate in (here.parents[2] / "data", here.parents[3] / "data"):
        if candidate.is_dir():
            return candidate
    return here.parents[3] / "data"


def raw_path(filename: str) -> Path:
    """Resolve a raw file strictly inside data/raw (no path traversal)."""
    root = (data_dir() / "raw").resolve()
    path = (root / filename).resolve()
    if root not in path.parents:
        raise DataUnavailable(filename, "Path escapes the data directory")
    return path


def read_rows(source: str, path: Path):
    """Stream CSV rows (dicts). Raises DataUnavailable for missing/oversized."""
    if not path.is_file():
        raise DataUnavailable(source, f"Dataset file not found: {path.name}")
    if path.stat().st_size > MAX_CSV_BYTES:
        raise DataUnavailable(source, f"Dataset exceeds {MAX_CSV_BYTES} bytes")
    handle = path.open("r", encoding="utf-8-sig", newline="")
    try:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            raise DataUnavailable(source, "CSV has no header row")
        yield reader.fieldnames
        yield from reader
    finally:
        handle.close()


def parse_float(raw) -> float | None:
    """Tolerant numeric parse: blanks, NA, '-' and non-finite become None."""
    if raw is None:
        return None
    text = str(raw).strip().replace(",", "")
    if text == "" or text.upper() in {"NA", "N/A", "NAN", "NULL", "-", "--"}:
        return None
    try:
        value = float(text)
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def parse_time(raw: str, formats: tuple[str, ...]) -> datetime | None:
    """Parse a naive local timestamp. Source files do not state a zone;
    Indian government telemetry is assumed to be IST (documented)."""
    text = (raw or "").strip()
    for fmt in formats:
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=IST)
        except ValueError:
            continue
    return None


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def valid_coordinate(lat: float | None, lon: float | None) -> bool:
    return (lat is not None and lon is not None
            and -90 <= lat <= 90 and -180 <= lon <= 180
            and not (lat == 0 and lon == 0))


def age_label(hours: float) -> str:
    if hours < 0:
        return "timestamp in the future"
    if hours < 1:
        return f"{max(1, round(hours * 60))}m ago"
    if hours < 48:
        return f"{round(hours)}h ago"
    return f"{round(hours / 24)}d ago"


def freshness(observed: datetime | None, cadence_hours: float | None,
              now: datetime | None = None) -> dict:
    """CURRENT only if within 2x the dataset's own reporting cadence.

    The word LIVE is never produced: these are archived/published telemetry
    files, and their age is always shown.
    """
    if observed is None:
        return {"status": "UNKNOWN", "age_hours": None, "age_label": "no timestamp",
                "cadence_hours": cadence_hours}
    now = now or datetime.now(timezone.utc)
    hours = (now - observed).total_seconds() / 3600
    if hours < -0.1:
        status = "FUTURE-DATED"
    elif cadence_hours is None:
        status = "UNKNOWN"
    else:
        status = "CURRENT" if hours <= 2 * cadence_hours else "STALE"
    return {"status": status, "age_hours": round(hours, 2),
            "age_label": age_label(hours), "cadence_hours": cadence_hours}


def display_time(moment: datetime | None) -> str | None:
    return moment.astimezone(IST).strftime("%d %b %Y %H:%M IST") if moment else None


@dataclass
class Observation:
    timestamp: str | None
    source: str
    source_type: str          # always "PUBLIC DATA" for the four datasets
    data_label: str           # REAL PUBLIC DATA / REAL GOVERNMENT BASELINE
    station_id: str
    station_name: str
    latitude: float | None
    longitude: float | None
    state: str
    district: str
    parameter: str            # canonical, UI-readable name
    raw_parameter: str        # name exactly as published
    category: str             # DISCHARGE | LEVEL | GROUNDWATER_LEVEL | RAINFALL | ...
    value: float
    unit: str                 # unit exactly as published
    confidence: str
    note: str = ""
    value_si: float | None = None
    unit_si: str | None = None
    freshness: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


def clamp_limit(limit: int | None, default: int = 100, maximum: int = 1000) -> int:
    if limit is None:
        return default
    return max(1, min(int(limit), maximum))
