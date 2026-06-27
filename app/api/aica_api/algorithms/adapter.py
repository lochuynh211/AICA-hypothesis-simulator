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

M2 additions (T016):
  - Dispatches ``weighted_score`` by ``package.algorithm.type``.
  - weighted_score populates scores/states/candidates/selected_category;
    next_package_runtime_state is always passthrough-empty from both built-ins.

M3 additions (T004):
  - Dispatches ``python_module`` by ``package.algorithm.type``.
  - python_module validates the enriched context (simulation_time_sec, raw_state,
    feature_groups.normalized), then loads + evaluates the package's evaluate().
  - result_type passed verbatim; next_package_runtime_state threaded through.
"""

from __future__ import annotations

from aica_api.algorithms import declarative_rule as _dr
from aica_api.algorithms import python_module as _pm
from aica_api.algorithms import weighted_score as _ws
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
    history: list,  # noqa: ARG001 — reserved for stateful algorithms (M3+)
    package_runtime_state: dict,  # noqa: ARG001 — empty for both M2 built-ins
) -> DecisionResult:
    """Dispatch to the algorithm implementation and return a DecisionResult.

    This is the **only** entry point for algorithm evaluation.  It is the
    boundary between the tick engine and the algorithm implementations.

    Args:
        package:               Validated PackageManifest.
        context:               Tick context dict.  For declarative_rule: ordinal
                               bands.  For weighted_score: {raw_state,
                               feature_groups.normalized}.
        parameters:            Setup-time parameter values.
        hyperparameters:       Tuning hyperparameter values (user or defaults).
        history:               Prior tick decisions (for stateful algorithms).
        package_runtime_state: Opaque state carried across ticks (empty for
                               both M2 built-ins).

    Returns:
        A normalised ``DecisionResult`` (§11 shape).
        - declarative_rule: hybrid-only fields (scores, states) empty.
        - weighted_score:   hybrid-only fields fully populated.

    Raises:
        AlgorithmAdapterError: If the algorithm raises any exception, or if
            it returns a value that is not a valid ``DecisionResult``.  The
            caller is responsible for converting this to an ``AlgorithmError``
            log event.
    """
    algo_type = package.algorithm.type

    if algo_type == "declarative_rule":
        return _dispatch_declarative_rule(context, parameters, hyperparameters)

    if algo_type == "weighted_score":
        return _dispatch_weighted_score(context, parameters, hyperparameters)

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


def _dispatch_declarative_rule(
    context: dict,
    parameters: dict,
    hyperparameters: dict,
) -> DecisionResult:
    """Call declarative_rule.evaluate and normalise the result."""
    try:
        result = _dr.evaluate(
            context=context,
            parameters=parameters,
            hyperparameters=hyperparameters,
        )
    except Exception as exc:  # noqa: BLE001
        raise AlgorithmAdapterError(
            error_type="algorithm_exception",
            message=str(exc),
        ) from exc

    # Validate that the result is a proper DecisionResult.
    if not isinstance(result, DecisionResult):
        raise AlgorithmAdapterError(
            error_type="invalid_result_shape",
            message=(
                f"Algorithm returned {type(result).__name__!r} "
                "instead of a DecisionResult."
            ),
        )

    # Normalise hybrid-only fields (always empty for declarative_rule).
    # The declarative_rule implementation already sets these to {}, but we
    # enforce the contract here in case a future implementation forgets.
    return DecisionResult(
        result_type=result.result_type,
        trigger_candidate=result.trigger_candidate,
        selected_category=result.selected_category,
        score=result.score,
        features=result.features,
        scores={},
        states={},
        criteria=result.criteria,
        candidates=result.candidates,
        fire_control=result.fire_control,
        proposal=result.proposal,
        reason_inputs=result.reason_inputs,
        explanation=result.explanation,
        next_package_runtime_state={},
    )


def _dispatch_weighted_score(
    context: dict,
    parameters: dict,
    hyperparameters: dict,
) -> DecisionResult:
    """Call weighted_score.evaluate, validate, and normalise the result.

    The weighted_score algorithm already populates the full §11 shape
    (scores/states/candidates/selected_category), so normalisation here
    just enforces next_package_runtime_state={} passthrough.
    """
    try:
        result = _ws.evaluate(
            context=context,
            parameters=parameters,
            hyperparameters=hyperparameters,
        )
    except Exception as exc:  # noqa: BLE001
        raise AlgorithmAdapterError(
            error_type="algorithm_exception",
            message=str(exc),
        ) from exc

    # Validate that the result is a proper DecisionResult.
    if not isinstance(result, DecisionResult):
        raise AlgorithmAdapterError(
            error_type="invalid_result_shape",
            message=(
                f"Algorithm returned {type(result).__name__!r} "
                "instead of a DecisionResult."
            ),
        )

    # Enforce M2 contract: next_package_runtime_state is always empty.
    # The weighted_score implementation should already return {}, but we
    # guarantee it here at the adapter boundary.
    return DecisionResult(
        result_type=result.result_type,
        trigger_candidate=result.trigger_candidate,
        selected_category=result.selected_category,
        score=result.score,
        features=result.features,
        scores=result.scores,
        states=result.states,
        criteria=result.criteria,
        candidates=result.candidates,
        fire_control=result.fire_control,
        proposal=result.proposal,
        reason_inputs=result.reason_inputs,
        explanation=result.explanation,
        next_package_runtime_state={},
    )


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
      - next_package_runtime_state is preserved from the algorithm's return
        (unlike built-ins which force {}).
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
