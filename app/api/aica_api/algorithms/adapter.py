"""Algorithm adapter (T014) — the single, authoritative dispatch path.

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
"""

from __future__ import annotations

from aica_api.algorithms import declarative_rule as _dr
from aica_api.models.decision import DecisionResult
from aica_api.models.package import PackageManifest


# ---------------------------------------------------------------------------
# Error type
# ---------------------------------------------------------------------------


class AlgorithmAdapterError(Exception):
    """Raised when an algorithm fails to produce a valid DecisionResult.

    Callers (the tick engine) should convert this to an ``AlgorithmError``
    log event (with the appropriate tick_index), never to a DecisionResult.

    Attributes:
        error_type: Machine-readable category ("algorithm_exception" or
                    "invalid_result_shape").
        message:    Human-readable description including the original error.
    """

    def __init__(self, error_type: str, message: str) -> None:
        self.error_type = error_type
        self.message = message
        super().__init__(f"{error_type}: {message}")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def evaluate(
    package: PackageManifest,
    context: dict,
    parameters: dict,
    hyperparameters: dict,
    history: list,  # noqa: ARG001 — reserved for stateful algorithms (M3+)
    package_runtime_state: dict,  # noqa: ARG001 — empty for declarative_rule
) -> DecisionResult:
    """Dispatch to the algorithm implementation and return a DecisionResult.

    This is the **only** entry point for algorithm evaluation.  It is the
    boundary between the tick engine and the algorithm implementations.

    Args:
        package:               Validated PackageManifest.
        context:               Fully-banded tick context (from binning).
        parameters:            Setup-time parameter values.
        hyperparameters:       Tuning hyperparameter values (user or defaults).
        history:               Prior tick decisions (for stateful algorithms).
        package_runtime_state: Opaque state carried across ticks (empty for
                               rule-only packages).

    Returns:
        A normalised ``DecisionResult`` (§11 shape, hybrid-only fields empty
        for rule-only packages).

    Raises:
        AlgorithmAdapterError: If the algorithm raises any exception, or if
            it returns a value that is not a valid ``DecisionResult``.  The
            caller is responsible for converting this to an ``AlgorithmError``
            log event.
    """
    algo_type = package.algorithm.type

    if algo_type == "declarative_rule":
        return _dispatch_declarative_rule(context, parameters, hyperparameters)

    # Future algorithm types (python_module, weighted_score, …) would be
    # dispatched here.  For M1, only declarative_rule is supported.
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
