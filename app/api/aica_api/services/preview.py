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
  - User actions are driven by a deterministic auto-choice: the FIRST
    actionable "rest_required" proposal is accepted (auto-picking a recovery
    option + the nearest ahead rest spot); every other actionable proposal is
    declined so the run resolves end-to-end without a human in the loop.
"""

from __future__ import annotations

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
from aica_api.services.run_manager import _derive_history, resolve_manifest_defaults
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

    Yielded exactly where today's ``evaluate_preview`` loop marks a new
    trigger episode (``if not fire_active:``) — i.e. once per distinct
    actionable run (a long route can yield several), not once per tick.
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
    route_source: str = "local",
    route_facts: Any = None,
    display_route: Any = None,
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
    plan_id = f"preview_{package_id}_{scenario_id}_{run_seed}_{route_key}"
    draft = create_draft(
        plan_id=plan_id,
        package=package,
        scenario=scenario,
        presets={},
        parameters={},
        hyperparameters=overrides,
        run_mode="standard",
        route_facts=selected_route_facts,
        route_source=route_source,
        display_route=selected_display_route,
        profiles=profiles,
        context_overrides=context_overrides,
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
    fire_active = False
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

        # ── Second curve: monotony-prevention (hybrid only) ─────────────────
        # Algorithms without a monotony score (NRI) leave both empty → the strip
        # renders a single rest-required curve.
        mono_score = decision.scores.get("monotony_prevention_score")
        if mono_score is not None:
            monotony_series.append({"t": tick_index, "score": float(mono_score)})
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

        # Trigger capture — one marker per actionable EPISODE (rising edge), matching
        # the Review timeline where the run pauses once per proposal then resumes.
        # Category-agnostic: consecutive actionable ticks (even flipping rest↔monotony)
        # are a single episode, so a long route shows a handful of triggers, not one
        # per tick.
        if proposal_is_actionable:
            if not fire_active:  # rising edge — a fresh trigger episode
                strength = next(
                    (c.strength for c in decision.candidates if c.category == decision.selected_category),
                    None,
                )
                fire = {
                    "category": decision.selected_category,
                    "strength": strength,
                    "tick": tick_index,
                    "time_min": elapsed_min,
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
            fire_active = True
        else:
            fire_active = False

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
            else:
                decline = "decline" if "decline" in decision.proposal.options else decision.proposal.options[0]
                events.append(
                    ActionEvent(kind="action", tick_index=tick_index, action=decline, resulting_status="playing")
                )

        prior_tick_state = tick_state

    # Close the final open segment.
    if seg_type is not None:
        segments.append({"type": seg_type, "from_min": seg_start_min, "to_min": last_elapsed_min})

    fired = fired_at is not None and error_out is None

    return {
        "fired": fired,
        "fire": fired_at if fired else None,
        # All triggers across the run (empty on error) — first entry == `fire`.
        "fires": fires if error_out is None else [],
        "peak_score": peak_score,
        "threshold": threshold,
        "score_series": score_series,
        "spikes": spikes if error_out is None else [],
        "monotony_series": monotony_series,
        "monotony_threshold": monotony_threshold,
        "segments": segments,
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
            next(ticks)
    except StopIteration as stop:
        return stop.value
