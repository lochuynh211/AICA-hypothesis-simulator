"""TDD: DiscreteEvent / JourneyState / AlgorithmEvidence — T008 (shapes only).

Authoritative field spec: data-model.md §"DiscreteEvent", §"JourneyState",
§"AlgorithmEvidence". No engine/progression logic in P1 — these are pure
data shapes.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from aica_api.models.proposal.enums import (
    DiscreteEventType,
    LifecycleStage,
    MotionState,
    ServiceId,
)
from aica_api.models.proposal.events import DiscreteEvent
from aica_api.models.proposal.evidence import AlgorithmEvidence, EvidenceError
from aica_api.models.proposal.journey import JourneyState


# ---------------------------------------------------------------------------
# DiscreteEvent
# ---------------------------------------------------------------------------


class TestDiscreteEvent:
    def test_valid_event(self):
        ev = DiscreteEvent(
            event_type="OPPORTUNITY_OPENED",
            at="2026-07-16T10:00:00Z",
            payload={"opportunity_id": "op-001"},
        )
        assert ev.event_type == DiscreteEventType.OPPORTUNITY_OPENED
        assert ev.at == "2026-07-16T10:00:00Z"
        assert ev.payload == {"opportunity_id": "op-001"}

    def test_integer_at_accepted(self):
        ev = DiscreteEvent(event_type="SERVICE_SELECTED", at=1234567890, payload={})
        assert ev.at == 1234567890

    def test_invalid_event_type_rejected(self):
        with pytest.raises(ValidationError):
            DiscreteEvent(event_type="NOT_A_REAL_EVENT", at=1, payload={})

    def test_algorithm_error_event_type(self):
        ev = DiscreteEvent(event_type="ALGORITHM_ERROR", at=1, payload={"category": "raised_exception"})
        assert ev.event_type == DiscreteEventType.ALGORITHM_ERROR


# ---------------------------------------------------------------------------
# JourneyState
# ---------------------------------------------------------------------------


class TestJourneyState:
    def test_valid_state(self):
        js = JourneyState(
            lifecycle_stage="before_rest_until_stop",
            motion_state="driving",
            active_service_id="music_playlist",
            active_plan_id="plan-001",
        )
        assert js.lifecycle_stage == LifecycleStage.before_rest_until_stop
        assert js.motion_state == MotionState.driving
        assert js.active_service_id == ServiceId.music_playlist
        assert js.active_plan_id == "plan-001"

    def test_none_active_fields_accepted(self):
        js = JourneyState(
            lifecycle_stage="active_driving_content",
            motion_state="driving",
            active_service_id=None,
            active_plan_id=None,
        )
        assert js.active_service_id is None
        assert js.active_plan_id is None

    def test_invalid_motion_state_rejected(self):
        with pytest.raises(ValidationError):
            JourneyState(
                lifecycle_stage="active_driving_content",
                motion_state="parked",
                active_service_id=None,
                active_plan_id=None,
            )


# ---------------------------------------------------------------------------
# AlgorithmEvidence
# ---------------------------------------------------------------------------


class TestAlgorithmEvidence:
    def _base_kwargs(self, **overrides) -> dict:
        base = {
            "step": "service",
            "package_id": "mock_service_selector_v1",
            "contract_version": "1.0.0",
            "schema_version": "1.0.0",
            "matrix_version": "v1",
            "input_snapshot": {"trigger_purpose": "rest_recommended"},
            "output": {"decision_type": "ranked_candidates"},
            "error": None,
            "used_feature_ids": ["drowsiness_level"],
            "unused_available_features": [],
            "missing_features": [],
        }
        base.update(overrides)
        return base

    def test_valid_evidence_service_step(self):
        ev = AlgorithmEvidence(**self._base_kwargs())
        assert ev.step == "service"
        assert ev.output == {"decision_type": "ranked_candidates"}
        assert ev.error is None

    def test_valid_evidence_content_step(self):
        ev = AlgorithmEvidence(**self._base_kwargs(step="content", package_id="mock_content_selector_v1"))
        assert ev.step == "content"

    def test_invalid_step_rejected(self):
        with pytest.raises(ValidationError):
            AlgorithmEvidence(**self._base_kwargs(step="not_a_step"))

    def test_output_none_accepted(self):
        ev = AlgorithmEvidence(**self._base_kwargs(output=None))
        assert ev.output is None

    def test_error_populated(self):
        ev = AlgorithmEvidence(
            **self._base_kwargs(
                output=None,
                error={"category": "raised_exception", "message": "boom"},
            )
        )
        assert ev.error == EvidenceError(category="raised_exception", message="boom")
        assert ev.error.category == "raised_exception"
        assert ev.error.message == "boom"
