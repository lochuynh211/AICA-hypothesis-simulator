"""Run domain models — RunState, EventPlan, TickState, RouteFacts, Snapshot."""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel

from aica_api.models.scenario import RouteSegment


class RunStatus(str, Enum):
    """State machine for a simulator run."""

    created = "created"
    playing = "playing"
    paused = "paused"
    completed = "completed"


# ─── Snapshot ────────────────────────────────────────────────────────────────


class ArtifactRef(BaseModel):
    """Lightweight identifier for a versioned artifact (package or scenario)."""

    id: str
    version: str
    hash: str


class Snapshot(BaseModel):
    """Frozen package + scenario references captured at run start."""

    package: ArtifactRef
    scenario: ArtifactRef


# ─── EventPlan ───────────────────────────────────────────────────────────────


class TickPlanEntry(BaseModel):
    """Per-tick schedule entry generated from event_presets at run start."""

    tick_index: int
    drowsiness_band: str
    route_fraction: float
    signal_duration: str
    rest_spot_eta: str

    model_config = {"extra": "allow"}


class EventPlan(BaseModel):
    """Frozen, deterministic per-tick schedule for a run."""

    ticks: list[TickPlanEntry]

    model_config = {"extra": "allow"}


# ─── RouteFacts ──────────────────────────────────────────────────────────────


class RouteFacts(BaseModel):
    """Bounded/snapshot route evidence (segments + band vocabularies)."""

    segments: list[RouteSegment]
    bands: dict[str, list[str]]

    model_config = {"extra": "allow"}


# ─── TickState ───────────────────────────────────────────────────────────────


class TickState(BaseModel):
    """Computed state at a single simulation tick."""

    tick_index: int
    elapsed_seconds: int
    route_fraction: float
    active_segment_id: str
    drowsiness_level: str
    fatigue_level: str
    signal_duration: str
    continuous_driving_time: str
    rest_spot_eta: str
    completed: bool

    model_config = {"extra": "allow"}


# ─── RunState ────────────────────────────────────────────────────────────────


class RunState(BaseModel):
    """Mutable runtime state for an active run."""

    run_id: str
    status: RunStatus
    current_tick: int
    pending_proposal: str | None
    package_runtime_state: dict[str, Any] = {}
    snapshot: Snapshot
    event_plan: EventPlan
    route_facts: RouteFacts
