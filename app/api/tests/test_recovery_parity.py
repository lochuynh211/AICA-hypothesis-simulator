"""P5 — both algorithms must react IDENTICALLY to the same driver event.

Any remaining divergence in the curves must come from the algorithms' own
scoring math, never from two different recovery implementations.
"""
import pytest

from tests.helpers_recovery import run_identical_stream


@pytest.fixture(autouse=True)
def isolate_run_registries():
    """Clear both in-memory registries so runs from one test don't leak into
    the next (same pattern as test_content_relief.py)."""
    from aica_api.services.run_manager import clear_registry
    from aica_api.services.run_plan import clear_draft_registry

    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


def test_both_packages_freeze_monotony_on_exactly_the_same_ticks():
    hybrid = run_identical_stream("aica_transparent_hybrid_trigger_v1")
    nri = run_identical_stream("nri_fatigue_score_v1")

    hybrid_frozen = [
        t.signals["dynamic"]["stimulusFrozen"] for t in hybrid.tick_states
    ]
    nri_frozen = [t.signals["dynamic"]["stimulusFrozen"] for t in nri.tick_states]
    assert hybrid_frozen == nri_frozen

    # and each package's own accumulator is flat on exactly those ticks
    hybrid_mono = [s["accumulators"]["mono_min"] for s in hybrid.runtime_states]
    nri_mono = [s["cumulative_monotonous_min"] for s in nri.runtime_states]
    for i, frozen in enumerate(hybrid_frozen[1:], start=1):
        if frozen:
            assert hybrid_mono[i] <= hybrid_mono[i - 1]
            assert nri_mono[i] <= nri_mono[i - 1]


def test_monotony_relief_never_erases_accumulated_exposure():
    """Design P3 — freeze, don't erase. The old hacks dropped hours to zero."""
    result = run_identical_stream(
        "aica_transparent_hybrid_trigger_v1", accept_monotony_at_tick=10
    )
    mono = [s["accumulators"]["mono_min"] for s in result.runtime_states]
    assert min(mono[10:]) > 0.0, "relief must not zero the accumulator"


def test_hybrid_monotony_score_plateaus_at_a_floor_not_zero():
    """Design §7 — night and familiarity are FACTS and do not freeze, so the
    frozen score settles on w_night + w_familiar + w_env_mono*env_load."""
    result = run_identical_stream(
        "aica_transparent_hybrid_trigger_v1",
        is_night=True, familiar_route=True, accept_monotony_at_tick=10,
    )
    scores = [s["smoothed_scores"]["monotony_prevention_score"] for s in result.runtime_states]
    assert min(scores[12:]) > 0.0


def test_count_cap_never_bites_on_hybrid():
    """§9.2 calibration constraint — the harness cap is an OUTER cap on top of
    Hybrid's own `proposalCountLast30Min`. If it ever suppresses a Hybrid fire
    it is tighter than Hybrid's own cap, and is silently changing that
    package's behaviour instead of only giving NRI a floor.

    Asserted directly rather than by a loose bound: walk the stream's fires in
    order and check the COUNT rule's own condition never became true.
    """
    from aica_api.services.run_manager import (
        _MAX_PROPOSALS_PER_WINDOW, _PROPOSAL_COUNT_WINDOW_SEC,
    )

    result = run_identical_stream("aica_transparent_hybrid_trigger_v1")
    shown: dict[str, list[float]] = {"rest_required": [], "monotony_prevention": []}
    for tick_state, decision in zip(result.tick_states, result.decisions):
        if not (decision and decision.fire_control.fired and decision.selected_category):
            continue
        category = decision.selected_category
        now = float(tick_state.elapsed_seconds)
        recent = [t for t in shown[category] if t > now - _PROPOSAL_COUNT_WINDOW_SEC]
        assert len(recent) < _MAX_PROPOSALS_PER_WINDOW, (
            f"{category}: the harness count cap would have suppressed a Hybrid "
            f"fire at t={now}s — it is tighter than Hybrid's own cap"
        )
        shown[category].append(now)
