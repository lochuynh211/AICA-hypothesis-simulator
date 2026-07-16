"""TDD: Content-selector output contract (C2) — T008 RED → T010 GREEN.

Phase 3 / US1. Tests:
- Valid transparent CompletePlan accepted.
- LLM-shaped plan (item_fit=None, empty feature_contributions) accepted.
- Unknown decision type rejected.
- No plan_score/aggregate_score/plan_fit field anywhere in CompletePlan or nested models.
"""
from __future__ import annotations

import inspect
import pytest
from pydantic import ValidationError

from aica_api.models.proposal.enums import (
    ContentDecisionType,
    ServiceId,
    ResponseCoefficientProvenance,
)
from aica_api.models.proposal.content_output import (
    CompletePlan,
    OrderedItem,
    ItemFeatureContribution,
    SongTraitValues,
    PlanMode,
    LightingConfiguration,
    ExcludedItem,
)


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

SONG_TRAITS = {
    "arousal": 0.7,
    "valence": 0.6,
    "humming_ease": 0.8,
    "full_karaoke_ease": 0.9,
    "arousal_signed": 0.5,
    "valence_signed": 0.4,
}

FEATURE_CONTRIBUTION = {
    "feature_id": "driver_fatigue_level",
    "e_i": 0.8,
    "a_i": 1.0,
    "alpha": 1.2,
    "beta": 0.3,
    "exact_match": None,
    "response_provenance": "cdc_su_explicit",
    "r_i": 0.96,
    "base_weight": 1.0,
    "purpose_multiplier": 1.0,
    "mask": 1,
    "effective_weight": 1.0,
    "contribution": 0.96,
    "formula_version": "content_algo_v1",
}

ORDERED_ITEM_TRANSPARENT = {
    "position": 1,
    "item_id": "synthetic-track-001",
    "item_fit": 0.82,
    "trait_values": SONG_TRAITS,
    "feature_contributions": [FEATURE_CONTRIBUTION],
    "rationale": ["high arousal match", "good valence"],
}

PLAN_MODE = {
    "service_id": "music_playlist",
    "mode_kind": "playlist",
    "chorus_only": None,
    "guide_vocal": None,
    "driving_lyrics": None,
    "fixed_segment_sec": None,
    "stopped_only": None,
    "simulated_queue": None,
}

COMPLETE_PLAN_PAYLOAD: dict = {
    "decision_type": "complete_plan",
    "selected_service_id": "music_playlist",
    "requested_item_count": 5,
    "returned_item_count": 1,
    "ordered_items": [ORDERED_ITEM_TRANSPARENT],
    "mode": PLAN_MODE,
    "expected_duration_sec": 300,
    "lighting_configuration": None,
    "approval_policy": "auto",
    "completion_rule": "end_of_queue",
    "next_transition_policy": "resume",
    "excluded_items": [],
    "unused_available_features": [],
    "missing_features": [],
    "algorithm_provenance": {
        "algorithm_version": "v1",
        "schema_version": "1.0.0",
    },
}


# ---------------------------------------------------------------------------
# C2.1 — Valid transparent CompletePlan accepted
# ---------------------------------------------------------------------------

