"""TDD tests for run_manager recovery integration (Task 5).

Verifies:
  - action("accept_rest", recovery_option_id=..., rest_spot=...) starts recovery
    instead of completing the run, when the scenario has recovery_options.
  - action("accept_rest") without a valid option raises ActionNotAllowedError.
  - tick() threads recovery through advance_tick, phases appear in raw_state,
    and the run completes after the full recovery sequence.
  - Scenarios WITHOUT recovery_options keep the existing accept_rest → completed
    back-compat behaviour (covered by test_run_manager.py).
"""

from __future__ import annotations

import pytest

import aica_api.services.run_manager as rm
from aica_api.models.run import RestSpot
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry
from tests.helpers_recovery import create_paused_rest_run


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def reset_registry():
    """Isolate each test — clear both in-memory registries."""
    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_accept_rest_with_option_resumes_into_recovery():
    """accept_rest with a valid recovery_option_id starts recovery (status=playing)."""
    run_id = create_paused_rest_run()
    spot = RestSpot(id="p1", label={"ja": "SA", "en": "SA"}, route_fraction=0.5)
    rs = rm.action(run_id, "accept_rest", recovery_option_id="nap_karaoke", rest_spot=spot)
    assert rs.status.value == "playing"
    assert rs.recovery is not None and rs.recovery.active
    assert rs.recovery.option_id == "nap_karaoke"
    assert rs.recovery.rest_spot.id == "p1"


def test_accept_rest_missing_option_is_rejected():
    """accept_rest without recovery_option_id raises ActionNotAllowedError."""
    run_id = create_paused_rest_run()
    with pytest.raises(rm.ActionNotAllowedError):
        rm.action(run_id, "accept_rest")


def test_severe_intervention_still_pauses_during_recovery():
    """While recovery is active, a SEVERE_INTERVENTION proposal still pauses the run.

    Verifies Fix 1: the fire-control suppression is scoped to REST_PROPOSAL only.
    A non-REST actionable proposal (SEVERE_INTERVENTION) must bypass suppression
    and pause the run even when recovery is active (runtime_workflow §7.2).
    """
    from unittest.mock import patch

    from aica_api.models.decision import (
        Candidate,
        DecisionResult,
        FireControl,
        Proposal,
    )
    import aica_api.algorithms.adapter as _adapter_mod

    run_id = create_paused_rest_run()
    spot = RestSpot(id="p1", label={"ja": "SA", "en": "SA"}, route_fraction=0.5)
    rs = rm.action(run_id, "accept_rest", recovery_option_id="nap_karaoke", rest_spot=spot)
    assert rs.recovery is not None and rs.recovery.active, "recovery must be active"

    # Build a SEVERE_INTERVENTION decision with an actionable proposal.
    # options=["accept_rest"] overlaps with scenario.allowed_actions so
    # proposal_is_actionable would be True — only the result_type guard should
    # prevent suppression.
    severe_proposal = Proposal(
        id="severe_001",
        message={"ja": "緊急停車", "en": "Emergency Stop"},
        options=["accept_rest"],
    )
    severe_decision = DecisionResult(
        result_type="SEVERE_INTERVENTION",
        trigger_candidate=True,
        selected_category="fatigue",
        score=0.95,
        features={},
        criteria={},
        candidates=[],
        fire_control=FireControl(fired=True, suppressed=False, override=False, reason=None),
        proposal=severe_proposal,
        reason_inputs=[],
        explanation="severe intervention triggered",
    )

    with patch.object(_adapter_mod, "evaluate", return_value=severe_decision):
        out = rm.tick(run_id)

    assert out.paused, "SEVERE_INTERVENTION must pause the run even during active recovery"
    assert out.run_state.pending_proposal == "severe_001"


def test_recovery_runs_to_resume_and_completes():
    """Full recovery sequence: phases appear in signals.dynamic and the run completes.

    Feature 009: raw_state is replaced by signals={fixed,dynamic,simulated} —
    recoveryPhase now lives under signals["dynamic"].  create_paused_rest_run()
    pauses at tick 71 (nri_fatigue_score_v1, total_km=150); the remaining ~78km
    of route plus the nap+content recovery stages complete in ~82 more ticks
    (regenerated from actual behavior, FR-018 — was 40 under the retired
    rest_rule_based_v0_1 package).
    """
    run_id = create_paused_rest_run()
    spot = RestSpot(id="p1", label={"ja": "SA", "en": "SA"}, route_fraction=0.5)
    rm.action(run_id, "accept_rest", recovery_option_id="nap_karaoke", rest_spot=spot)
    phases = []
    for _ in range(120):
        out = rm.tick(run_id)
        ts = out.tick_state
        if ts is not None and ts.signals.get("dynamic", {}).get("recoveryPhase"):
            phases.append(ts.signals["dynamic"]["recoveryPhase"])
        if out.completed:
            break
    assert "nap" in phases and "content" in phases     # staged recovery happened
    assert out.completed                               # resumed and reached destination
