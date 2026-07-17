"""Content-selector output contract (C2) — CompletePlan and nested models.

Frozen contract shape for the content selector package → journey engine boundary.
Authoritative field spec: data-model.md §"Content-selector output".

CRITICAL INVARIANT (test-enforced):
  No field named ``plan_score``, ``aggregate_score``, or ``plan_fit`` may
  appear in ``CompletePlan`` or any of its nested models.

This module is ISOLATED from trigger models:
  - Do NOT import from ``aica_api.models`` (the trigger package).
  - Enums are imported from ``.enums`` only.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from aica_api.models.proposal.enums import (
    ContentDecisionType,
    ResponseCoefficientProvenance,
    ServiceId,
)


# ---------------------------------------------------------------------------
# SongTraitValues
# ---------------------------------------------------------------------------


class SongTraitValues(BaseModel):
    """Decision-time song trait values (never stored as catalog metadata).

    All six values are required; they are computed at content-selection time
    from audio features and never persist in the song catalog.
    """

    arousal: float
    valence: float
    humming_ease: float
    full_karaoke_ease: float
    arousal_signed: float   # A_s
    valence_signed: float   # V_s


# ---------------------------------------------------------------------------
# ItemFeatureContribution  (content-algo §14)
# ---------------------------------------------------------------------------


class ItemFeatureContribution(BaseModel):
    """Per-feature contribution detail for a single ordered item.

    All numeric fields are as defined in the transparent content algorithm
    specification §14.  ``alpha``, ``beta``, ``exact_match``, and
    ``response_provenance`` may be None for features that do not use them.
    """

    feature_id: str
    e_i: float
    a_i: float
    alpha: float | None
    beta: float | None
    exact_match: bool | None
    response_provenance: ResponseCoefficientProvenance | None
    r_i: float
    base_weight: float
    purpose_multiplier: float
    mask: int
    effective_weight: float
    contribution: float
    formula_version: str


# ---------------------------------------------------------------------------
# OrderedItem
# ---------------------------------------------------------------------------


class OrderedItem(BaseModel):
    """A single item in the ordered plan returned by the content selector.

    ``item_fit`` is ``None`` for LLM-shaped plans (no numeric fit score).
    ``feature_contributions`` is empty for LLM-shaped plans.
    ``trait_values`` is ``None`` when no song-trait computation was performed.
    """

    position: int
    item_id: str
    item_fit: float | None          # None for LLM
    trait_values: SongTraitValues | None
    feature_contributions: list[ItemFeatureContribution]   # empty for LLM
    rationale: list[str]
    # §14 explainability roll-up (mirrors service RankedCandidate): category
    # subtotals + the single strongest supporting / opposing feature. Optional
    # so LLM-shaped plans and pre-existing evidence stay valid (default None).
    situation_fit: float | None = None
    preference_fit: float | None = None
    history_fit: float | None = None
    strongest_support: dict | None = None   # {feature_id, contribution} | None
    strongest_oppose: dict | None = None    # {feature_id, contribution} | None


# ---------------------------------------------------------------------------
# PlanMode
# ---------------------------------------------------------------------------


class PlanMode(BaseModel):
    """Playback mode descriptor for the selected service.

    The ``mode_kind`` discriminates playlist / humming / full-karaoke shapes.
    Fields not applicable to the current mode_kind are ``None``.
    """

    service_id: ServiceId
    mode_kind: Literal["playlist", "humming", "full_karaoke"]
    chorus_only: bool | None        # humming only
    guide_vocal: bool | None        # humming only
    driving_lyrics: bool | None     # humming only (not applicable)
    fixed_segment_sec: int | None   # humming only
    stopped_only: bool | None       # full_karaoke only
    simulated_queue: bool | None    # full_karaoke only


# ---------------------------------------------------------------------------
# LightingConfiguration
# ---------------------------------------------------------------------------


class LightingConfiguration(BaseModel):
    """Optional lighting cue configuration.

    Present only for lighting-compatible services.
    ``enabled=False`` suppresses cues without removing the object.
    The lighting configuration NEVER affects ``item_fit``.
    """

    enabled: bool
    cue_basis: str | None    # e.g. "valence"
    notes: str | None


# ---------------------------------------------------------------------------
# ExcludedItem
# ---------------------------------------------------------------------------


class ExcludedItem(BaseModel):
    """An item excluded from the plan, with structured reason codes."""

    item_id: str
    reason_codes: list[str]


# ---------------------------------------------------------------------------
# CompletePlan  (spec §5.4 + content-algo §14)
# ---------------------------------------------------------------------------


class CompletePlan(BaseModel):
    """Complete content-selector output (C2).

    Represents either a transparent (scored) plan or an LLM-shaped plan.
    The two shapes differ only in whether ``item_fit`` is populated and
    whether ``feature_contributions`` is non-empty — the outer structure
    is identical.

    INVARIANT: This model and every nested model must contain NO field
    named ``plan_score``, ``aggregate_score``, or ``plan_fit``.
    """

    decision_type: ContentDecisionType
    selected_service_id: ServiceId
    requested_item_count: int = 5
    returned_item_count: int
    ordered_items: list[OrderedItem]
    mode: PlanMode
    expected_duration_sec: int
    lighting_configuration: LightingConfiguration | None = None
    approval_policy: str
    completion_rule: str
    next_transition_policy: str
    excluded_items: list[ExcludedItem]
    unused_available_features: list[str]
    missing_features: list[str]
    algorithm_provenance: dict
