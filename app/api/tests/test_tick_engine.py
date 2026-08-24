"""Tick engine tests (feature 009 signal-tier redesign).

Rewritten to the tiered-signal shape using the rewritten
scenarios/uc01_fatigue_recovery_v0_1.json fixture (the friend_drive scenario this
file used to load was retired along with the built-in algorithms).

Key assertions (per specs/009-signal-tier-redesign/contracts/tiered-context.md):
  - advance_tick's TickState.signals has exactly the three tier groups
    {fixed, dynamic, simulated} with their expected keys.
  - NONE of the removed signals (attentionLevel, steeringInstabilityLevel,
    pedalAbnormalityLevel, laneDepartureCount, adasWarningCount, *RemainingMin,
    restSpotDensityNext30Min) appear anywhere in signals or feature_groups.
  - anomaly_rate is present and deterministic for a fixed run_seed (same
    scenario + run_seed → identical anomaly_rate series across independent runs).
  - Recovery still holds position (STOPPED phase) and still recovers
    drowsiness/fatigue, now via the per-tick apply_stage_recovery_tick curve
    (recovery-semantics refactor — replaces the retired one-shot
    apply_rest_recovery).
"""

from __future__ import annotations

import json
import pathlib

import pytest

from aica_api.models.run import (
    EventPlan,
    FeatureGroups,
    RecoveryState,
    RestSpot,
    RouteFacts,
    RouteSegmentFact,
    TickState,
    TrafficEvent,
)
from aica_api.models.scenario import ScenarioDef
from aica_api.services.event_plan import build_event_plan, freeze_event_plan
from aica_api.services.route_analysis import analyze_route
from aica_api.services.tick_engine import (
    _NO_REST_SENTINEL,
    _active_traffic_jam,
    advance_tick,
    build_adapter_context,
    compute_tick_state,
    rest_spot_actionability,
)

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_SCENARIO_PATH = _REPO_ROOT / "scenarios" / "uc01_fatigue_recovery_v0_1.json"

_REMOVED_KEYS = {
    "attentionLevel",
    "steeringInstabilityLevel",
    "pedalAbnormalityLevel",
    "laneDepartureCount",
    "adasWarningCount",
    "drowsinessRemainingMin",
    "fatigueRemainingMin",
    "restSpotDensityNext30Min",
}

_FIXED_KEYS = {"isNight", "familiarRoute", "childPassenger", "weatherRiskLevel"}
_DYNAMIC_KEYS = {
    "segmentType", "motionState", "continuousDrivingMin", "speedKph",
    "routeFraction", "nextRestSpotMin", "isTrafficJam", "recoveryPhase",
    "monotonyLevel",  # feature 020, Slice-3: simulator-owned monotony proxy
    "contentActive", "stimulusFrozen",  # recovery-semantics refactor (Task 3)
    "stimulusReliefMin",  # recovery-semantics refactor (round-2 ruling): the
    # accumulator-minutes drained THIS tick, published so a pure algorithm
    # package can apply the SAME drain instead of re-deriving a rate.
}
_SIMULATED_KEYS = {"drowsiness", "fatigue", "anomaly_rate"}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def uc01_scenario() -> ScenarioDef:
    data = json.loads(_SCENARIO_PATH.read_text(encoding="utf-8"))
    data.pop("_comment", None)
    return ScenarioDef.model_validate(data)


@pytest.fixture
def route_facts(uc01_scenario) -> RouteFacts:
    return analyze_route(uc01_scenario)


@pytest.fixture
def event_plan(route_facts, uc01_scenario) -> EventPlan:
    return build_event_plan(route_facts, uc01_scenario)


def _all_signal_values(signals: dict) -> dict:
    """Flatten the tiered signals dict into one dict for removed-key checks."""
    flat: dict = {}
    for tier in ("fixed", "dynamic", "simulated"):
        flat.update(signals.get(tier, {}))
    return flat


# ---------------------------------------------------------------------------
# Scenario fixture sanity
# ---------------------------------------------------------------------------


def test_uc01_scenario_parses_new_shape(uc01_scenario):
    assert uc01_scenario.driver_signal_params is not None
    assert uc01_scenario.anomaly_signal_params is not None
    assert uc01_scenario.run_seed_default == 42


# ---------------------------------------------------------------------------
# advance_tick — basic structure
# ---------------------------------------------------------------------------


