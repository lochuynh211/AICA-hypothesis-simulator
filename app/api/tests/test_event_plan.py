"""TDD event_plan tests (T015) — written BEFORE implementation; confirm RED then GREEN.

Tests for freeze_event_plan(scenario) -> EventPlan.
The function is a pure, deterministic computation of the per-tick schedule
from the scenario definition.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from aica_api.models.scenario import ScenarioDef
from aica_api.services.event_plan import freeze_event_plan

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_SCENARIO_PATH = _REPO_ROOT / "scenarios" / "uc01_fatigue_friend_drive_v0_1.json"


@pytest.fixture
def uc01_scenario() -> ScenarioDef:
    """Load the real UC-01 scenario fixture from disk."""
    data = json.loads(_SCENARIO_PATH.read_text(encoding="utf-8"))
    return ScenarioDef(**data)


def _minimal_scenario(
    *,
    total_duration: int = 3600,
    tick_seconds: int = 60,
    drowsiness_schedule: list[dict] | None = None,
    signal_duration_schedule: list[dict] | None = None,
    signal_duration_at_trigger: str = "transient",
    rest_spot_eta_near_before: str | None = None,
) -> ScenarioDef:
    """Build a minimal ScenarioDef for isolated tests."""
    ds = drowsiness_schedule or [{"at": 0.0, "band": "none"}]
    ep_data: dict = {
        "drowsiness_schedule": ds,
        "signal_duration_at_trigger": signal_duration_at_trigger,
    }
    if signal_duration_schedule is not None:
        ep_data["signal_duration_schedule"] = signal_duration_schedule
    if rest_spot_eta_near_before is not None:
        ep_data["rest_spot_eta_near_before"] = rest_spot_eta_near_before

    segments = [
        {
            "id": "seg_start", "name": {"ja": "出発", "en": "Start"},
            "type": "start", "at": 0.0,
            "speed_band": "slow", "length_band": "short", "is_rest_facility": False,
        },
        {
            "id": "seg_rest", "name": {"ja": "休憩", "en": "Rest"},
            "type": "rest", "at": 0.5,
            "speed_band": "slow", "length_band": "short", "is_rest_facility": True,
        },
        {
            "id": "seg_end", "name": {"ja": "終点", "en": "End"},
            "type": "end", "at": 1.0,
            "speed_band": "slow", "length_band": "short", "is_rest_facility": False,
        },
    ]

    return ScenarioDef(
        id="test_scenario",
        version="0.1.0",
        type="uc01_fatigue",
        persona={"name": "Test Driver"},
        route_intent={
            "rest_facility": {"label": {"ja": "テスト", "en": "Test"}},
            "segments": segments,
        },
        initial_state={"drowsiness_level": "none", "fatigue_level": "low"},
        event_presets=ep_data,
        total_duration_seconds=total_duration,
        tick_seconds=tick_seconds,
        allowed_actions=["accept_rest", "postpone"],
    )


# ---------------------------------------------------------------------------
# Basic plan structure
# ---------------------------------------------------------------------------


def test_freeze_returns_event_plan(uc01_scenario):
    from aica_api.models.run import EventPlan
    plan = freeze_event_plan(uc01_scenario)
    assert isinstance(plan, EventPlan)


def test_tick_count_equals_duration_over_tick_seconds(uc01_scenario):
    """Plan has total_duration // tick_seconds entries (0..N-1)."""
    plan = freeze_event_plan(uc01_scenario)
    expected = uc01_scenario.total_duration_seconds // uc01_scenario.tick_seconds
    assert len(plan.ticks) == expected


