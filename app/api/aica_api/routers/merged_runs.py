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

from aica_api.config import settings
from aica_api.models.merged_run import (
    CorrelationEntry,
    CreateMergedRunBody,
    MergedProposalActionBody,
    MergedTickResponse,
)
from aica_api.models.proposal.journey_action import JourneyAction
from aica_api.models.proposal.world import World
from aica_api.routers.proposal import (
    CreateProposalRunBody,
    SelectServiceBody,
    apply_journey_action,
    create_proposal_run,
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
        plog = select_service(
            run_id, SelectServiceBody(selected_service_id=body.selected_service_id)
        )
    else:  # kind == "journey_action"
        if body.action_type is None:
            raise HTTPException(
                status_code=422,
                detail="action_type is required for kind='journey_action'",
            )
        plog = apply_journey_action(
            run_id, JourneyAction(action_type=body.action_type, payload=body.payload)
        )

    # Refresh the correlation entry's proposal_event_ids for this proposal run
    # (most recent entry tied to run_id — slice-1 has exactly one).
    for corr in reversed(handle.correlation_log):
        if corr.proposal_run_id == run_id:
            corr.proposal_event_ids = [f"{e.event_type}@{e.at}" for e in plog.events]
            break
    save_handle(handle, settings.merged_runs_dir)

    return plog.model_dump(mode="json")
