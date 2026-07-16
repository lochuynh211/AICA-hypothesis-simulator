"""TDD: assert the exact member set of every enum in enums.py.

Phase 2 — T005 (RED before enums.py exists) → T006 (GREEN after implementation).
"""
from __future__ import annotations

import pytest


# ---------------------------------------------------------------------------
# Import guard — the module must be present for any test to pass
# ---------------------------------------------------------------------------
from aica_api.models.proposal.enums import (
    TriggerPurpose,
    LifecycleStage,
    ServiceId,
    RestSpotType,
    ContentDecisionType,
    FeatureDisposition,
    FeatureOriginProvenance,
    ResponseCoefficientProvenance,
    GenreLiteral,
    UsageLevel,
)


# ---------------------------------------------------------------------------
# TriggerPurpose — 4 members
# ---------------------------------------------------------------------------
class TestTriggerPurpose:
    EXPECTED = {
        "rest_recommended",
        "inattentive_driving_prevention_recovery",
        "route_music",
        "child_passenger_experience",
    }

    def test_member_count(self):
        assert len(TriggerPurpose) == 4

    def test_exact_members(self):
        assert {m.value for m in TriggerPurpose} == self.EXPECTED

    def test_each_member_accessible(self):
        for name in self.EXPECTED:
            assert TriggerPurpose(name) is not None


# ---------------------------------------------------------------------------
# LifecycleStage — 4 members
# ---------------------------------------------------------------------------
class TestLifecycleStage:
    EXPECTED = {
        "before_rest_until_stop",
        "during_rest_stopped",
        "after_rest_before_restart",
        "active_driving_content",
    }

    def test_member_count(self):
        assert len(LifecycleStage) == 4

    def test_exact_members(self):
        assert {m.value for m in LifecycleStage} == self.EXPECTED


# ---------------------------------------------------------------------------
# ServiceId — 14 members
# ---------------------------------------------------------------------------
class TestServiceId:
    EXPECTED = {
        "music_playlist",
        "humming_karaoke",
        "call_response_driving",
        "quiz",
        "ranking_creation",
        "radio_style",
        "conversation_audio",
        "live_viewing",
        "stretch_video",
        "full_karaoke",
        "call_response_stopped",
        "oshi_reexperience",
        "relaxation_multisensory",
        "linked_video_recommendation",
    }

    def test_member_count(self):
        assert len(ServiceId) == 14

    def test_exact_members(self):
        assert {m.value for m in ServiceId} == self.EXPECTED


# ---------------------------------------------------------------------------
# RestSpotType — 6 members
# ---------------------------------------------------------------------------
class TestRestSpotType:
    EXPECTED = {
        "sa_pa",
        "convenience_store",
        "parking",
        "oshi_spot",
        "other",
        "unknown",
    }

    def test_member_count(self):
        assert len(RestSpotType) == 6

    def test_exact_members(self):
        assert {m.value for m in RestSpotType} == self.EXPECTED


# ---------------------------------------------------------------------------
# ContentDecisionType — 9 members
# ---------------------------------------------------------------------------
class TestContentDecisionType:
    EXPECTED = {
        "complete_plan",
        "no_proposal",
        "insufficient_eligible_items",
        "unsupported_service",
        "unsupported_recipe",
        "invalid_request",
        "invalid_catalog",
        "invalid_configuration",
        "full_karaoke_requires_stopped",
    }

    def test_member_count(self):
        assert len(ContentDecisionType) == 9

    def test_exact_members(self):
        assert {m.value for m in ContentDecisionType} == self.EXPECTED


# ---------------------------------------------------------------------------
# FeatureDisposition — 3 members
# ---------------------------------------------------------------------------
class TestFeatureDisposition:
    EXPECTED = {
        "scored",
        "context_only",
        "available_but_not_used",
    }

    def test_member_count(self):
        assert len(FeatureDisposition) == 3

    def test_exact_members(self):
        assert {m.value for m in FeatureDisposition} == self.EXPECTED


# ---------------------------------------------------------------------------
# FeatureOriginProvenance — 3 members
# ---------------------------------------------------------------------------
class TestFeatureOriginProvenance:
    EXPECTED = {
        "cdc_su_baseline",
        "normalized_cdc_su_concept",
        "proposed_addition",
    }

    def test_member_count(self):
        assert len(FeatureOriginProvenance) == 3

    def test_exact_members(self):
        assert {m.value for m in FeatureOriginProvenance} == self.EXPECTED


# ---------------------------------------------------------------------------
# ResponseCoefficientProvenance — exactly the documented members
# ---------------------------------------------------------------------------
class TestResponseCoefficientProvenance:
    EXPECTED = {
        "cdc_su_explicit",
        "service_definition",
        "normalized_context_hypothesis",
    }

    def test_exact_members(self):
        assert {m.value for m in ResponseCoefficientProvenance} == self.EXPECTED


# ---------------------------------------------------------------------------
# GenreLiteral — 12 members
# ---------------------------------------------------------------------------
class TestGenreLiteral:
    EXPECTED = {
        "j-pop",
        "j-rock",
        "city pop",
        "anime",
        "vocaloid",
        "enka",
        "children's music",
        "classical",
        "jazz",
        "ambient",
        "electronic",
        "japanese folk",
    }

    def test_member_count(self):
        assert len(GenreLiteral) == 12

    def test_exact_members(self):
        assert {m.value for m in GenreLiteral} == self.EXPECTED


# ---------------------------------------------------------------------------
# UsageLevel — 4 members
# ---------------------------------------------------------------------------
class TestUsageLevel:
    EXPECTED = {
        "never",
        "low",
        "med",
        "high",
    }

    def test_member_count(self):
        assert len(UsageLevel) == 4

    def test_exact_members(self):
        assert {m.value for m in UsageLevel} == self.EXPECTED


# ---------------------------------------------------------------------------
# Module constants (also defined in enums.py per data-model.md)
# ---------------------------------------------------------------------------
class TestModuleConstants:
    def test_contract_version(self):
        from aica_api.models.proposal.enums import CONTRACT_VERSION
        assert CONTRACT_VERSION == "1.0.0"

    def test_schema_version(self):
        from aica_api.models.proposal.enums import SCHEMA_VERSION
        assert SCHEMA_VERSION == "1.0.0"

    def test_genre_extension_version(self):
        from aica_api.models.proposal.enums import GENRE_EXTENSION_VERSION
        assert GENRE_EXTENSION_VERSION == "genre_affinity_v1"
