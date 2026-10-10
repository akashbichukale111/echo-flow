"""Delhi groundwater telemetry (6-hourly). Contextual evidence only.

Groundwater level is never converted into tank storage. The file does not
state the sign convention or datum (RL_MSL is empty), so values are shown
exactly as published and no hydrological interpretation is attached.
"""
from __future__ import annotations

import re
import threading
from datetime import datetime

from .base import (
    DATA_LABEL_PUBLIC,
    DataUnavailable,
    Observation,
    age_label,
    clamp_limit,
    display_time,
    freshness,
    haversine_km,
    parse_float,
    parse_time,
    raw_path,
    read_rows,
    valid_coordinate,
)

SOURCE = "NWDP / Delhi Surface Water & Ground Water Departments"
FILENAME = "delhi_groundwater_2026_2030.csv"
CADENCE_HOURS = 6.0
TIME_FORMATS = ("%d-%m-%Y %H:%M", "%d-%m-%Y %H:%M:%S")
NOTE = ("Sign convention and datum are not stated in the source file; "
        "value shown as published, not interpreted as depth or elevation.")
REQUIRED = ("Station", "Latitude", "Longitude", "Data Acquisition Time")


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def short_name(raw: str) -> str:
    """'New Delhi Daurala Daurala' -> 'Daurala'; keeps unusual names intact."""
    name = re.sub(r"^new delhi\s+", "", raw.strip(), flags=re.IGNORECASE)
    words = name.split()
    if len(words) > 2 and words[0].lower() == words[1].lower():
        words = words[1:]
    half = len(words) // 2
    if half and len(words) % 2 == 0 and words[:half] == words[half:]:
        words = words[:half]
    return " ".join(words) or raw.strip()


