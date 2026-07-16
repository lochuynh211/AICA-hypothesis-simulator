"""JourneyPreview contract (data-model.md §"JourneyPreview
(``proposal_journey_preview.py``)"; contracts/journey-api.md §"GET
/api/proposal/runs/{run_id}/journey/preview"; spec.md FR-017/SC-007).

Pure response shape only — no progression logic lives here (that is
``services/proposal_journey_preview.py::preview``'s job). ``binding`` is
ALWAYS ``False``: this is a non-binding, read-only rolling-horizon preview,
never a committed decision.

This module is ISOLATED from trigger models:
  - Do NOT import from ``aica_api.models`` (the trigger package).
  - Enums are imported from ``.enums`` only.
"""
from __future__ import annotations

from pydantic import BaseModel

from aica_api.models.proposal.enums import LifecycleStage

__all__ = ["JourneyPreview", "PreviewStep"]


class PreviewStep(BaseModel):
    """One step of the non-binding rolling-horizon preview chain."""

    label: str  # bilingual "EN / JA"
    lifecycle_stage: LifecycleStage
    note: str | None = None


class JourneyPreview(BaseModel):
    """The full non-binding preview response — always ``binding=False``."""

    binding: bool = False
    steps: list[PreviewStep]
