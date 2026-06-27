"""TDD vehicle_model tests (T010) — RED first, then GREEN.

Tests for advance_vehicle_state and rolling-window event counts.
Also tests for negative-rate validators on SteeringInstabilityProfile
and PedalAbnormalityProfile (T010 carry-forward from U2).
"""

from __future__ import annotations

import pytest

from aica_api.models.profile import (
    AdasWarningProfile,
    LaneDepartureProfile,
    PedalAbnormalityProfile,
    SteeringInstabilityProfile,
    VehicleBehaviorProfile,
)
from aica_api.services.behavior.vehicle_model import (
    VehicleEvent,
    VehicleState,
    advance_vehicle_state,
)

# ─── Shared fixtures ──────────────────────────────────────────────────────────

_STEERING = SteeringInstabilityProfile(
    base_level=5.0,
    drowsiness_factor=0.25,
    fatigue_factor=0.15,
    mountain_road_add=8.0,
    traffic_jam_reduce=4.0,
)
_LANE = LaneDepartureProfile(
    enabled_on=["highway", "normal_road"],
    drowsiness_threshold=60.0,
    fatigue_threshold=70.0,
    count_when_threshold_exceeded=1,
)
_PEDAL = PedalAbnormalityProfile(
    base_level=3.0,
    fatigue_factor=0.12,
    traffic_jam_add=10.0,
    mountain_road_add=5.0,
)
_ADAS = AdasWarningProfile(
    lane_departure_warning_threshold=1.0,
    steering_instability_warning_threshold=55.0,
)
_PROFILE = VehicleBehaviorProfile(
    rolling_window_seconds=300,
    steering_instability=_STEERING,
    lane_departure=_LANE,
    pedal_abnormality=_PEDAL,
    adas_warning=_ADAS,
)


def _advance(
    *,
    drowsiness: float = 0.0,
    fatigue: float = 0.0,
    segment_type: str = "normal_road",
    is_traffic_jam: bool = False,
    tick_index: int = 0,
    tick_seconds: int = 60,
    event_history: list[VehicleEvent] | None = None,
) -> VehicleState:
    return advance_vehicle_state(
        profile=_PROFILE,
        drowsiness=drowsiness,
        fatigue=fatigue,
        segment_type=segment_type,
        is_traffic_jam=is_traffic_jam,
        tick_index=tick_index,
        tick_seconds=tick_seconds,
        event_history=event_history or [],
    )


# ─── T010 carry-forward: ≥ 0 validators on SteeringInstability / Pedal ───────


def test_steering_instability_negative_base_rejected():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        SteeringInstabilityProfile(
            base_level=-1.0, drowsiness_factor=0.1,
            fatigue_factor=0.1, mountain_road_add=0.0, traffic_jam_reduce=0.0,
        )


def test_steering_instability_negative_drowsiness_factor_rejected():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        SteeringInstabilityProfile(
            base_level=0.0, drowsiness_factor=-0.1,
            fatigue_factor=0.1, mountain_road_add=0.0, traffic_jam_reduce=0.0,
        )


def test_steering_instability_negative_fatigue_factor_rejected():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        SteeringInstabilityProfile(
            base_level=0.0, drowsiness_factor=0.1,
            fatigue_factor=-0.1, mountain_road_add=0.0, traffic_jam_reduce=0.0,
        )


def test_steering_instability_negative_mountain_add_rejected():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        SteeringInstabilityProfile(
            base_level=0.0, drowsiness_factor=0.1,
            fatigue_factor=0.1, mountain_road_add=-1.0, traffic_jam_reduce=0.0,
        )


def test_steering_instability_negative_jam_reduce_rejected():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        SteeringInstabilityProfile(
            base_level=0.0, drowsiness_factor=0.1,
            fatigue_factor=0.1, mountain_road_add=0.0, traffic_jam_reduce=-1.0,
        )


def test_steering_instability_zero_values_accepted():
    p = SteeringInstabilityProfile(
        base_level=0.0, drowsiness_factor=0.0,
        fatigue_factor=0.0, mountain_road_add=0.0, traffic_jam_reduce=0.0,
    )
    assert p.base_level == 0.0


def test_pedal_abnormality_negative_base_rejected():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        PedalAbnormalityProfile(
            base_level=-1.0, fatigue_factor=0.1,
            traffic_jam_add=0.0, mountain_road_add=0.0,
        )


