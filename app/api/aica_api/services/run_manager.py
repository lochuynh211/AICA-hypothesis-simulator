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

M1 path: scenario.driver_signal_params is None → freeze_event_plan + compute_tick_state.
M2 path: scenario.driver_signal_params is not None → plan draft frozen (route_facts +
         event_plan already computed) + advance_tick.  Feature 009: the anomaly
         signal's run_seed is threaded from run_state.run_seed into advance_tick.
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
    ContentContext,
    ContentReliefState,
    EventPlan,
    RestSpot,
    RouteFacts,
    RunState,
    RunStatus,
    Snapshot,
    TickState,
)
from aica_api.models.scenario import ScenarioDef
from aica_api.services.event_plan import freeze_event_plan
from aica_api.services.recovery import start_recovery
from aica_api.services.nri_forecast import run_forecast
from aica_api.services.tick_engine import (
    _eta_min_to_km,
    advance_tick,
    build_adapter_context,
    compute_tick_state,
    rest_spot_actionability,
)
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


def get_prior_tick_state(run_id: str) -> "TickState | None":
    """Return the prior TickState for a run, or None if no tick yet / not active.

    Used by the rest-spots endpoint to read current drowsiness, distance, and speed
    without going through the full tick path.

    Args:
        run_id: The run identifier to look up.

    Returns:
        The last TickState computed for this run, or None.
    """
    entry = _registry.get(run_id)
    return entry[4] if entry is not None else None


def get_scenario(run_id: str) -> "ScenarioDef | None":
    """Return the ScenarioDef for an active run, or None if unknown.

    Used by the rest-spots endpoint to read scenario-level config such as
    driver_signal_params growth rates.

    CAUTION: this is the EXACT object reference stored in the run's registry
    entry — the same object ``create_run`` read off ``run_plan._draft_registry
    [plan_id]`` (create_run never copies it). A plan_id is never invalidated
    after use, so a SECOND run created from the same plan_id (e.g. re-running
    a scenario with a different run_seed for comparison) gets the IDENTICAL
    ScenarioDef reference. Never mutate the returned object in place — use
    ``replace_scenario`` to install a per-run override instead (see its
    docstring for the incident this guards against).

    Args:
        run_id: The run identifier to look up.

    Returns:
        The ScenarioDef, or None if run_id is not in the active registry.
    """
    entry = _registry.get(run_id)
    return entry[2] if entry is not None else None


