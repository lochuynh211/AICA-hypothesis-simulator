"""DiscreteEvent contract (data-model.md §"DiscreteEvent") — shape only.

Appended to the run log for the mock flow (``OPPORTUNITY_OPENED``,
``SERVICE_SELECTED``, ``CONTENT_SELECTED``, ``ALGORITHM_ERROR`` in P1; the
remaining ``DiscreteEventType`` members exist as enum/shape only — no engine
emits them yet).

This module is ISOLATED from trigger models:
  - Do NOT import from ``aica_api.models`` (the trigger package).
  - Enums are imported from ``.enums`` only.
"""
from __future__ import annotations

from pydantic import BaseModel

from aica_api.models.proposal.enums import DiscreteEventType

__all__ = ["DiscreteEvent"]


class DiscreteEvent(BaseModel):
    """A single discrete event appended to a ``ProposalRunLog`` (append-only
    in usage; this model just holds the shape)."""

    event_type: DiscreteEventType
    at: str | int
    payload: dict