def test_advance_tick_returns_tick_state(uc01_scenario, event_plan, route_facts):
    ts = advance_tick(None, 0, event_plan, route_facts, uc01_scenario, run_seed=1)
    assert isinstance(ts, TickState)


def test_advance_tick_tick_index_set(uc01_scenario, event_plan, route_facts):
    ts = advance_tick(None, 5, event_plan, route_facts, uc01_scenario, run_seed=1)
    assert ts.tick_index == 5


def test_advance_tick_has_feature_groups(uc01_scenario, event_plan, route_facts):
    ts = advance_tick(None, 0, event_plan, route_facts, uc01_scenario, run_seed=1)
    assert isinstance(ts.feature_groups, FeatureGroups)


def test_advance_tick_distance_km_advances(uc01_scenario, event_plan, route_facts):
    ts = advance_tick(None, 0, event_plan, route_facts, uc01_scenario, run_seed=1)
    assert ts.distance_km is not None and ts.distance_km > 0.0


def test_advance_tick_not_completed_early(uc01_scenario, event_plan, route_facts):
    ts = advance_tick(None, 0, event_plan, route_facts, uc01_scenario, run_seed=1)
    assert ts.completed is False


def test_advance_tick_position_advances_correctly(uc01_scenario, event_plan, route_facts):
    """Position after k ticks should be strictly increasing (MOVING)."""
    ts = None
    positions = []
    for i in range(10):
        ts = advance_tick(ts, i, event_plan, route_facts, uc01_scenario, run_seed=1)
        positions.append(ts.distance_km)
    assert positions == sorted(positions)
    assert positions[-1] > positions[0]


def test_advance_tick_completed_when_distance_past_total(uc01_scenario, event_plan, route_facts):
    total_km = route_facts.total_route_distance_km  # 120 km
    ts = None
    for i in range(300):
        ts = advance_tick(ts, i, event_plan, route_facts, uc01_scenario, run_seed=1)
        if ts.completed:
            break
    assert ts.completed is True
    assert ts.distance_km >= total_km


def test_advance_tick_drowsiness_increases(uc01_scenario, event_plan, route_facts):
    """Drowsiness increases tick-over-tick under this scenario's driver params."""
    ts0 = advance_tick(None, 0, event_plan, route_facts, uc01_scenario, run_seed=1)
    ts1 = advance_tick(ts0, 1, event_plan, route_facts, uc01_scenario, run_seed=1)
    d0 = ts0.signals["simulated"]["drowsiness"]
    d1 = ts1.signals["simulated"]["drowsiness"]
    assert d1 > d0


# ---------------------------------------------------------------------------
# Tiered signals — exact shape (per contracts/tiered-context.md)
# ---------------------------------------------------------------------------


def test_advance_tick_signals_has_three_tiers(uc01_scenario, event_plan, route_facts):
    ts = advance_tick(None, 0, event_plan, route_facts, uc01_scenario, run_seed=1)
    assert set(ts.signals.keys()) == {"fixed", "dynamic", "simulated"}


def test_advance_tick_fixed_tier_keys(uc01_scenario, event_plan, route_facts):
    ts = advance_tick(None, 0, event_plan, route_facts, uc01_scenario, run_seed=1)
    assert set(ts.signals["fixed"].keys()) == _FIXED_KEYS


def test_advance_tick_dynamic_tier_keys(uc01_scenario, event_plan, route_facts):
    ts = advance_tick(None, 0, event_plan, route_facts, uc01_scenario, run_seed=1)
    assert set(ts.signals["dynamic"].keys()) == _DYNAMIC_KEYS


def test_advance_tick_simulated_tier_keys(uc01_scenario, event_plan, route_facts):
    ts = advance_tick(None, 0, event_plan, route_facts, uc01_scenario, run_seed=1)
    assert set(ts.signals["simulated"].keys()) == _SIMULATED_KEYS


def test_advance_tick_fixed_tier_values(uc01_scenario, event_plan, route_facts):
    ts = advance_tick(None, 0, event_plan, route_facts, uc01_scenario, run_seed=1)
    fixed = ts.signals["fixed"]
    assert fixed["isNight"] == uc01_scenario.is_night
    assert fixed["familiarRoute"] == uc01_scenario.familiar_route
    assert fixed["childPassenger"] == uc01_scenario.child_passenger
    assert fixed["weatherRiskLevel"] == uc01_scenario.weather_risk


