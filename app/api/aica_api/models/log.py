"""Log domain models — RunLog and the discriminated event types."""

from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field

from aica_api.models.decision import DecisionResult
from aica_api.models.run import EventPlan, RouteFacts, Snapshot, TickState


# ─── TraceEntry ──────────────────────────────────────────────────────────────


class TraceEntry(BaseModel):
    """The full DecisionResult for a single tick, stored alongside tick state."""

    tick_index: int
    decision_result: DecisionResult


# ─── Discriminated event types ────────────────────────────────────────────────


class TickEvent(BaseModel):
    """A simulator tick — tick state + algorithm trace."""

    kind: Literal["tick"]
    tick_index: int
    tick_state: TickState
    trace: TraceEntry


class ActionEvent(BaseModel):
    """A driver action (accept_rest / postpone) taken during a paused run."""

    kind: Literal["action"]
    tick_index: int
    action: str
    resulting_status: str


class AlgorithmError(BaseModel):
    """An algorithm exception or invalid-return event (FR-011)."""

    kind: Literal["algorithm_error"]
    tick_index: int
    error_type: str
    message: str


# Pydantic v2 discriminated union on the `kind` literal
Event = Annotated[
    Union[TickEvent, ActionEvent, AlgorithmError],
    Field(discriminator="kind"),
]


# ─── RunLog ───────────────────────────────────────────────────────────────────


class RunLog(BaseModel):
    """
    Append-only run evidence log persisted to runs/<run_id>.json.

    Events are written after every meaningful simulation event; existing
    events are never rewritten (FR-012).
    """

    run_id: str
    created_at: str
    simulator_version: str
    snapshot: Snapshot
    route_facts: RouteFacts
    event_plan: EventPlan
    run_mode: str = "standard"
    evidence_status: str = "standard"
    events: list[Event]
