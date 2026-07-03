"""Algorithm adapter (T014/T016/T004) — the single, authoritative dispatch path.

Every algorithm call goes through this module.  It dispatches by
``package.algorithm.type``, calls the implementation, normalises the output
to the §11 DecisionResult shape, and raises ``AlgorithmAdapterError`` for
any algorithm exception or invalid return shape (FR-011).

Contract (§11, decision-result.md):
  evaluate(package, context, parameters, hyperparameters, history,
           package_runtime_state) → DecisionResult
  …or raises AlgorithmAdapterError

Design constraints:
  - No new dependencies — pure Python + Pydantic (already in the project).
  - Deterministic: same inputs → same output.
  - An algorithm exception or invalid return → AlgorithmAdapterError,
    NEVER a faked DecisionResult (FR-011).
  - Suppressed candidates are passed through unchanged (FR-008).

Feature 009 (signal-tier redesign): the built-in ``declarative_rule`` and
``weighted_score`` algorithm types have been retired.  ``python_module`` is
now the ONLY supported ``package.algorithm.type`` — every package is a
locally-trusted Python module exposing ``evaluate(context: dict) -> dict``.
  - python_module validates the enriched context (simulation_time_sec, raw_state,
    feature_groups.normalized), then loads + evaluates the package's evaluate().
  - result_type passed verbatim; next_package_runtime_state threaded through.
"""

from __future__ import annotations

from aica_api.algorithms import python_module as _pm
from aica_api.algorithms._errors import AlgorithmAdapterError  # re-exported below
from aica_api.models.decision import DecisionResult
from aica_api.models.package import PackageManifest

# Re-export for backward compatibility — external callers import from here.
__all__ = ["AlgorithmAdapterError", "evaluate"]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def evaluate(
    package: PackageManifest,
    context: dict,
    parameters: dict,
    hyperparameters: dict,
    history: list,  # noqa: ARG001 — reserved for stateful algorithms
    package_runtime_state: dict,
) -> DecisionResult:
    """Dispatch to the algorithm implementation and return a DecisionResult.

    This is the **only** entry point for algorithm evaluation.  It is the
    boundary between the tick engine and the algorithm implementations.

    Args:
        package:               Validated PackageManifest (algorithm.type is
                               always "python_module").
        context:               Tick context dict, enriched with
                               simulation_time_sec, raw_state,
                               feature_groups.normalized, proposal_history,
                               and user_action_history.
        parameters:            Setup-time parameter values.
        hyperparameters:       Tuning hyperparameter values (user or defaults).
        history:               Prior tick decisions (for stateful algorithms).
        package_runtime_state: Opaque state carried across ticks, threaded
                               through from the algorithm's prior return.

    Returns:
        A normalised ``DecisionResult`` (§11 shape).

    Raises:
        AlgorithmAdapterError: If the algorithm raises any exception, or if
            it returns a value that is not a valid ``DecisionResult``, or if
            ``package.algorithm.type`` is not ``python_module``.  The caller
            is responsible for converting this to an ``AlgorithmError`` log
            event.
    """
    algo_type = package.algorithm.type

    if algo_type == "python_module":
        return _dispatch_python_module(
            package, context, parameters, hyperparameters, package_runtime_state
        )

    raise AlgorithmAdapterError(
        error_type="unsupported_algorithm_type",
        message=f"Algorithm type {algo_type!r} is not supported in this version.",
    )


# ---------------------------------------------------------------------------
# Private dispatch helpers
# ---------------------------------------------------------------------------


def _dispatch_python_module(
    package: PackageManifest,
    context: dict,
    parameters: dict,
    hyperparameters: dict,
    package_runtime_state: dict,
) -> DecisionResult:
    """Dispatch to python_module.dispatch() which validates, loads, calls, and normalises.

    For python_module packages:
      - result_type is stored verbatim (no alias map).
      - next_package_runtime_state is preserved from the algorithm's return.
      - Context must already be enriched with simulation_time_sec, proposal_history,
        and user_action_history (injected by run_manager T005).

    Raises:
        AlgorithmAdapterError: With error_type in {context_error, missing_evaluate,
            algorithm_exception, invalid_result_shape} on any failure.
    """
    return _pm.dispatch(
        package=package,
        context=context,
        parameters=parameters,
        hyperparameters=hyperparameters,
        package_runtime_state=package_runtime_state,
    )