def test_advance_tick_weather_risk_level_reflects_scenario_not_hardcoded(
    uc01_scenario, event_plan, route_facts
):
    """UX-BE: weatherRiskLevel must equal the scenario's weather_risk field,
    not a hardcoded 0.0 — confirmed by overriding it away from the default."""
    overridden = uc01_scenario.model_copy(update={"weather_risk": 37.5})
    ts = advance_tick(None, 0, event_plan, route_facts, overridden, run_seed=1)
    assert ts.signals["fixed"]["weatherRiskLevel"] == 37.5


def test_advance_tick_dynamic_tier_motion_state_moving(uc01_scenario, event_plan, route_facts):
    ts = advance_tick(None, 0, event_plan, route_facts, uc01_scenario, run_seed=1)
    assert ts.signals["dynamic"]["motionState"] == "MOVING"
    assert ts.signals["dynamic"]["recoveryPhase"] is None


def test_advance_tick_simulated_tier_types(uc01_scenario, event_plan, route_facts):
    ts = advance_tick(None, 0, event_plan, route_facts, uc01_scenario, run_seed=1)
    simulated = ts.signals["simulated"]
    assert isinstance(simulated["drowsiness"], float)
    assert isinstance(simulated["fatigue"], float)
    assert isinstance(simulated["anomaly_rate"], int)


def test_advance_tick_no_removed_keys_anywhere(uc01_scenario, event_plan, route_facts):
    """NONE of the retired vehicle-model/attention/lookahead keys ever appear."""
    ts = None
    for i in range(20):
        ts = advance_tick(ts, i, event_plan, route_facts, uc01_scenario, run_seed=1)
        flat = _all_signal_values(ts.signals)
        assert not _REMOVED_KEYS & flat.keys()
        assert not _REMOVED_KEYS & ts.feature_groups.ordinal.keys()
        assert not _REMOVED_KEYS & ts.feature_groups.normalized.keys()


# ---------------------------------------------------------------------------
# build_adapter_context — tiered-context contract shape
# ---------------------------------------------------------------------------


def test_build_adapter_context_has_signals_and_feature_groups(uc01_scenario, event_plan, route_facts):
    ts = advance_tick(None, 0, event_plan, route_facts, uc01_scenario, run_seed=1)
    ctx = build_adapter_context(ts)
    assert set(ctx.keys()) == {"signals", "feature_groups"}


def test_build_adapter_context_signals_matches_tick_state(uc01_scenario, event_plan, route_facts):
    ts = advance_tick(None, 0, event_plan, route_facts, uc01_scenario, run_seed=1)
    ctx = build_adapter_context(ts)
    assert ctx["signals"] == ts.signals


def test_build_adapter_context_feature_groups_ordinal_keys(uc01_scenario, event_plan, route_facts):
    ts = advance_tick(None, 0, event_plan, route_facts, uc01_scenario, run_seed=1)
    ctx = build_adapter_context(ts)
    assert set(ctx["feature_groups"]["ordinal"].keys()) == {
        "rest_spot_eta", "continuous_driving_time", "signal_duration",
    }


def test_build_adapter_context_no_removed_keys(uc01_scenario, event_plan, route_facts):
    ts = advance_tick(None, 0, event_plan, route_facts, uc01_scenario, run_seed=1)
    ctx = build_adapter_context(ts)
    flat = _all_signal_values(ctx["signals"])
    assert not _REMOVED_KEYS & flat.keys()


# ---------------------------------------------------------------------------
# Determinism (Principle III) — anomaly_rate is the ONLY randomness
# ---------------------------------------------------------------------------


def test_advance_tick_deterministic_same_seed(uc01_scenario, event_plan, route_facts):
    """Same inputs (incl. run_seed) → identical TickState.signals."""
    ts_a = advance_tick(None, 0, event_plan, route_facts, uc01_scenario, run_seed=7)
    ts_b = advance_tick(None, 0, event_plan, route_facts, uc01_scenario, run_seed=7)
    assert ts_a.signals == ts_b.signals


def test_anomaly_rate_series_deterministic_same_seed(uc01_scenario, event_plan, route_facts):
    """Same (scenario, run_seed) → identical anomaly_rate series across two
    independent 40-tick runs (Principle III determinism)."""
    def _run(seed: int) -> list[int]:
        ts = None
        rates = []
        for i in range(40):
            ts = advance_tick(ts, i, event_plan, route_facts, uc01_scenario, run_seed=seed)
            rates.append(ts.signals["simulated"]["anomaly_rate"])
        return rates

    run_a = _run(7)
    run_b = _run(7)
    assert run_a == run_b


