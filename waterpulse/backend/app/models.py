from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

SourceType = Literal[
    "PUBLIC DATA", "OPERATOR INPUT", "DEMO DATA",
    "MODEL OUTPUT", "AI RECOMMENDATION",
    "DERIVED MODEL INPUT", "SIMULATED OPERATIONAL DATA"
]

# Data-honesty tier shown next to every value in the UI.
DataLabel = Literal[
    "REAL PUBLIC DATA", "REAL GOVERNMENT BASELINE", "DERIVED MODEL INPUT",
    "SIMULATED OPERATIONAL DATA", "MODEL OUTPUT", "OPERATOR INPUT",
    "DEMO DATA", "AI RECOMMENDATION"
]

LABELLED_FIELDS = {
    "storage_l", "reserve_l", "demand_lpd", "supply_lpd", "loss_pct",
    "demand_trend_pct", "supply_trend_pct", "tanker_capacity_l",
    "available_tankers", "refill_minutes", "distance_km", "speed_kph",
    "unload_minutes", "criticality", "observed_anomaly",
}

def now() -> str:
    return datetime.now(timezone.utc).isoformat()

class StrictModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid", allow_inf_nan=False, str_strip_whitespace=True
    )

class Record(StrictModel):
    source: str
    source_type: SourceType
    timestamp: str
    confidence: Literal["LOW", "MEDIUM", "HIGH"]
    location: str
    value: float | str | bool
    unit: str
    influence: str
    data_label: DataLabel | None = None

class ZoneInput(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    location: str = Field(min_length=1, max_length=120)
    latitude: float = Field(ge=-85, le=85)
    longitude: float = Field(ge=-180, le=180)
    demand_lpd: float = Field(gt=0, le=1_000_000_000)
    storage_l: float = Field(ge=0, le=10_000_000_000)
    supply_lpd: float = Field(ge=0, le=1_000_000_000)
    loss_pct: float = Field(ge=0, le=60)
    reserve_l: float = Field(ge=0, le=10_000_000_000)
    tanker_capacity_l: float = Field(gt=0, le=100_000)
    available_tankers: int = Field(ge=0, le=1000)
    refill_minutes: float = Field(ge=1, le=1440)
    distance_km: float = Field(ge=0, le=1000)
    speed_kph: float = Field(gt=0, le=130)
    unload_minutes: float = Field(ge=1, le=240)
    demand_trend_pct: float = Field(default=0, ge=-90, le=200)
    supply_trend_pct: float = Field(default=0, ge=-100, le=200)
    criticality: int = Field(default=3, ge=1, le=5)
    observed_anomaly: bool = False
    priority_facilities: str = Field(default="", max_length=500)
    notes: str = Field(default="", max_length=2000)
    # Per-field honesty labels; a field without an entry is OPERATOR INPUT.
    field_labels: dict[str, DataLabel] = Field(default_factory=dict)
    # Optional link to a row of the MIDC baseline (Sl. No.).
    linked_scheme_sl: int | None = Field(default=None, ge=1, le=10_000)
    tanker_source_name: str = Field(default="", max_length=120)
    tanker_source_lat: float | None = Field(default=None, ge=-85, le=85)
    tanker_source_lon: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def labels_refer_to_real_fields(self):
        unknown = set(self.field_labels) - LABELLED_FIELDS
        if unknown:
            raise ValueError(f"Unknown labelled fields: {sorted(unknown)}")
        if (self.tanker_source_lat is None) != (self.tanker_source_lon is None):
            raise ValueError("Tanker source needs both latitude and longitude")
        return self

class Zone(ZoneInput):
    id: str
    version: int = Field(ge=1)
    provenance: Record

class ZoneUpdate(ZoneInput):
    expected_version: int = Field(ge=1)

class ScenarioInput(StrictModel):
    loss_reduction_pp: float = Field(default=4, ge=0, le=30)
    intervention_delay_hours: float = Field(default=6, ge=0, le=720)
    trips_per_tanker: int = Field(default=3, ge=0, le=10)
    redistribution_l: float = Field(default=100_000, ge=0, le=10_000_000)
    donor_zone_id: str | None = None
    donor_min_buffer_days: float = Field(default=7, ge=0, le=90)

class CreateAction(StrictModel):
    scenario: Literal["no_action", "tanker", "loss", "redistribution"]
    parameters: ScenarioInput
    note: str = Field(default="", max_length=1500)

class ActionDecision(StrictModel):
    decision: Literal["approve", "reject", "modify"]
    note: str = Field(min_length=3, max_length=1500)
    scenario: Literal[
        "no_action", "tanker", "loss", "redistribution"
    ] | None = None

class ExecutionInput(StrictModel):
    note: str = Field(min_length=5, max_length=2000)

class VerificationInput(StrictModel):
    storage_l: float = Field(ge=0, le=10_000_000_000)
    supply_lpd: float = Field(ge=0, le=1_000_000_000)
    demand_lpd: float = Field(gt=0, le=1_000_000_000)
    loss_pct: float = Field(ge=0, le=60)
    anomaly_observed: bool
    observed_at: datetime
    simulated: bool = True
    note: str = Field(min_length=5, max_length=2000)

    @model_validator(mode="after")
    def timestamp_is_not_future(self):
        if self.observed_at.tzinfo is None:
            raise ValueError("Observation time must include a timezone")
        if self.observed_at > datetime.now(timezone.utc):
            raise ValueError("Observation time cannot be in the future")
        return self

class TankerInput(StrictModel):
    required_water_l: float = Field(gt=0, le=100_000_000)
    operating_hours: float = Field(default=12, gt=0, le=72)
