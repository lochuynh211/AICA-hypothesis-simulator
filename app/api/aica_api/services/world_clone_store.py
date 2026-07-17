"""World override-application helper — P3 Editable World, Driver Profiles &
Contrast (feature 014); P7 e2e vertical slice (feature 017).

Originally home to the "clone a base seed and change ONE variable" contrast
feature (``WorldCloneStore``); that user-facing clone CRUD has since been
removed. What remains is the pure ``apply_overrides`` helper it was built
on top of (research.md D2), which is SHARED with the P7 recompute endpoint
(``routers/proposal.py``'s ``recompute_proposal_run``) and must keep working.

Given a base ``World`` plus zero or more ``FieldOverride``s, ``apply_overrides``:

  1. applies each override at its dotted/bracketed ``path`` onto a deep copy
     of the base world's JSON-mode dump,
  2. re-validates the result as a complete ``World`` (structural — enum/range/
     purpose-stage — via the model itself),
  3. re-validates catalog references via the existing
     ``services/world_validation.validate_world`` whenever ``catalog`` is
     supplied (reused unchanged — **NOT** via ``mdg``). If ``catalog`` is
     ``None`` (unresolvable/quarantined dataset) AND the resulting world
     actually references the catalog in any way
     (``world_validation.has_catalog_references``), this is a validation
     error (``unresolvable_catalog``) rather than a silent skip. A world with
     NO catalog references at all is still safe to apply without a catalog.
  4. computes a deterministic ``diff``: EXACTLY the overridden path(s) with
     their before/after values (never a spurious diff from re-serialization,
     since we only read the same paths back out of the base/result dumps —
     never a recursive whole-object diff).

An EMPTY ``overrides`` list is allowed and returns ``base_world`` unchanged
with an empty diff (recompute's pure lifecycle-stage-only case).

Isolation (HARD ISOLATION RULE / CLAUDE.md, enforced by the import-guard
test): this module imports only ``aica_api.models.proposal.*``,
``aica_api.services.world_validation``, stdlib, and pydantic — never the
trigger ``aica_api.models`` package, and never ``mdg``.

Public API:
  apply_overrides(base_world, overrides, catalog=None) -> (World, list[FieldDiff])
  InvalidOverrideError — malformed/unknown path, invalid value, or dangling
    catalog reference; carries ``.issues`` for a 422 response.
"""
from __future__ import annotations

import copy
import re
from typing import Any

from pydantic import ValidationError

from aica_api.models.proposal.song_schema import Song
from aica_api.models.proposal.world import FieldDiff, FieldOverride, World
from aica_api.services.world_validation import ValidationIssue, has_catalog_references, validate_world

__all__ = [
    "InvalidOverrideError",
    "apply_overrides",
]


class InvalidOverrideError(Exception):
    """Raised for a malformed/unknown override path, a value that produces a
    structurally invalid world, or an override that leaves a dangling
    catalog reference. Carries ``.issues`` (``list[ValidationIssue]``) so
    callers (the router) can render a 422 with field-level detail.
    """

    def __init__(self, issues: list[ValidationIssue]) -> None:
        self.issues = issues
        super().__init__("; ".join(issue.message for issue in issues) or "Invalid override.")


def _issue(*, path: str, code: str, message: str) -> ValidationIssue:
    return ValidationIssue(path=path, code=code, message=message)


# ---------------------------------------------------------------------------
# Dotted/bracketed path traversal — "situation.drowsiness_level",
# "driver_profile.played_items[0].track_id", etc.
# ---------------------------------------------------------------------------

_PATH_SEGMENT_RE = re.compile(r"^([^\[\]]+)((?:\[\d+\])*)$")
_BRACKET_INDEX_RE = re.compile(r"\[(\d+)\]")


def _split_path(path: str) -> list[str | int]:
    """Split a dotted/bracketed override path into dict keys / list indices."""
    if not path:
        raise InvalidOverrideError([_issue(path="", code="empty_path", message="Override path must not be empty.")])

    tokens: list[str | int] = []
    for segment in path.split("."):
        match = _PATH_SEGMENT_RE.match(segment)
        if not match or not match.group(1):
            raise InvalidOverrideError(
                [_issue(path=path, code="malformed_path", message=f"Malformed override path segment: {segment!r}.")]
            )
        key, brackets = match.groups()
        tokens.append(key)
        tokens.extend(int(idx) for idx in _BRACKET_INDEX_RE.findall(brackets))
    return tokens