def test_tick_indices_are_sequential(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    for i, entry in enumerate(plan.ticks):
        assert entry.tick_index == i


def test_route_fraction_at_tick_zero_is_zero(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    assert plan.ticks[0].route_fraction == 0.0


def test_route_fraction_grows_monotonically(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    fracs = [e.route_fraction for e in plan.ticks]
    for a, b in zip(fracs, fracs[1:]):
        assert b >= a


def test_route_fraction_clamped_to_one(uc01_scenario):
    """The last tick's route_fraction must be ≤ 1.0."""
    plan = freeze_event_plan(uc01_scenario)
    assert all(e.route_fraction <= 1.0 for e in plan.ticks)


# ---------------------------------------------------------------------------
# Drowsiness band — step-held from schedule
# ---------------------------------------------------------------------------


def test_drowsiness_band_none_at_start(uc01_scenario):
    """Tick 0 (fraction 0.0) → drowsiness = 'none'."""
    plan = freeze_event_plan(uc01_scenario)
    assert plan.ticks[0].drowsiness_band == "none"


def test_drowsiness_band_weak_at_fraction_030(uc01_scenario):
    """At fraction 0.30, the drowsiness schedule enters 'weak'."""
    plan = freeze_event_plan(uc01_scenario)
    # tick_index where fraction first reaches 0.30
    tick_seconds = uc01_scenario.tick_seconds
    total = uc01_scenario.total_duration_seconds
    # fraction = tick * 60 / 7200 = tick / 120
    # tick = fraction * 120
    tick_030 = int(0.30 * total / tick_seconds)  # = 36
    assert plan.ticks[tick_030].drowsiness_band == "weak"


def test_drowsiness_band_moderate_at_fraction_042(uc01_scenario):
    """At fraction 0.42, drowsiness becomes 'moderate'."""
    plan = freeze_event_plan(uc01_scenario)
    tick_seconds = uc01_scenario.tick_seconds
    total = uc01_scenario.total_duration_seconds
    tick_042 = int(0.42 * total / tick_seconds)  # = 50 (floor), fraction = 50/120 = 0.417 < 0.42
    # The first tick with fraction >= 0.42 is tick 51 (51/120 = 0.425)
    tick_042_actual = tick_042 + 1 if (tick_042 * tick_seconds / total) < 0.42 else tick_042
    assert plan.ticks[tick_042_actual].drowsiness_band == "moderate"


def test_drowsiness_band_step_hold_persists(uc01_scenario):
    """'moderate' persists to the end of the plan once entered."""
    plan = freeze_event_plan(uc01_scenario)
    tick_seconds = uc01_scenario.tick_seconds
    total = uc01_scenario.total_duration_seconds
    first_moderate = next(
        i for i, e in enumerate(plan.ticks) if e.drowsiness_band == "moderate"
    )
    # All subsequent ticks must also be 'moderate' (step-held)
    for i in range(first_moderate, len(plan.ticks)):
        assert plan.ticks[i].drowsiness_band == "moderate"


# ---------------------------------------------------------------------------
# Signal duration schedule
# ---------------------------------------------------------------------------


def test_signal_duration_transient_at_start(uc01_scenario):
    """Tick 0 → signal_duration = 'transient' (first entry in schedule)."""
    plan = freeze_event_plan(uc01_scenario)
    assert plan.ticks[0].signal_duration == "transient"


def test_signal_duration_sustained_at_trigger_fraction(uc01_scenario):
    """At fraction 0.42+ → signal_duration = 'sustained' (from schedule)."""
    plan = freeze_event_plan(uc01_scenario)
    tick_seconds = uc01_scenario.tick_seconds
    total = uc01_scenario.total_duration_seconds
    first_sustained = next(
        (i for i, e in enumerate(plan.ticks) if e.signal_duration == "sustained"), None
    )
    assert first_sustained is not None
    # First sustained should occur at the tick where fraction >= 0.42
    frac = plan.ticks[first_sustained].route_fraction
    assert frac >= 0.42


def test_signal_duration_fallback_when_no_schedule():
    """Without signal_duration_schedule, signal_duration_at_trigger is used throughout."""
    scenario = _minimal_scenario(signal_duration_at_trigger="sustained")
    plan = freeze_event_plan(scenario)
    # All ticks should use the at_trigger value as fallback
    for entry in plan.ticks:
        assert entry.signal_duration == "sustained"


# ---------------------------------------------------------------------------
# Rest spot ETA
# ---------------------------------------------------------------------------


def test_rest_spot_eta_near_before_rest_facility(uc01_scenario):
    """Before the rest facility (at=0.5), rest_spot_eta should be 'near'."""
    plan = freeze_event_plan(uc01_scenario)
    # Tick with fraction just under 0.5
    total = uc01_scenario.total_duration_seconds
    tick_s = uc01_scenario.tick_seconds
    tick_before_rest = next(
        i for i, e in enumerate(plan.ticks)
        if e.route_fraction < 0.5
    )
    assert plan.ticks[tick_before_rest].rest_spot_eta == "near"


def test_rest_spot_eta_none_at_or_after_rest_facility(uc01_scenario):
    """At or after the rest facility fraction, rest_spot_eta becomes 'none'."""
    plan = freeze_event_plan(uc01_scenario)
    # Find first tick at or after fraction 0.5
    total = uc01_scenario.total_duration_seconds
    tick_s = uc01_scenario.tick_seconds
    n_ticks = len(plan.ticks)
    tick_at_rest = next(
        (i for i, e in enumerate(plan.ticks) if e.route_fraction >= 0.5), None
    )
    if tick_at_rest is not None:
        assert plan.ticks[tick_at_rest].rest_spot_eta == "none"


def test_rest_spot_eta_none_without_near_before():
    """Without rest_spot_eta_near_before, rest_spot_eta defaults to 'none'."""
    scenario = _minimal_scenario()  # no rest_spot_eta_near_before
    plan = freeze_event_plan(scenario)
    for entry in plan.ticks:
        assert entry.rest_spot_eta == "none"


# ---------------------------------------------------------------------------
# Continuous driving time
# ---------------------------------------------------------------------------


def test_continuous_driving_time_short_at_start(uc01_scenario):
    """Tick 0: elapsed=0 → continuous_driving_time = 'short'."""
    plan = freeze_event_plan(uc01_scenario)
    assert plan.ticks[0].continuous_driving_time == "short"


def test_continuous_driving_time_moderate_at_30min(uc01_scenario):
    """At 30 min (1800s) elapsed → continuous_driving_time = 'moderate'."""
    plan = freeze_event_plan(uc01_scenario)
    tick_s = uc01_scenario.tick_seconds
    tick_30min = 1800 // tick_s  # = 30
    assert plan.ticks[tick_30min].continuous_driving_time == "moderate"


def test_continuous_driving_time_long_at_90min(uc01_scenario):
    """At 90 min (5400s) elapsed → continuous_driving_time = 'long'."""
    plan = freeze_event_plan(uc01_scenario)
    tick_s = uc01_scenario.tick_seconds
    tick_90min = 5400 // tick_s  # = 90
    if tick_90min < len(plan.ticks):
        assert plan.ticks[tick_90min].continuous_driving_time == "long"


# ---------------------------------------------------------------------------
# Active segment ID
# ---------------------------------------------------------------------------


def test_active_segment_id_start_at_tick_zero(uc01_scenario):
    """Tick 0 (fraction 0.0) → active segment is 'seg_start'."""
    plan = freeze_event_plan(uc01_scenario)
    assert plan.ticks[0].active_segment_id == "seg_start"


def test_active_segment_id_changes_with_fraction(uc01_scenario):
    """At fraction 0.2, active segment becomes 'seg_urban'."""
    plan = freeze_event_plan(uc01_scenario)
    tick_s = uc01_scenario.tick_seconds
    total = uc01_scenario.total_duration_seconds
    tick_020 = int(0.2 * total / tick_s)  # = 24
    assert plan.ticks[tick_020].active_segment_id == "seg_urban"


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


def test_freeze_is_deterministic(uc01_scenario):
    """Same scenario → same EventPlan every call."""
    plan_a = freeze_event_plan(uc01_scenario)
    plan_b = freeze_event_plan(uc01_scenario)
    assert plan_a.model_dump() == plan_b.model_dump()


def test_minimal_scenario_determinism():
    scenario = _minimal_scenario(
        drowsiness_schedule=[{"at": 0.0, "band": "none"}, {"at": 0.3, "band": "weak"}]
    )
    p1 = freeze_event_plan(scenario)
    p2 = freeze_event_plan(scenario)
    assert p1.model_dump() == p2.model_dump()
