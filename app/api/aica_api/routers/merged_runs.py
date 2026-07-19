"""Merged runs router — /api/merged-runs (feature 020, Task 4).

The integration seam of the Combined Simulator: pairs one trigger run
(``aica_api.services.run_manager``, deterministic tick engine) with the
proposal simulator (``aica_api.routers.proposal``) so that a trigger fire
auto-creates/updates a proposal run, with ``CorrelationEntry`` recording
which trigger tick produced which proposal run/events.

This module — together with ``services/merged_adapter.py`` and
``services/merged_run_coordinator.py`` — is the ONLY code allowed to import
BOTH the trigger ``run_manager``/``tick_engine`` AND the proposal router /
``proposal_run_manager`` (feature-020 isolation constraint; see CLAUDE.md
project memory and the P1/P4 isolation guard tests, which this module is
deliberately outside the scope of — it lives under ``routers/``, not
``services/`` or ``models/proposal/``).

Eligibility-before-ranking is preserved because this module NEVER calls
``dispatch_selector`` directly — it only calls the existing
``create_proposal_run`` / ``select_service`` / ``apply_journey_action``
handlers, which run ``resolve_eligibility`` internally before ranking.

Slice-1 scope (feature-020 plan): one trigger fire -> one proposal run,
``rest_recommended`` only in practice, ``lifecycle_stage=before_rest_until_stop``.
No journey chain, recompute, enriched recovery, monotony, or quick-check
wiring yet (later slices) — on a SUBSEQUENT fire (``handle.current_proposal_run_id``
already set), this module does not create or recompute a proposal run.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ValidationError

from aica_api.config import settings
from aica_api.models.merged_run import (
    AcceptRestBody,
    CorrelationEntry,
    CreateMergedRunBody,
    MergedInstantResult,
    MergedProposalActionBody,
    MergedQuickviewBody,
    MergedTickResponse,
)
from aica_api.models.proposal.enums import DiscreteEventType, LifecycleStage, PlaybackState
from aica_api.models.proposal.journey_action import JourneyAction
from aica_api.models.proposal.recompute import RecomputeRequest
from aica_api.models.proposal.world import FieldOverride, World
from aica_api.models.run import RouteFacts
from aica_api.routers.proposal import (
    CreateProposalRunBody,
    SelectServiceBody,
    apply_journey_action,
    create_proposal_run,
    get_proposal_run,
    recompute_proposal_run,
    select_service,
)
from aica_api.routers.route_presets import load_route_preset
from aica_api.services import proposal_run_manager as prm
from aica_api.services import run_manager
from aica_api.services.merged_adapter import (
    build_world_from_tick,
    map_lifecycle_stage,
    map_trigger_purpose,
)
from aica_api.services.merged_painter import inject_mountain_segment, jam_traffic_event
from aica_api.services.merged_quickview import project as project_merged_quickview
from aica_api.services.merged_run_coordinator import (
    create_handle,
    get_handle,
    make_merged_run_id,
    save_handle,
)
from aica_api.services.package_registry import PackageRegistry
from aica_api.services.preview import PreviewValidationError
from aica_api.services.route_analysis import analyze_route
from aica_api.services.run_plan import create_draft, validate_context_overrides
from aica_api.services.scenario_registry import ScenarioRegistry

router = APIRouter()


# ── Run-ID / plan-ID generation (mirrors routers/runs.py's _make_run_id and
#    routers/run_plans.py's _make_plan_id conventions; kept local rather than
#    imported so this seam stays self-contained) ──────────────────────────────


def _make_trigger_run_id() -> str:
    """Generate a unique trigger run_id: ``run_<YYYYMMDD-HHMMSS>_<6-hex>``."""
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    rand = os.urandom(3).hex()
    return f"run_{ts}_{rand}"


def _make_merged_plan_id() -> str:
    """Generate a unique plan_id: ``plan_<YYYYMMDD-HHMMSS>_<6-hex>``."""
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    rand = os.urandom(3).hex()
    return f"plan_{ts}_{rand}"


# ── Request body models ───────────────────────────────────────────────────────


class CreateMergedPlanBody(BaseModel):
    """Request body for ``POST /api/merged-runs/plan`` (Slice-2b Task 2).

    Builds a trigger-side run-plan draft (the same registry ``POST
    /api/run-plans`` populates) whose route_facts/event-plan are "painted"
    with an ad-hoc ``mountain_road`` segment and/or a manually-positioned
    traffic jam, via the Task-1 pure painter (``services/merged_painter.py``)
    — so a merged scenario can be composed without new scenario JSON fixtures.

    ``route_preset_id`` selects a pre-extracted Google route (same envelope
    ``routers/route_presets.py``'s ``load_route_preset`` returns); ``None``
    (default) uses the local ``analyze_route(scenario)`` path — same as the
    run-plans router's local path.
    """

    package_id: str
    scenario_id: str
    route_preset_id: str | None = None
    run_seed: int
    mountain_range_km: tuple[float, float] | None = None
    jam_range_km: tuple[float, float] | None = None
    jam_speed_kph: float = 15.0
    presets: dict = {}
    parameters: dict = {}
    hyperparameters: dict = {}
    # Trigger-side situation edits (feature 020 exact-reuse redesign): the
    # Combined Situation editor reuses the trigger fixed-conditions / speed /
    # initial-signal editors verbatim; these carry their (sparse) edits so a
    # PAINTED run respects them too, threaded into the same ``create_draft``
    # ``routers/run_plans.py`` uses. ``None`` (default) means "unedited".
    profiles: dict | None = None
    initial_state: dict | None = None
    context_overrides: dict | None = None


# ── Trigger-tick serialization helper ────────────────────────────────────────


def _serialize_trigger_tick(outcome: run_manager.TickOutcome) -> dict:
    """Mirror the field extraction in ``routers/runs.py``'s tick endpoint:
    the authoritative display position (route_fraction/distance_km) from the
    evaluated TickState, the per-tick dynamic-tier display signals
    (speedKph/motionState/recoveryPhase/isTrafficJam/segmentType), plus
    paused/completed/decision (and algorithm_error, for parity with the two
    branches routers/runs.py returns).
    """
    ts = outcome.tick_state
    route_fraction = ts.route_fraction if ts is not None else None
    distance_km = ts.distance_km if ts is not None else None
    signals = (ts.signals or {}) if ts is not None else {}
    dynamic = signals.get("dynamic", {})

    return {
        "decision": outcome.decision,
        "error": outcome.algorithm_error,
        "paused": outcome.paused,
        "completed": outcome.completed,
        "tick_index": outcome.evaluated_tick_index,
        "route_fraction": route_fraction,
        "distance_km": distance_km,
        "speed_kph": dynamic.get("speedKph"),
        "motion_state": dynamic.get("motionState"),
        "recovery_phase": dynamic.get("recoveryPhase"),
        "is_traffic_jam": dynamic.get("isTrafficJam"),
        "segment_type": dynamic.get("segmentType"),
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("/api/merged-runs/plan")
def create_merged_plan_endpoint(body: CreateMergedPlanBody) -> dict:
    """Build a "painted" trigger run-plan draft and return its ``plan_id``.

    Mirrors ``routers/run_plans.py``'s ``create_run_plan_endpoint`` for
    resolving package/scenario (400 for unknown/incompatible), but builds
    ``route_facts`` from either the local ``analyze_route(scenario)`` path
    (``route_preset_id`` absent) or a loaded route preset envelope (same
    shape ``routers/route_presets.py``'s ``load_route_preset`` returns), then
    applies the Task-1 pure painter (``services/merged_painter.py``):

      - ``mountain_range_km`` splices a ``mountain_road`` run into
        ``route_facts.route_segments`` (POSITION-native — km extents).
      - ``jam_range_km`` converts to a TIME-based manual traffic-jam preset
        (using the route's total km + estimated duration) appended to
        ``presets["traffic_events"]`` (there is no pre-built ``EventPlan``
        param on ``create_draft``).

    The resulting draft is registered via the existing
    ``run_plan.create_draft`` — the SAME registry ``POST /api/run-plans``
    populates — so the returned ``plan_id`` feeds directly into
    ``POST /api/merged-runs`` (``trigger_plan_id``) unchanged.
    """
    pkg_reg = PackageRegistry(settings.packages_dir)
    sc_reg = ScenarioRegistry(settings.scenarios_dir)

    package = pkg_reg.get(body.package_id)
    if package is None:
        raise HTTPException(
            status_code=400,
            detail=f"Package {body.package_id!r} not found or invalid",
        )

    scenario = sc_reg.get(body.scenario_id)
    if scenario is None:
        raise HTTPException(
            status_code=400,
            detail=f"Scenario {body.scenario_id!r} not found or invalid",
        )

    if not pkg_reg.is_compatible(package, scenario):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Package {body.package_id!r} is not compatible with "
                f"scenario {body.scenario_id!r} (type={scenario.type!r})"
            ),
        )

    if body.route_preset_id is not None:
        preset_envelope = load_route_preset(body.route_preset_id)
        route_facts = RouteFacts.model_validate(
            preset_envelope["alternatives"][0]["route_facts"]
        )
    else:
        route_facts = analyze_route(scenario)

    if body.mountain_range_km is not None:
        start_km, end_km = body.mountain_range_km
        route_facts.route_segments = inject_mountain_segment(
            route_facts.route_segments, start_km, end_km
        )

    presets = dict(body.presets)
    if body.jam_range_km is not None:
        start_km, end_km = body.jam_range_km
        jam = jam_traffic_event(
            start_km,
            end_km,
            route_facts.total_route_distance_km,
            route_facts.estimated_route_duration_min,
            speed_kph=body.jam_speed_kph,
        )
        traffic_events = list(presets.get("traffic_events", []))
        traffic_events.append(jam)
        presets["traffic_events"] = traffic_events

    # Validate the trigger situation edits threaded from the Combined Situation
    # editor (feature 020) — same rejections the run-plans router applies on the
    # unpainted path, so both merged trigger-plan paths behave identically.
    if body.initial_state is not None:
        valid_initial_keys = {"drowsiness_level", "fatigue_level"}
        init_errors: list[dict[str, str]] = []
        for key, value in body.initial_state.items():
            if key not in valid_initial_keys:
                init_errors.append(
                    {
                        "field": f"initial_state.{key}",
                        "message": f"Unknown initial_state key {key!r}. Valid keys: {sorted(valid_initial_keys)}",
                    }
                )
            elif not isinstance(value, (int, float)) or isinstance(value, bool):
                init_errors.append(
                    {
                        "field": f"initial_state.{key}",
                        "message": f"initial_state.{key} must be a number in [0, 100]; got {value!r}",
                    }
                )
            elif not 0 <= value <= 100:
                init_errors.append(
                    {
                        "field": f"initial_state.{key}",
                        "message": f"initial_state.{key} must be in [0, 100]; got {value!r}",
                    }
                )
        if init_errors:
            raise HTTPException(
                status_code=400,
                detail={"detail": "One or more initial_state values are invalid.", "validation_errors": init_errors},
            )

    if body.context_overrides is not None:
        ctx_errors = validate_context_overrides(body.context_overrides)
        if ctx_errors:
            raise HTTPException(
                status_code=400,
                detail={"detail": "One or more context_overrides values are invalid.", "validation_errors": ctx_errors},
            )

    plan_id = _make_merged_plan_id()
    draft = create_draft(
        plan_id=plan_id,
        package=package,
        scenario=scenario,
        presets=presets,
        parameters=body.parameters,
        hyperparameters=body.hyperparameters,
        route_facts=route_facts,
        route_source=route_facts.route_source,
        run_seed=body.run_seed,
        profiles=body.profiles,
        initial_state=body.initial_state,
        context_overrides=body.context_overrides,
    )

    if draft.validation_errors:
        raise HTTPException(
            status_code=400,
            detail={
                "detail": "One or more parameter/hyperparameter values are invalid.",
                "validation_errors": draft.validation_errors,
            },
        )

    return {"plan_id": draft.plan_id}


def _build_quickview_route_facts(
    body: MergedQuickviewBody,
) -> tuple[Any, str, dict[str, Any] | None]:
    """Resolve package/scenario and build a "painted" route_facts (+ any
    manual-jam ``presets``) for the quickview projection — mirrors
    ``create_merged_plan_endpoint`` above (same painter reuse, same
    400-on-unknown/incompatible convention), but scoped to ONLY this
    endpoint's isolated helper since ``services/merged_quickview.py`` itself
    must never import a trigger Pydantic model (feature-020 isolation
    constraint — see that module's docstring): building route_facts stays
    here, in the router that already straddles both sides of the merge
    boundary, and is handed to ``merged_quickview.project`` as opaque
    ``Any``/``dict`` values (``route_facts``/``route_source``/``presets``).

    Returns ``(route_facts, route_source, presets)`` — ``route_source`` is
    always ``"maps"`` here (a route_facts was actually built/painted);
    ``presets`` is ``{"traffic_events": [jam]}`` when ``jam_range_km`` was
    supplied, else ``None``. The caller only invokes this when a
    preset/mountain/jam field was actually supplied, so the common
    (unpainted) quickview case never reaches this function and stays as
    simple as the trigger's own ``/api/runs/preview``
    (``route_source="local"``, ``route_facts=None``, ``presets=None``).

    Raises HTTPException(400) for an unknown/incompatible package or
    scenario — same convention as ``create_merged_plan_endpoint``.
    """
    pkg_reg = PackageRegistry(settings.packages_dir)
    sc_reg = ScenarioRegistry(settings.scenarios_dir)

    package = pkg_reg.get(body.package_id)
    if package is None:
        raise HTTPException(
            status_code=400,
            detail=f"Package {body.package_id!r} not found or invalid",
        )

    scenario = sc_reg.get(body.scenario_id)
    if scenario is None:
        raise HTTPException(
            status_code=400,
            detail=f"Scenario {body.scenario_id!r} not found or invalid",
        )

    if not pkg_reg.is_compatible(package, scenario):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Package {body.package_id!r} is not compatible with "
                f"scenario {body.scenario_id!r} (type={scenario.type!r})"
            ),
        )

    if body.route_preset_id is not None:
        preset_envelope = load_route_preset(body.route_preset_id)
        route_facts = RouteFacts.model_validate(
            preset_envelope["alternatives"][0]["route_facts"]
        )
    else:
        route_facts = analyze_route(scenario)

    if body.mountain_range_km is not None:
        start_km, end_km = body.mountain_range_km
        route_facts.route_segments = inject_mountain_segment(
            route_facts.route_segments, start_km, end_km
        )

    presets: dict[str, Any] | None = None
    if body.jam_range_km is not None:
        start_km, end_km = body.jam_range_km
        jam = jam_traffic_event(
            start_km,
            end_km,
            route_facts.total_route_distance_km,
            route_facts.estimated_route_duration_min,
            speed_kph=body.jam_speed_kph,
        )
        presets = {"traffic_events": [jam]}

    return route_facts, "maps", presets


@router.post("/api/merged-runs/quickview", response_model=MergedInstantResult)
def quickview_merged_run_endpoint(body: MergedQuickviewBody) -> MergedInstantResult:
    """Ephemeral, non-persisting projection of the WHOLE merged chain
    (feature 020, Slice-2c): one headless trigger preview pass
    (``services.preview.iter_preview_ticks``) with a default quick-check
    proposal attached to every actionable fire
    (``services/merged_quickview.py::project``). Nothing is persisted
    anywhere — not the trigger run, not any projected proposal run (each
    built with ``cache={}``).

    ``route_preset_id``/``mountain_range_km``/``jam_range_km`` mirror
    ``POST /api/merged-runs/plan``: only when one of these is supplied does
    this endpoint resolve the package/scenario and build a painted
    route_facts (``_build_quickview_route_facts``) — the common (unpainted)
    case stays as simple as ``/api/runs/preview`` (``route_source="local"``,
    no route_facts).

    400 for an unknown/incompatible package or scenario, an old-shape
    scenario, or invalid hyperparameter overrides
    (``PreviewValidationError``, raised from inside
    ``iter_preview_ticks``).
    """
    route_facts: Any = None
    route_source = "local"
    presets: dict[str, Any] | None = None

    if (
        body.route_preset_id is not None
        or body.mountain_range_km is not None
        or body.jam_range_km is not None
    ):
        route_facts, route_source, presets = _build_quickview_route_facts(body)

    try:
        return project_merged_quickview(
            body,
            packages_dir=settings.packages_dir,
            scenarios_dir=settings.scenarios_dir,
            route_facts=route_facts,
            route_source=route_source,
            presets=presets,
        )
    except PreviewValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/api/merged-runs", status_code=201)
def create_merged_run_endpoint(body: CreateMergedRunBody) -> dict:
    """Create the trigger run (from an existing ``POST /api/run-plans`` draft)
    and the paired ``MergedRunHandle``. 400 for an unknown trigger_plan_id.
    """
    trigger_run_id = _make_trigger_run_id()
    try:
        run_manager.create_run(body.trigger_plan_id, trigger_run_id, settings.runs_dir)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    merged_run_id = make_merged_run_id()
    handle = create_handle(
        merged_run_id=merged_run_id,
        trigger_run_id=trigger_run_id,
        world_template=body.world.model_dump(mode="json"),
        service_package_id=body.service_package_id,
        content_package_id=body.content_package_id,
        proposal_mode=body.proposal_mode,
        run_seed=body.run_seed,
        merged_dir=settings.merged_runs_dir,
        service_parameters=body.service_parameters,
        service_hyperparameters=body.service_hyperparameters,
        content_parameters=body.content_parameters,
        content_hyperparameters=body.content_hyperparameters,
    )
    save_handle(handle, settings.merged_runs_dir)

    return {"merged_run_id": merged_run_id, "trigger_run_id": trigger_run_id}


@router.get("/api/merged-runs/{merged_run_id}")
def get_merged_run_endpoint(merged_run_id: str) -> dict:
    """Reassemble a persisted merged run for read-only replay (feature 020,
    Slice-2c, Task 4): the ``MergedRunHandle``, the raw trigger ``RunLog``
    JSON exactly as stored on disk (mirrors ``routers/runs.py``'s
    ``get_run_log``), and every paired ``ProposalRunLog`` (via
    ``proposal_run_manager.get_run``, in ``handle.proposal_run_ids`` order).

    Pure disk reads — nothing is recomputed, and no selector/tick-engine code
    runs. 404 when ``merged_run_id`` is unknown. ``trigger_log`` is ``None``
    if the trigger run's file is missing (should not happen for a real merged
    run, but this endpoint never raises for it — it is not the resource being
    looked up). Entries in ``handle.proposal_run_ids`` that resolve to
    ``None`` (a proposal run file the caller does not have, or a stale
    ``None``/missing entry) are skipped rather than erroring, since
    ``proposal_logs`` is a best-effort projection over IDs that are
    themselves append-only history, never mutated after being recorded.
    """
    handle = get_handle(merged_run_id, settings.merged_runs_dir)
    if handle is None:
        raise HTTPException(status_code=404, detail=f"Merged run {merged_run_id!r} not found")

    trigger_log_path = settings.runs_dir / f"{handle.trigger_run_id}.json"
    trigger_log = (
        json.loads(trigger_log_path.read_text(encoding="utf-8"))
        if trigger_log_path.exists()
        else None
    )

    proposal_logs = []
    for proposal_run_id in handle.proposal_run_ids:
        if proposal_run_id is None:
            continue
        plog = prm.get_run(proposal_run_id, settings.proposal_runs_dir)
        if plog is not None:
            proposal_logs.append(plog.model_dump(mode="json"))

    return {
        "handle": handle.model_dump(mode="json"),
        "trigger_log": trigger_log,
        "proposal_logs": proposal_logs,
    }


@router.get("/api/merged-runs")
def list_merged_runs_endpoint() -> dict:
    """List summaries for every persisted merged run under
    ``settings.merged_runs_dir`` (feature 020, Slice-2c, Task 4) — mirrors
    ``routers/runs.py``'s ``list_runs_endpoint`` (glob ``*.json``, skip
    corrupt/invalid files rather than raising; this is a listing helper, not
    a validator).
    """
    merged_dir = settings.merged_runs_dir
    items: list[dict] = []
    if not merged_dir.exists():
        return {"merged_runs": items}

    for path in sorted(merged_dir.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        items.append(
            {
                "merged_run_id": data.get("merged_run_id", path.stem),
                "trigger_run_id": data.get("trigger_run_id"),
                "proposal_run_ids_count": len(data.get("proposal_run_ids") or []),
            }
        )
    return {"merged_runs": items}


def _override_nap_stage_ticks(scenario, recovery_option_id: str, nap_minutes: int):
    """Return a NEW ``ScenarioDef`` with the chosen option's nap STOPPED stage
    (``phase == "nap"``) lasting ``round(nap_minutes * 60 /
    scenario.tick_seconds)`` ticks instead of its scenario-authored default.

    Never mutates the input ``scenario`` in place. ``scenario`` is whatever
    ``run_manager.get_scenario`` returns for the trigger run — that object may
    be the LITERAL SAME reference shared with another run created from the
    same ``trigger_plan_id`` (``run_manager.create_run`` stores the
    ``run_plan._draft_registry[plan_id]`` ScenarioDef without copying it, and
    a plan_id is never invalidated after use — see ``run_manager
    .replace_scenario``'s docstring). Mutating ``scenario.recovery_options``
    directly would therefore silently corrupt every other run built from
    that plan_id. Instead this builds an entirely new ``ScenarioDef`` (new
    ``RecoveryOption``/``RecoveryStage`` copies via ``model_copy`` for the
    touched option, top-level ``model_copy`` for the rest) that the caller
    must install via ``run_manager.replace_scenario`` on THIS run's own
    registry entry only.
    """
    new_ticks = round(nap_minutes * 60 / scenario.tick_seconds)
    new_recovery_options = [
        (
            option.model_copy(
                update={
                    "stages": [
                        stage.model_copy(update={"ticks": new_ticks})
                        if stage.phase == "nap" and stage.motion == "STOPPED"
                        else stage
                        for stage in option.stages
                    ]
                }
            )
            if option.id == recovery_option_id
            else option
        )
        for option in scenario.recovery_options
    ]
    return scenario.model_copy(update={"recovery_options": new_recovery_options})


@router.post("/api/merged-runs/{merged_run_id}/accept-rest")
def accept_rest_endpoint(merged_run_id: str, body: AcceptRestBody) -> dict:
    """Start the trigger-side recovery sequence for a merged run's REST fire.

    Calls ``run_manager.action(trigger_run_id, "accept_rest", ...)`` — the
    SAME entrypoint the trigger-only screen uses — to begin the deterministic
    recovery state machine (Approach A, M7). When ``nap_minutes`` is
    supplied, the chosen option's nap STOPPED stage duration is overridden
    (``_override_nap_stage_ticks``) on a per-run ``ScenarioDef`` COPY,
    installed into ONLY this trigger run's registry entry via
    ``run_manager.replace_scenario`` BEFORE starting recovery, so the
    subsequent tick-engine countdown honors the requested sleep length
    without leaking into any other run that happens to share the same
    ``trigger_plan_id`` (see ``run_manager.replace_scenario``'s docstring).

    Sets ``handle.rest_stage_synced = "before"`` — the rest-journey
    auto-drive block in ``tick_merged_run_endpoint`` below watches this to
    detect the "motion just became stopped" transition exactly once.

    404 for an unknown merged_run_id or trigger_run_id; 422 when
    ``run_manager.action`` rejects the action (e.g. an unknown
    ``recovery_option_id``, or the trigger run isn't currently paused on a
    pending proposal).
    """
    handle = get_handle(merged_run_id, settings.merged_runs_dir)
    if handle is None:
        raise HTTPException(status_code=404, detail=f"Merged run {merged_run_id!r} not found")

    scenario = run_manager.get_scenario(handle.trigger_run_id)
    if scenario is None:
        raise HTTPException(
            status_code=404,
            detail=f"Trigger run {handle.trigger_run_id!r} not found",
        )

    try:
        if body.nap_minutes is not None:
            # Build an isolated per-run ScenarioDef copy and install it into
            # ONLY this trigger run's registry entry — never mutate the
            # `scenario` object fetched above in place (see
            # `_override_nap_stage_ticks`/`run_manager.replace_scenario`
            # docstrings for why that object may be shared with other runs).
            updated_scenario = _override_nap_stage_ticks(
                scenario, body.recovery_option_id, body.nap_minutes
            )
            run_manager.replace_scenario(handle.trigger_run_id, updated_scenario)

        run_state = run_manager.action(
            handle.trigger_run_id,
            "accept_rest",
            recovery_option_id=body.recovery_option_id,
            rest_spot=body.rest_spot,
        )
    except run_manager.RunNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=f"Trigger run {handle.trigger_run_id!r} not found",
        )
    except run_manager.ActionNotAllowedError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    handle.rest_stage_synced = "before"
    handle.nap_minutes = body.nap_minutes
    save_handle(handle, settings.merged_runs_dir)

    return run_state.model_dump(mode="json")


@router.post("/api/merged-runs/{merged_run_id}/decline")
def decline_rest_endpoint(merged_run_id: str) -> dict:
    """Decline a merged run's pending REST proposal and keep ticking (owner
    review — the Combined Simulator's on-map rest overlay 'reject' button).

    Calls ``run_manager.action(trigger_run_id, "decline")`` — the SAME
    entrypoint the trigger-only screen's decline uses — which clears the
    pending proposal and returns the run to a playing state WITHOUT starting
    any recovery. Also resets ``handle.current_proposal_run_id`` to ``None`` so
    a LATER re-fire (after the trigger cooldown) spawns a FRESH proposal run
    instead of being silently swallowed by the once-per-run fire guard in
    ``tick_merged_run_endpoint`` (``current_proposal_run_id is None``).

    404 for an unknown merged_run_id or trigger_run_id; 422 when
    ``run_manager.action`` rejects the action (e.g. the trigger run isn't
    currently paused on a pending proposal).
    """
    handle = get_handle(merged_run_id, settings.merged_runs_dir)
    if handle is None:
        raise HTTPException(status_code=404, detail=f"Merged run {merged_run_id!r} not found")

    try:
        run_state = run_manager.action(handle.trigger_run_id, "decline")
    except run_manager.RunNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=f"Trigger run {handle.trigger_run_id!r} not found",
        )
    except run_manager.ActionNotAllowedError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # Re-arm the fire guard so a later re-fire creates a new proposal run.
    handle.current_proposal_run_id = None
    save_handle(handle, settings.merged_runs_dir)

    return run_state.model_dump(mode="json")


@router.post("/api/merged-runs/{merged_run_id}/tick")
def tick_merged_run_endpoint(merged_run_id: str) -> MergedTickResponse:
    """Advance the paired trigger run by one tick; 404 for an unknown
    merged_run_id.

    Slice-1: the FIRST trigger fire that produces a fired proposal
    auto-creates a proposal run (via the existing ``create_proposal_run``
    handler, which runs eligibility-before-ranking internally) and records a
    ``CorrelationEntry``. Subsequent fires are a no-op here (slice-1 does not
    chain/recompute) — only checked via
    ``handle.current_proposal_run_id is None``.
    """
    handle = get_handle(merged_run_id, settings.merged_runs_dir)
    if handle is None:
        raise HTTPException(status_code=404, detail=f"Merged run {merged_run_id!r} not found")

    try:
        outcome = run_manager.tick(handle.trigger_run_id)
    except run_manager.RunNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=f"Trigger run {handle.trigger_run_id!r} not found",
        )

    trigger_dict = _serialize_trigger_tick(outcome)
    resp = MergedTickResponse(trigger=trigger_dict)

    d = outcome.decision
    fired = bool(d and d.fire_control.fired and d.proposal is not None)
    purpose = map_trigger_purpose(d.result_type) if d else None

    if fired and purpose is not None and handle.current_proposal_run_id is None:
        stage = map_lifecycle_stage(fired=True, result_type=d.result_type, recovery_phase=None)
        world = build_world_from_tick(
            World.model_validate(handle.world_template),
            outcome.tick_state,
            trigger_purpose=purpose,
            lifecycle_stage=stage,
        )
        # `handle.proposal_mode` is an unconstrained ``str`` on
        # ``CreateMergedRunBody``/``MergedRunHandle`` (no Literal/enum), so
        # `POST /api/merged-runs` accepts any string. `CreateProposalRunBody
        # .mode` is enum-typed (``ProposalRunMode``) — constructing this
        # model manually here means an invalid stored value must be caught
        # explicitly (mirrors the SelectServiceBody/JourneyAction
        # ValidationError -> 422 convention two call sites below), rather
        # than letting the ValidationError propagate out as a raw 500.
        try:
            proposal_body = CreateProposalRunBody(
                world=world,
                trigger_purpose=purpose,
                lifecycle_stage=stage,
                motion_state=world.control_inputs.motion_state,
                service_package_id=handle.service_package_id,
                content_package_id=handle.content_package_id,
                mode=handle.proposal_mode,
                run_seed=handle.run_seed,
                simulation_time=outcome.evaluated_tick_index or 0,
                # feature 020 override plumbing: SERVICE parameters/
                # hyperparameters carried from CreateMergedRunBody onto the
                # handle. Empty (default {}) is identical to
                # CreateProposalRunBody's own field defaults, so an existing
                # merged run created without these fields is unaffected.
                parameters=handle.service_parameters,
                hyperparameters=handle.service_hyperparameters,
            )
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=exc.errors()) from exc

        try:
            plog = create_proposal_run(proposal_body)
        except HTTPException as exc:
            resp.trigger["proposal_error"] = str(exc.detail)
            return resp

        handle.proposal_run_ids.append(plog.run_id)
        handle.current_proposal_run_id = plog.run_id
        corr = CorrelationEntry(
            trigger_tick_index=outcome.evaluated_tick_index or 0,
            proposal_run_id=plog.run_id,
            proposal_event_ids=[f"{e.event_type}@{e.at}" for e in plog.events],
        )
        handle.correlation_log.append(corr)
        save_handle(handle, settings.merged_runs_dir)

        resp.proposal = plog.model_dump(mode="json")
        resp.correlation = corr

    # ── Slice-2 core (Task 3): rest-journey auto-drive ──────────────────────
    # Guarded by `rest_stage_synced` (None until `accept-rest` is called) so
    # each transition — before->during, during->after — is DRIVEN exactly
    # once per tick, however many further ticks follow. Mutually exclusive
    # with the slice-1 fire block above (that one requires
    # `current_proposal_run_id is None`; this one requires the opposite), so
    # no tick can hit both.
    #
    # Self-healing / retry-safety: each branch below re-reads the proposal
    # run's ACTUAL current state (`get_proposal_run`) before acting, rather
    # than trusting `rest_stage_synced` alone. Both transitions are actually
    # multi-step (arrived+started; rest_completed+complete/stop+recompute),
    # and only the LAST step of each flips `rest_stage_synced` forward — if
    # an EARLIER step in a chain succeeds but a LATER one raises (caught
    # below), the persisted proposal-run state has already moved on while
    # `rest_stage_synced` stays put. Without re-reading actual state, the
    # next tick would blindly re-invoke the step that already succeeded;
    # for `rest_completed` specifically, its precondition (lifecycle_stage
    # == during_rest_stopped) would then already be false, 422-ing forever
    # and permanently bricking this run's /tick endpoint with no recovery
    # path. Re-reading lets each retry skip whatever already happened and
    # resume from the actual next step instead.
    if (
        handle.current_proposal_run_id is not None
        and handle.rest_stage_synced is not None
        and outcome.tick_state is not None
    ):
        run_id = handle.current_proposal_run_id
        dynamic = (outcome.tick_state.signals or {}).get("dynamic", {})
        journey_plog = None

        if handle.rest_stage_synced == "before" and dynamic.get("motionState") == "STOPPED":
            # The recovery has reached the rest spot — the trigger's own
            # `motionState` dynamic signal is authoritative for "stopped"
            # (mirrors `build_world_from_tick`'s own motion mapping).
            try:
                current = get_proposal_run(run_id)
                if current.journey_state.lifecycle_stage == LifecycleStage.before_rest_until_stop:
                    journey_plog = apply_journey_action(
                        run_id, JourneyAction(action_type="rest_spot_arrived")
                    )
                else:
                    # rest_spot_arrived already succeeded on an earlier,
                    # partially-failed attempt — its precondition only
                    # checks opportunity.trigger_purpose (not lifecycle
                    # stage), so blindly re-issuing it here would silently
                    # duplicate a REST_SPOT_ARRIVED event.
                    journey_plog = current
                already_started = any(
                    e.event_type == DiscreteEventType.REST_STARTED for e in journey_plog.events
                )
                if not already_started:
                    journey_plog = apply_journey_action(run_id, JourneyAction(action_type="rest_started"))
                handle.rest_stage_synced = "during"
            except HTTPException as exc:
                resp.trigger["proposal_error"] = str(exc.detail)

        elif handle.rest_stage_synced == "during" and outcome.run_state.recovery is None:
            # `run_manager.tick` already collapsed `run_state.recovery` back
            # to `None` once the staged recovery finished (active ->
            # inactive, on the "resuming" tick) — see `run_manager.tick`'s
            # `_recovery_next` handling.
            try:
                current = get_proposal_run(run_id)
                if current.journey_state.lifecycle_stage == LifecycleStage.during_rest_stopped:
                    # First attempt at this transition: derive post-rest
                    # drowsiness/fatigue from THIS tick's simulated signals
                    # (the tick recovery just went inactive on) and drive
                    # rest_completed.
                    simulated = (outcome.tick_state.signals or {}).get("simulated", {})
                    drowsiness = round(simulated.get("drowsiness", 0.0))
                    fatigue = round(simulated.get("fatigue", 0.0))
                    journey_plog = apply_journey_action(
                        run_id,
                        JourneyAction(
                            action_type="rest_completed",
                            payload={
                                "post_rest": {
                                    "drowsiness_level": drowsiness,
                                    "fatigue_level": fatigue,
                                }
                            },
                        ),
                    )
                else:
                    # rest_completed already succeeded on an earlier,
                    # partially-failed attempt (lifecycle_stage has moved
                    # past during_rest_stopped, so re-invoking it here would
                    # 422 forever). Recover the SAME post-rest values from
                    # the already-persisted REST_COMPLETED event instead of
                    # re-deriving them from this (later, already-advanced)
                    # tick's simulated signals — driving has resumed since
                    # recovery completed, so drowsiness/fatigue have moved on.
                    journey_plog = current
                    completed_events = [
                        e for e in current.events if e.event_type == DiscreteEventType.REST_COMPLETED
                    ]
                    post_rest = completed_events[-1].payload if completed_events else {}
                    drowsiness = post_rest.get("drowsiness_level", 0)
                    fatigue = post_rest.get("fatigue_level", 0)

                # recompute 422s while a content plan is active/backgrounded
                # (FR-006a) — auto-complete/stop any before-rest content so
                # the after-rest recompute below is never blocked by that
                # guard. Reading playback_state fresh off `journey_plog` (not
                # a stale value) keeps this idempotent on retry too.
                if journey_plog.journey_state.playback_state == PlaybackState.active:
                    journey_plog = apply_journey_action(run_id, JourneyAction(action_type="complete"))
                if journey_plog.journey_state.playback_state in (
                    PlaybackState.active,
                    PlaybackState.backgrounded,
                ):
                    journey_plog = apply_journey_action(run_id, JourneyAction(action_type="stop"))

                journey_plog = recompute_proposal_run(
                    run_id,
                    RecomputeRequest(
                        overrides=[
                            FieldOverride(path="situation.drowsiness_level", value=drowsiness),
                            FieldOverride(path="situation.fatigue_level", value=fatigue),
                        ]
                    ),
                )
                handle.rest_stage_synced = "after"
                # Pause the response here so the frontend auto-drive loop
                # (`mergedCoordinator.play()`, which halts only on
                # `trigger.paused || trigger.completed`) stops on THIS tick to
                # surface the after-rest proposal, instead of ticking straight
                # past it. This is a response-only mutation of the plain
                # `dict` built by `_serialize_trigger_tick` — it does NOT
                # touch the trigger `RunState` server-side, so the next
                # `/tick` call resumes normally once the user presses Play
                # again.
                resp.trigger["paused"] = True
            except HTTPException as exc:
                resp.trigger["proposal_error"] = str(exc.detail)

        if journey_plog is not None:
            corr = CorrelationEntry(
                trigger_tick_index=outcome.evaluated_tick_index or 0,
                proposal_run_id=run_id,
                proposal_event_ids=[f"{e.event_type}@{e.at}" for e in journey_plog.events],
            )
            handle.correlation_log.append(corr)
            save_handle(handle, settings.merged_runs_dir)

            resp.proposal = journey_plog.model_dump(mode="json")
            resp.correlation = corr

    return resp


@router.post("/api/merged-runs/{merged_run_id}/proposal-action")
def proposal_action_endpoint(merged_run_id: str, body: MergedProposalActionBody) -> dict:
    """Dispatch a proposal-side action against the merged run's CURRENT
    proposal run. 404 if the merged run is unknown or has no active proposal
    run yet (no fire has happened).
    """
    handle = get_handle(merged_run_id, settings.merged_runs_dir)
    if handle is None:
        raise HTTPException(status_code=404, detail=f"Merged run {merged_run_id!r} not found")
    if handle.current_proposal_run_id is None:
        raise HTTPException(
            status_code=404,
            detail=f"Merged run {merged_run_id!r} has no active proposal run",
        )

    run_id = handle.current_proposal_run_id
    if body.kind == "select_service":
        if body.selected_service_id is None:
            raise HTTPException(
                status_code=422,
                detail="selected_service_id is required for kind='select_service'",
            )
        # An unknown selected_service_id fails SelectServiceBody's enum-typed
        # field validation. FastAPI only auto-converts a ValidationError to a
        # 422 for the request body it decodes itself — constructing this
        # model manually here means the error must be caught explicitly
        # (mirrors routers/proposal.py's ValidationError -> 422 convention).
        try:
            select_body = SelectServiceBody(
                selected_service_id=body.selected_service_id,
                # feature 020 override plumbing: CONTENT parameters/
                # hyperparameters carried from CreateMergedRunBody onto the
                # handle. Empty (default {}) is identical to
                # SelectServiceBody's own field defaults, so an existing
                # merged run created without these fields is unaffected.
                parameters=handle.content_parameters,
                hyperparameters=handle.content_hyperparameters,
            )
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=exc.errors()) from exc
        plog = select_service(run_id, select_body)
    else:  # kind == "journey_action"
        if body.action_type is None:
            raise HTTPException(
                status_code=422,
                detail="action_type is required for kind='journey_action'",
            )
        # Same rationale as above: JourneyAction.action_type is enum-typed.
        try:
            journey_action = JourneyAction(action_type=body.action_type, payload=body.payload)
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=exc.errors()) from exc
        plog = apply_journey_action(run_id, journey_action)

    # Refresh the correlation entry's proposal_event_ids for this proposal run
    # (most recent entry tied to run_id — slice-1 has exactly one).
    for corr in reversed(handle.correlation_log):
        if corr.proposal_run_id == run_id:
            corr.proposal_event_ids = [f"{e.event_type}@{e.at}" for e in plog.events]
            break
    save_handle(handle, settings.merged_runs_dir)

    return plog.model_dump(mode="json")
