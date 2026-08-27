"""Engine-level rest-min-gap-after-monotony spacing guard.

The minimum spacing between a SURFACED monotony proposal and any rest fire
(forecast REST_FORECAST_FIRE or ordinary REST_FIRE alike) is a control-engine
concern, not an algorithm concern: the NRI algorithm only proposes two scores;
the simulation engine decides whether a fire surfaces. The spacing is applied by
``run_manager._apply_rest_min_gap_guard``, called in BOTH tick loops
(``run_manager.tick`` and ``services/preview.iter_preview_ticks`` —
trip-edge-guard-two-loops) at the SAME point as the trip-edge guard: BEFORE the
TickEvent is recorded.

Recording matters. The guard NEUTRALIZES the fire (``fired=False``,
``suppressed=True``) rather than clearing an actionability flag post-record —
because ``_derive_response_suppression`` reconstructs its 単位時間あたり提案回数
count-cap from the recorded ``fire_control.fired`` flag. A run whose forecast
keeps raw-firing every tick (never accepted, precisely because we gate it) would
otherwise pump the count-cap and silence the LEGITIMATE rest fire that lands
after the gap. See ``_apply_rest_min_gap_guard``'s docstring and
docs/fixbug-0804-trigger-dedup-plan.md §5.

Both loops call the one helper, so these unit tests over the helper are the
shared coverage; test_forecast_parity.py additionally asserts the two loops
agree on the resulting episode.
"""
from __future__ import annotations

from types import SimpleNamespace

from aica_api.models.decision import Candidate, DecisionResult, FireControl, Proposal
from aica_api.services.run_manager import _apply_rest_min_gap_guard

_GAP_HP = {"rest_min_gap_after_monotony_min": 20.0}


def _tick(elapsed_sec: float) -> SimpleNamespace:
    return SimpleNamespace(elapsed_seconds=elapsed_sec)


def _decision(*, category: str, fired: bool, reason: str | None = "fire_threshold_passed") -> DecisionResult:
    """A minimal fired/unfired rest-or-monotony proposal decision."""
    fc = FireControl(fired=fired, suppressed=False, override=False, reason=reason)
    proposal = Proposal(id="rest_required_proposal", message={"en": "rest"}, options=["accept_rest"])
    candidate = Candidate(
        category=category, exists=True, score=100.0, state=None, strength="clear",
        fire_control=fc,
    )
    return DecisionResult(
        result_type="REST_PROPOSAL",
        trigger_candidate=fired,
        selected_category=category,
        score=100.0,
        features={},
        criteria={},
        candidates=[candidate],
        fire_control=fc,
        proposal=proposal,
        reason_inputs=[],
        explanation=[],
    )


# Anchor: the driver was shown a monotony card at t = 1200 s (min 20).
_ANCHOR = 1200.0


def test_rest_fire_within_gap_is_neutralized():
    # 10 min after the surfaced monotony (< 20-min gap) — the rest fire is
    # neutralized so it never enters the log as a fired proposal.
    d = _decision(category="rest_required", fired=True)
    out = _apply_rest_min_gap_guard(
        d, tick_state=_tick(_ANCHOR + 10 * 60), hyperparameters=_GAP_HP,
        last_surfaced_monotony_sec=_ANCHOR,
    )
    assert out.fire_control.fired is False
    assert out.fire_control.suppressed is True
    assert out.fire_control.reason.startswith("rest_min_gap_guard")
    # Original reason is preserved after the guard prefix for the trace.
    assert "fire_threshold_passed" in out.fire_control.reason
    # A gated rest tick records as SUPPRESSED, not REST_PROPOSAL — the NRI band
    # re-emits every tick until the gap elapses, so leaving it REST_PROPOSAL would
    # log many "fired=False rest proposals" for the one card that never surfaced.
    # SUPPRESSED is the codebase's result_type for a wanted-but-gated proposal.
    assert out.result_type == "SUPPRESSED"