def test_pedal_abnormality_negative_fatigue_factor_rejected():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        PedalAbnormalityProfile(
            base_level=0.0, fatigue_factor=-0.1,
            traffic_jam_add=0.0, mountain_road_add=0.0,
        )


def test_pedal_abnormality_negative_jam_add_rejected():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        PedalAbnormalityProfile(
            base_level=0.0, fatigue_factor=0.1,
            traffic_jam_add=-1.0, mountain_road_add=0.0,
        )


def test_pedal_abnormality_negative_mountain_add_rejected():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        PedalAbnormalityProfile(
            base_level=0.0, fatigue_factor=0.1,
            traffic_jam_add=0.0, mountain_road_add=-1.0,
        )


# ─── Steering instability level ───────────────────────────────────────────────


def test_steering_base_level_when_no_factors():
    state = _advance(drowsiness=0.0, fatigue=0.0)
    # 5 + 0.25*0 + 0.15*0 = 5.0
    assert state.steering_instability_level == pytest.approx(5.0)


def test_steering_increases_with_drowsiness():
    state = _advance(drowsiness=40.0)
    # 5 + 0.25*40 + 0 = 15.0
    assert state.steering_instability_level == pytest.approx(15.0)


def test_steering_increases_with_fatigue():
    state = _advance(fatigue=40.0)
    # 5 + 0 + 0.15*40 = 11.0
    assert state.steering_instability_level == pytest.approx(11.0)


def test_steering_increases_on_mountain_road():
    state = _advance(segment_type="mountain_road")
    # 5 + 8 = 13.0
    assert state.steering_instability_level == pytest.approx(13.0)


def test_steering_reduced_in_traffic_jam():
    state = _advance(is_traffic_jam=True)
    # 5 - 4 = 1.0
    assert state.steering_instability_level == pytest.approx(1.0)


def test_steering_clamped_at_zero():
    state = _advance(is_traffic_jam=True, drowsiness=0.0, fatigue=0.0)
    # 5 - 4 = 1.0 (clamped ≥ 0)
    assert state.steering_instability_level >= 0.0


# ─── Pedal abnormality level ──────────────────────────────────────────────────


def test_pedal_base_level_when_no_factors():
    state = _advance(fatigue=0.0)
    # 3 + 0.12*0 = 3.0
    assert state.pedal_abnormality_level == pytest.approx(3.0)


def test_pedal_increases_with_fatigue():
    state = _advance(fatigue=50.0)
    # 3 + 0.12*50 = 9.0
    assert state.pedal_abnormality_level == pytest.approx(9.0)


def test_pedal_increases_in_traffic_jam():
    state = _advance(is_traffic_jam=True)
    # 3 + 10 = 13.0
    assert state.pedal_abnormality_level == pytest.approx(13.0)


def test_pedal_increases_on_mountain_road():
    state = _advance(segment_type="mountain_road")
    # 3 + 5 = 8.0
    assert state.pedal_abnormality_level == pytest.approx(8.0)


# ─── Lane departure events ────────────────────────────────────────────────────


def test_no_lane_departure_below_threshold():
    """Below drowsiness=60, no lane departure event generated."""
    state = _advance(drowsiness=59.0, segment_type="highway")
    # Count from rolling window only (no prior events)
    assert state.lane_departure_count == 0


def test_lane_departure_when_drowsiness_exceeds_threshold():
    """drowsiness ≥ 60 on highway → lane departure event generated."""
    state = _advance(drowsiness=60.0, segment_type="highway", tick_index=0)
    assert state.lane_departure_count >= 1


def test_lane_departure_when_fatigue_exceeds_threshold():
    """fatigue ≥ 70 on normal_road → lane departure event."""
    state = _advance(fatigue=70.0, segment_type="normal_road", tick_index=0)
    assert state.lane_departure_count >= 1


def test_no_lane_departure_on_mountain_road():
    """Mountain road is not in enabled_on → no lane departure even if drowsiness high."""
    state = _advance(drowsiness=80.0, segment_type="mountain_road")
    assert state.lane_departure_count == 0


# ─── ADAS warning events ──────────────────────────────────────────────────────


def test_adas_warning_from_lane_departure():
    """When lane departure count ≥ lane_departure_warning_threshold → ADAS warning."""
    state = _advance(drowsiness=60.0, segment_type="highway", tick_index=0)
    # lane departure happened, threshold=1 → ADAS warning
    assert state.adas_warning_count >= 1


