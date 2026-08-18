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
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ValidationError

from aica_api.config import settings
from aica_api.models.feedback import FeedbackEvent, FeedbackTarget
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
from aica_api.models.proposal.proposal_run import ProposalRunLog
from aica_api.models.proposal.recompute import RecomputeRequest
from aica_api.models.proposal.world import FieldOverride, World
from aica_api.models.run import ContentContext, FirePoint, RouteFacts
from aica_api.routers.proposal import (
    CreateProposalRunBody,
    ExplainRequestBody,
    ExplainResponse,
    SelectServiceBody,
    _generate_explanation,
    apply_journey_action,
    create_proposal_run,
    explain_from_run_log,
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
from aica_api.services import explanation_builder, trigger_explanation
from aica_api.services.feedback import append_feedback
from aica_api.services.package_registry import PackageRegistry
from aica_api.services.preview import PreviewValidationError
from aica_api.services.proposal_package_registry import ProposalPackageRegistry
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


def _readable_error_text(detail: Any) -> str:
    """Best-effort plain-text rendering of an ``HTTPException.detail``.

    ``detail`` is normally a ``{"code": ..., "message": ...}`` dict, or a list
    of such dicts (pydantic ``ValidationError.errors()``, or a list of
    ``world_validation.ValidationIssue`` dumps) — in either case the
    already-written human sentence lives under ``message`` (or, for a raw
    pydantic error entry, ``msg``). Only when neither shape applies does this
    fall back to ``str(detail)``, so a caller storing this in ``proposal_error``
    never surfaces the raw Python dict/list repr (curly braces, single quotes)
    that ``str()``-ing the whole ``detail`` used to produce.
    """
    if isinstance(detail, dict):
        msg = detail.get("message")
        if isinstance(msg, str) and msg:
            return msg
    elif isinstance(detail, list) and detail:
        first = detail[0]
        if isinstance(first, dict):
            msg = first.get("message") or first.get("msg")
            if isinstance(msg, str) and msg:
                return msg
    if isinstance(detail, str):
        return detail
    return str(detail)


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

    Recovery-semantics refactor (Task 9): also surfaces the content-episode
    dynamic signals (``contentActive``/``stimulusFrozen``/
    ``continuousDrivingMin``, engine ``tick_engine.py``) as
    ``content_active``/``stimulus_frozen``/``continuous_driving_min`` —
    additive, snake_case, matching this function's existing field
    convention — so a caller can observe the episode this router derives
    (``_derive_content_context``) actually reaching the engine, without
    threading the whole nested ``TickState.signals`` dict through the API.

    Live driver-signal chart: also surfaces the three DRIVER-STATE signals the
    projection's ``signal_series`` carries (``services/preview.py``) —
    simulated ``drowsiness``/``fatigue`` and the dynamic ``monotonyLevel``,
    flattened as ``drowsiness``/``fatigue``/``monotony_level``. Same three
    quantities, same 0-100 scale, so the live chart under the projection plots
    what the driver ACTUALLY did (given the reviewer's accept/decline answers)
    against what the projection predicted. Additive; ``None`` when a tick has
    no evaluated state.
    """
    ts = outcome.tick_state
    route_fraction = ts.route_fraction if ts is not None else None
    distance_km = ts.distance_km if ts is not None else None
    signals = (ts.signals or {}) if ts is not None else {}
    dynamic = signals.get("dynamic", {})
    simulated = signals.get("simulated", {})

    # Elapsed simulated minutes at this tick's END (``preview.py`` stamps its
    # fires/rest dots with the identical ``elapsed_seconds / 60`` clock), so the
    # live chart can label each event ``@ N min`` on the SAME scale as the
    # projection — and, because it is the real elapsed time of the tick the
    # trigger actually fired on, it tracks the reviewer's accept/decline
    # answers (a declined rest fires the next trigger at a different tick, hence
    # a different minute). ``None`` when a tick has no evaluated state.
    time_min = (ts.elapsed_seconds / 60.0) if ts is not None else None

    return {
        "decision": outcome.decision,
        "error": outcome.algorithm_error,
        "paused": outcome.paused,
        "completed": outcome.completed,
        "tick_index": outcome.evaluated_tick_index,
        "time_min": time_min,
        "route_fraction": route_fraction,
        "distance_km": distance_km,
        "speed_kph": dynamic.get("speedKph"),
        "motion_state": dynamic.get("motionState"),
        "recovery_phase": dynamic.get("recoveryPhase"),
        "is_traffic_jam": dynamic.get("isTrafficJam"),
        "segment_type": dynamic.get("segmentType"),
        "content_active": dynamic.get("contentActive"),
        "stimulus_frozen": dynamic.get("stimulusFrozen"),
        "continuous_driving_min": dynamic.get("continuousDrivingMin"),
        "drowsiness": simulated.get("drowsiness"),
        "fatigue": simulated.get("fatigue"),
        "monotony_level": dynamic.get("monotonyLevel"),
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


class AfterRestProposalBody(BaseModel):
    """feature 020 — the merged after-nap inspect panel's interactive Choose.

    Re-projects the after-nap (``rest_recommended`` / ``after_rest_before_restart``
    / ``stopped``) quick_check proposal from the SAME recovered-driver ``world``
    the quickview already built (the frontend sends back the inspected proposal's
    own ``world``), but FORCING content dispatch for ``selected_service_id`` (e.g.
    ``full_karaoke``) instead of the selector's rank-1. Stateless / non-persisting
    (``cache={}``), exactly like the quickview it extends — nothing is written to
    ``proposal_runs/``. ``selected_service_id=None`` reproduces the default
    rank-1 projection."""

    world: World
    service_package_id: str
    content_package_id: str
    run_seed_proposal: str
    selected_service_id: str | None = None
    service_parameters: dict[str, Any] = {}
    service_hyperparameters: dict[str, Any] = {}


@router.post("/api/merged-runs/after-rest-proposal")
def after_rest_proposal_endpoint(body: AfterRestProposalBody) -> dict:
    """Interactive Choose for the read-only after-nap inspect panel: dispatch
    content for the reviewer-chosen after-rest service. Mirrors
    ``merged_quickview._project_after_rest`` (rest_recommended /
    after_rest_before_restart, motion from the passed world) with the ONE
    addition of ``quick_check_service_id``. 422 for a mis-slotted package
    (propagated from ``create_proposal_run``)."""
    try:
        proposal_body = CreateProposalRunBody(
            world=body.world,
            trigger_purpose="rest_recommended",
            lifecycle_stage="after_rest_before_restart",
            motion_state=body.world.control_inputs.motion_state,
            service_package_id=body.service_package_id,
            content_package_id=body.content_package_id,
            mode="quick_check",
            run_seed=body.run_seed_proposal,
            simulation_time=0,
            quick_check_service_id=body.selected_service_id,
            parameters=body.service_parameters,
            hyperparameters=body.service_hyperparameters,
        )
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return create_proposal_run(proposal_body, cache={}).model_dump(mode="json")


class MergedExplainBody(BaseModel):
    """feature 020 — INLINE explain for the Combined Simulator's EPHEMERAL
    proposals (the quickview fire / after-nap projections built with ``cache={}``,
    which are never written to ``proposal_runs/`` so the run-id explain endpoint
    would 404). The frontend already holds the full projected proposal, so it
    posts it back inline. ``step``/``target_id``/``provider`` mirror
    ``ExplainRequestBody``."""

    proposal: dict[str, Any]
    step: str
    target_id: str
    provider: str = "backend"


@router.post("/api/merged-runs/explain", response_model=ExplainResponse)
def merged_explain_endpoint(body: MergedExplainBody) -> ExplainResponse:
    """Generate (or build the browser prompt for) an LLM rationale for a target
    in an EPHEMERAL projected proposal — same prompt + Ollama/template path as
    ``POST /api/proposal/runs/{run_id}/explain``, but the ``ProposalRunLog`` comes
    from the request body instead of disk, and nothing is persisted
    (``persist_run_id=None``). 422 on a malformed proposal or unknown target."""
    try:
        run_log = ProposalRunLog.model_validate(body.proposal)
        explain_body = ExplainRequestBody(step=body.step, target_id=body.target_id, provider=body.provider)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return explain_from_run_log(run_log, explain_body, persist_run_id=None)


class ExplainTriggerBody(BaseModel):
    """feature 025, slice S6 — LLM rationale for the TRIGGER rank-1 decision.

    Mirrors ``MergedExplainBody``'s reasoning (feature 020) for why this is
    INLINE rather than run-id-addressed: trigger evidence lives on
    ``MergedInstantResult.fires``/``FirePoint`` (``models/run.py`` /
    ``models/merged_run.py``), never on a persisted ``ProposalRunLog`` — there
    is no run-id endpoint this could be `POST .../runs/{run_id}/explain-trigger`
    against, so the caller (already holding the fire it wants explained, from
    a quickview or a live tick) posts it back inline.

    ``category`` selects which of the fire's ``feature_contributions`` chains
    is the review target; omitted/``None`` defaults to the fire's OWN
    recorded ``category``, and — only when that is ALSO ``None`` — falls back
    to the highest-scoring recorded chain (``trigger_explanation
    .resolve_category``).

    ``provider="template"`` (feature 025, slice S11) is TRIGGER-ONLY — the
    service/content explain endpoints do not accept it. Trigger is the one
    review step with no rationale baked into its own evidence (no trigger
    package emits one — see ``trigger_explanation.template``'s docstring), so
    when the reviewer's explanation provider is 'off' there is otherwise
    NOTHING to show on that tab. ``"template"`` gives the frontend a way to
    reach the deterministic sentence directly, without asking for (or paying
    the latency/availability cost of) an LLM generation.
    """

    fire: dict[str, Any]
    category: str | None = None
    provider: Literal["backend", "browser", "template"] = "backend"


@router.post("/api/merged-runs/explain-trigger", response_model=ExplainResponse)
def explain_trigger_endpoint(body: ExplainTriggerBody) -> ExplainResponse:
    """Generate (or build the browser prompt for) an LLM rationale for WHY
    the trigger's rank-1 category fired.

    Same generate/fallback machinery as the service/content explain endpoints
    (``routers.proposal._generate_explanation``) grounded in the fire's OWN
    recorded ``feature_contributions``/``criteria`` instead of a persisted
    proposal candidate/item (``services.trigger_explanation``). Nothing is
    persisted — trigger evidence has no ``ProposalRunLog`` to append an
    ``Explanation`` record to, the same reason ``merged_explain_endpoint``
    above never persists either.

    422 on a malformed ``fire`` (fails ``FirePoint`` validation) or an
    explicit ``category`` that is not one of the fire's recorded chains.
    """
    try:
        fire_point = FirePoint.model_validate(body.fire)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    fire = fire_point.model_dump(mode="json")
    chains = fire.get("feature_contributions") or {}
    if body.category is not None and body.category not in chains:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "unknown_target",
                "message": f"category {body.category!r} not found in the recorded fire",
            },
        )

    category = trigger_explanation.resolve_category(fire, body.category)
    target = trigger_explanation.build_target(fire, category)

    # Built for every provider, including 'template' below — it is cheap,
    # pure string assembly with no network call (unlike the Ollama/Nano
    # generation itself), so there is no reason to special-case it away just
    # to skip populating the response's required `prompt` field.
    prompt = explanation_builder.build_explanation_prompt("trigger", target, {})

    if body.provider == "template":
        # feature 025, slice S11 — the deterministic sentence, directly, with
        # NO Ollama call: `_generate_explanation` below is the shared
        # generate-or-fall-back machinery for 'backend'/'browser' only, and
        # deliberately not reused here — going through it would mean either
        # widening it to a third provider it was never designed for, or
        # threading a synthetic always-fails 'backend' attempt through the
        # retry ladder just to reach the same fallback it already returns.
        # Calling `template_rationale` directly is the honest reflection of
        # what happened: this was ASKED for as the template, not a fallback
        # FROM a failed generation, so `fell_back=False`/`error=None`.
        rationale = explanation_builder.template_rationale("trigger", target)
        return ExplainResponse(
            step="trigger",
            target_id=category or "",
            requested_provider="template",
            rationale=rationale,
            provider_used="template",
            model="template",
            fell_back=False,
            error=None,
            prompt=prompt,
        )

    rationale, provider_used, model, fell_back, error = _generate_explanation(
        prompt, body.provider, lambda: explanation_builder.template_rationale("trigger", target)
    )
    return ExplainResponse(
        step="trigger",
        target_id=category or "",
        requested_provider=body.provider,
        rationale=rationale,
        provider_used=provider_used,
        model=model,
        fell_back=fell_back,
        error=error,
        prompt=prompt,
    )


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
    # Clear the category alongside the run id — they describe the same "current
    # proposal", so leaving a stale category behind would make the next fire's
    # category comparison meaningless.
    handle.current_proposal_category = None
    save_handle(handle, settings.merged_runs_dir)

    return run_state.model_dump(mode="json")


@router.post("/api/merged-runs/{merged_run_id}/reject-proposal")
def reject_proposal_endpoint(merged_run_id: str) -> dict:
    """Reject the merged run's CURRENT proposal-side service/content offer
    (fixbug-0806) — the guided overlay's "Reject" button at the pre-rest
    SERVICE step and at the CONTENT step, for any trigger category.

    Why this exists, and why it is NOT ``decline_rest_endpoint``:
    ``decline_rest_endpoint`` answers "no" to the TRIGGER's rest
    recommendation itself (``run_manager.action(..., "decline")``), which
    requires the trigger run to still be paused with a pending proposal. But
    once the driver has already accepted the rest (``accept-rest``) or the
    monotony flow has already acknowledged the trigger (see the
    ``journey_action`` branch of ``proposal_action_endpoint`` above), that
    precondition is gone — the trigger side has moved on to ``playing`` with
    no pending proposal — so calling the SAME trigger action a second time
    422s (verified: "No pending proposal for run ... (status=playing,
    pending=None)").
    The owner's actual semantics are narrower than "undo the rest": the
    driver may accept the rest stop and STILL reject the pre-rest service
    offered for the drive there, and wrong content may make them reject even
    after accepting the service. Both are rejections of the SERVICE/CONTENT
    proposal, not of the rest recommendation — so this endpoint always
    applies the proposal-side rejection (``JourneyAction(action_type=
    "reject")`` — ``_reject_service`` in ``services/proposal_journey.py``,
    which now spans both ``service_selected`` and ``content_selected`` for
    exactly this reason) and treats the trigger-side decline as OPTIONAL:
    best-effort, only to catch the case where the trigger run genuinely IS
    still paused on a pending proposal that never got acknowledged (e.g. the
    monotony flow rejects before ever pressing accept-content).

    ``declined`` in the response distinguishes the two outcomes, because they
    have OPPOSITE effects on the fire guard:
      * ``declined=True`` — the trigger-side decline actually ran, so exactly
        like ``decline_rest_endpoint`` the fire guard is re-armed
        (``current_proposal_run_id``/``current_proposal_category`` cleared)
        so a later re-fire (post-cooldown) spawns a fresh proposal run.
      * ``declined=False`` — the trigger run had already moved on (accept-rest
        already consumed its pending proposal, or ``accept`` already
        acknowledged it). Re-arming the guard here would be actively wrong
        for the REST flow: the tick loop's rest-journey auto-drive block
        (``tick_merged_run_endpoint``) keys its before→during→after
        transitions off `handle.current_proposal_run_id` +
        `handle.rest_stage_synced`, both still pointing at the SAME
        proposal run the driver is mid-recovery-journey on. Clearing
        `current_proposal_run_id` here would orphan that in-flight journey —
        the next `/tick` would see `current_proposal_run_id is None` and try
        to spawn a BRAND NEW proposal run from the trigger's still-open fire,
        never continuing the recovery the driver already started. The run
        stays open at ``service_selected`` after the reject either way (SC-005
        — not dead-ended), so leaving the guard alone here is also just...
        correct: the SAME proposal run is still current, only its
        service/content answer was cleared.

    404 for an unknown ``merged_run_id`` or when the merged run has no active
    proposal run yet (mirrors ``proposal_action_endpoint``'s wording). The
    ``JourneyAction`` rejection's own 422 (e.g. nothing offered to reject)
    propagates unchanged — same convention as ``proposal_action_endpoint``.
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
    # Let a rejected transition's HTTPException (422) propagate unchanged —
    # same convention as proposal_action_endpoint's journey_action branch.
    plog = apply_journey_action(run_id, JourneyAction(action_type="reject"))

    declined = False
    try:
        run_manager.action(handle.trigger_run_id, "decline")
        declined = True
    except (run_manager.ActionNotAllowedError, run_manager.RunNotFoundError):
        # Already resolved by accept_rest (rest already started) or a prior
        # acknowledge (monotony content already accepted) — not a failure of
        # the proposal-side reject the caller asked for.
        pass

    if declined:
        # Only re-arm the fire guard when the trigger-side decline actually
        # ran — see the docstring's "Critical" paragraph: re-arming
        # unconditionally would orphan an in-flight rest journey the tick
        # loop is still auto-driving off `current_proposal_run_id`.
        handle.current_proposal_run_id = None
        handle.current_proposal_category = None

    # Refresh the matching CorrelationEntry's proposal_event_ids (mirrors the
    # loop at the end of proposal_action_endpoint).
    for corr in reversed(handle.correlation_log):
        if corr.proposal_run_id == run_id:
            corr.proposal_event_ids = [f"{e.event_type}@{e.at}" for e in plog.events]
            break
    save_handle(handle, settings.merged_runs_dir)

    return {"proposal": plog.model_dump(mode="json"), "declined": declined}


_PURPOSE_BY_CATEGORY = {
    "monotony_prevention": "monotony",
    "rest_required": "pre_rest",
}


def _derive_content_context(handle, plog) -> ContentContext | None:
    """The content episode playing on the merged run's current proposal, if any.

    Recovery design §4. ``contentActive`` is true exactly while the proposal's
    plan is ``active`` or ``backgrounded``; the purpose comes from the opportunity
    the content answers, and flips to ``post_rest`` once the journey has passed
    the rest (lifecycle_stage ``after_rest_before_restart``).

    Returns None when nothing is playing, or when the episode has outlived its
    plan's ``expected_duration_sec`` (CDC-SU slide 81 一定曲数再生完了 / 1セット完了)
    — that expiry is applied by the caller (``tick_merged_run_endpoint``), not
    here; this function is a pure read of the proposal run's CURRENT state.
    """
    if plog is None:
        return None
    js = plog.journey_state
    if js.playback_state not in (PlaybackState.active, PlaybackState.backgrounded):
        return None
    if js.active_service_id is None:
        return None

    if js.lifecycle_stage == LifecycleStage.after_rest_before_restart:
        purpose = "post_rest"
    else:
        purpose = _PURPOSE_BY_CATEGORY.get(handle.current_proposal_category or "", "monotony")

    return ContentContext(service_id=js.active_service_id.value, purpose=purpose)


def _committed_plan_duration_sec(plog) -> int | None:
    """The playing plan's own ``expected_duration_sec``, or None.

    Reads exactly what ``select_service`` committed as CONTENT-step evidence —
    never fabricated, and never a constant of our own invention.
    """
    for evidence in reversed(plog.evidence):
        if evidence.step == "content" and evidence.error is None:
            value = (evidence.output or {}).get("expected_duration_sec")
            return int(value) if value is not None else None
    return None


def _content_episode_limit_sec(trigger_run_id: str, plog) -> float | None:
    """How long an ACCEPTED content episode keeps relieving the driver.

    The scenario's ``default_content_episode_min`` is the authority (every
    shipped scenario sets it to 15.0), NOT the committed plan's
    ``expected_duration_sec`` — fixbug-0806. The two answer different
    questions, and only one of them is about the driver:

      * ``expected_duration_sec`` is the CONTENT PACKAGE's description of the
        plan it built. For ``humming_karaoke`` it is a modelling artifact —
        ``plan_item_count`` x ``fixed_humming_segment_sec`` = 5 x 30s = 150s,
        with ``duration_basis="simulated_fixed_segment"`` — i.e. the length of
        the humming segments, not of a listening session. It is routinely
        SHORTER THAN A SINGLE TICK (UC-04-01 runs 180s ticks), which made an
        accepted episode expire on the tick after it started.
      * ``default_content_episode_min`` is the SCENARIO's statement about the
        driver: how long a driver stays engaged with accepted content. That is
        the quantity the physiological model needs.

    Why this was invisible until now: the monotony path never actually relied
    on the plan duration. Its episode died after one tick too, and
    ``run_manager._synthetic_content_context`` — the ``acknowledge``-keyed
    15-minute timer — silently carried the remaining 14 minutes (verified:
    ``playback_state`` reads ``completed`` while ``contentActive`` stays true).
    REST opportunities are deliberately excluded from that acknowledge (they
    are answered by accept-rest/decline), so pre-rest had no such rescue and
    was the only place the real bug showed. Reading the episode length from the
    scenario makes the REAL episode last the full 15 minutes on both paths, so
    the synthetic fallback stops being load-bearing for merged runs and the
    driver's ACTUALLY chosen service (``humming_karaoke@monotony``) drives the
    whole episode instead of being replaced after one tick by the fallback's
    ``default_content_service_id`` (``quiz@monotony``).

    A pre-rest episode is additionally cut short by ARRIVAL (CDC-SU slide 46 ⑤
    休憩所に到着したら終了) — driven by the rest-journey auto-drive block in
    ``tick_merged_run_endpoint``, not here — so the effective pre-rest rule is
    "15 minutes, or until the car reaches the spot, whichever comes first".

    Falls back to the plan's own duration when a scenario configures no
    episode length, so a scenario without the knob keeps its previous
    behaviour rather than gaining an episode that never ends. ``None`` means
    "no limit is known" and the caller applies none.
    """
    scenario = run_manager.get_scenario(trigger_run_id)
    episode_min = getattr(scenario, "default_content_episode_min", None) if scenario else None
    if episode_min is not None:
        return float(episode_min) * 60.0
    duration_sec = _committed_plan_duration_sec(plog)
    return float(duration_sec) if duration_sec is not None else None


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

    # ── Derive this tick's real content episode from the proposal's own
    #    playback_state (recovery design §11 / Task 9) — BEFORE ticking, so
    #    the engine relieves/freezes for the episode that is ACTUALLY
    #    playing right now, not last tick's. None when no proposal is
    #    current, the proposal is unreadable, or nothing is playing — the
    #    tick engine falls back to the trigger-only synthetic fallback in
    #    that case (`run_manager.tick`'s own docstring).
    current_plog = None
    if handle.current_proposal_run_id is not None:
        try:
            current_plog = get_proposal_run(handle.current_proposal_run_id)
        except HTTPException:
            current_plog = None
    content_ctx = _derive_content_context(handle, current_plog)

    try:
        outcome = run_manager.tick(
            handle.trigger_run_id,
            content_context=content_ctx,
        )
    except run_manager.RunNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=f"Trigger run {handle.trigger_run_id!r} not found",
        )

    trigger_dict = _serialize_trigger_tick(outcome)
    resp = MergedTickResponse(trigger=trigger_dict)

    # ── Content-episode lifetime (CDC-SU slide 81) ───────────────────────────
    # An episode has a finite natural length. Without this it would never end
    # and driving-content relief would run for the whole rest of the run.
    #
    # That length is the SCENARIO's `default_content_episode_min` (15 minutes
    # everywhere today), not the content package's `expected_duration_sec` —
    # see `_content_episode_limit_sec` for why the two are different questions
    # and why using the package's number made an accepted episode expire on
    # the tick after it started (fixbug-0806).
    #
    # A PRE-REST episode is additionally cut short by ARRIVAL (CDC-SU slide
    # 46 ⑤ 休憩所に到着したら終了), which the rest-journey auto-drive block
    # further down applies — so pre-rest ends at 15 minutes OR at the spot,
    # whichever comes first, and needs no special case here.
    now_sec = float(outcome.tick_state.elapsed_seconds) if outcome.tick_state else 0.0
    if content_ctx is None:
        handle.content_started_elapsed_sec = None
    else:
        if handle.content_started_elapsed_sec is None:
            # The episode began at the START of this tick, not at its end.
            # `elapsed_seconds` stamps a tick with the clock at its END
            # (`tick_engine.advance_tick`), and the relief for THIS tick has
            # already been applied by the `run_manager.tick` call above — so
            # recording `now_sec` here would date the episode one whole tick
            # late and give it one tick too much relief. `run_manager
            # ._synthetic_content_context` measures from the same start
            # boundary (the `acknowledge`'s own `(tick_index + 1) *
            # tick_seconds`), so anchoring here keeps a real episode and a
            # synthetic one exactly the same length — which is what keeps the
            # live animation and the quickview projection on the same curve.
            handle.content_started_elapsed_sec = now_sec - float(
                outcome.run_state.event_plan.tick_seconds
            )
        limit_sec = _content_episode_limit_sec(handle.trigger_run_id, current_plog)
        if (
            limit_sec is not None
            and now_sec - handle.content_started_elapsed_sec >= limit_sec
        ):
            try:
                apply_journey_action(
                    handle.current_proposal_run_id,
                    JourneyAction(action_type="complete"),
                )
                handle.content_started_elapsed_sec = None
            except HTTPException as exc:
                resp.trigger["proposal_error"] = _readable_error_text(exc.detail)
    save_handle(handle, settings.merged_runs_dir)

    d = outcome.decision
    fired = bool(d and d.fire_control.fired and d.proposal is not None)
    purpose = map_trigger_purpose(d.result_type) if d else None

    # Create a proposal run for a NEW fire when there is no current proposal
    # (first fire, or after a decline re-armed the guard), OR when a PRIOR
    # accept-rest journey has fully completed (``rest_stage_synced == "after"``)
    # — otherwise a genuine SECOND rest trigger later in the run is silently
    # swallowed (the guard used to latch on the first fire forever) — OR when
    # this fire's CATEGORY differs from the one the current proposal run was
    # spawned for.
    #
    # That last clause matters now that both trigger packages fire two
    # categories: a run typically reaches monotony_prevention first and
    # escalates to rest_required afterwards. Keyed only on
    # ``current_proposal_run_id``, the monotony proposal latched the guard and
    # the rest proposal — the consequential one, the one with a rest journey
    # behind it — arrived with no service/content attached at all.
    #
    # Repeats WITHIN a category still do not spawn (that is what stops a new run
    # every driving tick); only a genuine change of what fired does. The
    # ``rest_stage_synced`` reset below preserves "Choose" on the after-rest
    # proposal until the next real fire.
    if (
        fired
        # `outcome.paused` is `run_manager.tick`'s post-suppression signal:
        # `proposal_is_actionable` after BOTH the recovery-active gate and the
        # 30-minute post-response de-dup gate (`_derive_response_suppression`,
        # fixbug-0804). A fire that IS actionable always leaves the run
        # paused, so this never excludes a fire that should spawn a proposal
        # — it only excludes a fire the trigger evidence log still records
        # but which must NOT re-open an interactive proposal. Gating on raw
        # `fired` instead let a DECLINED rest proposal's cooldown-suppressed
        # re-fire (same category, still within the 30-minute window) spawn a
        # brand-new proposal run on the very next tick — the decline re-arms
        # `current_proposal_run_id` to None, so the overlay reappeared
        # immediately with a fresh (possibly stale) rest spot.
        and outcome.paused
        and purpose is not None
        and (
            handle.current_proposal_run_id is None
            or handle.rest_stage_synced == "after"
            or handle.current_proposal_category != d.selected_category
        )
    ):
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
            resp.trigger["proposal_error"] = _readable_error_text(exc.detail)
            return resp

        handle.proposal_run_ids.append(plog.run_id)
        handle.current_proposal_run_id = plog.run_id
        handle.current_proposal_category = d.selected_category
        # A fresh fire starts a fresh rest journey — clear any prior "after"
        # so this new opportunity's before→during→after auto-drive runs, and so
        # the guard above doesn't keep spawning a new run every subsequent tick.
        handle.rest_stage_synced = None
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

                # CDC-SU slide 46 ⑤: 選択コンテンツを開始し、休憩所に到着したら終了.
                # The en-route 覚醒支援 episode ends AT ARRIVAL. This used to
                # happen in the `during` branch, after the nap, so the pre-rest
                # content kept "playing" through the whole dwell.
                if journey_plog.journey_state.playback_state == PlaybackState.active:
                    journey_plog = apply_journey_action(
                        run_id, JourneyAction(action_type="complete")
                    )
                if journey_plog.journey_state.playback_state in (
                    PlaybackState.active, PlaybackState.backgrounded,
                ):
                    journey_plog = apply_journey_action(
                        run_id, JourneyAction(action_type="stop")
                    )

                handle.rest_stage_synced = "during"
            except HTTPException as exc:
                resp.trigger["proposal_error"] = _readable_error_text(exc.detail)

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
                resp.trigger["proposal_error"] = _readable_error_text(exc.detail)

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

        # ── Record the driver's response on the TRIGGER run ────────────────
        # Picking a service for a MONOTONY opportunity is only BROWSING — the
        # driver's real "yes" is starting the content (fixbug-0806: this block
        # used to live in the `select_service` branch above, gated on
        # `kind == "select_service"`; moved here, gated on the journey action
        # actually being `accept`, because acknowledging at selection time
        # consumed the trigger's pending proposal before the driver had even
        # seen the song list, which made a later proposal-side reject
        # impossible (it needs the trigger run PAUSED with a pending proposal
        # to fall back on when `reject-proposal`'s best-effort trigger decline
        # finds nothing left to decline) and rebaselined the Hybrid's monotony
        # accumulator even when the driver ultimately rejected the content.
        # The trigger side has to learn the ACCEPT: `proposal_history
        # .lastProposalResult` is what lets the Hybrid rebaseline its monotony
        # accumulator, and without it the monotony score climbed for a whole
        # run with nothing the driver did ever bringing it down (only a rest
        # did). The projection records the same acknowledge, so the two model
        # one driver.
        #
        # REST opportunities are deliberately excluded: they are answered by
        # accept-rest / decline, and acknowledging here would resolve the
        # pending rest proposal out from under the reviewer before they have
        # chosen a spot.
        #
        # Best-effort: `action()` rejects when the trigger run is not paused on
        # a pending proposal (e.g. the reviewer re-picks a service several ticks
        # later). That is not a failure of the accept the caller asked for, so
        # it must not turn a successful accept into an error.
        if body.action_type == "accept" and handle.current_proposal_category == "monotony_prevention":
            try:
                run_manager.action(handle.trigger_run_id, "acknowledge")
            except (run_manager.ActionNotAllowedError, run_manager.RunNotFoundError):
                pass

    # Refresh the correlation entry's proposal_event_ids for this proposal run
    # (most recent entry tied to run_id — slice-1 has exactly one).
    for corr in reversed(handle.correlation_log):
        if corr.proposal_run_id == run_id:
            corr.proposal_event_ids = [f"{e.event_type}@{e.at}" for e in plog.events]
            break
    save_handle(handle, settings.merged_runs_dir)

    return plog.model_dump(mode="json")


# ── Review feedback (feature 023, Task 15) ──────────────────────────────────
#
# The parameter-rationale review screen records a reviewer's judgement on
# either ONE input feature that fed a decision (scope="review_input") or on
# the decision itself (scope="review_decision"). Both kinds ride the SAME
# M5 append-only feedback store (`services/feedback.py::append_feedback`,
# `FeedbackEvent` appended into the paired trigger run's `RunLog.events`)
# via `handle.trigger_run_id` — there is exactly ONE feedback store, not a
# second parallel one for reviews. Feedback is evidence only: it is never
# read by, nor alters, any algorithm or recorded simulator decision.


class ReviewFeedbackBody(BaseModel):
    """POST body for ``/api/merged-runs/{id}/review-feedback``.

    ``feature_id`` only applies to ``scope="review_input"`` (a per-feature
    judgement); ``review_decision`` judges the decision as a whole and omits
    it. The frontend keys a judgement as
    ``case_id|checkpoint_id|stage|review_target|feature_id`` — these fields
    are exactly the anchor needed to reconstruct that key.
    """

    scope: Literal["review_input", "review_decision"]
    case_id: str
    checkpoint_id: str
    stage: str
    review_target: str
    feature_id: str | None = None
    labels: dict = {}
    comment: str | None = None


@router.post("/api/merged-runs/{merged_run_id}/review-feedback", status_code=201)
def post_review_feedback_endpoint(merged_run_id: str, body: ReviewFeedbackBody) -> dict:
    """Append one reviewer judgement to the merged run's paired trigger run
    log. Append-only, exactly like every other M5 feedback record: two
    judgements on the same feature append twice — an earlier opinion is
    never overwritten, never replaced.

    404 for an unknown merged_run_id or a trigger run that has since gone
    missing.
    """
    handle = get_handle(merged_run_id, settings.merged_runs_dir)
    if handle is None:
        raise HTTPException(status_code=404, detail=f"Merged run {merged_run_id!r} not found")

    event = FeedbackEvent(
        kind="feedback",
        target=FeedbackTarget(
            scope=body.scope,
            case_id=body.case_id,
            checkpoint_id=body.checkpoint_id,
            stage=body.stage,
            review_target=body.review_target,
            feature_id=body.feature_id,
        ),
        labels=body.labels,
        comment=body.comment,
    )

    try:
        append_feedback(handle.trigger_run_id, event, settings.runs_dir)
    except run_manager.RunNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=f"Trigger run {handle.trigger_run_id!r} not found",
        )

    return event.model_dump(mode="json")


@router.get("/api/merged-runs/{merged_run_id}/review-feedback")
def get_review_feedback_endpoint(merged_run_id: str) -> dict:
    """Return every recorded review_input/review_decision judgement for a
    merged run's paired trigger run, plus the trigger/service/content
    package versions in play — so an export can attribute each judgement to
    the exact package versions that produced the decision it judges.

    Pure disk read of the trigger run's log (mirrors ``get_merged_run_endpoint``)
    — nothing is recomputed. 404 for an unknown merged_run_id.
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
    events = (trigger_log or {}).get("events", [])
    review_events = [
        e
        for e in events
        if e.get("kind") == "feedback"
        and str((e.get("target") or {}).get("scope", "")).startswith("review_")
    ]

    trigger_pkg = ((trigger_log or {}).get("snapshot") or {}).get("package") or {}
    proposal_pkg_reg = ProposalPackageRegistry(settings.packages_dir)
    service_pkg = proposal_pkg_reg.get(handle.service_package_id)
    content_pkg = proposal_pkg_reg.get(handle.content_package_id)

    return {
        "events": review_events,
        "package_versions": {
            "trigger": {
                "id": trigger_pkg.get("id"),
                "version": trigger_pkg.get("version"),
            },
            "service": {
                "id": handle.service_package_id,
                "version": service_pkg.version if service_pkg else None,
            },
            "content": {
                "id": handle.content_package_id,
                "version": content_pkg.version if content_pkg else None,
            },
        },
    }