def test_rest_fire_at_gap_boundary_is_not_neutralized():
    # Exactly 20 min after the anchor: the gap has elapsed (>=), so the fire
    # surfaces. Boundary is inclusive on the surfacing side.
    d = _decision(category="rest_required", fired=True)
    out = _apply_rest_min_gap_guard(
        d, tick_state=_tick(_ANCHOR + 20 * 60), hyperparameters=_GAP_HP,
        last_surfaced_monotony_sec=_ANCHOR,
    )
    assert out is d
    assert out.fire_control.fired is True


def test_rest_fire_past_gap_is_unchanged():
    d = _decision(category="rest_required", fired=True)
    out = _apply_rest_min_gap_guard(
        d, tick_state=_tick(_ANCHOR + 27 * 60), hyperparameters=_GAP_HP,
        last_surfaced_monotony_sec=_ANCHOR,
    )
    assert out is d
    assert out.fire_control.fired is True


def test_gap_zero_disables_the_guard():
    d = _decision(category="rest_required", fired=True)
    out = _apply_rest_min_gap_guard(
        d, tick_state=_tick(_ANCHOR + 60), hyperparameters={"rest_min_gap_after_monotony_min": 0.0},
        last_surfaced_monotony_sec=_ANCHOR,
    )
    assert out is d
    assert out.fire_control.fired is True


def test_missing_hyperparameter_defaults_disabled():
    # A package that doesn't declare the gap key must not have its rest fires
    # gated (default 0 = disabled).
    d = _decision(category="rest_required", fired=True)
    out = _apply_rest_min_gap_guard(
        d, tick_state=_tick(_ANCHOR + 60), hyperparameters={},
        last_surfaced_monotony_sec=_ANCHOR,
    )
    assert out is d
    assert out.fire_control.fired is True


def test_no_anchor_yet_is_unchanged():
    # No monotony card has surfaced yet → nothing to space against.
    d = _decision(category="rest_required", fired=True)
    out = _apply_rest_min_gap_guard(
        d, tick_state=_tick(600.0), hyperparameters=_GAP_HP,
        last_surfaced_monotony_sec=None,
    )
    assert out is d
    assert out.fire_control.fired is True


def test_monotony_fire_within_gap_is_not_gated():
    # The guard only spaces rest_required. A monotony proposal is never gated by
    # it (a monotony card surfacing is what STAMPS the anchor, not what it gates).
    d = _decision(category="monotony_prevention", fired=True)
    out = _apply_rest_min_gap_guard(
        d, tick_state=_tick(_ANCHOR + 5 * 60), hyperparameters=_GAP_HP,
        last_surfaced_monotony_sec=_ANCHOR,
    )
    assert out is d
    assert out.fire_control.fired is True


def test_unfired_rest_decision_is_unchanged():
    d = _decision(category="rest_required", fired=False, reason="below_fire_threshold")
    out = _apply_rest_min_gap_guard(
        d, tick_state=_tick(_ANCHOR + 60), hyperparameters=_GAP_HP,
        last_surfaced_monotony_sec=_ANCHOR,
    )
    assert out is d
    assert out.fire_control.fired is False


def test_guard_does_not_mutate_the_original_decision():
    # Neutralization returns a COPY — the algorithm's raw decision is untouched,
    # matching _apply_trip_edge_guard's contract.
    d = _decision(category="rest_required", fired=True)
    out = _apply_rest_min_gap_guard(
        d, tick_state=_tick(_ANCHOR + 60), hyperparameters=_GAP_HP,
        last_surfaced_monotony_sec=_ANCHOR,
    )
    assert out is not d
    assert d.fire_control.fired is True  # original still fired
    assert d.result_type == "REST_PROPOSAL"  # original result_type untouched
    assert out.fire_control.fired is False
    assert out.result_type == "SUPPRESSED"
