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
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, ValidationError

from aica_api.config import settings
from aica_api.models.proposal.enums import (
    DiscreteEventType,
    LifecycleStage,
    MotionState,
    PlaybackState,
    ProposalPackageFamily,
    ProposalRunMode,
    ProposalRunStatus,
    ServiceId,
    TriggerPurpose,
)
from aica_api.models.proposal.events import DiscreteEvent
from aica_api.models.proposal.evidence import AlgorithmEvidence
from aica_api.models.proposal.explanation import Explanation, ExplanationPrompt
from aica_api.models.proposal.journey import JourneyState
from aica_api.models.proposal.journey_action import JourneyAction
from aica_api.models.proposal.journey_preview import JourneyPreview
from aica_api.models.proposal.matrix import MatrixResolutionError, PurposeStageServiceMatrix
from aica_api.models.proposal.opportunity import ProposalOpportunity
from aica_api.models.proposal.package_manifest import BilingualLabel, ProposalPackageManifest
from aica_api.models.proposal.preset import AlgorithmConfigOverrides, Preset
from aica_api.models.proposal.proposal_run import ProposalRun, ProposalRunLog
from aica_api.models.proposal.recompute import RecomputeRequest
from aica_api.models.proposal.service_capabilities import ServiceCapabilities
from aica_api.models.proposal.world import (
    DriverProfile,
    DriverProfileRecord,
    SeedWorld,
    SetupSnapshot,
    SetupSnapshotOrigin,
    World,
)
from aica_api.services import explanation_builder, ollama_client
from aica_api.services import proposal_run_manager as prm
from aica_api.services.algorithm_config import merge_algorithm_config
from aica_api.services.dataset_catalog_registry import DatasetCatalogRegistry
from aica_api.services.driver_profile_store import (
    DriverProfileConflictError,
    DriverProfileNotFoundError,
    DriverProfileStore,
)
from aica_api.services.preset_store import PresetStore
from aica_api.services.proposal_eligibility import derive_registered_entities, resolve_eligibility
from aica_api.services.proposal_journey import apply_action
from aica_api.services.proposal_journey_preview import preview as build_journey_preview
from aica_api.services.proposal_package_registry import ProposalPackageRegistry
from aica_api.services.proposal_selector import dispatch_selector
from aica_api.services.world_clone_store import InvalidOverrideError, apply_overrides
from aica_api.services.world_seed_store import WorldSeedStore
from aica_api.services.world_validation import ValidationIssue, validate_world
from aica_api.storage.file_store import read_json, write_json_atomic

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


def _service_capabilities_path():
    return settings.proposal_contracts_dir / "service_capabilities" / "service_capabilities.v1.json"


def _get_service_capabilities() -> ServiceCapabilities:
    """Load the frozen v1 service-capability artifact (US1/T015 — eligibility)."""
    return ServiceCapabilities.load(_service_capabilities_path())


def _get_dataset_registry() -> DatasetCatalogRegistry:
    """Instantiate a DatasetCatalogRegistry from the configured dataset directory."""
    return DatasetCatalogRegistry(settings.proposal_dataset_dir)


def _get_seed_store() -> WorldSeedStore:
    """Instantiate a WorldSeedStore from the configured seeds directory."""
    return WorldSeedStore(settings.proposal_seeds_dir)


def _get_profile_store() -> DriverProfileStore:
    """Instantiate a DriverProfileStore from the configured user-profiles directory."""
    return DriverProfileStore(settings.proposal_profiles_dir)


