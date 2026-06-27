"""Decision domain models — DecisionResult and the full §11 normalized shape.

M2 extensions:
- LocalizedText({ja, en}) type for localized strings.
- explanation field accepts str | LocalizedText | list[str|LocalizedText].
- Candidate.strength: gentle|clear|strong|None (already partly present).
- Candidate.state: str|None (already present).

M3 extensions:
- DecisionResult.result_type relaxed from ResultType enum to plain str.
  Python packages (python_module type) may emit their own result category strings
  verbatim (e.g. "MONOTONY_PROPOSAL", "SUPPRESSED", "NO_PROPOSAL").  No alias
  map — the value is stored exactly as received.
- ResultType is retained as the set of known built-in constants used by
  declarative_rule / weighted_score.  Because ResultType is a str-subclass enum,
  passing a ResultType member to a str field is valid and compares equal to its
  string value (ResultType.REST_PROPOSAL == "REST_PROPOSAL").
"""

from __future__ import annotations

from enum import Enum
from typing import Union

from pydantic import BaseModel


# ─── LocalizedText ────────────────────────────────────────────────────────────


class LocalizedText(BaseModel):
    """A localized string with Japanese and English variants."""

    ja: str
    en: str


# ─── Explanation type alias ───────────────────────────────────────────────────

# Accepted forms for DecisionResult.explanation:
#   - plain str (backward compat / M1)
#   - LocalizedText {ja, en}
#   - list of str or LocalizedText items
ExplanationItem = Union[str, LocalizedText]
ExplanationType = Union[str, LocalizedText, list[ExplanationItem]]


# ─── ResultType ──────────────────────────────────────────────────────────────


class ResultType(str, Enum):
    """Known built-in result type constants for declarative_rule / weighted_score.

    M3: DecisionResult.result_type is now a plain str field, so Python packages
    may emit custom category strings.  This enum is retained as the authoritative
    set of built-in values; callers may compare against it via str equality
    (ResultType.REST_PROPOSAL == "REST_PROPOSAL" is True).
    """

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

    M2: explanation accepts str | LocalizedText | list[str|LocalizedText].
    M3: result_type is a plain str — accepted verbatim, no alias map.
        Built-in algorithms continue to pass ResultType members; Pydantic
        coerces them to their string values.  Python packages may emit any
        string (e.g. "MONOTONY_PROPOSAL").  ResultType remains the canonical
        set of built-in constants.
    """

    result_type: str
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
    explanation: ExplanationType
    next_package_runtime_state: dict = {}
