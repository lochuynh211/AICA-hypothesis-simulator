"""T003 — Profile model tests. Written RED-first per TDD.

Tests for DriverModelProfile, VehicleBehaviorProfile, SpeedProfile.
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

VALID_ATTENTION_MODEL = {
    "base_recovery_per_min": 0.0,
    "monotony_drop_per_min": 0.01,
    "drowsiness_drop_factor": 0.5,
    "active_content_recovery_per_min": 0.1,
}

VALID_RECOVERY_MODEL = {
    "short_rest_drowsiness_recovery": 30.0,
    "short_rest_fatigue_recovery": 20.0,
    "long_rest_drowsiness_recovery": 80.0,
    "long_rest_fatigue_recovery": 60.0,
}

VALID_DRIVER_PROFILE = {
    "id": "default_driver",
    "drowsiness_model": VALID_DROWSINESS_MODEL,
    "fatigue_model": VALID_FATIGUE_MODEL,
    "attention_model": VALID_ATTENTION_MODEL,
    "recovery_model": VALID_RECOVERY_MODEL,
}

VALID_STEERING_INSTABILITY = {
    "base_level": 0.1,
    "drowsiness_factor": 0.3,
    "fatigue_factor": 0.2,
    "mountain_road_add": 0.05,
    "traffic_jam_reduce": 0.02,
}

VALID_LANE_DEPARTURE = {
    "enabled_on": ["highway", "normal_road"],
    "drowsiness_threshold": 60.0,
    "fatigue_threshold": 70.0,
    "count_when_threshold_exceeded": 2,
}

VALID_PEDAL_ABNORMALITY = {
    "base_level": 0.05,
    "fatigue_factor": 0.2,
    "traffic_jam_add": 0.1,
    "mountain_road_add": 0.08,
}

VALID_ADAS_WARNING = {
    "lane_departure_warning_threshold": 80.0,
    "steering_instability_warning_threshold": 75.0,
}

VALID_VEHICLE_PROFILE = {
    "rolling_window_seconds": 300,
    "steering_instability": VALID_STEERING_INSTABILITY,
    "lane_departure": VALID_LANE_DEPARTURE,
    "pedal_abnormality": VALID_PEDAL_ABNORMALITY,
    "adas_warning": VALID_ADAS_WARNING,
}

VALID_SPEED_PROFILE = {
    "normal_road_kph": 60,
    "highway_kph": 100,
    "mountain_road_kph": 40,
    "sightseeing_road_kph": 30,
    "traffic_jam_kph": 10,
}


# ─── DriverModelProfile ───────────────────────────────────────────────────────


def test_driver_profile_valid():
    from aica_api.models.profile import DriverModelProfile

    p = DriverModelProfile(**VALID_DRIVER_PROFILE)
    assert p.id == "default_driver"
    assert p.drowsiness_model.base_growth_per_min == 0.1
    assert p.fatigue_model.traffic_jam_add_per_min == 0.02
    assert p.attention_model.drowsiness_drop_factor == 0.5
    assert p.recovery_model.long_rest_drowsiness_recovery == 80.0


def test_driver_profile_drowsiness_model_rate_negative_rejected():
    from aica_api.models.profile import DriverModelProfile

    bad = {**VALID_DRIVER_PROFILE, "drowsiness_model": {**VALID_DROWSINESS_MODEL, "base_growth_per_min": -0.1}}
    with pytest.raises(ValidationError):
        DriverModelProfile(**bad)


def test_driver_profile_fatigue_model_rate_negative_rejected():
    from aica_api.models.profile import DriverModelProfile

    bad = {**VALID_DRIVER_PROFILE, "fatigue_model": {**VALID_FATIGUE_MODEL, "mountain_road_add_per_min": -0.5}}
    with pytest.raises(ValidationError):
        DriverModelProfile(**bad)


def test_driver_profile_attention_model_rate_negative_rejected():
    from aica_api.models.profile import DriverModelProfile

    bad = {**VALID_DRIVER_PROFILE, "attention_model": {**VALID_ATTENTION_MODEL, "monotony_drop_per_min": -1.0}}
    with pytest.raises(ValidationError):
        DriverModelProfile(**bad)


def test_driver_profile_recovery_model_rate_negative_rejected():
    from aica_api.models.profile import DriverModelProfile

    bad = {**VALID_DRIVER_PROFILE, "recovery_model": {**VALID_RECOVERY_MODEL, "short_rest_drowsiness_recovery": -5.0}}
    with pytest.raises(ValidationError):
        DriverModelProfile(**bad)


def test_driver_profile_zero_rates_accepted():
    """Zero is a valid rate (≥ 0 constraint)."""
    from aica_api.models.profile import DriverModelProfile

    zero_drowsiness = {k: 0.0 for k in VALID_DROWSINESS_MODEL}
    p = DriverModelProfile(**{**VALID_DRIVER_PROFILE, "drowsiness_model": zero_drowsiness})
    assert p.drowsiness_model.base_growth_per_min == 0.0


# ─── VehicleBehaviorProfile ───────────────────────────────────────────────────


def test_vehicle_profile_valid():
    from aica_api.models.profile import VehicleBehaviorProfile

    p = VehicleBehaviorProfile(**VALID_VEHICLE_PROFILE)
    assert p.rolling_window_seconds == 300
    assert p.steering_instability.drowsiness_factor == 0.3
    assert p.lane_departure.drowsiness_threshold == 60.0
    assert p.pedal_abnormality.base_level == 0.05
    assert p.adas_warning.lane_departure_warning_threshold == 80.0


def test_vehicle_profile_default_rolling_window():
    """rolling_window_seconds defaults to 300 when not supplied."""
    from aica_api.models.profile import VehicleBehaviorProfile

    no_window = {k: v for k, v in VALID_VEHICLE_PROFILE.items() if k != "rolling_window_seconds"}
    p = VehicleBehaviorProfile(**no_window)
    assert p.rolling_window_seconds == 300


def test_vehicle_profile_drowsiness_threshold_above_100_rejected():
    from aica_api.models.profile import VehicleBehaviorProfile

    bad_lane = {**VALID_LANE_DEPARTURE, "drowsiness_threshold": 101.0}
    bad = {**VALID_VEHICLE_PROFILE, "lane_departure": bad_lane}
    with pytest.raises(ValidationError):
        VehicleBehaviorProfile(**bad)


def test_vehicle_profile_fatigue_threshold_negative_rejected():
    from aica_api.models.profile import VehicleBehaviorProfile

    bad_lane = {**VALID_LANE_DEPARTURE, "fatigue_threshold": -1.0}
    bad = {**VALID_VEHICLE_PROFILE, "lane_departure": bad_lane}
    with pytest.raises(ValidationError):
        VehicleBehaviorProfile(**bad)


def test_vehicle_profile_adas_threshold_above_100_rejected():
    from aica_api.models.profile import VehicleBehaviorProfile

    bad_adas = {**VALID_ADAS_WARNING, "steering_instability_warning_threshold": 105.0}
    bad = {**VALID_VEHICLE_PROFILE, "adas_warning": bad_adas}
    with pytest.raises(ValidationError):
        VehicleBehaviorProfile(**bad)


def test_vehicle_profile_adas_threshold_zero_accepted():
    """Threshold = 0 is valid (minimum of 0-100 range)."""
    from aica_api.models.profile import VehicleBehaviorProfile

    zero_adas = {k: 0.0 for k in VALID_ADAS_WARNING}
    p = VehicleBehaviorProfile(**{**VALID_VEHICLE_PROFILE, "adas_warning": zero_adas})
    assert p.adas_warning.lane_departure_warning_threshold == 0.0


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