def _get_preset_store() -> PresetStore:
    """Instantiate a PresetStore from the configured presets directory.

    Raises ``PresetLoadError`` (unhandled here -> FastAPI 500) if any
    committed preset file fails to validate — a load-time integrity error
    surfaced visibly, never a silently degraded preset list (data-model.md
    §Preset, contracts/preset_endpoints.md).
    """
    return PresetStore(settings.proposal_presets_dir)


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
    eligible_service_ids: list[ServiceId],
    excluded_candidates: list[dict],
) -> dict:
    """Assemble a SelectorInput-shaped context dict for the SERVICE selector.

    US1 (P4 eligibility, research.md D1): ``allowed_service_ids`` here — the
    id list actually handed to ``evaluate()`` — is the ELIGIBLE subset of the
    opportunity's frozen row, never the full row. Eligibility runs BEFORE
    ranking, so a package (the mock_service_selector_v1 draws its candidates
    straight from this field) physically cannot rank an excluded service
    (SC-003, FR-005). ``opportunity.allowed_service_ids`` itself is untouched
    — it remains the frozen matrix row for the run's own record.
    """
    feature_snapshot = dict(world_snapshot.get("feature_snapshot") or {})
    feature_provenance = dict(world_snapshot.get("feature_provenance") or {})
    return {
        "contract_version": package.contract_version,
        "opportunity_id": opportunity.opportunity_id,
        "simulation_time": opportunity.simulation_time,
        "trigger_purpose": opportunity.trigger_purpose.value,
        "lifecycle_stage": opportunity.lifecycle_stage.value,
        "allowed_service_ids": [s.value for s in eligible_service_ids],
        "feature_snapshot": feature_snapshot,
        "feature_provenance": feature_provenance,
        "enabled_feature_extensions": list(enabled_feature_extensions),
        "selected_service_id": None,
        "eligible_candidates": [{"candidate_id": s.value} for s in eligible_service_ids],
        "excluded_candidates": excluded_candidates,
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
    # Hide fixture packages (``hidden: true`` — the mock_* selectors) from the
    # reviewer-facing list; they stay loaded/slottable for the test-suite.
    return {
        "slots": reg.list_slots(),
        "packages": [p for p in reg.list_summaries() if not p.get("hidden")],
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
# GET /api/proposal/presets — feature 018 (committed preset test-cases)
# ---------------------------------------------------------------------------


@router.get("/api/proposal/presets")
def get_presets() -> dict:
    """List the committed presets (summary projection), sorted by preset_id."""
    store = _get_preset_store()
    return {"presets": store.list_summaries()}


@router.get("/api/proposal/presets/{preset_id}")
def get_preset(preset_id: str) -> Preset:
    """Return the full Preset (world + overrides + expectation) for preset_id."""
    store = _get_preset_store()
    preset = store.get(preset_id)
    if preset is None:
        raise HTTPException(status_code=404, detail=f"preset not found: {preset_id}")
    return preset


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

    ``origin_preset_id`` (feature 018) is the analogous hint when the world
    (and, via ``algorithm_config_overrides``, the service/content
    hyperparameters) originated from a committed ``Preset`` — frozen into
    ``SetupSnapshot.origin.origin_preset_id``. ``algorithm_config_overrides``
    carries the preset's per-selector deltas; ``.service`` is deep-merged
    into the resolved service ``hyperparameters`` BEFORE the STEP-1 service
    ``dispatch_selector`` call (and, for a quick_check run, ``.content`` is
    likewise merged into the content hyperparameters before the inline
    STEP-2 content dispatch) — see ``services/algorithm_config.py``.
    """

    trigger_purpose: TriggerPurpose | None = None
    lifecycle_stage: LifecycleStage | None = None
    motion_state: MotionState | None = None
    world: World | None = None
    world_snapshot: dict[str, Any] = {}
    origin_seed_id: str | None = None
    origin_clone_id: str | None = None
    origin_profile_id: str | None = None
    origin_preset_id: str | None = None
    algorithm_config_overrides: AlgorithmConfigOverrides | None = None
    service_package_id: str
    content_package_id: str
    mode: ProposalRunMode = ProposalRunMode.interactive
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
    *,
    world: World,
    matrix_version: str,
    service_pkg: ProposalPackageManifest,
    content_pkg: ProposalPackageManifest,
    service_hyperparameters: dict,
    origin_seed_id: str | None = None,
    origin_clone_id: str | None = None,
    origin_profile_id: str | None = None,
    origin_preset_id: str | None = None,
) -> tuple[dict, SetupSnapshot]:
    """Validate the typed world and build (world_snapshot dict, SetupSnapshot).

    T011 (P7, research.md D3): origin inputs are explicit params rather than
    the whole ``CreateProposalRunBody`` — ``create_proposal_run`` passes them
    from ``body.origin_*`` (unchanged behavior); a later recompute call
    (P7 Phase 3) passes the run's existing ``setup_snapshot.origin`` carried
    forward instead, with no dependency on any ``CreateProposalRunBody``.

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
            seed_id=origin_seed_id,
            clone_id=origin_clone_id,
            profile_id=origin_profile_id,
            origin_preset_id=origin_preset_id,
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

    # feature 018 (preset override seam #1 — service, STEP 1): merge the
    # preset's isolated ``service`` config delta over the resolved service
    # hyperparameters BEFORE the SetupSnapshot freeze (which records the
    # resulting parameter_set_version) and BEFORE the service
    # dispatch_selector call below. Never mutates service_pkg's own
    # package.json — merge_algorithm_config always returns a fresh dict.
    if body.algorithm_config_overrides is not None:
        hyperparameters = merge_algorithm_config(
            hyperparameters, body.algorithm_config_overrides.service
        )

    # P3 typed-world path: validate + project + freeze a SetupSnapshot; the
    # resulting world_snapshot dict replaces body.world_snapshot for the
    # service-selector context and the persisted log (world wins over
    # world_snapshot when both are given).
    setup_snapshot: SetupSnapshot | None = None
    world_snapshot = body.world_snapshot
    if body.world is not None:
        world_snapshot, setup_snapshot = _freeze_setup_snapshot(
            world=body.world,
            matrix_version=matrix.matrix_version,
            service_pkg=service_pkg,
            content_pkg=content_pkg,
            service_hyperparameters=hyperparameters,
            origin_seed_id=body.origin_seed_id,
            origin_clone_id=body.origin_clone_id,
            origin_profile_id=body.origin_profile_id,
            origin_preset_id=body.origin_preset_id,
        )

    # -----------------------------------------------------------------
    # US1 (P4) — eligibility narrows the allowed row BEFORE ranking
    # (research.md D1). Excluded services are RETAINED with reason codes,
    # never dropped; they carry no score (FR-003/FR-004).
    # -----------------------------------------------------------------
    capabilities = _get_service_capabilities()
    registered_entities = derive_registered_entities(world_snapshot)
    eligibility_result = resolve_eligibility(
        allowed_service_ids,
        motion_state,
        capabilities,
        registered_entities=registered_entities,
    )
    excluded_candidates_ctx = [
        {
            "candidate_id": excl.service_id.value,
            "platform_reason": ",".join(rc.value for rc in excl.reason_codes),
        }
        for excl in eligibility_result.excluded
    ]

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

    if not eligibility_result.eligible:
        # T017a — every allowed service was excluded (a non-empty allowed row
        # narrowed to zero). Never dispatch a selector — there is nothing to
        # rank, and no evaluate() call happened, so no AlgorithmEvidence is
        # fabricated to pretend one did (Constitution Principle V).
        events.append(
            DiscreteEvent(
                event_type=DiscreteEventType.NO_ELIGIBLE_CANDIDATE,
                at=at,
                payload={
                    "excluded": [
                        {
                            "service_id": excl.service_id.value,
                            "reason_codes": [rc.value for rc in excl.reason_codes],
                        }
                        for excl in eligibility_result.excluded
                    ],
                },
            )
        )
        journey_state = JourneyState(
            lifecycle_stage=lifecycle_stage,
            motion_state=motion_state,
            active_service_id=None,
            active_plan_id=None,
        )
        return prm.create_run(
            opportunity=opportunity,
            matrix_version=matrix.matrix_version,
            world_snapshot=world_snapshot,
            service_package_id=body.service_package_id,
            content_package_id=body.content_package_id,
            parameters=parameters,
            hyperparameters=hyperparameters,
            journey_state=journey_state,
            events=events,
            evidence=[],
            status=ProposalRunStatus.service_selected,
            setup_snapshot=setup_snapshot,
            world=body.world,
            mode=body.mode,
            runs_dir=settings.proposal_runs_dir,
        )

    context = _build_service_context(
        package=service_pkg,
        opportunity=opportunity,
        world_snapshot=world_snapshot,
        enabled_feature_extensions=body.enabled_feature_extensions,
        parameters=parameters,
        hyperparameters=hyperparameters,
        eligible_service_ids=eligibility_result.eligible,
        excluded_candidates=excluded_candidates_ctx,
    )

    evidence = dispatch_selector(
        service_pkg,
        context,
        settings.packages_dir,
        matrix_version=matrix.matrix_version,
        used_feature_ids=list(context["feature_snapshot"].keys()),
        allowed_service_ids=[s.value for s in eligibility_result.eligible],
    )

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
        world=body.world,
        mode=body.mode,
        runs_dir=settings.proposal_runs_dir,
    )

    # US3/T024 (FR-011-FR-013): quick_check auto-dispatches content for the
    # rank-1 service in the SAME response, whenever STEP 1 actually yielded
    # one. Interactive mode (and quick_check with no rank-1, e.g. zero
    # eligible/an errored service dispatch) is untouched -- it stops here.
    if body.mode == ProposalRunMode.quick_check and selected_service_id is not None:
        content_parameters = dict(content_pkg.parameters)
        content_hyperparameters = {hp.key: hp.default for hp in content_pkg.hyperparameters}
        # feature 018 (preset override seam #2 — content, quick_check STEP 2
        # dispatched inline here): merge the preset's isolated ``content``
        # config delta over the resolved content hyperparameters BEFORE the
        # content dispatch inside _apply_quick_check_content.
        if body.algorithm_config_overrides is not None:
            content_hyperparameters = merge_algorithm_config(
                content_hyperparameters, body.algorithm_config_overrides.content
            )
        run_log = _apply_quick_check_content(
            run_log.run_id,
            run_log,
            ServiceId(selected_service_id),
            content_parameters,
            content_hyperparameters,
        )

    return run_log


# ---------------------------------------------------------------------------
# _dispatch_content_for_service — T010 (P7, research.md D5)
# ---------------------------------------------------------------------------


def _dispatch_content_for_service(
    run_log: ProposalRunLog,
    selected_service_id: ServiceId,
    content_parameters: dict,
    content_hyperparameters: dict,
) -> tuple[AlgorithmEvidence, dict | None]:
    """Dispatch the CONTENT selector for ``selected_service_id`` against
    ``run_log`` and return ``(evidence, evidence_input_snapshot)``.

    Extracted from ``select_service``'s STEP-2 content-dispatch body
    (research.md D5) so quick-check (create + recompute, later P7 units) can
    reuse the IDENTICAL real-vs-mock context-builder choice
    (``_build_real_content_context``/``_build_content_context``), the
    ``_REAL_CONTENT_PACKAGE_ID`` gate, catalog redaction
    (``_redact_catalog_for_evidence``), and the ``dispatch_selector`` call —
    guaranteeing quick-check content == interactive content (FR-014/SC-006),
    since both paths call this exact function.

    The user-supplied-service eligibility check and the content package's
    own ``supported_services`` gate stay in ``select_service`` (they validate
    a *user-supplied* service id); this helper assumes ``selected_service_id``
    is already known eligible/supported — for quick-check it is the
    selector's own rank-1, already eligible by construction.

    Returns:
        A tuple of the dispatched ``AlgorithmEvidence`` and the (possibly
        catalog-redacted) dict recorded as its persisted ``input_snapshot``
        — ``None`` when no redaction was applied (mock/legacy content path,
        where ``dispatch_selector`` falls back to ``context`` itself).

    Raises:
        HTTPException(422): ``run_log.content_package_id`` is unknown or
            mis-slotted (not a ``content_selector`` family package).
    """
    registry = _get_registry()
    content_pkg = registry.get(run_log.content_package_id) if run_log.content_package_id else None
    if content_pkg is None or content_pkg.family != ProposalPackageFamily.content_selector:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown or mis-slotted content_package_id: {run_log.content_package_id!r}",
        )

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
    return evidence, evidence_input_snapshot


