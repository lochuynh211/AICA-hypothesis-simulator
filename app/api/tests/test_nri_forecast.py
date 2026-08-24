"""Tests for the NRI committed-state continuation forecast service (task 4).

`nri_forecast.run_forecast` is a NON-PERSISTING projection: it copies the
post-current-tick state and steps the deterministic tick/adapter loop forward,
CONTINUING an already-committed intervention but ACCEPTING NO projected-future
proposal, to answer one question — when the score next crosses
`threshold_fire`, will a rest facility be actionable there?

The projection loop is isolated with a scripted `evaluate` so scoring is
deterministic and independent of NRI math (per the task-4 brief, Step 1).

`_make_run` replicates the (scenario, event_plan, route_facts) construction
that `test_tick_engine.py` does at module level via fixtures — reusing the
SAME builder functions (`analyze_route`, `build_event_plan`) and the SAME
on-disk scenario fixture — but as a plain helper parameterized by
`total_route_distance_km`, returning FRESH objects on every call (never
mutating shared/module-level state).
"""

from __future__ import annotations

import inspect
import json
import pathlib

import pytest

from aica_api.models.run import ContentContext, ContentReliefState
from aica_api.models.scenario import ScenarioDef
from aica_api.services.event_plan import build_event_plan
from aica_api.services.route_analysis import analyze_route
from aica_api.services import nri_forecast
from aica_api.services.nri_forecast import run_forecast, _MAX_FORECAST_TICKS
from aica_api.services import tick_engine
from aica_api.services.tick_engine import _NO_REST_SENTINEL, SpotActionability

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_SCENARIO_PATH = _REPO_ROOT / "scenarios" / "uc01_fatigue_recovery_v0_1.json"


# ---------------------------------------------------------------------------
# _make_run — reuses analyze_route + build_event_plan (same as
# test_tick_engine.py's uc01_scenario/route_facts/event_plan fixtures) but as
# a parameterized helper that builds FRESH objects per call, so callers may
# override total_route_distance_km and mutate rest_spot_positions freely
# without touching any shared/module-level state.
#
# The on-disk fixture's own tick_seconds (180s at 60 kph normal_road = 3
# km/tick) is too fine-grained for the km literals this test file uses (40,
# 300, 400): a 2-3 call scripted evaluate() only covers ~6-9 km, so a spot at
# 40 km is always "ahead", never "behind", regardless of when the score
# crosses threshold_fire. build_event_plan's own supported presets override
# (`tick_seconds`) is used here — the same mechanism run_manager/preview use
# for per-run tick-rate overrides — to widen the step to 30 km/tick, so a
# handful of scripted ticks can meaningfully cross a 40 km or 300 km spot.
# ---------------------------------------------------------------------------

_FORECAST_TEST_TICK_SECONDS = 1800  # 30 min/tick -> 30 km/tick at 60 kph normal_road


def _make_run(total_route_distance_km: float = 400.0):
    data = json.loads(_SCENARIO_PATH.read_text(encoding="utf-8"))
    data.pop("_comment", None)
    data.setdefault("presets", {})
    data["presets"]["total_route_distance_km"] = total_route_distance_km
    scenario = ScenarioDef.model_validate(data)
    route_facts = analyze_route(scenario)
    event_plan = build_event_plan(
        route_facts, scenario, {"tick_seconds": _FORECAST_TEST_TICK_SECONDS}
    )
    return scenario, event_plan, route_facts


# --- shared setup: build a deterministic run and advance one real tick ---
def _setup(spots, total_km=400.0):
    scenario, event_plan, route_facts = _make_run(total_route_distance_km=total_km)
    route_facts.rest_spot_positions = list(spots)
    t0 = tick_engine.advance_tick(None, 0, event_plan, route_facts, scenario)
    return scenario, event_plan, route_facts, t0


def _scripted(scores, result_types=None):
    """evaluate() that returns s_total from a per-call script, passing state through.

    `result_types` (optional) lets a test vary `result_type` per call to prove
    run_forecast ignores it (it only ever reads scores/next_package_runtime_state).
    """
    seq = iter(scores)
    rt_seq = iter(result_types) if result_types is not None else None

    def _ev(tick_state, prev_state):
        s = next(seq, scores[-1])
        rt = next(rt_seq, "NO_PROPOSAL") if rt_seq is not None else "NO_PROPOSAL"
        return {"scores": {"s_total": s}, "next_package_runtime_state": dict(prev_state),
                "result_type": rt}
    return _ev


