"""Run plan service (T020) — draft registry + plan creation/regeneration.

Design:
  - In-memory draft registry keyed by plan_id.
  - create_draft(plan_id, package, scenario, presets, parameters,
    hyperparameters, run_mode) → validates edits, builds draft EventPlan,
    returns RunPlanDraft.  When there are validation errors, the draft is
    returned (for the 400 response body) but NOT stored in the registry.
  - regenerate_draft(plan_id, presets, parameters, hyperparameters) → updated
    draft (same plan_id).
  - get_draft_entry(plan_id) → (RunPlanDraft, PackageManifest, ScenarioDef) | None
  - plan_id is supplied by the caller (router); NOT generated here.
  - Draft-plan generation is pure given (route_facts, presets) — deterministic.
"""

from __future__ import annotations

from typing import Any

from aica_api.models.package import HyperparameterDef, PackageManifest, ParameterDef
from aica_api.models.run import DisplayRoute, RouteFacts, RunPlanDraft
from aica_api.models.scenario import ScenarioDef
from aica_api.services.event_plan import build_event_plan
from aica_api.services.route_analysis import analyze_route

# ---------------------------------------------------------------------------
# In-memory registry
# ---------------------------------------------------------------------------

# Keyed by plan_id: (RunPlanDraft, PackageManifest, ScenarioDef)
_draft_registry: dict[str, tuple[RunPlanDraft, PackageManifest, ScenarioDef]] = {}


def clear_draft_registry() -> None:
    """Clear the in-memory draft registry. Used for test isolation only."""
    _draft_registry.clear()


def get_draft_entry(
    plan_id: str,
) -> tuple[RunPlanDraft, PackageManifest, ScenarioDef] | None:
    """Return the stored draft entry for a plan_id, or None if unknown."""
    return _draft_registry.get(plan_id)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def _validate_parameter(
    key: str,
    value: Any,
    defn: ParameterDef,
) -> list[dict[str, str]]:
    """Validate a single parameter value against its definition."""
    errors: list[dict[str, str]] = []
    if defn.kind == "band":
        allowed = defn.band_values or []
        if value not in allowed:
            errors.append({
                "field": key,
                "message": (
                    f"Value {value!r} is not in allowed values {allowed} "
                    f"for parameter {key!r}."
                ),
            })
    elif defn.kind == "bool":
        if not isinstance(value, bool):
            errors.append({
                "field": key,
                "message": (
                    f"Expected a boolean value for parameter {key!r}, "
                    f"got {type(value).__name__!r}."
                ),
            })
    return errors


def _validate_hyperparameter(
    key: str,
    value: Any,
    defn: HyperparameterDef,
) -> list[dict[str, str]]:
    """Validate a single hyperparameter value against its definition."""
    errors: list[dict[str, str]] = []
    if defn.kind == "band":
        allowed = defn.band_values or []
        if value not in allowed:
            errors.append({
                "field": key,
                "message": (
                    f"Value {value!r} is not in allowed values {allowed} "
                    f"for hyperparameter {key!r}."
                ),
            })
    elif defn.kind == "bool":
        if not isinstance(value, bool):
            errors.append({
                "field": key,
                "message": (
                    f"Expected a boolean value for hyperparameter {key!r}, "
                    f"got {type(value).__name__!r}."
                ),
            })
    elif defn.kind == "numeric":
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            errors.append({
                "field": key,
                "message": (
                    f"Expected a numeric value for hyperparameter {key!r}, "
                    f"got {type(value).__name__!r}."
                ),
            })
        else:
            fval = float(value)
            if defn.min is not None and fval < defn.min:
                errors.append({
                    "field": key,
                    "message": (
                        f"Value {fval} is below the minimum {defn.min} "
                        f"for hyperparameter {key!r}."
                    ),
                })
            if defn.max is not None and fval > defn.max:
                errors.append({
                    "field": key,
                    "message": (
                        f"Value {fval} is above the maximum {defn.max} "
                        f"for hyperparameter {key!r}."
                    ),
                })
            if defn.step is not None and defn.step > 0:
                base = float(defn.min) if defn.min is not None else 0.0
                remainder = abs(fval - base) % defn.step
                if remainder > 1e-9 and abs(remainder - defn.step) > 1e-9:
                    errors.append({
                        "field": key,
                        "message": (
                            f"Value {fval} is not aligned to step {defn.step} "
                            f"for hyperparameter {key!r}."
                        ),
                    })
    return errors


