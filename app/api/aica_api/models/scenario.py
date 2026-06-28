"""Scenario domain models — ScenarioDef and supporting types.

M2 extensions: driver_profile (DriverModelProfile), vehicle_profile (VehicleBehaviorProfile),
speed_profile (SpeedProfile), is_night, presets.  The drowsiness_schedule field is removed
from EventPreset (replaced by the M2 behavioral engine); it is accepted as extra data for
backward compatibility while M1 fixture files are re-authored in a later unit.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, field_validator, model_validator

from aica_api.models.profile import DriverModelProfile, SpeedProfile, VehicleBehaviorProfile


class Persona(BaseModel):
    """Driver persona description."""

    name: str
    description: str = ""


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


class EventPreset(BaseModel):
    """Deterministic event schedule resolved from scenario configuration.

    drowsiness_schedule has been removed from the declared fields (M2: replaced
    by the behavioral engine).  The field is still accepted as extra data while
    M1 fixture files are re-authored in a later unit.
    """

    signal_duration_at_trigger: str
    rest_spot_eta_near_before: str | None = None
    rest_spot_eta_schedule: list[dict] | None = None

    model_config = {"extra": "allow"}


class RecoveryStage(BaseModel):
    phase: str                                   # wakefulness | nap | content
    content: str                                 # audio_karaoke | sleep | video_karaoke | stretch | ...
    motion: Literal["MOVING", "STOPPED"]
    ticks: int | None = None                     # None = lasts until rest spot (wakefulness)
    model_config = {"extra": "allow"}


class RecoveryOption(BaseModel):
    id: str
    label: dict                                  # {ja, en}
    rest_type: Literal["short", "long"] | None = None
    stages: list[RecoveryStage] = []
    postpone: bool = False
    model_config = {"extra": "allow"}


class ScenarioDef(BaseModel):
    """Top-level scenario definition.

    M2 additions: driver_profile, vehicle_profile, speed_profile (all optional
    with None default so existing fixture files continue to parse), is_night,
    presets.
    """

    id: str
    version: str
    type: str
    persona: Persona
    route_intent: RouteIntent
    initial_state: dict[str, str]
    event_presets: EventPreset
    total_duration_seconds: int
    tick_seconds: int
    allowed_actions: list[str]
    recovery_options: list[RecoveryOption] = []
    review_focus: str = ""

    # M2 profile fields — optional so M1 fixture files still parse
    driver_profile: DriverModelProfile | None = None
    vehicle_profile: VehicleBehaviorProfile | None = None
    speed_profile: SpeedProfile | None = None
    is_night: bool = False
    presets: dict[str, Any] = {}

    # M7 UC-01: safety ceiling for rest-spot reachability check (0–100, percent)
    rest_drowsiness_ceiling: float = 80.0
