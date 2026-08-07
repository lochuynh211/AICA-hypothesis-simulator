"""Ephemeral instant-result preview service (feature 009, US1).

Computes the setup screen's Instant-Result strip: a headless, NON-persisting
evaluation of a ``RunConfig`` that runs the full tick loop through the SAME
tick engine + algorithm adapter as a persisted run (see run_manager.py), and
returns an ``InstantResult`` (data-model.md §7).

Design constraints (contracts/ephemeral-evaluate.md):
  - No persistence: the EvidenceRecorder is never constructed or invoked, and
    nothing is written under runs_dir.  This module does not import
    EvidenceRecorder at all.
  - Faithful to a real run: the tick loop reuses tick_engine.advance_tick +
    algorithms.adapter.evaluate exactly as run_manager.tick() does, threading
    package_runtime_state and recovery state the same way.
  - Deterministic: same RunConfig (incl. run_seed) -> identical InstantResult.
  - Errors surfaced, never faked: an AlgorithmAdapterError populates `error`
    and halts the preview; `fired` is never fabricated.
  - User actions are driven by a deterministic auto-choice, and ONLY for the
    rest category: each actionable "rest_required" proposal is accepted
    (auto-picking a recovery option + the nearest ahead rest spot), or declined
    when it cannot be, so the run resolves end-to-end without a human in the
    loop. A MONOTONY proposal is acknowledged — taken up — which is what the
    projection then renders for it, and what the merged run records when the
    reviewer picks a service for one. Both sides must model the same driver, or
    the projection disagrees with the run it is supposed to project.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import aica_api.algorithms.adapter as _adapter
from aica_api.algorithms.adapter import AlgorithmAdapterError
from aica_api.models.decision import DecisionResult
from aica_api.models.log import ActionEvent, TickEvent, TraceEntry
from aica_api.models.package import PackageManifest
from aica_api.models.run import DisplayRoute, RecoveryState, RestSpot, RouteFacts, TickState
from aica_api.models.scenario import ScenarioDef
from aica_api.services.package_registry import PackageRegistry
from aica_api.services.recovery import start_recovery
from aica_api.services.run_manager import (
    _derive_history,
    _derive_response_suppression,
    resolve_manifest_defaults,
)
from aica_api.services.run_plan import create_draft, get_draft_entry, validate_context_overrides
from aica_api.services.scenario_registry import ScenarioRegistry
from aica_api.services.tick_engine import advance_tick, build_adapter_context

# Generous ceiling — real UC-01 routes complete within a few hundred ticks
# (see tests/test_end_to_end_run.py's _MAX_TICKS=400). This is a safety net
# against a pathological package/scenario combination that never completes.
_MAX_PREVIEW_TICKS = 2000


class PreviewValidationError(Exception):
    """Raised for a setup that cannot be previewed (bad ids, incompatible
    scenario, invalid hyperparameter overrides, old-shape scenario, ...).

    The router converts this to a 4xx response with a clear message.
    """


@dataclass
class PreviewFireEvent:
    """One actionable-proposal EPISODE (rising edge), surfaced by
    ``iter_preview_ticks`` for reuse by callers other than ``evaluate_preview``
    (feature 020's merged-simulator quickview, slice 2c).

    Yielded exactly where ``evaluate_preview``'s loop marks a new trigger
    episode — a rising edge, or a change of fired category — i.e. once per
    distinct actionable run (a long route can yield several), not once per tick.
    ``decision.proposal`` is guaranteed non-None on every yielded event.
    ``rest_spot`` is the nearest named/synthetic rest spot ahead of the
    vehicle's current position at this tick (same rule `/api/runs/{id}/
    rest-spots` and the auto-accept step use) — None if none is ahead.
    """

    tick_index: int
    tick_state: TickState
    decision: DecisionResult
    elapsed_min: float
    route_facts: RouteFacts
    effective_scenario: ScenarioDef
    rest_spot: RestSpot | None


# Mirrors `_REST_SPOTS_MIN_AHEAD_KM` in routers/runs.py — the quickview must
# offer the same spots the live run would, or the projection misrepresents it.
_PREVIEW_REST_MIN_AHEAD_KM = 1.0


def _pick_rest_spot(route_facts: RouteFacts, current_distance_km: float) -> RestSpot | None:
    """Deterministically pick the nearest rest spot ahead of the current position.

    Mirrors the "first ahead, sorted by position" rule used by the
    /api/runs/{id}/rest-spots endpoint (routers/runs.py), simplified: the
    preview only needs ONE spot to hand to start_recovery(), not the full
    spaced/capped candidate list a human picks from.
    """
    total_km = route_facts.total_route_distance_km or 120.0

    named = [s for s in route_facts.named_rest_spots if not s.synthetic]
    if named:
        candidates = [(s.position_km, s.name) for s in named]
    else:
        candidates = [
            (pos_km, f"Rest stop {i + 1}")
            for i, pos_km in enumerate(route_facts.rest_spot_positions)
        ]

    # Far enough ahead that the journey TO the rest spot is visible in the
    # projection — same rule (and same fallback) as the rest-spots endpoint, so
    # the quickview and the live run offer comparable spots.
    ahead = sorted(
        (km, name)
        for km, name in candidates
        if km > current_distance_km + _PREVIEW_REST_MIN_AHEAD_KM
    )
    if not ahead:
        ahead = sorted((km, name) for km, name in candidates if km > current_distance_km)
    if not ahead:
        return None

    km, name = ahead[0]
    route_fraction = min(1.0, km / total_km) if total_km else 1.0
    return RestSpot(
        id="preview_auto_rest",
        label={"ja": name, "en": name},
        route_fraction=route_fraction,
    )


def _km_to_min(frac: float, progress: list[dict]) -> float | None:
    """Map a route-fraction to elapsed minutes via the real per-tick progress
    curve (first-crossing linear interpolation).

    ``progress`` is the tick loop's list of ``{"t","min","frac"}`` samples, with
    non-decreasing ``frac`` (distance is monotonic; parked ticks repeat a frac).
    Returns None when ``progress`` is empty. A ``frac`` at/after the last sample
    clamps to the last sample's minute (the route completed).

    This is why a km-authored jam's minute-axis display is FAITHFUL: routes are
    not time-linear in distance (segment speeds vary, rests stop the clock), so
    a ``km/speed`` formula would be wrong — the real time↔distance relationship
    is exactly this sampled curve.
    """
    if not progress:
        return None
    prev = progress[0]
    if frac <= prev["frac"]:
        return prev["min"]
    for cur in progress[1:]:
        if cur["frac"] >= frac:
            span = cur["frac"] - prev["frac"]
            if span <= 0:
                return cur["min"]
            ratio = (frac - prev["frac"]) / span
            return prev["min"] + ratio * (cur["min"] - prev["min"])
        prev = cur
    return progress[-1]["min"]


def _resolve_package_and_scenario(
    package_id: str,
    scenario_id: str,
    packages_dir,
    scenarios_dir,
) -> tuple[PackageManifest, ScenarioDef]:
    """Resolve + validate compatibility. Raises PreviewValidationError on any issue.

    ScenarioRegistry.get() returns None both for an unknown scenario_id AND for
    a scenario file that failed Pydantic validation during the registry scan
    (e.g. an old-shape driver_profile/vehicle_profile scenario, FR-017) — so
    this single None-check covers both "not found" and "incompatible shape".
    """
    package = PackageRegistry(packages_dir).get(package_id)
    if package is None:
        raise PreviewValidationError(f"Package {package_id!r} not found or invalid")

    sc_reg = ScenarioRegistry(scenarios_dir)
    scenario = sc_reg.get(scenario_id)
    if scenario is None:
        raise PreviewValidationError(
            f"Scenario {scenario_id!r} not found or invalid (unknown id, or "
            "incompatible old-shape scenario — re-author with driver_signal_params "
            "and anomaly_signal_params)."
        )

    if not sc_reg.is_compatible(scenario, package):
        raise PreviewValidationError(
            f"Package {package_id!r} is not compatible with scenario "
            f"{scenario_id!r} (type={scenario.type!r})"
        )

    return package, scenario



def _stable_pin_key(initial_state: dict | None, context_overrides: dict | None) -> str:
    """Short deterministic digest of the setup pins, for the draft-cache key.

    Unpinned previews collapse to "base", so they keep the exact key they had
    before pins were threaded and behave identically.
    """
    payload = {"i": initial_state or {}, "c": context_overrides or {}}
    if not payload["i"] and not payload["c"]:
        return "base"
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:10]


def iter_preview_ticks(
    *,
    package_id: str,
    scenario_id: str,
    hyperparameter_overrides: dict[str, Any] | None,
    run_seed: int,
    rest_option_id: str | None,
    packages_dir,
    scenarios_dir,
    profiles: dict[str, Any] | None = None,
    context_overrides: dict[str, Any] | None = None,
    initial_state: dict[str, Any] | None = None,
    route_source: str = "local",
    route_facts: Any = None,
    display_route: Any = None,
    presets: dict[str, Any] | None = None,
) -> Iterator[PreviewFireEvent]:
    """Run the headless, non-persisting preview tick loop, yielding a
    ``PreviewFireEvent`` at each new actionable-proposal episode (rising edge).

    This is the extracted engine behind ``evaluate_preview`` (feature 020,
    slice 2c) — a reusable generator so a caller other than ``evaluate_preview``
    (e.g. the merged simulator's quickview projection) can hook a proposal at
    each fire without re-running or duplicating the trigger tick loop.

    Setup (package/scenario resolution, overrides validation, draft creation,
    route selection) is identical to — and raises the SAME
    ``PreviewValidationError`` as — the pre-extraction ``evaluate_preview``.
    Because generator bodies are lazy, setup only actually runs (and can only
    raise) once the FIRST item is pulled (the immediate ``for`` in
    ``evaluate_preview`` below does this right away, so the exception still
    surfaces before ``evaluate_preview`` returns, exactly as before).

    UX-BE (feature 009 UX iteration): *profiles* (partial ``driver``/``anomaly``/
    ``speed`` overrides — same shape as ``CreateRunPlanBody.profiles``) and
    *context_overrides* (``child_passenger``/``familiar_route``/``weather_risk``
    — same shape as ``CreateRunPlanBody.context_overrides``) are applied via the
    SAME ``create_draft``/``_apply_profile_overrides`` machinery a real
    ``POST /api/run-plans`` uses (see routers/run_plans.py), so a preview
    computed with the same overrides as "Open full run" is faithful to it.

    On normal completion this generator's ``return`` value (retrievable as
    ``StopIteration.value`` when driven manually, as ``evaluate_preview`` does)
    is the SAME ``InstantResult`` dict ``evaluate_preview`` used to build and
    return directly before this extraction — that accumulation (fires,
    score_series, segments, rest_spots, ...) still happens tick-by-tick here,
    unchanged; the generator both yields fire notifications AND returns the
    full accumulated result, so `evaluate_preview` needs no bookkeeping of its
    own to stay byte-identical.

    *presets* (feature 020, Slice-2c — additive, ``None`` by default): the
    same ``presets`` shape ``create_draft``/``POST /api/run-plans`` accepts
    (e.g. ``{"traffic_events": [...]}``), forwarded verbatim to
    ``create_draft``. This lets a caller other than ``evaluate_preview``
    (the merged simulator's quickview projection, which paints an ad-hoc
    traffic jam via ``services/merged_painter.py::jam_traffic_event`` the
    SAME way ``POST /api/merged-runs/plan`` does) drive a jam-painted
    preview. ``None`` (every existing caller — ``evaluate_preview``,
    ``POST /api/runs/preview``) resolves to ``{}``, the exact value
    hardcoded at this call site before *presets* existed, so this addition
    changes nothing for any pre-existing caller.

    Raises:
        PreviewValidationError: unknown/incompatible package or scenario, an
            old-shape scenario, invalid hyperparameter overrides, invalid
            profile overrides, or invalid context overrides.
    """
    overrides = dict(hyperparameter_overrides or {})

    package, scenario = _resolve_package_and_scenario(
        package_id, scenario_id, packages_dir, scenarios_dir
    )

    # Validate context_overrides BEFORE create_draft — mirrors routers/run_plans.py
    # (validated ahead of create_draft there too), and create_draft itself does
    # not validate context_overrides (it applies them via a blind model_copy).
    if context_overrides:
        ctx_errors = validate_context_overrides(context_overrides)
        if ctx_errors:
            raise PreviewValidationError(
                "Invalid context overrides: "
                + "; ".join(f"{e['field']}: {e['message']}" for e in ctx_errors)
            )

    # Selected Maps/preset route — coerce raw dicts to models and honor it only
    # when route_source=="maps" (mirrors routers/run_plans.py, which discards
    # client-supplied route facts on the local path and re-derives locally).
    selected_route_facts: RouteFacts | None = None
    selected_display_route: DisplayRoute | None = None
    if route_source == "maps":
        if route_facts is None:
            raise PreviewValidationError(
                "route_facts is required when route_source is 'maps'."
            )
        selected_route_facts = (
            route_facts if isinstance(route_facts, RouteFacts) else RouteFacts.model_validate(route_facts)
        )
        if display_route is not None:
            selected_display_route = (
                display_route if isinstance(display_route, DisplayRoute)
                else DisplayRoute.model_validate(display_route)
            )

    # plan_id is deterministic per (package, scenario, overrides, seed, route) —
    # the draft registry entry is ephemeral, in-memory-only (never touches disk),
    # exactly like a real /api/run-plans draft before a run is created. The route
    # source is folded into the id so switching routes can't collide on a cached
    # draft key.
    route_key = selected_route_facts.route_source if selected_route_facts else "local"
    # The pins participate in the draft key: two quickviews differing only by
    # initial drowsiness/fatigue or a context override are DIFFERENT projections,
    # and a shared key would serve one draft for the other.
    pin_key = _stable_pin_key(initial_state, context_overrides)
    plan_id = f"preview_{package_id}_{scenario_id}_{run_seed}_{route_key}_{pin_key}"
    draft = create_draft(
        plan_id=plan_id,
        package=package,
        scenario=scenario,
        presets=presets or {},
        parameters={},
        hyperparameters=overrides,
        run_mode="standard",
        route_facts=selected_route_facts,
        route_source=route_source,
        display_route=selected_display_route,
        profiles=profiles,
        context_overrides=context_overrides,
        initial_state=initial_state,
    )
    if draft.validation_errors:
        raise PreviewValidationError(
            "Invalid setup overrides: "
            + "; ".join(f"{e['field']}: {e['message']}" for e in draft.validation_errors)
        )

    # Fetch the registered (draft, package, effective_scenario) triple — same
    # as run_manager.create_run does — so any profile/initial_state overrides
    # baked into create_draft (none for /preview today, but future-proof) are
    # honored identically to a persisted run.
    entry = get_draft_entry(plan_id)
    assert entry is not None  # create_draft always registers on the success path
    _draft, package, effective_scenario = entry

    route_facts = draft.route_facts
    event_plan = draft.draft_event_plan

    default_hps = {hp.key: hp.default for hp in package.hyperparameters}
    hyperparameters = resolve_manifest_defaults(default_hps, overrides)
    parameters = {p.key: p.default for p in package.parameters}

    # Overrides diff: only keys that are BOTH declared on the manifest AND
    # actually changed from default (defensive — do not trust the caller's
    # dict to already be filtered).
    overrides_out = [
        {"key": key, "default": default_hps[key], "value": value}
        for key, value in overrides.items()
        if key in default_hps and default_hps[key] != value
    ]

    # ── Tick loop state (mirrors run_manager's in-memory registry entry) ────
    prior_tick_state = None
    package_runtime_state: dict[str, Any] = {}
    recovery: RecoveryState | None = None
    events: list[Any] = []  # TickEvent | ActionEvent, in-memory only — never persisted

    fired_at: dict[str, Any] | None = None
    # Distinct trigger EPISODES over the whole run (like the Review timeline, which
    # marks each proposal that fired+paused). Rising-edge, category-agnostic: a
    # continuous run of actionable ticks — even if the winning category flips
    # rest↔monotony within it — is ONE marker, not one per tick. A new marker only
    # after actionability lapses (the run "resumes") and fires again.
    fires: list[dict[str, Any]] = []
    # The category of the episode currently in progress, or None when nothing
    # actionable is in flight. Holding the CATEGORY (not just a bool) is what
    # lets a monotony → rest escalation on consecutive ticks split into two.
    fire_active: str | None = None
    peak_score = 0.0
    threshold: float | None = None
    score_series: list[dict[str, Any]] = []
    # Anomaly spikes — ticks where the seeded-Poisson generator fired an event.
    # Detected from tick_state.anomaly_events: the generator appends `tick_index`
    # on a spike, so a spike at tick i is exactly `i in anomaly_events`. Marked on
    # the timeline so a reviewer can point at a spike and see the rest-propose
    # curve step up right after it (the spike raises driving_anomaly → base risk).
    spikes: list[dict[str, Any]] = []
    # Second curve — the hybrid's monotony-prevention score/threshold. Stays empty
    # for algorithms (e.g. NRI) that emit no `monotony_prevention_score`.
    monotony_series: list[dict[str, Any]] = []
    monotony_threshold: float | None = None

    segments: list[dict[str, Any]] = []
    seg_type: str | None = None
    seg_start_min = 0.0
    last_elapsed_min = 0.0

    completed_min: float | None = None
    error_out: dict[str, Any] | None = None
    # Every auto-accepted rest across the run (a real reviewer accepts each rest,
    # which resets fatigue → a handful of triggers, not dozens). rest_spots/
    # rest_options are the full lists; rest_spot/rest_option keep the FIRST for
    # back-compat. recovery_from_min/to_min of the LAST-accepted option are filled
    # from its STOPPED ticks as the loop runs.
    rest_spots_out: list[dict[str, Any]] = []
    rest_options_out: list[dict[str, Any]] = []

    # Per-tick route-progress map (feature 020 — trigger-point alignment): pairs
    # each tick's elapsed MINUTE with its DISTANCE route_fraction so a distance-axis
    # consumer (the Combined Simulator's quickview, which must line its fires up
    # with the distance-axis live animation) can remap any minute/tick x-coordinate
    # onto the distance axis. Distance is FLAT across a stopped rest (car parked,
    # time keeps advancing), so a rest that spans many minutes collapses to a single
    # route position — exactly what the live animation shows. Additive; the trigger
    # screen's own strip ignores it and stays on the time axis.
    route_total_km = route_facts.total_route_distance_km or 120.0
    progress: list[dict[str, Any]] = []

    for tick_index in range(_MAX_PREVIEW_TICKS):
        tick_state = advance_tick(
            prior_tick_state,
            tick_index,
            event_plan,
            route_facts,
            effective_scenario,
            recovery=recovery,
            run_seed=run_seed,
        )
        rec_next = (tick_state.model_extra or {}).get("_recovery_next")

        dynamic = (tick_state.signals or {}).get("dynamic", {})
        elapsed_min = tick_state.elapsed_seconds / 60.0

        # ── Track recovery-in-progress span (STOPPED ticks of the CURRENT
        #    recovery, using the PRE-tick recovery state — same state advance_tick
        #    itself used to decide this tick's motion_state) ────────────────
        if recovery is not None and recovery.active and dynamic.get("motionState") == "STOPPED" and rest_options_out:
            cur = rest_options_out[-1]
            if cur["recovery_from_min"] is None:
                cur["recovery_from_min"] = elapsed_min
            cur["to_min"] = elapsed_min
            # Stash the LATEST stopped-tick state so the merged quickview can
            # project an AFTER-REST proposal from the recovered driver state
            # (feature 020 — clickable purple/green journey dots). Overwritten
            # every stopped tick, so it lands on the last one before the driver
            # resumes (the recovered drowsiness/fatigue). A private key stripped
            # by merged_quickview before the model is built (trigger-only
            # InstantResult never sees it — it's discarded when never read).
            cur["_post_rest_tick_state"] = tick_state

        if rec_next is not None:
            recovery = rec_next if rec_next.active else None

        # ── Route segments (collapse contiguous same-type runs) ────────────
        cur_seg_type = dynamic.get("segmentType")
        if seg_type is None:
            seg_type = cur_seg_type
            seg_start_min = 0.0
        elif cur_seg_type != seg_type:
            segments.append({"type": seg_type, "from_min": seg_start_min, "to_min": last_elapsed_min})
            seg_type = cur_seg_type
            seg_start_min = last_elapsed_min
        last_elapsed_min = elapsed_min

        # ── Completion (route fully driven, no recovery still holding position) ─
        if tick_state.completed and not (recovery and recovery.active):
            completed_min = elapsed_min
            break

        # ── Build adapter context (identical to run_manager.tick()) ────────
        context = build_adapter_context(tick_state)
        context["simulation_time_sec"] = float(tick_state.elapsed_seconds)
        proposal_history, user_action_history = _derive_history(
            events,
            tick_seconds=float(event_plan.tick_seconds),
            current_sim_sec=float(tick_state.elapsed_seconds),
        )
        context["proposal_history"] = proposal_history
        context["user_action_history"] = user_action_history
        context["recovery_active"] = bool(recovery and recovery.active)

        try:
            decision = _adapter.evaluate(
                package=package,
                context=context,
                parameters=parameters,
                hyperparameters=hyperparameters,
                history=[],
                package_runtime_state=package_runtime_state,
            )
        except AlgorithmAdapterError as exc:
            error_out = {
                "tick_index": tick_index,
                "error_type": exc.error_type,
                "message": exc.message,
            }
            break

        package_runtime_state = decision.next_package_runtime_state

        events.append(
            TickEvent(
                kind="tick",
                tick_index=tick_index,
                tick_state=tick_state,
                trace=TraceEntry(tick_index=tick_index, decision_result=decision),
                raw_state=tick_state.signals or {},
                feature_groups=tick_state.feature_groups,
                package_runtime_state=decision.next_package_runtime_state,
            )
        )

        # ── Score series (rest_required_score per tick) ─────────────────────
        score = decision.scores.get("rest_required_score")
        if score is None:
            score = decision.score if decision.score is not None else 0.0
        score = float(score)
        score_series.append({"t": tick_index, "score": score})
        peak_score = max(peak_score, score)

        # Route-progress point for THIS tick (see `progress` init above). Distance
        # is clamped to [0, 1]; a parked (recovery) tick advances `min` but not `frac`.
        route_fraction = (
            min(1.0, max(0.0, (tick_state.distance_km or 0.0) / route_total_km)) if route_total_km else 0.0
        )
        progress.append({"t": tick_index, "min": elapsed_min, "frac": route_fraction})

        # ── Anomaly spike marker (aligned with the score point above) ──────
        if tick_index in (tick_state.anomaly_events or []):
            spikes.append({"t": tick_index, "time_min": elapsed_min})

        # The score_series plots the NORMALIZED rest_required_score (0-1), so the
        # threshold line must be on the same scale: prefer the normalized
        # `rest_required_threshold` (NRI), then the hybrid's already-0-1
        # `threshold_suggest`.  `threshold_fire` (raw s_total scale) is a last resort
        # only — pairing it with a 0-1 curve flattens the plot.
        crit = decision.criteria
        crit_threshold = crit.get("rest_required_threshold")
        if crit_threshold is None:
            crit_threshold = crit.get("threshold_suggest", crit.get("threshold_fire"))
        if crit_threshold is not None:
            threshold = float(crit_threshold)

        # ── Second curve: monotony-prevention (algorithms that score it) ────
        # An algorithm with no `monotony_prevention_score` leaves the series
        # empty → the strip renders a single rest-required curve.
        mono_score = decision.scores.get("monotony_prevention_score")
        if mono_score is not None:
            monotony_series.append({"t": tick_index, "score": float(mono_score)})

        # ── Monotony threshold — read INDEPENDENTLY of the curve ────────────
        # This used to be nested inside the `mono_score is not None` branch, which
        # silently assumed a monotony threshold only exists where a monotony
        # CURVE does. NRI breaks that assumption by design: it bands ONE score
        # with two thresholds (rest above, monotony below), so it publishes a
        # monotony threshold and no second curve — emitting one would just draw a
        # duplicate of the rest curve on top of itself. Nested, its rule was
        # dropped and the strip showed a monotony fire with nothing to fire against.
        mono_crit = decision.criteria.get("monotony_suggest_threshold")
        if mono_crit is not None:
            monotony_threshold = float(mono_crit)

        # ── Fire-control: actionable proposal? (identical rule to run_manager) ─
        proposal_fired = decision.fire_control.fired and decision.proposal is not None
        proposal_is_actionable = proposal_fired and bool(
            set(decision.proposal.options) & set(effective_scenario.allowed_actions)
        )
        recovery_active_now = bool(recovery and recovery.active)
        if recovery_active_now and proposal_is_actionable and decision.result_type == "REST_PROPOSAL":
            proposal_is_actionable = False

        # ── Fire-control: post-response trigger de-duplication (fixbug-0804) ──
        # Mirrors the SAME centralized gate run_manager.tick() applies right
        # after its own recovery_active gate (see docs/fixbug-0804-trigger-
        # dedup-plan.md §5) — an accepted/declined proposal must not
        # immediately re-fire the quickview projection, exactly as it no
        # longer re-pauses the live run. Reuses run_manager's pure helper
        # unchanged (not duplicated) against this loop's own in-memory
        # `events` list, which is built from the SAME TickEvent/ActionEvent
        # shapes `_derive_history` above already consumes. The current tick's
        # TickEvent was just appended above, but its own action (if any) is
        # recorded further below — so this call only ever sees PRIOR
        # proposals paired with PRIOR actions, never a spurious self-match.
        if proposal_is_actionable and decision.selected_category is not None:
            suppression = _derive_response_suppression(
                events,
                current_sim_sec=float(tick_state.elapsed_seconds),
                tick_seconds=float(event_plan.tick_seconds),
            )
            if suppression.get(decision.selected_category):
                proposal_is_actionable = False

        # Trigger capture — one marker per actionable EPISODE, matching the Review
        # timeline where the run pauses once per proposal then resumes. An episode
        # starts on a rising edge (nothing actionable → actionable) OR when the
        # fired CATEGORY changes, so a long route shows a handful of triggers
        # rather than one per tick.
        #
        # The category clause is load-bearing: this used to be purely
        # category-agnostic, and a run that escalates monotony → rest on
        # CONSECUTIVE ticks (the normal shape now that both packages fire two
        # categories) was collapsed into a single monotony marker. The rest
        # proposal — the consequential one — never appeared on the strip at all.
        if proposal_is_actionable:
            if decision.selected_category != fire_active:  # new episode
                strength = next(
                    (c.strength for c in decision.candidates if c.category == decision.selected_category),
                    None,
                )
                fire = {
                    "category": decision.selected_category,
                    "strength": strength,
                    "tick": tick_index,
                    "time_min": elapsed_min,
                    "feature_contributions": decision.feature_contributions,
                    "criteria": decision.criteria,
                }
                fires.append(fire)
                if fired_at is None:
                    fired_at = fire  # first trigger — kept for the result-line/back-compat
                # Rising edge — a fresh trigger episode. Reusable notification
                # for callers other than evaluate_preview (feature 020 slice 2c);
                # evaluate_preview itself ignores yielded values (see below).
                yield PreviewFireEvent(
                    tick_index=tick_index,
                    tick_state=tick_state,
                    decision=decision,
                    elapsed_min=elapsed_min,
                    route_facts=route_facts,
                    effective_scenario=effective_scenario,
                    rest_spot=_pick_rest_spot(route_facts, tick_state.distance_km or 0.0),
                )
            fire_active = decision.selected_category
        else:
            fire_active = None

        if proposal_is_actionable:
            # Accept EACH rest proposal (not just the first) — but never while a
            # recovery is still running (that proposal is already suppressed above).
            can_accept = (
                not (recovery and recovery.active)
                and decision.selected_category == "rest_required"
                and bool(effective_scenario.recovery_options)
                and "accept_rest" in decision.proposal.options
            )
            if can_accept:
                option = next(
                    (o for o in effective_scenario.recovery_options if o.id == rest_option_id),
                    None,
                ) if rest_option_id else None
                if option is None:
                    option = effective_scenario.recovery_options[0]

                spot = _pick_rest_spot(route_facts, tick_state.distance_km or 0.0)
                if spot is not None:
                    total_km = route_facts.total_route_distance_km or 120.0
                    rest_spots_out.append({
                        "at_km": spot.route_fraction * total_km,
                        "eta_min": dynamic.get("nextRestSpotMin"),
                    })
                    rest_options_out.append({
                        "id": option.id,
                        "auto_chosen": True,
                        "recovery_from_min": None,  # filled in once STOPPED is observed
                        "to_min": None,
                    })
                    recovery = start_recovery(option, spot)
                    events.append(
                        ActionEvent(
                            kind="action",
                            tick_index=tick_index,
                            action="accept_rest",
                            resulting_status="playing",
                        )
                    )
                else:
                    # No rest spot ahead of the current position — nothing to
                    # recover at; decline like any other unfulfillable proposal.
                    decline = "decline" if "decline" in decision.proposal.options else decision.proposal.options[0]
                    events.append(
                        ActionEvent(kind="action", tick_index=tick_index, action=decline, resulting_status="playing")
                    )
            elif not effective_scenario.recovery_options and "accept_rest" in decision.proposal.options and not rest_options_out and decision.selected_category == "rest_required":
                # Back-compat (run_manager.action()): a scenario with no recovery
                # menu completes the run immediately on accept_rest.
                completed_min = elapsed_min
                events.append(
                    ActionEvent(kind="action", tick_index=tick_index, action="accept_rest", resulting_status="completed")
                )
                break
            elif decision.selected_category == "rest_required":
                # A rest proposal this loop cannot accept (e.g. one fired during
                # an active recovery) is still ANSWERED — the auto-drive's job is
                # to resolve rest proposals so the run reaches its end.
                decline = "decline" if "decline" in decision.proposal.options else decision.proposal.options[0]
                events.append(
                    ActionEvent(kind="action", tick_index=tick_index, action=decline, resulting_status="playing")
                )
            elif "acknowledge" in decision.proposal.options:
                # A MONOTONY proposal is TAKEN UP — the projected driver accepts
                # the content, which is what the projection then renders (the
                # service and song list attached to this fire).
                #
                # Recording it matters beyond bookkeeping: the response reaches
                # the algorithm through `proposal_history.lastProposalResult`,
                # which is what lets the Hybrid rebaseline its monotony
                # accumulator. Without it the monotony score climbed for a whole
                # run and nothing the driver did ever brought it down.
                #
                # It must be `acknowledge`, not the `decline` this used to
                # record: declining is the driver refusing the content, and it
                # is not what the projection goes on to display. The merged run
                # records the same acknowledge when the reviewer picks a service
                # for a monotony opportunity, so the projection and the run model
                # the same driver.
                events.append(
                    ActionEvent(kind="action", tick_index=tick_index,
                                action="acknowledge", resulting_status="playing")
                )

        prior_tick_state = tick_state

    # Close the final open segment.
    if seg_type is not None:
        segments.append({"type": seg_type, "from_min": seg_start_min, "to_min": last_elapsed_min})

    fired = fired_at is not None and error_out is None

    # Traffic-jam ranges (minutes, same axis as `segments`) — derived directly
    # from the event plan's traffic_events, NOT by re-scanning ticks. Feeds the
    # Combined Simulator's jam sub-bar (feature 020). `_active_traffic_jam` uses
    # the identical `start_min <= elapsed_min < start_min + duration_min` axis
    # as a fallback; when an event carries `start_km`/`end_km` (position-native
    # jams painted via RouteConditionsPainter), `from_frac`/`to_frac` are derived
    # DIRECTLY from km — bypassing the (potentially jam-distorted) minute→frac
    # remap entirely, which is the fix for the wrong sub-bar position/width.
    def _jam_frac(km: float | None) -> float | None:
        if km is None:
            return None
        return max(0.0, min(1.0, km / route_total_km)) if route_total_km else None

    traffic_jams = []
    for ev in event_plan.traffic_events:
        from_frac = _jam_frac(ev.start_km)
        to_frac = _jam_frac(ev.end_km)
        if from_frac is not None and to_frac is not None:
            # km is the source of truth: derive the minute axis from the real
            # progress curve so the trigger setup strip (minute axis) and the
            # Combined chart (distance axis) agree, both grounded in km.
            from_min = _km_to_min(from_frac, progress)
            to_min = _km_to_min(to_frac, progress)
        else:
            # Legacy time-only jam (Maps/route-preset path, painter fallback).
            from_min = ev.start_min
            to_min = (
                (ev.start_min + ev.duration_min)
                if ev.start_min is not None and ev.duration_min is not None
                else None
            )
        traffic_jams.append(
            {
                "from_min": from_min,
                "to_min": to_min,
                "from_frac": from_frac,
                "to_frac": to_frac,
            }
        )

    return {
        "fired": fired,
        "fire": fired_at if fired else None,
        # All triggers across the run (empty on error) — first entry == `fire`.
        "fires": fires if error_out is None else [],
        "peak_score": peak_score,
        "threshold": threshold,
        "score_series": score_series,
        "progress": progress,
        "spikes": spikes if error_out is None else [],
        "monotony_series": monotony_series,
        "monotony_threshold": monotony_threshold,
        "segments": segments,
        "traffic_jams": traffic_jams,
        # First-accepted rest kept as rest_spot/rest_option for back-compat; the
        # full lists let the strip mark every rest stop taken over the route.
        "rest_spot": rest_spots_out[0] if rest_spots_out else None,
        "rest_option": rest_options_out[0] if rest_options_out else None,
        "rest_spots": rest_spots_out,
        "rest_options": rest_options_out,
        "completed_min": completed_min,
        "seed": run_seed,
        "overrides": overrides_out,
        "error": error_out,
    }


def evaluate_preview(
    *,
    package_id: str,
    scenario_id: str,
    hyperparameter_overrides: dict[str, Any] | None,
    run_seed: int,
    rest_option_id: str | None,
    packages_dir,
    scenarios_dir,
    profiles: dict[str, Any] | None = None,
    context_overrides: dict[str, Any] | None = None,
    route_source: str = "local",
    route_facts: Any = None,
    display_route: Any = None,
) -> dict[str, Any]:
    """Run a headless, non-persisting evaluation and return an InstantResult dict.

    A thin consumer of ``iter_preview_ticks`` (feature 020 slice 2c extraction):
    drives the generator to completion and returns its accumulated result
    unchanged. ``PreviewFireEvent``s yielded along the way are for OTHER
    callers (e.g. the merged simulator's quickview) — this function needs none
    of its own bookkeeping to reproduce the exact same ``InstantResult`` the
    pre-extraction, single-function ``evaluate_preview`` returned.

    Design note — reviewed, intentional deviation from the brief's literal
    "for ev in iter_preview_ticks(...): <append into fires/score_series/...>"
    consumer sketch (``.superpowers/sdd/s2c-task-1-brief.md`` Task 1; recorded
    permanently here — see the "Task 1 review-fix" section of
    ``.superpowers/sdd/s2c-task-1-report.md`` for the full sign-off record —
    so this does not need re-litigating on a future read):

    1. Mechanically, a plain ``for ev in iter_preview_ticks(...): ...`` loop
       cannot ALSO recover the generator's ``return`` value: a ``for`` loop
       silently discards ``StopIteration.value`` (a well-known Python
       generator gotcha). Retrieving the return value requires exactly the
       manual ``next()`` / ``except StopIteration as stop: stop.value``
       pattern used below — the brief's literal sketch is not achievable
       verbatim without giving up the return value.
    2. Several output fields (``score_series``, ``segments``, ``spikes``,
       ``monotony_series``, ``completed_min``, ``error``) are built from
       EVERY tick, not just fire ticks — including two exit paths that never
       reach a computed ``decision`` at all (natural route completion breaks
       before the adapter runs; an ``AlgorithmAdapterError`` breaks right
       after it raises). ``PreviewFireEvent`` only carries fire-episode data,
       so reconstructing those fields from the yielded events HERE would
       require duplicating the generator's tick-loop bookkeeping in a second
       place, with real risk of silently drifting out of "byte-identical"
       over time.

    So this function is deliberately a pure drain-and-return: it advances
    past (consumes) every ``PreviewFireEvent`` ``iter_preview_ticks`` yields
    but keeps no accumulator locals of its own, because the generator itself
    already computed the complete, byte-identical result. That equivalence is
    proven three ways: full-dict ``==`` against a pre-refactor baseline
    (``tests/fixtures/preview_characterization_baseline.json``), the existing
    preview/instant-result suite staying green, and an independent
    re-verification against the true pre-refactor commit (``f5cfb23``)
    checked out in a scratch worktree. Task 3 (merged quickview) is the
    caller that iterates ``iter_preview_ticks`` directly for its own per-fire
    hook, exactly as the brief's consumer pattern describes.

    Raises:
        PreviewValidationError: unknown/incompatible package or scenario, an
            old-shape scenario, invalid hyperparameter overrides, invalid
            profile overrides, or invalid context overrides.
    """
    ticks = iter_preview_ticks(
        package_id=package_id,
        scenario_id=scenario_id,
        hyperparameter_overrides=hyperparameter_overrides,
        run_seed=run_seed,
        rest_option_id=rest_option_id,
        packages_dir=packages_dir,
        scenarios_dir=scenarios_dir,
        profiles=profiles,
        context_overrides=context_overrides,
        route_source=route_source,
        route_facts=route_facts,
        display_route=display_route,
    )
    try:
        while True:
            # Consumed for OTHER callers (merged quickview, see design note
            # above) — evaluate_preview itself needs none of this per-tick
            # data, only the generator's final accumulated return value.
            _fire_event = next(ticks)  # noqa: F841
    except StopIteration as stop:
        result = stop.value
        # Strip the merged-quickview-only recovery-state stash so it never leaks
        # into the trigger-only InstantResult response (models are extra=allow).
        # merged_quickview reads it from its OWN iter_preview_ticks pass; this
        # drain-and-return trigger path must stay byte-identical.
        for opt in result.get("rest_options", []):
            opt.pop("_post_rest_tick_state", None)
        return result
