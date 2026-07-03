"""Tick engine recovery tests — Task 4.

Verifies that advance_tick honors an active RecoveryState:
  - STOPPED phase holds route_fraction at the rest spot (no forward progress)
  - apply_rest_recovery is called, reducing drowsiness relative to the prior tick
  - motionState / recoveryPhase are written into raw_state
"""
from aica_api.models.run import RecoveryState, RestSpot
from aica_api.models.scenario import RecoveryOption
from aica_api.services.tick_engine import advance_tick
from aica_api.services.behavior.driver_signals import DriverState
# Reuse the M2 scenario+plan fixture builders from the recovery helpers.
from tests.helpers_recovery import m2_scenario_with_recovery, m2_event_plan, m2_route_facts


def test_stopped_recovery_tick_holds_position_and_recovers():
    scenario = m2_scenario_with_recovery()       # driver_profile.recovery_model set; one rest segment
    plan = m2_event_plan(scenario, tick_seconds=60)
    facts = m2_route_facts(scenario)
    spot = RestSpot(id="p1", label={"ja": "SA", "en": "SA"}, route_fraction=0.5)
    # Recovery already at a STOPPED nap stage:
    rec = RecoveryState(active=True, option_id="nap_karaoke", rest_spot=spot,
                        phase="nap", stage_index=1, stage_ticks_remaining=2)
    # prior driver state: drowsy
    prior = advance_tick(None, 0, plan, facts, scenario)            # tick 0 establishes raw_state
    drowsy_before = float(prior.raw_state["drowsinessLevel"])
    out = advance_tick(prior, 1, plan, facts, scenario, recovery=rec)
    assert out.raw_state["motionState"] == "STOPPED"
    assert out.raw_state["recoveryPhase"] == "nap"
    assert abs(out.route_fraction - 0.5) < 1e-6                     # held at the spot
    assert float(out.raw_state["drowsinessLevel"]) < drowsy_before  # recovered
