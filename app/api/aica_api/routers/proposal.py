"""Proposal API router — /api/proposal/* (T018 skeleton + T020-T023 US1 endpoints).

Implements the Proposal Simulator surface described in
specs/013-proposal-p1-screen-foundation/contracts/proposal-api.md:

  GET    /api/proposal/matrix                        (T020)
  GET    /api/proposal/packages                       (T021)
  POST   /api/proposal/runs                          (T022 — create + STEP 1 service)
  POST   /api/proposal/runs/{run_id}/select-service    (T023 — STEP 2 content)
  GET    /api/proposal/runs                          (T032 — list summaries)
  GET    /api/proposal/runs/{run_id}                   (T033 — full log, no recompute)
  DELETE /api/proposal/runs/{run_id}                   (T034 — remove persisted log)

Follows the same convention as the sibling trigger routers
(``routers/packages.py`` et al.): a bare ``APIRouter()`` with full-path
route decorators (no ``prefix=`` kwarg) — every route below lives under
``/api/proposal``. Registries/matrix are instantiated fresh per request
(mirrors ``routers/packages.py::_get_registry``), so a monkeypatched
``AICA_PACKAGES_DIR``/``AICA_PROPOSAL_RUNS_DIR`` env var takes effect
immediately in tests without needing app-lifetime caching to be invalidated.

Isolation invariant (Constitution / spec FR-024): this module only ever
reads/writes ``settings.proposal_runs_dir`` and ``settings.packages_dir`` —
never the trigger ``settings.runs_dir`` — and never imports
``aica_api.algorithms`` (the trigger algorithm adapter).

Timestamp/randomness discipline: the ONLY place this module mints an id or a
timestamp for a NEW record is ``_make_opportunity_id``/``_now_iso`` below (the
"single router helper" — mirrors ``routers/runs.py::_make_run_id``); the
``prun_...`` run_id itself is minted by ``proposal_run_manager.create_run``
(already the sole place for that, per T017).
"""
from __future__ import annotations

import copy
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, ValidationError

from aica_api.config import settings
from aica_api.models.proposal.enums import (
    DiscreteEventType,
    LifecycleStage,
    MotionState,
    ProposalPackageFamily,
    ProposalRunStatus,
    ServiceId,
    TriggerPurpose,
)
from aica_api.models.proposal.events import DiscreteEvent
from aica_api.models.proposal.journey import JourneyState
from aica_api.models.proposal.journey_action import JourneyAction
from aica_api.models.proposal.matrix import MatrixResolutionError, PurposeStageServiceMatrix
from aica_api.models.proposal.opportunity import ProposalOpportunity
from aica_api.models.proposal.package_manifest import BilingualLabel, ProposalPackageManifest
from aica_api.models.proposal.proposal_run import ProposalRun, ProposalRunLog
from aica_api.models.proposal.world import (
    DriverProfile,
    DriverProfileRecord,
    FieldOverride,
    SeedWorld,
    SetupSnapshot,
    SetupSnapshotOrigin,
    World,
    WorldClone,
)
from aica_api.services import proposal_run_manager as prm
from aica_api.services.dataset_catalog_registry import DatasetCatalogRegistry
from aica_api.services.driver_profile_store import (
    DriverProfileConflictError,
    DriverProfileNotFoundError,
    DriverProfileStore,
)
from aica_api.services.proposal_journey import apply_action
from aica_api.services.proposal_package_registry import ProposalPackageRegistry
from aica_api.services.proposal_selector import dispatch_selector
from aica_api.services.world_clone_store import InvalidOverrideError, WorldCloneStore
from aica_api.services.world_seed_store import WorldSeedStore
from aica_api.services.world_validation import ValidationIssue, validate_world
from aica_api.storage.file_store import read_json

router = APIRouter()

# The one REAL (non-mock) content-selector package this router knows how to
# wire the frozen catalog into (T034 / P3c). Any other content package
# (including the P1 mock) keeps using ``_build_content_context`` unchanged.
_REAL_CONTENT_PACKAGE_ID = "aica_transparent_content_selector_v1"


@router.get("/api/proposal/_meta")
def proposal_router_meta() -> dict:
    """Trivial marker route confirming the proposal router is mounted (T018)."""
    return {"router": "proposal", "status": "ok"}


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _matrix_path():
    return settings.proposal_contracts_dir / "matrix" / "purpose_stage_matrix.v1.json"


def _get_registry() -> ProposalPackageRegistry:
    """Instantiate a ProposalPackageRegistry from the configured packages directory."""
    return ProposalPackageRegistry(settings.packages_dir)


def _get_dataset_registry() -> DatasetCatalogRegistry:
    """Instantiate a DatasetCatalogRegistry from the configured dataset directory."""
    return DatasetCatalogRegistry(settings.proposal_dataset_dir)


def _get_seed_store() -> WorldSeedStore:
    """Instantiate a WorldSeedStore from the configured seeds directory."""
    return WorldSeedStore(settings.proposal_seeds_dir)


def _get_profile_store() -> DriverProfileStore:
    """Instantiate a DriverProfileStore from the configured user-profiles directory."""
    return DriverProfileStore(settings.proposal_profiles_dir)


def _get_clone_store() -> WorldCloneStore:
    """Instantiate a WorldCloneStore from the configured user-worlds directory."""
    return WorldCloneStore(settings.proposal_worlds_dir)


