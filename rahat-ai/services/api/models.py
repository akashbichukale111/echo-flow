from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MODES = ("fastest", "thermal-safe", "balanced")
DEFAULT_TIME = "2026-05-15T14:00:00+05:30"

class PlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    origin: int = Field(default=12, ge=0, le=199)
    destination: int = Field(default=17, ge=0, le=199)
    departure: datetime = datetime.fromisoformat(DEFAULT_TIME)
    travel_mode: Literal["walk", "cycle", "rider"] = "rider"
    user_type: Literal[
        "Delivery Rider", "Courier", "Cyclist", "Pedestrian",
        "Outdoor Worker", "Municipal Worker"
    ] = "Delivery Rider"
    max_detour_pct: float = Field(default=100, ge=0, le=200)
    need_water: bool = False
    need_shade: bool = False
    need_cooling: bool = False
    rest_interval_min: float = Field(default=20, ge=5, le=120)
    delay_min: float = Field(default=0, ge=0, le=30)
    shade_removed: bool = False
    closed_relief: list[str] = Field(default_factory=list, max_length=20)
    rest_min: float = Field(default=0, ge=0, le=30)
    thermal_weight: float = Field(default=1.8, ge=0, le=10)
    relief_weight: float = Field(default=0.25, ge=0, le=0.8)
    # Journey-layer fields (soft preferences; the need_* flags above stay hard filters).
    needs: list[str] = Field(default_factory=list, max_length=12)
    temp_offset_c: float = Field(default=0, ge=0, le=10)

    @field_validator("departure")
    @classmethod
    def timezone_required(cls, value):
        if value.tzinfo is None:
            raise ValueError("departure must include a timezone")
        return value

    @model_validator(mode="after")
    def different_locations(self):
        if self.origin == self.destination:
            raise ValueError("origin and destination must differ")
        return self

class ScenarioRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    base: PlanRequest
    scenario: Literal[
        "earlier", "later", "traffic", "shade-removed",
        "station-closed", "rest"
    ]

class ReliefRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plan: PlanRequest
    node: int = Field(ge=0, le=199)
    radius_m: float = Field(default=1000, ge=0, le=5000)

class ReportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    node: int = Field(ge=0, le=199)
    kind: Literal[
        "SHADE HERE", "WATER HERE", "COOLING HERE", "REST POINT",
        "NO WATER", "SHADE REMOVED", "STATION CLOSED"
    ]
    note: str = Field(default="", max_length=500)
    city: Literal["pune", "delhi"] = "pune"

class TripStart(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plan: PlanRequest
    mode: Literal["fastest", "thermal-safe", "balanced"]

class TripAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0)
    action: Literal["advance", "pause", "resume", "end"]

class TripReroute(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0)
    plan: PlanRequest
    mode: Literal["fastest", "thermal-safe", "balanced"] = "balanced"
    relief_id: str | None = None
