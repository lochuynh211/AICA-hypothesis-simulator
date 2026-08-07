"""Tick engine recovery tests — Task 4.

Verifies that advance_tick honors an active RecoveryState:
  - STOPPED phase holds route_fraction at the rest spot (no forward progress)
  - apply_rest_recovery is called ONCE on the activity's entry tick (feature 009
    UX iteration: fixed per-activity recovery, not per-tick), reducing drowsiness
    relative to the prior tick
  - motionState / recoveryPhase are written into signals.dynamic

Feature 009 (signal-tier redesign): the old flat raw_state dict is replaced by
signals = {fixed, dynamic, simulated} (see tick_engine.advance_tick docstring).
motionState/recoveryPhase now live under signals["dynamic"]; drowsiness lives
under signals["simulated"]["drowsiness"] (renamed from drowsinessLevel).
"""
from aica_api.models.run import RecoveryState, RestSpot
from aica_api.models.scenario import RecoveryOption
from aica_api.services.tick_engine import advance_tick
from aica_api.services.behavior.driver_signals import DriverState
# Reuse the M2 scenario+plan fixture builders from the recovery helpers.
from tests.helpers_recovery import m2_scenario_with_recovery, m2_event_plan, m2_route_facts


def test_moving_approach_tick_does_not_overshoot_rest_spot():
    """A MOVING approach (wakefulness) stage that reaches the rest spot this
    tick must CLAMP position at the spot, never drive past it.

    Regression (fixbug-0806): the arrival tick was still MOVING, so distance
    advanced normally and overshot the spot (e.g. frac 0.5083); only the NEXT
    tick — now STOPPED — snapped position back to 0.5. On the distance-axis
    quickview curve that overshoot-then-snap-back drew a forward-then-back hook
    right at the rest spot. route_fraction must be monotonic through arrival.
    """
    scenario = m2_scenario_with_recovery()       # rest spot segment at at=0.5
    plan = m2_event_plan(scenario, tick_seconds=60)
    facts = m2_route_facts(scenario)
    spot = RestSpot(id="p1", label={"ja": "SA", "en": "SA"}, route_fraction=0.5)
    total_km = facts.total_route_distance_km or 120.0
    # Recovery is active on the MOVING wakefulness stage (stage_index=0).
    rec = RecoveryState(active=True, option_id="nap_karaoke", rest_spot=spot,
                        phase="wakefulness", stage_index=0, stage_ticks_remaining=0)
    # Prior position sits JUST short of the spot so any forward motion this tick
    # crosses it — the exact condition that used to overshoot.
    prior = advance_tick(None, 0, plan, facts, scenario)
    prior = prior.model_copy(update={"distance_km": 0.499 * total_km})
    out = advance_tick(prior, 1, plan, facts, scenario, recovery=rec)
    # Arrival is clamped exactly at the spot, not past it.
    assert out.route_fraction <= 0.5 + 1e-9
    assert abs(out.route_fraction - 0.5) < 1e-6


def test_resuming_tick_holds_position_at_rest_spot():
    """The one-tick 'resuming' phase (all stages done, recovery about to go
    inactive) must STILL hold position at the rest spot — the driver has just
    finished resting and has not pulled away yet.

    Regression (fixbug-0806): on the resuming tick `current_stage()` returns
    None (stage_index is past the final stage), so neither the STOPPED-hold nor
    the MOVING-clamp branch ran and distance advanced a full tick past the spot
    (e.g. 0.5 -> 0.5083). The merged auto-drive surfaces the after-rest proposal
    and PAUSES on exactly this tick (recovery just collapsed to None), so the
    animation showed the car parked one tick BEYOND the gold rest-spot marker —
    "rested a bit past the rest spot".
    """
    scenario = m2_scenario_with_recovery()
    plan = m2_event_plan(scenario, tick_seconds=60)
    facts = m2_route_facts(scenario)
    total_km = facts.total_route_distance_km or 120.0
    spot = RestSpot(id="p1", label={"ja": "SA", "en": "SA"}, route_fraction=0.5)
    # nap_karaoke has 3 stages [MOVING wakefulness, STOPPED nap, STOPPED content];
    # the resuming tick sits one past the last (stage_index=3, phase="resuming").
    rec = RecoveryState(active=True, option_id="nap_karaoke", rest_spot=spot,
                        phase="resuming", stage_index=3, stage_ticks_remaining=0)
    prior = advance_tick(None, 0, plan, facts, scenario)
    prior = prior.model_copy(update={"distance_km": 0.5 * total_km})
    out = advance_tick(prior, 1, plan, facts, scenario, recovery=rec)
    # Held exactly at the spot — not advanced past it.
    assert abs(out.route_fraction - 0.5) < 1e-6
    assert abs((out.distance_km or 0.0) - 0.5 * total_km) < 1e-6
    # Recovery collapses to inactive so run_manager clears run_state.recovery.
    assert out.model_extra["_recovery_next"].active is False


def test_stopped_recovery_tick_holds_position_and_recovers():
    scenario = m2_scenario_with_recovery()       # driver_signal_params.recovery_model set; one rest segment
    plan = m2_event_plan(scenario, tick_seconds=60)
    facts = m2_route_facts(scenario)
    spot = RestSpot(id="p1", label={"ja": "SA", "en": "SA"}, route_fraction=0.5)
    # Recovery at the ENTRY tick of the STOPPED nap stage (stage_ticks_remaining
    # still equals the stage's full ticks=3) — the single tick that applies the
    # sleep activity's fixed recovery.
    rec = RecoveryState(active=True, option_id="nap_karaoke", rest_spot=spot,
                        phase="nap", stage_index=1, stage_ticks_remaining=3)
    # prior driver state: drowsy
    prior = advance_tick(None, 0, plan, facts, scenario)            # tick 0 establishes signals
    drowsy_before = float(prior.signals["simulated"]["drowsiness"])
    out = advance_tick(prior, 1, plan, facts, scenario, recovery=rec)
    assert out.signals["dynamic"]["motionState"] == "STOPPED"
    assert out.signals["dynamic"]["recoveryPhase"] == "nap"
    assert abs(out.route_fraction - 0.5) < 1e-6                     # held at the spot
    assert float(out.signals["simulated"]["drowsiness"]) < drowsy_before  # recovered