def _make_opportunity_id() -> str:
    """Generate a unique opportunity_id: op_<YYYYMMDD-HHMMSS>_<6-hex>.

    The ONLY place this module mints a timestamp/random id for a brand-new
    ``ProposalOpportunity`` (mirrors ``routers/runs.py``'s ``_make_run_id``
    convention; the run_id itself remains ``proposal_run_manager``'s job).
    """
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    rand = os.urandom(3).hex()
    return f"op_{ts}_{rand}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _build_service_context(
    *,
    package: ProposalPackageManifest,
    opportunity: ProposalOpportunity,
    world_snapshot: dict,
    enabled_feature_extensions: list[str],
    parameters: dict,
    hyperparameters: dict,
) -> dict:
    """Assemble a SelectorInput-shaped context dict for the SERVICE selector."""
    feature_snapshot = dict(world_snapshot.get("feature_snapshot") or {})
    feature_provenance = dict(world_snapshot.get("feature_provenance") or {})
    return {
        "contract_version": package.contract_version,
        "opportunity_id": opportunity.opportunity_id,
        "simulation_time": opportunity.simulation_time,
        "trigger_purpose": opportunity.trigger_purpose.value,
        "lifecycle_stage": opportunity.lifecycle_stage.value,
        "allowed_service_ids": [s.value for s in opportunity.allowed_service_ids],
        "feature_snapshot": feature_snapshot,
        "feature_provenance": feature_provenance,
        "enabled_feature_extensions": list(enabled_feature_extensions),
        "selected_service_id": None,
        "eligible_candidates": [
            {"candidate_id": s.value} for s in opportunity.allowed_service_ids
        ],
        "excluded_candidates": [],
        "parameters": parameters,
        "hyperparameters": hyperparameters,
        "package_runtime_state": {},
        "catalog_version": world_snapshot.get("catalog_version", "n/a"),
        "run_seed": opportunity.run_seed,
    }


def _build_content_context(
    *,
    package: ProposalPackageManifest,
    run_log: ProposalRunLog,
    selected_service_id: ServiceId,
    content_parameters: dict,
    content_hyperparameters: dict,
) -> dict:
    """Assemble a SelectorInput-shaped context dict for the CONTENT selector.

    Aligned with ``tests/proposal/conftest.py::build_content_context``: a
    plain dict carrying every ``SelectorInput`` field, with the catalog (if
    any is present in the world snapshot) used to derive ``eligible_candidates``.

    ``content_parameters``/``content_hyperparameters`` are the CONTENT
    package's own resolved setup-time overrides (FR-002a) — distinct from
    ``run_log.parameters``/``run_log.hyperparameters``, which are the
    SERVICE package's frozen STEP-1 overrides and must never be forwarded
    here as if they were the content package's own.
    """
    world_snapshot = run_log.world_snapshot or {}
    feature_snapshot = dict(world_snapshot.get("feature_snapshot") or {})
    feature_provenance = dict(world_snapshot.get("feature_provenance") or {})
    catalog = feature_snapshot.get("catalog", {})
    eligible_candidates = [{"candidate_id": tid} for tid in catalog] if catalog else []

    # Carry forward the service step's next_package_runtime_state, if any —
    # the field exists precisely to propagate engine state between the two
    # selector calls (the mocks themselves ignore it).
    package_runtime_state: dict = {}
    for ev in run_log.evidence:
        if ev.step == "service" and ev.output:
            package_runtime_state = ev.output.get("next_package_runtime_state") or {}
            break

    return {
        "contract_version": package.contract_version,
        "opportunity_id": run_log.opportunity.opportunity_id,
        "simulation_time": run_log.opportunity.simulation_time,
        "trigger_purpose": run_log.opportunity.trigger_purpose.value,
        "lifecycle_stage": run_log.opportunity.lifecycle_stage.value,
        "allowed_service_ids": [s.value for s in run_log.opportunity.allowed_service_ids],
        "selected_service_id": selected_service_id.value,
        "feature_snapshot": feature_snapshot,
        "feature_provenance": feature_provenance,
        "enabled_feature_extensions": [],
        "eligible_candidates": eligible_candidates,
        "excluded_candidates": [],
        "parameters": content_parameters,
        "hyperparameters": content_hyperparameters,
        "package_runtime_state": package_runtime_state,
        "catalog_version": world_snapshot.get("catalog_version", "n/a"),
        "run_seed": run_log.opportunity.run_seed,
    }


def _catalog_map_for_dataset(dataset_id: str) -> dict[str, dict] | None:
    """Build the ``{track_id: Song-dict}`` map the real content selector's
    ``feature_snapshot["catalog"]`` expects, from the frozen P2 dataset.

    Returns ``None`` if ``dataset_id`` is unknown/quarantined. The FULL frozen
    catalog is used — no eligibility narrowing (motion/catalog/schedule) is
    added here or anywhere else in P3 (FR-021).
    """
    songs = _get_dataset_registry().get_catalog(dataset_id)
    if songs is None:
        return None
    return {song.spotify_track.id: song.model_dump(mode="json") for song in songs}


def _genre_affinity_artist_genres(dataset_id: str) -> dict:
    """Read-only load of the dataset's catalog-derived ``artist_genres`` map
    (``proposal_contracts/dataset/<id>/genre_affinity_v1.json``).

    ``artist_genres`` is catalog-derived, never world-owned (see
    ``models/proposal/world.py`` module docstring) — the caller merges it in
    alongside the World-owned ``usage_by_genre``/``scene_genre_usage`` fields
    when the genre extension is enabled. Missing/unreadable file -> ``{}``
    (no artist-genre data), never an exception.
    """
    path = settings.proposal_dataset_dir / dataset_id / "genre_affinity_v1.json"
    if not path.exists():
        return {}
    try:
        data = read_json(str(path))
    except Exception:
        return {}
    return {"artist_genres": data.get("artist_genres", {})}


