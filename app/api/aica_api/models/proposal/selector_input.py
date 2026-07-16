"""Common selector input contract (C1) — SelectorInput and helper models.

Frozen contract shape for the proposal orchestrator → selector package boundary.
Authoritative field spec: data-model.md §"Common selector input".

This module is ISOLATED from trigger models:
  - Do NOT import from ``aica_api.models`` (the trigger package).
  - Enums are imported from ``.enums`` only.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, field_validator, model_validator

from aica_api.models.proposal.enums import (
    FeatureOriginProvenance,
    LifecycleStage,
    ServiceId,
    TriggerPurpose,
)

# ---------------------------------------------------------------------------
# Compatibility rules (data-model.md §"Common selector input", Validators)
# ---------------------------------------------------------------------------

# Rest stages are ONLY compatible with rest_recommended.
_REST_STAGES = frozenset(
    {
        LifecycleStage.before_rest_until_stop,
        LifecycleStage.during_rest_stopped,
        LifecycleStage.after_rest_before_restart,
    }
)

# active_driving_content is ONLY compatible with these three purposes.
_ACTIVE_DRIVING_PURPOSES = frozenset(
    {
        TriggerPurpose.inattentive_driving_prevention_recovery,
        TriggerPurpose.route_music,
        TriggerPurpose.child_passenger_experience,
    }
)


# ---------------------------------------------------------------------------
# Helper models
# ---------------------------------------------------------------------------


class FeatureProvenanceEntry(BaseModel):
    """Provenance for a single feature entry in the feature_provenance map."""

    feature_origin: FeatureOriginProvenance
    source_reference: str


class CandidateRef(BaseModel):
    """A reference to a candidate item — service ID for the service selector,
    Track ID (str) for the content selector."""

    candidate_id: ServiceId | str


class ExcludedCandidate(BaseModel):
    """A candidate excluded before algorithm evaluation, with a platform reason."""

    candidate_id: str
    platform_reason: str


# ---------------------------------------------------------------------------
# SelectorInput
# ---------------------------------------------------------------------------


class SelectorInput(BaseModel):
    """Common selector input (C1).

    Carries trigger purpose, lifecycle stage, the feature snapshot, and
    the candidate lists to a service or content selector package.

    Validators
    ----------
    1. ``allowed_service_ids`` must be non-empty.
    2. Purpose / stage must be compatible (rest stages only with
       ``rest_recommended``; ``active_driving_content`` only with the three
       non-rest purposes).
    """

    contract_version: str
    opportunity_id: str
    simulation_time: str | int
    trigger_purpose: TriggerPurpose
    lifecycle_stage: LifecycleStage
    allowed_service_ids: list[ServiceId]
    feature_snapshot: dict[str, Any]
    feature_provenance: dict[str, FeatureProvenanceEntry]
    enabled_feature_extensions: list[str]
    selected_service_id: ServiceId | None = None
    eligible_candidates: list[CandidateRef]
    excluded_candidates: list[ExcludedCandidate]
    parameters: dict
    hyperparameters: dict
    package_runtime_state: dict
    catalog_version: str
    run_seed: str

    # ------------------------------------------------------------------
    # Validator 1 — allowed_service_ids non-empty
    # ------------------------------------------------------------------

    @field_validator("allowed_service_ids")
    @classmethod
    def allowed_service_ids_non_empty(
        cls, v: list[ServiceId]
    ) -> list[ServiceId]:
        if not v:
            raise ValueError(
                "allowed_service_ids must not be empty; "
                "supply at least one ServiceId."
            )
        return v

    # ------------------------------------------------------------------
    # Validator 2 — purpose/stage compatibility
    # ------------------------------------------------------------------

    @model_validator(mode="after")
    def purpose_stage_compatible(self) -> "SelectorInput":
        purpose = self.trigger_purpose
        stage = self.lifecycle_stage

        if stage in _REST_STAGES and purpose != TriggerPurpose.rest_recommended:
            raise ValueError(
                f"Lifecycle stage '{stage.value}' is only compatible with "
                f"trigger_purpose 'rest_recommended', but got '{purpose.value}'."
            )
        if stage == LifecycleStage.active_driving_content and purpose not in _ACTIVE_DRIVING_PURPOSES:
            raise ValueError(
                f"Lifecycle stage 'active_driving_content' is only compatible "
                f"with purposes {[p.value for p in _ACTIVE_DRIVING_PURPOSES]}, "
                f"but got '{purpose.value}'."
            )
        return self
