"""LLM file-handoff contract implementation.

Each LLM stage is a triple:
  CLI write_input → LLM reads input → LLM writes output → CLI read_output validates

Usage:
    write_input("s1b_naming", input_dict, Path("generation_workspace/handoff/s1b_input.json"))
    result = read_output("s1b_naming", Path("generation_workspace/handoff/s1b_output.json"))

read_output raises HandoffValidationError on:
  - malformed JSON
  - schema violation (missing required fields)
  - any item carrying an 'isrc' or audio-feature key (FR-005)

Validation uses pydantic (reuses CandidateName model) — no jsonschema dependency.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from mdg.models import CandidateName


# ---------------------------------------------------------------------------
# Exception
# ---------------------------------------------------------------------------

class HandoffValidationError(Exception):
    """Raised when a handoff file fails validation.

    Signals that the agent must re-run the prompt (no API retry).
    """

    def __init__(self, stage: str, reason: str) -> None:
        self.stage = stage
        self.reason = reason
        super().__init__(f"[{stage}] Handoff validation failed: {reason}")


# ---------------------------------------------------------------------------
# Stage registry
# ---------------------------------------------------------------------------

# Stages that produce CandidateName arrays (FR-005 firewall applies)
_CANDIDATE_NAME_STAGES: frozenset[str] = frozenset({
    "s1b_naming",
    "s0_5_strategy_a",
    "s1a_queries",
    "s1_5_shortlist",
})


# ---------------------------------------------------------------------------
# write_input
# ---------------------------------------------------------------------------

def write_input(stage: str, obj: Any, path: Path) -> None:
    """Serialize *obj* as schema-valid JSON to *path*.

    Creates parent directories if they do not exist.
    The written file is the input-context JSON consumed by the LLM prompt.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(obj, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# read_output
# ---------------------------------------------------------------------------

def read_output(stage: str, path: Path) -> Any:
    """Load and validate the LLM output file for *stage*.

    Raises HandoffValidationError on:
    - Missing or empty file
    - Malformed JSON
    - Output is not a list (for CandidateName stages)
    - Any item missing required CandidateName fields
    - Any item carrying 'isrc' or audio-feature keys (FR-005)

    Returns the validated list of dicts (not Pydantic objects, to avoid
    downstream re-validation friction).
    """
    path = Path(path)

    # --- parse JSON ---
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise HandoffValidationError(stage, f"Cannot read file: {exc}") from exc

    if not raw.strip():
        raise HandoffValidationError(stage, "Output file is empty")

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HandoffValidationError(stage, f"Malformed JSON: {exc}") from exc

    # --- dispatch by stage type ---
    if stage in _CANDIDATE_NAME_STAGES:
        return _validate_candidate_name_output(stage, data)

    # Unknown stage — return raw (caller is responsible for further validation)
    return data


def _validate_candidate_name_output(stage: str, data: Any) -> list[dict]:
    """Validate a CandidateName-array output (s1b_naming and siblings).

    Validates each item through the CandidateName Pydantic model so the
    FR-005 firewall runs automatically (model_validator rejects isrc/audio keys).
    """
    if not isinstance(data, list):
        raise HandoffValidationError(
            stage,
            f"Expected a JSON array (list) for stage '{stage}', got {type(data).__name__}"
        )

    validated: list[dict] = []
    for i, item in enumerate(data):
        if not isinstance(item, dict):
            raise HandoffValidationError(
                stage,
                f"Item[{i}] is not an object (dict), got {type(item).__name__}"
            )
        try:
            CandidateName.model_validate(item)
        except ValidationError as exc:
            raise HandoffValidationError(
                stage,
                f"Item[{i}] failed CandidateName validation: {exc}"
            ) from exc
        validated.append(item)

    return validated
