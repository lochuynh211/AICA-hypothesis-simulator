"""python_module algorithm adapter (M3 T004) — load and evaluate trusted local Python packages.

Design:
  - stdlib ``importlib`` only; NO new dependencies; in-process; NO sandboxing.
  - Caches the loaded module per package id; reloads when the resolved path changes.
  - Validates required context fields BEFORE calling the package's evaluate().
  - result_type is stored verbatim — no alias map.
  - next_package_runtime_state is threaded through (NOT forced to {}).

Feature 009 (signal-tier redesign): the flat ``raw_state`` context shape is
retired.  ``run_manager.build_adapter_context()`` now emits
``context["signals"] = {fixed, dynamic, simulated}`` (+ ``feature_groups``) and
layers ``simulation_time_sec``, ``proposal_history``, ``user_action_history``,
``recovery_active`` on top (see specs/009-signal-tier-redesign/contracts/
tiered-context.md).  ``_validate_context`` and ``dispatch`` are updated to
match this shape exactly — no ``raw_state`` key anywhere in this module.

Public API used by adapter.py:
  load_evaluate(package) -> callable   — load (or return cached) evaluate callable
  dispatch(package, context, parameters, hyperparameters, package_runtime_state)
                             -> DecisionResult   — full dispatch + normalise path

Module-level ``_MODULE_CACHE`` is intentionally public so tests can inspect it.
"""

from __future__ import annotations

import importlib.util
from typing import Any

from pydantic import ValidationError

from aica_api.algorithms._errors import AlgorithmAdapterError
from aica_api.config import settings
from aica_api.models.decision import DecisionResult
from aica_api.models.package import PackageManifest


# ---------------------------------------------------------------------------
# Module cache: {package_id: (entry_path_str, loaded_module)}
# ---------------------------------------------------------------------------

_MODULE_CACHE: dict[str, tuple[str, Any]] = {}


# ---------------------------------------------------------------------------
# Required core context fields — validated before calling the package
# ---------------------------------------------------------------------------

# Tier-3a (simulated) signals every package's evaluate() reads directly.
_REQUIRED_SIMULATED_FIELDS: frozenset[str] = frozenset(
    {"drowsiness", "fatigue", "anomaly_rate"}
)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def load_evaluate(package: PackageManifest):
    """Load (and cache) the package's ``evaluate`` callable.

    Uses ``importlib`` to load the file at
    ``settings.packages_dir / package.id / package.algorithm.entrypoint``.
    The loaded module is cached by package id; a changed entrypoint path
    triggers a fresh load.

    Args:
        package: PackageManifest with ``algorithm.type == "python_module"``.

    Returns:
        The callable ``evaluate`` attribute from the loaded module.

    Raises:
        AlgorithmAdapterError(error_type="missing_evaluate"): If the entry-point
            file does not exist, or if the loaded module exposes no callable
            ``evaluate`` attribute.
    """
    entry_path = settings.packages_dir / package.id / package.algorithm.entrypoint
    entry_str = str(entry_path)

    # Return cached callable when the resolved path is unchanged.
    cached = _MODULE_CACHE.get(package.id)
    if cached is not None:
        cached_path, module = cached
        if cached_path == entry_str:
            fn = getattr(module, "evaluate", None)
            if callable(fn):
                return fn
            # Path matches but no callable — fall through to reload / error.

    # Entrypoint file must exist before we try to spec it.
    if not entry_path.exists():
        raise AlgorithmAdapterError(
            error_type="missing_evaluate",
            message=f"Entrypoint not found: {entry_path}",
        )

    spec = importlib.util.spec_from_file_location(
        f"aica_pkg_{package.id}", entry_path
    )
    if spec is None or spec.loader is None:
        raise AlgorithmAdapterError(
            error_type="missing_evaluate",
            message=f"Cannot create a module spec for: {entry_path}",
        )
    module = importlib.util.module_from_spec(spec)

    try:
        spec.loader.exec_module(module)  # type: ignore[union-attr]
    except Exception as exc:  # noqa: BLE001
        raise AlgorithmAdapterError(
            error_type="algorithm_exception",
            message=f"Failed to load module {entry_path}: {exc}",
        ) from exc

    fn = getattr(module, "evaluate", None)
    if not callable(fn):
        raise AlgorithmAdapterError(
            error_type="missing_evaluate",
            message=(
                f"Module at {entry_path} has no callable 'evaluate' attribute."
            ),
        )

    _MODULE_CACHE[package.id] = (entry_str, module)
    return fn