def test_adas_warning_from_high_steering():
    """steering_instability ≥ warning_threshold → ADAS warning (even without lane dep)."""
    # steering = 5 + 0.25*drowsiness → need drowsiness ≥ (55-5)/0.25 = 200 (impossible)
    # Actually, we can get it via mountain road: 5 + 8 + 0.25*drowsiness ≥ 55
    # 0.25*drowsiness ≥ 42 → drowsiness ≥ 168 (impossible, clamped at 100)
    # 5 + 8 + 0.25*100 = 38 < 55 — still not enough with default profile
    # Let's use a high-steering profile
    profile = VehicleBehaviorProfile(
        rolling_window_seconds=300,
        steering_instability=SteeringInstabilityProfile(
            base_level=5.0, drowsiness_factor=0.5, fatigue_factor=0.5,
            mountain_road_add=0.0, traffic_jam_reduce=0.0,
        ),
        lane_departure=_LANE,
        pedal_abnormality=_PEDAL,
        adas_warning=AdasWarningProfile(
            lane_departure_warning_threshold=1.0,
            steering_instability_warning_threshold=55.0,
        ),
    )
    # drowsiness=100: steering = 5 + 0.5*100 = 55 → exactly at threshold → warning
    state = advance_vehicle_state(
        profile=profile,
        drowsiness=100.0, fatigue=0.0,
        segment_type="normal_road",
        is_traffic_jam=False,
        tick_index=0, tick_seconds=60,
        event_history=[],
    )
    assert state.adas_warning_count >= 1


# ─── Rolling window ───────────────────────────────────────────────────────────


def test_rolling_window_counts_recent_events():
    """Events from within rolling_window_seconds are counted."""
    # Simulate a lane departure at tick 0, rolling_window=300s, tick_seconds=60
    # At tick 1, tick 0's event is still within window (60s < 300s)
    state_t0 = _advance(drowsiness=65.0, segment_type="highway", tick_index=0)
    assert state_t0.lane_departure_count >= 1

    # Pass that history to tick 1 — events from tick 0 still in window
    state_t1 = advance_vehicle_state(
        profile=_PROFILE,
        drowsiness=65.0, fatigue=0.0,
        segment_type="highway",
        is_traffic_jam=False,
        tick_index=1, tick_seconds=60,
        event_history=state_t0.event_history,
    )
    # Both tick 0 and tick 1 lane departure events should be in window
    assert state_t1.lane_departure_count >= 2


def test_rolling_window_drops_old_events():
    """Events older than rolling_window_seconds are excluded from the count."""
    # rolling_window=300s, tick_seconds=60s → 5 ticks in window
    # Make an old event at tick 0, then advance to tick 5 (which is 300s later)
    # At tick 5, tick 0's event at t=0s is at boundary: 5*60-0 = 300s = rolling_window
    # Events at boundary: 300s exactly — we drop events OLDER than 300s (not at 300s)
    # Make it at tick 0, check at tick 6 (360s later > 300s window)
    old_event = VehicleEvent(tick_index=0, event_type="lane_departure")
    state_t6 = advance_vehicle_state(
        profile=_PROFILE,
        drowsiness=59.0, fatigue=0.0,  # below threshold, no new events
        segment_type="highway",
        is_traffic_jam=False,
        tick_index=6, tick_seconds=60,
        event_history=[old_event],
    )
    # Event from tick 0 (at t=0) should be dropped at tick 6 (t=360 > window=300)
    assert state_t6.lane_departure_count == 0


# ─── Returns VehicleState ─────────────────────────────────────────────────────


def test_advance_returns_vehicle_state():
    state = _advance()
    assert isinstance(state, VehicleState)


def test_vehicle_state_has_required_fields():
    state = _advance()
    assert hasattr(state, "steering_instability_level")
    assert hasattr(state, "pedal_abnormality_level")
    assert hasattr(state, "lane_departure_count")
    assert hasattr(state, "adas_warning_count")


# ─── Determinism ──────────────────────────────────────────────────────────────


def test_advance_deterministic():
    s1 = _advance(drowsiness=45.0, fatigue=35.0, segment_type="highway", tick_index=5)
    s2 = _advance(drowsiness=45.0, fatigue=35.0, segment_type="highway", tick_index=5)
    assert s1.steering_instability_level == s2.steering_instability_level
    assert s1.pedal_abnormality_level == s2.pedal_abnormality_level
    assert s1.lane_departure_count == s2.lane_departure_count
