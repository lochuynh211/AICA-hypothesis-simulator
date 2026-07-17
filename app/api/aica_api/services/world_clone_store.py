"""World clone store (T029) — P3 Editable World, Driver Profiles & Contrast (feature 014).

Clones are the "clone a base seed and change ONE variable" contrast
mechanism the demo relies on (data-model.md §WorldClone, research.md §R5).
Given a base ``World`` (typically loaded from a committed ``SeedWorld`` via
``world_seed_store.py``) plus one or more ``FieldOverride``s, ``create_clone``:

  1. applies each override at its dotted/bracketed ``path`` onto a deep copy
     of the base world's JSON-mode dump,
  2. re-validates the result as a complete ``World`` (structural — enum/range/
     purpose-stage — via the model itself),
  3. re-validates catalog references via the existing
     ``services/world_validation.validate_world`` whenever ``catalog`` is
     supplied (reused unchanged, per the unit brief — **NOT** via ``mdg``).
     If ``catalog`` is ``None`` (unresolvable/quarantined dataset) AND the
     cloned world actually references the catalog in any way
     (``world_validation.has_catalog_references``), this is now a validation
     error (``unresolvable_catalog``) rather than a silent skip — whole-branch
     review FIX 5. A world with NO catalog references at all is still safe to
     clone without a catalog (nothing would need checking).
  4. computes a deterministic ``diff``: EXACTLY the overridden path(s) with
     their before/after values (never a spurious diff from re-serialization,
     since we only read the same paths back out of the base/clone dumps —
     never a recursive whole-object diff),
  5. persists the resulting ``WorldClone`` under ``settings.proposal_worlds_dir``
     (git-ignored — mirrors ``proposal_run_manager``/``driver_profile_store``'s
     atomic per-file persistence pattern).

Isolation (HARD ISOLATION RULE / CLAUDE.md, enforced by the import-guard
test): this module imports only ``aica_api.models.proposal.*``,
``aica_api.services.world_validation``, ``aica_api.storage.file_store``,
stdlib, and pydantic — never the trigger ``aica_api.models`` package, and
never ``mdg``.

Public API:
  WorldCloneStore(worlds_dir: Path)
    .create_clone(base_world, base_seed_id, overrides, catalog=None) -> WorldClone
    .list_clones()        -> list[dict]        — {clone_id, base_seed_id} summaries
    .get_clone(clone_id)  -> WorldClone | None
    .delete_clone(clone_id) -> bool             — True if a clone was removed
"""
from __future__ import annotations

import copy
import os
import pathlib
import re
from datetime import datetime, timezone
from typing import Any

from pydantic import ValidationError

from aica_api.models.proposal.song_schema import Song
from aica_api.models.proposal.world import FieldDiff, FieldOverride, World, WorldClone
from aica_api.services.world_validation import ValidationIssue, has_catalog_references, validate_world
from aica_api.storage.file_store import read_json, write_json_atomic

__all__ = [
    "InvalidOverrideError",
    "apply_overrides",
    "WorldCloneStore",
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

    Pure core extracted from ``WorldCloneStore.create_clone`` (research.md
    D2) — no persistence, no ``WorldClone`` construction. Unlike
    ``create_clone``, an EMPTY ``overrides`` list is allowed here (recompute's
    pure lifecycle-stage-only case): it returns ``base_world`` unchanged with
    an empty diff, never raising ``empty_overrides``. ``create_clone`` keeps
    its own non-empty guard and calls this helper only after checking it.

    Validation is identical to ``create_clone``'s: each override is applied
    at its dotted/bracketed path onto a deep copy of ``base_world``'s JSON
    dump, the result is re-validated as a complete ``World``, and (when
    ``catalog`` is supplied, or the cloned world has catalog references and
    none was supplied) checked for dangling catalog references.

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
        # Mirrors WorldCloneStore's FIX-5 discipline: an unresolvable/missing
        # catalog for a world that DOES reference the catalog is a validation
        # error, never a silent skip. A world with no catalog references at
        # all is still safe to apply without a catalog.
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


def _make_clone_id() -> str:
    """Generate a unique clone_id: wclone_<YYYYMMDD-HHMMSS>_<6-hex>.

    The ONLY place timestamp/randomness is generated in this module, and only
    ever invoked for a brand-new clone (``create_clone``) — never touches the
    deterministic diff/world computation itself.
    """
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    rand = os.urandom(3).hex()
    return f"wclone_{ts}_{rand}"


class WorldCloneStore:
    """Persists user-created ``WorldClone``s under ``settings.proposal_worlds_dir``."""

    def __init__(self, worlds_dir: pathlib.Path) -> None:
        self._worlds_dir = pathlib.Path(worlds_dir)

    # ── Public API ─────────────────────────────────────────────────────────

    def create_clone(
        self,
        *,
        base_world: World,
        base_seed_id: str,
        overrides: list[FieldOverride | dict],
        catalog: list[Song] | None = None,
    ) -> WorldClone:
        """Clone ``base_world`` with ``overrides`` applied; persist + return.

        Raises:
            InvalidOverrideError: malformed/unknown path, a value that makes
                the resulting world structurally invalid, or (when
                ``catalog`` is supplied) a dangling catalog reference.
        """
        validated_overrides = [
            o if isinstance(o, FieldOverride) else FieldOverride.model_validate(o) for o in overrides
        ]
        if not validated_overrides:
            raise InvalidOverrideError(
                [_issue(path="overrides", code="empty_overrides", message="At least one override is required.")]
            )

        # T009 (research.md D2): the apply->revalidate->diff core is shared
        # with recompute via the pure `apply_overrides` helper; create_clone
        # keeps its own non-empty-override guard (above) since a clone is a
        # user-triggered "change ONE variable" contrast (empty is meaningless
        # here), while recompute allows an empty list (a pure lifecycle-stage
        # recompute with no context edit).
        cloned_world, diffs = apply_overrides(base_world, validated_overrides, catalog=catalog)

        clone = WorldClone(
            clone_id=_make_clone_id(),
            base_seed_id=base_seed_id,
            overrides=validated_overrides,
            world=cloned_world,
            diff=diffs,
        )
        write_json_atomic(str(self._clone_path(clone.clone_id)), clone.model_dump(mode="json"))
        return clone

    def list_clones(self) -> list[dict[str, Any]]:
        """Return {clone_id, base_seed_id} summaries for every persisted clone."""
        return [
            {"clone_id": clone.clone_id, "base_seed_id": clone.base_seed_id}
            for clone in self._scan().values()
        ]

    def get_clone(self, clone_id: str) -> WorldClone | None:
        """Return the full WorldClone for clone_id, or None if unknown."""
        return self._scan().get(clone_id)

    def delete_clone(self, clone_id: str) -> bool:
        """Delete a persisted clone. Returns True if a clone was removed."""
        path = self._clone_path(clone_id)
        if not path.exists():
            return False
        path.unlink()
        return True

    # ── Private helpers ────────────────────────────────────────────────────

    def _clone_path(self, clone_id: str) -> pathlib.Path:
        return self._worlds_dir / f"{clone_id}.json"

    def _scan(self) -> dict[str, WorldClone]:
        clones: dict[str, WorldClone] = {}
        if not self._worlds_dir.exists():
            return clones
        for path in sorted(self._worlds_dir.glob("*.json")):
            try:
                data = read_json(str(path))
                clone = WorldClone.model_validate(data)
            except Exception:
                continue
            clones[clone.clone_id] = clone
        return clones