def _run(scenario, event_plan, route_facts, t0, evaluate, **over):
    kw = dict(
        start_tick_state=t0, start_tick_index=1,
        current_elapsed_min=t0.elapsed_seconds / 60.0,
        current_distance_km=t0.distance_km,
        event_plan=event_plan, route_facts=route_facts, scenario=scenario, run_seed=None,
        package_runtime_state={}, committed_content=None,
        committed_content_remaining_min=0.0, committed_content_relief=None,
        evaluate=evaluate, threshold_fire=100.0, threshold_forecast_rest=80.0,
        threshold_monotony=60.0, eta_filter_min=30.0,
    )
    kw.update(over)
    return run_forecast(**kw)


# ---------------------------------------------------------------------------
# Step 1 tests (spec §20.2 items 1,2,6,10,11,12,13,15,16,17,18,19,20) — verbatim
# ---------------------------------------------------------------------------


def test_forecast_does_not_mutate_start_state():
    scenario, ep, rf, t0 = _setup([40.0, 300.0])
    before = (t0.distance_km, t0.elapsed_seconds, dict(t0.signals))
    _run(scenario, ep, rf, t0, _scripted([85.0, 90.0, 101.0]))
    assert (t0.distance_km, t0.elapsed_seconds, dict(t0.signals)) == before


def test_forecast_stops_at_first_fire_crossing():
    scenario, ep, rf, t0 = _setup([40.0, 300.0])
    fc = _run(scenario, ep, rf, t0, _scripted([85.0, 92.0, 100.5, 130.0]))
    assert fc["future_fire"]["found"] is True
    assert fc["future_fire"]["s_total"] >= 100.0
    assert fc["future_fire"]["s_total"] == 100.5  # first crossing, not later 130


def test_forecast_stops_at_destination_when_no_crossing():
    scenario, ep, rf, t0 = _setup([40.0])
    fc = _run(scenario, ep, rf, t0, _scripted([81.0]))   # never reaches 100
    assert fc["future_fire"]["found"] is False
    assert fc["forecast_future_rest_unactionable"] is False
    assert fc["forecast_rest_unactionable_reason"] is None


def test_future_spot_is_first_position_strictly_ahead_of_crossing():
    # crossing lands past 40 but before 300 → the future spot is 300
    scenario, ep, rf, t0 = _setup([40.0, 300.0], total_km=400.0)
    fc = _run(scenario, ep, rf, t0, _scripted([85.0, 92.0, 100.5]))
    if fc["forecast_rest_spot"]["exists"]:
        assert fc["forecast_rest_spot"]["position_km"] > fc["future_fire"]["distance_km"]


def test_no_spot_after_crossing_sets_no_spot_ahead():
    scenario, ep, rf, t0 = _setup([40.0], total_km=400.0)  # only spot behind the crossing
    fc = _run(scenario, ep, rf, t0, _scripted([90.0, 101.0]))
    assert fc["future_fire"]["found"] is True
    assert fc["forecast_future_rest_unactionable"] is True
    assert fc["forecast_rest_unactionable_reason"] == "no_spot_ahead"


def test_forecast_error_returns_unavailable_without_raising():
    scenario, ep, rf, t0 = _setup([40.0, 300.0])
    def _boom(ts, prev): raise RuntimeError("algorithm_error")
    fc = _run(scenario, ep, rf, t0, _boom)
    assert fc["evaluated"] is False
    assert fc["error"] is not None
    assert fc["future_fire"]["found"] is False


def test_committed_content_ends_at_remaining_boundary(monkeypatch):
    """`content` passed to advance_tick is the committed episode until its
    remaining duration elapses, then None (spec §8.2 step 5, §8.4).

    Uses a REAL `ContentContext` (not a bare `object()`) as the stand-in:
    the projection loop threads it straight into the real `advance_tick`,
    which reads `content.recovery_key` whenever `content is not None` — a
    bare `object()` would raise AttributeError there. Only IDENTITY (`is`) is
    asserted below, never any particular attribute value.
    """
    scenario, ep, rf, t0 = _setup([40.0, 300.0])
    seen_content = []
    real_advance = tick_engine.advance_tick
    def _spy(prior, idx, *a, **kw):
        seen_content.append(kw.get("content"))
        return real_advance(prior, idx, *a, **kw)
    monkeypatch.setattr("aica_api.services.nri_forecast.advance_tick", _spy)
    fake_content = ContentContext(service_id="forecast_test_service", purpose="pre_rest")
    _run(scenario, ep, rf, t0, _scripted([85.0] * 50),
         committed_content=fake_content, committed_content_remaining_min=5.0)
    # early projected ticks carry the committed content; later ones carry None
    assert seen_content[0] is fake_content
    assert None in seen_content


# ---------------------------------------------------------------------------
# Remaining §20.2 items (3,4,5,7,8,9,14)
# ---------------------------------------------------------------------------