def _build_real_content_context(
    *,
    package: ProposalPackageManifest,
    run_log: ProposalRunLog,
    selected_service_id: ServiceId,
    content_parameters: dict,
    content_hyperparameters: dict,
) -> dict:
    """Assemble the CONTENT context for the REAL transparent content selector
    (``aica_transparent_content_selector_v1``) — T034 / P3c.

    Unlike ``_build_content_context`` (the P1 mock path, still used for the
    mock content package and for legacy ``world_snapshot``-only runs), this:

      - merges in the FULL frozen dataset catalog (``{track_id: Song}``,
        keyed by ``DatasetCatalogRegistry.get_catalog`` — no eligibility
        narrowing, per FR-021) as ``feature_snapshot["catalog"]``;
      - derives ``enabled_feature_extensions`` from the world's own
        ``feature_snapshot["_genre_extension_enabled"]`` flag (P1's mock path
        hardcoded this to ``[]``) and, when on, merges the dataset's
        catalog-derived ``artist_genres`` into ``feature_snapshot["genre_affinity_v1"]``
        alongside the World-owned ``usage_by_genre``/``scene_genre_usage``.

    Only called when ``run_log.setup_snapshot`` is populated (a typed-World
    run, per US1) — the caller falls back to ``_build_content_context`` for
    legacy ``world_snapshot``-only runs, which have no ``dataset_id`` to
    resolve a catalog from.
    """
    setup_snapshot = run_log.setup_snapshot
    assert setup_snapshot is not None  # only invoked for typed-world runs

    world_snapshot = run_log.world_snapshot or {}
    feature_snapshot = dict(world_snapshot.get("feature_snapshot") or {})
    feature_provenance = dict(world_snapshot.get("feature_provenance") or {})

    catalog_map = _catalog_map_for_dataset(setup_snapshot.dataset_id) or {}

    enabled_feature_extensions: list[str] = []
    if feature_snapshot.get("_genre_extension_enabled"):
        enabled_feature_extensions.append("genre_affinity_v1")
        gav1 = dict(feature_snapshot.get("genre_affinity_v1") or {})
        gav1.update(_genre_affinity_artist_genres(setup_snapshot.dataset_id))
        feature_snapshot["genre_affinity_v1"] = gav1

    feature_snapshot["catalog"] = catalog_map
    feature_snapshot["_service_id"] = selected_service_id.value

    eligible_candidates = [{"candidate_id": tid} for tid in catalog_map]

    package_runtime_state: dict = {}
    for ev in run_log.evidence:
        if ev.step == "service" and ev.output:
            package_runtime_state = ev.output.get("next_package_runtime_state") or {}
            break

    return {
        "contract_version": package.contract_version,
        "opportunity_id": run_log.opportunity.opportunity_id,
        "simulation_time": run_log.opportunity.simulation_time,
        "trigger_purpose": run_log.opportunity.trigger_purpose.value,
        "lifecycle_stage": run_log.opportunity.lifecycle_stage.value,
        "allowed_service_ids": [s.value for s in run_log.opportunity.allowed_service_ids],
        "selected_service_id": selected_service_id.value,
        "feature_snapshot": feature_snapshot,
        "feature_provenance": feature_provenance,
        "enabled_feature_extensions": enabled_feature_extensions,
        "eligible_candidates": eligible_candidates,
        "excluded_candidates": [],
        "parameters": content_parameters,
        "hyperparameters": content_hyperparameters,
        "package_runtime_state": package_runtime_state,
        "catalog_version": setup_snapshot.dataset_hash,
        "run_seed": run_log.opportunity.run_seed,
    }


def _redact_catalog_for_evidence(context: dict, *, dataset_id: str) -> dict:
    """Return a deep-copied ``context`` with ``feature_snapshot.catalog``
    replaced by a compact dataset-reference marker (MF2 / P3 POLISH unit).

    The real content selector's ``feature_snapshot["catalog"]`` embeds the
    FULL frozen catalog (up to ~300 songs, ~1.5 MB) — necessary at RUNTIME
    for ``evaluate()`` to score every candidate, but wasteful (and largely
    redundant, since the catalog is already identified by
    ``SetupSnapshot.dataset_id``/``dataset_hash``) to persist verbatim inside
    every run's ``AlgorithmEvidence.input_snapshot``. This function is used
    ONLY to build the value passed as ``dispatch_selector``'s
    ``evidence_input_snapshot`` — the full, un-redacted ``context`` is always
    what ``evaluate()`` itself receives (dispatch_selector's ``context`` arg
    is untouched by this call).

    Returns ``context`` deep-copied so the caller's original dict (the one
    actually passed to ``evaluate()``) is never mutated by reference.
    """
    redacted = copy.deepcopy(context)
    feature_snapshot = redacted.get("feature_snapshot")
    if isinstance(feature_snapshot, dict):
        catalog = feature_snapshot.get("catalog")
        if isinstance(catalog, dict):
            feature_snapshot["catalog"] = {
                "_redacted_catalog": {"dataset_id": dataset_id, "song_count": len(catalog)}
            }
    return redacted


# ---------------------------------------------------------------------------
# GET /api/proposal/matrix — T020
# ---------------------------------------------------------------------------


@router.get("/api/proposal/matrix")
def get_matrix() -> dict:
    """Return the frozen versioned purpose/stage service matrix."""
    matrix = PurposeStageServiceMatrix.load(_matrix_path())
    return {
        "matrix_version": matrix.matrix_version,
        "rows": [
            {
                "trigger_purpose": row.trigger_purpose.value,
                "lifecycle_stage": row.lifecycle_stage.value,
                "allowed_service_ids": [s.value for s in row.allowed_service_ids],
            }
            for row in matrix.rows
        ],
    }


