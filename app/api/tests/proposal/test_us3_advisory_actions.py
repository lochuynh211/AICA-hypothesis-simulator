"""TDD (T022/T023): US3 — advisory service actions never dead-end the run.

Covers ``reject`` / ``choose_another`` / ``request_more`` / ``postpone`` on
the PURE ``apply_action`` engine (spec.md User Story 3; FR-007, FR-011,
FR-012, FR-013, SC-005):

  - reject (from ``service_selected``): records ``SERVICE_REJECTED``, adds
    the offered service to ``rejected_service_ids``, clears
    ``active_service_id`` -- and does NOT dead-end the run while another
    eligible candidate remains (``status`` stays ``service_selected``).
    When the eligible pool is fully exhausted, an EXPLICIT
    ``NO_ELIGIBLE_CANDIDATE`` event is ALSO emitted -- a success end-state,
    never a crash/error (SC-005/FR-013).
  - choose_another (from ``service_selected``): advances to the next
    eligible, non-rejected candidate (reusing the EXISTING service ranking
    -- no re-scoring); emits ``CHOOSE_ANOTHER`` then ``SERVICE_SELECTED``.
    When none remains, a structured ``TransitionRejection(code=
    "no_eligible_candidate")`` is returned (FR-012).
  - request_more (from ``service_selected``): surfaces the remaining
    eligible pool WITHOUT producing any new score / new ``AlgorithmEvidence``
    (reuses the existing ranking).
  - postpone (from ``service_selected`` or ``content_selected``): records
    ``POSTPONED``; the opportunity returns to an open (``service_selected``)
    state.
  - Invalid precondition on any of the four -> structured
    ``TransitionRejection(code="invalid_precondition")`` (FR-012).

All state is built by driving REAL create-run (+ select-service, for the
content_selected precondition fixtures) endpoint calls (mock packages) --
mirrors the pattern used by ``test_us2_plan_lifecycle.py``. The fixture row
is ``inattentive_driving_prevention_recovery`` / ``active_driving_content``
/ ``driving``, which has SIX allowed driving services (all eligible while
driving, per ``service_capabilities.v1.json``) -- ``mock_service_selector_v1``
ranks the first three (rank 1..3) and leaves the rest un-ranked, so the
US1 eligible pool ('input_snapshot.eligible_candidates') is strictly wider
than the ranked top-3, exercising the "remaining eligible pool" behavior
this unit implements.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app
from aica_api.models.proposal.enums import (
    DiscreteEventType,
    JourneyActionType,
    ProposalRunStatus,
)
from aica_api.models.proposal.journey_action import JourneyAction
from aica_api.models.proposal.proposal_run import ProposalRunLog
from aica_api.services.proposal_journey import apply_action

client = TestClient(app)

# The frozen matrix row's full allowed_service_ids (all driving_capable, so
# eligibility resolution while driving retains every one of them -- see
# proposal_contracts/matrix/purpose_stage_matrix.v1.json +
# service_capabilities.v1.json). mock_service_selector_v1 ranks the first
# three (rank 1..3); the remaining three stay in the eligible pool
# unranked.
EXPECTED_POOL = [
    "music_playlist",
    "humming_karaoke",
    "quiz",
    "ranking_creation",
    "radio_style",
    "call_response_driving",
]


@pytest.fixture(autouse=True)
def isolate_proposal_runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path))
    yield


def _create_run_body(**overrides) -> dict:
    body = {
        "trigger_purpose": "inattentive_driving_prevention_recovery",
        "lifecycle_stage": "active_driving_content",
        "motion_state": "driving",
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


def _service_selected_run_log() -> ProposalRunLog:
    """Drive a run through create-run (mock packages) to ``service_selected``
    with ≥2 eligible candidates, then parse the resulting dict back into a
    ``ProposalRunLog`` for direct engine calls."""
    created = client.post("/api/proposal/runs", json=_create_run_body())
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["status"] == "service_selected"
    assert body["journey_state"]["active_service_id"] == "music_playlist"
    return ProposalRunLog(**body)


def _content_selected_run_log() -> ProposalRunLog:
    """Same fixture, then advance to ``content_selected`` (for the
    postpone/reject wrong-precondition tests)."""
    run_log = _service_selected_run_log()
    selected = client.post(
        f"/api/proposal/runs/{run_log.run_id}/select-service",
        json={"selected_service_id": "music_playlist"},
    )
    assert selected.status_code == 200, selected.text
    body = selected.json()
    assert body["status"] == "content_selected"
    return ProposalRunLog(**body)


def _apply(run_log: ProposalRunLog, action_type: JourneyActionType, now: str, payload: dict | None = None):
    action = JourneyAction(action_type=action_type, payload=payload or {})
    return apply_action(run_log, action, now=now)


def _advance(run_log: ProposalRunLog, action_type: JourneyActionType, now: str, payload: dict | None = None) -> ProposalRunLog:
    """Apply one action and fold the transition back into a new
    ``ProposalRunLog`` (mirrors what the router persists)."""
    transition = _apply(run_log, action_type, now, payload)
    assert transition.rejected is None, transition.rejected
    return run_log.model_copy(
        update={
            "events": [*run_log.events, *transition.events],
            "journey_state": transition.new_journey_state,
            "status": transition.new_status,
        }
    )


# ---------------------------------------------------------------------------
# reject
# ---------------------------------------------------------------------------


def test_reject_records_rejection_and_does_not_dead_end():
    run_log = _service_selected_run_log()

    transition = _apply(run_log, JourneyActionType.reject, now="2026-07-16T11:00:00Z")

    assert transition.rejected is None
    assert transition.new_status == ProposalRunStatus.service_selected
    js = transition.new_journey_state
    assert js.active_service_id is None
    assert "music_playlist" in js.rejected_service_ids

    event_types = [e.event_type for e in transition.events]
    assert event_types == [DiscreteEventType.SERVICE_REJECTED]
    assert transition.events[0].payload["rejected_service_id"] == "music_playlist"


def test_reject_from_wrong_status_is_rejected_no_op():
    run_log = _content_selected_run_log()

    transition = _apply(run_log, JourneyActionType.reject, now="2026-07-16T11:00:00Z")

    assert transition.rejected is not None
    assert transition.rejected.code == "invalid_precondition"
    assert transition.events == []
    assert transition.new_journey_state == run_log.journey_state
    assert transition.new_status == run_log.status


# ---------------------------------------------------------------------------
# choose_another
# ---------------------------------------------------------------------------


def test_choose_another_advances_to_next_eligible_non_rejected():
    run_log = _service_selected_run_log()

    transition = _apply(run_log, JourneyActionType.choose_another, now="2026-07-16T11:00:00Z")

    assert transition.rejected is None
    assert transition.new_status == ProposalRunStatus.service_selected
    assert transition.new_journey_state.active_service_id == "humming_karaoke"
    event_types = [e.event_type for e in transition.events]
    assert event_types == [DiscreteEventType.CHOOSE_ANOTHER, DiscreteEventType.SERVICE_SELECTED]
    assert transition.events[0].payload == {"selected_service_id": "humming_karaoke"}
    assert transition.events[1].payload == {"selected_service_id": "humming_karaoke", "rank": 2}


def test_reject_then_choose_another_skips_rejected():
    run_log = _service_selected_run_log()
    run_log = _advance(run_log, JourneyActionType.reject, now="2026-07-16T11:00:00Z")
    assert run_log.journey_state.active_service_id is None

    transition = _apply(run_log, JourneyActionType.choose_another, now="2026-07-16T11:01:00Z")

    assert transition.rejected is None
    assert transition.new_journey_state.active_service_id == "humming_karaoke"


def test_choose_another_from_wrong_status_is_rejected_no_op():
    run_log = _content_selected_run_log()

    transition = _apply(run_log, JourneyActionType.choose_another, now="2026-07-16T11:00:00Z")

    assert transition.rejected is not None
    assert transition.rejected.code == "invalid_precondition"
    assert transition.events == []


# ---------------------------------------------------------------------------
# request_more
# ---------------------------------------------------------------------------


def test_request_more_lists_remaining_eligible_no_new_evidence():
    run_log = _service_selected_run_log()
    baseline_evidence_count = len(run_log.evidence)

    transition = _apply(run_log, JourneyActionType.request_more, now="2026-07-16T11:00:00Z")

    assert transition.rejected is None
    assert transition.new_status == run_log.status
    assert transition.new_journey_state == run_log.journey_state
    event_types = [e.event_type for e in transition.events]
    assert event_types == [DiscreteEventType.REQUEST_MORE]
    assert transition.events[0].payload["remaining_candidate_ids"] == EXPECTED_POOL

    # request_more must not fabricate a new AlgorithmEvidence / score (no
    # selector re-invocation) -- the transition carries no evidence field at
    # all, and folding it back into the run log must not grow `.evidence`.
    folded = run_log.model_copy(
        update={
            "events": [*run_log.events, *transition.events],
            "journey_state": transition.new_journey_state,
            "status": transition.new_status,
        }
    )
    assert len(folded.evidence) == baseline_evidence_count


def test_request_more_excludes_already_rejected():
    run_log = _service_selected_run_log()
    run_log = _advance(run_log, JourneyActionType.reject, now="2026-07-16T11:00:00Z")

    transition = _apply(run_log, JourneyActionType.request_more, now="2026-07-16T11:01:00Z")

    assert transition.rejected is None
    remaining = transition.events[0].payload["remaining_candidate_ids"]
    assert "music_playlist" not in remaining
    assert remaining == EXPECTED_POOL[1:]


def test_request_more_from_wrong_status_is_rejected_no_op():
    run_log = _content_selected_run_log()

    transition = _apply(run_log, JourneyActionType.request_more, now="2026-07-16T11:00:00Z")

    assert transition.rejected is not None
    assert transition.rejected.code == "invalid_precondition"
    assert transition.events == []


# ---------------------------------------------------------------------------
# postpone
# ---------------------------------------------------------------------------


def test_postpone_from_service_selected_keeps_opportunity_open():
    run_log = _service_selected_run_log()

    transition = _apply(run_log, JourneyActionType.postpone, now="2026-07-16T11:00:00Z")

    assert transition.rejected is None
    assert transition.new_status == ProposalRunStatus.service_selected
    assert transition.new_journey_state.active_service_id == "music_playlist"
    event_types = [e.event_type for e in transition.events]
    assert event_types == [DiscreteEventType.POSTPONED]


def test_postpone_from_content_selected_reopens_opportunity():
    run_log = _content_selected_run_log()
    pre_active = run_log.journey_state.active_service_id

    transition = _apply(run_log, JourneyActionType.postpone, now="2026-07-16T11:00:00Z")

    assert transition.rejected is None
    assert transition.new_status == ProposalRunStatus.service_selected
    assert transition.new_journey_state.active_service_id == pre_active
    event_types = [e.event_type for e in transition.events]
    assert event_types == [DiscreteEventType.POSTPONED]


def test_postpone_from_created_is_rejected_no_op():
    run_log = _service_selected_run_log()
    run_log = run_log.model_copy(update={"status": ProposalRunStatus.created})

    transition = _apply(run_log, JourneyActionType.postpone, now="2026-07-16T11:00:00Z")

    assert transition.rejected is not None
    assert transition.rejected.code == "invalid_precondition"
    assert transition.events == []


# ---------------------------------------------------------------------------
# reject every eligible candidate -> explicit NO_ELIGIBLE_CANDIDATE
# (SC-005 / FR-013): the run never dead-ends/crashes.
# ---------------------------------------------------------------------------


def test_reject_every_eligible_candidate_ends_with_no_eligible_candidate():
    run_log = _service_selected_run_log()
    at = "2026-07-16T11:00:00Z"

    for i, expected_next in enumerate(EXPECTED_POOL):
        assert run_log.journey_state.active_service_id == expected_next
        transition = _apply(run_log, JourneyActionType.reject, now=at)
        assert transition.rejected is None, f"reject #{i} unexpectedly rejected"

        is_last = i == len(EXPECTED_POOL) - 1
        event_types = [e.event_type for e in transition.events]
        if is_last:
            assert event_types == [
                DiscreteEventType.SERVICE_REJECTED,
                DiscreteEventType.NO_ELIGIBLE_CANDIDATE,
            ]
        else:
            assert event_types == [DiscreteEventType.SERVICE_REJECTED]

        assert transition.new_status == ProposalRunStatus.service_selected
        assert transition.new_journey_state.active_service_id is None

        run_log = run_log.model_copy(
            update={
                "events": [*run_log.events, *transition.events],
                "journey_state": transition.new_journey_state,
                "status": transition.new_status,
            }
        )

        if not is_last:
            choose = _apply(run_log, JourneyActionType.choose_another, now=at)
            assert choose.rejected is None
            run_log = run_log.model_copy(
                update={
                    "events": [*run_log.events, *choose.events],
                    "journey_state": choose.new_journey_state,
                    "status": choose.new_status,
                }
            )

    # Final state: every candidate rejected, no crash, explicit success
    # end-state (never a 4xx/error).
    assert set(run_log.journey_state.rejected_service_ids) == set(EXPECTED_POOL)
    assert run_log.journey_state.active_service_id is None
    assert run_log.status == ProposalRunStatus.service_selected

    # And choose_another now has nothing left to switch to.
    final_choose = _apply(run_log, JourneyActionType.choose_another, now=at)
    assert final_choose.rejected is not None
    assert final_choose.rejected.code == "no_eligible_candidate"