def test_anomaly_rate_present_and_nonnegative(uc01_scenario, event_plan, route_facts):
    ts = None
    for i in range(20):
        ts = advance_tick(ts, i, event_plan, route_facts, uc01_scenario, run_seed=3)
        rate = ts.signals["simulated"]["anomaly_rate"]
        assert isinstance(rate, int)
        assert rate >= 0


def test_anomaly_rate_series_differs_across_seeds(uc01_scenario, event_plan, route_facts):
    """Different run_seed → different spike pattern (with high probability)."""
    def _run(seed: int) -> list[int]:
        ts = None
        rates = []
        for i in range(60):
            ts = advance_tick(ts, i, event_plan, route_facts, uc01_scenario, run_seed=seed)
            rates.append(ts.signals["simulated"]["anomaly_rate"])
        return rates

    assert _run(1) != _run(999999)


def test_run_seed_defaults_to_scenario_default(uc01_scenario, event_plan, route_facts):
    """When run_seed is not supplied, advance_tick uses scenario.run_seed_default."""
    ts_default = advance_tick(None, 0, event_plan, route_facts, uc01_scenario)
    ts_explicit = advance_tick(
        None, 0, event_plan, route_facts, uc01_scenario,
        run_seed=uc01_scenario.run_seed_default,
    )
    assert ts_default.signals == ts_explicit.signals


# ---------------------------------------------------------------------------
# Recovery — STOPPED phase holds position and recovers signals
# ---------------------------------------------------------------------------


def test_recovery_stopped_holds_position(uc01_scenario, event_plan, route_facts):
    """A STOPPED recovery stage must not advance distance/route_fraction."""
    spot = RestSpot(
        id="seg_rest", label={"ja": "休憩", "en": "Rest"}, route_fraction=0.5,
    )
    rec = RecoveryState(
        active=True, option_id="nap_karaoke", rest_spot=spot,
        phase="nap", stage_index=1, stage_ticks_remaining=2,
    )
    prior = advance_tick(None, 0, event_plan, route_facts, uc01_scenario, run_seed=1)
    out = advance_tick(prior, 1, event_plan, route_facts, uc01_scenario, recovery=rec, run_seed=1)

    assert out.signals["dynamic"]["motionState"] == "STOPPED"
    assert out.signals["dynamic"]["recoveryPhase"] == "nap"
    assert abs(out.route_fraction - 0.5) < 1e-6
    assert abs(out.distance_km - 0.5 * route_facts.total_route_distance_km) < 1e-6


def test_recovery_stopped_recovers_drowsiness(uc01_scenario, event_plan, route_facts):
    """The sleep activity's recovery lowers drowsiness on the stage's entry tick.

    Recovery-semantics refactor: recovery is spread as a per-tick curve across
    the STOPPED stage's dwell (apply_stage_recovery_tick), so the entry tick
    (stage_ticks_remaining still == the stage's full ticks=3) already grants
    its share and drowsiness drops relative to the prior tick.
    """
    spot = RestSpot(
        id="seg_rest", label={"ja": "休憩", "en": "Rest"}, route_fraction=0.5,
    )
    rec = RecoveryState(
        active=True, option_id="nap_karaoke", rest_spot=spot,
        phase="nap", stage_index=1, stage_ticks_remaining=3,
    )
    prior = advance_tick(None, 0, event_plan, route_facts, uc01_scenario, run_seed=1)
    drowsy_before = prior.signals["simulated"]["drowsiness"]
    out = advance_tick(prior, 1, event_plan, route_facts, uc01_scenario, recovery=rec, run_seed=1)
    drowsy_after = out.signals["simulated"]["drowsiness"]
    assert drowsy_after < drowsy_before


def test_recovery_stopped_no_anomaly_spike(uc01_scenario, event_plan, route_facts):
    """is_moving=False while STOPPED — no anomaly spikes recorded that tick
    (anomaly_rate can only stay the same or drop, never gain a spike)."""
    spot = RestSpot(
        id="seg_rest", label={"ja": "休憩", "en": "Rest"}, route_fraction=0.5,
    )
    rec = RecoveryState(
        active=True, option_id="nap_karaoke", rest_spot=spot,
        phase="nap", stage_index=1, stage_ticks_remaining=2,
    )
    prior = advance_tick(None, 0, event_plan, route_facts, uc01_scenario, run_seed=1)
    out = advance_tick(prior, 1, event_plan, route_facts, uc01_scenario, recovery=rec, run_seed=1)
    assert 1 not in out.anomaly_events


