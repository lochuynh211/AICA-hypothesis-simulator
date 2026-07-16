"""TDD (T024): FR-007 -- ``trigger_purpose``/``lifecycle_stage`` are
control/routing inputs ONLY; they never become a preference/utility feature
score.

This pins the requirement across a full sequence of US1..US3 journey
actions: ``trigger_purpose``/``lifecycle_stage`` gate which matrix row /
eligibility applied and appear on the opportunity + event payloads as plain
control fields, but they NEVER appear as a ``feature_id`` inside any ranked
candidate's ``feature_contributions`` (the scored-feature breakdown) --
and, since US3's advisory actions (reject/choose_another/request_more/
postpone) add NO new ``AlgorithmEvidence`` at all (no re-scoring, per
FR-011), the evidence list's score shape cannot change across the sequence
either.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app
from aica_api.models.proposal.enums import (
    DiscreteEventType,
    JourneyActionType,
    LifecycleStage,
    TriggerPurpose,
)
from aica_api.models.proposal.journey_action import JourneyAction
from aica_api.models.proposal.proposal_run import ProposalRunLog
from aica_api.services.proposal_journey import apply_action

client = TestClient(app)

_CONTROL_FIELDS = {"trigger_purpose", "lifecycle_stage"}


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
    created = client.post("/api/proposal/runs", json=_create_run_body())
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["status"] == "service_selected"
    return ProposalRunLog(**body)


def _advance(run_log: ProposalRunLog, action_type: JourneyActionType, now: str) -> ProposalRunLog:
    action = JourneyAction(action_type=action_type, payload={})
    transition = apply_action(run_log, action, now=now)
    assert transition.rejected is None, transition.rejected
    return run_log.model_copy(
        update={
            "events": [*run_log.events, *transition.events],
            "journey_state": transition.new_journey_state,
            "status": transition.new_status,
        }
    )


def _assert_no_scored_control_fields(run_log: ProposalRunLog) -> None:
    """No `feature_contributions`/scored feature entry anywhere in the run's
    evidence is keyed by a control field."""
    for evidence in run_log.evidence:
        output = evidence.output or {}
        for candidate in output.get("ranked_candidates", []):
            feature_ids = {row["feature_id"] for row in candidate.get("feature_contributions", [])}
            assert not (feature_ids & _CONTROL_FIELDS), (
                f"control field leaked into feature_contributions: {feature_ids & _CONTROL_FIELDS}"
            )
        # `used_feature_ids`/`unused_available_features`/`missing_features`
        # are the OTHER places a scored-feature identity could leak in.
        assert not (set(evidence.used_feature_ids) & _CONTROL_FIELDS)
        assert not (set(evidence.unused_available_features) & _CONTROL_FIELDS)
        assert not (set(evidence.missing_features) & _CONTROL_FIELDS)


def test_control_fields_gate_the_run_but_never_score_a_candidate():
    run_log = _service_selected_run_log()

    # Control/routing use: they gate which matrix row / eligible set applied.
    assert run_log.opportunity.trigger_purpose == TriggerPurpose.inattentive_driving_prevention_recovery
    assert run_log.opportunity.lifecycle_stage == LifecycleStage.active_driving_content

    opened = next(e for e in run_log.events if e.event_type == DiscreteEventType.OPPORTUNITY_OPENED)
    assert opened.payload["trigger_purpose"] == "inattentive_driving_prevention_recovery"
    assert opened.payload["lifecycle_stage"] == "active_driving_content"

    baseline_evidence_count = len(run_log.evidence)
    _assert_no_scored_control_fields(run_log)

    # Drive a full US3 advisory-action sequence -- none of it may add a new
    # AlgorithmEvidence (no re-scoring) or introduce a scored control field.
    run_log = _advance(run_log, JourneyActionType.reject, now="2026-07-16T11:00:00Z")
    run_log = _advance(run_log, JourneyActionType.choose_another, now="2026-07-16T11:01:00Z")
    run_log = _advance(run_log, JourneyActionType.request_more, now="2026-07-16T11:02:00Z")
    run_log = _advance(run_log, JourneyActionType.postpone, now="2026-07-16T11:03:00Z")

    assert len(run_log.evidence) == baseline_evidence_count
    _assert_no_scored_control_fields(run_log)

    # And the journey-action event payloads themselves never carry a control
    # field as if it were a per-candidate score row.
    for event in run_log.events:
        if event.event_type in (
            DiscreteEventType.SERVICE_REJECTED,
            DiscreteEventType.CHOOSE_ANOTHER,
            DiscreteEventType.SERVICE_SELECTED,
            DiscreteEventType.REQUEST_MORE,
            DiscreteEventType.POSTPONED,
        ):
            assert not (set(event.payload.keys()) & _CONTROL_FIELDS)
