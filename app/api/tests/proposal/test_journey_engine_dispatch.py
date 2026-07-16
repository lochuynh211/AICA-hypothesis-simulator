"""TDD (T011): the pure P4 journey-engine dispatch skeleton.

Covers:
  - An unrecognized ``action_type`` value (bypassing pydantic validation via
    ``model_construct``, simulating a value with no ``_HANDLERS`` entry)
    yields a rejected transition: code "invalid_precondition", no events,
    unchanged journey_state/status.
  - A VALID ``JourneyActionType`` applied to a run whose state does not (yet)
    satisfy that action's precondition — e.g. ``continue_`` on a run that
    never started content — also yields a rejected transition (this unit's
    stub handlers reject every action unconditionally; later units
    (US2/US3/US4) replace individual stubs with real precondition checks,
    but the *shape* of a precondition failure must already match now).
  - `apply_action` is PURE: no clock/random/IO — the same `(run_log, action)`
    pair with different `now` values changes nothing about the result except
    (were `now` actually used, which no stub does) — assert identical
    (state, status) output for two distinct `now` strings.
"""
from __future__ import annotations

from aica_api.models.proposal.enums import (
    JourneyActionType,
    LifecycleStage,
    MotionState,
    ProposalRunStatus,
)
from aica_api.models.proposal.journey import JourneyState
from aica_api.models.proposal.journey_action import JourneyAction
from aica_api.models.proposal.opportunity import ProposalOpportunity
from aica_api.models.proposal.proposal_run import ProposalRunLog
from aica_api.services.proposal_journey import apply_action


def _make_run_log(*, status: ProposalRunStatus = ProposalRunStatus.service_selected) -> ProposalRunLog:
    opportunity = ProposalOpportunity(
        opportunity_id="op_test_0001",
        trigger_purpose="rest_recommended",
        lifecycle_stage=LifecycleStage.before_rest_until_stop,
        allowed_service_ids=["music_playlist"],
        simulation_time="2026-07-16T10:00:00Z",
        run_seed="seed-1",
    )
    journey_state = JourneyState(
        lifecycle_stage=LifecycleStage.before_rest_until_stop,
        motion_state=MotionState.driving,
        active_service_id="music_playlist",
        active_plan_id=None,
    )
    return ProposalRunLog(
        run_id="prun_test_0001",
        created_at="2026-07-16T10:00:00Z",
        opportunity=opportunity,
        matrix_version="v1",
        world_snapshot={},
        service_package_id="mock_service_selector_v1",
        content_package_id="mock_content_selector_v1",
        parameters={},
        hyperparameters={},
        journey_state=journey_state,
        events=[],
        evidence=[],
        status=status,
    )


def test_unrecognized_action_type_is_rejected_no_op():
    run_log = _make_run_log()
    bogus_action = JourneyAction.model_construct(action_type="totally_bogus", payload={})

    transition = apply_action(run_log, bogus_action, now="2026-07-16T10:05:00Z")

    assert transition.rejected is not None
    assert transition.rejected.code == "invalid_precondition"
    assert transition.rejected.message  # non-empty bilingual message
    assert transition.events == []
    assert transition.new_journey_state == run_log.journey_state
    assert transition.new_status == run_log.status


def test_valid_action_wrong_precondition_is_rejected_no_op():
    # `continue_` on a run that never reached content_started: this unit's
    # stub always rejects (real precondition enforcement lands in US2), but
    # the rejection shape must already hold.
    run_log = _make_run_log(status=ProposalRunStatus.service_selected)
    action = JourneyAction(action_type=JourneyActionType.continue_, payload={})

    transition = apply_action(run_log, action, now="2026-07-16T10:05:00Z")

    assert transition.rejected is not None
    assert transition.rejected.code == "invalid_precondition"
    assert transition.events == []
    assert transition.new_journey_state == run_log.journey_state
    assert transition.new_status == run_log.status


def test_every_action_type_stub_rejects_for_now():
    run_log = _make_run_log()
    for action_type in JourneyActionType:
        action = JourneyAction(action_type=action_type, payload={})
        transition = apply_action(run_log, action, now="2026-07-16T10:05:00Z")
        assert transition.rejected is not None, action_type
        assert transition.rejected.code == "invalid_precondition"
        assert transition.events == []


def test_apply_action_is_pure_wrt_now():
    run_log = _make_run_log()
    action = JourneyAction(action_type=JourneyActionType.accept, payload={})

    t1 = apply_action(run_log, action, now="2026-07-16T10:00:00Z")
    t2 = apply_action(run_log, action, now="2099-01-01T00:00:00Z")

    assert t1.rejected.code == t2.rejected.code
    assert t1.new_journey_state == t2.new_journey_state
    assert t1.new_status == t2.new_status
    assert t1.events == t2.events == []