def _validate_edits(
    package: PackageManifest,
    parameters: dict[str, Any],
    hyperparameters: dict[str, Any],
) -> list[dict[str, str]]:
    """Validate all edited parameters and hyperparameters.

    Only the keys present in the overrides dicts are validated (the rest use
    defaults from the package definition, which are always valid).

    Returns a list of {field, message} error dicts (empty if all valid).
    """
    errors: list[dict[str, str]] = []

    param_defs = {p.key: p for p in package.parameters}
    for key, value in parameters.items():
        defn = param_defs.get(key)
        if defn is None:
            errors.append({
                "field": key,
                "message": f"Unknown parameter {key!r} for package {package.id!r}.",
            })
        else:
            errors.extend(_validate_parameter(key, value, defn))

    hp_defs = {hp.key: hp for hp in package.hyperparameters}
    for key, value in hyperparameters.items():
        defn = hp_defs.get(key)
        if defn is None:
            errors.append({
                "field": key,
                "message": (
                    f"Unknown hyperparameter {key!r} for package {package.id!r}."
                ),
            })
        else:
            errors.extend(_validate_hyperparameter(key, value, defn))

    return errors


# ---------------------------------------------------------------------------
# Draft creation helpers
# ---------------------------------------------------------------------------


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    """Recursively merge *override* onto *base*.

    For each key in *override*:
      - If the value is a dict and the matching key in *base* is also a dict,
        recurse so that nested fields are merged at the sub-model level.
      - Otherwise the override value replaces the base value.

    Neither *base* nor *override* is mutated.
    """
    result: dict[str, Any] = dict(base)
    for key, val in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(val, dict):
            result[key] = _deep_merge(result[key], val)
        else:
            result[key] = val
    return result


def _apply_profile_overrides(
    scenario: ScenarioDef,
    profiles: dict[str, Any],
) -> tuple[ScenarioDef, list[dict[str, str]]]:
    """Deep-merge profile override dicts onto scenario profiles and validate.

    Feature 009 (signal-tier redesign): ``driver_profile``/``vehicle_profile``
    are retired from ``ScenarioDef`` — replaced by ``driver_signal_params``
    (still overridable) and ``anomaly_signal_params`` (new override surface).
    The vehicle behaviour model has no replacement; a ``"vehicle"`` override
    key is rejected with a clear validation error rather than importing the
    deleted ``VehicleBehaviorProfile`` class.

    For each of driver / anomaly / speed provided in *profiles*:
      1. Take the scenario's existing profile as a dict (or empty if absent).
      2. Deep-merge the override dict onto it (unset fields keep scenario values).
      3. Validate the merged result against the typed profile model.
      4. Collect any Pydantic validation errors (prefixed "profiles.<type>.*").

    Returns:
        (effective_scenario, errors) — if errors is non-empty, effective_scenario
        is the unmodified original (do NOT register the draft).
    """
    from pydantic import ValidationError

    from aica_api.models.profile import AnomalySignalParams, DriverSignalParams, SpeedProfile

    errors: list[dict[str, str]] = []
    updates: dict[str, Any] = {}

    driver_override = profiles.get("driver")
    if driver_override is not None:
        base = (
            scenario.driver_signal_params.model_dump(mode="json")
            if scenario.driver_signal_params
            else {}
        )
        merged = _deep_merge(base, driver_override)
        try:
            updates["driver_signal_params"] = DriverSignalParams.model_validate(merged)
        except ValidationError as exc:
            for e in exc.errors():
                loc = ".".join(str(x) for x in e["loc"])
                errors.append({"field": f"profiles.driver.{loc}", "message": e["msg"]})

    anomaly_override = profiles.get("anomaly")
    if anomaly_override is not None:
        base = (
            scenario.anomaly_signal_params.model_dump(mode="json")
            if scenario.anomaly_signal_params
            else {}
        )
        merged = _deep_merge(base, anomaly_override)
        try:
            updates["anomaly_signal_params"] = AnomalySignalParams.model_validate(merged)
        except ValidationError as exc:
            for e in exc.errors():
                loc = ".".join(str(x) for x in e["loc"])
                errors.append({"field": f"profiles.anomaly.{loc}", "message": e["msg"]})

    # The vehicle behaviour model is retired (feature 009) — no replacement
    # profile exists. Reject explicitly instead of importing a deleted class
    # or silently dropping the override.
    if profiles.get("vehicle") is not None:
        errors.append({
            "field": "profiles.vehicle",
            "message": (
                "vehicle profile overrides are no longer supported — the vehicle "
                "behavior model was retired in feature 009 (signal-tier redesign)."
            ),
        })

    speed_override = profiles.get("speed")
    if speed_override is not None:
        base = scenario.speed_profile.model_dump(mode="json") if scenario.speed_profile else {}
        merged = _deep_merge(base, speed_override)
        try:
            updates["speed_profile"] = SpeedProfile.model_validate(merged)
        except ValidationError as exc:
            for e in exc.errors():
                loc = ".".join(str(x) for x in e["loc"])
                errors.append({"field": f"profiles.speed.{loc}", "message": e["msg"]})

    if errors:
        return scenario, errors

    if updates:
        return scenario.model_copy(update=updates), []

    return scenario, []


