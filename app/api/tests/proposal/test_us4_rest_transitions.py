"""TDD (T027/T028): US4 — rest-stage transitions as pure journey events
(spec.md User Story 4; FR-015, FR-016; research.md D7).

Covers ``rest_spot_arrived`` / ``rest_started`` / ``rest_completed`` on the
PURE ``apply_action`` engine:

  - ``rest_spot_arrived`` (any run whose opportunity's ``trigger_purpose`` is
    ``rest_recommended``): motion -> `stopped`, lifecycle_stage ->
    `during_rest_stopped`, emits ``REST_SPOT_ARRIVED``.
  - ``rest_started`` (requires ``lifecycle_stage=during_rest_stopped``):
    emits ``REST_STARTED``, no other state change.
  - ``rest_completed`` (requires ``lifecycle_stage=during_rest_stopped``,
    payload ``{"post_rest": {"drowsiness_level": int, "fatigue_level":
    int}}``): lifecycle_stage -> `after_rest_before_restart`, emits
    ``REST_COMPLETED`` (carrying the applied post-rest values) THEN
    ``OPPORTUNITY_OPENED`` (event-level only -- no matrix/selector
    re-dispatch; that full re-proposal is P7, per research.md D7).
  - A missing/malformed ``post_rest`` is a structured ``invalid_payload``
    rejection (FR-012), never a raw KeyError/ValueError.
  - The five named during-rest actions (``rest_duration_suggestion`` /
    ``rest_method_suggestion`` / ``seat_adjustment`` / ``nap_guidance`` /
    ``rest_extension_check``) are never ``ServiceId`` members, never ranked
    candidates, and never appear in the ``OPPORTUNITY_OPENED`` event that
    ``rest_completed`` emits (FR-016).

``opportunity.lifecycle_stage`` (the FROZEN opening stage, e.g.
``before_rest_until_stop``) is distinct from ``journey_state.lifecycle_stage``
(evolves as the journey progresses) -- P1's matrix resolves an EMPTY
``allowed_service_ids`` for the ``during_rest_stopped`` OPPORTUNITY row
(opportunity.py's non-empty validator would reject creating a run AT that
stage), so every fixture here creates the run at ``before_rest_until_stop``
and then drives ``journey_state.lifecycle_stage`` into ``during_rest_stopped``
via ``rest_spot_arrived`` itself -- exactly the real reviewer flow.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app
from aica_api.models.proposal.enums import (
    DiscreteEventType,
    JourneyActionType,
    LifecycleStage,
    MotionState,
    ServiceId,
)
from aica_api.models.proposal.journey_action import JourneyAction
from aica_api.models.proposal.proposal_run import ProposalRunLog
from aica_api.services.proposal_journey import apply_action

client = TestClient(app)

_FIVE_NAMED_REST_ACTIONS = {
    "rest_duration_suggestion",
    "rest_method_suggestion",
    "seat_adjustment",
    "nap_guidance",
    "rest_extension_check",
}


@pytest.fixture(autouse=True)
def isolate_proposal_runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path))
    yield


def _create_run_body(**overrides) -> dict:
    body = {
        "trigger_purpose": "rest_recommended",
        "lifecycle_stage": "before_rest_until_stop",
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


def _rest_recommended_run_log() -> ProposalRunLog:
    created = client.post("/api/proposal/runs", json=_create_run_body())
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["opportunity"]["trigger_purpose"] == "rest_recommended"
    return ProposalRunLog(**body)


def _non_rest_run_log() -> ProposalRunLog:
    created = client.post(
        "/api/proposal/runs",
        json=_create_run_body(
            trigger_purpose="inattentive_driving_prevention_recovery",
            lifecycle_stage="active_driving_content",
            motion_state="driving",
        ),
    )
    assert created.status_code == 201, created.text
    return ProposalRunLog(**created.json())


def _apply(run_log: ProposalRunLog, action_type: JourneyActionType, now: str, payload: dict | None = None):
    action = JourneyAction(action_type=action_type, payload=payload or {})
    return apply_action(run_log, action, now=now)


def _advance(run_log: ProposalRunLog, action_type: JourneyActionType, now: str, payload: dict | None = None) -> ProposalRunLog:
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
# rest_spot_arrived
# ---------------------------------------------------------------------------


def test_rest_spot_arrived_sets_stopped_and_during_rest_stage():
    run_log = _rest_recommended_run_log()

    transition = _apply(run_log, JourneyActionType.rest_spot_arrived, now="2026-07-16T11:00:00Z")

    assert transition.rejected is None
    js = transition.new_journey_state
    assert js.motion_state == MotionState.stopped
    assert js.lifecycle_stage == LifecycleStage.during_rest_stopped
    assert transition.new_status == run_log.status
    event_types = [e.event_type for e in transition.events]
    assert event_types == [DiscreteEventType.REST_SPOT_ARRIVED]


def test_rest_spot_arrived_requires_rest_recommended_opportunity():
    run_log = _non_rest_run_log()

    transition = _apply(run_log, JourneyActionType.rest_spot_arrived, now="2026-07-16T11:00:00Z")

    assert transition.rejected is not None
    assert transition.rejected.code == "invalid_precondition"
    assert transition.events == []
    assert transition.new_journey_state == run_log.journey_state
    assert transition.new_status == run_log.status


# ---------------------------------------------------------------------------
# rest_started
# ---------------------------------------------------------------------------


def test_rest_started_after_rest_spot_arrived():
    run_log = _rest_recommended_run_log()
    run_log = _advance(run_log, JourneyActionType.rest_spot_arrived, now="2026-07-16T11:00:00Z")

    transition = _apply(run_log, JourneyActionType.rest_started, now="2026-07-16T11:05:00Z")

    assert transition.rejected is None
    assert transition.new_journey_state == run_log.journey_state  # no other state change
    event_types = [e.event_type for e in transition.events]
    assert event_types == [DiscreteEventType.REST_STARTED]


def test_rest_started_before_rest_spot_arrived_is_rejected():
    run_log = _rest_recommended_run_log()

    transition = _apply(run_log, JourneyActionType.rest_started, now="2026-07-16T11:00:00Z")

    assert transition.rejected is not None
    assert transition.rejected.code == "invalid_precondition"
    assert transition.events == []


# ---------------------------------------------------------------------------
# rest_completed
# ---------------------------------------------------------------------------


def test_rest_completed_applies_post_rest_values_and_opens_new_opportunity():
    run_log = _rest_recommended_run_log()
    run_log = _advance(run_log, JourneyActionType.rest_spot_arrived, now="2026-07-16T11:00:00Z")
    run_log = _advance(run_log, JourneyActionType.rest_started, now="2026-07-16T11:05:00Z")

    transition = _apply(
        run_log,
        JourneyActionType.rest_completed,
        now="2026-07-16T12:00:00Z",
        payload={"post_rest": {"drowsiness_level": 20, "fatigue_level": 30}},
    )

    assert transition.rejected is None
    js = transition.new_journey_state
    assert js.lifecycle_stage == LifecycleStage.after_rest_before_restart
    assert transition.new_status == run_log.status

    event_types = [e.event_type for e in transition.events]
    assert event_types == [
        DiscreteEventType.REST_COMPLETED,
        DiscreteEventType.OPPORTUNITY_OPENED,
    ]
    rest_completed_event, opened_event = transition.events
    assert rest_completed_event.payload == {"drowsiness_level": 20, "fatigue_level": 30}
    assert opened_event.payload["trigger_purpose"] == "rest_recommended"
    assert opened_event.payload["lifecycle_stage"] == "after_rest_before_restart"

    # No ranked-candidate/matrix-selector re-dispatch is fabricated at the
    # event level (research.md D7 / P4 scope) -- the opened event carries
    # only trigger_purpose/lifecycle_stage, nothing selector-shaped.
    assert set(opened_event.payload.keys()) == {"trigger_purpose", "lifecycle_stage"}
    assert len(transition.events) == 2


def test_rest_completed_before_during_rest_stopped_is_rejected():
    run_log = _rest_recommended_run_log()

    transition = _apply(
        run_log,
        JourneyActionType.rest_completed,
        now="2026-07-16T11:00:00Z",
        payload={"post_rest": {"drowsiness_level": 20, "fatigue_level": 30}},
    )

    assert transition.rejected is not None
    assert transition.rejected.code == "invalid_precondition"
    assert transition.events == []


def test_rest_completed_without_post_rest_is_rejected():
    run_log = _rest_recommended_run_log()
    run_log = _advance(run_log, JourneyActionType.rest_spot_arrived, now="2026-07-16T11:00:00Z")

    transition = _apply(run_log, JourneyActionType.rest_completed, now="2026-07-16T11:05:00Z")

    assert transition.rejected is not None
    assert transition.rejected.code == "invalid_payload"
    assert transition.events == []
    assert transition.new_journey_state == run_log.journey_state
    assert transition.new_status == run_log.status


@pytest.mark.parametrize(
    "post_rest",
    [
        {"drowsiness_level": 20},  # fatigue_level missing
        {"fatigue_level": 30},  # drowsiness_level missing
        {"drowsiness_level": "high", "fatigue_level": 30},  # non-int
        {"drowsiness_level": 20, "fatigue_level": 150},  # out of 0..100
        {"drowsiness_level": -1, "fatigue_level": 30},  # out of 0..100
        {"drowsiness_level": True, "fatigue_level": 30},  # bool, not a real int level
    ],
)
def test_rest_completed_with_malformed_post_rest_is_rejected(post_rest):
    run_log = _rest_recommended_run_log()
    run_log = _advance(run_log, JourneyActionType.rest_spot_arrived, now="2026-07-16T11:00:00Z")

    transition = _apply(
        run_log,
        JourneyActionType.rest_completed,
        now="2026-07-16T11:05:00Z",
        payload={"post_rest": post_rest},
    )

    assert transition.rejected is not None
    assert transition.rejected.code == "invalid_payload"
    assert transition.events == []


def test_rest_completed_endpoint_returns_422_never_500():
    """The router endpoint must never turn a malformed rest_completed
    payload into an unhandled 500 (FR-012) -- it's a structured 422. Drive a
    run through the REAL endpoints to reach during_rest_stopped, then hit
    rest_completed with a malformed payload via HTTP."""
    created = client.post("/api/proposal/runs", json=_create_run_body())
    run_id = created.json()["run_id"]
    arrived = client.post(
        f"/api/proposal/runs/{run_id}/journey/action",
        json={"action_type": "rest_spot_arrived", "payload": {}},
    )
    assert arrived.status_code == 200, arrived.text

    response = client.post(
        f"/api/proposal/runs/{run_id}/journey/action",
        json={"action_type": "rest_completed", "payload": {"post_rest": {"drowsiness_level": 20}}},
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_payload"


# ---------------------------------------------------------------------------
# FR-016 -- the five named during-rest actions are never ServiceIds/ranked
# candidates.
# ---------------------------------------------------------------------------


def test_five_named_rest_actions_are_never_service_ids_or_journey_action_types():
    service_id_values = {sid.value for sid in ServiceId}
    assert _FIVE_NAMED_REST_ACTIONS.isdisjoint(service_id_values)

    journey_action_values = {a.value for a in JourneyActionType}
    assert _FIVE_NAMED_REST_ACTIONS.isdisjoint(journey_action_values)
