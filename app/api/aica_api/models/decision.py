"""Decision domain models — DecisionResult and the full §11 normalized shape."""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel


class ResultType(str, Enum):
    """The five exhaustive result types for a trigger evaluation."""

    NO_TRIGGER = "NO_TRIGGER"
    SOFT_WARNING = "SOFT_WARNING"
    REST_PROPOSAL = "REST_PROPOSAL"
    SEVERE_INTERVENTION = "SEVERE_INTERVENTION"
    NO_PRACTICAL_ACTION_FALLBACK = "NO_PRACTICAL_ACTION_FALLBACK"


class FireControl(BaseModel):
    """Fire-control flags for a single candidate or the overall result."""

    fired: bool = False
    suppressed: bool
    override: bool
    reason: str | None


class Candidate(BaseModel):
    """A trigger candidate evaluated for a single trigger category."""

    category: str
    exists: bool
    score: float
    state: str | None
    strength: str | None
    fire_control: FireControl


class Proposal(BaseModel):
    """A driver-facing proposal surfaced when a trigger fires."""

    id: str
    message: dict[str, str]
    options: list[str]


class DecisionResult(BaseModel):
    """
    The §11 normalized algorithm output.

    Every algorithm (built-in declarative_rule or future python_module) is
    coerced to exactly this shape by the adapter.  Rule-only runs leave
    hybrid-only fields (scores, states, next_package_runtime_state) empty.
    """

    result_type: ResultType
    trigger_candidate: bool
    selected_category: str | None
    score: float | None
    features: dict[str, str]
    scores: dict = {}
    states: dict = {}
    criteria: dict
    candidates: list[Candidate]
    fire_control: FireControl
    proposal: Proposal | None
    reason_inputs: list[str]
    explanation: str
    next_package_runtime_state: dict = {}
