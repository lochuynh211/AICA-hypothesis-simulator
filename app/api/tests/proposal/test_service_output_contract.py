"""TDD: ServiceSelectorOutput / RankedCandidate / FeatureContribution — T007.

Authoritative field spec: data-model.md §"ServiceSelectorOutput".

Covers:
- Valid output with 0-3 ranked candidates accepted.
- len(ranked_candidates) > 3 rejected.
- Ranks must be contiguous from 1 (gaps / duplicates / non-1-start rejected).
- decision_type == no_proposal requires empty ranked_candidates.
- decision_type == ranked_candidates with non-empty candidates accepted.
- FeatureContribution shape.

NOTE: candidate_id ∈ allowed_service_ids is explicitly a RUNTIME check
performed by the selector dispatch layer, NOT a model validator — this
contract intentionally does not enforce it (data-model.md / task brief).
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from aica_api.models.proposal.enums import ServiceDecisionType, ServiceId
from aica_api.models.proposal.service_output import (
    FeatureContribution,
    RankedCandidate,
    ServiceSelectorOutput,
)

VALID_CONTRIBUTION: dict = {
    "feature_id": "drowsiness_level",
    "feature_value": "high",
    "response_coefficient": 0.8,
    "weight": 0.5,
    "contribution": 0.4,
}

VALID_CANDIDATE: dict = {
    "rank": 1,
    "candidate_id": "music_playlist",
    "score": 0.72,
    "rationale": ["good fit for drowsy driver"],
    "supporting_feature_ids": ["drowsiness_level"],
    "opposing_feature_ids": [],
    "uncertainty": None,
    "feature_contributions": [VALID_CONTRIBUTION],
}


def _candidate(rank: int, candidate_id: str = "music_playlist") -> dict:
    return {**VALID_CANDIDATE, "rank": rank, "candidate_id": candidate_id}


VALID_OUTPUT: dict = {
    "decision_type": "ranked_candidates",
    "ranked_candidates": [VALID_CANDIDATE],
    "excluded_candidates": [],
    "unused_available_features": [],
    "missing_features": [],
    "next_package_runtime_state": {},
    "algorithm_provenance": {"package_id": "mock_service_selector_v1"},
}


# ---------------------------------------------------------------------------
# FeatureContribution — basic shape
# ---------------------------------------------------------------------------


class TestFeatureContribution:
    def test_valid_contribution(self):
        fc = FeatureContribution(**VALID_CONTRIBUTION)
        assert fc.feature_id == "drowsiness_level"
        assert fc.feature_value == "high"
        assert fc.response_coefficient == 0.8
        assert fc.weight == 0.5
        assert fc.contribution == 0.4

    def test_numeric_feature_value_accepted(self):
        fc = FeatureContribution(**{**VALID_CONTRIBUTION, "feature_value": 3.2})
        assert fc.feature_value == 3.2


# ---------------------------------------------------------------------------
# RankedCandidate — basic shape
# ---------------------------------------------------------------------------


class TestRankedCandidate:
    def test_valid_candidate(self):
        rc = RankedCandidate(**VALID_CANDIDATE)
        assert rc.rank == 1
        assert rc.candidate_id == ServiceId.music_playlist
        assert rc.score == 0.72
        assert len(rc.feature_contributions) == 1

    def test_score_none_accepted(self):
        rc = RankedCandidate(**{**VALID_CANDIDATE, "score": None})
        assert rc.score is None

    def test_uncertainty_string_accepted(self):
        rc = RankedCandidate(**{**VALID_CANDIDATE, "uncertainty": "low confidence"})
        assert rc.uncertainty == "low confidence"


# ---------------------------------------------------------------------------
# ServiceSelectorOutput — valid cases
# ---------------------------------------------------------------------------


class TestValidOutput:
    def test_single_ranked_candidate_accepted(self):
        out = ServiceSelectorOutput(**VALID_OUTPUT)
        assert out.decision_type == ServiceDecisionType.ranked_candidates
        assert len(out.ranked_candidates) == 1

    def test_zero_ranked_candidates_with_ranked_decision_type_accepted(self):
        """The ≤3 / contiguity rule doesn't forbid 0 candidates outright when
        decision_type is ranked_candidates — but see no_proposal test below for
        the required empty-list pairing."""
        payload = {**VALID_OUTPUT, "ranked_candidates": []}
        out = ServiceSelectorOutput(**payload)
        assert out.ranked_candidates == []

    def test_two_ranked_candidates_contiguous_accepted(self):
        payload = {
            **VALID_OUTPUT,
            "ranked_candidates": [_candidate(1, "music_playlist"), _candidate(2, "humming_karaoke")],
        }
        out = ServiceSelectorOutput(**payload)
        assert len(out.ranked_candidates) == 2

    def test_three_ranked_candidates_contiguous_accepted(self):
        payload = {
            **VALID_OUTPUT,
            "ranked_candidates": [
                _candidate(1, "music_playlist"),
                _candidate(2, "humming_karaoke"),
                _candidate(3, "quiz"),
            ],
        }
        out = ServiceSelectorOutput(**payload)
        assert len(out.ranked_candidates) == 3

    def test_no_proposal_with_empty_candidates_accepted(self):
        payload = {**VALID_OUTPUT, "decision_type": "no_proposal", "ranked_candidates": []}
        out = ServiceSelectorOutput(**payload)
        assert out.decision_type == ServiceDecisionType.no_proposal
        assert out.ranked_candidates == []


# ---------------------------------------------------------------------------
# ServiceSelectorOutput — validator rejections
# ---------------------------------------------------------------------------


class TestMaxThreeCandidates:
    def test_four_candidates_rejected(self):
        payload = {
            **VALID_OUTPUT,
            "ranked_candidates": [
                _candidate(1, "music_playlist"),
                _candidate(2, "humming_karaoke"),
                _candidate(3, "quiz"),
                _candidate(4, "radio_style"),
            ],
        }
        with pytest.raises(ValidationError):
            ServiceSelectorOutput(**payload)


class TestContiguousRanks:
    def test_gap_in_ranks_rejected(self):
        payload = {
            **VALID_OUTPUT,
            "ranked_candidates": [_candidate(1, "music_playlist"), _candidate(3, "quiz")],
        }
        with pytest.raises(ValidationError):
            ServiceSelectorOutput(**payload)

    def test_duplicate_ranks_rejected(self):
        payload = {
            **VALID_OUTPUT,
            "ranked_candidates": [_candidate(1, "music_playlist"), _candidate(1, "quiz")],
        }
        with pytest.raises(ValidationError):
            ServiceSelectorOutput(**payload)

    def test_not_starting_at_one_rejected(self):
        payload = {
            **VALID_OUTPUT,
            "ranked_candidates": [_candidate(2, "music_playlist"), _candidate(3, "quiz")],
        }
        with pytest.raises(ValidationError):
            ServiceSelectorOutput(**payload)


class TestNoProposalMustBeEmpty:
    def test_no_proposal_with_nonempty_candidates_rejected(self):
        payload = {
            **VALID_OUTPUT,
            "decision_type": "no_proposal",
            "ranked_candidates": [VALID_CANDIDATE],
        }
        with pytest.raises(ValidationError):
            ServiceSelectorOutput(**payload)


class TestWrongEnumRejected:
    def test_invalid_decision_type_rejected(self):
        payload = {**VALID_OUTPUT, "decision_type": "not_a_decision_type"}
        with pytest.raises(ValidationError):
            ServiceSelectorOutput(**payload)

    def test_invalid_candidate_id_rejected(self):
        payload = {
            **VALID_OUTPUT,
            "ranked_candidates": [_candidate(1, "not_a_real_service")],
        }
        with pytest.raises(ValidationError):
            ServiceSelectorOutput(**payload)
