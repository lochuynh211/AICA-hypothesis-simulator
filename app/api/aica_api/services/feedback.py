"""Feedback service — effective schema, validation, and append-only persistence.

M5 implementation (T004, T005, T006):
  - effective_schema(package) -> list[FieldDef]
      V1 baseline ∪ package extras; raises SchemaCollisionError on key collision.
  - validate(payload, schema, run_log) -> list[FeedbackValidationError]
      Validates labels and target scope/event_ref; returns [] when valid.
  - append_feedback(run_id, feedback_event, runs_dir) -> None
      Active run  → delegates to run_manager.append_feedback (EvidenceRecorder).
      Inactive run → loads on-disk RunLog, appends, writes atomically.
      Run not found → raises RunNotFoundError.

NON-ALGORITHMIC: this module never touches the adapter or the decision path.
No new dependencies — stdlib + existing project packages only.
"""

from __future__ import annotations

import pathlib
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from aica_api.models.feedback import FieldDef, FeedbackEvent, V1_FEEDBACK_SCHEMA
from aica_api.models.log import RunLog
from aica_api.models.package import PackageManifest
from aica_api.storage.file_store import read_json, write_json_atomic


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class SchemaCollisionError(ValueError):
    """Raised when a package extra field key collides with a V1 baseline key."""


@dataclass
class FeedbackValidationError:
    """A single structured validation error returned by validate()."""

    field: str
    message: str

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, FeedbackValidationError):
            return NotImplemented
        return self.field == other.field and self.message == other.message


# ---------------------------------------------------------------------------
# T004 — effective_schema
# ---------------------------------------------------------------------------


def effective_schema(package: PackageManifest) -> list[FieldDef]:
    """Return the effective schema for a package: V1 baseline ∪ package extras.

    The V1 baseline (9 fields, §13.2) always comes first.  Package-declared
    extra fields are parsed from ``package.feedback_schema`` (a list of raw
    dicts) and appended in order.

    Args:
        package: The loaded PackageManifest.

    Returns:
        Combined list of FieldDef objects (V1 fields + extras).

    Raises:
        SchemaCollisionError: If any extra field's key collides with a V1 key.
    """
    v1_keys: set[str] = {fd.key for fd in V1_FEEDBACK_SCHEMA}
    extras: list[FieldDef] = []

    for raw in package.feedback_schema:
        try:
            fd = FieldDef(**raw)
        except ValidationError as e:
            raise SchemaCollisionError(
                f"Malformed feedback_schema field in package {package.id!r}: {e}"
            ) from e
        if fd.key in v1_keys:
            raise SchemaCollisionError(
                f"Package extra feedback_schema key {fd.key!r} collides with a "
                f"V1 baseline field; remove it from the package manifest."
            )
        extras.append(fd)

    return list(V1_FEEDBACK_SCHEMA) + extras


# ---------------------------------------------------------------------------
# T005 — validate
# ---------------------------------------------------------------------------


def validate(
    payload: FeedbackEvent,
    schema: list[FieldDef],
    run_log: RunLog,
) -> list[FeedbackValidationError]:
    """Validate a FeedbackEvent against the effective schema and run log.

    All label fields are optional — empty labels with only a comment is valid,
    and a completely empty payload is valid.

    Label validation rules:
    - Every key in labels must be present in the effective schema.
    - choice field: value is a plain option string (must be in options), OR
      a dict ``{"choice": <str>, "note": <str>}`` when the field has note=True.
    - text field: value must be a string.
    - scale field: value must be numeric; must be within [min, max] if set.

    Target validation rules:
    - scope="run": no event_ref required.
    - scope="decision": event_ref must index a TickEvent in run_log.events.
    - scope="proposal": event_ref must index a TickEvent with a fired proposal
      (fire_control.fired=True and proposal is not None).
    - scope="action": event_ref must index an ActionEvent in run_log.events.

    Args:
        payload:  The FeedbackEvent to validate.
        schema:   The effective schema (from effective_schema()).
        run_log:  The current run log (used for target event_ref resolution).

    Returns:
        A list of FeedbackValidationError instances.  Empty list = valid.
    """
    errors: list[FeedbackValidationError] = []
    schema_by_key: dict[str, FieldDef] = {fd.key: fd for fd in schema}

    # ── Validate labels ──────────────────────────────────────────────────────
    for key, value in payload.labels.items():
        if key not in schema_by_key:
            errors.append(FeedbackValidationError(
                field=f"labels.{key}",
                message=f"Unknown label key {key!r}; not in the effective schema.",
            ))
            continue

        fd = schema_by_key[key]
        _validate_label_value(fd, key, value, errors)

    # ── Validate target scope / event_ref ────────────────────────────────────
    _validate_target(payload.target, run_log, errors)

    return errors


