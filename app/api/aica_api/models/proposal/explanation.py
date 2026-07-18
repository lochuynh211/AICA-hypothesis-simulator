"""Explanation contracts (feature 019 — LLM-generated rationale).

An ``Explanation`` is an APPEND-ONLY narration record layered over an
already-computed transparent decision. The LLM (local Ollama, or in-browser
Gemini Nano) rewrites ONLY the human-readable rationale sentence shown at the
bottom of a candidate/item ``ReasonBreakdown`` — it never influences a score,
ranking, or any feature contribution (Constitution Principles I / II / V). The
numeric trace and supporting/opposing chips are untouched.

Persistence policy:
  - ``backend`` provider (and its ``template`` fallback) → persisted here so the
    generated text is reproducible/auditable (carries ``model`` + ``prompt_hash``).
  - ``browser`` provider (Gemini Nano) → display-only, NEVER persisted (its
    on-device output cannot be deterministically reproduced server-side).

This module is ISOLATED from trigger models:
  - Do NOT import from ``aica_api.models`` (the trigger package).
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class ExplainMessage(BaseModel):
    """One chat message in the grounded prompt."""

    role: Literal["system", "user"]
    content: str


class ExplanationPrompt(BaseModel):
    """The provider-agnostic prompt built server-side from the decision trace.

    The SAME prompt is handed to BOTH providers (the backend runs it through
    Ollama; the browser runs it through Gemini Nano) so the two engines are
    compared on identical grounding. ``grounding`` is the structured fact
    bundle the messages were rendered from — kept for transparency/debugging
    and never contains anything not already in the persisted decision trace.
    """

    messages: list[ExplainMessage]
    grounding: dict


class Explanation(BaseModel):
    """Append-only narration record persisted in ``ProposalRunLog.explanations``.

    ``rationale`` is the positional bilingual pair ``[ja, en]`` (the same shape
    the frontend ``pickRationale`` expects). ``provider_used`` records who
    actually produced the text: ``backend`` (Ollama), ``template`` (deterministic
    fallback after an Ollama failure), or ``browser`` (only when a client chose
    to persist Nano output — not done in v1). ``fell_back`` is True whenever the
    requested provider failed and the deterministic template was used instead,
    so a review never mistakes a fallback for a real generation.
    """

    step: Literal["service", "content"]
    target_id: str
    requested_provider: Literal["backend", "browser"]
    provider_used: Literal["backend", "browser", "template"]
    model: str
    rationale: list[str]
    fell_back: bool
    error: str | None = None
    prompt_hash: str
    generated_at: str
