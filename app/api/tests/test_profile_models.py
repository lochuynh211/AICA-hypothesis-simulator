"""T003 — Profile model tests. Written RED-first per TDD.

Feature 009 (signal-tier redesign): DriverModelProfile is renamed to
DriverSignalParams and loses its attention_model sub-model (the attention
tick-output signal is retired — see aica_api.models.profile module docstring).
VehicleBehaviorProfile (steering/pedal/lane/ADAS) is retired entirely — the
vehicle behaviour model is gone, so its tests are deleted rather than
repointed (there's nothing surviving to test). SpeedProfile is unaffected.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError


# ─── Shared valid fixtures ────────────────────────────────────────────────────

VALID_DROWSINESS_MODEL = {
    "base_growth_per_min": 0.1,
    "night_add_per_min": 0.05,
    "monotony_add_per_min": 0.02,
    "traffic_jam_add_per_min": 0.03,
}

VALID_FATIGUE_MODEL = {
    "base_growth_per_min": 0.08,
    "continuous_driving_add_per_min_after_60_min": 0.04,
    "mountain_road_add_per_min": 0.06,
    "traffic_jam_add_per_min": 0.02,
}

VALID_RECOVERY_MODEL = {
    "sleep": {"drowsiness": 80.0, "fatigue": 60.0},
    "stretch": {"drowsiness": 30.0, "fatigue": 20.0},
}

VALID_DRIVER_SIGNAL_PARAMS = {
    "id": "default_driver",
    "drowsiness_model": VALID_DROWSINESS_MODEL,
    "fatigue_model": VALID_FATIGUE_MODEL,
    "recovery_model": VALID_RECOVERY_MODEL,
}

VALID_SPEED_PROFILE = {
    "normal_road_kph": 60,
    "highway_kph": 100,
    "mountain_road_kph": 40,
    "sightseeing_road_kph": 30,
    "traffic_jam_kph": 10,
}


# ─── DriverSignalParams (renamed from DriverModelProfile; attention removed) ──


def test_driver_signal_params_valid():
    from aica_api.models.profile import DriverSignalParams

    p = DriverSignalParams(**VALID_DRIVER_SIGNAL_PARAMS)
    assert p.id == "default_driver"
    assert p.drowsiness_model.base_growth_per_min == 0.1
    assert p.fatigue_model.traffic_jam_add_per_min == 0.02
    assert p.recovery_model["sleep"].drowsiness == 80.0


def test_driver_signal_params_has_no_attention_model():
    """Feature 009: the attention sub-model is retired — DriverSignalParams has
    no attention_model field at all (extra="forbid" would reject it if supplied)."""
    from aica_api.models.profile import DriverSignalParams

    assert not hasattr(DriverSignalParams, "attention_model")
    with pytest.raises(ValidationError):
        DriverSignalParams(**{**VALID_DRIVER_SIGNAL_PARAMS, "attention_model": {
            "base_recovery_per_min": 0.0,
            "monotony_drop_per_min": 0.01,
            "drowsiness_drop_factor": 0.5,
            "active_content_recovery_per_min": 0.1,
        }})


def test_driver_signal_params_drowsiness_model_rate_negative_rejected():
    from aica_api.models.profile import DriverSignalParams

    bad = {**VALID_DRIVER_SIGNAL_PARAMS, "drowsiness_model": {**VALID_DROWSINESS_MODEL, "base_growth_per_min": -0.1}}
    with pytest.raises(ValidationError):
        DriverSignalParams(**bad)


def test_driver_signal_params_fatigue_model_rate_negative_rejected():
    from aica_api.models.profile import DriverSignalParams

    bad = {**VALID_DRIVER_SIGNAL_PARAMS, "fatigue_model": {**VALID_FATIGUE_MODEL, "mountain_road_add_per_min": -0.5}}
    with pytest.raises(ValidationError):
        DriverSignalParams(**bad)


def test_driver_signal_params_recovery_model_rate_negative_rejected():
    from aica_api.models.profile import DriverSignalParams

    bad = {**VALID_DRIVER_SIGNAL_PARAMS, "recovery_model": {"sleep": {"drowsiness": -5.0, "fatigue": 10.0}}}
    with pytest.raises(ValidationError):
        DriverSignalParams(**bad)


def test_driver_signal_params_zero_rates_accepted():
    """Zero is a valid rate (≥ 0 constraint)."""
    from aica_api.models.profile import DriverSignalParams

    zero_drowsiness = {k: 0.0 for k in VALID_DROWSINESS_MODEL}
    p = DriverSignalParams(**{**VALID_DRIVER_SIGNAL_PARAMS, "drowsiness_model": zero_drowsiness})
    assert p.drowsiness_model.base_growth_per_min == 0.0


# ─── SpeedProfile ─────────────────────────────────────────────────────────────


def test_speed_profile_valid():
    from aica_api.models.profile import SpeedProfile

    s = SpeedProfile(**VALID_SPEED_PROFILE)
    assert s.normal_road_kph == 60
    assert s.highway_kph == 100
    assert s.mountain_road_kph == 40
    assert s.sightseeing_road_kph == 30
    assert s.traffic_jam_kph == 10


def test_speed_profile_unknown_key_rejected():
    """Extra keys (unknown segment types) must be rejected."""
    from aica_api.models.profile import SpeedProfile

    with pytest.raises(ValidationError):
        SpeedProfile(**{**VALID_SPEED_PROFILE, "unknown_road_kph": 50})


def test_speed_profile_missing_required_key_rejected():
    from aica_api.models.profile import SpeedProfile

    incomplete = {k: v for k, v in VALID_SPEED_PROFILE.items() if k != "highway_kph"}
    with pytest.raises(ValidationError):
        SpeedProfile(**incomplete)