def _validate_label_value(
    fd: FieldDef,
    key: str,
    value: Any,
    errors: list[FeedbackValidationError],
) -> None:
    """Validate a single label value against its FieldDef; append errors in place."""
    if fd.type == "choice":
        _validate_choice_value(fd, key, value, errors)
    elif fd.type == "text":
        if not isinstance(value, str):
            errors.append(FeedbackValidationError(
                field=f"labels.{key}",
                message=(
                    f"Text field {key!r} requires a string value; "
                    f"got {type(value).__name__!r}."
                ),
            ))
    elif fd.type == "scale":
        _validate_scale_value(fd, key, value, errors)


def _validate_choice_value(
    fd: FieldDef,
    key: str,
    value: Any,
    errors: list[FeedbackValidationError],
) -> None:
    """Validate a choice field value (plain string or note-form dict)."""
    if isinstance(value, str):
        # Plain option string
        if fd.options and value not in fd.options:
            errors.append(FeedbackValidationError(
                field=f"labels.{key}",
                message=(
                    f"Value {value!r} is not a valid option for field {key!r}; "
                    f"expected one of {fd.options!r}."
                ),
            ))
    elif isinstance(value, dict):
        # Dict form {choice, note?} — only allowed when note=True
        if not fd.note:
            errors.append(FeedbackValidationError(
                field=f"labels.{key}",
                message=(
                    f"Field {key!r} does not accept note-form dict values "
                    f"(note=False); provide a plain option string instead."
                ),
            ))
            return
        if "choice" not in value:
            errors.append(FeedbackValidationError(
                field=f"labels.{key}",
                message=f"{key}: object form requires a 'choice' key",
            ))
            return
        choice = value.get("choice")
        note = value.get("note")
        if fd.options and choice not in fd.options:
            errors.append(FeedbackValidationError(
                field=f"labels.{key}.choice",
                message=(
                    f"Choice {choice!r} is not a valid option for field {key!r}; "
                    f"expected one of {fd.options!r}."
                ),
            ))
        if note is not None and not isinstance(note, str):
            errors.append(FeedbackValidationError(
                field=f"labels.{key}.note",
                message=(
                    f"Note value for field {key!r} must be a string; "
                    f"got {type(note).__name__!r}."
                ),
            ))
    else:
        errors.append(FeedbackValidationError(
            field=f"labels.{key}",
            message=(
                f"Choice field {key!r} requires a string or a "
                f"{{choice, note}} dict; got {type(value).__name__!r}."
            ),
        ))


def _validate_scale_value(
    fd: FieldDef,
    key: str,
    value: Any,
    errors: list[FeedbackValidationError],
) -> None:
    """Validate a scale field value (numeric within [min, max])."""
    if not isinstance(value, (int, float)):
        errors.append(FeedbackValidationError(
            field=f"labels.{key}",
            message=(
                f"Scale field {key!r} requires a numeric value; "
                f"got {type(value).__name__!r}."
            ),
        ))
        return
    if fd.min is not None and value < fd.min:
        errors.append(FeedbackValidationError(
            field=f"labels.{key}",
            message=(
                f"Scale value {value} for field {key!r} is below minimum {fd.min}."
            ),
        ))
    if fd.max is not None and value > fd.max:
        errors.append(FeedbackValidationError(
            field=f"labels.{key}",
            message=(
                f"Scale value {value} for field {key!r} exceeds maximum {fd.max}."
            ),
        ))


