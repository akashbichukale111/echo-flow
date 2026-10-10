"""Maharashtra SCADA water level + discharge (long format).

Water level, discharge and storage are different things. This provider
exposes levels and discharges only. A pond/downstream level is never turned
into a storage volume (no verified stage-storage relationship is supplied).
"""
from __future__ import annotations

import re
import threading
from datetime import datetime

from .base import (
    DATA_LABEL_PUBLIC,
    DataUnavailable,
    Observation,
    clamp_limit,
    freshness,
    haversine_km,
    parse_float,
    parse_time,
    raw_path,
    read_rows,
    valid_coordinate,
)
from .units import to_si

SOURCE = "NWDP Maharashtra Surface Water SCADA"
FILENAME = "maharashtra_scada_water_level_discharge.csv"
CADENCE_HOURS = 1.0
TIME_FORMATS = ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%d-%m-%Y %H:%M")
REQUIRED = ("timestamp", "station_code", "station_name", "latitude",
            "longitude", "district", "parameter", "value", "unit")

LEVEL_NOTE = ("Level datum is not stated (may be an elevation above MSL or a "
              "depth). It is a water LEVEL, not storage volume.")
ZERO_LEVEL_NOTE = ("Level reported as exactly 0; this can mean no valid reading "
                   "rather than an empty structure. Do not treat as storage.")


def _where(text: str) -> str:
    return "Canal" if "canal" in text.lower() else "Dam/Barrage"


def canonical(raw: str) -> tuple[str, str]:
    """Map a published SCADA tag to (UI parameter name, category)."""
    text = " ".join(raw.split())
    low = text.lower()
    if low == "inflow discharge":
        return "Inflow Discharge", "DISCHARGE"
    m = re.match(r"^downstre\w*m discharge(?:-(\d+))?\s+(.*)$", low)
    if m:
        idx = f" #{m.group(1)}" if m.group(1) else ""
        return f"Downstream Discharge{idx} ({_where(m.group(2))})", "DISCHARGE"
    m = re.match(r"^downstream level(?:-(\d+))?\s+(.*)$", low)
    if m:
        idx = f" #{m.group(1)}" if m.group(1) else ""
        return f"Downstream Level{idx} ({_where(m.group(2))})", "LEVEL"
    m = re.match(r"^gate (\d+) discharge for (.*)$", low)
    if m:
        return f"Gate {int(m.group(1))} Discharge ({_where(m.group(2))})", "DISCHARGE"
    if low == "cumulative gate discharge":
        return "Cumulative Gate Discharge", "DISCHARGE"
    if low == "pond level":
        return "Pond Level", "LEVEL"
    if "rainfall by telemetry" in low:
        return "Rainfall (telemetry)", "RAINFALL"
    if "rain acumm" in low or "rain accum" in low:
        return "Rainfall (daily accumulated)", "RAINFALL"
    return text, "OTHER"


