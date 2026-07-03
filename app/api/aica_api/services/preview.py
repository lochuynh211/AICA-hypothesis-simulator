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

from typing import Any

import aica_api.algorithms.adapter as _adapter
from aica_api.algorithms.adapter import AlgorithmAdapterError
from aica_api.models.log import ActionEvent, TickEvent, TraceEntry
from aica_api.models.package import PackageManifest
from aica_api.models.run import RecoveryState, RestSpot, RouteFacts
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
) -> dict[str, Any]:
    """Run a headless, non-persisting evaluation and return an InstantResult dict.

    UX-BE (feature 009 UX iteration): *profiles* (partial ``driver``/``anomaly``/
    ``speed`` overrides — same shape as ``CreateRunPlanBody.profiles``) and
    *context_overrides* (``child_passenger``/``familiar_route``/``weather_risk``
    — same shape as ``CreateRunPlanBody.context_overrides``) are applied via the
    SAME ``create_draft``/``_apply_profile_overrides`` machinery a real
    ``POST /api/run-plans`` uses (see routers/run_plans.py), so a preview
    computed with the same overrides as "Open full run" is faithful to it.

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

    # plan_id is deterministic per (package, scenario, overrides, seed) — the
    # draft registry entry is ephemeral, in-memory-only (never touches disk),
    # exactly like a real /api/run-plans draft before a run is created.
    plan_id = f"preview_{package_id}_{scenario_id}_{run_seed}"
    draft = create_draft(
        plan_id=plan_id,
        package=package,
        scenario=scenario,
        presets={},
        parameters={},
        hyperparameters=overrides,
        run_mode="standard",
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
    recovery_taken = False
    peak_score = 0.0
    threshold: float | None = None
    score_series: list[dict[str, Any]] = []

    segments: list[dict[str, Any]] = []
    seg_type: str | None = None
    seg_start_min = 0.0
    last_elapsed_min = 0.0

    completed_min: float | None = None
    error_out: dict[str, Any] | None = None
    rest_spot_out: dict[str, Any] | None = None
    rest_option_out: dict[str, Any] | None = None
    recovery_from_min: float | None = None
    recovery_to_min: float | None = None

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
        if recovery is not None and recovery.active and dynamic.get("motionState") == "STOPPED":
            if recovery_from_min is None:
                recovery_from_min = elapsed_min
            recovery_to_min = elapsed_min

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

        crit_threshold = decision.criteria.get("threshold_fire", decision.criteria.get("threshold_suggest"))
        if crit_threshold is not None:
            threshold = float(crit_threshold)

        # ── Fire-control: actionable proposal? (identical rule to run_manager) ─
        proposal_fired = decision.fire_control.fired and decision.proposal is not None
        proposal_is_actionable = proposal_fired and bool(
            set(decision.proposal.options) & set(effective_scenario.allowed_actions)
        )
        recovery_active_now = bool(recovery and recovery.active)
        if recovery_active_now and proposal_is_actionable and decision.result_type == "REST_PROPOSAL":
            proposal_is_actionable = False

        if proposal_is_actionable and decision.selected_category == "rest_required" and fired_at is None:
            strength = next(
                (c.strength for c in decision.candidates if c.category == "rest_required"),
                None,
            )
            fired_at = {
                "category": decision.selected_category,
                "strength": strength,
                "tick": tick_index,
                "time_min": elapsed_min,
            }

        if proposal_is_actionable:
            can_accept = (
                not recovery_taken
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
                    rest_spot_out = {
                        "at_km": spot.route_fraction * total_km,
                        "eta_min": dynamic.get("nextRestSpotMin"),
                    }
                    rest_option_out = {
                        "id": option.id,
                        "auto_chosen": True,
                        "recovery_from_min": None,  # filled in once STOPPED is observed
                        "to_min": None,
                    }
                    recovery = start_recovery(option, spot)
                    recovery_taken = True
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
            elif not effective_scenario.recovery_options and "accept_rest" in decision.proposal.options and not recovery_taken and decision.selected_category == "rest_required":
                # Back-compat (run_manager.action()): a scenario with no recovery
                # menu completes the run immediately on accept_rest.
                recovery_taken = True
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

    if rest_option_out is not None:
        rest_option_out["recovery_from_min"] = recovery_from_min
        rest_option_out["to_min"] = recovery_to_min

    fired = fired_at is not None and error_out is None

    return {
        "fired": fired,
        "fire": fired_at if fired else None,
        "peak_score": peak_score,
        "threshold": threshold,
        "score_series": score_series,
        "segments": segments,
        "rest_spot": rest_spot_out,
        "rest_option": rest_option_out,
        "completed_min": completed_min,
        "seed": run_seed,
        "overrides": overrides_out,
        "error": error_out,
    }