def _validate_target(target: Any, run_log: RunLog, errors: list[FeedbackValidationError]) -> None:
    """Validate the FeedbackTarget scope and event_ref against run_log.events."""
    scope = target.scope

    if scope == "run":
        # No event_ref required for run-level feedback
        return

    event_ref = target.event_ref
    if event_ref is None:
        errors.append(FeedbackValidationError(
            field="target.event_ref",
            message=(
                f"event_ref is required for scope={scope!r}; provide an "
                f"index into the run log events list."
            ),
        ))
        return

    n_events = len(run_log.events)
    if event_ref < 0 or event_ref >= n_events:
        errors.append(FeedbackValidationError(
            field="target.event_ref",
            message=(
                f"event_ref={event_ref} is out of range; "
                f"run log has {n_events} event(s) (valid indices: 0..{n_events - 1})."
            ),
        ))
        return

    event = run_log.events[event_ref]
    actual_kind = event.kind

    if scope == "decision":
        if actual_kind != "tick":
            errors.append(FeedbackValidationError(
                field="target.event_ref",
                message=(
                    f"scope='decision' requires a TickEvent at event_ref={event_ref}; "
                    f"found kind={actual_kind!r}."
                ),
            ))

    elif scope == "proposal":
        if actual_kind != "tick":
            errors.append(FeedbackValidationError(
                field="target.event_ref",
                message=(
                    f"scope='proposal' requires a TickEvent at event_ref={event_ref}; "
                    f"found kind={actual_kind!r}."
                ),
            ))
        else:
            dr = event.trace.decision_result
            if not (dr.fire_control.fired and dr.proposal is not None):
                errors.append(FeedbackValidationError(
                    field="target.event_ref",
                    message=(
                        f"scope='proposal' requires a TickEvent with a fired proposal "
                        f"at event_ref={event_ref}; the decision at this tick did not "
                        f"fire a proposal (fire_control.fired=False or proposal=None)."
                    ),
                ))

    elif scope == "action":
        if actual_kind != "action":
            errors.append(FeedbackValidationError(
                field="target.event_ref",
                message=(
                    f"scope='action' requires an ActionEvent at event_ref={event_ref}; "
                    f"found kind={actual_kind!r}."
                ),
            ))


# ---------------------------------------------------------------------------
# T006 — append_feedback
# ---------------------------------------------------------------------------


def append_feedback(
    run_id: str,
    feedback_event: FeedbackEvent,
    runs_dir: pathlib.Path,
) -> None:
    """Append a FeedbackEvent to a run (active or on-disk), never altering prior events.

    Resolution order:
    1. If the run is active (in the run_manager registry), delegates to
       ``run_manager.append_feedback`` which appends via the EvidenceRecorder.
    2. Otherwise, loads the on-disk ``runs/{run_id}.json`` RunLog, appends the
       event, and writes the updated log atomically.
    3. If the run is not active and no file exists, raises RunNotFoundError.

    NON-ALGORITHMIC: this function only appends to the events list.  It never
    reads, evaluates, or modifies any TickEvent, DecisionResult, or adapter
    state.  Prior TickEvents are untouched — byte-for-byte identical after the
    call.

    Args:
        run_id:         The run identifier.
        feedback_event: The FeedbackEvent to append (kind="feedback").
        runs_dir:       Directory containing ``<run_id>.json`` files.

    Raises:
        RunNotFoundError: If run_id is not in the active registry and no
                          on-disk log exists at ``runs_dir/{run_id}.json``.
    """
    # Lazy import to avoid any potential circular-import issues; run_manager
    # does not import from this module so there is no cycle in practice.
    from aica_api.services import run_manager
    from aica_api.services.run_manager import RunNotFoundError

    # ── Try active run first ─────────────────────────────────────────────────
    try:
        run_manager.append_feedback(run_id, feedback_event)
        return
    except RunNotFoundError:
        pass

    # ── Try on-disk run ──────────────────────────────────────────────────────
    run_path = runs_dir / f"{run_id}.json"
    if not run_path.exists():
        raise RunNotFoundError(
            f"Run {run_id!r} not found: not in the active registry and no "
            f"on-disk log at {run_path}."
        )

    data = read_json(str(run_path))
    run_log = RunLog(**data)
    # Append only — never touch existing events
    run_log.events.append(feedback_event)
    # Idempotency assumption: loading via RunLog(**data) then re-serializing with
    # model_dump(mode="json") produces byte-identical output for prior events ONLY
    # because EvidenceRecorder writes with the same Pydantic serialization path.
    # A future Pydantic version bump or serialization change could reformat existing
    # events on the first append — if that matters, compare before/after and gate on
    # equality.  Until then this round-trip is trusted to be stable within a single
    # installed version.
    write_json_atomic(str(run_path), run_log.model_dump(mode="json"))
