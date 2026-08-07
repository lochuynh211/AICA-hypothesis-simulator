"""Behavior preservation: converting the 4 scenario jams from minutes to km
(traffic-jam km-unification) must not change how many ticks the jam is active
or when the route completes. Baseline numbers captured pre-conversion (see the
plan's Task 4 Step 1)."""
from __future__ import annotations

import pytest

from aica_api.config import settings
from aica_api.services.event_plan import build_event_plan
from aica_api.services.route_analysis import analyze_route
from aica_api.services.scenario_registry import ScenarioRegistry
from aica_api.services.tick_engine import _active_traffic_jam, advance_tick

# (completed_tick, jam_ticks) recorded BEFORE conversion — the contract this
# test locks in. km-gating must reproduce the same jammed span and completion.
BASELINE = {
    "uc03_01_monotony_daytime_jam": (118, 66),
    "uc02_monotony_v0_1": (34, 2),
    "uc01_fatigue_recovery_commuter_v0_1": (60, 10),
    "uc01_fatigue_recovery_oshikatsu_v0_1": (60, 10),
}


def _simulate(scenario_id):
    sc = ScenarioRegistry(settings.scenarios_dir).get(scenario_id)
    assert sc is not None, scenario_id
    rf = analyze_route(sc)
    ep = build_event_plan(rf, sc)
    prior = None
    jam_ticks = 0
    completed_tick = None
    for i in range(2000):
        ts = advance_tick(prior, i, ep, rf, sc, recovery=None, run_seed=ep.run_seed)
        if _active_traffic_jam(ts.elapsed_seconds / 60.0, ts.distance_km or 0.0, ep):
            jam_ticks += 1
        prior = ts
        if ts.completed:
            completed_tick = i
            break
    return completed_tick, jam_ticks


@pytest.mark.parametrize("scenario_id", list(BASELINE))
def test_jam_behavior_preserved_after_km_conversion(scenario_id):
    exp_completed, exp_jam = BASELINE[scenario_id]
    completed_tick, jam_ticks = _simulate(scenario_id)
    assert completed_tick == exp_completed, (scenario_id, completed_tick, exp_completed)
    # km-gating reproduces the same jammed span; allow +-1 tick for the boundary
    # tick where distance crosses end_km vs. the old time boundary.
    assert abs(jam_ticks - exp_jam) <= 1, (scenario_id, jam_ticks, exp_jam)
