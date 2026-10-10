"""MIDC water-supply schemes: a REAL GOVERNMENT BASELINE, not telemetry.

The file has no timestamp and no coordinates. Capacity/utilisation figures are
static baseline values in MLD (million litres per day). Map positions come only
from an optional approximate-town reference file and are labelled as such.
"""
from __future__ import annotations

import csv
import re
import threading
from collections import Counter

from .base import (
    DATA_LABEL_BASELINE,
    DataUnavailable,
    clamp_limit,
    data_dir,
    parse_float,
    raw_path,
    read_rows,
    valid_coordinate,
)

SOURCE = "MIDC Water Supply Schemes (Government of Maharashtra)"
FILENAME = "MIDCWaterSupplySchemes.csv"
BASELINE_NOTE = ("Baseline operating figures; the file carries no observation "
                 "date. This is not live municipal telemetry.")
PLACEMENT_NOTE = "APPROXIMATE TOWN CENTROID (not the plant site)"
MLD_TO_LPD = 1_000_000


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").replace("\n", " ")).strip().lower()


class MIDCWaterSupplyProvider:
    def __init__(self, path=None, locations_path=None):
        self._path = path or raw_path(FILENAME)
        self._locations_path = locations_path or (
            data_dir() / "reference" / "midc_scheme_approx_locations.csv")
        self._lock = threading.Lock()
        self._loaded = False
        self._schemes: list[dict] = []
        self.quality = {"rows": 0, "accepted": 0, "skipped": {}}

    def _skip(self, reason):
        self.quality["skipped"][reason] = self.quality["skipped"].get(reason, 0) + 1

    def _locations(self) -> dict[int, dict]:
        try:
            with open(self._locations_path, encoding="utf-8", newline="") as handle:
                found = {}
                for row in csv.DictReader(handle):
                    lat, lon = parse_float(row.get("latitude")), parse_float(row.get("longitude"))
                    sl = parse_float(row.get("sl_no"))
                    if sl is not None and valid_coordinate(lat, lon):
                        found[int(sl)] = {"latitude": lat, "longitude": lon,
                                          "place": row.get("place", "")}
                return found
        except OSError:
            return {}

    def _load(self):
        with self._lock:
            if self._loaded:
                return
            rows = read_rows(SOURCE, self._path)
            header = next(rows)
            cols = {_norm(c): c for c in header}

            def find(*needles):
                for key, original in cols.items():
                    if all(n in key for n in needles):
                        return original
                return None
            c_sl = find("sl")
            c_name = find("name", "scheme")
            c_cap = find("capacity")
            c_use = find("utilisation")
            c_ind = find("industrial")
            c_dom = find("domestic")
            missing = [label for label, col in (
                ("Name of water supply scheme", c_name), ("Capacity", c_cap),
                ("Present utilisation", c_use), ("Industrial", c_ind),
                ("Domestic", c_dom)) if col is None]
            if missing:
                raise DataUnavailable(SOURCE, "Missing required columns: " + ", ".join(missing))
            locations = self._locations()
            records = []
            for row in rows:
                self.quality["rows"] += 1
                name = " ".join((row.get(c_name) or "").split())
                if not name:
                    self._skip("missing_name"); continue
                sl_raw = parse_float(row.get(c_sl)) if c_sl else None
                sl = int(sl_raw) if sl_raw is not None else None
                cap_text = (row.get(c_cap) or "").strip()
                capacity = parse_float(cap_text)
                utilisation = parse_float(row.get(c_use))
                industrial = parse_float(row.get(c_ind))
                domestic = parse_float(row.get(c_dom))
                notes = []
                if capacity is None and cap_text and cap_text.upper() not in {"NA", "N/A"}:
                    notes.append(f"Capacity published as text: '{cap_text}' (no MLD figure)")
                if utilisation is None:
                    notes.append("Present utilisation not reported")
                if industrial is None and domestic is None:
                    notes.append("Neither industrial nor domestic split reported")
                if capacity is not None and utilisation is not None and utilisation > capacity:
                    notes.append("Utilisation exceeds stated capacity")
                if None not in (utilisation, industrial, domestic) or (
                        utilisation is not None and (industrial is not None or domestic is not None)):
                    split = (industrial or 0) + (domestic or 0)
                    if utilisation and abs(split - utilisation) > max(0.05, 0.05 * utilisation):
                        notes.append(
                            f"Industrial + domestic ({split:g} MLD) does not match "
                            f"utilisation ({utilisation:g} MLD) in the source")
                records.append({
                    "sl_no": sl, "scheme": name, "capacity_mld": capacity,
                    "utilisation_mld": utilisation, "industrial_mld": industrial,
                    "domestic_mld": domestic, "data_quality_notes": notes,
                })
            counts = Counter(r["scheme"].lower() for r in records)
            for record in records:
                loc = locations.get(record["sl_no"]) if record["sl_no"] is not None else None
                utilisation_pct = (
                    round(100 * record["utilisation_mld"] / record["capacity_mld"], 1)
                    if record["capacity_mld"] and record["utilisation_mld"] is not None
                    else None)
                spare = (round(record["capacity_mld"] - record["utilisation_mld"], 3)
                         if record["capacity_mld"] is not None
                         and record["utilisation_mld"] is not None else None)
                if counts[record["scheme"].lower()] > 1:
                    record["data_quality_notes"].append(
                        "Scheme name appears more than once in the source")
                record.update({
                    "scheme_id": f"MIDC-{record['sl_no']:03d}" if record["sl_no"] else None,
                    "utilisation_pct": utilisation_pct, "spare_capacity_mld": spare,
                    "latitude": loc["latitude"] if loc else None,
                    "longitude": loc["longitude"] if loc else None,
                    "placement": PLACEMENT_NOTE if loc else "NO COORDINATES IN SOURCE",
                    "source": SOURCE, "source_type": "PUBLIC DATA",
                    "data_label": DATA_LABEL_BASELINE, "timestamp": None,
                    "freshness": {"status": "UNKNOWN", "age_hours": None,
                                  "age_label": "baseline — no observation date",
                                  "cadence_hours": None},
                    "confidence": "MEDIUM", "unit": "MLD",
                    "state": "Maharashtra", "note": BASELINE_NOTE,
                })
                self._schemes.append(record)
                self.quality["accepted"] += 1
            if not self._schemes:
                raise DataUnavailable(SOURCE, "No valid MIDC scheme rows")
            self._loaded = True

    def schemes(self, q: str | None = None, placed_only: bool = False,
                limit: int | None = None, offset: int = 0) -> list[dict]:
        self._load()
        needle = (q or "").strip().lower()
        out = [s for s in self._schemes
               if (not needle or needle in s["scheme"].lower())
               and (not placed_only or s["latitude"] is not None)]
        offset = max(0, int(offset))
        return out[offset: offset + clamp_limit(limit, 100, 500)]

    def get(self, sl_no: int) -> dict | None:
        self._load()
        return next((s for s in self._schemes if s["sl_no"] == sl_no), None)

    def find_by_name(self, fragment: str) -> list[dict]:
        self._load()
        needle = fragment.strip().lower()
        return [s for s in self._schemes if needle in s["scheme"].lower()]

    def summary(self) -> dict:
        self._load()
        usable = [s for s in self._schemes if s["utilisation_mld"] is not None]
        domestic = sum(s["domestic_mld"] or 0 for s in self._schemes)
        industrial = sum(s["industrial_mld"] or 0 for s in self._schemes)
        capacity = sum(s["capacity_mld"] or 0 for s in self._schemes
                       if s["capacity_mld"] is not None)
        return {
            "source": SOURCE, "data_label": DATA_LABEL_BASELINE,
            "schemes": len(self._schemes), "quality": self.quality,
            "placed_on_map": sum(1 for s in self._schemes if s["latitude"] is not None),
            "total_capacity_mld": round(capacity, 3),
            "total_utilisation_mld": round(sum(s["utilisation_mld"] for s in usable), 3),
            "total_domestic_mld": round(domestic, 3),
            "total_industrial_mld": round(industrial, 3),
            "near_capacity_schemes": sum(
                1 for s in self._schemes
                if s["utilisation_pct"] is not None and s["utilisation_pct"] >= 90),
            "note": BASELINE_NOTE + " Totals sum only rows with numeric values.",
            "freshness": {"status": "UNKNOWN", "age_label": "baseline — no observation date"},
        }
