"""JourneyAction / JourneyTransition / TransitionRejection contracts
(data-model.md §"JourneyAction (request) / JourneyTransition (engine
output)") — P4 journey-engine request/response shapes.

``JourneyAction`` is the request body the journey-action endpoint parses;
``JourneyTransition`` is the PURE engine's return value (never persisted
directly — the router derives events/state/status updates from it and
persists those via ``proposal_run_manager``); ``TransitionRejection`` is the
structured (never silently-swallowed) precondition-failure shape (FR-012).

This module is ISOLATED from trigger models:
  - Do NOT import from ``aica_api.models`` (the trigger package).
  - Do NOT import from ``aica_api.algorithms``.
  - Enums/models are imported from ``.enums``/``.journey``/``.events`` only.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from aica_api.models.proposal.enums import JourneyActionType, ProposalRunStatus
from aica_api.models.proposal.events import DiscreteEvent
from aica_api.models.proposal.journey import JourneyState

__all__ = ["JourneyAction", "JourneyTransition", "TransitionRejection"]


class JourneyAction(BaseModel):
    """A single journey action request (contracts/journey-api.md)."""

    action_type: JourneyActionType
    payload: dict = Field(default_factory=dict)


class TransitionRejection(BaseModel):
    """A structured, never-silent precondition failure (FR-012)."""

    code: str
    message: str


class JourneyTransition(BaseModel):
    """The pure engine's return value for one applied action.

    Not persisted directly — the router appends ``events`` via
    ``proposal_run_manager.append_event`` and persists ``new_journey_state``/
    ``new_status`` via ``update_state``. When ``rejected`` is set, ``events``
    is empty and ``new_journey_state``/``new_status`` equal the run's
    pre-action state (no-op transition).
    """

    events: list[DiscreteEvent]
    new_journey_state: JourneyState
    new_status: ProposalRunStatus
    rejected: TransitionRejection | None = None
