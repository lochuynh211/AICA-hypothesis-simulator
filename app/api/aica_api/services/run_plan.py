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
from aica_api.models.run import RunPlanDraft
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


def _compute_original_modified(
    package: PackageManifest,
    parameters: dict[str, Any],
    hyperparameters: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Compute original_values / modified_values diff."""
    defaults_params = {p.key: p.default for p in package.parameters}
    defaults_hps = {hp.key: hp.default for hp in package.hyperparameters}

    original: dict[str, Any] = {}
    modified: dict[str, Any] = {}

    for key, new_val in parameters.items():
        if key in defaults_params and defaults_params[key] != new_val:
            original[f"parameters.{key}"] = defaults_params[key]
            modified[f"parameters.{key}"] = new_val

    for key, new_val in hyperparameters.items():
        if key in defaults_hps and defaults_hps[key] != new_val:
            original[f"hyperparameters.{key}"] = defaults_hps[key]
            modified[f"hyperparameters.{key}"] = new_val

    return original, modified


def _build_effective_setup(
    package: PackageManifest,
    scenario: ScenarioDef,
    effective_params: dict[str, Any],
    effective_hps: dict[str, Any],
    run_mode: str,
) -> dict[str, Any]:
    """Build the effective_setup dict for the draft response."""
    return {
        "package_id": package.id,
        "package_version": package.version,
        "scenario_id": scenario.id,
        "scenario_version": scenario.version,
        "run_mode": run_mode,
        "parameters": effective_params,
        "hyperparameters": effective_hps,
        "driver_profile": (
            scenario.driver_profile.model_dump(mode="json")
            if scenario.driver_profile is not None
            else None
        ),
        "vehicle_profile": (
            scenario.vehicle_profile.model_dump(mode="json")
            if scenario.vehicle_profile is not None
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
) -> RunPlanDraft:
    """Pure draft construction — deterministic given (route_facts, presets).

    Does NOT check parameter/hyperparameter validation — call _validate_edits
    first.  Raises if build_event_plan fails (caller must catch and convert to
    a validation error).
    """
    # Route analysis (deterministic)
    route_facts = analyze_route(scenario)
    route_facts.bands = {f.key: f.band_values for f in package.features}

    # Event plan (deterministic) — caller-supplied presets threaded through
    event_plan = build_event_plan(route_facts, scenario, presets)

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

    Returns:
        A RunPlanDraft.  Check validation_errors before using.
    """
    # Validate edits first
    validation_errors = _validate_edits(package, parameters, hyperparameters)

    if validation_errors:
        # Return draft with errors but do NOT register it
        return RunPlanDraft(
            plan_id=plan_id,
            package_id=package.id,
            scenario_id=scenario.id,
            route_facts=analyze_route(scenario),
            effective_setup={},
            validation_errors=validation_errors,
        )

    # Build the draft (pure, deterministic)
    # If build_event_plan raises, surface it as a validation error — never
    # register a draft with a silently empty plan.
    try:
        draft = _build_draft(
            plan_id=plan_id,
            package=package,
            scenario=scenario,
            presets=presets,
            parameters=parameters,
            hyperparameters=hyperparameters,
            run_mode=run_mode,
        )
    except Exception as exc:  # noqa: BLE001
        plan_error: list[dict[str, str]] = [{
            "field": "event_plan",
            "message": f"Failed to build event plan: {exc}",
        }]
        return RunPlanDraft(
            plan_id=plan_id,
            package_id=package.id,
            scenario_id=scenario.id,
            route_facts=analyze_route(scenario),
            effective_setup={},
            validation_errors=plan_error,
        )

    # Register the draft (with the full package + scenario for create_run)
    _draft_registry[plan_id] = (draft, package, scenario)

    return draft


def regenerate_draft(
    plan_id: str,
    presets: dict[str, Any],
    parameters: dict[str, Any],
    hyperparameters: dict[str, Any],
) -> RunPlanDraft:
    """Regenerate an existing draft with updated presets/parameters/hyperparameters.

    Same plan_id, new draft_event_plan.

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

    # Re-run full create_draft logic (validate + build)
    validation_errors = _validate_edits(package, parameters, hyperparameters)
    if validation_errors:
        return RunPlanDraft(
            plan_id=plan_id,
            package_id=package.id,
            scenario_id=scenario.id,
            route_facts=analyze_route(scenario),
            effective_setup={},
            validation_errors=validation_errors,
        )

    # Extract run_mode from the existing draft's effective_setup
    run_mode = existing_draft.effective_setup.get("run_mode", "standard")

    # Build the new draft — surface plan-build errors as validation errors
    try:
        new_draft = _build_draft(
            plan_id=plan_id,
            package=package,
            scenario=scenario,
            presets=presets,
            parameters=parameters,
            hyperparameters=hyperparameters,
            run_mode=run_mode,
        )
    except Exception as exc:  # noqa: BLE001
        plan_error: list[dict[str, str]] = [{
            "field": "event_plan",
            "message": f"Failed to build event plan: {exc}",
        }]
        return RunPlanDraft(
            plan_id=plan_id,
            package_id=package.id,
            scenario_id=scenario.id,
            route_facts=analyze_route(scenario),
            effective_setup={},
            validation_errors=plan_error,
        )

    # Update registry
    _draft_registry[plan_id] = (new_draft, package, scenario)

    return new_draft
