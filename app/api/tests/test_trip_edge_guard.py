"""Tests for the fixbug-0806 trip-edge guard.

Customer review: a ROUTINE proposal (rest / monotony content) fired in the
first ~20 minutes of a drive ("too soon") or the last ~10 minutes before the
destination ("too late") is one a driver is very unlikely to accept, so it
should not reach them at all.

The load-bearing subtlety — and the reason this is NOT modelled as an
auto-decline — is the customer's explicit constraint: "reject it inside the
edge, but do NOT kick the rejection window." A decline would open the
same-category de-dup / count-cap cooldown in `_derive_response_suppression`,
which would then block the FIRST legitimate proposal right after the edge. So
the guard instead NEUTRALIZES the fire itself (`fire_control.fired -> False`,
`suppressed=True`) BEFORE the TickEvent is recorded, so the evidence log never
carries a fired proposal for the edge tick — no cooldown, no count-cap hit.

Three groups:
  A. `_inside_trip_edge` — the geometric predicate (start edge / end edge / M1).
  B. `_apply_trip_edge_guard` — the fire-control rewrite (routine vs escalation,
     inside vs outside, non-fired pass-through, reason prefixing).
  C. The "do NOT kick the rejection window" invariant, proven against the REAL
     `_derive_response_suppression`: three edge fires consume the count cap when
     left fired, but consume NOTHING once run through the guard — so a later
     legitimate proposal is still free to fire.

These are pure-function tests: no run/registry, no scenario JSON. The guard's
two live call sites (run_manager.tick + preview.iter_preview_ticks) reuse THIS
same helper unchanged (see trip-edge-guard-two-loops), so exercising the helper
exercises both loops' policy.
"""

from __future__ import annotations

import pytest

from aica_api.models.decision import DecisionResult, FireControl, Proposal
from aica_api.models.log import TickEvent, TraceEntry
from aica_api.models.run import EventPlan, RouteFacts, TickState
from aica_api.services.run_manager import (
    _MAX_PROPOSALS_PER_WINDOW,
    _TRIP_START_EDGE_SEC,
    _apply_trip_edge_guard,
    _derive_response_suppression,
    _inside_trip_edge,
)

# ---------------------------------------------------------------------------
# Fixtures / builders
# ---------------------------------------------------------------------------
#
# A route with no route_segments falls back to "normal_road" everywhere, and an
# EventPlan with no traffic_events has no jams — so with speed_profile=None the
# ETA integration runs at the 60 kph normal-road default: 1 km == 1 minute.
# That makes the end-edge arithmetic exact and readable (distance_km=95 on a
# 100 km route => 5 min to go => inside the 10-min end edge).
_TOTAL_KM = 100.0


def _route_facts() -> RouteFacts:
    return RouteFacts(total_route_distance_km=_TOTAL_KM)


def _event_plan() -> EventPlan:
    return EventPlan()  # no traffic_events => no jams