# ---------------------------------------------------------------------------
# GET /api/proposal/packages — T021
# ---------------------------------------------------------------------------


@router.get("/api/proposal/packages")
def get_packages() -> dict:
    """List the four proposal package slots, the loaded packages, and load errors."""
    reg = _get_registry()
    return {
        "slots": reg.list_slots(),
        "packages": reg.list_summaries(),
        "errors": reg.list_errors(),
    }


# ---------------------------------------------------------------------------
# GET /api/proposal/datasets — T021/T022 (P3 — read-only dataset catalog)
# ---------------------------------------------------------------------------


@router.get("/api/proposal/datasets")
def get_datasets() -> dict:
    """List loadable datasets + provenance; quarantined datasets appear in errors.

    READ-ONLY: no edit/import route exists anywhere in this router — the
    frozen dataset changes only by re-running the P2 generator.
    """
    registry = _get_dataset_registry()
    return {"datasets": registry.list_datasets(), "errors": registry.list_errors()}


@router.get("/api/proposal/datasets/{dataset_id}/catalog")
def get_dataset_catalog(dataset_id: str, offset: int = 0, limit: int | None = None) -> dict:
    """Read-only paginated catalog songs + provenance for one dataset.

    ``offset``/``limit`` are optional; omitting ``limit`` returns every song
    from ``offset`` onward (the full catalog when both are omitted).
    """
    registry = _get_dataset_registry()
    catalog = registry.get_catalog(dataset_id)
    if catalog is None:
        raise HTTPException(status_code=404, detail=f"Unknown dataset_id: {dataset_id!r}")

    provenance = registry.get_provenance(dataset_id)
    assert provenance is not None  # a loaded catalog always has provenance

    end = None if limit is None else offset + limit
    page = catalog[offset:end]

    return {
        "provenance": {
            "dataset_id": provenance.dataset_id,
            "dataset_version": provenance.dataset_version.model_dump(),
            "dataset_hash": provenance.dataset_hash,
            "tier": provenance.tier,
            "provenance_note": provenance.provenance_note,
        },
        "total": len(catalog),
        "songs": [song.model_dump(mode="json") for song in page],
    }


# ---------------------------------------------------------------------------
# GET /api/proposal/seeds — T021/T022 (P3 — base-seed store)
# ---------------------------------------------------------------------------


@router.get("/api/proposal/seeds")
def get_seeds() -> dict:
    """List the committed base-seed worlds ({seed_id, label, description})."""
    store = _get_seed_store()
    return {"seeds": store.list_seeds()}


@router.get("/api/proposal/seeds/{seed_id}")
def get_seed(seed_id: str) -> SeedWorld:
    """Return the full, complete SeedWorld for seed_id."""
    store = _get_seed_store()
    seed = store.get_seed(seed_id)
    if seed is None:
        raise HTTPException(status_code=404, detail=f"Unknown seed_id: {seed_id!r}")
    return seed


# ---------------------------------------------------------------------------
# Worlds: clone & diff — T030 (P3 — contrast clones)
# ---------------------------------------------------------------------------


class CreateWorldCloneBody(BaseModel):
    """Request body for ``POST /api/proposal/worlds/clone``."""

    base_seed_id: str
    overrides: list[FieldOverride]


@router.post("/api/proposal/worlds/clone", status_code=201)
def create_world_clone(body: CreateWorldCloneBody) -> WorldClone:
    """Clone a base seed with one (typically one) field override applied.

    Returns the complete, valid cloned ``World`` plus a deterministic
    field-level ``diff`` listing exactly the overridden path(s). 422 on an
    unknown/malformed override path, an invalid value, or a dangling catalog
    reference — never a fabricated clone.
    """
    seed_store = _get_seed_store()
    seed = seed_store.get_seed(body.base_seed_id)
    if seed is None:
        raise HTTPException(status_code=404, detail=f"Unknown base_seed_id: {body.base_seed_id!r}")

    dataset_registry = _get_dataset_registry()
    catalog = dataset_registry.get_catalog(seed.world.control_inputs.dataset_id)

    clone_store = _get_clone_store()
    try:
        return clone_store.create_clone(
            base_world=seed.world,
            base_seed_id=body.base_seed_id,
            overrides=body.overrides,
            catalog=catalog,
        )
    except InvalidOverrideError as exc:
        raise HTTPException(status_code=422, detail=[issue.model_dump() for issue in exc.issues]) from exc


@router.get("/api/proposal/worlds/clones")
def list_world_clones() -> dict:
    """List persisted world clones ({clone_id, base_seed_id} summaries)."""
    return {"clones": _get_clone_store().list_clones()}


@router.get("/api/proposal/worlds/clones/{clone_id}")
def get_world_clone(clone_id: str) -> WorldClone:
    """Return the full WorldClone (world + diff) for clone_id."""
    clone = _get_clone_store().get_clone(clone_id)
    if clone is None:
        raise HTTPException(status_code=404, detail=f"Unknown clone_id: {clone_id!r}")
    return clone


