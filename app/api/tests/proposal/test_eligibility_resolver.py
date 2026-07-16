"""TDD: ``resolve_eligibility`` / ``derive_registered_entities`` — T013/T014/T017.

Eligibility narrows an allowed-services row to eligible/excluded BEFORE any
selector package ranks candidates (research.md D1). Pure, deterministic
function: no IO, no clock. See research.md D2 (capability mapping), D3
(reason-code vocabulary), D8 (legacy world_snapshot back-compat) and
data-model.md "EligibilityExclusion / EligibilityResult".
"""
from __future__ import annotations

import pytest

from aica_api.config import settings
from aica_api.models.proposal.enums import EligibilityReasonCode, MotionState, ServiceId
from aica_api.models.proposal.service_capabilities import ServiceCapabilities
from aica_api.services.proposal_eligibility import derive_registered_entities, resolve_eligibility

_CAPABILITIES_PATH = (
    settings.proposal_contracts_dir / "service_capabilities" / "service_capabilities.v1.json"
)

# rest_recommended / after_rest_before_restart — the post-rest row (data-model.md).
_POST_REST_ROW: list[ServiceId] = [
    ServiceId.live_viewing,
    ServiceId.stretch_video,
    ServiceId.full_karaoke,
    ServiceId.oshi_reexperience,
    ServiceId.call_response_stopped,
]


@pytest.fixture(scope="module")
def capabilities() -> ServiceCapabilities:
    return ServiceCapabilities.load(_CAPABILITIES_PATH)


def _excluded_reason_map(result) -> dict[ServiceId, list[EligibilityReasonCode]]:
    return {excl.service_id: excl.reason_codes for excl in result.excluded}


# ---------------------------------------------------------------------------
# Post-rest row, driving, no oshi registered
# ---------------------------------------------------------------------------


class TestPostRestRowDrivingNoOshi:
    def test_full_karaoke_requires_stopped(self, capabilities):
        result = resolve_eligibility(
            _POST_REST_ROW, MotionState.driving, capabilities, registered_entities=set()
        )
        reasons = _excluded_reason_map(result)
        assert reasons[ServiceId.full_karaoke] == [
            EligibilityReasonCode.full_karaoke_requires_stopped
        ]

    def test_stretch_video_and_call_response_stopped_are_stopped_only(self, capabilities):
        result = resolve_eligibility(
            _POST_REST_ROW, MotionState.driving, capabilities, registered_entities=set()
        )
        reasons = _excluded_reason_map(result)
        assert reasons[ServiceId.stretch_video] == [
            EligibilityReasonCode.stopped_only_while_driving
        ]
        assert reasons[ServiceId.call_response_stopped] == [
            EligibilityReasonCode.stopped_only_while_driving
        ]

    def test_oshi_reexperience_collects_motion_and_entity_reasons(self, capabilities):
        """A service may collect BOTH a motion reason and missing_required_entity
        — one EligibilityExclusion with multiple reason_codes."""
        result = resolve_eligibility(
            _POST_REST_ROW, MotionState.driving, capabilities, registered_entities=set()
        )
        reasons = _excluded_reason_map(result)
        assert reasons[ServiceId.oshi_reexperience] == [
            EligibilityReasonCode.stopped_only_while_driving,
            EligibilityReasonCode.missing_required_entity,
        ]

    def test_live_viewing_is_eligible_background_on_motion(self, capabilities):
        """live_viewing is screen_dependent but background_on_motion — never
        excluded for motion alone (research.md D2 note)."""
        result = resolve_eligibility(
            _POST_REST_ROW, MotionState.driving, capabilities, registered_entities=set()
        )
        assert ServiceId.live_viewing in result.eligible
        assert ServiceId.live_viewing not in _excluded_reason_map(result)


# ---------------------------------------------------------------------------
# Same row, stopped + oshi registered -> everything eligible
# ---------------------------------------------------------------------------


class TestPostRestRowStoppedWithOshiRegistered:
    def test_all_eligible_none_excluded(self, capabilities):
        result = resolve_eligibility(
            _POST_REST_ROW, MotionState.stopped, capabilities, registered_entities={"oshi"}
        )
        assert set(result.eligible) == set(_POST_REST_ROW)
        assert result.excluded == []


# ---------------------------------------------------------------------------
# Invariants
# ---------------------------------------------------------------------------


class TestInvariants:
    def test_determinism(self, capabilities):
        r1 = resolve_eligibility(
            _POST_REST_ROW, MotionState.driving, capabilities, registered_entities=set()
        )
        r2 = resolve_eligibility(
            _POST_REST_ROW, MotionState.driving, capabilities, registered_entities=set()
        )
        assert r1 == r2

    def test_no_score_like_attribute_on_any_exclusion(self, capabilities):
        result = resolve_eligibility(
            _POST_REST_ROW, MotionState.driving, capabilities, registered_entities=set()
        )
        assert result.excluded, "expected at least one exclusion in this fixture"
        for excl in result.excluded:
            dumped = excl.model_dump()
            for forbidden in ("score", "fit", "weight", "utility"):
                assert forbidden not in dumped

    def test_eligible_order_preserves_input_order(self, capabilities):
        result = resolve_eligibility(
            _POST_REST_ROW, MotionState.stopped, capabilities, registered_entities={"oshi"}
        )
        assert result.eligible == _POST_REST_ROW

    def test_eligible_and_excluded_partition_the_allowed_row(self, capabilities):
        result = resolve_eligibility(
            _POST_REST_ROW, MotionState.driving, capabilities, registered_entities=set()
        )
        excluded_ids = {excl.service_id for excl in result.excluded}
        assert set(result.eligible) | excluded_ids == set(_POST_REST_ROW)
        assert set(result.eligible).isdisjoint(excluded_ids)


# ---------------------------------------------------------------------------
# T017 — derive_registered_entities (typed-world + legacy back-compat)
# ---------------------------------------------------------------------------


class TestDeriveRegisteredEntities:
    def test_typed_world_nested_preference_oshi_registered_true(self):
        """World.project() nests oshi_registered under feature_snapshot.preference
        (models/proposal/dispositions.py — category 'Preference')."""
        world_snapshot = {"feature_snapshot": {"preference": {"oshi_registered": True}}}
        assert derive_registered_entities(world_snapshot) == {"oshi"}

    def test_typed_world_nested_preference_oshi_registered_false(self):
        world_snapshot = {"feature_snapshot": {"preference": {"oshi_registered": False}}}
        assert derive_registered_entities(world_snapshot) == set()

    def test_legacy_flat_oshi_registered_true(self):
        world_snapshot = {"feature_snapshot": {"oshi_registered": True}}
        assert derive_registered_entities(world_snapshot) == {"oshi"}

    def test_legacy_flat_oshi_registered_false(self):
        world_snapshot = {"feature_snapshot": {"oshi_registered": False}}
        assert derive_registered_entities(world_snapshot) == set()

    def test_legacy_no_feature_snapshot_key_returns_empty_not_a_crash(self):
        assert derive_registered_entities({}) == set()

    def test_legacy_empty_feature_snapshot_returns_empty(self):
        assert derive_registered_entities({"feature_snapshot": {}}) == set()

    def test_none_world_snapshot_returns_empty_not_a_crash(self):
        assert derive_registered_entities(None) == set()