class MaharashtraScadaProvider:
    def __init__(self, path=None):
        self._path = path or raw_path(FILENAME)
        self._lock = threading.Lock()
        self._loaded = False
        self._obs: list[tuple[datetime, dict]] = []
        self._stations: dict[str, dict] = {}
        self.quality = {"rows": 0, "accepted": 0, "skipped": {}, "unrecognised": []}

    def _skip(self, reason):
        self.quality["skipped"][reason] = self.quality["skipped"].get(reason, 0) + 1

    def _load(self):
        with self._lock:
            if self._loaded:
                return
            rows = read_rows(SOURCE, self._path)
            header = next(rows)
            missing = [c for c in REQUIRED if c not in header]
            if missing:
                raise DataUnavailable(SOURCE, "Missing required columns: " + ", ".join(missing))
            for row in rows:
                self.quality["rows"] += 1
                moment = parse_time(row.get("timestamp", ""), TIME_FORMATS)
                value = parse_float(row.get("value"))
                lat, lon = parse_float(row.get("latitude")), parse_float(row.get("longitude"))
                raw = " ".join((row.get("parameter") or "").split())
                code = (row.get("station_code") or "").strip()
                if not raw or not code:
                    self._skip("missing_parameter_or_station"); continue
                if moment is None:
                    self._skip("bad_timestamp"); continue
                if value is None:
                    self._skip("missing_value"); continue
                if not valid_coordinate(lat, lon):
                    self._skip("bad_coordinates"); continue
                name, category = canonical(raw)
                if category == "OTHER" and raw not in self.quality["unrecognised"]:
                    self.quality["unrecognised"].append(raw)
                unit = (row.get("unit") or "").strip()
                self._stations.setdefault(code, {
                    "station_id": code, "station_name": (row.get("station_name") or "").strip(),
                    "latitude": lat, "longitude": lon, "state": "Maharashtra",
                    "district": (row.get("district") or "").strip()})
                self._obs.append((moment, {
                    "station_id": code, "parameter": name, "raw": raw,
                    "category": category, "value": value, "unit": unit}))
                self.quality["accepted"] += 1
            self._obs.sort(key=lambda item: item[0])
            if not self._obs:
                raise DataUnavailable(SOURCE, "No valid SCADA observations")
            self._loaded = True

    def _to_observation(self, moment: datetime, item: dict,
                        now: datetime | None) -> Observation:
        meta = self._stations[item["station_id"]]
        si_value, si_unit = to_si(item["value"], item["unit"])
        note = ""
        if item["category"] == "LEVEL":
            note = ZERO_LEVEL_NOTE if item["value"] == 0 else LEVEL_NOTE
        elif item["category"] == "OTHER":
            note = "Parameter name not recognised; shown as published."
        return Observation(
            timestamp=moment.isoformat(), source=SOURCE, source_type="PUBLIC DATA",
            data_label=DATA_LABEL_PUBLIC, station_id=item["station_id"],
            station_name=meta["station_name"], latitude=meta["latitude"],
            longitude=meta["longitude"], state=meta["state"], district=meta["district"],
            parameter=item["parameter"], raw_parameter=item["raw"],
            category=item["category"], value=item["value"], unit=item["unit"],
            confidence="MEDIUM", note=note, value_si=si_value, unit_si=si_unit,
            freshness=freshness(moment, CADENCE_HOURS, now))

    def stations(self, now: datetime | None = None) -> list[dict]:
        self._load()
        out = []
        for code, meta in self._stations.items():
            times = [m for m, i in self._obs if i["station_id"] == code]
            out.append({**meta, "first_observed": times[0].isoformat(),
                        "last_observed": times[-1].isoformat(),
                        "freshness": freshness(times[-1], CADENCE_HOURS, now)})
        return out

    def query(self, parameter: str | None = None, station: str | None = None,
              district: str | None = None, category: str | None = None,
              start: datetime | None = None, end: datetime | None = None,
              limit: int | None = None, now: datetime | None = None) -> list[dict]:
        self._load()
        p = (parameter or "").lower()
        out = []
        for moment, item in reversed(self._obs):
            meta = self._stations[item["station_id"]]
            if p and p not in item["parameter"].lower() and p not in item["raw"].lower():
                continue
            if station and station.lower() not in (item["station_id"].lower(),
                                                   meta["station_name"].lower()):
                continue
            if district and district.lower() != meta["district"].lower():
                continue
            if category and category.upper() != item["category"]:
                continue
            if start and moment < start:
                continue
            if end and moment > end:
                continue
            out.append(self._to_observation(moment, item, now).to_dict())
            if len(out) >= clamp_limit(limit, 100, 1000):
                break
        return out

    def latest(self, station: str | None = None, now: datetime | None = None,
               include_gates: bool = False) -> list[dict]:
        """Latest reading per (station, parameter, unit). Individual gate
        channels are omitted unless asked for, to keep payloads readable."""
        self._load()
        latest: dict[tuple, tuple[datetime, dict]] = {}
        for moment, item in self._obs:
            if station and station.lower() not in (
                    item["station_id"].lower(),
                    self._stations[item["station_id"]]["station_name"].lower()):
                continue
            if not include_gates and re.match(r"^Gate \d+ ", item["parameter"]):
                continue
            latest[(item["station_id"], item["parameter"], item["unit"])] = (moment, item)
        result = [self._to_observation(m, i, now).to_dict() for m, i in latest.values()]
        return sorted(result, key=lambda o: (o["category"], o["parameter"], o["unit"]))

    def nearest_station(self, latitude: float, longitude: float,
                        max_km: float | None = None) -> dict | None:
        self._load()
        best = min(self._stations.values(), default=None, key=lambda m: haversine_km(
            latitude, longitude, m["latitude"], m["longitude"]))
        if best is None:
            return None
        distance = haversine_km(latitude, longitude, best["latitude"], best["longitude"])
        if max_km is not None and distance > max_km:
            return None
        return {**best, "distance_km": round(distance, 1)}

    def quality_flags(self) -> list[str]:
        """Cross-checks inside the file itself (no external data)."""
        self._load()
        newest = self._obs[-1][0]
        at = [i for m, i in self._obs if m == newest]
        gates = sum(i["value"] for i in at if i["unit"] == "cusec"
                    and re.match(r"^Gate \d+ Discharge \(Canal\)$", i["parameter"]))
        down = [i["value"] for i in at if i["parameter"] == "Downstream Discharge (Canal)"
                and i["unit"] == "cusec"]
        flags = []
        if gates > 0 and down and max(down) == 0:
            flags.append(
                f"At the latest timestamp canal gate channels sum to {gates:,.0f} cusec "
                "while 'Downstream Discharge (Canal)' reads 0; the source is internally "
                "inconsistent, so treat both with caution.")
        return flags

    def summary(self, now: datetime | None = None) -> dict:
        self._load()
        stations = self.stations(now)
        newest = max(self._obs, key=lambda item: item[0])[0]
        return {
            "quality_flags": self.quality_flags(),
            "source": SOURCE, "data_label": DATA_LABEL_PUBLIC,
            "stations": len(stations), "observations": self.quality["accepted"],
            "quality": self.quality, "latest_observed": newest.isoformat(),
            "freshness": freshness(newest, CADENCE_HOURS, now),
            "cadence_hours": CADENCE_HOURS,
            "parameters_not_in_file": [
                "Gate opening / gate open height", "Telemetry status flag",
                "Reservoir storage volume"],
            "note": "Levels and discharges only; storage is not derived from level.",
        }