class DelhiGroundwaterProvider:
    def __init__(self, path=None):
        self._path = path or raw_path(FILENAME)
        self._lock = threading.Lock()
        self._loaded = False
        self._stations: dict[str, dict] = {}
        self._series: dict[str, list[tuple[datetime, float]]] = {}
        self.quality = {"rows": 0, "accepted": 0, "skipped": {}}

    # ------------------------------------------------------------ loading
    def _skip(self, reason: str):
        self.quality["skipped"][reason] = self.quality["skipped"].get(reason, 0) + 1

    def _load(self):
        with self._lock:
            if self._loaded:
                return
            rows = read_rows(SOURCE, self._path)
            header = next(rows)
            missing = [c for c in REQUIRED if c not in header]
            value_column = next(
                (c for c in header if c.lower().startswith("groundwater level")), None)
            if missing or value_column is None:
                raise DataUnavailable(
                    SOURCE, "Missing required columns: "
                    + ", ".join(missing + ([] if value_column else ["Groundwater Level"])))
            for row in rows:
                self.quality["rows"] += 1
                moment = parse_time(row.get("Data Acquisition Time", ""), TIME_FORMATS)
                value = parse_float(row.get(value_column))
                lat, lon = parse_float(row.get("Latitude")), parse_float(row.get("Longitude"))
                name = (row.get("Station") or "").strip()
                if not name:
                    self._skip("missing_station"); continue
                if moment is None:
                    self._skip("bad_timestamp"); continue
                if value is None:
                    self._skip("missing_value"); continue
                if not valid_coordinate(lat, lon):
                    self._skip("bad_coordinates"); continue
                sid = "DL-GW-" + slug(name)
                self._stations.setdefault(sid, {
                    "station_id": sid, "station_name": name,
                    "short_name": short_name(name), "latitude": lat, "longitude": lon,
                    "state": (row.get("State") or "Delhi").strip(),
                    "district": (row.get("District") or "").strip().title(),
                })
                self._series.setdefault(sid, []).append((moment, value))
                self.quality["accepted"] += 1
            for series in self._series.values():
                series.sort(key=lambda item: item[0])
            if not self._series:
                raise DataUnavailable(SOURCE, "No valid groundwater observations")
            self._loaded = True

    # -------------------------------------------------------------- views
    def _observation(self, sid: str, moment: datetime, value: float,
                     now: datetime | None) -> Observation:
        meta = self._stations[sid]
        return Observation(
            timestamp=moment.isoformat(), source=SOURCE, source_type="PUBLIC DATA",
            data_label=DATA_LABEL_PUBLIC, station_id=sid,
            station_name=meta["short_name"], latitude=meta["latitude"],
            longitude=meta["longitude"], state=meta["state"],
            district=meta["district"], parameter="Groundwater Level",
            raw_parameter="Groundwater Level Telemetry 6 Hourly (meter)",
            category="GROUNDWATER_LEVEL", value=value, unit="m", confidence="MEDIUM",
            note=NOTE, value_si=value, unit_si="m",
            freshness=freshness(moment, CADENCE_HOURS, now))

    def stations(self, q: str | None = None, now: datetime | None = None) -> list[dict]:
        self._load()
        out = []
        needle = (q or "").strip().lower()
        for sid, meta in self._stations.items():
            if needle and needle not in meta["station_name"].lower() \
                    and needle not in meta["short_name"].lower():
                continue
            series = self._series[sid]
            out.append({**meta, "readings": len(series),
                        "first_observed": series[0][0].isoformat(),
                        "last_observed": series[-1][0].isoformat(),
                        "freshness": freshness(series[-1][0], CADENCE_HOURS, now)})
        return sorted(out, key=lambda item: item["short_name"])

    def latest(self, station: str | None = None, now: datetime | None = None,
               limit: int | None = None) -> list[dict]:
        self._load()
        needle = (station or "").strip().lower()
        result = []
        for sid, series in self._series.items():
            meta = self._stations[sid]
            if needle and not any(needle in text for text in (
                    sid.lower(), meta["station_name"].lower(), meta["short_name"].lower())):
                continue
            moment, value = series[-1]
            result.append(self._observation(sid, moment, value, now).to_dict())
        result.sort(key=lambda item: item["station_name"])
        return result[:clamp_limit(limit, 50, 200)]

    def history(self, station: str, start: datetime | None = None,
                end: datetime | None = None, limit: int | None = None,
                now: datetime | None = None) -> list[dict]:
        self._load()
        sid = self._resolve(station)
        series = [item for item in self._series[sid]
                  if (start is None or item[0] >= start) and (end is None or item[0] <= end)]
        series = series[-clamp_limit(limit, 120, 2000):]
        return [self._observation(sid, m, v, now).to_dict() for m, v in series]

    def _resolve(self, station: str) -> str:
        needle = station.strip().lower()
        for sid, meta in self._stations.items():
            if needle in (sid.lower(), meta["station_name"].lower(),
                          meta["short_name"].lower()):
                return sid
        raise DataUnavailable(SOURCE, f"Unknown groundwater station: {station[:60]}")

    def trend(self, station: str, days: float = 30,
              now: datetime | None = None) -> dict:
        """Change between the last reading and the reading ~N days earlier.
        Reported as published; direction is not interpreted (datum unknown)."""
        self._load()
        sid = self._resolve(station)
        series = self._series[sid]
        last_t, last_v = series[-1]
        target = last_t.timestamp() - days * 86400
        earlier = min(series, key=lambda item: abs(item[0].timestamp() - target))
        span_days = (last_t - earlier[0]).total_seconds() / 86400
        if span_days < days * 0.5:
            return {"status": "INSUFFICIENT_HISTORY", "days_requested": days,
                    "span_days": round(span_days, 1)}
        return {"status": "OK", "days_requested": days, "span_days": round(span_days, 1),
                "change": round(last_v - earlier[1], 3), "unit": "m",
                "from": earlier[0].isoformat(), "to": last_t.isoformat(),
                "interpretation": "Change in the published value; hydrological "
                                  "direction is not asserted (datum/sign not stated)."}

    def nearest(self, latitude: float, longitude: float, k: int = 3,
                max_km: float | None = None, now: datetime | None = None) -> list[dict]:
        self._load()
        ranked = sorted(
            ((haversine_km(latitude, longitude, m["latitude"], m["longitude"]), sid)
             for sid, m in self._stations.items()))
        out = []
        for distance, sid in ranked:
            if max_km is not None and distance > max_km:
                break
            moment, value = self._series[sid][-1]
            item = self._observation(sid, moment, value, now).to_dict()
            item["distance_km"] = round(distance, 1)
            out.append(item)
            if len(out) >= k:
                break
        return out

    def summary(self, now: datetime | None = None) -> dict:
        self._load()
        stations = self.stations(now=now)
        newest = max(stations, key=lambda s: s["last_observed"])
        return {
            "source": SOURCE, "data_label": DATA_LABEL_PUBLIC, "stations": len(stations),
            "observations": self.quality["accepted"], "quality": self.quality,
            "latest_observed": newest["last_observed"],
            "latest_observed_display": display_time(
                parse_iso(newest["last_observed"])),
            "freshness": newest["freshness"],
            "stale_stations": sum(1 for s in stations
                                  if s["freshness"]["status"] != "CURRENT"),
            "cadence_hours": CADENCE_HOURS, "note": NOTE,
        }


def parse_iso(text: str) -> datetime:
    return datetime.fromisoformat(text)


__all__ = ["DelhiGroundwaterProvider", "age_label"]