# ---------------------------------------------------------------------------
# _apply_quick_check_content — T024/T025 (P7 Unit D, US3)
# ---------------------------------------------------------------------------


def _apply_quick_check_content(
    run_id: str,
    run_log: ProposalRunLog,
    selected_service_id: ServiceId,
    content_parameters: dict,
    content_hyperparameters: dict,
) -> ProposalRunLog:
    """Quick-check-only: dispatch content for the auto-selected rank-1
    service via ``_dispatch_content_for_service`` (the SAME helper
    ``select_service`` uses — FR-014/SC-006 content parity) and advance the
    run to ``content_selected`` in the SAME call. Shared by quick-check
    create (T024) and quick-check recompute (T025).

    Mirrors ``select_service``'s STEP-2 tail (content-package-support gate,
    event + status + setup_snapshot bookkeeping) with one difference:
    quick-check is AUTOMATIC (the service was never reviewer-chosen), so an
    unsupported rank-1 can never raise an HTTPException the way
    ``select_service`` does for a user-supplied service — it is instead
    recorded as an ``ALGORITHM_ERROR`` event (step=content,
    category=unsupported_service) with no fabricated plan, exactly like a
    zero-eligible service never fabricates a candidate (Constitution
    Principle V).

    ``journey_state.active_service_id`` is left untouched here — both
    ``create_proposal_run`` and ``recompute_proposal_run`` already set it to
    this same rank-1 service unconditionally (interactive or quick_check)
    before this helper is ever called, so there is no mode-conditioned
    ``active_service_id`` semantics to introduce (research.md / P7 brief:
    the data-model.md interactive-vs-None split is a doc reconciliation
    deferred to Step 5, not implemented here).
    """
    registry = _get_registry()
    content_pkg = registry.get(run_log.content_package_id) if run_log.content_package_id else None
    at = _now_iso()

    if content_pkg is None or selected_service_id not in content_pkg.supported_services:
        event = DiscreteEvent(
            event_type=DiscreteEventType.ALGORITHM_ERROR,
            at=at,
            payload={
                "step": "content",
                "category": "unsupported_service",
                "message": (
                    f"Content package {run_log.content_package_id!r} does not "
                    f"support service {selected_service_id.value!r}"
                ),
            },
        )
        prm.append_event(run_id, event, settings.proposal_runs_dir)
        return prm.update_state(run_id, settings.proposal_runs_dir, status=ProposalRunStatus.error)

    evidence, _evidence_input_snapshot = _dispatch_content_for_service(
        run_log, selected_service_id, content_parameters, content_hyperparameters
    )

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
    else:
        event = DiscreteEvent(
            event_type=DiscreteEventType.CONTENT_SELECTED,
            at=at,
            payload={"selected_service_id": selected_service_id.value},
        )
        new_status = ProposalRunStatus.content_selected

    prm.append_event(run_id, event, settings.proposal_runs_dir)
    prm.append_evidence(run_id, evidence, settings.proposal_runs_dir)

    # Mirrors select_service's FIX 2: re-freeze the persisted
    # content_parameter_set_version (+ content_contract_version) to what was
    # ACTUALLY used for this content dispatch (FR-011/SC-008).
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

    return prm.update_state(
        run_id,
        settings.proposal_runs_dir,
        status=new_status,
        content_parameters=content_parameters,
        content_hyperparameters=content_hyperparameters,
        setup_snapshot=updated_setup_snapshot,
    )


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

    ``algorithm_config_overrides`` (feature 018) is the analogous preset
    override seam for the INTERACTIVE STEP-2 content dispatch — only
    ``.content`` is relevant here (there is no service dispatch at this
    step); it is merged over ``hyperparameters`` the same way
    ``CreateProposalRunBody.algorithm_config_overrides.service`` is merged
    at STEP 1.
    """

    selected_service_id: ServiceId
    parameters: dict[str, Any] = {}
    hyperparameters: dict[str, Any] = {}
    algorithm_config_overrides: AlgorithmConfigOverrides | None = None


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

    # FIX (whole-branch review Critical / SC-002 / FR-002): the check above
    # only confirms membership in the FULL frozen row — it does NOT confirm
    # the service is still ELIGIBLE. Re-resolve eligibility against the
    # CURRENT motion state (a `motion_change` journey action may have fired
    # since create) and reject an excluded selection here, before it can ever
    # reach `accept` and become active driving content (e.g. `full_karaoke`
    # while `motion_state=driving`).
    capabilities = _get_service_capabilities()
    eligibility = resolve_eligibility(
        run_log.opportunity.allowed_service_ids,
        run_log.journey_state.motion_state,
        capabilities,
        registered_entities=derive_registered_entities(run_log.world_snapshot),
    )
    if selected_service_id not in eligibility.eligible:
        reasons = next(
            (
                excl.reason_codes
                for excl in eligibility.excluded
                if excl.service_id == selected_service_id
            ),
            [],
        )
        raise HTTPException(
            status_code=422,
            detail={
                "code": "service_not_eligible",
                "message": (
                    f"{selected_service_id.value!r} is not currently eligible / "
                    f"{selected_service_id.value!r} は現在選択できません"
                ),
                "reason_codes": [rc.value for rc in reasons],
            },
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

    # feature 018 (preset override seam #3 — content, interactive STEP 2):
    # merge the preset's isolated ``content`` config delta over the resolved
    # content hyperparameters BEFORE the content dispatch below.
    if body.algorithm_config_overrides is not None:
        content_hyperparameters = merge_algorithm_config(
            content_hyperparameters, body.algorithm_config_overrides.content
        )

    # T010 (P7, research.md D5): the real-vs-mock context-builder choice, the
    # _REAL_CONTENT_PACKAGE_ID gate, catalog redaction, and the
    # dispatch_selector call itself are extracted into a shared helper so
    # quick-check (later P7 units) dispatches content through the identical
    # code path — no behavior change here.
    evidence, _evidence_input_snapshot = _dispatch_content_for_service(
        run_log, selected_service_id, content_parameters, content_hyperparameters
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
# POST /api/proposal/runs/{run_id}/recompute — P7 Unit B, T017 (US1 MVP)
# ---------------------------------------------------------------------------


@router.post("/api/proposal/runs/{run_id}/recompute")
def recompute_proposal_run(run_id: str, body: RecomputeRequest) -> ProposalRunLog:
    """Recompute the proposal for an existing run at its CURRENT lifecycle
    stage and motion, applying explicit reviewer overrides, and append a new
    frozen decision point to the same run (contracts/recompute-api.md;
    data-model.md; research.md D1-D4/D8).

    Mirrors ``create_proposal_run``'s matrix-resolve -> eligibility ->
    dispatch_selector -> persist orchestration (research.md D1: recompute is
    a ROUTER endpoint, never ``proposal_journey.apply_action`` -- the pure
    journey engine stays free of selector dispatch/IO), but on top of the
    run's EXISTING base ``World`` rather than a brand-new request body, and
    APPENDS rather than replaces: the prior head opportunity/setup_snapshot
    are pushed into the append-only history lists before the new head is
    installed (FR-004/SC-002).

    Guards (in order): 404 unknown run; 422 legacy run (no stored typed
    ``world`` -- FR-006); 422 while a content plan is actively playing
    (``playback_state`` in {active, backgrounded} -- FR-006a, never silently
    ending a playing plan); 422 on an invalid override (FR-005, no snapshot
    ever appended). A selector algorithm error is NOT an HTTP error -- it is
    recorded as an ``ALGORITHM_ERROR`` event + ``status=error`` and returned
    200 (Constitution Principle V / FR-019), exactly like ``create_proposal_run``.

    Interactive-mode runs stop at the service decision (``service_selected``/
    ``error``/``NO_ELIGIBLE_CANDIDATE``). US3/T025: a ``quick_check`` run
    additionally dispatches content for the rank-1 service in this SAME
    call via ``_apply_quick_check_content`` (which itself calls the shared
    ``_dispatch_content_for_service`` -- FR-012/FR-014), advancing to
    ``content_selected``/``error`` -- never when there is no rank-1 (zero
    eligible or a service-selector error leaves the run at
    ``service_selected``/``error`` with no content fabricated).
    """
    run_log = prm.get_run(run_id, settings.proposal_runs_dir)
    if run_log is None:
        raise HTTPException(status_code=404, detail=f"Proposal run {run_id!r} not found")

    if run_log.world is None:
        raise HTTPException(
            status_code=422,
            detail="recompute requires a typed-world run",
        )

    if run_log.journey_state.playback_state in (PlaybackState.active, PlaybackState.backgrounded):
        raise HTTPException(
            status_code=422,
            detail={
                "code": "recompute_requires_idle_playback",
                "message": (
                    "Recompute requires the current content plan to be "
                    "completed or stopped first / "
                    "recomputeの前に現在のコンテンツプランを完了または停止してください"
                ),
            },
        )

    # research.md D2: carry the CURRENT journey lifecycle_stage/motion_state
    # onto the run's stored base World's control_inputs (trigger_purpose and
    # dataset_id are carried unchanged) BEFORE applying the reviewer's own
    # overrides -- two internal overrides via model_copy, never persisted as
    # a CONTEXT_EDITED diff themselves.
    #
    # P7 Unit C seam fix (test-proven by test_p7_e2e_reference_journey.py):
    # `Situation.motion_state` is a SEPARATE field from
    # `ControlInputs.motion_state` (data-model.md "Situation") -- it is the
    # one `World.project()` puts into `feature_snapshot["situation"]`, which
    # is what selector packages actually read (e.g. the real content
    # selector's full-karaoke stopped-motion gate). `control_inputs.motion_state`
    # only drives eligibility/matrix resolution here. Without also syncing
    # `situation.motion_state`, a recompute after `rest_spot_arrived` (which
    # advances `journey_state.motion_state` to `stopped`) left the projected
    # feature snapshot reporting the STALE seed motion_state (`driving`),
    # spuriously denying `full_karaoke` content as "while moving" even though
    # the run is genuinely stopped.
    js = run_log.journey_state
    effective_control_inputs = run_log.world.control_inputs.model_copy(
        update={"lifecycle_stage": js.lifecycle_stage, "motion_state": js.motion_state}
    )
    effective_situation = run_log.world.situation.model_copy(update={"motion_state": js.motion_state})
    effective_base_world = run_log.world.model_copy(
        update={"control_inputs": effective_control_inputs, "situation": effective_situation}
    )

    dataset_registry = _get_dataset_registry()
    catalog = dataset_registry.get_catalog(effective_base_world.control_inputs.dataset_id)

    try:
        new_world, diffs = apply_overrides(effective_base_world, body.overrides, catalog=catalog)
    except InvalidOverrideError as exc:
        raise HTTPException(status_code=422, detail=[issue.model_dump() for issue in exc.issues]) from exc

    registry = _get_registry()
    service_pkg = registry.get(run_log.service_package_id)
    if service_pkg is None or service_pkg.family != ProposalPackageFamily.service_selector:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown or mis-slotted service_package_id: {run_log.service_package_id!r}",
        )
    content_pkg = registry.get(run_log.content_package_id) if run_log.content_package_id else None
    if content_pkg is None or content_pkg.family != ProposalPackageFamily.content_selector:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown or mis-slotted content_package_id: {run_log.content_package_id!r}",
        )

    parameters = body.parameters or dict(run_log.parameters)
    hyperparameters = body.hyperparameters or dict(run_log.hyperparameters)

    # research.md D3: the run's EXISTING setup_snapshot.origin is carried
    # forward (never re-derived from a CreateProposalRunBody, which doesn't
    # exist here) -- a typed-world run always has a setup_snapshot (frozen at
    # create time), guaranteed by the `run_log.world is None` guard above.
    origin = run_log.setup_snapshot.origin if run_log.setup_snapshot is not None else None
    world_snapshot, setup_snapshot = _freeze_setup_snapshot(
        world=new_world,
        matrix_version=run_log.matrix_version,
        service_pkg=service_pkg,
        content_pkg=content_pkg,
        service_hyperparameters=hyperparameters,
        origin_seed_id=origin.seed_id if origin is not None else None,
        origin_clone_id=origin.clone_id if origin is not None else None,
        origin_profile_id=origin.profile_id if origin is not None else None,
    )

    matrix = PurposeStageServiceMatrix.load(_matrix_path())
    try:
        allowed_service_ids = matrix.resolve(
            new_world.control_inputs.trigger_purpose, new_world.control_inputs.lifecycle_stage
        )
    except MatrixResolutionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    opportunity_id = _make_opportunity_id()
    try:
        opportunity = ProposalOpportunity(
            opportunity_id=opportunity_id,
            trigger_purpose=new_world.control_inputs.trigger_purpose,
            lifecycle_stage=new_world.control_inputs.lifecycle_stage,
            allowed_service_ids=allowed_service_ids,
            simulation_time=run_log.opportunity.simulation_time,
            run_seed=run_log.opportunity.run_seed,
        )
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # -----------------------------------------------------------------
    # Eligibility narrows the allowed row BEFORE ranking (mirrors
    # create_proposal_run exactly -- research.md D1).
    # -----------------------------------------------------------------
    capabilities = _get_service_capabilities()
    registered_entities = derive_registered_entities(world_snapshot)
    eligibility_result = resolve_eligibility(
        allowed_service_ids,
        new_world.control_inputs.motion_state,
        capabilities,
        registered_entities=registered_entities,
    )
    excluded_candidates_ctx = [
        {
            "candidate_id": excl.service_id.value,
            "platform_reason": ",".join(rc.value for rc in excl.reason_codes),
        }
        for excl in eligibility_result.excluded
    ]

    at = _now_iso()
    events: list[DiscreteEvent] = []
    if diffs:
        events.append(
            DiscreteEvent(
                event_type=DiscreteEventType.CONTEXT_EDITED,
                at=at,
                payload={"diffs": [diff.model_dump(mode="json") for diff in diffs]},
            )
        )
    events.append(
        DiscreteEvent(
            event_type=DiscreteEventType.OPPORTUNITY_OPENED,
            at=at,
            payload={
                "opportunity_id": opportunity_id,
                "trigger_purpose": opportunity.trigger_purpose.value,
                "lifecycle_stage": opportunity.lifecycle_stage.value,
            },
        )
    )
    events.append(
        DiscreteEvent(
            event_type=DiscreteEventType.RECOMPUTED,
            at=at,
            payload={
                "from_opportunity_id": run_log.opportunity.opportunity_id,
                "to_opportunity_id": opportunity_id,
            },
        )
    )

    evidence: AlgorithmEvidence | None = None
    selected_service_id: ServiceId | None = None
    if not eligibility_result.eligible:
        # T017a-equivalent (research.md D1/D8): every allowed service was
        # excluded -- never dispatch a selector, never fabricate a candidate.
        events.append(
            DiscreteEvent(
                event_type=DiscreteEventType.NO_ELIGIBLE_CANDIDATE,
                at=at,
                payload={
                    "excluded": [
                        {
                            "service_id": excl.service_id.value,
                            "reason_codes": [rc.value for rc in excl.reason_codes],
                        }
                        for excl in eligibility_result.excluded
                    ],
                },
            )
        )
        new_status = ProposalRunStatus.service_selected
    else:
        context = _build_service_context(
            package=service_pkg,
            opportunity=opportunity,
            world_snapshot=world_snapshot,
            enabled_feature_extensions=[],
            parameters=parameters,
            hyperparameters=hyperparameters,
            eligible_service_ids=eligibility_result.eligible,
            excluded_candidates=excluded_candidates_ctx,
        )
        evidence = dispatch_selector(
            service_pkg,
            context,
            settings.packages_dir,
            matrix_version=run_log.matrix_version,
            used_feature_ids=list(context["feature_snapshot"].keys()),
            allowed_service_ids=[s.value for s in eligibility_result.eligible],
        )
        if evidence.error is not None:
            new_status = ProposalRunStatus.error
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
                selected_service_id = ServiceId(ranked_candidates[0]["candidate_id"])
                events.append(
                    DiscreteEvent(
                        event_type=DiscreteEventType.SERVICE_SELECTED,
                        at=at,
                        payload={"selected_service_id": selected_service_id.value, "rank": 1},
                    )
                )
            new_status = ProposalRunStatus.service_selected

    # -----------------------------------------------------------------
    # Assemble the new head: push the PRIOR head into append-only history,
    # install the new opportunity/setup_snapshot as the current head
    # (data-model.md "Modified: ProposalRunLog" invariant: history EXCLUDES
    # the current head, index-aligned across both lists). A typed-world run
    # always has a setup_snapshot (frozen at create time) -- guaranteed by
    # the `run_log.world is None` guard above.
    # -----------------------------------------------------------------
    new_opportunity_history = [*run_log.opportunity_history, run_log.opportunity]
    new_setup_snapshot_history = [*run_log.setup_snapshot_history, run_log.setup_snapshot]

    # data-model.md "State transitions (recompute effect on JourneyState)":
    # active_service_id resets (rank-1 or None); rejected_service_ids resets
    # to []; lifecycle_stage/motion_state/playback_state/previous_content/
    # current_plan_ref/active_plan_id are all PRESERVED (untouched here).
    new_journey_state = js.model_copy(
        update={"active_service_id": selected_service_id, "rejected_service_ids": []}
    )

    for event in events:
        prm.append_event(run_id, event, settings.proposal_runs_dir)
    if evidence is not None:
        prm.append_evidence(run_id, evidence, settings.proposal_runs_dir)

    run_log = prm.update_state(
        run_id,
        settings.proposal_runs_dir,
        status=new_status,
        journey_state=new_journey_state,
        opportunity=opportunity,
        world_snapshot=world_snapshot,
        setup_snapshot=setup_snapshot,
        opportunity_history=new_opportunity_history,
        setup_snapshot_history=new_setup_snapshot_history,
    )

    # US3/T025 (FR-012/FR-014): a quick_check run additionally dispatches
    # content for the rank-1 service in this SAME recompute response,
    # whenever this recompute actually yielded one (interactive runs, and
    # quick_check with no rank-1, are untouched -- they stop above).
    if run_log.mode == ProposalRunMode.quick_check and selected_service_id is not None:
        content_parameters_for_dispatch = body.content_parameters or dict(content_pkg.parameters)
        content_hyperparameters_for_dispatch = body.content_hyperparameters or {
            hp.key: hp.default for hp in content_pkg.hyperparameters
        }
        run_log = _apply_quick_check_content(
            run_id,
            run_log,
            selected_service_id,
            content_parameters_for_dispatch,
            content_hyperparameters_for_dispatch,
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

    transition = apply_action(
        run_log, action, now=_now_iso(), capabilities=_get_service_capabilities()
    )

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


# ---------------------------------------------------------------------------
# GET /api/proposal/runs/{run_id}/journey/preview — T029-T030 (US5, P4)
# ---------------------------------------------------------------------------


@router.get("/api/proposal/runs/{run_id}/journey/preview")
def get_journey_preview(run_id: str) -> JourneyPreview:
    """Non-binding rolling-horizon preview (spec.md User Story 5; FR-017;
    SC-007; contracts/journey-api.md §"GET .../journey/preview").

    PURE READ: loads the persisted run and projects the preview via
    ``proposal_journey_preview.preview`` — no selector is invoked, and this
    handler never appends an event/evidence or calls ``update_state``. The
    run's on-disk file and ``GET /runs/{id}`` response are byte-identical
    before and after this call.
    """
    run_log = prm.get_run(run_id, settings.proposal_runs_dir)
    if run_log is None:
        raise HTTPException(status_code=404, detail=f"Proposal run {run_id!r} not found")
    return build_journey_preview(run_log)


# ---------------------------------------------------------------------------
# POST /api/proposal/runs/{run_id}/explain — feature 019, LLM rationale
#
# NARRATION LAYER ONLY. Regenerates the single human-readable rationale
# sentence for one already-decided candidate/item, grounded strictly in the
# persisted decision trace. It NEVER re-runs a selector, changes a score, or
# touches ranking/feature contributions (Constitution I/II/V). The SAME
# server-built prompt is used by both providers so backend-model vs Gemini-Nano
# is an apples-to-apples comparison.
#
#   provider=backend  → run local Ollama; on ANY failure fall back to the
#                       deterministic template (never disguised); append an
#                       honest, append-only Explanation record and return it.
#   provider=browser  → build-only: return the prompt; the client runs Gemini
#                       Nano on-device. Display-only, nothing is persisted.
# ---------------------------------------------------------------------------


class ExplainRequestBody(BaseModel):
    step: Literal["service", "content"]
    target_id: str
    provider: Literal["backend", "browser"]


class ExplainResponse(BaseModel):
    step: Literal["service", "content"]
    target_id: str
    requested_provider: Literal["backend", "browser"]
    # Filled for the backend/template providers; empty for browser (the client
    # runs `prompt` through Gemini Nano and fills it in on-device).
    rationale: list[str]
    provider_used: Literal["backend", "browser", "template"]
    model: str
    fell_back: bool
    error: str | None
    prompt: ExplanationPrompt


def _resolve_song_name(run_log: ProposalRunLog, track_id: str) -> str | None:
    """Best-effort catalog lookup of a song's display title (feature 019).

    Fully defensive — any failure (legacy run without a dataset, quarantined
    catalog, unknown id) simply returns ``None`` and the reason omits the title.
    """
    dataset_id = None
    try:
        if run_log.world is not None and run_log.world.catalog_ref is not None:
            dataset_id = run_log.world.catalog_ref.dataset_id
    except Exception:  # noqa: BLE001
        dataset_id = None
    if not dataset_id and run_log.setup_snapshot is not None:
        dataset_id = getattr(run_log.setup_snapshot, "dataset_id", None)
    if not dataset_id:
        return None
    try:
        catalog_map = _catalog_map_for_dataset(dataset_id) or {}
        song = catalog_map.get(track_id)
        if song:
            return (song.get("spotify_track") or {}).get("name")
    except Exception:  # noqa: BLE001
        return None
    return None


def _find_explain_target(
    run_log: ProposalRunLog, step: str, target_id: str
) -> tuple[AlgorithmEvidence | None, dict | None]:
    """Locate the latest non-error evidence for ``step`` and the candidate/item
    matching ``target_id`` within its recorded output (append-only, newest wins)."""
    ev = next(
        (e for e in reversed(run_log.evidence) if e.step == step and e.error is None and e.output),
        None,
    )
    if ev is None:
        return None, None
    if step == "service":
        items = ev.output.get("ranked_candidates", []) or []
        key = "candidate_id"
    else:
        items = ev.output.get("ordered_items", []) or []
        key = "item_id"
    target = next((it for it in items if str(it.get(key)) == target_id), None)
    return ev, target


@router.post("/api/proposal/runs/{run_id}/explain")
def explain_run(run_id: str, body: ExplainRequestBody) -> ExplainResponse:
    run_log = prm.get_run(run_id, settings.proposal_runs_dir)
    if run_log is None:
        raise HTTPException(status_code=404, detail=f"Proposal run {run_id!r} not found")

    ev, target = _find_explain_target(run_log, body.step, body.target_id)
    if ev is None:
        raise HTTPException(
            status_code=422,
            detail={"code": "no_decision", "message": f"No {body.step} decision recorded for this run"},
        )
    if target is None:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "unknown_target",
                "message": f"{body.step} target {body.target_id!r} not found in the recorded decision",
            },
        )

    context: dict[str, Any] = {
        "trigger_purpose": ev.input_snapshot.get("trigger_purpose"),
        "lifecycle_stage": ev.input_snapshot.get("lifecycle_stage"),
    }
    # feature 019 (Maximal grounding) — best-effort song title for content, so
    # the reason can name the track. Fully optional: any failure just omits it.
    if body.step == "content":
        context["song_name"] = _resolve_song_name(run_log, body.target_id)

    prompt = explanation_builder.build_explanation_prompt(body.step, target, context)
    p_hash = explanation_builder.prompt_hash(prompt)

    # ── Browser (Gemini Nano) — build-only, no inference, no persistence ────
    if body.provider == "browser":
        return ExplainResponse(
            step=body.step,
            target_id=body.target_id,
            requested_provider="browser",
            rationale=[],
            provider_used="browser",
            model="gemini-nano",
            fell_back=False,
            error=None,
            prompt=prompt,
        )

    # ── Backend (Ollama) — generate; fall back to template on any failure ───
    messages = [{"role": m.role, "content": m.content} for m in prompt.messages]
    generated_at = datetime.now(timezone.utc).isoformat()
    try:
        raw = ollama_client.generate(
            messages,
            model=settings.ollama_model,
            base_url=settings.ollama_base_url,
            timeout=settings.ollama_timeout_sec,
        )
        parsed = explanation_builder.parse_bilingual(raw)
        # Reject blank output OR a weak model that just echoed the prompt facts
        # (see explanation_builder.response_is_usable) — fall back honestly to
        # the template rather than presenting echoed text as a real generation.
        if not explanation_builder.response_is_usable(parsed, prompt):
            raise ollama_client.OllamaError("unusable_response", "Model output was empty or echoed the prompt")
        # Strip any leftover format-example placeholder tokens ("(factor A)")
        # AFTER the usable/parrot check, then re-verify non-empty.
        rationale = [explanation_builder.strip_placeholder_artifacts(p) for p in parsed]
        if not any(p.strip() for p in rationale):
            raise ollama_client.OllamaError("unusable_response", "Model output was only placeholder artifacts")
        provider_used: Literal["backend", "template"] = "backend"
        model = settings.ollama_model
        fell_back = False
        error: str | None = None
    except ollama_client.OllamaError as exc:
        rationale = explanation_builder.template_rationale(body.step, target)
        provider_used = "template"
        model = "template"
        fell_back = True
        error = exc.error_type

    explanation = Explanation(
        step=body.step,
        target_id=body.target_id,
        requested_provider="backend",
        provider_used=provider_used,
        model=model,
        rationale=rationale,
        fell_back=fell_back,
        error=error,
        prompt_hash=p_hash,
        generated_at=generated_at,
    )
    prm.append_explanation(run_id, explanation, settings.proposal_runs_dir)

    return ExplainResponse(
        step=body.step,
        target_id=body.target_id,
        requested_provider="backend",
        rationale=rationale,
        provider_used=provider_used,
        model=model,
        fell_back=fell_back,
        error=error,
        prompt=prompt,
    )


# ---------------------------------------------------------------------------
# POST /api/proposal/nano-test/results — feature 019 in-browser eval sink
#
# Catches results posted by the in-browser Gemini Nano test harness
# (app/frontend/public/nano-test.html), so a maintainer can review how the
# on-device model performed across the presets — exactly the same server-built
# prompts the backend uses, run through Chrome's Nano instead of Ollama. This is
# a LOCAL single-user tool (no auth). The latest batch overwrites
# proposal_runs/nano-test-results.json (git-ignored, host-readable).
# ---------------------------------------------------------------------------


class NanoTestResults(BaseModel):
    session_label: str | None = None
    meta: dict[str, Any] = {}
    results: list[dict[str, Any]]


@router.post("/api/proposal/nano-test/results")
def post_nano_test_results(body: NanoTestResults) -> dict:
    # Soft bound (eval sink on a local tool — the harness posts ~32*2 entries).
    if len(body.results) > 5000:
        raise HTTPException(status_code=413, detail="too many results (max 5000)")
    # Write into a dedicated SUBDIRECTORY (not directly under proposal_runs/) so
    # the sink file can never collide with a `{run_id}.json` path and is never
    # picked up by list_runs()'s top-level *.json glob.
    out_dir = settings.proposal_runs_dir / "nano-test"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "results.json"
    payload = {
        "received_at": datetime.now(timezone.utc).isoformat(),
        "session_label": body.session_label,
        "meta": body.meta,
        "count": len(body.results),
        "results": body.results,
    }
    write_json_atomic(str(path), payload)
    return {"stored": str(path), "count": len(body.results)}