# ---------------------------------------------------------------------------
# M1 legacy path — compute_tick_state / build_adapter_context (unaffected by
# feature 009; still used by fallback scenarios with no driver_signal_params).
# ---------------------------------------------------------------------------


def _make_m1_scenario() -> ScenarioDef:
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
        id="test_m1",
        version="0.1.0",
        type="uc01_fatigue",
        persona={"name": "Test Driver"},
        route_intent={
            "rest_facility": {"label": {"ja": "休憩", "en": "Rest"}},
            "segments": segments,
        },
        initial_state={"drowsiness_level": "none", "fatigue_level": "medium"},
        event_presets={
            "drowsiness_schedule": [
                {"at": 0.0, "band": "none"},
                {"at": 0.3, "band": "weak"},
            ],
            "signal_duration_at_trigger": "sustained",
        },
        total_duration_seconds=7200,
        tick_seconds=60,
        allowed_actions=["accept_rest", "postpone"],
    )


def test_m1_compute_tick_state_still_works():
    """M1 legacy path (no driver_signal_params) is untouched by this refactor."""
    scenario = _make_m1_scenario()
    plan = freeze_event_plan(scenario)
    ts = compute_tick_state(plan, 0, scenario)
    assert isinstance(ts, TickState)
    assert ts.completed is False


def test_m1_build_adapter_context_flat_bands():
    scenario = _make_m1_scenario()
    plan = freeze_event_plan(scenario)
    ts = compute_tick_state(plan, 0, scenario)
    ctx = build_adapter_context(ts)
    required = {
        "drowsiness_level", "fatigue_level", "signal_duration",
        "continuous_driving_time", "rest_spot_eta",
    }
    assert required.issubset(ctx.keys())
    for val in ctx.values():
        assert isinstance(val, str)


# ---------------------------------------------------------------------------
# _active_traffic_jam — position-native gating (fixbug-0806)
#
# A km-painted jam gates on distance_km when start_km/end_km are present
# (routes aren't time-linear in distance, so the time axis is wrong for a
# km-painted jam). Time-only jams (no km fields, e.g.
# scenarios/uc03_01_monotony_daytime_jam.json) must keep gating on elapsed_min
# unchanged — back-compat.
# ---------------------------------------------------------------------------


def _plan_with_traffic_events(events: list[TrafficEvent]) -> EventPlan:
    return EventPlan(traffic_events=events)


def test_active_traffic_jam_gates_on_distance_when_km_present():
    plan = _plan_with_traffic_events([
        TrafficEvent(
            id="jam1", start_min=18.0, duration_min=18.0,
            affected_segment_id="manual", speed_kph=15.0,
            start_km=20.0, end_km=40.0,
        )
    ])

    # Inside the km window but OUTSIDE the (wrong, naive-converted) minute
    # window — must still gate True because km is present and authoritative.
    assert _active_traffic_jam(elapsed_min=0.0, distance_km=25.0, event_plan=plan) is True
    assert _active_traffic_jam(elapsed_min=100.0, distance_km=39.9, event_plan=plan) is True
    # Outside the km window (even though within the minute window) — gates False.
    assert _active_traffic_jam(elapsed_min=18.0, distance_km=10.0, event_plan=plan) is False
    assert _active_traffic_jam(elapsed_min=18.0, distance_km=40.0, event_plan=plan) is False


def test_active_traffic_jam_falls_back_to_time_when_km_absent():
    """Back-compat: a pure time jam (no start_km/end_km) still gates on
    elapsed_min, same as before this fix."""
    plan = _plan_with_traffic_events([
        TrafficEvent(
            id="jam1", start_min=0.0, duration_min=200.0,
            affected_segment_id="seg-1", speed_kph=8.0,
        )
    ])

    assert _active_traffic_jam(elapsed_min=0.0, distance_km=999.0, event_plan=plan) is True
    assert _active_traffic_jam(elapsed_min=199.9, distance_km=0.0, event_plan=plan) is True
    assert _active_traffic_jam(elapsed_min=200.0, distance_km=0.0, event_plan=plan) is False


