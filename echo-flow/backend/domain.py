from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def uid() -> str:
    return str(uuid4())


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Intervention(StrictModel):
    pump: float = Field(default=0, ge=0, le=1)
    gate_open: bool = True
    road_closed: bool = False
    buffer: Literal["B5", "B6"] | None = None
    clear_drain: bool = False
    noncritical_shed: float = Field(default=0, ge=0, le=0.5)
    priority_power: bool = False

    @model_validator(mode="after")
    def supported_pump(self):
        if self.pump not in (0, 0.4, 0.5, 0.6, 0.8, 1):
            raise ValueError("Unsupported pump setting")
        return self


class CreateScenario(StrictModel):
    mode: Literal["flood", "heat"] = "flood"


class RunRequest(StrictModel):
    intervention: Intervention | None = None


class VerifyRequest(StrictModel):
    confirm_synthetic_measurement: bool


class HumanRequest(StrictModel):
    run_id: str = Field(min_length=1, max_length=100)
    decision: Literal["approve", "modify", "reject"]
    confirmed: bool = False
    reason: str = Field(default="", max_length=1000)
    intervention: Intervention | None = None


class ExecuteRequest(StrictModel):
    run_id: str = Field(min_length=1, max_length=100)


class Node(StrictModel):
    id: str
    kind: str
    x: float
    y: float
    population: int = 0


class Edge(StrictModel):
    source: str
    target: str
    kind: Literal["dependency", "route"]
    minutes: float = 0


class State(StrictModel):
    mode: Literal["flood", "heat"]
    elapsed_min: float = 0
    a_m3: float = Field(default=8000, ge=0)
    b_m3: float = Field(default=800, ge=0)
    buffers_m3: dict[str, float] = Field(default_factory=lambda: {"B5": 0, "B6": 0})
    rain_m3_min: float = Field(default=80, ge=0)
    water_m3: float = Field(default=700, ge=0)
    temperature_c: float = 44
    base_kw: float = Field(default=800, ge=0)
    transformer_kw: float = Field(default=1000, gt=0)


class Assumptions(StrictModel):
    rain_factor: float = Field(default=1, ge=0, le=2)
    pump_efficiency: float = Field(default=1, ge=0, le=1.5)
    unknown: float = Field(ge=0, le=0.95)


class Observation(StrictModel):
    source_type: Literal["synthetic"] = "synthetic"
    label: str
    value: float
    unit: str
    timestamp: str = Field(default_factory=now)


class RainfallRequest(StrictModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class RouteRequest(StrictModel):
    """Positions are [longitude, latitude]."""
    origin: list[float] = Field(min_length=2, max_length=2)
    destination: list[float] = Field(min_length=2, max_length=2)
    travel_mode: Literal["Car", "Truck", "Walking"] = "Car"

    @model_validator(mode="after")
    def valid_positions(self):
        for p in (self.origin, self.destination):
            if not (-180 <= p[0] <= 180 and -90 <= p[1] <= 90):
                raise ValueError("Position must be [longitude, latitude] within range")
        if self.origin == self.destination:
            raise ValueError("Origin and destination must differ")
        return self