def _merge_defaults(
    package: PackageManifest,
    parameters: dict[str, Any],
    hyperparameters: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Merge package defaults with user overrides."""
    effective_params = {p.key: p.default for p in package.parameters}
    effective_params.update(parameters)

    effective_hps = {hp.key: hp.default for hp in package.hyperparameters}
    effective_hps.update(hyperparameters)

    return effective_params, effective_hps


def _build_effective_setup(
    package: PackageManifest,
    scenario: ScenarioDef,
    effective_params: dict[str, Any],
    effective_hps: dict[str, Any],
    run_mode: str,
) -> dict[str, Any]:
    """Build the effective_setup dict for the draft response.

    Feature 009 (signal-tier redesign): ``driver_profile`` keeps its evidence
    field name for backward compatibility but now carries the
    ``driver_signal_params`` dump (see run_manager.create_run's identical
    convention). ``vehicle_profile`` is always ``None`` — the vehicle
    behaviour model is retired. ``anomaly_signal_params`` is a new key.
    """
    return {
        "package_id": package.id,
        "package_version": package.version,
        "scenario_id": scenario.id,
        "scenario_version": scenario.version,
        "run_mode": run_mode,
        "parameters": effective_params,
        "hyperparameters": effective_hps,
        "driver_profile": (
            scenario.driver_signal_params.model_dump(mode="json")
            if scenario.driver_signal_params is not None
            else None
        ),
        "vehicle_profile": None,
        "anomaly_signal_params": (
            scenario.anomaly_signal_params.model_dump(mode="json")
            if scenario.anomaly_signal_params is not None
            else None
        ),
        "speed_profile": (
            scenario.speed_profile.model_dump(mode="json")
            if scenario.speed_profile is not None
            else None
        ),
    }


def _build_draft(
    plan_id: str,
    package: PackageManifest,
    scenario: ScenarioDef,
    presets: dict[str, Any],
    parameters: dict[str, Any],
    hyperparameters: dict[str, Any],
    run_mode: str,
    route_facts: RouteFacts | None = None,
    route_source: str = "local",
    display_route: DisplayRoute | None = None,
    profile_overrides: dict | None = None,
) -> RunPlanDraft:
    """Pure draft construction — deterministic given (route_facts, presets).

    Does NOT check parameter/hyperparameter validation — call _validate_edits
    first.  Raises if build_event_plan fails (caller must catch and convert to
    a validation error).

    M4: route_facts may be supplied externally (maps selection); if None,
    derived locally from scenario (local path — byte-for-byte unchanged).
    route_source and display_route are threaded into RunPlanDraft.
    """
    # Route analysis (deterministic) — use external facts if provided (maps path)
    if route_facts is None:
        route_facts = analyze_route(scenario)
    route_facts.bands = {f.key: f.band_values for f in package.features}

    # tick_seconds precedence: an explicit setup-time override (already in
    # `presets`) wins; otherwise fall back to the package-declared cadence, then
    # the scenario default. Merge into a copy so the caller's dict isn't mutated.
    effective_presets = dict(presets)
    if (
        "tick_seconds" not in effective_presets
        and package.algorithm.tick_seconds is not None
    ):
        effective_presets["tick_seconds"] = package.algorithm.tick_seconds

    # Event plan (deterministic) — effective presets threaded through
    event_plan = build_event_plan(route_facts, scenario, effective_presets)

    # Merge defaults + overrides
    effective_params, effective_hps = _merge_defaults(package, parameters, hyperparameters)

    # Effective setup
    effective_setup = _build_effective_setup(
        package, scenario, effective_params, effective_hps, run_mode
    )

    return RunPlanDraft(
        plan_id=plan_id,
        package_id=package.id,
        scenario_id=scenario.id,
        route_facts=route_facts,
        effective_setup=effective_setup,
        draft_event_plan=event_plan,
        validation_errors=[],
        route_source=route_source,
        display_route=display_route,
        profile_overrides=profile_overrides,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def create_draft(
    plan_id: str,
    package: PackageManifest,
    scenario: ScenarioDef,
    presets: dict[str, Any],
    parameters: dict[str, Any],
    hyperparameters: dict[str, Any],
    run_mode: str = "standard",
    route_facts: RouteFacts | None = None,
    route_source: str = "local",
    display_route: DisplayRoute | None = None,
    profiles: dict[str, Any] | None = None,
    initial_state: dict | None = None,
    context_overrides: dict | None = None,
) -> RunPlanDraft:
    """Create and register a draft run plan.

    Validates each edited parameter/hyperparameter against its definition.
    If there are validation errors, returns the draft with errors set but does
    NOT store it in the registry.

    Args:
        plan_id:          Unique identifier supplied by the caller (router).
        package:          Validated PackageManifest.
        scenario:         Validated ScenarioDef.
        presets:          Scenario preset overrides (e.g. speed, traffic).
        parameters:       Setup-time parameter overrides (key → value).
        hyperparameters:  Hyperparameter overrides (key → value).
        run_mode:         "standard" (or "expert_override" in future).
        route_facts:      M4 — pre-computed facts from maps selection (None = local).
        route_source:     M4 — "maps" or "local" (default "local").
        display_route:    M4 — render-only snapshot from maps selection (None = local).
        profiles:         T008 — optional profile override dict with optional keys
                          "driver", "vehicle", "speed" (each a partial or full profile
                          dict deep-merged onto the scenario profile).  None = no override.
        initial_state:    Optional numeric initial driver state override.  Keys:
                          "drowsiness_level" and/or "fatigue_level" as floats in [0, 100].
                          Merged onto effective_scenario.initial_state AFTER profile
                          overrides so the effective_scenario is already resolved.

    Returns:
        A RunPlanDraft.  Check validation_errors before using.
    """
    # Validate parameter/hyperparameter edits
    validation_errors = _validate_edits(package, parameters, hyperparameters)

    # T008: Apply profile overrides (deep-merge then validate the merged whole).
    # Compute the effective scenario regardless — profile errors are collected
    # alongside parameter errors so the caller gets a single combined error list.
    effective_scenario = scenario
    if profiles:
        effective_scenario, profile_errors = _apply_profile_overrides(scenario, profiles)
        validation_errors = validation_errors + profile_errors

    # Apply numeric initial_state override onto the effective scenario's initial_state.
    # This is merged AFTER profile overrides so the effective_scenario is already resolved.
    if initial_state:
        merged_initial = {**effective_scenario.initial_state, **initial_state}
        effective_scenario = effective_scenario.model_copy(update={"initial_state": merged_initial})

    # Apply boolean context overrides (child_passenger, familiar_route).
    if context_overrides:
        effective_scenario = effective_scenario.model_copy(update=context_overrides)

    if validation_errors:
        # Return draft with errors but do NOT register it.
        # Error-path drafts always use local analysis and no display route.
        return RunPlanDraft(
            plan_id=plan_id,
            package_id=package.id,
            scenario_id=scenario.id,
            route_facts=route_facts if route_facts is not None else analyze_route(scenario),
            effective_setup={},
            validation_errors=validation_errors,
            route_source="local",
            display_route=None,
        )

    # Build the draft (pure, deterministic) using the effective scenario.
    # If build_event_plan raises, surface it as a validation error — never
    # register a draft with a silently empty plan.
    try:
        draft = _build_draft(
            plan_id=plan_id,
            package=package,
            scenario=effective_scenario,
            presets=presets,
            parameters=parameters,
            hyperparameters=hyperparameters,
            run_mode=run_mode,
            route_facts=route_facts,
            route_source=route_source,
            display_route=display_route,
            profile_overrides=profiles if profiles else None,
        )
    except Exception as exc:  # noqa: BLE001
        plan_error: list[dict[str, str]] = [{
            "field": "event_plan",
            "message": f"Failed to build event plan: {exc}",
        }]
        # Error-path drafts always use local analysis and no display route.
        return RunPlanDraft(
            plan_id=plan_id,
            package_id=package.id,
            scenario_id=scenario.id,
            route_facts=route_facts if route_facts is not None else analyze_route(scenario),
            effective_setup={},
            validation_errors=plan_error,
            route_source="local",
            display_route=None,
        )

    # Register the draft with the EFFECTIVE scenario (profile overrides frozen here).
    # create_run and advance_tick will read profiles from effective_scenario, so the
    # tick engine automatically uses the overridden values without any signature change.
    _draft_registry[plan_id] = (draft, package, effective_scenario)

    return draft


def regenerate_draft(
    plan_id: str,
    presets: dict[str, Any],
    parameters: dict[str, Any],
    hyperparameters: dict[str, Any],
) -> RunPlanDraft:
    """Regenerate an existing draft with updated presets/parameters/hyperparameters.

    Same plan_id, new draft_event_plan.

    M4: preserves Maps route provenance (route_source, route_facts,
    display_route) from the registered draft so that a Regenerate after
    selecting a Google route does not silently flip back to local analysis.
    A local draft stays local (route_facts re-derived from the scenario).

    Args:
        plan_id:         Must exist in the registry.
        presets:         New preset overrides.
        parameters:      New parameter overrides.
        hyperparameters: New hyperparameter overrides.

    Returns:
        Updated RunPlanDraft (same plan_id).

    Raises:
        ValueError: If plan_id is not in the registry.
    """
    entry = _draft_registry.get(plan_id)
    if entry is None:
        raise ValueError(f"Unknown plan_id {plan_id!r} — cannot regenerate.")

    existing_draft, package, scenario = entry

    # Preserve Maps provenance from the registered draft.
    # For a Maps draft: pass the frozen route_facts + display_route through so
    # _build_draft does not re-derive from the scenario (which would flip
    # route_source back to "local" and lose the selected route).
    # For a local draft: pass None so _build_draft re-derives as before.
    is_maps = existing_draft.route_source == "maps"
    preserved_route_facts: RouteFacts | None = existing_draft.route_facts if is_maps else None
    preserved_route_source: str = existing_draft.route_source
    preserved_display_route: DisplayRoute | None = existing_draft.display_route if is_maps else None

    # Re-run full create_draft logic (validate + build)
    validation_errors = _validate_edits(package, parameters, hyperparameters)
    if validation_errors:
        # Error-path drafts are never registered and thus never started.
        # Preserve the route provenance in the error response for accuracy.
        return RunPlanDraft(
            plan_id=plan_id,
            package_id=package.id,
            scenario_id=scenario.id,
            route_facts=preserved_route_facts if preserved_route_facts is not None else analyze_route(scenario),
            effective_setup={},
            validation_errors=validation_errors,
            route_source=preserved_route_source,
            display_route=preserved_display_route,
        )

    # Extract run_mode from the existing draft's effective_setup
    run_mode = existing_draft.effective_setup.get("run_mode", "standard")

    # Build the new draft — thread Maps provenance and profile_overrides through to
    # preserve the selected route and any active profile overrides; surface
    # plan-build errors as validation errors.
    try:
        new_draft = _build_draft(
            plan_id=plan_id,
            package=package,
            scenario=scenario,
            presets=presets,
            parameters=parameters,
            hyperparameters=hyperparameters,
            run_mode=run_mode,
            route_facts=preserved_route_facts,
            route_source=preserved_route_source,
            display_route=preserved_display_route,
            profile_overrides=existing_draft.profile_overrides,
        )
    except Exception as exc:  # noqa: BLE001
        plan_error: list[dict[str, str]] = [{
            "field": "event_plan",
            "message": f"Failed to build event plan: {exc}",
        }]
        # Error-path drafts are never registered and thus never started.
        # Preserve the route provenance in the error response for accuracy.
        return RunPlanDraft(
            plan_id=plan_id,
            package_id=package.id,
            scenario_id=scenario.id,
            route_facts=preserved_route_facts if preserved_route_facts is not None else analyze_route(scenario),
            effective_setup={},
            validation_errors=plan_error,
            route_source=preserved_route_source,
            display_route=preserved_display_route,
        )

    # Update registry
    _draft_registry[plan_id] = (new_draft, package, scenario)

    return new_draft