class TestValidTransparentPlan:
    def test_complete_plan_accepted(self):
        obj = CompletePlan(**COMPLETE_PLAN_PAYLOAD)
        assert obj.decision_type == ContentDecisionType.complete_plan
        assert obj.selected_service_id == ServiceId.music_playlist
        assert obj.returned_item_count == 1

    def test_ordered_item_has_item_fit(self):
        obj = CompletePlan(**COMPLETE_PLAN_PAYLOAD)
        item = obj.ordered_items[0]
        assert item.item_fit == pytest.approx(0.82)

    def test_ordered_item_has_trait_values(self):
        obj = CompletePlan(**COMPLETE_PLAN_PAYLOAD)
        item = obj.ordered_items[0]
        assert item.trait_values is not None
        assert item.trait_values.arousal == pytest.approx(0.7)

    def test_ordered_item_has_feature_contributions(self):
        obj = CompletePlan(**COMPLETE_PLAN_PAYLOAD)
        item = obj.ordered_items[0]
        assert len(item.feature_contributions) == 1
        fc = item.feature_contributions[0]
        assert fc.feature_id == "driver_fatigue_level"

    def test_lighting_configuration_none(self):
        obj = CompletePlan(**COMPLETE_PLAN_PAYLOAD)
        assert obj.lighting_configuration is None

    def test_lighting_configuration_present(self):
        payload = {
            **COMPLETE_PLAN_PAYLOAD,
            "lighting_configuration": {
                "enabled": True,
                "cue_basis": "valence",
                "notes": "sync to beat",
            },
        }
        obj = CompletePlan(**payload)
        assert obj.lighting_configuration is not None
        assert obj.lighting_configuration.enabled is True
        assert obj.lighting_configuration.cue_basis == "valence"

    def test_excluded_items(self):
        payload = {
            **COMPLETE_PLAN_PAYLOAD,
            "excluded_items": [
                {"item_id": "track-002", "reason_codes": ["explicit_content"]},
            ],
        }
        obj = CompletePlan(**payload)
        assert len(obj.excluded_items) == 1
        assert obj.excluded_items[0].item_id == "track-002"


# ---------------------------------------------------------------------------
# C2.2 — LLM-shaped plan accepted (item_fit=None, empty feature_contributions)
# ---------------------------------------------------------------------------

class TestLLMShapedPlan:
    def test_llm_plan_accepted(self):
        llm_item = {
            "position": 1,
            "item_id": "synthetic-track-llm-001",
            "item_fit": None,
            "trait_values": None,
            "feature_contributions": [],
            "rationale": ["LLM selected based on mood matching"],
        }
        payload = {
            **COMPLETE_PLAN_PAYLOAD,
            "ordered_items": [llm_item],
        }
        obj = CompletePlan(**payload)
        item = obj.ordered_items[0]
        assert item.item_fit is None
        assert item.feature_contributions == []
        assert item.trait_values is None

    def test_llm_plan_multiple_items(self):
        def make_llm_item(pos: int, item_id: str) -> dict:
            return {
                "position": pos,
                "item_id": item_id,
                "item_fit": None,
                "trait_values": None,
                "feature_contributions": [],
                "rationale": [f"item {pos} selected by LLM"],
            }

        payload = {
            **COMPLETE_PLAN_PAYLOAD,
            "returned_item_count": 3,
            "ordered_items": [
                make_llm_item(1, "synthetic-track-001"),
                make_llm_item(2, "synthetic-track-002"),
                make_llm_item(3, "synthetic-track-003"),
            ],
        }
        obj = CompletePlan(**payload)
        assert len(obj.ordered_items) == 3
        for item in obj.ordered_items:
            assert item.item_fit is None
            assert item.feature_contributions == []


# ---------------------------------------------------------------------------
# C2.3 — Unknown decision type rejected
# ---------------------------------------------------------------------------

class TestUnknownDecisionTypeRejected:
    def test_unknown_decision_type_rejected(self):
        payload = {**COMPLETE_PLAN_PAYLOAD, "decision_type": "not_a_valid_type"}
        with pytest.raises(ValidationError) as exc_info:
            CompletePlan(**payload)
        errors = exc_info.value.errors()
        assert len(errors) >= 1

    def test_random_string_rejected(self):
        payload = {**COMPLETE_PLAN_PAYLOAD, "decision_type": "score_and_rank"}
        with pytest.raises(ValidationError):
            CompletePlan(**payload)


# ---------------------------------------------------------------------------
# C2.4 — NO aggregate plan score field anywhere (critical invariant)
# ---------------------------------------------------------------------------

FORBIDDEN_FIELD_NAMES = {"plan_score", "aggregate_score", "plan_fit"}