@router.delete("/api/proposal/worlds/clones/{clone_id}", status_code=204)
def delete_world_clone(clone_id: str) -> Response:
    """Delete a persisted world clone."""
    deleted = _get_clone_store().delete_clone(clone_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Unknown clone_id: {clone_id!r}")
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Driver-profile CRUD — T021/T022 (P3 — built-in + user profile store)
# ---------------------------------------------------------------------------


class SaveDriverProfileBody(BaseModel):
    """Request body for ``POST /api/proposal/profiles``."""

    label: BilingualLabel
    profile: DriverProfile


@router.get("/api/proposal/profiles")
def get_profiles() -> dict:
    """List built-in + user driver profiles ({profile_id, label, builtin})."""
    store = _get_profile_store()
    return {"profiles": store.list_profiles()}


@router.get("/api/proposal/profiles/{profile_id}")
def get_profile(profile_id: str) -> DriverProfileRecord:
    """Return the full DriverProfileRecord for profile_id."""
    store = _get_profile_store()
    record = store.get_profile(profile_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Unknown profile_id: {profile_id!r}")
    return record


@router.post("/api/proposal/profiles", status_code=201)
def create_profile(body: SaveDriverProfileBody) -> DriverProfileRecord:
    """Validate and save a NEW user driver profile (``builtin=False``)."""
    store = _get_profile_store()
    try:
        return store.save_profile(body.label, body.profile)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc


@router.delete("/api/proposal/profiles/{profile_id}", status_code=204)
def delete_profile(profile_id: str) -> Response:
    """Delete a user driver profile. Built-in profiles are not deletable (409)."""
    store = _get_profile_store()
    try:
        store.delete_profile(profile_id)
    except DriverProfileConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except DriverProfileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# POST /api/proposal/worlds/validate — T021/T022 (P3)
# ---------------------------------------------------------------------------


class ValidateWorldBody(BaseModel):
    """Request body for ``POST /api/proposal/worlds/validate``."""

    world: World


@router.post("/api/proposal/worlds/validate")
def validate_world_endpoint(body: ValidateWorldBody) -> dict:
    """Validate a typed World against enum/range/purpose-stage/catalog rules.

    An unknown ``control_inputs.dataset_id`` surfaces as a field-level issue
    (``valid: false``) rather than a 500 — the dataset simply can't be
    resolved to check catalog references against, which is itself a
    reportable problem with the world, not a server error.
    """
    registry = _get_dataset_registry()
    catalog = registry.get_catalog(body.world.control_inputs.dataset_id)
    if catalog is None:
        issue = ValidationIssue(
            path="control_inputs.dataset_id",
            code="unknown_dataset",
            message=(
                f"control_inputs.dataset_id: unknown dataset '{body.world.control_inputs.dataset_id}'. / "
                f"control_inputs.dataset_id: 不明なデータセット '{body.world.control_inputs.dataset_id}' です。"
            ),
        )
        return {"valid": False, "issues": [issue.model_dump()]}

    issues = validate_world(body.world, catalog)
    return {"valid": not issues, "issues": [issue.model_dump() for issue in issues]}


# ---------------------------------------------------------------------------
# POST /api/proposal/runs — T022 (create + STEP 1 service)
# ---------------------------------------------------------------------------


class CreateProposalRunBody(BaseModel):
    """Request body for ``POST /api/proposal/runs`` (contracts/proposal-api.md).

    P3 (feature 014) additively accepts a typed ``world: World`` alongside the
    legacy opaque ``world_snapshot: dict`` (P1 back-compat) — ``world`` wins
    when both are present. ``trigger_purpose``/``lifecycle_stage``/
    ``motion_state`` are optional at the top level so the typed-world path can
    derive them from ``world.control_inputs`` instead; they remain effectively
    required (enforced in the handler, not by pydantic) on the legacy
    ``world_snapshot`` path, where no ``World`` exists to derive them from.
    ``origin_seed_id``/``origin_clone_id``/``origin_profile_id`` are optional
    hints recording which committed artifact(s) the typed world was built
    from, frozen verbatim into ``SetupSnapshot.origin``.
    """

    trigger_purpose: TriggerPurpose | None = None
    lifecycle_stage: LifecycleStage | None = None
    motion_state: MotionState | None = None
    world: World | None = None
    world_snapshot: dict[str, Any] = {}
    origin_seed_id: str | None = None
    origin_clone_id: str | None = None
    origin_profile_id: str | None = None
    service_package_id: str
    content_package_id: str
    mode: str = "interactive"
    enabled_feature_extensions: list[str] = []
    parameters: dict[str, Any] = {}
    hyperparameters: dict[str, Any] = {}
    run_seed: str
    simulation_time: str | int


def _resolve_run_setup(
    body: CreateProposalRunBody,
) -> tuple[TriggerPurpose, LifecycleStage, MotionState]:
    """Resolve the effective (trigger_purpose, lifecycle_stage, motion_state).

    Typed-world path: derived from ``body.world.control_inputs`` (the single
    source of truth once a typed world is supplied) unless the caller also
    passed explicit top-level overrides. Legacy path: the three top-level
    fields are required (raises 422 if any is missing — pydantic can't
    enforce "required unless `world` is set" declaratively).
    """
    if body.world is not None:
        ci = body.world.control_inputs
        return (
            body.trigger_purpose or ci.trigger_purpose,
            body.lifecycle_stage or ci.lifecycle_stage,
            body.motion_state or ci.motion_state,
        )
    if body.trigger_purpose is None or body.lifecycle_stage is None or body.motion_state is None:
        raise HTTPException(
            status_code=422,
            detail=(
                "trigger_purpose, lifecycle_stage, and motion_state are required "
                "when 'world' is not supplied."
            ),
        )
    return body.trigger_purpose, body.lifecycle_stage, body.motion_state


def _freeze_setup_snapshot(
    body: CreateProposalRunBody,
    *,
    world: World,
    matrix_version: str,
    service_pkg: ProposalPackageManifest,
    content_pkg: ProposalPackageManifest,
    service_hyperparameters: dict,
) -> tuple[dict, SetupSnapshot]:
    """Validate the typed world and build (world_snapshot dict, SetupSnapshot).

    Raises HTTPException(422, detail=[{path, code, message}, ...]) if the
    dataset_id is unknown or the world fails ``validate_world`` — never a
    fabricated snapshot for an invalid world.
    """
    dataset_registry = _get_dataset_registry()
    catalog = dataset_registry.get_catalog(world.control_inputs.dataset_id)
    if catalog is None:
        raise HTTPException(
            status_code=422,
            detail=[
                {
                    "path": "control_inputs.dataset_id",
                    "code": "unknown_dataset",
                    "message": f"Unknown dataset_id: {world.control_inputs.dataset_id!r}",
                }
            ],
        )

    issues = validate_world(world, catalog)
    if issues:
        raise HTTPException(status_code=422, detail=[issue.model_dump() for issue in issues])

    feature_snapshot, feature_provenance = world.project()
    world_snapshot_dict = {
        "feature_snapshot": feature_snapshot,
        "feature_provenance": {k: v.model_dump(mode="json") for k, v in feature_provenance.items()},
        "catalog_version": world.catalog_ref.dataset_hash,
    }

    dataset_provenance = dataset_registry.get_provenance(world.control_inputs.dataset_id)
    assert dataset_provenance is not None  # a resolved catalog always has provenance

    content_default_hyperparameters = {hp.key: hp.default for hp in content_pkg.hyperparameters}

    setup_snapshot = SetupSnapshot(
        origin=SetupSnapshotOrigin(
            seed_id=body.origin_seed_id,
            clone_id=body.origin_clone_id,
            profile_id=body.origin_profile_id,
        ),
        matrix_version=matrix_version,
        dataset_id=world.control_inputs.dataset_id,
        dataset_hash=dataset_provenance.dataset_hash,
        service_package_id=service_pkg.id,
        service_contract_version=service_pkg.contract_version,
        content_package_id=content_pkg.id,
        content_contract_version=content_pkg.contract_version,
        service_parameter_set_version=service_hyperparameters.get(
            "parameter_set_version", service_pkg.version
        ),
        content_parameter_set_version=content_default_hyperparameters.get(
            "parameter_set_version", content_pkg.version
        ),
        feature_provenance=feature_provenance,
    )
    return world_snapshot_dict, setup_snapshot


@router.post("/api/proposal/runs", status_code=201)
def create_proposal_run(body: CreateProposalRunBody) -> ProposalRunLog:
    registry = _get_registry()

    service_pkg = registry.get(body.service_package_id)
    if service_pkg is None or service_pkg.family != ProposalPackageFamily.service_selector:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown or mis-slotted service_package_id: {body.service_package_id!r}",
        )

    content_pkg = registry.get(body.content_package_id)
    if content_pkg is None or content_pkg.family != ProposalPackageFamily.content_selector:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown or mis-slotted content_package_id: {body.content_package_id!r}",
        )

    if body.world is None and not body.world_snapshot:
        raise HTTPException(
            status_code=422,
            detail="Request must include either a typed 'world' or a non-empty 'world_snapshot'.",
        )

    trigger_purpose, lifecycle_stage, motion_state = _resolve_run_setup(body)

    matrix = PurposeStageServiceMatrix.load(_matrix_path())
    try:
        allowed_service_ids = matrix.resolve(trigger_purpose, lifecycle_stage)
    except MatrixResolutionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    opportunity_id = _make_opportunity_id()
    try:
        opportunity = ProposalOpportunity(
            opportunity_id=opportunity_id,
            trigger_purpose=trigger_purpose,
            lifecycle_stage=lifecycle_stage,
            allowed_service_ids=allowed_service_ids,
            simulation_time=body.simulation_time,
            run_seed=body.run_seed,
        )
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    parameters = body.parameters or dict(service_pkg.parameters)
    hyperparameters = body.hyperparameters or {
        hp.key: hp.default for hp in service_pkg.hyperparameters
    }

    # P3 typed-world path: validate + project + freeze a SetupSnapshot; the
    # resulting world_snapshot dict replaces body.world_snapshot for the
    # service-selector context and the persisted log (world wins over
    # world_snapshot when both are given).
    setup_snapshot: SetupSnapshot | None = None
    world_snapshot = body.world_snapshot
    if body.world is not None:
        world_snapshot, setup_snapshot = _freeze_setup_snapshot(
            body,
            world=body.world,
            matrix_version=matrix.matrix_version,
            service_pkg=service_pkg,
            content_pkg=content_pkg,
            service_hyperparameters=hyperparameters,
        )

    context = _build_service_context(
        package=service_pkg,
        opportunity=opportunity,
        world_snapshot=world_snapshot,
        enabled_feature_extensions=body.enabled_feature_extensions,
        parameters=parameters,
        hyperparameters=hyperparameters,
    )

    evidence = dispatch_selector(
        service_pkg,
        context,
        settings.packages_dir,
        matrix_version=matrix.matrix_version,
        used_feature_ids=list(context["feature_snapshot"].keys()),
        allowed_service_ids=[s.value for s in opportunity.allowed_service_ids],
    )

    at = opportunity.simulation_time
    events: list[DiscreteEvent] = [
        DiscreteEvent(
            event_type=DiscreteEventType.OPPORTUNITY_OPENED,
            at=at,
            payload={
                "opportunity_id": opportunity_id,
                "trigger_purpose": trigger_purpose.value,
                "lifecycle_stage": lifecycle_stage.value,
            },
        )
    ]

    selected_service_id: str | None = None
    if evidence.error is not None:
        status = ProposalRunStatus.error
        events.append(
            DiscreteEvent(
                event_type=DiscreteEventType.ALGORITHM_ERROR,
                at=at,
                payload={
                    "step": "service",
                    "category": evidence.error.category,
                    "message": evidence.error.message,
                },
            )
        )
    else:
        ranked_candidates = evidence.output.get("ranked_candidates", []) if evidence.output else []
        if ranked_candidates:
            selected_service_id = ranked_candidates[0]["candidate_id"]
            events.append(
                DiscreteEvent(
                    event_type=DiscreteEventType.SERVICE_SELECTED,
                    at=at,
                    payload={"selected_service_id": selected_service_id, "rank": 1},
                )
            )
        status = ProposalRunStatus.service_selected

    journey_state = JourneyState(
        lifecycle_stage=lifecycle_stage,
        motion_state=motion_state,
        active_service_id=selected_service_id,
        active_plan_id=None,
    )

    run_log = prm.create_run(
        opportunity=opportunity,
        matrix_version=matrix.matrix_version,
        world_snapshot=world_snapshot,
        service_package_id=body.service_package_id,
        content_package_id=body.content_package_id,
        parameters=parameters,
        hyperparameters=hyperparameters,
        journey_state=journey_state,
        events=events,
        evidence=[evidence],
        status=status,
        setup_snapshot=setup_snapshot,
        runs_dir=settings.proposal_runs_dir,
    )
    return run_log


