"""PurposeStageServiceMatrix contract (data-model.md §"PurposeStageServiceMatrix").

Loader/resolver over the frozen versioned artifact
``proposal_contracts/matrix/purpose_stage_matrix.v1.json`` (the 6 spec §7.5
rows). A run freezes the matrix version at start.

This module is ISOLATED from trigger models:
  - Do NOT import from ``aica_api.models`` (the trigger package).
  - Enums are imported from ``.enums`` only.

The ``during_rest_stopped`` row carries an explanatory ``_note`` key in the
frozen JSON (rest actions at that stage are journey-engine-owned and have no
``ServiceId`` members — the row legitimately resolves to an empty list).
``MatrixRow`` tolerates and discards that key (default pydantic ``extra``
behavior is ``"ignore"``).
"""
from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, model_validator

from aica_api.models.proposal.enums import LifecycleStage, ServiceId, TriggerPurpose

__all__ = [
    "MatrixResolutionError",
    "MatrixRow",
    "PurposeStageServiceMatrix",
]


# ---------------------------------------------------------------------------
# Compatibility rules — same rule as SelectorInput / ProposalOpportunity.
# ---------------------------------------------------------------------------

_REST_STAGES = frozenset(
    {
        LifecycleStage.before_rest_until_stop,
        LifecycleStage.during_rest_stopped,
        LifecycleStage.after_rest_before_restart,
    }
)

_ACTIVE_DRIVING_PURPOSES = frozenset(
    {
        TriggerPurpose.inattentive_driving_prevention_recovery,
        TriggerPurpose.route_music,
        TriggerPurpose.child_passenger_experience,
    }
)

# The post-rest row must list exactly these 5 services (data-model.md).
_POST_REST_EXPECTED_SERVICES = frozenset(
    {
        ServiceId.live_viewing,
        ServiceId.stretch_video,
        ServiceId.full_karaoke,
        ServiceId.oshi_reexperience,
        ServiceId.call_response_stopped,
    }
)


class MatrixResolutionError(Exception):
    """Raised by ``resolve()`` for an incompatible or unknown
    ``(trigger_purpose, lifecycle_stage)`` pair — i.e. no matrix row matches."""


# ---------------------------------------------------------------------------
# MatrixRow
# ---------------------------------------------------------------------------


class MatrixRow(BaseModel):
    """One row of the purpose/stage/allowed-services matrix.

    ``allowed_service_ids`` may legitimately be empty (the
    ``during_rest_stopped`` row). Extra keys (e.g. the frozen JSON's ``_note``
    explanatory field) are tolerated and discarded — pydantic's default
    ``extra="ignore"`` behavior.
    """

    trigger_purpose: TriggerPurpose
    lifecycle_stage: LifecycleStage
    allowed_service_ids: list[ServiceId]

    @model_validator(mode="after")
    def purpose_stage_compatible(self) -> "MatrixRow":
        purpose = self.trigger_purpose
        stage = self.lifecycle_stage

        if stage in _REST_STAGES and purpose != TriggerPurpose.rest_recommended:
            raise ValueError(
                f"Lifecycle stage '{stage.value}' is only compatible with "
                f"trigger_purpose 'rest_recommended', but got '{purpose.value}'."
            )
        if (
            stage == LifecycleStage.active_driving_content
            and purpose not in _ACTIVE_DRIVING_PURPOSES
        ):
            raise ValueError(
                f"Lifecycle stage 'active_driving_content' is only compatible "
                f"with purposes {[p.value for p in _ACTIVE_DRIVING_PURPOSES]}, "
                f"but got '{purpose.value}'."
            )
        return self


# ---------------------------------------------------------------------------
# PurposeStageServiceMatrix
# ---------------------------------------------------------------------------


class PurposeStageServiceMatrix(BaseModel):
    """The frozen purpose/stage/allowed-services matrix (data-model.md).

    Validators
    ----------
    1. Exactly 6 rows (spec §7.5).
    2. The ``after_rest_before_restart`` (post-rest) row lists exactly the 5
       expected services incl. ``call_response_stopped``.
    3. Every ``allowed_service_ids`` entry is a valid ``ServiceId`` — enforced
       structurally by ``MatrixRow``'s field type.
    """

    matrix_version: str
    rows: list[MatrixRow]

    @model_validator(mode="after")
    def validate_six_rows(self) -> "PurposeStageServiceMatrix":
        if len(self.rows) != 6:
            raise ValueError(f"matrix must have exactly 6 rows, got {len(self.rows)}.")
        return self

    @model_validator(mode="after")
    def validate_post_rest_row(self) -> "PurposeStageServiceMatrix":
        post_rest_rows = [
            row
            for row in self.rows
            if row.trigger_purpose == TriggerPurpose.rest_recommended
            and row.lifecycle_stage == LifecycleStage.after_rest_before_restart
        ]
        if len(post_rest_rows) != 1:
            raise ValueError(
                "expected exactly one 'rest_recommended' / "
                "'after_rest_before_restart' (post-rest) row, "
                f"found {len(post_rest_rows)}."
            )
        actual = set(post_rest_rows[0].allowed_service_ids)
        if actual != _POST_REST_EXPECTED_SERVICES:
            raise ValueError(
                "the post-rest row must list exactly "
                f"{sorted(s.value for s in _POST_REST_EXPECTED_SERVICES)}, "
                f"got {sorted(s.value for s in actual)}."
            )
        return self

    # ------------------------------------------------------------------
    # Loader
    # ------------------------------------------------------------------

    @classmethod
    def load(cls, path: Path) -> "PurposeStageServiceMatrix":
        """Load and validate the matrix from a frozen JSON artifact path."""
        with path.open(encoding="utf-8") as fh:
            data = json.load(fh)
        return cls(matrix_version=data["matrix_version"], rows=data["rows"])

    # ------------------------------------------------------------------
    # Resolver
    # ------------------------------------------------------------------

    def resolve(
        self, trigger_purpose: TriggerPurpose, lifecycle_stage: LifecycleStage
    ) -> list[ServiceId]:
        """Return the allowed service ids for ``(trigger_purpose, lifecycle_stage)``.

        Raises ``MatrixResolutionError`` if no row matches — i.e. the pair is
        incompatible (per the compatibility rule) or simply not represented
        in the frozen matrix.
        """
        for row in self.rows:
            if (
                row.trigger_purpose == trigger_purpose
                and row.lifecycle_stage == lifecycle_stage
            ):
                return list(row.allowed_service_ids)
        raise MatrixResolutionError(
            f"No matrix row for (trigger_purpose={trigger_purpose.value!r}, "
            f"lifecycle_stage={lifecycle_stage.value!r}); the pair is either "
            "incompatible or not represented in the frozen matrix."
        )