def dispatch(
    package: PackageManifest,
    context: dict,
    parameters: dict,
    hyperparameters: dict,
    package_runtime_state: dict,
) -> DecisionResult:
    """Build py_context, validate, call the package's evaluate, and normalise.

    Steps:
      1. Validate required context fields (raises ``context_error`` on failure).
      2. Build the ``py_context`` dict delivered to the package.
      3. Load (or retrieve cached) the ``evaluate`` callable.
      4. Call ``evaluate(py_context)``; exceptions become ``algorithm_exception``.
      5. Normalise the returned dict to ``DecisionResult``; invalid shape becomes
         ``invalid_result_shape``.

    Args:
        package:               PackageManifest (``algorithm.type == "python_module"``).
        context:               Tick context enriched by run_manager with
                               ``simulation_time_sec``, ``signals``
                               (``{fixed, dynamic, simulated}``), ``feature_groups``,
                               ``proposal_history``, ``user_action_history``,
                               ``recovery_active``, and (optionally, for NRI
                               packages) ``nri_forecast`` — forwarded to
                               ``py_context`` only when present.
        parameters:            Setup-time parameter values.
        hyperparameters:       Hyperparameter values.
        package_runtime_state: Opaque state returned from the prior tick (or {}).

    Returns:
        A normalised ``DecisionResult``.  ``result_type`` is stored verbatim.
        ``next_package_runtime_state`` is preserved from the algorithm's return
        (NOT forced to {}).

    Raises:
        AlgorithmAdapterError: On validation failure, load failure, evaluation
            exception, or invalid return shape.
    """
    # ── Step 1: validate required context fields ───────────────────────────
    _validate_context(context)

    # ── Step 2: build py_context — tiered signals, NO raw_state ────────────
    py_context: dict[str, Any] = {
        "simulation_time_sec": context["simulation_time_sec"],
        "signals": context["signals"],
        "feature_groups": context.get("feature_groups", {}),
        "parameters": parameters,
        "hyperparameters": hyperparameters,
        "proposal_history": context["proposal_history"],
        "user_action_history": context.get("user_action_history", []),
        "package_runtime_state": package_runtime_state,
        "recovery_active": context.get("recovery_active", False),
    }

    # Forecast block (nri-forecast-rest feature): run_manager.tick() and
    # preview.iter_preview_ticks() attach this to the OUTER context for NRI
    # packages so the package's evaluate() can read its forecast early-rest
    # path (algorithm.py's `context.get("nri_forecast")`). Forwarded only when
    # present — every non-NRI package leaves it unset, so py_context is
    # unchanged for them and no cross-package behavior changes.
    if "nri_forecast" in context:
        py_context["nri_forecast"] = context["nri_forecast"]

    # ── Step 3: load evaluate callable ────────────────────────────────────
    # load_evaluate raises AlgorithmAdapterError(missing_evaluate) on failure.
    fn = load_evaluate(package)

    # ── Step 4: call evaluate ──────────────────────────────────────────────
    try:
        raw_result = fn(py_context)
    except Exception as exc:  # noqa: BLE001
        raise AlgorithmAdapterError(
            error_type="algorithm_exception",
            message=str(exc),
        ) from exc

    # ── Step 5: normalise to DecisionResult ───────────────────────────────
    if not isinstance(raw_result, dict):
        raise AlgorithmAdapterError(
            error_type="invalid_result_shape",
            message=(
                f"evaluate() returned {type(raw_result).__name__!r}; "
                "expected a dict matching the §11 DecisionResult shape."
            ),
        )

    try:
        result = DecisionResult(**raw_result)
    except (ValidationError, TypeError) as exc:
        raise AlgorithmAdapterError(
            error_type="invalid_result_shape",
            message=f"evaluate() returned an invalid DecisionResult shape: {exc}",
        ) from exc

    # result_type is passed through verbatim (no alias map).
    # next_package_runtime_state is preserved — NOT forced to {}.
    return result


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _validate_context(context: dict) -> None:
    """Assert the tick context contains the required tiered fields for python_module.

    Required fields (their absence raises ``context_error``):
      - ``simulation_time_sec``                      (injected by run_manager)
      - ``signals.fixed``                            (a dict)
      - ``signals.dynamic``                          (a dict)
      - ``signals.simulated``                        (a dict) with the three
                                                       Tier-3a keys: drowsiness,
                                                       fatigue, anomaly_rate
      - ``proposal_history``                         (injected by run_manager)
      - ``user_action_history``                      (injected by run_manager)

    ``feature_groups`` is optional here (both packages default missing/absent
    ordinal features to an empty dict for display purposes only — it never
    drives a decision).

    Args:
        context: The tick context dict to validate.

    Raises:
        AlgorithmAdapterError(error_type="context_error"): On any missing
            required field.  The message names the missing field precisely.
    """
    if "simulation_time_sec" not in context:
        raise AlgorithmAdapterError(
            error_type="context_error",
            message="missing required field: 'simulation_time_sec'",
        )

    signals = context.get("signals")
    if not isinstance(signals, dict):
        raise AlgorithmAdapterError(
            error_type="context_error",
            message="missing required field: 'signals'",
        )

    for tier in ("fixed", "dynamic"):
        if not isinstance(signals.get(tier), dict):
            raise AlgorithmAdapterError(
                error_type="context_error",
                message=f"missing required field: 'signals.{tier}'",
            )

    simulated = signals.get("simulated")
    if not isinstance(simulated, dict):
        raise AlgorithmAdapterError(
            error_type="context_error",
            message="missing required field: 'signals.simulated'",
        )

    missing_simulated = _REQUIRED_SIMULATED_FIELDS - set(simulated.keys())
    if missing_simulated:
        raise AlgorithmAdapterError(
            error_type="context_error",
            message=(
                f"missing required field(s) in signals.simulated: "
                f"{sorted(missing_simulated)}"
            ),
        )

    for key in ("proposal_history", "user_action_history"):
        if key not in context:
            raise AlgorithmAdapterError(
                error_type="context_error",
                message=f"missing required field: '{key}'",
            )
