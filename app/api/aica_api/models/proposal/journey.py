"""JourneyState contract (data-model.md §"JourneyState") — snapshot, shape only.

No progression logic in P1 — this is a pure snapshot of lifecycle stage,
motion state, and the currently-active service/plan (if any).

This module is ISOLATED from trigger models:
  - Do NOT import from ``aica_api.models`` (the trigger package).
  - Enums are imported from ``.enums`` only.
"""
from __future__ import annotations

from pydantic import BaseModel

from aica_api.models.proposal.enums import LifecycleStage, MotionState, ServiceId

__all__ = ["JourneyState"]


class JourneyState(BaseModel):
    """A snapshot of the journey at a point in the proposal run."""

    lifecycle_stage: LifecycleStage
    motion_state: MotionState
    active_service_id: ServiceId | None
    active_plan_id: str | None
