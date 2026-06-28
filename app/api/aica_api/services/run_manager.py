"""Run manager (T021 M2 migration) — orchestrates the full run lifecycle.

Holds in-memory state keyed by run_id (M1 single-process; no DB).
Backed by the append-only EvidenceRecorder for persistence.

Public API:
  create_run(plan_id, run_id, runs_dir) -> RunState
  tick(run_id) -> TickOutcome
  action(run_id, action_str) -> RunState
  get_run(run_id) -> RunState | None
  clear_registry() -> None  (for test isolation)

Design constraints:
  - NO timestamps/UUIDs/randomness generated inside the decision path.
  - plan_id is resolved from the draft registry (run_plan service).
  - run_id is supplied by the caller (the router).
  - The created_at timestamp in RunLog is metadata, not part of the decision
    trace — it is generated here (outside the tick-level core).
  - Ordinal bands only reach the adapter (via tick_engine).
  - Adapter failure → AlgorithmError event; never a faked DecisionResult.
  - package_runtime_state is threaded tick-to-tick:
    pass current in → adapter returns next → store returned next.

M1 path: scenario.driver_profile is None → freeze_event_plan + compute_tick_state.
M2 path: scenario.driver_profile is not None → plan draft frozen (route_facts +
         event_plan already computed) + advance_tick.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import aica_api.algorithms.adapter as _adapter
from aica_api.algorithms.adapter import AlgorithmAdapterError
from aica_api.models.decision import DecisionResult
from aica_api.models.log import (
    ActionEvent,
    AlgorithmError,
    RunLog,
    TickEvent,
    TraceEntry,
)
from aica_api.models.package import PackageManifest
from aica_api.models.run import (
    ArtifactRef,
    EventPlan,
    RouteFacts,
    RunState,
    RunStatus,
    Snapshot,
    TickState,
)
from aica_api.models.scenario import ScenarioDef
from aica_api.services.event_plan import freeze_event_plan
from aica_api.services.tick_engine import advance_tick, build_adapter_context, compute_tick_state
from aica_api.storage.evidence_recorder import EvidenceRecorder

# ---------------------------------------------------------------------------
# Simulator version
# ---------------------------------------------------------------------------

SIMULATOR_VERSION = "0.1.0"

# ---------------------------------------------------------------------------
# Error types
# ---------------------------------------------------------------------------


class RunNotFoundError(Exception):
    """Raised when the run_id is not in the registry."""


class ActionNotAllowedError(Exception):
    """Raised when an action is invalid given the current run state."""


# ---------------------------------------------------------------------------
# Tick result
# ---------------------------------------------------------------------------


@dataclass
class TickOutcome:
    """Return value of tick().

    evaluated_tick_index is the tick_index of the TickEvent (or AlgorithmError event)
    that was persisted during this call — i.e. the value of current_tick BEFORE the
    post-increment.  It is None when no evaluation happened (completed/no-op and
    tick_state.completed early-exit paths).
    """

    run_state: RunState
    decision: DecisionResult | None
    algorithm_error: AlgorithmError | None
    paused: bool
    completed: bool
    evaluated_tick_index: int | None = None
    # The TickState evaluated this call — carries the authoritative route_fraction,
    # distance_km, and raw_state (speedKph). Surfaced so the UI shows the real
    # speed-integrated position rather than re-deriving it. None on no-op ticks.
    tick_state: "TickState | None" = None


# ---------------------------------------------------------------------------
# In-memory registry
# ---------------------------------------------------------------------------

# Keyed by run_id:
#   (RunState, PackageManifest, ScenarioDef, EvidenceRecorder, TickState | None)
# 5th element: prior TickState for M2 advance_tick path (None = no prior tick yet)
_registry: dict[
    str, tuple[RunState, PackageManifest, ScenarioDef, EvidenceRecorder, TickState | None]
] = {}


def clear_registry() -> None:
    """Clear the in-memory registry.  Used for test isolation only."""
    _registry.clear()


def get_run(run_id: str) -> RunState | None:
    """Return the current RunState for a run, or None if unknown."""
    entry = _registry.get(run_id)
    return entry[0] if entry is not None else None


def get_active_run_log(run_id: str) -> "RunLog | None":
    """Return the EvidenceRecorder's RunLog for an active run, or None if not active.

    Used by the feedback router to get the current in-memory log without
    going through the disk round-trip.  The recorder's log is always at least
    as current as the disk (it persists on every append).

    Args:
        run_id: The run identifier to look up.

    Returns:
        The in-memory RunLog, or None if run_id is not in the active registry.
    """
    entry = _registry.get(run_id)
    return entry[3].run_log if entry is not None else None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _content_hash(data: dict[str, Any]) -> str:
    """SHA-256 hash of the canonical JSON representation of a dict."""
    payload = json.dumps(data, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _is_m2_scenario(scenario: ScenarioDef) -> bool:
    """True if the scenario has M2 profile-driven fields."""
    return scenario.driver_profile is not None


def _derive_history(
    events: list,
    tick_seconds: float,
    current_sim_sec: float = 0.0,
) -> tuple[dict, list]:
    """Derive proposal_history and user_action_history from the event log.

    Walks the event list once.  TickEvents with a fired proposal contribute to
    ``proposal_history``; ActionEvents contribute to ``user_action_history``.

    Time convention: a proposal at ``tick_index`` has sim-time
    ``tick_index * tick_seconds``.  This is consistent with the M1 plan and
    approximates M2 (where elapsed_seconds is stored per-event in tick_state but
    would require accessing it from each stored TickEvent).

    Args:
        events:          The run log events (TickEvent | ActionEvent | AlgorithmError).
        tick_seconds:    Scenario tick cadence in seconds (for sim-time computation).
        current_sim_sec: Current simulation time (for proposalCountLast30Min).

    Returns:
        A tuple ``(proposal_history, user_action_history)`` where:
          proposal_history = {
            "lastProposalTimeSec":      float | None,
            "lastProposalCategory":     str | None,
            "lastProposalResult":       str | None,  # action taken after last proposal
            "proposalCountLast30Min":   int,
            "acceptanceRateRecent":     float,        # 0.0 when none acted
          }
          user_action_history = [{"tick_index": int, "action": str}, ...]
    """
    # Collect fired proposals (tick_index, selected_category) in order.
    fired_proposal_ticks: list[int] = []
    fired_proposal_categories: list[str] = []
    # Collect actions (tick_index, action) in order.
    action_by_order: list[tuple[int, str]] = []
    user_action_history: list[dict] = []

    for event in events:
        kind = event.kind
        if kind == "tick":
            dr = event.trace.decision_result
            if dr.fire_control.fired and dr.proposal is not None:
                fired_proposal_ticks.append(event.tick_index)
                fired_proposal_categories.append(dr.selected_category or "")
        elif kind == "action":
            action_by_order.append((event.tick_index, event.action))
            user_action_history.append(
                {"tick_index": event.tick_index, "action": event.action}
            )

    if not fired_proposal_ticks:
        return {
            "lastProposalTimeSec": None,
            "lastProposalCategory": None,
            "lastProposalResult": None,
            "proposalCountLast30Min": 0,
            "acceptanceRateRecent": 0.0,
        }, user_action_history

    # ── Last proposal ──────────────────────────────────────────────────────
    last_tick = fired_proposal_ticks[-1]
    last_category = fired_proposal_categories[-1]
    last_time_sec = float(last_tick * tick_seconds)

    # lastProposalResult: first action at or after the last proposal's tick_index.
    last_proposal_result: str | None = None
    for action_tick, action in action_by_order:
        if action_tick >= last_tick:
            last_proposal_result = action
            break

    # ── proposalCountLast30Min (1800 sec window) ───────────────────────────
    window_start_sec = current_sim_sec - 1800.0
    proposals_in_window = sum(
        1 for t in fired_proposal_ticks if t * tick_seconds >= window_start_sec
    )

    # ── acceptanceRateRecent ───────────────────────────────────────────────
    # Match each fired proposal to the first action at or after its tick_index.
    acted_count = 0
    accepted_count = 0
    action_search_start = 0
    for proposal_tick in fired_proposal_ticks:
        for i in range(action_search_start, len(action_by_order)):
            if action_by_order[i][0] >= proposal_tick:
                acted_count += 1
                if action_by_order[i][1] == "accept_rest":
                    accepted_count += 1
                action_search_start = i + 1
                break

    acceptance_rate = accepted_count / acted_count if acted_count > 0 else 0.0

    return {
        "lastProposalTimeSec": last_time_sec,
        "lastProposalCategory": last_category,
        "lastProposalResult": last_proposal_result,
        "proposalCountLast30Min": proposals_in_window,
        "acceptanceRateRecent": acceptance_rate,
    }, user_action_history


# ---------------------------------------------------------------------------
# Public API — create_run
# ---------------------------------------------------------------------------


def create_run(
    plan_id: str,
    run_id: str,
    runs_dir: pathlib.Path,
) -> RunState:
    """Initialise a new run from a frozen run plan draft.

    Args:
        plan_id:   The frozen draft plan identifier (from run_plan service).
        run_id:    Unique run identifier (supplied by the router).
        runs_dir:  Directory for persisting <run_id>.json.

    Returns:
        The initial RunState (status=created, current_tick=0).

    Raises:
        ValueError: If plan_id is not in the draft registry.
    """
    from aica_api.services.run_plan import get_draft_entry
    entry = get_draft_entry(plan_id)
    if entry is None:
        raise ValueError(f"Unknown plan_id {plan_id!r}")

    draft, package, scenario = entry

    # Use the frozen route_facts and event_plan from the draft
    route_facts = draft.route_facts
    event_plan = draft.draft_event_plan

    # M1 fallback: if scenario has no driver_profile and event_plan has no ticks,
    # re-freeze using the scenario's event_presets
    if not _is_m2_scenario(scenario) and len(event_plan.ticks) == 0:
        # Guard: package-declared tick_seconds is an M2-only feature.  The M1 legacy
        # path calls freeze_event_plan(scenario) which ignores it silently — that
        # would be a confusing trap.  Fail loudly instead.
        if package.algorithm.tick_seconds is not None:
            raise ValueError(
                "package-declared tick_seconds is only supported for M2 profile-driven "
                "scenarios (scenario must have a driver_profile). "
                "The M1 legacy path (no driver_profile) re-freezes via freeze_event_plan "
                "which ignores the package tick_seconds override. "
                "Use an M2 scenario or remove tick_seconds from the package manifest."
            )
        event_plan = freeze_event_plan(scenario)
        route_facts = RouteFacts(
            segments=scenario.route_intent.segments,
            bands={feature.key: feature.band_values for feature in package.features},
        )

    # M2 guard: an M2 scenario with no rest opportunities on a LOCAL route signals
    # a failed or empty plan build — do not start the run (failures must never be
    # disguised as a normal empty-plan run).
    # Maps-sourced routes may legitimately have no rest opportunities when Places
    # returned an empty result (honest "no rest stops on this route" case).
    is_maps_route = getattr(route_facts, "route_source", "local") == "maps"
    if _is_m2_scenario(scenario) and not is_maps_route and len(event_plan.rest_opportunities) == 0:
        raise ValueError(
            f"M2 event plan for plan_id={plan_id!r} has no rest opportunities. "
            "The plan build may have failed or the scenario route has no rest spots. "
            "Fix the scenario/package and create a new run plan."
        )

    # Extract effective setup
    effective_setup = draft.effective_setup
    effective_params = effective_setup.get("parameters", {})
    effective_hps = effective_setup.get("hyperparameters", {})
    run_mode = effective_setup.get("run_mode", "standard")

    # original_values / modified_values diff
    original_values: dict = {}
    modified_values: dict = {}
    default_params = {p.key: p.default for p in package.parameters}
    default_hps = {hp.key: hp.default for hp in package.hyperparameters}
    for key, val in effective_params.items():
        if key in default_params and default_params[key] != val:
            original_values[f"parameters.{key}"] = default_params[key]
            modified_values[f"parameters.{key}"] = val
    for key, val in effective_hps.items():
        if key in default_hps and default_hps[key] != val:
            original_values[f"hyperparameters.{key}"] = default_hps[key]
            modified_values[f"hyperparameters.{key}"] = val

    # Build snapshot
    package_data = package.model_dump(mode="json")
    scenario_data = scenario.model_dump(mode="json")
    snapshot = Snapshot(
        package=ArtifactRef(
            id=package.id,
            version=package.version,
            hash=_content_hash(package_data),
        ),
        scenario=ArtifactRef(
            id=scenario.id,
            version=scenario.version,
            hash=_content_hash(scenario_data),
        ),
    )

    # M4: route provenance from draft (default "local" / None for pre-M4 drafts)
    draft_route_source = getattr(draft, "route_source", "local")
    draft_display_route = getattr(draft, "display_route", None)

    # Initial RunState (with full M2 setup snapshot)
    run_state = RunState(
        run_id=run_id,
        status=RunStatus.created,
        current_tick=0,
        pending_proposal=None,
        package_runtime_state={},
        snapshot=snapshot,
        event_plan=event_plan,
        route_facts=route_facts,
        run_mode=run_mode,
        evidence_status="standard",
        driver_profile=(
            scenario.driver_profile.model_dump(mode="json")
            if scenario.driver_profile else None
        ),
        vehicle_profile=(
            scenario.vehicle_profile.model_dump(mode="json")
            if scenario.vehicle_profile else None
        ),
        speed_profile=(
            scenario.speed_profile.model_dump(mode="json")
            if scenario.speed_profile else None
        ),
        initial_parameters=effective_params,
        current_parameters=effective_params.copy(),
        initial_hyperparameters=effective_hps,
        current_hyperparameters=effective_hps.copy(),
        original_values=original_values,
        modified_values=modified_values,
        allowed_actions=list(scenario.allowed_actions),
        route_source=draft_route_source,
        display_route=draft_display_route,
    )

    # Initial RunLog
    # M5: thread driver/vehicle/speed profiles from the scenario into the log
    # so the §14.2 evidence export has them.  The values are already on run_state
    # (sourced from scenario.{driver,vehicle,speed}_profile above).
    run_log = RunLog(
        run_id=run_id,
        created_at=_now_iso(),
        simulator_version=SIMULATOR_VERSION,
        snapshot=snapshot,
        route_facts=route_facts,
        event_plan=event_plan,
        run_mode=run_mode,
        evidence_status="standard",
        initial_parameters=effective_params,
        current_parameters=effective_params.copy(),
        initial_hyperparameters=effective_hps,
        current_hyperparameters=effective_hps.copy(),
        original_values=original_values,
        modified_values=modified_values,
        events=[],
        route_source=draft_route_source,
        display_route=draft_display_route,
        driver_profile=run_state.driver_profile,
        vehicle_profile=run_state.vehicle_profile,
        speed_profile=run_state.speed_profile,
        profile_overrides=getattr(draft, "profile_overrides", None),
    )

    recorder = EvidenceRecorder(run_log, runs_dir)
    # 5th element: prior TickState (None = no ticks yet)
    _registry[run_id] = (run_state, package, scenario, recorder, None)
    return run_state


# ---------------------------------------------------------------------------
# Public API — tick
# ---------------------------------------------------------------------------


def tick(run_id: str) -> TickOutcome:
    """Advance one simulation tick for the given run.

    Dispatches to the adapter, appends a TickEvent (or AlgorithmError),
    persists, and pauses when a proposal fires.

    Threads package_runtime_state: passes current state into the adapter,
    then stores the returned next_package_runtime_state back into run_state.

    For M1 scenarios: uses compute_tick_state.
    For M2 scenarios: uses advance_tick with prior TickState.

    Args:
        run_id: The run to advance.

    Returns:
        A TickOutcome with run_state, decision or algorithm_error, paused, completed.

    Raises:
        RunNotFoundError: If run_id is not in the registry.
    """
    if run_id not in _registry:
        raise RunNotFoundError(f"Unknown run_id: {run_id!r}")

    run_state, package, scenario, recorder, prior_tick_state = _registry[run_id]

    # ── Already completed — no-op ─────────────────────────────────────────
    if run_state.status == RunStatus.completed:
        return TickOutcome(
            run_state=run_state,
            decision=None,
            algorithm_error=None,
            paused=False,
            completed=True,
            evaluated_tick_index=None,
        )

    # ── Blocking-error halt guard ─────────────────────────────────────────
    # A run that is paused due to a blocking algorithm error (last_error is
    # not None) must not retry the broken tick.  Return a no-op TickOutcome
    # so stray second tick() calls don't append duplicate error events.
    # NOTE: a normal proposal-pause has last_error == None and is unaffected.
    # Recovery requires starting a new run — there is no resume endpoint.
    if run_state.status == RunStatus.paused and run_state.last_error is not None:
        return TickOutcome(
            run_state=run_state,
            decision=None,
            algorithm_error=None,
            paused=True,
            completed=False,
            evaluated_tick_index=None,
        )

    current_tick = run_state.current_tick

    # ── Compute tick state ────────────────────────────────────────────────
    if _is_m2_scenario(scenario):
        # M2 path: advance_tick with prior state
        tick_state = advance_tick(
            prior_tick_state,
            current_tick,
            run_state.event_plan,
            run_state.route_facts,
            scenario,
        )
    else:
        # M1 path: read from frozen per-tick plan
        tick_state = compute_tick_state(run_state.event_plan, current_tick, scenario)

    if tick_state.completed:
        run_state.status = RunStatus.completed
        return TickOutcome(
            run_state=run_state,
            decision=None,
            algorithm_error=None,
            paused=False,
            completed=True,
            evaluated_tick_index=None,
            tick_state=tick_state,
        )

    # ── Build context and call adapter ────────────────────────────────────
    context = build_adapter_context(tick_state)

    # T005: inject simulation_time_sec, proposal_history, user_action_history.
    # These are required by python_module packages and harmless for built-ins.
    # simulation_time_sec: use tick_state.elapsed_seconds (already computed by
    # tick_engine; reliable for both M1 and M2 variable-cadence paths).
    context["simulation_time_sec"] = float(tick_state.elapsed_seconds)
    _proposal_history, _user_action_history = _derive_history(
        recorder.run_log.events,
        tick_seconds=float(run_state.event_plan.tick_seconds),
        current_sim_sec=float(tick_state.elapsed_seconds),
    )
    context["proposal_history"] = _proposal_history
    context["user_action_history"] = _user_action_history

    # Use current_parameters/hyperparameters (may be overridden in expert mode)
    hyperparameters = run_state.current_hyperparameters or {
        hp.key: hp.default for hp in package.hyperparameters
    }
    parameters = run_state.current_parameters or {
        p.key: p.default for p in package.parameters
    }

    try:
        decision_result: DecisionResult = _adapter.evaluate(
            package=package,
            context=context,
            parameters=parameters,
            hyperparameters=hyperparameters,
            history=[],
            package_runtime_state=run_state.package_runtime_state,
        )
    except AlgorithmAdapterError as exc:
        # ── Adapter failure: record AlgorithmError, do not fake a decision ─
        algo_error = AlgorithmError(
            kind="algorithm_error",
            tick_index=current_tick,
            error_type=exc.error_type,
            message=exc.message,
        )
        recorder.append(algo_error)

        if package.algorithm.error_mode == "non_blocking":
            # Non-blocking: advance tick, continue run unchanged.
            # This is the M1/M2 legacy behaviour, now opt-in.
            run_state.current_tick += 1
            # Update prior_state for M2 (do NOT update package_runtime_state — failed)
            if _is_m2_scenario(scenario):
                _registry[run_id] = (run_state, package, scenario, recorder, tick_state)
            return TickOutcome(
                run_state=run_state,
                decision=None,
                algorithm_error=algo_error,
                paused=False,
                completed=False,
                evaluated_tick_index=current_tick,
                tick_state=tick_state,
            )
        else:
            # Blocking (default): pause the run; do NOT advance current_tick.
            # The run is halted at the broken tick — no decision is produced,
            # and the error is shown in the evidence trace.
            # Recovery requires a new run; there is no resume endpoint.
            run_state.status = RunStatus.paused
            run_state.last_error = {
                "tick_index": current_tick,
                "error_type": exc.error_type,
                "message": exc.message,
            }
            # Update prior_state for M2 (tick_state was computed before the error)
            if _is_m2_scenario(scenario):
                _registry[run_id] = (run_state, package, scenario, recorder, tick_state)
            return TickOutcome(
                run_state=run_state,
                decision=None,
                algorithm_error=algo_error,
                paused=True,
                completed=False,
                evaluated_tick_index=current_tick,
                tick_state=tick_state,
            )

    # ── Thread package_runtime_state: store what the algorithm returned ───
    run_state.package_runtime_state = decision_result.next_package_runtime_state

    # ── Extract M2 tick evidence fields from tick_state ───────────────────
    raw_state = tick_state.raw_state or {}
    feature_groups = tick_state.feature_groups
    driver_update = (tick_state.model_extra or {}).get("_driver_update", {})
    vehicle_update = (tick_state.model_extra or {}).get("_vehicle_update", {})

    # ── Append TickEvent with M2 fields ──────────────────────────────────
    trace = TraceEntry(tick_index=current_tick, decision_result=decision_result)
    tick_event = TickEvent(
        kind="tick",
        tick_index=current_tick,
        tick_state=tick_state,
        trace=trace,
        raw_state=raw_state,
        feature_groups=feature_groups,
        driver_update=driver_update,
        vehicle_update=vehicle_update,
        package_runtime_state=decision_result.next_package_runtime_state,
    )
    recorder.append(tick_event)

    # ── Advance tick ──────────────────────────────────────────────────────
    run_state.current_tick += 1

    # ── Update prior_state for M2 ─────────────────────────────────────────
    if _is_m2_scenario(scenario):
        _registry[run_id] = (run_state, package, scenario, recorder, tick_state)

    # ── Determine new status ──────────────────────────────────────────────
    proposal_fired = (
        decision_result.fire_control.fired
        and decision_result.proposal is not None
    )
    # Pause ONLY when the fired proposal is actionable — i.e. at least one of
    # the proposal's options overlaps scenario.allowed_actions.  A fired
    # monotony SOFT_WARNING whose options (e.g. ["acknowledge"]) have no
    # overlap with allowed_actions is recorded in the evidence but must NOT
    # dead-end the run by leaving it paused with no valid action.
    proposal_is_actionable = proposal_fired and bool(
        set(decision_result.proposal.options) & set(scenario.allowed_actions)
    )

    if proposal_is_actionable:
        run_state.status = RunStatus.paused
        run_state.pending_proposal = decision_result.proposal.id
        paused = True
        completed = False
    elif _is_m2_scenario(scenario):
        # M2: completion detected by tick_state (distance >= total_km)
        # post-increment: check if next advance would be completed
        run_state.status = RunStatus.playing
        paused = False
        completed = False
    elif run_state.current_tick >= len(run_state.event_plan.ticks):
        # M1: completion by exhausting the per-tick plan
        run_state.status = RunStatus.completed
        paused = False
        completed = True
    else:
        run_state.status = RunStatus.playing
        paused = False
        completed = False

    return TickOutcome(
        run_state=run_state,
        decision=decision_result,
        algorithm_error=None,
        paused=paused,
        completed=completed,
        evaluated_tick_index=current_tick,
        tick_state=tick_state,
    )


# ---------------------------------------------------------------------------
# Public API — action
# ---------------------------------------------------------------------------


def action(run_id: str, action_str: str) -> RunState:
    """Apply a driver action to a paused run.

    Args:
        run_id:     The run identifier.
        action_str: The action taken (must be in scenario.allowed_actions).

    Returns:
        The updated RunState.

    Raises:
        RunNotFoundError:    If run_id is not in the registry.
        ActionNotAllowedError: If the run is not paused, no proposal is pending,
                               or the action is not in allowed_actions.
    """
    if run_id not in _registry:
        raise RunNotFoundError(f"Unknown run_id: {run_id!r}")

    run_state, package, scenario, recorder, prior_tick_state = _registry[run_id]

    if run_state.status != RunStatus.paused or run_state.pending_proposal is None:
        raise ActionNotAllowedError(
            f"No pending proposal for run {run_id!r} "
            f"(status={run_state.status!r}, pending={run_state.pending_proposal!r})."
        )

    if action_str not in scenario.allowed_actions:
        raise ActionNotAllowedError(
            f"Action {action_str!r} is not in allowed_actions "
            f"{scenario.allowed_actions!r}."
        )

    # ── Determine resulting status ────────────────────────────────────────
    if action_str == "accept_rest":
        new_status = RunStatus.completed
    else:
        new_status = RunStatus.playing

    # ── Append ActionEvent ────────────────────────────────────────────────
    action_event = ActionEvent(
        kind="action",
        tick_index=run_state.current_tick - 1,  # tick that fired the proposal
        action=action_str,
        resulting_status=new_status.value,
    )
    recorder.append(action_event)

    # ── Update state ──────────────────────────────────────────────────────
    run_state.status = new_status
    run_state.pending_proposal = None

    return run_state


# ---------------------------------------------------------------------------
# Public API — append_feedback (M5)
# ---------------------------------------------------------------------------


def append_feedback(run_id: str, event: "FeedbackEvent") -> None:
    """Append a FeedbackEvent to an active run's EvidenceRecorder.

    NON-ALGORITHMIC: only ever calls recorder.append(); never touches the
    adapter, the tick engine, or any previously recorded TickEvent.

    Args:
        run_id: The active run identifier (must be in the registry).
        event:  The FeedbackEvent to append (kind="feedback").

    Raises:
        RunNotFoundError: If run_id is not in the active registry.
    """
    if run_id not in _registry:
        raise RunNotFoundError(f"Unknown run_id: {run_id!r}")
    _, _, _, recorder, _ = _registry[run_id]
    recorder.append(event)