def test_projection_never_starts_recovery_and_calls_no_action_helpers(monkeypatch):
    """§20.2 items 3/4/5: proposals/monotony/rest inside the projection cause
    NO action events or recovery. `advance_tick` must always receive
    recovery=None (never starts recovery mid-projection), regardless of what
    the scripted evaluate's result_type claims (REST/MONOTONY proposals are
    fabricated here on purpose to prove run_forecast does not act on them).
    The module must also never import/call an action helper, maps client,
    evidence recorder, or `_registry`.
    """
    scenario, ep, rf, t0 = _setup([40.0, 300.0])
    seen_recovery = []
    real_advance = tick_engine.advance_tick

    def _spy(prior, idx, *a, **kw):
        seen_recovery.append(kw.get("recovery"))
        return real_advance(prior, idx, *a, **kw)

    monkeypatch.setattr("aica_api.services.nri_forecast.advance_tick", _spy)
    fc = _run(
        scenario, ep, rf, t0,
        _scripted([85.0, 90.0, 92.0, 100.5],
                  result_types=["REST_PROPOSAL", "MONOTONY_PROPOSAL", "REST_PROPOSAL", "NO_PROPOSAL"]),
    )
    assert fc["future_fire"]["found"] is True
    assert seen_recovery, "advance_tick was never called"
    assert all(r is None for r in seen_recovery)

    src = inspect.getsource(nri_forecast)
    for forbidden in ("maps_client", "evidence_recorder", "_registry",
                      "propose_action", "action_helper", "apply_action", "append_event"):
        assert forbidden not in src, f"nri_forecast.py must not reference {forbidden!r}"


def test_committed_content_and_relief_passed_through_identically(monkeypatch):
    """§20.2 item 7: an accepted episode is present with correct remaining/relief —
    while inside the committed remaining window, BOTH the content and its
    relief accrual reach advance_tick unchanged (identity-checked via a
    stand-in object); once the remaining window elapses, both become None.
    """
    scenario, ep, rf, t0 = _setup([40.0, 300.0])
    seen = []
    real_advance = tick_engine.advance_tick

    def _spy(prior, idx, *a, **kw):
        seen.append((kw.get("content"), kw.get("content_relief")))
        return real_advance(prior, idx, *a, **kw)

    monkeypatch.setattr("aica_api.services.nri_forecast.advance_tick", _spy)
    fake_content = ContentContext(service_id="forecast_test_service", purpose="pre_rest")
    fake_relief = ContentReliefState(content_key=fake_content.recovery_key)
    _run(scenario, ep, rf, t0, _scripted([85.0] * 50),
         committed_content=fake_content, committed_content_remaining_min=5.0,
         committed_content_relief=fake_relief)

    assert seen[0] == (fake_content, fake_relief)
    assert (None, None) in seen


def test_future_etas_match_direct_planned_profile_calls():
    """§20.2 items 8/9: both future ETAs (eta_from_fire_min, eta_to_destination_min)
    use the SAME planned-profile integration as a direct `_eta_min_to_km` call —
    never `remaining_km / current_speed`.
    """
    scenario, ep, rf, t0 = _setup([40.0, 300.0], total_km=400.0)
    fc = _run(scenario, ep, rf, t0, _scripted([85.0, 92.0, 100.5]))
    fire = fc["future_fire"]
    spot = fc["forecast_rest_spot"]
    assert fire["found"] is True
    assert spot["exists"] is True

    direct_from = tick_engine._eta_min_to_km(
        target_km=spot["position_km"], from_km=fire["distance_km"],
        from_elapsed_min=fire["elapsed_min"], route_facts=rf, event_plan=ep,
        sp=scenario.speed_profile,
    )
    assert spot["eta_from_fire_min"] == pytest.approx(direct_from)

    direct_to_dest = tick_engine._eta_min_to_km(
        target_km=rf.total_route_distance_km, from_km=spot["position_km"],
        from_elapsed_min=fire["elapsed_min"] + direct_from,
        route_facts=rf, event_plan=ep, sp=scenario.speed_profile,
    )
    assert spot["eta_to_destination_min"] == pytest.approx(direct_to_dest)


