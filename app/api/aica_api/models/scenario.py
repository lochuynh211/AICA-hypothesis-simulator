"""Scenario domain models — ScenarioDef and supporting types."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, field_validator, model_validator


class Persona(BaseModel):
    """Driver persona description."""

    name: str
    description: str = ""


class DriverProfile(BaseModel):
    """Driver profile (placeholder for M1)."""

    name: str = "default"

    model_config = {"extra": "allow"}


class VehicleProfile(BaseModel):
    """Vehicle profile (placeholder for M1)."""

    name: str = "default"

    model_config = {"extra": "allow"}


class RouteSegment(BaseModel):
    """A waypoint along the route, identified by its fractional position `at`."""

    id: str
    name: dict[str, str]
    type: Literal["start", "urban", "highway", "national", "residential", "rest", "end"]
    at: float  # in [0, 1]; validated at RouteIntent level for monotonicity
    speed_band: str
    length_band: str
    is_rest_facility: bool

    @field_validator("at")
    @classmethod
    def _at_in_range(cls, v: float) -> float:
        if not (0.0 <= v <= 1.0):
            raise ValueError(f"segment at={v!r} must be in [0, 1]")
        return v


class RestFacilityRef(BaseModel):
    """A reference to the named rest facility on the route."""

    label: dict[str, str]


class RouteIntent(BaseModel):
    """The planned route, expressed as an ordered list of segments."""

    rest_facility: RestFacilityRef
    segments: list[RouteSegment]

    @model_validator(mode="after")
    def _validate_segments(self) -> RouteIntent:
        segs = self.segments

        # at values must be strictly increasing
        ats = [s.at for s in segs]
        for i in range(1, len(ats)):
            if ats[i] <= ats[i - 1]:
                raise ValueError(
                    f"segment at values must be strictly increasing; "
                    f"got {ats[i - 1]!r} then {ats[i]!r} at index {i}"
                )

        # Exactly one rest facility
        rest_count = sum(1 for s in segs if s.is_rest_facility)
        if rest_count != 1:
            raise ValueError(
                f"exactly one segment must have is_rest_facility=True; got {rest_count}"
            )

        return self


class DrowsinessScheduleEntry(BaseModel):
    """A drowsiness band that becomes active at a fractional route position."""

    at: float
    band: str


class EventPreset(BaseModel):
    """Deterministic event schedule resolved from scenario configuration."""

    drowsiness_schedule: list[DrowsinessScheduleEntry]
    signal_duration_at_trigger: str
    rest_spot_eta_near_before: str | None = None
    rest_spot_eta_schedule: list[dict] | None = None

    model_config = {"extra": "allow"}


class ScenarioDef(BaseModel):
    """Top-level scenario definition."""

    id: str
    version: str
    type: str
    persona: Persona
    route_intent: RouteIntent
    initial_state: dict[str, str]
    event_presets: EventPreset
    driver_profile: DriverProfile = DriverProfile()
    vehicle_profile: VehicleProfile = VehicleProfile()
    total_duration_seconds: int
    tick_seconds: int
    allowed_actions: list[str]
    review_focus: str = ""
