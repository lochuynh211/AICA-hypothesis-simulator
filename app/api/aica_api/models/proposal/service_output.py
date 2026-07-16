"""Neutral service-selector output contract (data-model.md §"ServiceSelectorOutput").

Authoritative field spec: data-model.md §"ServiceSelectorOutput" (spec §5.4
service side).

This module is ISOLATED from trigger models:
  - Do NOT import from ``aica_api.models`` (the trigger package).
  - Enums are imported from ``.enums`` only.
  - ``ExcludedCandidate`` is reused verbatim from ``selector_input`` (not
    redefined here).

NOTE: ``candidate_id ∈ allowed_service_ids`` is a RUNTIME check performed by
the selector dispatch layer against the opportunity's allowed set — it is
intentionally NOT a model validator here (data-model.md).
"""
from __future__ import annotations

from pydantic import BaseModel, model_validator

from aica_api.models.proposal.enums import ServiceDecisionType, ServiceId
from aica_api.models.proposal.selector_input import ExcludedCandidate

__all__ = [
    "FeatureContribution",
    "RankedCandidate",
    "ServiceSelectorOutput",
]


# ---------------------------------------------------------------------------
# FeatureContribution — the reason breakdown row
# ---------------------------------------------------------------------------


class FeatureContribution(BaseModel):
    """A single feature's contribution row within a ranked candidate's
    reason breakdown."""

    feature_id: str
    feature_value: str | float | int
    response_coefficient: float
    weight: float
    contribution: float


# ---------------------------------------------------------------------------
# RankedCandidate
# ---------------------------------------------------------------------------


class RankedCandidate(BaseModel):
    """A single ranked service candidate (1-based rank, unique, ≤3 total)."""

    rank: int
    candidate_id: ServiceId
    score: float | None
    rationale: list[str]
    supporting_feature_ids: list[str]
    opposing_feature_ids: list[str]
    uncertainty: str | None
    feature_contributions: list[FeatureContribution]


# ---------------------------------------------------------------------------
# ServiceSelectorOutput
# ---------------------------------------------------------------------------


class ServiceSelectorOutput(BaseModel):
    """Neutral service-selector result (data-model.md §"ServiceSelectorOutput").

    Validators
    ----------
    1. ``len(ranked_candidates) <= 3``.
    2. Ranks are contiguous from 1 (no gaps, no duplicates).
    3. ``decision_type == no_proposal`` ⇒ ``ranked_candidates`` is empty.
    """

    decision_type: ServiceDecisionType
    ranked_candidates: list[RankedCandidate]
    excluded_candidates: list[ExcludedCandidate]
    unused_available_features: list[str]
    missing_features: list[str]
    next_package_runtime_state: dict
    algorithm_provenance: dict

    @model_validator(mode="after")
    def validate_ranked_candidates(self) -> "ServiceSelectorOutput":
        candidates = self.ranked_candidates

        if len(candidates) > 3:
            raise ValueError(
                f"ranked_candidates must contain at most 3 entries, got {len(candidates)}."
            )

        ranks = [c.rank for c in candidates]
        expected_ranks = list(range(1, len(candidates) + 1))
        if ranks != expected_ranks:
            raise ValueError(
                f"ranked_candidates ranks must be contiguous starting at 1 "
                f"with no gaps or duplicates; got {ranks}, expected {expected_ranks}."
            )

        if self.decision_type == ServiceDecisionType.no_proposal and candidates:
            raise ValueError(
                "decision_type == 'no_proposal' requires an empty ranked_candidates list."
            )

        return self
