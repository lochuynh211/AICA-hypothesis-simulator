"""Run manager (T018) — orchestrates the full run lifecycle.

Holds in-memory state keyed by run_id (M1 single-process; no DB).
Backed by the append-only EvidenceRecorder for persistence.

Public API:
  create_run(package, scenario, run_id, runs_dir) -> RunState
  tick(run_id) -> TickOutcome
  action(run_id, action_str) -> RunState
  get_run(run_id) -> RunState | None
  clear_registry() -> None  (for test isolation)

Design constraints:
  - NO timestamps/UUIDs/randomness generated inside the decision path.
  - run_id is supplied by the caller (the router at Unit 4).
  - The created_at timestamp in RunLog is metadata, not part of the decision
    trace — it is generated here (outside the tick-level core).
  - Ordinal bands only reach the adapter (via tick_engine).
  - Adapter failure → AlgorithmError event; never a faked DecisionResult.
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
)
from aica_api.models.scenario import ScenarioDef
from aica_api.services.event_plan import freeze_event_plan
from aica_api.services.tick_engine import build_adapter_context, compute_tick_state
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
#   (RunState, PackageManifest, ScenarioDef, EvidenceRecorder)
_registry: dict[str, tuple[RunState, PackageManifest, ScenarioDef, EvidenceRecorder]] = {}


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


def _default_hyperparameters(package: PackageManifest) -> dict:
    return {hp.key: hp.default for hp in package.hyperparameters}


def _default_parameters(package: PackageManifest) -> dict:
    return {p.key: p.default for p in package.parameters}


# ---------------------------------------------------------------------------
# Public API — create_run
# ---------------------------------------------------------------------------


def create_run(
    package: PackageManifest,
    scenario: ScenarioDef,
    run_id: str,
    runs_dir: pathlib.Path,
) -> RunState:
    """Initialise a new run and persist the initial run log.

    Args:
        package:   Validated PackageManifest.
        scenario:  Validated ScenarioDef.
        run_id:    Unique identifier supplied by the router.
        runs_dir:  Directory for persisting ``<run_id>.json``.

    Returns:
        The initial RunState (status=created, current_tick=0).
    """
    # ── Freeze immutable artifacts ────────────────────────────────────────
    event_plan: EventPlan = freeze_event_plan(scenario)

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

    route_facts = RouteFacts(
        segments=scenario.route_intent.segments,
        bands={feature.key: feature.band_values for feature in package.features},
    )

    # ── Initial RunState ──────────────────────────────────────────────────
    run_state = RunState(
        run_id=run_id,
        status=RunStatus.created,
        current_tick=0,
        pending_proposal=None,
        package_runtime_state={},
        snapshot=snapshot,
        event_plan=event_plan,
        route_facts=route_facts,
    )

    # ── Initial RunLog ────────────────────────────────────────────────────
    run_log = RunLog(
        run_id=run_id,
        created_at=_now_iso(),
        simulator_version=SIMULATOR_VERSION,
        snapshot=snapshot,
        route_facts=route_facts,
        event_plan=event_plan,
        events=[],
    )

    recorder = EvidenceRecorder(run_log, runs_dir)
    _registry[run_id] = (run_state, package, scenario, recorder)
    return run_state


# ---------------------------------------------------------------------------
# Public API — tick
# ---------------------------------------------------------------------------


def tick(run_id: str) -> TickOutcome:
    """Advance one simulation tick for the given run.

    Dispatches to the adapter, appends a TickEvent (or AlgorithmError),
    persists, and pauses when a proposal fires.

    Args:
        run_id: The run to advance.

    Returns:
        A TickOutcome with run_state, decision or algorithm_error, paused, completed.

    Raises:
        RunNotFoundError: If run_id is not in the registry.
    """
    if run_id not in _registry:
        raise RunNotFoundError(f"Unknown run_id: {run_id!r}")

    run_state, package, scenario, recorder = _registry[run_id]

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
    hyperparameters = _default_hyperparameters(package)
    parameters = _default_parameters(package)

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
        return TickOutcome(
            run_state=run_state,
            decision=None,
            algorithm_error=algo_error,
            paused=False,
            completed=False,
            evaluated_tick_index=current_tick,
        )

    # ── Append TickEvent ──────────────────────────────────────────────────
    trace = TraceEntry(tick_index=current_tick, decision_result=decision_result)
    tick_event = TickEvent(
        kind="tick",
        tick_index=current_tick,
        tick_state=tick_state,
        trace=trace,
    )
    recorder.append(tick_event)

    # ── Advance tick ──────────────────────────────────────────────────────
    run_state.current_tick += 1

    # ── Determine new status ──────────────────────────────────────────────
    proposal_fired = (
        decision_result.fire_control.fired
        and decision_result.proposal is not None
    )

    if proposal_fired:
        run_state.status = RunStatus.paused
        run_state.pending_proposal = decision_result.proposal.id
        paused = True
        completed = False
    elif run_state.current_tick >= len(run_state.event_plan.ticks):
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

    run_state, package, scenario, recorder = _registry[run_id]

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