# ---------------------------------------------------------------------------
# POST /api/proposal/runs/{run_id}/select-service — T023 (STEP 2 content)
# ---------------------------------------------------------------------------


class SelectServiceBody(BaseModel):
    """Request body for ``POST /api/proposal/runs/{run_id}/select-service``.

    ``parameters``/``hyperparameters`` are the CONTENT package's setup-time
    overrides (FR-002a) — symmetric with ``CreateProposalRunBody``'s
    service-side ``parameters``/``hyperparameters``. Empty (the default)
    falls back to the content package's own manifest defaults, exactly like
    the service side does at create-run.
    """

    selected_service_id: ServiceId
    parameters: dict[str, Any] = {}
    hyperparameters: dict[str, Any] = {}


@router.post("/api/proposal/runs/{run_id}/select-service")
def select_service(run_id: str, body: SelectServiceBody) -> ProposalRunLog:
    run_log = prm.get_run(run_id, settings.proposal_runs_dir)
    if run_log is None:
        raise HTTPException(status_code=404, detail=f"Proposal run {run_id!r} not found")

    selected_service_id = body.selected_service_id
    if selected_service_id not in run_log.opportunity.allowed_service_ids:
        raise HTTPException(
            status_code=422,
            detail=(
                f"{selected_service_id.value!r} is not in the opportunity's "
                "allowed_service_ids"
            ),
        )

    registry = _get_registry()
    content_pkg = registry.get(run_log.content_package_id) if run_log.content_package_id else None
    if content_pkg is None or content_pkg.family != ProposalPackageFamily.content_selector:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown or mis-slotted content_package_id: {run_log.content_package_id!r}",
        )

    if selected_service_id not in content_pkg.supported_services:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Content package {content_pkg.id!r} does not support service "
                f"{selected_service_id.value!r} (unsupported_service)"
            ),
        )

    # Resolve the content package's setup-time overrides (FR-002a) — mirrors
    # create_proposal_run's service-side convention: an empty request body
    # falls back to the content package's own manifest defaults.
    content_parameters = body.parameters or dict(content_pkg.parameters)
    content_hyperparameters = body.hyperparameters or {
        hp.key: hp.default for hp in content_pkg.hyperparameters
    }

    # T034 (P3c): the REAL transparent content package gets the frozen-catalog
    # context (full catalog, no eligibility narrowing) whenever the run was
    # created from a typed World (setup_snapshot present). A legacy
    # world_snapshot-only run has no dataset_id to resolve a catalog from, so
    # it keeps the P1 mock-path context builder (mirrors the mock package's
    # own behavior — never a crash, just an unusable/empty catalog).
    evidence_input_snapshot: dict | None = None
    if content_pkg.id == _REAL_CONTENT_PACKAGE_ID and run_log.setup_snapshot is not None:
        context = _build_real_content_context(
            package=content_pkg,
            run_log=run_log,
            selected_service_id=selected_service_id,
            content_parameters=content_parameters,
            content_hyperparameters=content_hyperparameters,
        )
        # MF2 (P3 POLISH unit): the real content selector's context embeds
        # the full frozen catalog — redact it for the PERSISTED evidence
        # only; evaluate() below still receives the full `context`.
        evidence_input_snapshot = _redact_catalog_for_evidence(
            context, dataset_id=run_log.setup_snapshot.dataset_id
        )
    else:
        context = _build_content_context(
            package=content_pkg,
            run_log=run_log,
            selected_service_id=selected_service_id,
            content_parameters=content_parameters,
            content_hyperparameters=content_hyperparameters,
        )

    evidence = dispatch_selector(
        content_pkg,
        context,
        settings.packages_dir,
        matrix_version=run_log.matrix_version,
        used_feature_ids=list(context["feature_snapshot"].keys()),
        evidence_input_snapshot=evidence_input_snapshot,
    )

    at = _now_iso()
    if evidence.error is not None:
        event = DiscreteEvent(
            event_type=DiscreteEventType.ALGORITHM_ERROR,
            at=at,
            payload={
                "step": "content",
                "category": evidence.error.category,
                "message": evidence.error.message,
            },
        )
        new_status = ProposalRunStatus.error
        new_active_service_id = run_log.journey_state.active_service_id
    else:
        event = DiscreteEvent(
            event_type=DiscreteEventType.CONTENT_SELECTED,
            at=at,
            payload={"selected_service_id": selected_service_id.value},
        )
        new_status = ProposalRunStatus.content_selected
        new_active_service_id = selected_service_id

    prm.append_event(run_id, event, settings.proposal_runs_dir)
    prm.append_evidence(run_id, evidence, settings.proposal_runs_dir)

    new_journey_state = JourneyState(
        lifecycle_stage=run_log.journey_state.lifecycle_stage,
        motion_state=run_log.journey_state.motion_state,
        active_service_id=new_active_service_id,
        active_plan_id=run_log.journey_state.active_plan_id,
    )

    # FIX 2 (whole-branch review): re-freeze the persisted setup_snapshot's
    # content_parameter_set_version (+ content_contract_version) to the
    # CONTENT parameter set ACTUALLY used at STEP 2, mirroring exactly how
    # STEP 1 (`_freeze_setup_snapshot`) derives it from the resolved
    # hyperparameters -- STEP 1 only ever freezes the manifest DEFAULTS,
    # which misrepresents the run whenever the reviewer overrides content
    # hyperparameters at STEP 2 (FR-011/SC-008). Only the persisted metadata
    # changes here -- `context`/`evidence` above (what evaluate() received
    # and returned) are already fixed by this point, untouched by this block.
    updated_setup_snapshot = None
    if run_log.setup_snapshot is not None:
        used_content_parameter_set_version = content_hyperparameters.get(
            "parameter_set_version", content_pkg.version
        )
        updated_setup_snapshot = run_log.setup_snapshot.model_copy(
            update={
                "content_package_id": content_pkg.id,
                "content_contract_version": content_pkg.contract_version,
                "content_parameter_set_version": used_content_parameter_set_version,
            }
        )

    run_log = prm.update_state(
        run_id,
        settings.proposal_runs_dir,
        status=new_status,
        journey_state=new_journey_state,
        content_parameters=content_parameters,
        content_hyperparameters=content_hyperparameters,
        setup_snapshot=updated_setup_snapshot,
    )
    return run_log


