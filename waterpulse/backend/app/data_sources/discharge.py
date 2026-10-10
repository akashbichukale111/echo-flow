"""Maharashtra reservoir / canal gate-discharge telemetry (wide format).

The file reports one column per gate (cusec). Per-gate channels stay available;
the headline value is a DERIVED sum, labelled as such. A zero total is
reported honestly: it does not say whether a downstream canal is flowing.
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
    parse_float,
    parse_time,
    raw_path,
    read_rows,
    valid_coordinate,
)
from .units import CONVERSION_NOTE, cusec_to_l_per_day, cusec_to_m3s

SOURCE = "NWDP Maharashtra Surface Water (reservoir/canal discharge telemetry)"
FILENAME = "maharashtra_reservoir_discharge.csv"
CADENCE_HOURS = 1.0
TIME_FORMATS = ("%d-%m-%Y %H:%M", "%d-%m-%Y %H:%M:%S")
GATE_COLUMN = re.compile(r"^Gate-(\d+) Discharge \((\w+)\)$")
REQUIRED = ("Station", "Latitude", "Longitude", "Data Acquisition Time")
SCOPE_NOTE = ("Gate-discharge columns only. Downstream-canal discharge and "
              "storage are not in this file, so a zero total does not by itself "
              "show whether water is flowing in the canal.")


class MaharashtraDischargeProvider:
    def __init__(self, path=None):
        self._path = path or raw_path(FILENAME)
        self._lock = threading.Lock()
        self._loaded = False
        self._rows: list[dict] = []
        self._gate_ids: list[int] = []
        self._unit = "cusec"
        self.quality = {"rows": 0, "accepted": 0, "skipped": {}}

    def _skip(self, reason):
        self.quality["skipped"][reason] = self.quality["skipped"].get(reason, 0) + 1

    def _load(self):
        with self._lock:
            if self._loaded:
                return
            rows = read_rows(SOURCE, self._path)
            header = next(rows)
            missing = [c for c in REQUIRED if c not in header]
            gates = {}
            for column in header:
                m = GATE_COLUMN.match(column.strip())
                if m:
                    gates[column] = (int(m.group(1)), m.group(2).lower())
            if missing or not gates:
                raise DataUnavailable(SOURCE, "Missing required columns: " + ", ".join(
                    missing + ([] if gates else ["Gate-N Discharge (unit)"])))
            units = {u for _, u in gates.values()}
            if units != {"cusec"}:
                raise DataUnavailable(SOURCE, f"Unsupported discharge units: {sorted(units)}")
            self._gate_ids = sorted(g for g, _ in gates.values())
            for row in rows:
                self.quality["rows"] += 1
                moment = parse_time(row.get("Data Acquisition Time", ""), TIME_FORMATS)
                lat, lon = parse_float(row.get("Latitude")), parse_float(row.get("Longitude"))
                if moment is None:
                    self._skip("bad_timestamp"); continue
                if not valid_coordinate(lat, lon):
                    self._skip("bad_coordinates"); continue
                values = {}
                for column, (gate, _) in gates.items():
                    value = parse_float(row.get(column))
                    if value is not None and value >= 0:
                        values[gate] = value
                if not values:
                    self._skip("no_gate_values"); continue
                self._rows.append({
                    "moment": moment, "gates": values, "station": (row.get("Station") or "").strip(),
                    "lat": lat, "lon": lon,
                    "state": (row.get("State") or "").strip(),
                    "district": (row.get("District") or "").strip()})
                self.quality["accepted"] += 1
            self._rows.sort(key=lambda r: r["moment"])
            if not self._rows:
                raise DataUnavailable(SOURCE, "No valid discharge observations")
            self._loaded = True

    def _to_observation(self, row: dict, now: datetime | None) -> Observation:
        total = sum(row["gates"].values())
        return Observation(
            timestamp=row["moment"].isoformat(), source=SOURCE, source_type="PUBLIC DATA",
            data_label=DATA_LABEL_PUBLIC,
            station_id="MH-DISCH-" + re.sub(r"[^a-z0-9]+", "-", row["station"].lower()).strip("-"),
            station_name=row["station"], latitude=row["lat"], longitude=row["lon"],
            state=row["state"], district=row["district"],
            parameter="Total Gate Discharge (sum of reported gates)",
            raw_parameter=f"Gate-1 … Gate-{max(self._gate_ids)} Discharge (cusec)",
            category="DISCHARGE", value=round(total, 3), unit="cusec", confidence="MEDIUM",
            note=f"DERIVED sum of {len(row['gates'])} reporting gate channels. {SCOPE_NOTE}",
            value_si=round(cusec_to_m3s(total), 6), unit_si="m³/s",
            freshness=freshness(row["moment"], CADENCE_HOURS, now))

    def latest(self, now: datetime | None = None) -> dict:
        self._load()
        row = self._rows[-1]
        obs = self._to_observation(row, now).to_dict()
        obs["gates_reporting"] = len(row["gates"])
        obs["gates_nonzero"] = sum(1 for v in row["gates"].values() if v > 0)
        obs["litres_per_day"] = round(cusec_to_l_per_day(obs["value"]), 1)
        obs["conversion"] = CONVERSION_NOTE
        return obs

    def history(self, start: datetime | None = None, end: datetime | None = None,
                limit: int | None = None, now: datetime | None = None) -> list[dict]:
        self._load()
        rows = [r for r in self._rows
                if (start is None or r["moment"] >= start)
                and (end is None or r["moment"] <= end)]
        rows = rows[-clamp_limit(limit, 168, 2000):]
        return [self._to_observation(r, now).to_dict() for r in rows]

    def gates_at(self, timestamp: datetime | None = None) -> dict:
        self._load()
        row = self._rows[-1] if timestamp is None else next(
            (r for r in self._rows if r["moment"] == timestamp), None)
        if row is None:
            raise DataUnavailable(SOURCE, "No reading at that timestamp")
        return {"timestamp": row["moment"].isoformat(), "unit": "cusec",
                "gates": {str(k): v for k, v in sorted(row["gates"].items())}}

    def summary(self, now: datetime | None = None) -> dict:
        self._load()
        first, last = self._rows[0]["moment"], self._rows[-1]["moment"]
        gaps = [(b["moment"] - a["moment"]).total_seconds() / 3600
                for a, b in zip(self._rows, self._rows[1:])]
        totals = [sum(r["gates"].values()) for r in self._rows]
        return {
            "source": SOURCE, "data_label": DATA_LABEL_PUBLIC,
            "stations": 1, "observations": self.quality["accepted"],
            "quality": self.quality, "gate_channels": len(self._gate_ids),
            "first_observed": first.isoformat(), "latest_observed": last.isoformat(),
            "freshness": freshness(last, CADENCE_HOURS, now),
            "cadence_hours": CADENCE_HOURS,
            "largest_gap_hours": round(max(gaps), 1) if gaps else 0,
            "all_zero_in_file": all(t == 0 for t in totals),
            "maximum_total_cusec": max(totals), "unit": "cusec",
            "conversion": CONVERSION_NOTE, "note": SCOPE_NOTE,
        }
