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

import os
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from aica_api.config import settings
from aica_api.models.merged_run import (
    AcceptRestBody,
    CorrelationEntry,
    CreateMergedRunBody,
    MergedProposalActionBody,
    MergedTickResponse,
)
from aica_api.models.proposal.enums import DiscreteEventType, LifecycleStage, PlaybackState
from aica_api.models.proposal.journey_action import JourneyAction
from aica_api.models.proposal.recompute import RecomputeRequest
from aica_api.models.proposal.world import FieldOverride, World
from aica_api.routers.proposal import (
    CreateProposalRunBody,
    SelectServiceBody,
    apply_journey_action,
    create_proposal_run,
    get_proposal_run,
    recompute_proposal_run,
    select_service,
)
from aica_api.services import run_manager
from aica_api.services.merged_adapter import (
    build_world_from_tick,
    map_lifecycle_stage,
    map_trigger_purpose,
)
from aica_api.services.merged_run_coordinator import (
    create_handle,
    get_handle,
    make_merged_run_id,
    save_handle,
)

router = APIRouter()


# ── Run-ID generation (mirrors routers/runs.py's _make_run_id convention;
#    kept local rather than imported so this seam stays self-contained) ──────


def _make_trigger_run_id() -> str:
    """Generate a unique trigger run_id: ``run_<YYYYMMDD-HHMMSS>_<6-hex>``."""
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    rand = os.urandom(3).hex()
    return f"run_{ts}_{rand}"


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
    )
    save_handle(handle, settings.merged_runs_dir)

    return {"merged_run_id": merged_run_id, "trigger_run_id": trigger_run_id}


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
            select_body = SelectServiceBody(selected_service_id=body.selected_service_id)
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
