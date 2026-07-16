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

P5 Unit A (specs/016-proposal-p5-transparent-service-selector,
contracts/service_output_extension.md, data-model.md §1-§4) ADDITIVELY
extends this contract with the optional §14 explainability fields (per-row
provenance/normalization detail on ``FeatureContribution``, the new
``DominanceReadout`` object, per-candidate fit subtotals + strongest
support/oppose + dominance on ``RankedCandidate``, and run-level
dominance/effective_weights/resolved_config_versions on
``ServiceSelectorOutput``). Every new field is OPTIONAL (default ``None``) —
``mock_service_selector_v1``, which emits none of them, continues to
validate unchanged; NO existing validator was touched and NO new field is
required.
"""
from __future__ import annotations

from pydantic import BaseModel, model_validator

from aica_api.models.proposal.enums import ServiceDecisionType, ServiceId
from aica_api.models.proposal.selector_input import ExcludedCandidate

__all__ = [
    "DominanceReadout",
    "FeatureContribution",
    "RankedCandidate",
    "ServiceSelectorOutput",
]


# ---------------------------------------------------------------------------
# FeatureContribution — the reason breakdown row
# ---------------------------------------------------------------------------


class FeatureContribution(BaseModel):
    """A single feature's contribution row within a ranked candidate's
    reason breakdown.

    The trailing fields (``source_reference`` … ``status``) are the P5 §14
    explainability extension (data-model.md §1) — all optional, populated
    only by the real transparent package; ``mock_service_selector_v1`` never
    sets them and they default to ``None``.
    """

    feature_id: str
    feature_value: str | float | int
    response_coefficient: float
    weight: float
    contribution: float

    # --- P5 §14 optional extension ---------------------------------------
    source_reference: str | None = None
    raw_value: str | float | int | None = None
    normalization_function: str | None = None
    normalized_evidence: float | None = None
    response_provenance: str | None = None
    normalized_feature_response: float | None = None
    hierarchy_path: str | None = None
    base_weight: float | None = None
    purpose_multiplier: float | None = None
    effective_weight: float | None = None
    status: str | None = None


# ---------------------------------------------------------------------------
# DominanceReadout — the §6.4 continuous default dominance invariant readout
# ---------------------------------------------------------------------------


class DominanceReadout(BaseModel):
    """Per-candidate and/or run-level safety-dominance configuration readout
    (data-model.md §2 / algorithm doc §6.4). Every field is required WITHIN
    this object — the object itself is optional on its parents (``None`` when
    not computed, e.g. by the mock)."""

    status: str
    w_d: float
    w_l: float
    required_gap: float
    material_safety_gap: float
    safety_share: float
    safety_share_warning: bool


# ---------------------------------------------------------------------------
# RankedCandidate
# ---------------------------------------------------------------------------


class RankedCandidate(BaseModel):
    """A single ranked service candidate (1-based rank, unique, ≤3 total).

    The trailing fields (``situation_fit`` … ``dominance``) are the P5 §14
    optional extension (data-model.md §3) — explanatory only, never a sort
    key; ``mock_service_selector_v1`` never sets them.
    """

    rank: int
    candidate_id: ServiceId
    score: float | None
    rationale: list[str]
    supporting_feature_ids: list[str]
    opposing_feature_ids: list[str]
    uncertainty: str | None
    feature_contributions: list[FeatureContribution]

    # --- P5 §14 optional extension ---------------------------------------
    situation_fit: float | None = None
    preference_fit: float | None = None
    history_fit: float | None = None
    strongest_support: dict | None = None
    strongest_oppose: dict | None = None
    dominance: DominanceReadout | None = None


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

    The trailing fields (``dominance``, ``effective_weights``,
    ``resolved_config_versions``) are the P5 optional extension
    (data-model.md §4) — run-level companions to the per-candidate ones
    above; ``mock_service_selector_v1`` never sets them.
    """

    decision_type: ServiceDecisionType
    ranked_candidates: list[RankedCandidate]
    excluded_candidates: list[ExcludedCandidate]
    unused_available_features: list[str]
    missing_features: list[str]
    next_package_runtime_state: dict
    algorithm_provenance: dict

    # --- P5 §14 optional extension ---------------------------------------
    dominance: DominanceReadout | None = None
    effective_weights: dict[str, float] | None = None
    resolved_config_versions: dict | None = None

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