# ---------------------------------------------------------------------------
# nextRestSpotMin — ETA over the PLANNED speed profile, not the momentary speed
#
# The ETA to the next rest facility used to be `remaining_km / current_speed`,
# which presumes whatever the car is doing right now continues all the way to
# the spot. Inside a 5 km jam that turned a ~35-minute drive into a ~106-minute
# one, and NRI's rest-band ETA filter (`rest_spot_eta_filter_min`, default 60)
# withheld an over-threshold REST proposal for the whole jam — the driver was
# told nothing exactly while their score was climbing fastest (fixbug-0806,
# UC-01-02). The engine already knows where the jam ends, so the ETA is
# integrated forward over the planned profile instead.
# ---------------------------------------------------------------------------


def _jammed_route_facts() -> RouteFacts:
    """30 km of highway with the only rest spot at 25 km."""
    return RouteFacts(
        total_route_distance_km=30.0,
        estimated_route_duration_min=30.0,
        route_segments=[RouteSegmentFact(segment_type="highway", start_km=0.0, length_km=30.0)],
        rest_spot_positions=[25.0],
    )


def _jam_plan() -> EventPlan:
    """A 5 km jam (km 5 -> 10) at the uc01 scenario's 20 kph jam speed."""
    return EventPlan(traffic_events=[
        TrafficEvent(
            id="jam1", affected_segment_id="manual", speed_kph=20.0,
            start_km=5.0, end_km=10.0,
        )
    ])


def _tick_into_jam(uc01_scenario) -> TickState:
    """Drive until the car is inside the jam, and return that tick's state."""
    route = _jammed_route_facts()
    plan = _jam_plan()
    ts = None
    for i in range(200):
        ts = advance_tick(ts, i, plan, route, uc01_scenario, run_seed=1)
        if ts.signals["dynamic"]["isTrafficJam"]:
            return ts
    raise AssertionError("setup: the car never entered the jam")


def test_next_rest_spot_eta_uses_planned_profile_through_a_jam(uc01_scenario):
    ts = _tick_into_jam(uc01_scenario)
    dynamic = ts.signals["dynamic"]
    distance_km = ts.distance_km or 0.0

    # True ETA: crawl out of the jam at 20 kph, then run to the spot at 100 kph.
    expected = ((10.0 - distance_km) / 20.0 + (25.0 - 10.0) / 100.0) * 60.0
    assert dynamic["nextRestSpotMin"] == pytest.approx(expected, abs=1.0)

    # ...and emphatically NOT the old jam-speed extrapolation over the whole gap.
    naive = ((25.0 - distance_km) / 20.0) * 60.0
    assert dynamic["nextRestSpotMin"] < naive - 10.0


def test_next_rest_spot_eta_unchanged_without_a_jam(uc01_scenario):
    """No jam ahead -> the integration must agree with the plain division the
    engine did before, so every un-jammed run keeps its exact previous ETA."""
    route = _jammed_route_facts()
    plan = EventPlan(traffic_events=[])
    ts = advance_tick(None, 0, plan, route, uc01_scenario, run_seed=1)
    dynamic = ts.signals["dynamic"]
    expected = ((25.0 - (ts.distance_km or 0.0)) / dynamic["speedKph"]) * 60.0
    assert dynamic["nextRestSpotMin"] == pytest.approx(expected, abs=0.6)


# ---------------------------------------------------------------------------
# rest_spot_actionability — the ONE shared actionability rule reused by the
# forecast service, the rest picker, and the NRI algorithm (fixbug-0806
# follow-on: nri-forecast-rest-proposal, Task 2).
#
# All four tests use a single-segment all-highway route (100 kph, no jams) so
# the expected ETA is plain `distance_km / 100 * 60` — the same planned-profile
# integration `_eta_min_to_km` already performs and the jam tests above already
# exercise; these tests focus on the gating/reason logic layered on top of it.
# ---------------------------------------------------------------------------


def _rf_with_spots(spots, total_km: float) -> RouteFacts:
    """An all-highway route of `total_km` with rest spots at `spots`."""
    return RouteFacts(
        total_route_distance_km=total_km,
        estimated_route_duration_min=total_km / 100.0 * 60.0,
        route_segments=[RouteSegmentFact(segment_type="highway", start_km=0.0, length_km=total_km)],
        rest_spot_positions=list(spots),
    )


