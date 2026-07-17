"""RecomputeRequest contract (data-model.md §"New model: RecomputeRequest").

Request body shape for ``POST /api/proposal/runs/{run_id}/recompute`` (P7).
This module only defines the shape — applying overrides, re-freezing a
``SetupSnapshot``, and dispatching a fresh service (+ optionally content)
proposal is the recompute endpoint's job (later P7 units).

This module is ISOLATED from trigger models:
  - Do NOT import from ``aica_api.models`` (the trigger package).
  - Enums/models are imported from ``.world`` only (the existing
    ``FieldOverride`` shape, unchanged — no new override grammar).
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from aica_api.models.proposal.world import FieldOverride

__all__ = ["RecomputeRequest"]


class RecomputeRequest(BaseModel):
    """Request body for ``POST /api/proposal/runs/{run_id}/recompute``.

    ``overrides`` reuses the existing P3 ``FieldOverride`` shape — an empty
    list is valid (a pure lifecycle-stage recompute with no context edit).
    The four optional dicts mirror the create-run/select-service convention:
    empty falls back to the current head's (service) or the content
    package's manifest defaults (content, quick_check only).
    """

    overrides: list[FieldOverride] = []
    parameters: dict[str, Any] = {}
    hyperparameters: dict[str, Any] = {}
    content_parameters: dict[str, Any] = {}
    content_hyperparameters: dict[str, Any] = {}