# ---------------------------------------------------------------------------
# GET /api/proposal/runs — T032 (list summaries; US2)
# ---------------------------------------------------------------------------


@router.get("/api/proposal/runs")
def list_proposal_runs() -> list[ProposalRun]:
    """Return summaries for every persisted proposal run.

    Sourced entirely from ``proposal_runs/*.json`` on disk (P1 has no
    in-process run registry yet — see ``proposal_run_manager.list_runs``).
    """
    return prm.list_runs(settings.proposal_runs_dir)


# ---------------------------------------------------------------------------
# GET /api/proposal/runs/{run_id} — T033 (full log, no recompute; US2)
# ---------------------------------------------------------------------------


@router.get("/api/proposal/runs/{run_id}")
def get_proposal_run(run_id: str) -> ProposalRunLog:
    """Return the full persisted ``ProposalRunLog`` for ``run_id``.

    Reopen renders the log exactly as recorded — no selector is ever
    re-invoked here (mirrors ``proposal_run_manager.get_run``'s contract).
    """
    run_log = prm.get_run(run_id, settings.proposal_runs_dir)
    if run_log is None:
        raise HTTPException(status_code=404, detail=f"Proposal run {run_id!r} not found")
    return run_log


# ---------------------------------------------------------------------------
# DELETE /api/proposal/runs/{run_id} — T034 (US2)
# ---------------------------------------------------------------------------


