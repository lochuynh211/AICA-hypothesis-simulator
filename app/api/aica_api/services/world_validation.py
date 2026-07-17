"""World validation service (T017/T018) — P3 Editable World (feature 014).

``validate_world(world, catalog) -> list[ValidationIssue]`` surfaces every
problem with an edited ``World`` as a field-level ``{path, code, message}``
issue, per data-model.md "Validation rules":

  1. Enum membership + numeric ranges (Pydantic) on every world/profile field.
  2. Purpose/stage compatibility (the shared rule already enforced by
     ``ControlInputs`` — see ``models/proposal/world.py``).
  3. Catalog reference existence: every catalog id the world references
     (``driver_profile.oshi_id``, item-history/played/skipped/etc. track ids,
     the content-rate/confidence map keys) must exist in the supplied catalog.

Rules 1-2 are ALREADY enforced by the ``World``/``ControlInputs``/
``Situation``/``DriverProfile`` Pydantic models at construction time — a
``World`` built normally (``World(...)`` or ``World.model_validate(...)``)
can never violate them. This function exists for the case where a ``World``
in memory was NOT built through normal validation (e.g. assembled via
``model_construct()``, or mutated in place post-construction — Pydantic does
not re-validate on plain attribute assignment unless ``validate_assignment``
is set, which these models deliberately do not set, since the setup UI
mutates fields incrementally while editing) and for turning what would
otherwise be a raised ``ValidationError`` into field-level issues a caller
(e.g. a ``POST /worlds/validate`` endpoint) can render directly. A world
built and left untouched by normal validation always yields an empty list.

Deliberately does NOT import ``mdg`` (a prior unit removed the ``mdg``
runtime dependency to avoid a cyclic ``aica-api`` <-> ``mdg`` coupling and a
test-collection collision — see ``services/dataset_catalog_registry.py``).
Catalog reference validation here is implemented directly as a simple
set-membership check against the supplied ``catalog: list[Song]`` — the same
songs ``DatasetCatalogRegistry.get_catalog(dataset_id)`` returns.

Isolation (HARD ISOLATION RULE / CLAUDE.md, enforced by the import-guard
test): this module imports only ``aica_api.models.proposal.*``, stdlib, and
pydantic — never the trigger ``aica_api.models`` package, and never ``mdg``.
"""
from __future__ import annotations

import warnings
from typing import Any

from pydantic import BaseModel, ConfigDict, ValidationError

from aica_api.models.proposal.song_schema import Song
from aica_api.models.proposal.world import World

__all__ = ["ValidationIssue", "validate_world", "has_catalog_references"]


# ---------------------------------------------------------------------------
# ValidationIssue — {path, code, message}
# ---------------------------------------------------------------------------


class ValidationIssue(BaseModel):
    """One field-level validation problem.

    ``path`` is a dotted/bracketed pointer into the world (e.g.
    ``"situation.drowsiness_level"`` or
    ``"driver_profile.played_items[0].track_id"``); ``code`` is a short,
    stable machine-readable identifier; ``message`` is a clear, user-facing
    description (bilingual where practical — a clear English message alone is
    acceptable).
    """

    model_config = ConfigDict(extra="forbid")

    path: str
    code: str
    message: str


# ---------------------------------------------------------------------------
# Rule 1 + 2 — structural (enum/range) + purpose/stage compatibility.
# ---------------------------------------------------------------------------


def _pydantic_error_path(error: dict[str, Any]) -> str:
    loc = error.get("loc", ())
    if not loc:
        return "world"
    return ".".join(str(part) for part in loc)


def _structural_issues(world: World) -> list[ValidationIssue]:
    """Re-validate ``world``'s own dumped shape through the model constructor.

    This reuses the shared rules already implemented on the models
    (Pydantic's own enum/range constraints, plus ``ControlInputs``'
    ``purpose_stage_compatible`` model-validator) instead of re-implementing
    them — it only translates a would-be ``ValidationError`` into field-level
    issues. Dumping a world whose in-memory fields were mutated to a value
    outside its declared type (e.g. an enum field holding a plain,
    non-member string) triggers a harmless Pydantic serialization warning,
    which is expected here and suppressed.
    """
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        dumped = world.model_dump(mode="json")

    try:
        World.model_validate(dumped)
    except ValidationError as exc:
        return [
            ValidationIssue(
                path=_pydantic_error_path(error),
                code=error.get("type", "invalid_value"),
                message=error.get("msg", "Invalid value."),
            )
            for error in exc.errors()
        ]
    return []


# ---------------------------------------------------------------------------
# Rule 3 — catalog reference existence.
# ---------------------------------------------------------------------------