def _tick_state(elapsed_seconds: float, distance_km: float | None) -> TickState:
    return TickState(
        tick_index=int(elapsed_seconds // 180),
        elapsed_seconds=int(elapsed_seconds),
        route_fraction=0.0,
        active_segment_id="seg_start",
        drowsiness_level="none",
        fatigue_level="low",
        signal_duration="transient",
        continuous_driving_time="short",
        rest_spot_eta="none",
        completed=False,
        distance_km=distance_km,
    )


def _fired_decision(
    result_type: str = "REST_PROPOSAL",
    category: str = "rest_required",
    *,
    reason: str | None = None,
) -> DecisionResult:
    """A DecisionResult that fired a proposal — same shape both live loops see."""
    fc = FireControl(fired=True, suppressed=False, override=False, reason=reason)
    proposal = Proposal(
        id=f"{category}_proposal",
        message={"ja": "x", "en": "x"},
        options=["accept_rest", "postpone", "decline", "acknowledge"],
    )
    return DecisionResult(
        result_type=result_type,
        trigger_candidate=True,
        selected_category=category,
        score=0.9,
        features={},
        criteria={},
        candidates=[],
        fire_control=fc,
        proposal=proposal,
        reason_inputs=[],
        explanation="fired",
    )


def _guard(decision: DecisionResult, *, elapsed_seconds: float, distance_km: float | None) -> DecisionResult:
    return _apply_trip_edge_guard(
        decision,
        tick_state=_tick_state(elapsed_seconds, distance_km),
        route_facts=_route_facts(),
        event_plan=_event_plan(),
        speed_profile=None,
    )


def _fired_tick_event(tick_index: int, elapsed_seconds: float, decision: DecisionResult) -> TickEvent:
    ts = _tick_state(elapsed_seconds, distance_km=1.0)
    ts = ts.model_copy(update={"tick_index": tick_index})
    trace = TraceEntry(tick_index=tick_index, decision_result=decision)
    return TickEvent(kind="tick", tick_index=tick_index, tick_state=ts, trace=trace)


# ---------------------------------------------------------------------------
# A. _inside_trip_edge — the geometric predicate
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("elapsed", [0.0, 60.0, _TRIP_START_EDGE_SEC - 1.0])
def test_start_edge_before_20min_is_inside(elapsed):
    # Mid-route distance => the end edge is nowhere near; only the start edge
    # can make this True. It does, for the whole first 20 minutes.
    assert _inside_trip_edge(
        elapsed_seconds=elapsed,
        distance_km=50.0,
        route_facts=_route_facts(),
        event_plan=_event_plan(),
        speed_profile=None,
    ) is True


def test_start_edge_boundary_is_outside():
    # Exactly at 20:00 the start edge has closed; mid-route so the end edge is
    # far off => outside both.
    assert _inside_trip_edge(
        elapsed_seconds=_TRIP_START_EDGE_SEC,
        distance_km=50.0,
        route_facts=_route_facts(),
        event_plan=_event_plan(),
        speed_profile=None,
    ) is False


def test_middle_of_trip_is_outside():
    # 30 min in (start edge closed), 30 km from the 100 km end at 60 kph
    # => ~30 min ETA, well clear of the 10-min end edge.
    assert _inside_trip_edge(
        elapsed_seconds=30.0 * 60.0,
        distance_km=70.0,
        route_facts=_route_facts(),
        event_plan=_event_plan(),
        speed_profile=None,
    ) is False


def test_end_edge_within_10min_eta_is_inside():
    # 60 min in, 95 of 100 km done => 5 km / 60 kph == 5 min to go < 10 => inside.
    assert _inside_trip_edge(
        elapsed_seconds=60.0 * 60.0,
        distance_km=95.0,
        route_facts=_route_facts(),
        event_plan=_event_plan(),
        speed_profile=None,
    ) is True


def test_m1_no_distance_only_start_edge_applies():
    # M1 (time-only) scenario: distance_km is None, so the end edge cannot be
    # computed and is skipped. After the start edge closes it is never inside —
    # a time-only scenario is guarded only at its start.
    inside_start = _inside_trip_edge(
        elapsed_seconds=60.0,
        distance_km=None,
        route_facts=_route_facts(),
        event_plan=_event_plan(),
        speed_profile=None,
    )
    after_start = _inside_trip_edge(
        elapsed_seconds=_TRIP_START_EDGE_SEC + 1.0,
        distance_km=None,
        route_facts=_route_facts(),
        event_plan=_event_plan(),
        speed_profile=None,
    )
    assert inside_start is True
    assert after_start is False


def test_end_edge_skipped_when_total_route_distance_unknown():
    # A route_facts with no total_route_distance_km cannot express an end edge
    # even for an M2 tick that has a distance_km.
    rf = RouteFacts()  # total_route_distance_km is None
    assert _inside_trip_edge(
        elapsed_seconds=90.0 * 60.0,
        distance_km=999.0,
        route_facts=rf,
        event_plan=_event_plan(),
        speed_profile=None,
    ) is False


# ---------------------------------------------------------------------------
# B. _apply_trip_edge_guard — the fire-control rewrite
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "result_type,category",
    [("REST_PROPOSAL", "rest_required"), ("MONOTONY_PROPOSAL", "monotony_prevention")],
)
def test_routine_fire_inside_start_edge_is_neutralized(result_type, category):
    original = _fired_decision(result_type, category)
    guarded = _guard(original, elapsed_seconds=300.0, distance_km=5.0)

    assert guarded.fire_control.fired is False
    assert guarded.fire_control.suppressed is True
    assert guarded.fire_control.reason is not None
    assert guarded.fire_control.reason.startswith("trip_edge_guard")
    # Everything else about the decision is preserved — only fire-control is
    # rewritten, so the evidence trace still shows what the algorithm wanted.
    assert guarded.proposal is not None
    assert guarded.selected_category == category
    assert guarded.result_type == result_type
    assert guarded.score == 0.9
    # The original object is not mutated (model_copy, not in-place).
    assert original.fire_control.fired is True


def test_routine_fire_inside_end_edge_is_neutralized():
    original = _fired_decision("REST_PROPOSAL", "rest_required")
    # 60 min in, 95/100 km => 5 min to destination => inside the end edge.
    guarded = _guard(original, elapsed_seconds=60.0 * 60.0, distance_km=95.0)
    assert guarded.fire_control.fired is False
    assert guarded.fire_control.suppressed is True