def _collect_all_model_fields_recursive(model_cls) -> set[str]:
    """Recursively collect all field names from a Pydantic model and its nested models."""
    from pydantic import BaseModel

    collected: set[str] = set()
    visited: set = set()

    def walk(cls):
        if cls in visited:
            return
        visited.add(cls)
        if not (isinstance(cls, type) and issubclass(cls, BaseModel)):
            return
        for field_name, field_info in cls.model_fields.items():
            collected.add(field_name)
            # Recurse into annotation types
            annotation = field_info.annotation
            _recurse_annotation(annotation)

    def _recurse_annotation(annotation):
        if annotation is None:
            return
        origin = getattr(annotation, "__origin__", None)
        if origin is not None:
            for arg in getattr(annotation, "__args__", ()):
                _recurse_annotation(arg)
        else:
            walk(annotation)

    walk(model_cls)
    return collected


class TestNoAggregatePlanScore:
    def test_no_plan_score_in_complete_plan(self):
        assert "plan_score" not in CompletePlan.model_fields

    def test_no_aggregate_score_in_complete_plan(self):
        assert "aggregate_score" not in CompletePlan.model_fields

    def test_no_plan_fit_in_complete_plan(self):
        assert "plan_fit" not in CompletePlan.model_fields

    def test_no_forbidden_fields_in_ordered_item(self):
        for name in FORBIDDEN_FIELD_NAMES:
            assert name not in OrderedItem.model_fields, (
                f"Forbidden field '{name}' found in OrderedItem"
            )

    def test_no_forbidden_fields_in_item_feature_contribution(self):
        for name in FORBIDDEN_FIELD_NAMES:
            assert name not in ItemFeatureContribution.model_fields, (
                f"Forbidden field '{name}' found in ItemFeatureContribution"
            )

    def test_no_forbidden_fields_in_plan_mode(self):
        for name in FORBIDDEN_FIELD_NAMES:
            assert name not in PlanMode.model_fields

    def test_no_forbidden_fields_in_song_trait_values(self):
        for name in FORBIDDEN_FIELD_NAMES:
            assert name not in SongTraitValues.model_fields

    def test_no_forbidden_fields_anywhere_recursive(self):
        """Recursively check all nested models reachable from CompletePlan."""
        all_fields = _collect_all_model_fields_recursive(CompletePlan)
        for forbidden in FORBIDDEN_FIELD_NAMES:
            assert forbidden not in all_fields, (
                f"Forbidden aggregate-score field '{forbidden}' found in "
                f"CompletePlan or a nested model. All fields found: {all_fields}"
            )


# ---------------------------------------------------------------------------
# Nested model smoke tests
# ---------------------------------------------------------------------------

class TestNestedModels:
    def test_song_trait_values(self):
        t = SongTraitValues(**SONG_TRAITS)
        assert t.arousal_signed == pytest.approx(0.5)

    def test_item_feature_contribution(self):
        fc = ItemFeatureContribution(**FEATURE_CONTRIBUTION)
        assert fc.feature_id == "driver_fatigue_level"
        assert fc.response_provenance == ResponseCoefficientProvenance.cdc_su_explicit

    def test_plan_mode_humming(self):
        mode = PlanMode(
            service_id=ServiceId.humming_karaoke,
            mode_kind="humming",
            chorus_only=True,
            guide_vocal=True,
            driving_lyrics=False,
            fixed_segment_sec=30,
            stopped_only=None,
            simulated_queue=None,
        )
        assert mode.mode_kind == "humming"
        assert mode.chorus_only is True

    def test_plan_mode_full_karaoke(self):
        mode = PlanMode(
            service_id=ServiceId.full_karaoke,
            mode_kind="full_karaoke",
            chorus_only=None,
            guide_vocal=None,
            driving_lyrics=None,
            fixed_segment_sec=None,
            stopped_only=True,
            simulated_queue=True,
        )
        assert mode.stopped_only is True
        assert mode.simulated_queue is True

    def test_lighting_configuration(self):
        lc = LightingConfiguration(enabled=False, cue_basis=None, notes=None)
        assert lc.enabled is False

    def test_excluded_item(self):
        ei = ExcludedItem(item_id="track-999", reason_codes=["too_slow", "no_lyrics"])
        assert "too_slow" in ei.reason_codes
