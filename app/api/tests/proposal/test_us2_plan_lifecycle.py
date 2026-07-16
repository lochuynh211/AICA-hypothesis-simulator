"""TDD (T018): US2 — advance a mocked accepted plan through its lifecycle.

Covers ``accept`` / ``complete`` / ``continue_`` / ``stop`` on the PURE
``apply_action`` engine (data-model.md §"Relationships & lifecycle" — Journey
status flow; spec.md User Story 2 / FR-008..FR-010, FR-012, SC-004):

  - accept (from ``content_selected``): emits ``CONTENT_STARTED``, sets
    ``playback_state=active``, captures the pre-accept snapshot into
    ``previous_content``, sets a deterministic ``current_plan_ref``, and
    moves ``status`` to ``content_started``.
  - complete (from ``playback_state=active``): emits ``CONTENT_COMPLETED``,
    ``playback_state=completed``, ``status=content_completed``.
  - continue_ (from ``playback_state=completed``): emits
    ``CONTINUE_REQUESTED`` carrying the committed plan's
    ``next_transition_policy``; P4 does not itself open a new opportunity
    (US4/rest scope) so ``playback_state``/``status`` are unchanged.
  - stop (from an active/backgrounded/completed plan): emits
    ``RETURN_TO_PREVIOUS_CONTENT``, restores ``active_service_id``/
    ``current_plan_ref`` from ``previous_content``, clears
    ``previous_content``, ``playback_state=stopped``,
    ``status=content_stopped``. Widened to accept ``completed`` too (not
    just active/backgrounded) so the full accept->complete->continue->stop
    sequence in spec.md's US2 Independent Test / SC-004 can complete on one
    run without first re-entering playback (continue leaves
    ``playback_state`` at ``completed`` per FR-009's "continuing MUST follow
    the plan's next-transition policy" — it does not itself resume
    playback).
  - Invalid preconditions (complete before accept, continue before
    complete, accept twice, stop with nothing to stop) -> a structured
    ``TransitionRejection`` (FR-012), no events, unchanged state.

All state is built by driving REAL create-run + select-service endpoint
calls (mock packages) to ``content_selected`` — mirrors the pattern used by
``test_us1_flow.py`` / ``test_ep_select_service.py`` -- then engine calls are
made directly against the resulting ``ProposalRunLog`` (unit-level, per the
brief: "via the apply_action engine (unit-level) OR the endpoint").
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app
from aica_api.models.proposal.enums import (
    DiscreteEventType,
    JourneyActionType,
    PlaybackState,
    ProposalRunStatus,
)
from aica_api.models.proposal.journey_action import JourneyAction
from aica_api.models.proposal.proposal_run import ProposalRunLog
from aica_api.services.proposal_journey import apply_action

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolate_proposal_runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path))
    yield


def _create_run_body(**overrides) -> dict:
    body = {
        "trigger_purpose": "rest_recommended",
        "lifecycle_stage": "after_rest_before_restart",
        "motion_state": "stopped",
        "world_snapshot": {"feature_snapshot": {}, "feature_provenance": {}},
        "service_package_id": "mock_service_selector_v1",
        "content_package_id": "mock_content_selector_v1",
        "mode": "interactive",
        "enabled_feature_extensions": [],
        "parameters": {},
        "hyperparameters": {},
        "run_seed": "seed-1",
        "simulation_time": "2026-07-16T10:00:00Z",
    }
    body.update(overrides)
    return body


def _content_selected_run_log() -> ProposalRunLog:
    """Drive a run through create -> select-service("full_karaoke") to
    ``content_selected`` via the REAL endpoints (mock packages), then parse
    the resulting dict back into a ``ProposalRunLog`` for direct engine
    calls."""
    created = client.post("/api/proposal/runs", json=_create_run_body())
    assert created.status_code == 201, created.text
    run_id = created.json()["run_id"]

    selected = client.post(
        f"/api/proposal/runs/{run_id}/select-service",
        json={"selected_service_id": "full_karaoke"},
    )
    assert selected.status_code == 200, selected.text
    body = selected.json()
    assert body["status"] == "content_selected"
    return ProposalRunLog(**body)


def _apply(run_log: ProposalRunLog, action_type: JourneyActionType, now: str, payload: dict | None = None):
    action = JourneyAction(action_type=action_type, payload=payload or {})
    return apply_action(run_log, action, now=now)


def _advance(run_log: ProposalRunLog, action_type: JourneyActionType, now: str) -> ProposalRunLog:
    """Apply one action and fold the transition back into a new
    ``ProposalRunLog`` (mirrors what the router persists) so a subsequent
    action can be applied on top -- lets a unit-level test chain actions
    without going through the HTTP endpoint."""
    transition = _apply(run_log, action_type, now)
    assert transition.rejected is None, transition.rejected
    return run_log.model_copy(
        update={
            "events": [*run_log.events, *transition.events],
            "journey_state": transition.new_journey_state,
            "status": transition.new_status,
        }
    )


# ---------------------------------------------------------------------------
# accept
# ---------------------------------------------------------------------------


def test_accept_starts_content_and_captures_previous():
    run_log = _content_selected_run_log()
    pre_active_service_id = run_log.journey_state.active_service_id
    assert pre_active_service_id == "full_karaoke"
    assert run_log.journey_state.current_plan_ref is None

    transition = _apply(run_log, JourneyActionType.accept, now="2026-07-16T11:00:00Z")

    assert transition.rejected is None
    assert transition.new_status == ProposalRunStatus.content_started
    js = transition.new_journey_state
    assert js.playback_state == PlaybackState.active
    assert js.active_service_id == pre_active_service_id
    assert js.current_plan_ref is not None
    assert js.previous_content is not None
    assert js.previous_content.service_id == pre_active_service_id
    assert js.previous_content.plan_ref is None  # pre-accept current_plan_ref was None

    assert len(transition.events) == 1
    event = transition.events[0]
    assert event.event_type == DiscreteEventType.CONTENT_STARTED
    assert event.at == "2026-07-16T11:00:00Z"
    assert event.payload == {"selected_service_id": "full_karaoke"}


def test_accept_from_wrong_status_is_rejected_no_op():
    run_log = _content_selected_run_log()
    # already content_selected -> accept once (valid), but calling accept
    # again from content_started must reject (accept requires content_selected).
    run_log = _advance(run_log, JourneyActionType.accept, now="2026-07-16T11:00:00Z")
    assert run_log.status == ProposalRunStatus.content_started

    transition = _apply(run_log, JourneyActionType.accept, now="2026-07-16T11:01:00Z")

    assert transition.rejected is not None
    assert transition.rejected.code == "invalid_precondition"
    assert transition.events == []
    assert transition.new_journey_state == run_log.journey_state
    assert transition.new_status == run_log.status


# ---------------------------------------------------------------------------
# complete
# ---------------------------------------------------------------------------


def test_complete_after_accept():
    run_log = _content_selected_run_log()
    run_log = _advance(run_log, JourneyActionType.accept, now="2026-07-16T11:00:00Z")

    transition = _apply(run_log, JourneyActionType.complete, now="2026-07-16T11:05:00Z")

    assert transition.rejected is None
    assert transition.new_status == ProposalRunStatus.content_completed
    assert transition.new_journey_state.playback_state == PlaybackState.completed
    assert len(transition.events) == 1
    assert transition.events[0].event_type == DiscreteEventType.CONTENT_COMPLETED
    assert transition.events[0].at == "2026-07-16T11:05:00Z"


def test_complete_before_accept_is_rejected():
    run_log = _content_selected_run_log()

    transition = _apply(run_log, JourneyActionType.complete, now="2026-07-16T11:00:00Z")

    assert transition.rejected is not None
    assert transition.rejected.code == "invalid_precondition"
    assert transition.events == []
    assert transition.new_journey_state == run_log.journey_state
    assert transition.new_status == run_log.status


# ---------------------------------------------------------------------------
# continue_
# ---------------------------------------------------------------------------


def test_continue_after_complete_uses_plan_next_transition_policy():
    run_log = _content_selected_run_log()
    content_ev = next(e for e in run_log.evidence if e.step == "content" and e.error is None)
    expected_policy = content_ev.output["next_transition_policy"]
    assert expected_policy  # mock package always sets this

    run_log = _advance(run_log, JourneyActionType.accept, now="2026-07-16T11:00:00Z")
    run_log = _advance(run_log, JourneyActionType.complete, now="2026-07-16T11:05:00Z")

    transition = _apply(run_log, JourneyActionType.continue_, now="2026-07-16T11:06:00Z")

    assert transition.rejected is None
    # P4 continue records the policy-driven event only -- it does not itself
    # open a new opportunity (US4/rest scope) -- so status/playback_state
    # are carried over unchanged.
    assert transition.new_status == ProposalRunStatus.content_completed
    assert transition.new_journey_state.playback_state == PlaybackState.completed
    assert len(transition.events) == 1
    event = transition.events[0]
    assert event.event_type == DiscreteEventType.CONTINUE_REQUESTED
    assert event.payload == {"next_transition_policy": expected_policy}


def test_continue_before_complete_is_rejected():
    run_log = _content_selected_run_log()
    run_log = _advance(run_log, JourneyActionType.accept, now="2026-07-16T11:00:00Z")

    transition = _apply(run_log, JourneyActionType.continue_, now="2026-07-16T11:01:00Z")

    assert transition.rejected is not None
    assert transition.rejected.code == "invalid_precondition"
    assert transition.events == []
    assert transition.new_journey_state == run_log.journey_state
    assert transition.new_status == run_log.status


# ---------------------------------------------------------------------------
# stop
# ---------------------------------------------------------------------------


def test_stop_from_active_restores_previous_content():
    run_log = _content_selected_run_log()
    pre_service_id = run_log.journey_state.active_service_id
    run_log = _advance(run_log, JourneyActionType.accept, now="2026-07-16T11:00:00Z")
    assert run_log.journey_state.playback_state == PlaybackState.active

    transition = _apply(run_log, JourneyActionType.stop, now="2026-07-16T11:02:00Z")

    assert transition.rejected is None
    assert transition.new_status == ProposalRunStatus.content_stopped
    js = transition.new_journey_state
    assert js.playback_state == PlaybackState.stopped
    assert js.previous_content is None
    # pre-accept snapshot had active_service_id == pre_service_id, plan_ref None
    assert js.active_service_id == pre_service_id
    assert js.current_plan_ref is None

    assert len(transition.events) == 1
    event = transition.events[0]
    assert event.event_type == DiscreteEventType.RETURN_TO_PREVIOUS_CONTENT
    assert event.payload == {"restored_service_id": pre_service_id}


def test_full_sequence_accept_complete_continue_stop():
    """spec.md US2 Independent Test / SC-004: accept -> complete -> continue
    -> stop all succeed on the SAME run, in order."""
    run_log = _content_selected_run_log()

    run_log = _advance(run_log, JourneyActionType.accept, now="2026-07-16T11:00:00Z")
    assert run_log.status == ProposalRunStatus.content_started

    run_log = _advance(run_log, JourneyActionType.complete, now="2026-07-16T11:05:00Z")
    assert run_log.status == ProposalRunStatus.content_completed

    run_log = _advance(run_log, JourneyActionType.continue_, now="2026-07-16T11:06:00Z")
    assert run_log.status == ProposalRunStatus.content_completed

    run_log = _advance(run_log, JourneyActionType.stop, now="2026-07-16T11:10:00Z")
    assert run_log.status == ProposalRunStatus.content_stopped
    assert run_log.journey_state.playback_state == PlaybackState.stopped
    assert run_log.journey_state.previous_content is None

    event_types = [e.event_type for e in run_log.events]
    assert event_types == [
        DiscreteEventType.OPPORTUNITY_OPENED,
        DiscreteEventType.SERVICE_SELECTED,
        DiscreteEventType.CONTENT_SELECTED,
        DiscreteEventType.CONTENT_STARTED,
        DiscreteEventType.CONTENT_COMPLETED,
        DiscreteEventType.CONTINUE_REQUESTED,
        DiscreteEventType.RETURN_TO_PREVIOUS_CONTENT,
    ]


def test_stop_with_nothing_active_is_rejected():
    run_log = _content_selected_run_log()  # never accepted -> playback_state idle

    transition = _apply(run_log, JourneyActionType.stop, now="2026-07-16T11:00:00Z")

    assert transition.rejected is not None
    assert transition.rejected.code == "invalid_precondition"
    assert transition.events == []
    assert transition.new_journey_state == run_log.journey_state
    assert transition.new_status == run_log.status