def replace_scenario(run_id: str, scenario: "ScenarioDef") -> None:
    """Replace the ScenarioDef installed in ONE run's own registry entry.

    Used by the merged-runs orchestrator (feature 020) to install a per-run
    override (e.g. a nap-duration override on ``recovery_options``) WITHOUT
    mutating the object ``get_scenario`` returns in place. That object may be
    shared with OTHER runs: ``run_plan._draft_registry`` is keyed by plan_id,
    not run_id, and ``create_run`` stores whatever ScenarioDef is cached
    there for a given plan_id without copying it — so two runs created from
    the same plan_id (an ordinary, fully-supported workflow) start out
    pointing at the literal same ScenarioDef object. Mutating it in place
    (e.g. ``scenario.recovery_options = [...]``) would silently leak into
    every other run built from that plan_id, present or future.

    The caller must pass a NEW ScenarioDef (e.g. via ``scenario.model_copy
    (update={...})``) — this function only swaps the reference stored for
    ``run_id``; it never mutates or copies anything itself.

    Args:
        run_id:   The run identifier whose registry entry is updated.
        scenario: The replacement ScenarioDef for this run only.

    Raises:
        RunNotFoundError: If run_id is not in the active registry.
    """
    entry = _registry.get(run_id)
    if entry is None:
        raise RunNotFoundError(f"Unknown run_id: {run_id!r}")
    run_state, package, _old_scenario, recorder, prior_tick_state = entry
    _registry[run_id] = (run_state, package, scenario, recorder, prior_tick_state)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _content_hash(data: dict[str, Any]) -> str:
    """SHA-256 hash of the canonical JSON representation of a dict."""
    payload = json.dumps(data, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def resolve_manifest_defaults(defaults: dict[str, Any], overrides: dict[str, Any] | None) -> dict[str, Any]:
    """Per-key merge: manifest `defaults` ⊕ `overrides` — override wins per key.

    Feature 009 (FR-009 / contracts/tiered-context.md): `context["hyperparameters"]`
    (and `parameters`) delivered to an algorithm MUST always contain every manifest-
    declared key, so algorithms never need an `hp.get(key, <hardcoded default>)`
    fallback. A plain ``overrides or defaults`` is WRONG here: it swaps in the raw
    override dict wholesale the moment it's non-empty, silently dropping any
    manifest key the override dict doesn't mention. This always starts from the
    full default set and layers only the keys actually present in `overrides`.
    """
    resolved = dict(defaults)
    if overrides:
        resolved.update(overrides)
    return resolved


def _is_m2_scenario(scenario: ScenarioDef) -> bool:
    """True if the scenario has M2/feature-009 tiered-signal-driven fields."""
    return scenario.driver_signal_params is not None


# ---------------------------------------------------------------------------
# Fire-control: post-response trigger de-duplication (fixbug-0804)
# ---------------------------------------------------------------------------
#
# 30-minute decline/postpone cooldown window, per category (plan §5).  Not a
# manifest hyperparameter — this is harness fire-control policy, not an
# algorithm tuning knob (see docs/fixbug-0804-trigger-dedup-plan.md §8/§9).
_DECLINE_COOLDOWN_SEC = 1800.0

# 45-minute SAME-CATEGORY cooldown after ANY answered proposal — including an
# ACCEPTED one (owner review, 2026-08-08). The 30-minute window above only fires
# on a rejection (decline/postpone/acknowledge); accepting left the category free
# to re-propose almost immediately, so a driver who took the content or the rest
# could be asked for the same thing again a few ticks later. Whichever window is
# longer wins, so this never shortens an existing suppression.
_SAME_CATEGORY_COOLDOWN_SEC = 2700.0

# CDC-SU slide 34's second control: 単位時間あたり提案回数. NOT a general rate
# limiter — read this comment before touching either constant.
#
# _DECLINE_COOLDOWN_SEC above already bounds every NORMALLY-spaced fire: any
# category answered with a cooldown-setting action (decline/postpone/
# acknowledge) cannot show again for 1800s. The ONE path that sets no
# cooldown is rest_required answered with accept_rest — deliberately, since
# suppressing a second REST_PROPOSAL while resting is the `recovery_active`
# gate's job in tick(), not this function's (see the Rules block in this
# function's docstring). That path is otherwise UNBOUNDED at harness level:
# nothing stops accept_rest fires from repeating arbitrarily fast.
#
# This constant pair exists SOLELY as a backstop for that one path. It is
# deliberately inert during normal, cooldown-respecting operation — that is
# the point, not a bug. If you find yourself relying on it to bound a
# cooldown-setting category's cadence, something upstream is already wrong.
#
# Sizing constraint: the Hybrid package's own in-algorithm cap
# (proposalCountLast30Min / max_proposals_per_30min, default 3 per 1800s —
# see packages/aica_transparent_hybrid_trigger_v1/package.json) must never be
# overridden by this outer cap (§9.2: harness cap no tighter than Hybrid's
# own). Since Hybrid answers its own fires the same cooldown-respecting way
# (spacing > 1800s between shown same-category fires), the backstop must
# never trigger on 1800s-spaced fires, or it would silently tighten Hybrid's
# tuned behaviour instead of only backstopping the accept_rest path.
#
# With _PROPOSAL_COUNT_WINDOW_SEC = 3600.0, a trailing window (t - 3600, t]
# holds AT MOST 2 fires spaced >= 1800s apart (three such fires span > 3600s
# end to end), so _MAX_PROPOSALS_PER_WINDOW = 3 can never be reached by
# normally-spaced fires — the backstop is provably inert on that path, hence
# never tighter than Hybrid's own 1800s/3 cap. It only fires when a category
# is shown 3+ times inside one hour, which only the un-cooldowned
# accept_rest path can produce. Covered by
# test_normally_spaced_fires_are_never_count_capped in
# test_fire_control_window.py; will be additionally covered by Task 11's
# tests/test_recovery_parity.py::test_count_cap_never_bites_on_hybrid once
# that lands.
_MAX_PROPOSALS_PER_WINDOW = 3

# The effective 提案間隔 for a category once a fire has been ANSWERED: the
# decline cooldown and the same-category window both apply, so the later of
# the two governs. Named once so the constant and every test track together.
_SAME_CATEGORY_RELEASE_SEC = max(_DECLINE_COOLDOWN_SEC, _SAME_CATEGORY_COOLDOWN_SEC)
_PROPOSAL_COUNT_WINDOW_SEC = 3600.0


# ── Fire-control: trip-edge guard (fixbug-0806) ───────────────────────────────
# Customer review: a ROUTINE proposal (rest / monotony content) is very unlikely
# to be accepted in the first minutes of a drive — the driver has only just set
# out — or in the last minutes before arrival — they are almost home. Both are
# the "too soon"/"too late" triggers customers reject on sight, so a fire in
# either edge should not reach the driver.
#
# The subtlety (and why this is NOT modelled as an auto-decline): a decline would
# open the same-category de-dup cooldown in `_derive_response_suppression`, which
# would then block the FIRST legitimate proposal right after the edge — exactly
# the "next trigger cannot happen because of the duplicate rejection" trap. So the
# guard instead neutralizes the fire itself (fire_control.fired -> False,
# suppressed=True) BEFORE the TickEvent is recorded. The evidence log then carries
# no fired proposal for the edge tick at all: no cooldown window opens, and the
# 単位時間あたり提案回数 count cap (which counts every logged fired proposal, even
# one merely gated) is never consumed. It is "reject it, but do not kick the
# rejection window."
_TRIP_START_EDGE_SEC = 20.0 * 60.0   # first 20 min of the drive (elapsed sim time)
_TRIP_END_EDGE_MIN = 10.0            # last 10 min of driving-ETA to the destination
# Same ROUTINE set the `recovery_active` gate in `tick()` uses — escalations
# (e.g. SEVERE_INTERVENTION) still fire at the edges (a genuine safety
# intervention must never be withheld for being early or late).
_TRIP_EDGE_ROUTINE_RESULT_TYPES = ("REST_PROPOSAL", "MONOTONY_PROPOSAL")


def _inside_trip_edge(
    *,
    elapsed_seconds: float,
    distance_km: float | None,
    route_facts,
    event_plan,
    speed_profile,
) -> bool:
    """True when the vehicle is inside a trip-edge zone (fixbug-0806).

    Start edge: elapsed sim time < ``_TRIP_START_EDGE_SEC`` — applies to every
    scenario (M1 and M2). End edge: the *driving* ETA from the current position
    to the route end is < ``_TRIP_END_EDGE_MIN`` — only computable when a
    distance (M2) and a total route distance are both known; skipped otherwise
    (an M1 time-only scenario has no destination distance, so only the start edge
    applies to it).

    "Minutes to the destination" is computed with ``_eta_min_to_km`` (tick_engine)
    — the SAME planned-profile forward integration the engine uses for
    ``nextRestSpotMin`` — so it means what the simulation itself would compute,
    not ``remaining_km / current_speed`` (which the merged-jam fix already showed
    is wrong on a route whose speed varies segment to segment).
    """
    if elapsed_seconds < _TRIP_START_EDGE_SEC:
        return True
    total_km = getattr(route_facts, "total_route_distance_km", None)
    if distance_km is not None and total_km:
        remaining_min = _eta_min_to_km(
            target_km=total_km,
            from_km=distance_km,
            from_elapsed_min=elapsed_seconds / 60.0,
            route_facts=route_facts,
            event_plan=event_plan,
            sp=speed_profile,
        )
        if remaining_min < _TRIP_END_EDGE_MIN:
            return True
    return False


def _apply_trip_edge_guard(
    decision_result: "DecisionResult",
    *,
    tick_state,
    route_facts,
    event_plan,
    speed_profile,
) -> "DecisionResult":
    """Neutralize a ROUTINE proposal that fired inside a trip edge (fixbug-0806).

    Returns ``decision_result`` unchanged unless it actually fired a routine
    proposal AND the vehicle is inside a trip edge, in which case a COPY is
    returned with ``fire_control`` rewritten to a clean suppression
    (``fired=False``, ``suppressed=True``, reason prefixed with
    ``trip_edge_guard``). The raw scores / candidates / explanation are left
    intact, so the evidence trace still shows what the algorithm wanted — only
    fire-control is overridden, which is exactly this layer's job.

    MUST be called in BOTH tick loops (``run_manager.tick`` and
    ``services/preview.iter_preview_ticks``) BEFORE the TickEvent is appended, so
    the neutralized fire never enters the evidence log as a fired proposal — no
    de-dup cooldown, no count-cap consumption. See ``_inside_trip_edge``.
    """
    fc = decision_result.fire_control
    if not (fc.fired and decision_result.proposal is not None):
        return decision_result
    if decision_result.result_type not in _TRIP_EDGE_ROUTINE_RESULT_TYPES:
        return decision_result
    if not _inside_trip_edge(
        elapsed_seconds=float(tick_state.elapsed_seconds),
        distance_km=tick_state.distance_km,
        route_facts=route_facts,
        event_plan=event_plan,
        speed_profile=speed_profile,
    ):
        return decision_result
    reason = "trip_edge_guard"
    if fc.reason:
        reason = f"{reason}; {fc.reason}"
    new_fc = fc.model_copy(update={"fired": False, "suppressed": True, "reason": reason})
    return decision_result.model_copy(update={"fire_control": new_fc})


def _apply_rest_min_gap_guard(
    decision_result: "DecisionResult",
    *,
    tick_state,
    hyperparameters,
    last_surfaced_monotony_sec,
) -> "DecisionResult":
    """Neutralize a rest proposal that fired too soon after a surfaced monotony card.

    Engine-level spacing guard, sibling of ``_apply_trip_edge_guard``: a
    ``rest_required`` proposal — forecast REST_FORECAST_FIRE or ordinary
    REST_FIRE alike — must not surface within
    ``rest_min_gap_after_monotony_min`` of the moment the driver was last SHOWN a
    monotony card, so the two proposals do not arrive stacked. Keyed on the
    surfaced-monotony time the caller tracks (``run_state.last_surfaced_monotony_sec``
    live / a loop-local in ``iter_preview_ticks``), NOT the raw per-tick fire.

    Returns ``decision_result`` unchanged unless it actually fired a rest_required
    proposal AND is inside the gap window, in which case a COPY is returned with
    ``fire_control`` neutralized (``fired=False``, ``suppressed=True``, reason
    prefixed ``rest_min_gap_guard``) AND ``result_type`` rewritten to
    ``"SUPPRESSED"``. The raw scores / candidates / states / explanation are left
    intact, so the trace still shows what the algorithm wanted (states.rest keeps
    its REST_FORECAST_FIRE / REST_FIRE label, scores/candidates untouched).

    Why ``result_type`` is rewritten here (and the trip-edge guard leaves it): the
    NRI algorithm has no cooldown, so once it enters the rest band it re-emits a
    rest proposal on EVERY tick until the gap elapses. Leaving those gated ticks
    tagged ``REST_PROPOSAL`` would make the append-only log read as many rest
    proposals when only ONE ever surfaced — a "REST_PROPOSAL that didn't fire" is
    self-contradictory. ``"SUPPRESSED"`` is the codebase's existing result_type for
    a wanted-but-gated proposal (the hybrid persistence gate emits it, and the
    e2e pre-fire assertions in test_uc01_integration_s9 / test_api_run_loop
    already whitelist it), so a gated rest tick recorded as ``SUPPRESSED`` +
    ``fired=False`` + a ``rest_min_gap_guard`` reason is both honest and
    consistent. The trip-edge guard neutralizes ROUTINE proposals only at the
    trip edges, where the same category does not re-fire across a counted window,
    so it never hit this and kept the lighter fire-control-only override.

    Like the trip-edge guard it MUST be called in BOTH tick loops BEFORE the
    TickEvent is recorded, so the spaced-out fire never enters the log as a fired
    proposal. This is load-bearing, not cosmetic: were it a post-record
    actionability clear instead, ``_derive_response_suppression`` would still see
    ``fired=True`` and count the gated fire toward its 単位時間あたり提案回数
    count-cap — a run whose forecast keeps raw-firing every tick (never accepted,
    because we gate it) would trip the cap and silence the LEGITIMATE rest fire
    that lands after the gap. Neutralizing here keeps the count-cap's
    provably-inert-on-normal-spacing invariant intact. The gap defaults to 0
    (disabled) for any package that does not declare
    ``rest_min_gap_after_monotony_min``.
    """
    rest_gap_min = float(hyperparameters.get("rest_min_gap_after_monotony_min", 0.0))
    if rest_gap_min <= 0.0 or last_surfaced_monotony_sec is None:
        return decision_result
    fc = decision_result.fire_control
    if not (fc.fired and decision_result.proposal is not None):
        return decision_result
    if decision_result.selected_category != "rest_required":
        return decision_result
    elapsed_since_min = (
        float(tick_state.elapsed_seconds) - float(last_surfaced_monotony_sec)
    ) / 60.0
    if elapsed_since_min >= rest_gap_min:
        return decision_result
    reason = "rest_min_gap_guard"
    if fc.reason:
        reason = f"{reason}; {fc.reason}"
    new_fc = fc.model_copy(update={"fired": False, "suppressed": True, "reason": reason})
    return decision_result.model_copy(
        update={"fire_control": new_fc, "result_type": "SUPPRESSED"}
    )


def _forecast_scaffold(*, tick_state, route_facts, event_plan, sp, eta_filter_min):
    """Cheap pass-1 nri_forecast: current-spot actionability only, evaluated=False.

    Lets the NRI algorithm read the SHARED actionability rule (Task 3) for the
    ordinary s_total>=100 rest path too, instead of the native nextRestSpotMin
    (which lacks the destination-edge check). The expensive future projection is
    added later only when the score lands in the forecast band."""
    act = rest_spot_actionability(
        from_km=tick_state.distance_km or 0.0,
        from_elapsed_min=float(tick_state.elapsed_seconds) / 60.0,
        route_facts=route_facts, event_plan=event_plan, sp=sp,
        eta_filter_min=eta_filter_min,
    )
    return {
        "evaluated": False, "error": None, "threshold_order_valid": True,
        "forecast_mode": "committed_state_continuation",
        "forecast_start": None, "future_fire": None, "forecast_rest_spot": None,
        "forecast_future_rest_unactionable": None, "forecast_rest_unactionable_reason": None,
        "current_rest_spot": {
            "exists": act.exists,
            "position_km": act.position_km,
            "eta_from_current_min": (None if not act.exists else act.eta_from_position_min),
            "eta_to_destination_min": act.eta_to_destination_min,
            "actionable": act.actionable,
            "unactionable_reason": act.unactionable_reason,
        },
    }


def _forecast_eligible(*, decision_result, hyperparameters, recovery_active, inside_edge):
    """Cheap gate (§19): NRI package, score strictly in (forecast, fire), not in a
    recovery, not inside a trip edge, and the current spot is actionable."""
    if "threshold_forecast_rest" not in hyperparameters:
        return False
    if recovery_active or inside_edge:
        return False
    t_forecast = float(hyperparameters["threshold_forecast_rest"])
    t_fire = float(hyperparameters["threshold_fire"])
    t_mono = float(hyperparameters["threshold_monotony"])
    if not (t_mono < t_forecast < t_fire):
        return False
    s_total = decision_result.scores.get("s_total")
    if s_total is None or not (t_forecast < s_total < t_fire):
        return False
    return True


def _derive_response_suppression(
    events: list,
    current_sim_sec: float,
    tick_seconds: float,
) -> dict[str, bool]:
    """Derive per-category post-response suppression from the event log.

    See docs/fixbug-0804-trigger-dedup-plan.md §5 for the full state-machine
    table. Walks the append-only log once, chronologically — same single-pass
    style as ``_derive_history`` — pairing each fired proposal (a TickEvent
    whose ``decision_result.fire_control.fired`` is True and whose
    ``.proposal`` is not None) with the ActionEvent recorded at the EXACT SAME
    tick_index (``run_manager.action()`` always stamps an ActionEvent with
    ``tick_index=run_state.current_tick - 1``, i.e. the tick that fired the
    pending proposal it answers — see this module's ``action()``). Exact
    match is required, not "first action at/after": once some fired
    proposals are suppressed (harness-gated, no action follows them), a
    "first at/after" scan can skip ahead and pair a later proposal's real
    answer onto an earlier, unrelated, unanswered proposal. A proposal's
    sim-time is ``tick_state.elapsed_seconds`` (fallback ``tick_index *
    tick_seconds`` when absent), matching ``_derive_history``'s time
    convention.

    Rules (independent per category — a monotony decline never touches
    ``rest_required`` and vice versa; the latest action of a category wins):
      - Monotony ACCEPTED (``acknowledge``) or
        Monotony DECLINED (``decline``)      -> suppress monotony_prevention
        while ``current_sim_sec - responseTimeSec < _DECLINE_COOLDOWN_SEC``
        (CDC-SU slide 81: re-check the threshold after a set time; slide 34
        permits only an interval and a per-unit-time count, never an
        indefinite latch).
      - Rest DECLINED (``decline``) or
        Rest POSTPONED (``postpone``)        -> suppress rest_required under
        the same 30-minute cooldown window.
      - Rest ACCEPTED (``accept_rest``)      -> NOT this helper's job; the
        existing ``recovery_active`` gate in ``tick()`` already covers it.

    Also independently per category (CDC-SU slide 34's other control,
    単位時間あたり提案回数): a category is suppressed once
    ``_MAX_PROPOSALS_PER_WINDOW`` of its fires were actually SHOWN to the
    driver (i.e. not already suppressed by state accumulated from earlier
    pairs) inside the trailing ``_PROPOSAL_COUNT_WINDOW_SEC``. This is
    counted in the SAME single pass as the interval-cooldown state above —
    only fires that got through count towards the allowance, so a burst of
    already-suppressed fires can't silently eat it. The cap releases
    naturally as the window rolls forward.

    Args:
        events:          The run log events (TickEvent | ActionEvent | AlgorithmError).
        current_sim_sec: Current simulation time (same clock as tick_state.elapsed_seconds).
        tick_seconds:    Scenario tick cadence in seconds (fallback sim-time only).

    Returns:
        {"rest_required": bool, "monotony_prevention": bool}
    """
    # Collect fired proposals (tick_index, category, sim_sec) chronologically,
    # and actions indexed by their exact tick_index (an action always answers
    # the proposal fired at that same tick_index — see docstring above).
    fired: list[tuple[int, str, float]] = []
    actions_by_tick: dict[int, str] = {}
    for event in events:
        kind = event.kind
        if kind == "tick":
            dr = event.trace.decision_result
            if dr.fire_control.fired and dr.proposal is not None:
                elapsed = getattr(event.tick_state, "elapsed_seconds", None)
                sec = (
                    float(elapsed)
                    if elapsed is not None
                    else float(event.tick_index * tick_seconds)
                )
                fired.append((event.tick_index, dr.selected_category or "", sec))
        elif kind == "action":
            actions_by_tick[event.tick_index] = event.action

    pairs: list[tuple[str, float, str | None]] = [
        (category, sec, actions_by_tick.get(tick_index))
        for tick_index, category, sec in fired
    ]

    monotony_suppressed = False
    monotony_release_sec: float | None = None

    rest_suppressed = False
    rest_release_sec: float | None = None

    shown_times: dict[str, list[float]] = {"rest_required": [], "monotony_prevention": []}

    for category, sec, matched_action in pairs:
        # Was this fire suppressed by the state accumulated from EARLIER pairs?
        # Only fires that got through were shown to the driver, so only those
        # consume the 単位時間あたり提案回数 allowance.
        #
        # BOTH rules must be considered here, not just the interval. Counting a
        # fire that the COUNT CAP itself suppressed makes the cap self-feeding:
        # once `shown` reaches the limit every later fire is suppressed, yet each
        # one is still recorded, so the count never falls back below the limit and
        # the category is silenced for the rest of the run. Observed on
        # uc04-01/Hybrid: monotony sat at exactly 3-in-window from 300 min to the
        # end of a 358-min route and never fired again.
        if category == "monotony_prevention":
            interval_suppressed = monotony_suppressed and (
                monotony_release_sec is not None and sec < monotony_release_sec
            )
        else:
            interval_suppressed = rest_suppressed and (
                rest_release_sec is not None and sec < rest_release_sec
            )
        recent_at_fire = [
            t for t in shown_times.get(category, [])
            if t > sec - _PROPOSAL_COUNT_WINDOW_SEC
        ]
        count_suppressed = len(recent_at_fire) >= _MAX_PROPOSALS_PER_WINDOW
        if not interval_suppressed and not count_suppressed and category in shown_times:
            shown_times[category].append(sec)

        if category == "rest_required":
            if matched_action in ("decline", "postpone"):
                rest_suppressed = True
                rest_release_sec = sec + _SAME_CATEGORY_RELEASE_SEC
            elif matched_action is not None:
                # ACCEPTED (accept_rest). The recovery_active gate already
                # suppresses while the driver is actually resting; this adds the
                # 45-minute same-category window AFTER it, so the driver is not
                # asked to rest again straight off the back of a rest.
                rest_suppressed = True
                rest_release_sec = sec + _SAME_CATEGORY_COOLDOWN_SEC
        elif category == "monotony_prevention":
            if matched_action in ("acknowledge", "decline"):
                # CDC-SU slide 81: after the content ends or is refused,
                # 一定時間後に再度閾値チェック. An acknowledge used to suppress
                # this category with NO timer until a REST_PROPOSAL fired, which
                # slide 34 does not permit — it allows only 提案間隔 and
                # 単位時間あたり提案回数.
                monotony_suppressed = True
                monotony_release_sec = sec + _SAME_CATEGORY_RELEASE_SEC
            elif matched_action is not None:
                # Any other answer still counts as "this proposal was served" —
                # the same 45-minute same-category window applies.
                monotony_suppressed = True
                monotony_release_sec = sec + _SAME_CATEGORY_COOLDOWN_SEC

    result_rest = False
    if rest_suppressed and rest_release_sec is not None:
        result_rest = current_sim_sec < rest_release_sec

    result_monotony = False
    if monotony_suppressed and monotony_release_sec is not None:
        result_monotony = current_sim_sec < monotony_release_sec

    def _count_capped(category: str) -> bool:
        window_start = current_sim_sec - _PROPOSAL_COUNT_WINDOW_SEC
        recent = [t for t in shown_times[category] if t > window_start]
        return len(recent) >= _MAX_PROPOSALS_PER_WINDOW

    result_rest = result_rest or _count_capped("rest_required")
    result_monotony = result_monotony or _count_capped("monotony_prevention")

    return {"rest_required": result_rest, "monotony_prevention": result_monotony}


def _derive_history(
    events: list,
    tick_seconds: float,
    current_sim_sec: float = 0.0,
) -> tuple[dict, list]:
    """Derive proposal_history and user_action_history from the event log.

    Walks the event list once.  TickEvents with a fired proposal contribute to
    ``proposal_history``; ActionEvents contribute to ``user_action_history``.

    Time convention: a proposal's sim-time is the stored ``tick_state
    .elapsed_seconds`` of the tick it fired on — the SAME clock the caller
    passes as ``current_sim_sec`` (``tick_state.elapsed_seconds`` of the tick
    being evaluated), so ``current_sim_sec - lastProposalTimeSec`` is a real
    elapsed duration.  ``tick_index * tick_seconds`` is only the fallback for
    an event with no tick_state.

    This used to recompute the time as ``tick_index * tick_seconds``
    unconditionally, which is right for M1 but back-dates every M2 proposal by
    exactly one tick: the M2 tick engine stamps a tick
    ``(tick_index + 1) * tick_seconds`` (``tick_engine.advance_tick``).  The
    algorithm's cooldown therefore expired one full tick early — observed on
    combined case C-05, where ``monotony_cooldown_sec = 900`` re-fired every
    720 s — and the 30-minute count window was shifted by the same amount.

    Args:
        events:          The run log events (TickEvent | ActionEvent | AlgorithmError).
        tick_seconds:    Scenario tick cadence in seconds (fallback sim-time only).
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
    # Real sim-time of each fired proposal, index-aligned with the two lists above.
    fired_proposal_secs: list[float] = []
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
                elapsed = getattr(event.tick_state, "elapsed_seconds", None)
                fired_proposal_secs.append(
                    float(elapsed)
                    if elapsed is not None
                    else float(event.tick_index * tick_seconds)
                )
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
    last_time_sec = fired_proposal_secs[-1]

    # lastProposalResult: first action at or after the last proposal's tick_index.
    last_proposal_result: str | None = None
    for action_tick, action in action_by_order:
        if action_tick >= last_tick:
            last_proposal_result = action
            break

    # ── proposalCountLast30Min (1800 sec window) ───────────────────────────
    window_start_sec = current_sim_sec - 1800.0
    proposals_in_window = sum(
        1 for sec in fired_proposal_secs if sec >= window_start_sec
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

    # M1 fallback: if scenario has no driver_signal_params and event_plan has no
    # ticks, re-freeze using the scenario's event_presets
    if not _is_m2_scenario(scenario) and len(event_plan.ticks) == 0:
        # Guard: package-declared tick_seconds is an M2-only feature.  The M1 legacy
        # path calls freeze_event_plan(scenario) which ignores it silently — that
        # would be a confusing trap.  Fail loudly instead.
        if package.algorithm.tick_seconds is not None:
            raise ValueError(
                "package-declared tick_seconds is only supported for M2 tiered-signal "
                "scenarios (scenario must have driver_signal_params). "
                "The M1 legacy path (no driver_signal_params) re-freezes via "
                "freeze_event_plan which ignores the package tick_seconds override. "
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

    # Feature 009: run_seed is frozen at run start from scenario.run_seed_default
    # and threaded through tick() into advance_tick's anomaly generator.
    #
    # Fix (whole-branch review): `scenario` here is the EFFECTIVE scenario
    # registered by run_plan.create_draft (entry[2] above) — if the client
    # passed an explicit run_seed to POST /api/run-plans, create_draft already
    # baked it into effective_scenario.run_seed_default (see
    # run_plan.create_draft), so this line picks it up with no further
    # threading needed. When no explicit run_seed was supplied,
    # scenario.run_seed_default is the untouched scenario default — unchanged
    # behavior.
    run_seed = scenario.run_seed_default

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
        run_seed=run_seed,
        # NOTE (feature 009): RunState/RunLog keep the field name `driver_profile`
        # (a plain evidence-snapshot dict, untouched by this unit) but it now
        # carries the driver_signal_params dump.  vehicle_profile is always None
        # — the vehicle model is retired.
        driver_profile=(
            scenario.driver_signal_params.model_dump(mode="json")
            if scenario.driver_signal_params else None
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


def _synthetic_content_context(
    events: list,
    scenario: ScenarioDef,
    current_sim_sec: float,
    tick_seconds: float,
) -> ContentContext | None:
    """Trigger-only screen fallback (recovery design §11).

    That screen has no proposal run, so `playback_state` — and therefore
    `contentActive` — can never be true, and after the erase-hacks were deleted
    an acknowledged monotony proposal would relieve nothing at all. When the
    scenario configures both `default_content_episode_min` and
    `default_content_service_id`, the most recent `acknowledge` opens a
    synthetic episode of that length using `<service>@monotony`.

    Identical numbers and identical code path to the Combined screen — only the
    WINDOW is synthetic (a timer) rather than real (`playback_state`).

    Time convention: this module's ``elapsed_seconds`` clock stamps tick
    ``tick_index`` at ``(tick_index + 1) * tick_seconds`` (``tick_engine
    .advance_tick``; see ``_derive_history``'s docstring for the same
    off-by-one note). ``last_ack_sec`` uses that same convention so the window
    comparison below is a real elapsed duration, not skewed by one tick.
    ``current_sim_sec`` is the caller's ``current_tick * tick_seconds`` — i.e.
    the just-completed prior tick's ``elapsed_seconds`` — which is already on
    this same clock.

    Returns None when the fallback is not configured, no acknowledge has
    happened, or the window has expired.
    """
    episode_min = scenario.default_content_episode_min
    service_id = scenario.default_content_service_id
    if episode_min is None or service_id is None:
        return None

    last_ack_sec: float | None = None
    for event in events:
        if event.kind == "action" and event.action == "acknowledge":
            last_ack_sec = float((event.tick_index + 1) * tick_seconds)
    if last_ack_sec is None:
        return None
    if current_sim_sec - last_ack_sec >= episode_min * 60.0:
        return None

    return ContentContext(service_id=service_id, purpose="monotony")


def tick(run_id: str, *, content_context: ContentContext | None = None) -> TickOutcome:
    """Advance one simulation tick for the given run.

    Dispatches to the adapter, appends a TickEvent (or AlgorithmError),
    persists, and pauses when a proposal fires.

    Threads package_runtime_state: passes current state into the adapter,
    then stores the returned next_package_runtime_state back into run_state.

    For M1 scenarios: uses compute_tick_state.
    For M2 scenarios: uses advance_tick with prior TickState.

    Args:
        run_id: The run to advance.
        content_context: The content episode playing this tick, supplied by the
            merged router from the proposal run's `playback_state`. When None
            and the scenario configures the §11 fallback, a synthetic episode is
            derived from the most recent `acknowledge` instead.

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
    # Defined unconditionally (not just in the M2 branch below) so the NRI
    # forecast seam can reference it further down on any scenario without a
    # NameError — the M1 `else` branch never sets it, so the forecast (which
    # only ever activates for NRI/M2 anyway) sees None there.
    effective_content = None
    if _is_m2_scenario(scenario):
        # M2 path: advance_tick with prior state, threading recovery + content
        effective_content = content_context
        if effective_content is None:
            effective_content = _synthetic_content_context(
                recorder.run_log.events,
                scenario,
                current_sim_sec=float(current_tick * run_state.event_plan.tick_seconds),
                tick_seconds=float(run_state.event_plan.tick_seconds),
            )
        tick_state = advance_tick(
            prior_tick_state,
            current_tick,
            run_state.event_plan,
            run_state.route_facts,
            scenario,
            recovery=run_state.recovery,
            run_seed=run_state.run_seed,
            content=effective_content,
            content_relief=run_state.content_relief,
        )
        # Thread _recovery_next back: advance_tick stashes the updated
        # RecoveryState in model_extra["_recovery_next"] when recovery is active.
        rec_next = (tick_state.model_extra or {}).get("_recovery_next")
        if rec_next is not None:
            run_state.recovery = rec_next if rec_next.active else None
        # Thread the content-episode accrual forward; clear it the moment no
        # content is playing so the next episode starts from zero.
        run_state.content_relief = (tick_state.model_extra or {}).get(
            "_content_relief_next"
        )
    else:
        # M1 path: read from frozen per-tick plan
        tick_state = compute_tick_state(run_state.event_plan, current_tick, scenario)

    if tick_state.completed:
        # Do not exit early if recovery is still active — the tick engine holds
        # position at the rest spot (STOPPED phase keeps completed=False), so
        # this guard is only needed for the "resuming" phase coinciding with
        # route-end.  After reading _recovery_next above, run_state.recovery
        # is already None in that case (resuming → active=False).
        if not (run_state.recovery and run_state.recovery.active):
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
    # recovery_active: True only while the driver is currently in an accepted
    # rest sequence.  The algorithm uses this to scope its REST_RECOVERY
    # suppression to the rest itself — once the driver resumes, recovery_active
    # is False and the algorithm re-evaluates normally so a fresh REST_PROPOSAL
    # can fire when drowsiness rebuilds.  Without this the algorithm would stay
    # locked in REST_RECOVERY forever after a single accept (lastProposalResult
    # never clears, since no later rest proposal is allowed to fire).
    context["recovery_active"] = bool(
        run_state.recovery and run_state.recovery.active
    )

    # Use current_parameters/hyperparameters (may be overridden in expert mode).
    # Feature 009 (FR-009): resolved PER KEY — manifest default unless the run's
    # current_* dict overrides that specific key — so every declared hyperparameter
    # is always present even if current_hyperparameters is empty/partial. Do NOT
    # use `or` here: an `or` falls back to the raw manifest-default dict only when
    # current_hyperparameters is completely empty, silently dropping any manifest
    # keys that current_hyperparameters simply doesn't mention (e.g. a package.json
    # key added after this run's draft was created ⊕ overrides).
    hyperparameters = resolve_manifest_defaults(
        {hp.key: hp.default for hp in package.hyperparameters},
        run_state.current_hyperparameters,
    )
    parameters = resolve_manifest_defaults(
        {p.key: p.default for p in package.parameters},
        run_state.current_parameters,
    )

    # ── NRI forecast scaffold (spec §15.4) — cheap pass-1 block ────────────
    # Only NRI-family packages declare `threshold_forecast_rest`; every other
    # package's context is untouched. The scaffold is attached BEFORE the
    # first evaluate so the ordinary rest path (Task 3) can read the shared
    # actionability rule even on ticks that never reach the forecast band.
    eta_filter_min = float(hyperparameters.get("rest_spot_eta_filter_min", 30.0))
    nri_forecast = None
    if "threshold_forecast_rest" in hyperparameters:
        nri_forecast = _forecast_scaffold(
            tick_state=tick_state, route_facts=run_state.route_facts,
            event_plan=run_state.event_plan, sp=scenario.speed_profile,
            eta_filter_min=eta_filter_min,
        )
        context["nri_forecast"] = nri_forecast

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

    # ── Two-pass forecast (NRI early-rest, spec §15.4) ────────────────────
    # Pass 1 (above) is cheap: current-spot actionability only. Only when
    # pass 1's score lands strictly in (threshold_forecast_rest, threshold_fire)
    # — and the current spot is actionable, and we're not in a recovery or a
    # trip edge — do we pay for the expensive future projection (Task 4) and
    # re-evaluate. The re-evaluate's decision_result is what gets persisted.
    if nri_forecast is not None:
        inside_edge = _inside_trip_edge(
            elapsed_seconds=float(tick_state.elapsed_seconds),
            distance_km=tick_state.distance_km,
            route_facts=run_state.route_facts,
            event_plan=run_state.event_plan,
            speed_profile=scenario.speed_profile,
        )
        crs_actionable = bool(nri_forecast["current_rest_spot"]["actionable"])
        if crs_actionable and _forecast_eligible(
            decision_result=decision_result, hyperparameters=hyperparameters,
            recovery_active=context["recovery_active"], inside_edge=inside_edge,
        ):
            def _projected_evaluate(proj_ts, proj_runtime_state):
                proj_ctx = build_adapter_context(proj_ts)
                proj_ctx["simulation_time_sec"] = float(proj_ts.elapsed_seconds)
                proj_ctx["proposal_history"] = []
                proj_ctx["user_action_history"] = []
                proj_ctx["recovery_active"] = False
                # NO nri_forecast key → algorithm uses its native (non-forecast) path,
                # so the projection never recurses and just yields s_total.
                proj_result = _adapter.evaluate(
                    package=package, context=proj_ctx,
                    parameters=parameters, hyperparameters=hyperparameters,
                    history=[], package_runtime_state=proj_runtime_state,
                )
                # nri_forecast.run_forecast's projection loop treats the
                # `evaluate` return as a plain dict (it does
                # `decision["next_package_runtime_state"]` /
                # `decision["scores"]["s_total"]` — see test_nri_forecast.py's
                # `_scripted` helper). `_adapter.evaluate` returns a
                # DecisionResult (pydantic model), which is not subscriptable,
                # so it must be converted here.
                return proj_result.model_dump()

            full_block = run_forecast(
                start_tick_state=tick_state,
                start_tick_index=current_tick,
                current_elapsed_min=float(tick_state.elapsed_seconds) / 60.0,
                current_distance_km=tick_state.distance_km or 0.0,
                event_plan=run_state.event_plan,
                route_facts=run_state.route_facts,
                scenario=scenario,
                run_seed=run_state.run_seed,
                package_runtime_state=run_state.package_runtime_state,
                committed_content=effective_content,
                committed_content_relief=run_state.content_relief,
                evaluate=_projected_evaluate,
                threshold_fire=float(hyperparameters["threshold_fire"]),
                threshold_forecast_rest=float(hyperparameters["threshold_forecast_rest"]),
                threshold_monotony=float(hyperparameters["threshold_monotony"]),
                eta_filter_min=eta_filter_min,
            )
            # Merge future fields onto the scaffold; keep the cheap current_rest_spot
            # (computed once above, identical to what the full block would recompute).
            full_block["current_rest_spot"] = nri_forecast["current_rest_spot"]
            context["nri_forecast"] = full_block
            decision_result = _adapter.evaluate(
                package=package, context=context,
                parameters=parameters, hyperparameters=hyperparameters,
                history=[], package_runtime_state=run_state.package_runtime_state,
            )

    # ── Thread package_runtime_state: store what the algorithm returned ───
    run_state.package_runtime_state = decision_result.next_package_runtime_state

    # ── Fire-control: trip-edge guard (fixbug-0806) ───────────────────────
    # Neutralize a ROUTINE proposal that fired in the first 20 min / last 10 min
    # of the drive, BEFORE the TickEvent is recorded — so no fired proposal ever
    # lands in the log for the edge tick (no de-dup cooldown, no count-cap hit;
    # the next legit trigger after the edge is unaffected). Mirrored in
    # services/preview.iter_preview_ticks. See _apply_trip_edge_guard.
    decision_result = _apply_trip_edge_guard(
        decision_result,
        tick_state=tick_state,
        route_facts=run_state.route_facts,
        event_plan=run_state.event_plan,
        speed_profile=scenario.speed_profile,
    )

    # ── Fire-control: rest-min-gap after a surfaced monotony (spacing) ────────
    # Engine-level spacing guard, sibling of the trip-edge guard above and
    # applied at the SAME point (before the TickEvent is recorded): neutralize a
    # rest_required proposal — forecast REST_FORECAST_FIRE or ordinary REST_FIRE
    # alike — that fired within `rest_min_gap_after_monotony_min` of the moment
    # the driver was last SHOWN a monotony card, so the two proposals don't
    # arrive stacked. Keyed on run_state.last_surfaced_monotony_sec (stamped
    # below when a monotony card actually pauses the run), NOT the raw per-tick
    # fire. Neutralizing pre-record (rather than clearing actionability
    # post-record) is load-bearing — see _apply_rest_min_gap_guard for why a
    # post-record clear would let the count-cap silence the legitimate later
    # rest fire. Mirrored in services/preview.iter_preview_ticks
    # (trip-edge-guard-two-loops).
    decision_result = _apply_rest_min_gap_guard(
        decision_result,
        tick_state=tick_state,
        hyperparameters=hyperparameters,
        last_surfaced_monotony_sec=run_state.last_surfaced_monotony_sec,
    )

    # ── Extract M2 tick evidence fields from tick_state ───────────────────
    # Feature 009: raw_state now carries the tiered {fixed, dynamic, simulated}
    # signals dict (evidence field name kept for TickEvent back-compat — see
    # aica_api.models.log.TickEvent.raw_state, out of scope for this unit).
    raw_state = tick_state.signals or {}
    feature_groups = tick_state.feature_groups
    driver_update = (tick_state.model_extra or {}).get("_driver_update", {})

    # ── Append TickEvent with M2 fields ──────────────────────────────────
    # vehicle_update is no vehicle-signal producer sets `_vehicle_update` on
    # tick_state post-009 (drowsiness/fatigue are simulated driver signals, not
    # vehicle telemetry) — always {}. The TickEvent field itself is kept for
    # evidence-log schema back-compat (see aica_api.models.log.TickEvent).
    trace = TraceEntry(tick_index=current_tick, decision_result=decision_result)
    tick_event = TickEvent(
        kind="tick",
        tick_index=current_tick,
        tick_state=tick_state,
        trace=trace,
        raw_state=raw_state,
        feature_groups=feature_groups,
        driver_update=driver_update,
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

    # ── Fire-control: suppress ROUTINE proposals during active recovery ───────
    # The driver has already accepted a rest and is either driving to the spot or
    # parked at it. A second REST_PROPOSAL is obviously redundant — and so is a
    # MONOTONY proposal (owner review, 2026-08-08): on the way to the spot the
    # driver is already consuming en-route 覚醒支援 content, so offering
    # inattentive-driving content on top of it is incoherent, and after they have
    # committed to stopping there is nothing for it to prevent.
    # The TickEvent (with the fired proposal) is already written to the evidence
    # log above, so the suppressed proposal is still visible in the trace. We just
    # clear the actionability flag so the run continues instead of pausing.
    # NOTE: only these ROUTINE categories are suppressed. Escalation proposals such
    # as SEVERE_INTERVENTION still pause the run even during recovery
    # (per runtime_workflow §7.2).
    _ROUTINE_DURING_RECOVERY = ("REST_PROPOSAL", "MONOTONY_PROPOSAL")
    recovery_active = bool(run_state.recovery and run_state.recovery.active)
    if (
        recovery_active
        and proposal_is_actionable
        and decision_result.result_type in _ROUTINE_DURING_RECOVERY
    ):
        proposal_is_actionable = False

    # ── Fire-control: post-response trigger de-duplication (fixbug-0804) ──────
    # An ACCEPTED or DECLINED/POSTPONED proposal must not immediately re-pause
    # the run with the same category (docs/fixbug-0804-trigger-dedup-plan.md
    # §1, §5). Same shape as the recovery_active gate above: the TickEvent
    # (with the fired proposal) is already written to the evidence log above,
    # so the suppressed proposal is still visible in the evidence trace — we
    # just clear the actionability flag so the run doesn't re-pause on it.
    if proposal_is_actionable and decision_result.selected_category is not None:
        suppression = _derive_response_suppression(
            recorder.run_log.events,
            current_sim_sec=float(tick_state.elapsed_seconds),
            tick_seconds=float(run_state.event_plan.tick_seconds),
        )
        if suppression.get(decision_result.selected_category):
            proposal_is_actionable = False

    # NOTE: the rest-min-gap-after-monotony spacing gate is NOT here — it runs as
    # a trace-neutralizing guard (_apply_rest_min_gap_guard) BEFORE the TickEvent
    # is recorded, next to the trip-edge guard, so the gated fire never counts
    # toward de-dup. See that call site above.

    # Stamp the surfaced-monotony time the moment a monotony card actually
    # pauses the run (post all gates) — the engine's clean anchor for the gate
    # above, recorded only when the driver truly sees it.
    if proposal_is_actionable and decision_result.selected_category == "monotony_prevention":
        run_state.last_surfaced_monotony_sec = float(tick_state.elapsed_seconds)

    if proposal_is_actionable:
        run_state.status = RunStatus.paused
        run_state.pending_proposal = decision_result.proposal.id
        paused = True
        completed = False
    elif recovery_active:
        # Recovery in progress: force playing regardless of M1/M2/completion.
        # The tick engine already prevents distance-based completion during
        # STOPPED phases.
        run_state.status = RunStatus.playing
        paused = False
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


def action(
    run_id: str,
    action_str: str,
    *,
    recovery_option_id: str | None = None,
    rest_spot: RestSpot | None = None,
) -> RunState:
    """Apply a driver action to a paused run.

    Args:
        run_id:              The run identifier.
        action_str:          The action taken (must be in scenario.allowed_actions).
        recovery_option_id:  M7 — required when action_str == "accept_rest" and
                             the scenario has recovery_options.  Must match a
                             RecoveryOption.id in scenario.recovery_options.
        rest_spot:           M7 — required alongside recovery_option_id.  The
                             rest facility the driver will stop at.

    Returns:
        The updated RunState.

    Raises:
        RunNotFoundError:    If run_id is not in the registry.
        ActionNotAllowedError: If the run is not paused, no proposal is pending,
                               the action is not in allowed_actions, or
                               recovery_option_id / rest_spot are missing or
                               invalid for a scenario that has recovery_options.
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
        if scenario.recovery_options:
            # M7: scenario offers recovery options — validate and start recovery.
            option = next(
                (o for o in scenario.recovery_options if o.id == recovery_option_id),
                None,
            )
            if option is None or rest_spot is None:
                raise ActionNotAllowedError(
                    f"accept_rest requires a valid recovery_option_id + rest_spot "
                    f"(got {recovery_option_id!r})."
                )
            run_state.recovery = start_recovery(option, rest_spot)
            new_status = RunStatus.playing
        else:
            # Back-compat: scenario has no recovery menu — accept_rest completes.
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
