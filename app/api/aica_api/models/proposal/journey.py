"""JourneyState contract (data-model.md §"JourneyState") — snapshot, shape only.

No progression logic in P1 — this is a pure snapshot of lifecycle stage,
motion state, and the currently-active service/plan (if any). P4
(data-model.md §"JourneyState (extend journey.py)") additively extends this
with playback/previous-content/rejection-tracking fields consumed by the
journey engine (``services/proposal_journey.py``) — every new field is
DEFAULTED so a pre-P4 persisted run (only the original 4 fields) still
deserializes unchanged (back-compat test:
``tests/proposal/test_journey_state_backcompat.py``).

This module is ISOLATED from trigger models:
  - Do NOT import from ``aica_api.models`` (the trigger package).
  - Enums are imported from ``.enums`` only.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from aica_api.models.proposal.enums import (
    LifecycleStage,
    MotionState,
    PlaybackState,
    ServiceId,
)

__all__ = ["JourneyState", "PreviousContent"]


class PreviousContent(BaseModel):
    """The service/plan that was active before the current one (P4) — used to
    restore playback when a ``stop`` action returns to prior content."""

    service_id: ServiceId | None = None
    plan_ref: str | None = None


class JourneyState(BaseModel):
    """A snapshot of the journey at a point in the proposal run."""

    lifecycle_stage: LifecycleStage
    motion_state: MotionState
    active_service_id: ServiceId | None
    active_plan_id: str | None
    # P4 additions (data-model.md §"JourneyState (extend journey.py)") — all
    # defaulted so existing persisted (pre-P4) runs still deserialize.
    playback_state: PlaybackState = PlaybackState.idle
    current_plan_ref: str | None = None
    previous_content: PreviousContent | None = None
    rejected_service_ids: list[ServiceId] = Field(default_factory=list)
