"""Scenario domain models — ScenarioDef and supporting types.

Feature 009 (signal-tier redesign): driver_profile / vehicle_profile are replaced by
driver_signal_params (DriverSignalParams) and anomaly_signal_params (AnomalySignalParams);
vehicle_profile is removed entirely (the vehicle behaviour model is retired).
run_seed_default carries the seed suggested at setup time, frozen per run.  A scenario
dict that still contains the old driver_profile/vehicle_profile keys is rejected with a
clear "incompatible — re-author" error (FR-017).

M2 extensions (still present): speed_profile (SpeedProfile), is_night, presets.  The
drowsiness_schedule field is removed from EventPreset (replaced by the M2 behavioral
engine); it is accepted as extra data for backward compatibility while M1 fixture files
are re-authored in a later unit.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, field_validator, model_validator

from aica_api.models.profile import AnomalySignalParams, DriverSignalParams, SpeedProfile


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

    Feature 009: driver_signal_params (DriverSignalParams) and anomaly_signal_params
    (AnomalySignalParams) replace the old driver_profile/vehicle_profile pair.
    run_seed_default is the seed suggested at setup (frozen per run).  speed_profile
    is unaffected (all optional with None default so existing fixture files continue
    to parse), is_night, presets.
    """

    id: str
    version: str
    type: str
    persona: Persona
    route_intent: RouteIntent
    initial_state: dict[str, Any]
    event_presets: EventPreset
    total_duration_seconds: int
    tick_seconds: int
    allowed_actions: list[str]
    recovery_options: list[RecoveryOption] = []
    review_focus: str = ""

    # Feature 009: tiered-signal generator params — optional so M1 fixture files
    # (route/segment validation tests etc.) still parse without them.
    driver_signal_params: DriverSignalParams | None = None
    anomaly_signal_params: AnomalySignalParams | None = None
    run_seed_default: int = 42

    speed_profile: SpeedProfile | None = None
    is_night: bool = False
    child_passenger: bool = False
    familiar_route: bool = False
    presets: dict[str, Any] = {}

    # M8 UC-01: safety ceiling for rest-spot reachability check (0–100+, percent).
    # Default 100.0 = full drowsiness scale; values above 100 allow "overload"
    # (driver may reach a distant spot even at high drowsiness).
    rest_drowsiness_ceiling: float = 100.0

    @model_validator(mode="before")
    @classmethod
    def _reject_old_shape(cls, data: Any) -> Any:
        """Reject scenario dicts still in the old driver_profile/vehicle_profile shape.

        Feature 009 (FR-017): driver_profile and vehicle_profile are removed from the
        scenario schema.  A scenario authored against the old shape must fail loudly
        and clearly rather than silently dropping fields or half-parsing.
        """
        if isinstance(data, dict) and ("driver_profile" in data or "vehicle_profile" in data):
            raise ValueError(
                "incompatible scenario shape — re-author: driver_profile/vehicle_profile removed"
            )
        return data
