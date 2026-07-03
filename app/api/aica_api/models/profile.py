"""Profile domain models — DriverSignalParams, AnomalySignalParams, SpeedProfile.

Feature 009 (signal-tier redesign): DriverModelProfile is renamed to
DriverSignalParams and loses its attention sub-model (Tier "attention" signal
removed from the tick output — see specs/009-signal-tier-redesign/data-model.md
§1).  AnomalySignalParams is new: it carries the seeded-Poisson anomaly-rate
generator's parameters (see services/behavior/anomaly_signal.py).  All
vehicle-profile classes (steering/pedal/lane/ADAS) are removed — the vehicle
behaviour model is retired in this feature.

All numeric rate fields must be ≥ 0.
Threshold fields (percentages) must be in [0, 100].
SpeedProfile forbids extra keys (segment types must be exactly the declared set).
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, field_validator


# ─── DriverSignalParams sub-models ───────────────────────────────────────────


class DrowsinessModel(BaseModel):
    """Per-minute growth rates for the drowsiness component."""

    model_config = ConfigDict(extra="forbid")

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

    model_config = ConfigDict(extra="forbid")

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


class RecoveryModel(BaseModel):
    """Recovery amounts (absolute units) for short and long rests."""

    model_config = ConfigDict(extra="forbid")

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


# ─── DriverSignalParams (renamed from DriverModelProfile; attention removed) ──


class DriverSignalParams(BaseModel):
    """Driver signal generator parameters: drowsiness, fatigue, recovery.

    Renamed from DriverModelProfile (feature 009).  The attention sub-model
    is removed — attentionLevel is a retired tick-output signal.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    drowsiness_model: DrowsinessModel
    fatigue_model: FatigueModel
    recovery_model: RecoveryModel


# ─── AnomalySignalParams (new — seeded-Poisson anomaly-rate generator) ───────


class AnomalySignalParams(BaseModel):
    """Parameters for the seeded-Poisson anomaly-event generator (Tier 3b).

    See specs/009-signal-tier-redesign/contracts/anomaly-generator.md and
    services/behavior/anomaly_signal.py::advance_anomaly.

    lambda_base:  baseline anomaly rate (events/min) at or below theta.
    lambda_gain:  extra rate per drowsiness point above theta (events/min per
                  drowsiness unit, scaled by /100 in the rate formula).
    theta:        drowsiness threshold [0, 100] above which the rate increases.
    window_min:   rolling-window width, in minutes, over which anomaly_rate
                  counts recent spikes.  Must be > 0.
    """

    model_config = ConfigDict(extra="forbid")

    lambda_base: float
    lambda_gain: float
    theta: float
    window_min: float

    @field_validator("lambda_base", "lambda_gain", "theta")
    @classmethod
    def _nonneg(cls, v: float) -> float:
        if v < 0:
            raise ValueError(f"value must be >= 0, got {v!r}")
        return v

    @field_validator("window_min")
    @classmethod
    def _positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError(f"window_min must be > 0, got {v!r}")
        return v


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


# ─── ProfileOverrides (request-body envelope, shared by /run-plans + /preview) ─


class ProfileOverrides(BaseModel):
    """T008: Setup-time profile overrides (all sub-objects optional).

    Each provided sub-object is deep-merged onto the scenario's corresponding
    profile (field-by-field, recursively for nested dicts).  Unset fields keep
    the scenario value.  The merged result is validated against the typed profile
    model — invalid fields or unknown keys cause a 400 with no run created.

    Feature 009 (signal-tier redesign): the vehicle behaviour model is retired.
    ``vehicle`` is still accepted here (as a plain dict) purely so
    ``run_plan._apply_profile_overrides`` can reject it with a clear 400
    validation error instead of a generic "unknown field" 422. ``anomaly`` is
    new — overrides the Tier-3b seeded anomaly-rate generator's parameters.

    Body shape for U6 ProfileEditor:
      { "profiles": { "driver": { ... }, "anomaly": { ... }, "speed": { ... } } }
    All sub-objects are optional; supply only the sub-objects you want to
    override.  Within each sub-object, supply only the fields you want to change.

    UX-BE (feature 009 UX iteration): shared verbatim between
    ``POST /api/run-plans`` (routers/run_plans.py) and the ephemeral
    ``POST /api/runs/preview`` (routers/runs.py) so a preview computed with the
    same ``profiles`` payload as a real run is faithful to it — see
    services/preview.py::evaluate_preview.
    """

    driver: dict | None = None   # partial DriverSignalParams dict (deep-merged)
    anomaly: dict | None = None  # partial AnomalySignalParams dict (deep-merged)
    speed: dict | None = None    # partial SpeedProfile dict (deep-merged)
    vehicle: dict | None = None  # retired — rejected by _apply_profile_overrides
