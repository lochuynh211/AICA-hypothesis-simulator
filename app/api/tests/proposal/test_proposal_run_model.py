"""TDD: ProposalRun / ProposalRunLog — T009 (append-only shape; required fields).

Authoritative field spec: data-model.md §"ProposalRun / ProposalRunLog".
The models here only hold the shape — append-only usage is enforced by the
run manager (T017), not by these models.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from aica_api.models.proposal.enums import ProposalRunStatus
from aica_api.models.proposal.events import DiscreteEvent
from aica_api.models.proposal.evidence import AlgorithmEvidence
from aica_api.models.proposal.journey import JourneyState
from aica_api.models.proposal.opportunity import ProposalOpportunity
from aica_api.models.proposal.proposal_run import ProposalRun, ProposalRunLog

VALID_OPPORTUNITY: dict = {
    "opportunity_id": "op-001",
    "trigger_purpose": "rest_recommended",
    "lifecycle_stage": "before_rest_until_stop",
    "allowed_service_ids": ["music_playlist"],
    "simulation_time": "2026-07-16T10:00:00Z",
    "run_seed": "seed-abc",
}

VALID_JOURNEY_STATE: dict = {
    "lifecycle_stage": "before_rest_until_stop",
    "motion_state": "driving",
    "active_service_id": None,
    "active_plan_id": None,
}


# ---------------------------------------------------------------------------
# ProposalRun — summary
# ---------------------------------------------------------------------------


class TestProposalRun:
    def test_valid_run_summary(self):
        run = ProposalRun(
            run_id="prun_20260716-100000_abc123",
            status="created",
            opportunity_id="op-001",
            created_at="2026-07-16T10:00:00Z",
            service_package_id="mock_service_selector_v1",
            content_package_id=None,
        )
        assert run.run_id == "prun_20260716-100000_abc123"
        assert run.status == ProposalRunStatus.created
        assert run.content_package_id is None

    def test_content_package_id_populated(self):
        run = ProposalRun(
            run_id="prun_20260716-100000_abc123",
            status="content_selected",
            opportunity_id="op-001",
            created_at="2026-07-16T10:00:00Z",
            service_package_id="mock_service_selector_v1",
            content_package_id="mock_content_selector_v1",
        )
        assert run.content_package_id == "mock_content_selector_v1"

    def test_invalid_status_rejected(self):
        with pytest.raises(ValidationError):
            ProposalRun(
                run_id="prun_x",
                status="not_a_status",
                opportunity_id="op-001",
                created_at="2026-07-16T10:00:00Z",
                service_package_id="mock_service_selector_v1",
                content_package_id=None,
            )

    def test_missing_required_field_rejected(self):
        with pytest.raises(ValidationError):
            ProposalRun(
                status="created",
                opportunity_id="op-001",
                created_at="2026-07-16T10:00:00Z",
                service_package_id="mock_service_selector_v1",
                content_package_id=None,
            )


# ---------------------------------------------------------------------------
# ProposalRunLog — full append-only shape
# ---------------------------------------------------------------------------


class TestProposalRunLog:
    def _base_kwargs(self, **overrides) -> dict:
        base = {
            "run_id": "prun_20260716-100000_abc123",
            "created_at": "2026-07-16T10:00:00Z",
            "opportunity": VALID_OPPORTUNITY,
            "matrix_version": "v1",
            "world_snapshot": {"drowsiness_level": "high"},
            "service_package_id": "mock_service_selector_v1",
            "content_package_id": None,
            "parameters": {},
            "hyperparameters": {},
            "journey_state": VALID_JOURNEY_STATE,
            "events": [],
            "evidence": [],
            "status": "created",
        }
        base.update(overrides)
        return base

    def test_valid_empty_log(self):
        log = ProposalRunLog(**self._base_kwargs())
        assert log.run_id == "prun_20260716-100000_abc123"
        assert isinstance(log.opportunity, ProposalOpportunity)
        assert isinstance(log.journey_state, JourneyState)
        assert log.events == []
        assert log.evidence == []
        assert log.status == ProposalRunStatus.created

    def test_log_with_events_and_evidence(self):
        event = DiscreteEvent(
            event_type="OPPORTUNITY_OPENED", at="2026-07-16T10:00:00Z", payload={}
        )
        ev = AlgorithmEvidence(
            step="service",
            package_id="mock_service_selector_v1",
            contract_version="1.0.0",
            schema_version="1.0.0",
            matrix_version="v1",
            input_snapshot={},
            output={"decision_type": "ranked_candidates"},
            error=None,
            used_feature_ids=[],
            unused_available_features=[],
            missing_features=[],
        )
        log = ProposalRunLog(**self._base_kwargs(events=[event], evidence=[ev]))
        assert len(log.events) == 1
        assert len(log.evidence) == 1

    def test_content_package_id_populated(self):
        log = ProposalRunLog(
            **self._base_kwargs(
                content_package_id="mock_content_selector_v1", status="content_selected"
            )
        )
        assert log.content_package_id == "mock_content_selector_v1"
        assert log.status == ProposalRunStatus.content_selected

    def test_missing_required_field_rejected(self):
        kwargs = self._base_kwargs()
        del kwargs["opportunity"]
        with pytest.raises(ValidationError):
            ProposalRunLog(**kwargs)

    def test_invalid_nested_opportunity_rejected(self):
        kwargs = self._base_kwargs(opportunity={**VALID_OPPORTUNITY, "allowed_service_ids": []})
        with pytest.raises(ValidationError):
            ProposalRunLog(**kwargs)
