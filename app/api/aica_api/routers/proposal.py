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
from aica_api.models.proposal.matrix import MatrixResolutionError, PurposeStageServiceMatrix
from aica_api.models.proposal.opportunity import ProposalOpportunity
from aica_api.models.proposal.package_manifest import ProposalPackageManifest
from aica_api.models.proposal.proposal_run import ProposalRun, ProposalRunLog
from aica_api.services import proposal_run_manager as prm
from aica_api.services.proposal_package_registry import ProposalPackageRegistry
from aica_api.services.proposal_selector import dispatch_selector

router = APIRouter()


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
) -> dict:
    """Assemble a SelectorInput-shaped context dict for the CONTENT selector.

    Aligned with ``tests/proposal/conftest.py::build_content_context``: a
    plain dict carrying every ``SelectorInput`` field, with the catalog (if
    any is present in the world snapshot) used to derive ``eligible_candidates``.
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
        "parameters": run_log.parameters,
        "hyperparameters": run_log.hyperparameters,
        "package_runtime_state": package_runtime_state,
        "catalog_version": world_snapshot.get("catalog_version", "n/a"),
        "run_seed": run_log.opportunity.run_seed,
    }


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
# POST /api/proposal/runs — T022 (create + STEP 1 service)
# ---------------------------------------------------------------------------


class CreateProposalRunBody(BaseModel):
    """Request body for ``POST /api/proposal/runs`` (contracts/proposal-api.md)."""

    trigger_purpose: TriggerPurpose
    lifecycle_stage: LifecycleStage
    motion_state: MotionState
    world_snapshot: dict[str, Any] = {}
    service_package_id: str
    content_package_id: str
    mode: str = "interactive"
    enabled_feature_extensions: list[str] = []
    parameters: dict[str, Any] = {}
    hyperparameters: dict[str, Any] = {}
    run_seed: str
    simulation_time: str | int


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

    matrix = PurposeStageServiceMatrix.load(_matrix_path())
    try:
        allowed_service_ids = matrix.resolve(body.trigger_purpose, body.lifecycle_stage)
    except MatrixResolutionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    opportunity_id = _make_opportunity_id()
    try:
        opportunity = ProposalOpportunity(
            opportunity_id=opportunity_id,
            trigger_purpose=body.trigger_purpose,
            lifecycle_stage=body.lifecycle_stage,
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

    context = _build_service_context(
        package=service_pkg,
        opportunity=opportunity,
        world_snapshot=body.world_snapshot,
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
    )

    at = opportunity.simulation_time
    events: list[DiscreteEvent] = [
        DiscreteEvent(
            event_type=DiscreteEventType.OPPORTUNITY_OPENED,
            at=at,
            payload={
                "opportunity_id": opportunity_id,
                "trigger_purpose": body.trigger_purpose.value,
                "lifecycle_stage": body.lifecycle_stage.value,
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
        lifecycle_stage=body.lifecycle_stage,
        motion_state=body.motion_state,
        active_service_id=selected_service_id,
        active_plan_id=None,
    )

    run_log = prm.create_run(
        opportunity=opportunity,
        matrix_version=matrix.matrix_version,
        world_snapshot=body.world_snapshot,
        service_package_id=body.service_package_id,
        content_package_id=body.content_package_id,
        parameters=parameters,
        hyperparameters=hyperparameters,
        journey_state=journey_state,
        events=events,
        evidence=[evidence],
        status=status,
        runs_dir=settings.proposal_runs_dir,
    )
    return run_log


# ---------------------------------------------------------------------------
# POST /api/proposal/runs/{run_id}/select-service — T023 (STEP 2 content)
# ---------------------------------------------------------------------------


class SelectServiceBody(BaseModel):
    """Request body for ``POST /api/proposal/runs/{run_id}/select-service``."""

    selected_service_id: ServiceId


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

    context = _build_content_context(
        package=content_pkg,
        run_log=run_log,
        selected_service_id=selected_service_id,
    )

    evidence = dispatch_selector(
        content_pkg,
        context,
        settings.packages_dir,
        matrix_version=run_log.matrix_version,
        used_feature_ids=list(context["feature_snapshot"].keys()),
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
    run_log = prm.update_state(
        run_id,
        settings.proposal_runs_dir,
        status=new_status,
        journey_state=new_journey_state,
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
