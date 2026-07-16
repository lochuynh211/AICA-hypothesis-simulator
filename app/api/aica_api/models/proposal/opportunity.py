"""ProposalOpportunity contract — the neutral start-of-proposal record.

Authoritative field spec: data-model.md §"ProposalOpportunity".

No UI state; no trigger-tick dependency. Carries only what is needed to
resolve the allowed-service set from the frozen purpose/stage matrix and
seed a deterministic mock run.

This module is ISOLATED from trigger models:
  - Do NOT import from ``aica_api.models`` (the trigger package).
  - Enums are imported from ``.enums`` only.
"""
from __future__ import annotations

from pydantic import BaseModel, field_validator, model_validator

from aica_api.models.proposal.enums import LifecycleStage, ServiceId, TriggerPurpose

# ---------------------------------------------------------------------------
# Compatibility rules (data-model.md — same rule as SelectorInput)
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


class ProposalOpportunity(BaseModel):
    """The neutral start-of-proposal record (data-model.md §ProposalOpportunity).

    Validators
    ----------
    1. Purpose / stage must be compatible (rest stages only with
       ``rest_recommended``; ``active_driving_content`` only with the three
       non-rest purposes) — mirrors ``SelectorInput``'s rule.
    2. ``allowed_service_ids`` must be non-empty. Note: P1's matrix resolves
       an EMPTY allowed set for ``during_rest_stopped`` (journey-engine-owned
       rest actions have no ``ServiceId`` members), so such an opportunity
       would fail this validator — EXPECTED, since P1 never constructs one.
    """

    opportunity_id: str
    trigger_purpose: TriggerPurpose
    lifecycle_stage: LifecycleStage
    allowed_service_ids: list[ServiceId]
    simulation_time: str | int
    run_seed: str

    # ------------------------------------------------------------------
    # Validator — opportunity_id non-empty
    # ------------------------------------------------------------------

    @field_validator("opportunity_id")
    @classmethod
    def opportunity_id_non_empty(cls, v: str) -> str:
        if not v:
            raise ValueError("opportunity_id must not be empty.")
        return v

    # ------------------------------------------------------------------
    # Validator — allowed_service_ids non-empty
    # ------------------------------------------------------------------

    @field_validator("allowed_service_ids")
    @classmethod
    def allowed_service_ids_non_empty(cls, v: list[ServiceId]) -> list[ServiceId]:
        if not v:
            raise ValueError(
                "allowed_service_ids must not be empty; "
                "supply at least one ServiceId."
            )
        return v

    # ------------------------------------------------------------------
    # Validator — purpose/stage compatibility
    # ------------------------------------------------------------------

    @model_validator(mode="after")
    def purpose_stage_compatible(self) -> "ProposalOpportunity":
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
