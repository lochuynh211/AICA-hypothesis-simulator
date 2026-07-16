"""AlgorithmEvidence contract (data-model.md §"AlgorithmEvidence") — shape only.

Per-evaluation evidence (backend-owned). One ``AlgorithmEvidence`` is
recorded per ``evaluate()`` call (service or content step); errors/invalid
returns become explicit ``error`` records — never a faked result.

This module is ISOLATED from trigger models:
  - Do NOT import from ``aica_api.models`` (the trigger package).
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

__all__ = ["EvidenceError", "AlgorithmEvidence"]


class EvidenceError(BaseModel):
    """Structured error detail recorded when an ``evaluate()`` call raises or
    returns an invalid result."""

    category: str
    message: str


class AlgorithmEvidence(BaseModel):
    """Per-evaluation evidence appended to a ``ProposalRunLog``."""

    step: Literal["service", "content"]
    package_id: str
    contract_version: str
    schema_version: str
    matrix_version: str
    input_snapshot: dict
    output: dict | None
    error: EvidenceError | None
    used_feature_ids: list[str]
    unused_available_features: list[str]
    missing_features: list[str]
