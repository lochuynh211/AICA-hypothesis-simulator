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
        event_plan = freeze_event_plan(scenario)
        route_facts = RouteFacts(
            segments=scenario.route_intent.segments,
            bands={feature.key: feature.band_values for feature in package.features},
        )

    # M2 guard: an M2 scenario with no rest opportunities signals a failed or
    # empty plan — do not start the run (failures must never be disguised as a
    # normal empty-plan run).
    if _is_m2_scenario(scenario) and len(event_plan.rest_opportunities) == 0:
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
    )

    # Initial RunLog
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
        )

    # ── Build context and call adapter ────────────────────────────────────
    context = build_adapter_context(tick_state)
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
        # Advance tick so subsequent calls don't retry the same broken tick
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
