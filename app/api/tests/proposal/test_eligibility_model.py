"""TDD: `EligibilityExclusion` / `EligibilityResult` shape (P4 T007).

Score-free invariant: NO field named `score`, `fit`, `weight`, or `utility`
exists on either model (data-model.md, research.md D3).

Phase 2/3 — T007 (RED before T008 lands) -> T008 makes it GREEN.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from aica_api.models.proposal.eligibility import EligibilityExclusion, EligibilityResult
from aica_api.models.proposal.enums import EligibilityReasonCode, ServiceId

_FORBIDDEN_FIELD_NAMES = {"score", "fit", "weight", "utility"}


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------


def test_construct_eligibility_exclusion():
    exclusion = EligibilityExclusion(
        service_id=ServiceId.full_karaoke,
        reason_codes=[EligibilityReasonCode.full_karaoke_requires_stopped],
    )
    assert exclusion.service_id == ServiceId.full_karaoke
    assert exclusion.reason_codes == [EligibilityReasonCode.full_karaoke_requires_stopped]


def test_construct_eligibility_result():
    result = EligibilityResult(
        eligible=[ServiceId.music_playlist, ServiceId.live_viewing],
        excluded=[
            EligibilityExclusion(
                service_id=ServiceId.full_karaoke,
                reason_codes=[EligibilityReasonCode.full_karaoke_requires_stopped],
            )
        ],
    )
    assert result.eligible == [ServiceId.music_playlist, ServiceId.live_viewing]
    assert len(result.excluded) == 1


def test_eligibility_exclusion_reason_codes_non_empty():
    with pytest.raises(ValidationError):
        EligibilityExclusion(service_id=ServiceId.full_karaoke, reason_codes=[])


def test_eligibility_exclusion_allows_multiple_reason_codes():
    exclusion = EligibilityExclusion(
        service_id=ServiceId.oshi_reexperience,
        reason_codes=[
            EligibilityReasonCode.missing_required_entity,
            EligibilityReasonCode.stopped_only_while_driving,
        ],
    )
    assert len(exclusion.reason_codes) == 2


# ---------------------------------------------------------------------------
# Score-free invariant
# ---------------------------------------------------------------------------


def test_eligibility_exclusion_has_no_score_field():
    field_names = set(EligibilityExclusion.model_fields.keys())
    assert field_names.isdisjoint(_FORBIDDEN_FIELD_NAMES), (
        f"EligibilityExclusion must never carry a score-like field, "
        f"found: {field_names & _FORBIDDEN_FIELD_NAMES}"
    )


def test_eligibility_result_has_no_score_field():
    field_names = set(EligibilityResult.model_fields.keys())
    assert field_names.isdisjoint(_FORBIDDEN_FIELD_NAMES), (
        f"EligibilityResult must never carry a score-like field, "
        f"found: {field_names & _FORBIDDEN_FIELD_NAMES}"
    )
