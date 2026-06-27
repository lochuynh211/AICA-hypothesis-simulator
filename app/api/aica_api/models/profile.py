"""Profile domain models — DriverModelProfile, VehicleBehaviorProfile, SpeedProfile.

All numeric rate fields must be ≥ 0.
Threshold fields (percentages) must be in [0, 100].
SpeedProfile forbids extra keys (segment types must be exactly the declared set).
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, field_validator


# ─── DriverModelProfile sub-models ───────────────────────────────────────────


class DrowsinessModel(BaseModel):
    """Per-minute growth rates for the drowsiness component."""

    base_growth_per_min: float
    night_add_per_min: float
    monotony_add_per_min: float
    traffic_jam_add_per_min: float

    @field_validator(
        "base_growth_per_min",
        "night_add_per_min",
        "monotony_add_per_min",
        "traffic_jam_add_per_min",
    )
    @classmethod
    def _nonneg(cls, v: float) -> float:
        if v < 0:
            raise ValueError(f"rate must be >= 0, got {v!r}")
        return v


class FatigueModel(BaseModel):
    """Per-minute growth rates for the fatigue component."""

    base_growth_per_min: float
    continuous_driving_add_per_min_after_60_min: float
    mountain_road_add_per_min: float
    traffic_jam_add_per_min: float

    @field_validator(
        "base_growth_per_min",
        "continuous_driving_add_per_min_after_60_min",
        "mountain_road_add_per_min",
        "traffic_jam_add_per_min",
    )
    @classmethod
    def _nonneg(cls, v: float) -> float:
        if v < 0:
            raise ValueError(f"rate must be >= 0, got {v!r}")
        return v


class AttentionModel(BaseModel):
    """Attention recovery and drop rates."""

    base_recovery_per_min: float
    monotony_drop_per_min: float
    drowsiness_drop_factor: float
    active_content_recovery_per_min: float

    @field_validator(
        "base_recovery_per_min",
        "monotony_drop_per_min",
        "drowsiness_drop_factor",
        "active_content_recovery_per_min",
    )
    @classmethod
    def _nonneg(cls, v: float) -> float:
        if v < 0:
            raise ValueError(f"rate must be >= 0, got {v!r}")
        return v


class RecoveryModel(BaseModel):
    """Recovery amounts (absolute units) for short and long rests."""

    short_rest_drowsiness_recovery: float
    short_rest_fatigue_recovery: float
    long_rest_drowsiness_recovery: float
    long_rest_fatigue_recovery: float

    @field_validator(
        "short_rest_drowsiness_recovery",
        "short_rest_fatigue_recovery",
        "long_rest_drowsiness_recovery",
        "long_rest_fatigue_recovery",
    )
    @classmethod
    def _nonneg(cls, v: float) -> float:
        if v < 0:
            raise ValueError(f"recovery amount must be >= 0, got {v!r}")
        return v


# ─── DriverModelProfile ───────────────────────────────────────────────────────


class DriverModelProfile(BaseModel):
    """Complete driver behaviour model: drowsiness, fatigue, attention, recovery."""

    id: str
    drowsiness_model: DrowsinessModel
    fatigue_model: FatigueModel
    attention_model: AttentionModel
    recovery_model: RecoveryModel


# ─── VehicleBehaviorProfile sub-models ───────────────────────────────────────


class SteeringInstabilityProfile(BaseModel):
    """Steering instability signal model."""

    base_level: float
    drowsiness_factor: float
    fatigue_factor: float
    mountain_road_add: float
    traffic_jam_reduce: float

    @field_validator(
        "base_level",
        "drowsiness_factor",
        "fatigue_factor",
        "mountain_road_add",
        "traffic_jam_reduce",
    )
    @classmethod
    def _nonneg(cls, v: float) -> float:
        if v < 0:
            raise ValueError(f"rate must be >= 0, got {v!r}")
        return v


class LaneDepartureProfile(BaseModel):
    """Lane departure detection model."""

    enabled_on: list[str]
    drowsiness_threshold: float
    fatigue_threshold: float
    count_when_threshold_exceeded: int

    @field_validator("drowsiness_threshold", "fatigue_threshold")
    @classmethod
    def _threshold_in_range(cls, v: float) -> float:
        if not (0.0 <= v <= 100.0):
            raise ValueError(f"threshold must be in [0, 100], got {v!r}")
        return v


class PedalAbnormalityProfile(BaseModel):
    """Pedal abnormality signal model."""

    base_level: float
    fatigue_factor: float
    traffic_jam_add: float
    mountain_road_add: float

    @field_validator(
        "base_level",
        "fatigue_factor",
        "traffic_jam_add",
        "mountain_road_add",
    )
    @classmethod
    def _nonneg(cls, v: float) -> float:
        if v < 0:
            raise ValueError(f"rate must be >= 0, got {v!r}")
        return v


class AdasWarningProfile(BaseModel):
    """ADAS warning threshold configuration."""

    lane_departure_warning_threshold: float
    steering_instability_warning_threshold: float

    @field_validator(
        "lane_departure_warning_threshold",
        "steering_instability_warning_threshold",
    )
    @classmethod
    def _threshold_in_range(cls, v: float) -> float:
        if not (0.0 <= v <= 100.0):
            raise ValueError(f"threshold must be in [0, 100], got {v!r}")
        return v


# ─── VehicleBehaviorProfile ───────────────────────────────────────────────────


class VehicleBehaviorProfile(BaseModel):
    """Vehicle sensor behaviour model."""

    rolling_window_seconds: int = 300
    steering_instability: SteeringInstabilityProfile
    lane_departure: LaneDepartureProfile
    pedal_abnormality: PedalAbnormalityProfile
    adas_warning: AdasWarningProfile


# ─── SpeedProfile ─────────────────────────────────────────────────────────────


class SpeedProfile(BaseModel):
    """Expected travel speeds (kph) per road-segment type.

    Extra keys are forbidden — segment type keys must be exactly the declared set.
    """

    normal_road_kph: int
    highway_kph: int
    mountain_road_kph: int
    sightseeing_road_kph: int
    traffic_jam_kph: int

    model_config = ConfigDict(extra="forbid")