@router.delete("/api/proposal/runs/{run_id}", status_code=204)
def delete_proposal_run(run_id: str) -> Response:
    """Remove ``proposal_runs/<run_id>.json``. Never touches trigger ``runs/``."""
    deleted = prm.delete_run(run_id, settings.proposal_runs_dir)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Proposal run {run_id!r} not found")
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# POST /api/proposal/runs/{run_id}/journey/action — T012 (P4 engine scaffold)
# ---------------------------------------------------------------------------


@router.post("/api/proposal/runs/{run_id}/journey/action")
def apply_journey_action(run_id: str, action: JourneyAction) -> ProposalRunLog:
    """Apply one journey action via the PURE ``proposal_journey.apply_action``
    engine (data-model.md §"JourneyAction"; contracts/journey-api.md).

    ``action`` is parsed directly as a ``JourneyAction`` — an unrecognized
    ``action_type`` string fails FastAPI/pydantic request validation (422)
    before this handler ever runs, since ``JourneyActionType`` is a closed
    enum; that is distinct from the engine's OWN structured 422 (below), which
    covers a *valid* ``action_type`` rejected for a precondition the current
    run state doesn't satisfy.

    This router owns the ONLY two side-effecting responsibilities the engine
    itself must never perform: minting the timestamp (``_now_iso()``) and
    persisting the result (append-only, via ``proposal_run_manager``). A
    ``rejected`` transition raises a structured 422 — never a silent no-op;
    a ``NO_ELIGIBLE_CANDIDATE`` end-state (later units) is a 200 success, not
    an error, per the contract.
    """
    run_log = prm.get_run(run_id, settings.proposal_runs_dir)
    if run_log is None:
        raise HTTPException(status_code=404, detail=f"Proposal run {run_id!r} not found")

    transition = apply_action(run_log, action, now=_now_iso())

    if transition.rejected is not None:
        raise HTTPException(
            status_code=422,
            detail={
                "code": transition.rejected.code,
                "message": transition.rejected.message,
            },
        )

    for event in transition.events:
        prm.append_event(run_id, event, settings.proposal_runs_dir)

    run_log = prm.update_state(
        run_id,
        settings.proposal_runs_dir,
        status=transition.new_status,
        journey_state=transition.new_journey_state,
    )
    return run_log