def test_future_spot_eta_exactly_30_is_actionable(monkeypatch):
    """§20.2 item 14 (part 1): a future spot at EXACTLY eta_filter_min (30.0) is
    actionable — the shared gate is `eta_from <= eta_filter_min`. The current-
    rest-spot call (1st call to rest_spot_actionability) is passed through to
    the real implementation; only the future-crossing call (2nd) is scripted,
    isolating the forecast's mapping of the boundary from the projection loop.
    """
    scenario, ep, rf, t0 = _setup([40.0, 300.0])
    real_actionability = tick_engine.rest_spot_actionability
    calls = []

    def _fake(*, from_km, from_elapsed_min, route_facts, event_plan, sp, eta_filter_min, end_edge_min=10.0):
        calls.append(from_km)
        if len(calls) == 1:
            return real_actionability(
                from_km=from_km, from_elapsed_min=from_elapsed_min,
                route_facts=route_facts, event_plan=event_plan, sp=sp,
                eta_filter_min=eta_filter_min, end_edge_min=end_edge_min,
            )
        return SpotActionability(
            exists=True, position_km=from_km + 10.0,
            eta_from_position_min=eta_filter_min, eta_to_destination_min=50.0,
            actionable=True, unactionable_reason=None,
        )

    monkeypatch.setattr("aica_api.services.nri_forecast.rest_spot_actionability", _fake)
    fc = _run(scenario, ep, rf, t0, _scripted([85.0, 92.0, 100.5]))
    assert fc["forecast_rest_spot"]["actionable"] is True
    assert fc["forecast_rest_spot"]["eta_from_fire_min"] == 30.0
    assert fc["forecast_future_rest_unactionable"] is False
    assert fc["forecast_rest_unactionable_reason"] is None


def test_future_spot_eta_over_30_sets_eta_over_30_min_reason(monkeypatch):
    """§20.2 item 14 (part 2): a future spot's ETA strictly over eta_filter_min
    (30.0) is unactionable, and the shared `rest_spot_eta_over_limit` reason is
    remapped to the forecast-specific vocabulary value `eta_over_30_min`.
    """
    scenario, ep, rf, t0 = _setup([40.0, 300.0])
    real_actionability = tick_engine.rest_spot_actionability
    calls = []

    def _fake(*, from_km, from_elapsed_min, route_facts, event_plan, sp, eta_filter_min, end_edge_min=10.0):
        calls.append(from_km)
        if len(calls) == 1:
            return real_actionability(
                from_km=from_km, from_elapsed_min=from_elapsed_min,
                route_facts=route_facts, event_plan=event_plan, sp=sp,
                eta_filter_min=eta_filter_min, end_edge_min=end_edge_min,
            )
        return SpotActionability(
            exists=True, position_km=from_km + 10.0,
            eta_from_position_min=eta_filter_min + 1.0, eta_to_destination_min=50.0,
            actionable=False, unactionable_reason="rest_spot_eta_over_limit",
        )

    monkeypatch.setattr("aica_api.services.nri_forecast.rest_spot_actionability", _fake)
    fc = _run(scenario, ep, rf, t0, _scripted([85.0, 92.0, 100.5]))
    assert fc["forecast_rest_spot"]["actionable"] is False
    assert fc["forecast_future_rest_unactionable"] is True
    assert fc["forecast_rest_unactionable_reason"] == "eta_over_30_min"


def test_future_spot_destination_edge_boundary_9_9_vs_10_0(monkeypatch):
    """§20.2 item 14 (part 3): 9.9 min to destination is inside the trip-edge
    guard (unactionable, inside_destination_edge); 10.0 min is not (actionable).
    """
    scenario, ep, rf, t0 = _setup([40.0, 300.0])
    real_actionability = tick_engine.rest_spot_actionability

    def _make_fake(eta_to_dest, actionable, reason):
        calls = []

        def _fake(*, from_km, from_elapsed_min, route_facts, event_plan, sp, eta_filter_min, end_edge_min=10.0):
            calls.append(from_km)
            if len(calls) == 1:
                return real_actionability(
                    from_km=from_km, from_elapsed_min=from_elapsed_min,
                    route_facts=route_facts, event_plan=event_plan, sp=sp,
                    eta_filter_min=eta_filter_min, end_edge_min=end_edge_min,
                )
            return SpotActionability(
                exists=True, position_km=from_km + 10.0,
                eta_from_position_min=5.0, eta_to_destination_min=eta_to_dest,
                actionable=actionable, unactionable_reason=reason,
            )
        return _fake

    monkeypatch.setattr(
        "aica_api.services.nri_forecast.rest_spot_actionability",
        _make_fake(9.9, False, "inside_destination_edge"),
    )
    fc_inside = _run(scenario, ep, rf, t0, _scripted([85.0, 92.0, 100.5]))
    assert fc_inside["forecast_rest_spot"]["actionable"] is False
    assert fc_inside["forecast_future_rest_unactionable"] is True
    assert fc_inside["forecast_rest_unactionable_reason"] == "inside_destination_edge"

    monkeypatch.setattr(
        "aica_api.services.nri_forecast.rest_spot_actionability",
        _make_fake(10.0, True, None),
    )
    fc_outside = _run(scenario, ep, rf, t0, _scripted([85.0, 92.0, 100.5]))
    assert fc_outside["forecast_rest_spot"]["actionable"] is True
    assert fc_outside["forecast_future_rest_unactionable"] is False
    assert fc_outside["forecast_rest_unactionable_reason"] is None