def _get_at_path(data: Any, tokens: list[str | int], *, full_path: str) -> Any:
    node = data
    for token in tokens:
        try:
            node = node[token]
        except (KeyError, IndexError, TypeError) as exc:
            raise InvalidOverrideError(
                [
                    _issue(
                        path=full_path,
                        code="unknown_override_path",
                        message=f"Unknown override path: {full_path!r} (no such field {token!r}).",
                    )
                ]
            ) from exc
    return node


def _set_at_path(data: Any, tokens: list[str | int], value: Any, *, full_path: str) -> None:
    node = _get_at_path(data, tokens[:-1], full_path=full_path) if len(tokens) > 1 else data
    last = tokens[-1]
    if isinstance(last, int):
        if not isinstance(node, list) or not (0 <= last < len(node)):
            raise InvalidOverrideError(
                [
                    _issue(
                        path=full_path,
                        code="unknown_override_path",
                        message=f"Unknown override path: {full_path!r} (list index {last!r} out of range).",
                    )
                ]
            )
    else:
        if not isinstance(node, dict):
            raise InvalidOverrideError(
                [
                    _issue(
                        path=full_path,
                        code="unknown_override_path",
                        message=f"Unknown override path: {full_path!r} (not an object at {last!r}).",
                    )
                ]
            )
    node[last] = value


def _pydantic_issues(exc: ValidationError) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for error in exc.errors():
        loc = error.get("loc", ())
        path = ".".join(str(part) for part in loc) if loc else "world"
        issues.append(_issue(path=path, code=error.get("type", "invalid_value"), message=error.get("msg", "Invalid value.")))
    return issues


def apply_overrides(
    base_world: World,
    overrides: list[FieldOverride | dict],
    *,
    catalog: list[Song] | None = None,
) -> tuple[World, list[FieldDiff]]:
    """Apply ``overrides`` onto ``base_world`` and return ``(new_world, diffs)``.

    Pure, no persistence, no side effects (research.md D2). An EMPTY
    ``overrides`` list is allowed (recompute's pure lifecycle-stage-only
    case): it returns ``base_world`` unchanged with an empty diff, never
    raising.

    Each override is applied at its dotted/bracketed path onto a deep copy
    of ``base_world``'s JSON dump, the result is re-validated as a complete
    ``World``, and (when ``catalog`` is supplied, or the resulting world has
    catalog references and none was supplied) checked for dangling catalog
    references.

    Raises:
        InvalidOverrideError: malformed/unknown path, a value that makes the
            resulting world structurally invalid, or a dangling/unresolvable
            catalog reference. Carries ``.issues`` for a 422 response.
    """
    validated_overrides = [o if isinstance(o, FieldOverride) else FieldOverride.model_validate(o) for o in overrides]
    if not validated_overrides:
        return base_world, []

    base_dict = base_world.model_dump(mode="json")
    cloned_dict = copy.deepcopy(base_dict)

    diffs: list[FieldDiff] = []
    for override in validated_overrides:
        tokens = _split_path(override.path)
        before = _get_at_path(base_dict, tokens, full_path=override.path)
        _set_at_path(cloned_dict, tokens, override.value, full_path=override.path)
        after = _get_at_path(cloned_dict, tokens, full_path=override.path)
        diffs.append(FieldDiff(path=override.path, before=before, after=after))

    try:
        cloned_world = World.model_validate(cloned_dict)
    except ValidationError as exc:
        raise InvalidOverrideError(_pydantic_issues(exc)) from exc

    if catalog is not None:
        issues = validate_world(cloned_world, catalog)
        if issues:
            raise InvalidOverrideError(issues)
    elif has_catalog_references(cloned_world):
        # An unresolvable/missing catalog for a world that DOES reference the
        # catalog is a validation error, never a silent skip. A world with no
        # catalog references at all is still safe to apply without a catalog.
        raise InvalidOverrideError(
            [
                _issue(
                    path="control_inputs.dataset_id",
                    code="unresolvable_catalog",
                    message=(
                        f"Cannot validate catalog references for dataset "
                        f"{cloned_world.control_inputs.dataset_id!r}: no catalog was "
                        "supplied (unknown/quarantined dataset), but the world "
                        "contains catalog references that would need checking."
                    ),
                )
            ]
        )

    return cloned_world, diffs