# driver_profile fields whose items carry a ``track_id`` referencing the catalog.
_TRACK_ID_LIST_FIELDS: tuple[str, ...] = (
    "played_items",
    "skipped_items",
    "changed_from_items",
    "completed_items",
    "manually_selected_items",
    "repeated_items",
)

# driver_profile fields that are maps keyed by a catalog track id.
_TRACK_ID_MAP_FIELDS: tuple[str, ...] = (
    "catalog_item_usage_level",
    "catalog_item_recency_state",
    "content_proposal_acceptance_rate",
    "content_recovery_rate",
    "content_proposal_acceptance_confidence",
    "content_recovery_confidence",
)


def _catalog_ids(catalog: list[Song]) -> tuple[set[str], set[str]]:
    """Return (valid track ids, valid artist ids) from the supplied catalog."""
    track_ids: set[str] = set()
    artist_ids: set[str] = set()
    for song in catalog:
        track = song.spotify_track
        track_ids.add(track.id)
        if track.artists:
            artist_ids.update(artist.id for artist in track.artists)
        if track.album and track.album.artists:
            artist_ids.update(artist.id for artist in track.album.artists)
    return track_ids, artist_ids


def _unknown_reference_issue(*, path: str, ref_kind: str, ref_id: str, dataset_id: str) -> ValidationIssue:
    return ValidationIssue(
        path=path,
        code="unknown_catalog_reference",
        message=(
            f"{path}: unknown {ref_kind} id '{ref_id}' — not present in dataset "
            f"'{dataset_id}''s catalog. / "
            f"{path}: 不明な{ref_kind} ID '{ref_id}' です（データセット '{dataset_id}' の"
            "カタログに存在しません）。"
        ),
    )


def _catalog_reference_issues(world: World, catalog: list[Song]) -> list[ValidationIssue]:
    track_ids, artist_ids = _catalog_ids(catalog)
    dataset_id = world.control_inputs.dataset_id
    profile = world.driver_profile
    issues: list[ValidationIssue] = []

    for list_field in _TRACK_ID_LIST_FIELDS:
        for idx, item in enumerate(getattr(profile, list_field)):
            track_id = item.track_id
            if track_id not in track_ids:
                issues.append(
                    _unknown_reference_issue(
                        path=f"driver_profile.{list_field}[{idx}].track_id",
                        ref_kind="track",
                        ref_id=track_id,
                        dataset_id=dataset_id,
                    )
                )

    for map_field in _TRACK_ID_MAP_FIELDS:
        for key in getattr(profile, map_field):
            if key not in track_ids:
                issues.append(
                    _unknown_reference_issue(
                        path=f"driver_profile.{map_field}[{key!r}]",
                        ref_kind="track",
                        ref_id=key,
                        dataset_id=dataset_id,
                    )
                )

    if profile.oshi_id is not None and profile.oshi_id not in artist_ids:
        issues.append(
            _unknown_reference_issue(
                path="driver_profile.oshi_id",
                ref_kind="artist",
                ref_id=profile.oshi_id,
                dataset_id=dataset_id,
            )
        )

    return issues


def has_catalog_references(world: World) -> bool:
    """Return True if ``world`` references the catalog in ANY way: a non-None
    ``driver_profile.oshi_id``, or any track-id list/map field
    (``_TRACK_ID_LIST_FIELDS``/``_TRACK_ID_MAP_FIELDS``) that is non-empty.

    Used by callers (e.g. ``world_clone_store.apply_overrides``) that must
    decide whether an unresolvable/missing catalog is
    safe to skip reference validation against (a world with NO catalog
    references at all), or must be treated as an error because there IS
    something in the world that would need checking but can't be.
    """
    profile = world.driver_profile
    if profile.oshi_id is not None:
        return True
    for list_field in _TRACK_ID_LIST_FIELDS:
        if getattr(profile, list_field):
            return True
    for map_field in _TRACK_ID_MAP_FIELDS:
        if getattr(profile, map_field):
            return True
    return False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def validate_world(world: World, catalog: list[Song]) -> list[ValidationIssue]:
    """Validate ``world`` against its own rules plus the supplied ``catalog``.

    Returns an empty list for a fully valid world. ``catalog`` should be the
    song list resolved for ``world.control_inputs.dataset_id`` (e.g. via
    ``DatasetCatalogRegistry.get_catalog(...)``) — this function does not
    resolve the dataset itself, it only checks references against whatever
    catalog it is given.
    """
    issues: list[ValidationIssue] = []
    issues.extend(_structural_issues(world))
    issues.extend(_catalog_reference_issues(world, catalog))
    return issues
