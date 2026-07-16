"""TDD: Common selector input contract (C1) — T007 RED → T009 GREEN.

Phase 3 / US1. Tests:
- Valid content-variant input accepted.
- Incompatible purpose/stage rejected.
- Empty allowed_service_ids rejected.
- Wrong enum rejected.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from aica_api.models.proposal.enums import (
    TriggerPurpose,
    LifecycleStage,
    ServiceId,
    FeatureOriginProvenance,
)
from aica_api.models.proposal.selector_input import (
    SelectorInput,
    FeatureProvenanceEntry,
    CandidateRef,
    ExcludedCandidate,
)

# ---------------------------------------------------------------------------
# Shared minimal valid payload (content variant)
# ---------------------------------------------------------------------------

VALID_PROVENANCE_ENTRY = {
    "feature_origin": "cdc_su_baseline",
    "source_reference": "spec §5.3",
}

VALID_PAYLOAD: dict = {
    "contract_version": "1.0.0",
    "opportunity_id": "op-001",
    "simulation_time": "2024-01-01T00:00:00",
    "trigger_purpose": "rest_recommended",
    "lifecycle_stage": "before_rest_until_stop",
    "allowed_service_ids": ["music_playlist"],
    "feature_snapshot": {"driver_state": "awake"},
    "feature_provenance": {
        "driver_state": VALID_PROVENANCE_ENTRY,
    },
    "enabled_feature_extensions": [],
    "selected_service_id": "music_playlist",
    "eligible_candidates": [{"candidate_id": "music_playlist"}],
    "excluded_candidates": [],
    "parameters": {},
    "hyperparameters": {},
    "package_runtime_state": {},
    "catalog_version": "v1",
    "run_seed": "seed-abc",
}


# ---------------------------------------------------------------------------
# C1.1 — Valid content-variant input accepted
# ---------------------------------------------------------------------------

class TestValidInput:
    def test_valid_content_variant_accepted(self):
        obj = SelectorInput(**VALID_PAYLOAD)
        assert obj.opportunity_id == "op-001"
        assert obj.trigger_purpose == TriggerPurpose.rest_recommended
        assert obj.lifecycle_stage == LifecycleStage.before_rest_until_stop
        assert len(obj.allowed_service_ids) == 1

    def test_selected_service_id_optional(self):
        payload = {**VALID_PAYLOAD, "selected_service_id": None}
        obj = SelectorInput(**payload)
        assert obj.selected_service_id is None

    def test_integer_simulation_time_accepted(self):
        payload = {**VALID_PAYLOAD, "simulation_time": 1234567890}
        obj = SelectorInput(**payload)
        assert obj.simulation_time == 1234567890

    def test_active_driving_stage_with_route_music(self):
        """active_driving_content is compatible with route_music."""
        payload = {
            **VALID_PAYLOAD,
            "trigger_purpose": "route_music",
            "lifecycle_stage": "active_driving_content",
        }
        obj = SelectorInput(**payload)
        assert obj.lifecycle_stage == LifecycleStage.active_driving_content

    def test_active_driving_stage_with_inattentive(self):
        """active_driving_content is compatible with inattentive_driving_prevention_recovery."""
        payload = {
            **VALID_PAYLOAD,
            "trigger_purpose": "inattentive_driving_prevention_recovery",
            "lifecycle_stage": "active_driving_content",
        }
        obj = SelectorInput(**payload)
        assert obj.lifecycle_stage == LifecycleStage.active_driving_content

    def test_active_driving_stage_with_child(self):
        """active_driving_content is compatible with child_passenger_experience."""
        payload = {
            **VALID_PAYLOAD,
            "trigger_purpose": "child_passenger_experience",
            "lifecycle_stage": "active_driving_content",
        }
        obj = SelectorInput(**payload)
        assert obj.lifecycle_stage == LifecycleStage.active_driving_content

    def test_all_three_rest_stages_with_rest_recommended(self):
        """before_rest_until_stop, during_rest_stopped, after_rest_before_restart only with rest_recommended."""
        for stage in [
            "before_rest_until_stop",
            "during_rest_stopped",
            "after_rest_before_restart",
        ]:
            payload = {
                **VALID_PAYLOAD,
                "trigger_purpose": "rest_recommended",
                "lifecycle_stage": stage,
            }
            obj = SelectorInput(**payload)
            assert obj.lifecycle_stage.value == stage


# ---------------------------------------------------------------------------
# C1.2 — Incompatible purpose/stage rejected
# ---------------------------------------------------------------------------

class TestPurposeStageIncompatibility:
    def test_rest_stage_with_route_music_rejected(self):
        """before_rest_until_stop must not be used with route_music."""
        payload = {
            **VALID_PAYLOAD,
            "trigger_purpose": "route_music",
            "lifecycle_stage": "before_rest_until_stop",
        }
        with pytest.raises(ValidationError) as exc_info:
            SelectorInput(**payload)
        errors = exc_info.value.errors()
        assert len(errors) >= 1

    def test_rest_stage_with_inattentive_rejected(self):
        """during_rest_stopped must not be used with inattentive_driving."""
        payload = {
            **VALID_PAYLOAD,
            "trigger_purpose": "inattentive_driving_prevention_recovery",
            "lifecycle_stage": "during_rest_stopped",
        }
        with pytest.raises(ValidationError) as exc_info:
            SelectorInput(**payload)
        errors = exc_info.value.errors()
        assert len(errors) >= 1

    def test_rest_stage_with_child_rejected(self):
        """after_rest_before_restart must not be used with child_passenger_experience."""
        payload = {
            **VALID_PAYLOAD,
            "trigger_purpose": "child_passenger_experience",
            "lifecycle_stage": "after_rest_before_restart",
        }
        with pytest.raises(ValidationError) as exc_info:
            SelectorInput(**payload)
        errors = exc_info.value.errors()
        assert len(errors) >= 1

    def test_active_driving_with_rest_recommended_rejected(self):
        """active_driving_content must NOT be used with rest_recommended."""
        payload = {
            **VALID_PAYLOAD,
            "trigger_purpose": "rest_recommended",
            "lifecycle_stage": "active_driving_content",
        }
        with pytest.raises(ValidationError) as exc_info:
            SelectorInput(**payload)
        errors = exc_info.value.errors()
        assert len(errors) >= 1


# ---------------------------------------------------------------------------
# C1.3 — Empty allowed_service_ids rejected
# ---------------------------------------------------------------------------

class TestAllowedServiceIdsNonEmpty:
    def test_empty_list_rejected(self):
        payload = {**VALID_PAYLOAD, "allowed_service_ids": []}
        with pytest.raises(ValidationError) as exc_info:
            SelectorInput(**payload)
        errors = exc_info.value.errors()
        assert len(errors) >= 1

    def test_single_item_accepted(self):
        payload = {**VALID_PAYLOAD, "allowed_service_ids": ["music_playlist"]}
        obj = SelectorInput(**payload)
        assert len(obj.allowed_service_ids) == 1

    def test_multiple_items_accepted(self):
        payload = {
            **VALID_PAYLOAD,
            "allowed_service_ids": ["music_playlist", "humming_karaoke"],
        }
        obj = SelectorInput(**payload)
        assert len(obj.allowed_service_ids) == 2


# ---------------------------------------------------------------------------
# C1.4 — Wrong enum rejected
# ---------------------------------------------------------------------------

class TestWrongEnumRejected:
    def test_invalid_trigger_purpose_rejected(self):
        payload = {**VALID_PAYLOAD, "trigger_purpose": "not_a_valid_purpose"}
        with pytest.raises(ValidationError):
            SelectorInput(**payload)

    def test_invalid_lifecycle_stage_rejected(self):
        payload = {**VALID_PAYLOAD, "lifecycle_stage": "driving_on_highway"}
        with pytest.raises(ValidationError):
            SelectorInput(**payload)

    def test_invalid_service_id_in_allowed_rejected(self):
        payload = {**VALID_PAYLOAD, "allowed_service_ids": ["unknown_service"]}
        with pytest.raises(ValidationError):
            SelectorInput(**payload)

    def test_invalid_selected_service_id_rejected(self):
        payload = {**VALID_PAYLOAD, "selected_service_id": "not_a_service"}
        with pytest.raises(ValidationError):
            SelectorInput(**payload)


# ---------------------------------------------------------------------------
# FeatureProvenanceEntry, CandidateRef, ExcludedCandidate — basic shape
# ---------------------------------------------------------------------------

class TestHelperModels:
    def test_feature_provenance_entry(self):
        entry = FeatureProvenanceEntry(
            feature_origin=FeatureOriginProvenance.cdc_su_baseline,
            source_reference="spec §5.3",
        )
        assert entry.feature_origin == FeatureOriginProvenance.cdc_su_baseline

    def test_candidate_ref_service_id(self):
        ref = CandidateRef(candidate_id=ServiceId.music_playlist)
        assert ref.candidate_id == ServiceId.music_playlist

    def test_candidate_ref_string_id(self):
        ref = CandidateRef(candidate_id="track-synthetic-001")
        assert ref.candidate_id == "track-synthetic-001"

    def test_excluded_candidate(self):
        exc = ExcludedCandidate(
            candidate_id="track-001",
            platform_reason="not licensed in region",
        )
        assert exc.platform_reason == "not licensed in region"
