"""TDD: ProposalOpportunity contract — T006.

Authoritative field spec: data-model.md §"ProposalOpportunity".

Covers:
- Valid opportunity accepted (no UI/tick fields present on the model).
- Purpose/stage compatibility validator (mirrors SelectorInput's rule):
  rest stages only with rest_recommended; active_driving_content only with
  the three non-rest purposes.
- allowed_service_ids non-empty validator — including the EXPECTED rejection
  of a `during_rest_stopped` opportunity, whose matrix-resolved allowed set
  is empty in P1 (spec note: P1 never actually creates such an opportunity).
- opportunity_id required/non-empty.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from aica_api.models.proposal.enums import LifecycleStage, ServiceId, TriggerPurpose
from aica_api.models.proposal.opportunity import ProposalOpportunity

VALID_PAYLOAD: dict = {
    "opportunity_id": "op-001",
    "trigger_purpose": "rest_recommended",
    "lifecycle_stage": "before_rest_until_stop",
    "allowed_service_ids": ["music_playlist", "humming_karaoke"],
    "simulation_time": "2024-01-01T00:00:00",
    "run_seed": "seed-abc",
}


# ---------------------------------------------------------------------------
# Valid opportunity accepted
# ---------------------------------------------------------------------------


class TestValidOpportunity:
    def test_valid_payload_accepted(self):
        obj = ProposalOpportunity(**VALID_PAYLOAD)
        assert obj.opportunity_id == "op-001"
        assert obj.trigger_purpose == TriggerPurpose.rest_recommended
        assert obj.lifecycle_stage == LifecycleStage.before_rest_until_stop
        assert obj.allowed_service_ids == [ServiceId.music_playlist, ServiceId.humming_karaoke]
        assert obj.simulation_time == "2024-01-01T00:00:00"
        assert obj.run_seed == "seed-abc"

    def test_integer_simulation_time_accepted(self):
        payload = {**VALID_PAYLOAD, "simulation_time": 1234567890}
        obj = ProposalOpportunity(**payload)
        assert obj.simulation_time == 1234567890

    def test_no_ui_or_tick_fields(self):
        """The model must carry only the neutral start-of-proposal fields —
        no UI state, no tick/engine-coupled fields."""
        obj = ProposalOpportunity(**VALID_PAYLOAD)
        allowed_fields = {
            "opportunity_id",
            "trigger_purpose",
            "lifecycle_stage",
            "allowed_service_ids",
            "simulation_time",
            "run_seed",
        }
        assert set(type(obj).model_fields.keys()) == allowed_fields

    def test_after_rest_before_restart_with_rest_recommended(self):
        payload = {
            **VALID_PAYLOAD,
            "lifecycle_stage": "after_rest_before_restart",
            "allowed_service_ids": [
                "live_viewing",
                "stretch_video",
                "full_karaoke",
                "oshi_reexperience",
                "call_response_stopped",
            ],
        }
        obj = ProposalOpportunity(**payload)
        assert obj.lifecycle_stage == LifecycleStage.after_rest_before_restart

    def test_active_driving_content_with_route_music(self):
        payload = {
            **VALID_PAYLOAD,
            "trigger_purpose": "route_music",
            "lifecycle_stage": "active_driving_content",
        }
        obj = ProposalOpportunity(**payload)
        assert obj.lifecycle_stage == LifecycleStage.active_driving_content

    def test_active_driving_content_with_inattentive(self):
        payload = {
            **VALID_PAYLOAD,
            "trigger_purpose": "inattentive_driving_prevention_recovery",
            "lifecycle_stage": "active_driving_content",
        }
        obj = ProposalOpportunity(**payload)
        assert obj.lifecycle_stage == LifecycleStage.active_driving_content

    def test_active_driving_content_with_child(self):
        payload = {
            **VALID_PAYLOAD,
            "trigger_purpose": "child_passenger_experience",
            "lifecycle_stage": "active_driving_content",
        }
        obj = ProposalOpportunity(**payload)
        assert obj.lifecycle_stage == LifecycleStage.active_driving_content


# ---------------------------------------------------------------------------
# Purpose/stage compatibility validator — each rejection case
# ---------------------------------------------------------------------------


class TestPurposeStageIncompatibility:
    def test_rest_stage_with_route_music_rejected(self):
        payload = {
            **VALID_PAYLOAD,
            "trigger_purpose": "route_music",
            "lifecycle_stage": "before_rest_until_stop",
        }
        with pytest.raises(ValidationError):
            ProposalOpportunity(**payload)

    def test_rest_stage_with_inattentive_rejected(self):
        payload = {
            **VALID_PAYLOAD,
            "trigger_purpose": "inattentive_driving_prevention_recovery",
            "lifecycle_stage": "during_rest_stopped",
            "allowed_service_ids": ["music_playlist"],
        }
        with pytest.raises(ValidationError):
            ProposalOpportunity(**payload)

    def test_rest_stage_with_child_rejected(self):
        payload = {
            **VALID_PAYLOAD,
            "trigger_purpose": "child_passenger_experience",
            "lifecycle_stage": "after_rest_before_restart",
            "allowed_service_ids": ["live_viewing"],
        }
        with pytest.raises(ValidationError):
            ProposalOpportunity(**payload)

    def test_active_driving_content_with_rest_recommended_rejected(self):
        payload = {
            **VALID_PAYLOAD,
            "trigger_purpose": "rest_recommended",
            "lifecycle_stage": "active_driving_content",
        }
        with pytest.raises(ValidationError):
            ProposalOpportunity(**payload)


# ---------------------------------------------------------------------------
# allowed_service_ids non-empty validator
# ---------------------------------------------------------------------------


class TestAllowedServiceIdsNonEmpty:
    def test_empty_list_rejected(self):
        payload = {**VALID_PAYLOAD, "allowed_service_ids": []}
        with pytest.raises(ValidationError):
            ProposalOpportunity(**payload)

    def test_during_rest_stopped_rejected_as_expected(self):
        """P1's matrix resolves an EMPTY allowed set for during_rest_stopped
        (journey-engine-owned rest actions, no ServiceId members). Such an
        opportunity fails the non-empty validator — EXPECTED, because P1 never
        actually constructs a during_rest_stopped opportunity."""
        payload = {
            **VALID_PAYLOAD,
            "trigger_purpose": "rest_recommended",
            "lifecycle_stage": "during_rest_stopped",
            "allowed_service_ids": [],
        }
        with pytest.raises(ValidationError):
            ProposalOpportunity(**payload)

    def test_single_item_accepted(self):
        payload = {**VALID_PAYLOAD, "allowed_service_ids": ["music_playlist"]}
        obj = ProposalOpportunity(**payload)
        assert len(obj.allowed_service_ids) == 1


# ---------------------------------------------------------------------------
# opportunity_id required / non-empty
# ---------------------------------------------------------------------------


class TestOpportunityIdRequired:
    def test_missing_opportunity_id_rejected(self):
        payload = {k: v for k, v in VALID_PAYLOAD.items() if k != "opportunity_id"}
        with pytest.raises(ValidationError):
            ProposalOpportunity(**payload)

    def test_empty_opportunity_id_rejected(self):
        payload = {**VALID_PAYLOAD, "opportunity_id": ""}
        with pytest.raises(ValidationError):
            ProposalOpportunity(**payload)


# ---------------------------------------------------------------------------
# Wrong enum rejected
# ---------------------------------------------------------------------------


class TestWrongEnumRejected:
    def test_invalid_trigger_purpose_rejected(self):
        payload = {**VALID_PAYLOAD, "trigger_purpose": "not_a_valid_purpose"}
        with pytest.raises(ValidationError):
            ProposalOpportunity(**payload)

    def test_invalid_lifecycle_stage_rejected(self):
        payload = {**VALID_PAYLOAD, "lifecycle_stage": "driving_on_highway"}
        with pytest.raises(ValidationError):
            ProposalOpportunity(**payload)

    def test_invalid_service_id_in_allowed_rejected(self):
        payload = {**VALID_PAYLOAD, "allowed_service_ids": ["unknown_service"]}
        with pytest.raises(ValidationError):
            ProposalOpportunity(**payload)
