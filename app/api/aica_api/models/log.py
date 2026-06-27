"""Log domain models — RunLog and the discriminated event types.

M2 extensions:
- TickEvent carries raw_state, feature_groups, driver_update, vehicle_update,
  package_runtime_state (in addition to the decision trace).
- RunLog carries original_values / modified_values + extended RunState snapshot fields.
- ActionEvent.action explicitly accepts "decline" (in addition to M1 accept_rest/postpone).
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, Field

from aica_api.models.decision import DecisionResult
from aica_api.models.run import EventPlan, FeatureGroups, RouteFacts, Snapshot, TickState


# ─── TraceEntry ──────────────────────────────────────────────────────────────


class TraceEntry(BaseModel):
    """The full DecisionResult for a single tick, stored alongside tick state."""

    tick_index: int
    decision_result: DecisionResult


# ─── Discriminated event types ────────────────────────────────────────────────


class TickEvent(BaseModel):
    """A simulator tick — tick state + algorithm trace.

    M2 additions: raw_state, feature_groups, driver_update, vehicle_update,
    package_runtime_state — all optional with empty defaults so M1 tick events
    can be deserialized without these fields.
    """

    kind: Literal["tick"]
    tick_index: int
    tick_state: TickState
    trace: TraceEntry

    # M2 extensions
    raw_state: dict[str, Any] = {}
    feature_groups: FeatureGroups = FeatureGroups()
    driver_update: dict[str, Any] = {}
    vehicle_update: dict[str, Any] = {}
    package_runtime_state: dict[str, Any] = {}


class ActionEvent(BaseModel):
    """A driver action taken during a paused run.

    M1 actions: accept_rest, postpone.
    M2 adds: decline (driver explicitly declines the proposal; run resumes or completes
    depending on route position).
    action is typed as str to remain flexible; "decline" is now an accepted value.
    """

    kind: Literal["action"]
    tick_index: int
    action: str  # accept_rest | postpone | decline (and any future additions)
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

    M2 additions: original_values, modified_values, initial/current parameter
    and hyperparameter snapshots.
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

    # M2 audit trail
    original_values: dict[str, Any] = {}
    modified_values: dict[str, Any] = {}
    initial_parameters: dict[str, Any] = {}
    current_parameters: dict[str, Any] = {}
    initial_hyperparameters: dict[str, Any] = {}
    current_hyperparameters: dict[str, Any] = {}