def test_routine_fire_outside_both_edges_is_unchanged():
    original = _fired_decision("REST_PROPOSAL", "rest_required")
    guarded = _guard(original, elapsed_seconds=30.0 * 60.0, distance_km=50.0)
    # Untouched — returned verbatim (same object), still fired.
    assert guarded is original
    assert guarded.fire_control.fired is True


def test_escalation_passes_through_the_edge():
    # A genuine safety escalation must never be withheld for being early/late —
    # same policy the recovery_active gate uses (only ROUTINE is suppressed).
    original = _fired_decision("SEVERE_INTERVENTION", "rest_required")
    guarded = _guard(original, elapsed_seconds=60.0, distance_km=1.0)
    assert guarded is original
    assert guarded.fire_control.fired is True


def test_non_fired_decision_is_unchanged():
    original = _fired_decision("REST_PROPOSAL", "rest_required")
    not_fired = original.model_copy(
        update={"fire_control": original.fire_control.model_copy(update={"fired": False})}
    )
    guarded = _guard(not_fired, elapsed_seconds=60.0, distance_km=1.0)
    assert guarded is not_fired


def test_reason_is_prefixed_not_replaced():
    # A fire that already carries a reason keeps it, prefixed — the guard is
    # additive to the trace, not destructive.
    original = _fired_decision("REST_PROPOSAL", "rest_required", reason="score_over_threshold")
    guarded = _guard(original, elapsed_seconds=60.0, distance_km=1.0)
    assert guarded.fire_control.reason == "trip_edge_guard; score_over_threshold"


# ---------------------------------------------------------------------------
# C. The "do NOT kick the rejection window" invariant
# ---------------------------------------------------------------------------
#
# Proven against the REAL _derive_response_suppression (the exact de-dup /
# count-cap gate both live loops consult), so this is the customer's actual
# constraint, not a restatement of the guard.


def test_edge_fires_left_fired_would_consume_the_count_cap():
    """Baseline (guard NOT applied): _MAX_PROPOSALS_PER_WINDOW routine fires in
    the start edge exhaust the count cap, so the gate would suppress the next
    proposal of that category. This is the trap the guard exists to avoid."""
    assert _MAX_PROPOSALS_PER_WINDOW == 3  # test is written for the shipped cap
    events = [
        _fired_tick_event(i, elapsed_seconds=i * 180.0, decision=_fired_decision())
        for i in range(_MAX_PROPOSALS_PER_WINDOW)
    ]
    # Evaluate shortly after, still inside the trailing count window.
    suppression = _derive_response_suppression(
        events, current_sim_sec=3.0 * 180.0 + 60.0, tick_seconds=180.0
    )
    assert suppression["rest_required"] is True


def test_guarded_edge_fires_consume_nothing_so_next_proposal_is_free():
    """The invariant: run the SAME edge fires through the guard first, and the
    de-dup gate sees no fired proposals at all — no cooldown, no count-cap. A
    later legitimate proposal is therefore NOT blocked."""
    guarded_events = [
        _fired_tick_event(
            i,
            elapsed_seconds=i * 180.0,
            decision=_guard(_fired_decision(), elapsed_seconds=i * 180.0, distance_km=1.0),
        )
        for i in range(_MAX_PROPOSALS_PER_WINDOW)
    ]
    # Every event carries a neutralized fire => nothing counts toward the cap.
    assert all(ev.trace.decision_result.fire_control.fired is False for ev in guarded_events)

    suppression = _derive_response_suppression(
        guarded_events, current_sim_sec=3.0 * 180.0 + 60.0, tick_seconds=180.0
    )
    assert suppression["rest_required"] is False
    assert suppression["monotony_prevention"] is False


def test_guarded_edge_then_legit_fire_after_edge_still_fires_once_only():
    """End-to-end shape of the fix: three neutralized edge fires, then one real
    fire AFTER the edge. Only the real fire is counted — one shown proposal is
    far below the cap, and no cooldown was opened by the edge — so the gate does
    NOT suppress it."""
    events = [
        _fired_tick_event(
            i,
            elapsed_seconds=i * 180.0,
            decision=_guard(_fired_decision(), elapsed_seconds=i * 180.0, distance_km=1.0),
        )
        for i in range(_MAX_PROPOSALS_PER_WINDOW)
    ]
    # A legitimate fire at 25 min — past the start edge, mid-route (not neutralized).
    legit_elapsed = 25.0 * 60.0
    events.append(_fired_tick_event(20, elapsed_seconds=legit_elapsed, decision=_fired_decision()))

    # The gate is consulted BEFORE this fire is itself recorded (as in the live
    # loops), so it only sees the prior neutralized edge fires => not suppressed.
    suppression = _derive_response_suppression(
        events[:-1], current_sim_sec=legit_elapsed, tick_seconds=180.0
    )
    assert suppression["rest_required"] is False