def test_actionability_spot_within_30_and_outside_end_edge_is_actionable(uc01_scenario):
    rf = _rf_with_spots([40.0], total_km=200.0)   # spot far from destination
    r = rest_spot_actionability(
        from_km=20.0, from_elapsed_min=25.0, route_facts=rf,
        event_plan=EventPlan(traffic_events=[]), sp=uc01_scenario.speed_profile,
        eta_filter_min=30.0,
    )
    assert r.exists is True
    assert r.eta_from_position_min <= 30.0
    assert r.eta_to_destination_min >= 10.0
    assert r.actionable is True
    assert r.unactionable_reason is None


def test_actionability_spot_over_30_min_is_not_actionable(uc01_scenario):
    rf = _rf_with_spots([180.0], total_km=400.0)  # far ahead -> ETA > 30
    r = rest_spot_actionability(
        from_km=20.0, from_elapsed_min=25.0, route_facts=rf,
        event_plan=EventPlan(traffic_events=[]), sp=uc01_scenario.speed_profile,
        eta_filter_min=30.0,
    )
    assert r.exists is True
    assert r.actionable is False
    assert r.unactionable_reason == "rest_spot_eta_over_limit"
    # Numeric check: eta_from_position_min is a real, finite ETA over the
    # filter limit — not the sentinel and not merely "some truthy number".
    assert isinstance(r.eta_from_position_min, float)
    assert r.eta_from_position_min == pytest.approx(96.0)
    assert r.eta_from_position_min > 30.0
    assert r.eta_from_position_min < _NO_REST_SENTINEL


def test_actionability_no_spot_ahead_uses_sentinel_and_no_spot_reason(uc01_scenario):
    rf = _rf_with_spots([10.0], total_km=200.0)   # only spot is behind us
    r = rest_spot_actionability(
        from_km=20.0, from_elapsed_min=25.0, route_facts=rf,
        event_plan=EventPlan(traffic_events=[]), sp=uc01_scenario.speed_profile,
        eta_filter_min=30.0,
    )
    assert r.exists is False
    assert r.eta_from_position_min == _NO_REST_SENTINEL
    assert r.eta_to_destination_min is None
    assert r.actionable is False
    assert r.unactionable_reason == "no_spot_ahead"


def test_actionability_spot_inside_destination_edge_is_not_actionable(uc01_scenario):
    # spot ~2 km before the destination -> spot->dest ETA < 10 min
    rf = _rf_with_spots([198.0], total_km=200.0)
    r = rest_spot_actionability(
        from_km=190.0, from_elapsed_min=200.0, route_facts=rf,
        event_plan=EventPlan(traffic_events=[]), sp=uc01_scenario.speed_profile,
        eta_filter_min=30.0,
    )
    assert r.exists is True
    assert r.eta_to_destination_min < 10.0
    assert r.actionable is False
    assert r.unactionable_reason == "inside_destination_edge"


def test_actionability_unknown_total_distance_is_not_actionable(uc01_scenario):
    """total_route_distance_km can be None (RouteFacts.total_route_distance_km:
    float | None) — the destination-edge gate is then unevaluable, so the
    shared rule must degrade gracefully (never a TypeError from `float(None)`)
    and conservatively refuse to fire, reusing the existing
    inside_destination_edge reason rather than inventing a 5th value."""
    rf = RouteFacts(
        total_route_distance_km=None,
        route_segments=[RouteSegmentFact(segment_type="highway", start_km=0.0, length_km=200.0)],
        rest_spot_positions=[40.0],
    )
    r = rest_spot_actionability(
        from_km=20.0, from_elapsed_min=25.0, route_facts=rf,
        event_plan=EventPlan(traffic_events=[]), sp=uc01_scenario.speed_profile,
        eta_filter_min=30.0,
    )
    assert r.exists is True
    assert r.position_km == 40.0
    assert r.eta_from_position_min == pytest.approx(12.0)
    assert r.eta_to_destination_min is None
    assert r.actionable is False
    assert r.unactionable_reason == "inside_destination_edge"


def test_actionability_selects_nearest_spot_when_multiple_are_ahead(uc01_scenario):
    """Two rest spots ahead -> the helper must pick the NEAREST one, not the
    furthest or an arbitrary one."""
    rf = _rf_with_spots([50.0, 150.0], total_km=300.0)
    r = rest_spot_actionability(
        from_km=20.0, from_elapsed_min=25.0, route_facts=rf,
        event_plan=EventPlan(traffic_events=[]), sp=uc01_scenario.speed_profile,
        eta_filter_min=30.0,
    )
    assert r.exists is True
    assert r.position_km == 50.0
