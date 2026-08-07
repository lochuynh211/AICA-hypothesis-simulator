"""Dev-only: print the real jammed-tick km range for each scenario's traffic
jam, using the CURRENT (time-gated) tick simulation. The printed start_km/end_km
are the behavior-preserving conversion source for scenarios/*.json (feature:
traffic-jam km-unification). Run from repo root:

  PYTHONPATH=app/api PYTHONIOENCODING=utf-8 python scripts/dev/jam_km_from_scenario.py
"""
from __future__ import annotations

from aica_api.config import settings
from aica_api.services.event_plan import build_event_plan
from aica_api.services.route_analysis import analyze_route
from aica_api.services.scenario_registry import ScenarioRegistry
from aica_api.services.tick_engine import advance_tick

SCENARIOS = [
    "uc03_01_monotony_daytime_jam",
    "uc02_monotony_v0_1",
    "uc01_fatigue_recovery_commuter_v0_1",
    "uc01_fatigue_recovery_oshikatsu_v0_1",
]
_MAX_TICKS = 2000


def _old_time_gate_active(tick_index: int, tick_seconds: int, traffic_events) -> bool:
    """Reproduce EXACTLY the pre-refactor time gate: elapsed_min derived from the
    tick index (NOT the post-advance state), matching tick_engine's
    ``elapsed_min = tick_index * tick_seconds / 60`` at the gate call site."""
    elapsed_min = tick_index * tick_seconds / 60.0
    for ev in traffic_events:
        if ev.start_min is None or ev.duration_min is None:
            continue
        if ev.start_min <= elapsed_min < ev.start_min + ev.duration_min:
            return True
    return False


def jam_km_range(scenario_id: str) -> None:
    reg = ScenarioRegistry(settings.scenarios_dir)
    scenario = reg.get(scenario_id)
    if scenario is None:
        print(f"{scenario_id}: NOT FOUND/INVALID")
        return
    route_facts = analyze_route(scenario)
    event_plan = build_event_plan(route_facts, scenario)
    if not event_plan.traffic_events:
        print(f"{scenario_id}: no traffic_events")
        return

    tick_seconds = event_plan.tick_seconds
    # The km gate reads the PRE-advance distance (tick_engine.py:217-221). To
    # reproduce the same jammed ticks with a half-open [start_km, end_km) window,
    # record the pre-advance distance of each old-time-jammed tick, then set
    # end_km to the pre-advance distance of the FIRST tick AFTER the jam ends.
    start_km = None
    end_km = None
    first_jam_seen = False
    prior = None
    for tick_index in range(_MAX_TICKS):
        pre_distance = (prior.distance_km or 0.0) if prior is not None else 0.0
        active = _old_time_gate_active(tick_index, tick_seconds, event_plan.traffic_events)
        if active:
            if start_km is None:
                start_km = pre_distance
            first_jam_seen = True
        elif first_jam_seen and end_km is None:
            # First non-jammed tick after the jam — its pre-advance distance is
            # the exclusive upper bound that reproduces the exact jammed set.
            end_km = pre_distance
        ts = advance_tick(
            prior, tick_index, event_plan, route_facts, scenario,
            recovery=None, run_seed=event_plan.run_seed,
        )
        prior = ts
        if ts.completed:
            break

    ev = event_plan.traffic_events[0]
    if start_km is None:
        print(f"{scenario_id}: jam_id={ev.id} NEVER ACTIVE")
        return
    if end_km is None:
        # Jam ran until route completion — extend the window past the final
        # pre-advance distance so the last jammed tick stays inside [start,end).
        end_km = (prior.distance_km or 0.0) + 0.001
    print(
        f"{scenario_id}: jam_id={ev.id} start_km={start_km:.3f} end_km={end_km:.3f} "
        f"total_km={route_facts.total_route_distance_km:.1f}"
    )


if __name__ == "__main__":
    for s in SCENARIOS:
        jam_km_range(s)
