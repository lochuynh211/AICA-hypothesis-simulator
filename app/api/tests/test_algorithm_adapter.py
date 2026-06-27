"""TDD adapter tests (T014) — written BEFORE implementation; confirm RED, GREEN.

The adapter is the single path through which ALL algorithm calls flow.
It dispatches by ``package.algorithm.type``, calls the implementation,
normalises the output to the §11 DecisionResult shape, and raises
``AlgorithmAdapterError`` for any algorithm exception or invalid return
(FR-011 — never a faked DecisionResult).

Contract:
  evaluate(package, context, parameters, hyperparameters, history,
           package_runtime_state) → DecisionResult
  …or raises AlgorithmAdapterError.
"""

import pytest

from aica_api.algorithms.adapter import AlgorithmAdapterError, evaluate
from aica_api.models.decision import DecisionResult, ResultType
from aica_api.models.package import (
    AlgorithmDef,
    FeatureDef,
    FireControlRule,
    HyperparameterDef,
    PackageManifest,
    ProposalDef,
    TriggerCategoryDef,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_VALID_ALGORITHM = AlgorithmDef(type="declarative_rule", entrypoint="rules")

_FEATURES = [
    FeatureDef(key="drowsiness_level",
               band_values=["none", "weak", "moderate", "strong", "severe"]),
    FeatureDef(key="fatigue_level", band_values=["low", "medium", "high"]),
    FeatureDef(key="signal_duration",
               band_values=["transient", "brief", "sustained", "persistent"]),
    FeatureDef(key="continuous_driving_time", band_values=["short", "moderate", "long"]),
    FeatureDef(key="rest_spot_eta", band_values=["none", "near", "far"]),
]

_HYPERPARAMETER_DEFS = [
    HyperparameterDef(key="trigger_sensitivity",
                      label={"ja": "", "en": ""},
                      kind="band", band_values=["low", "medium", "high"],
                      default="medium"),
    HyperparameterDef(key="proposal_threshold",
                      label={"ja": "", "en": ""},
                      kind="band", band_values=["low", "medium", "high"],
                      default="medium"),
    HyperparameterDef(key="severe_threshold",
                      label={"ja": "", "en": ""},
                      kind="band", band_values=["low", "medium", "high"],
                      default="medium"),
    HyperparameterDef(key="persistence_requirement",
                      label={"ja": "", "en": ""},
                      kind="band", band_values=["low", "medium", "high"],
                      default="medium"),
    HyperparameterDef(key="require_actionable",
                      label={"ja": "", "en": ""},
                      kind="bool", default=True),
    HyperparameterDef(key="rest_spot_sensitivity",
                      label={"ja": "", "en": ""},
                      kind="band", band_values=["low", "medium", "high"],
                      default="medium"),
]


def _make_package(algorithm: AlgorithmDef = _VALID_ALGORITHM) -> PackageManifest:
    return PackageManifest(
        id="rest_rule_based_v0_1",
        version="0.1.0",
        label={"ja": "テスト", "en": "Test"},
        compatible_scenario_types=["uc01_fatigue"],
        algorithm=algorithm,
        parameters=[],
        features=_FEATURES,
        hyperparameters=_HYPERPARAMETER_DEFS,
        trigger_categories=[TriggerCategoryDef(id="rest_required", priority=1)],
        rules=[{"id": "R1"}],
        fire_control=FireControlRule(
            threshold_source="proposal_threshold",
            actionability_guard="rest_spot_reachable",
        ),
        proposals=[
            ProposalDef(
                id="rest_guidance",
                message={"ja": "休憩", "en": "Rest"},
                options=["accept_rest", "postpone"],
            )
        ],
    )


_PACKAGE = _make_package()

_DEFAULT_HP = {
    "trigger_sensitivity": "medium",
    "proposal_threshold": "medium",
    "severe_threshold": "medium",
    "persistence_requirement": "medium",
    "require_actionable": True,
    "rest_spot_sensitivity": "medium",
}

# The UC-01 R3 trigger context (same as declarative_rule tests)
_R3_CTX = {
    "drowsiness_level": "moderate",
    "fatigue_level": "medium",
    "signal_duration": "sustained",
    "continuous_driving_time": "long",
    "rest_spot_eta": "near",
}


# ---------------------------------------------------------------------------
# Happy-path dispatch: declarative_rule
# ---------------------------------------------------------------------------


def test_adapter_returns_decision_result():
    """evaluate() with a valid declarative_rule package returns a DecisionResult."""
    result = evaluate(
        package=_PACKAGE,
        context=_R3_CTX,
        parameters={},
        hyperparameters=_DEFAULT_HP,
        history=[],
        package_runtime_state={},
    )
    assert isinstance(result, DecisionResult)


def test_adapter_r3_result_type():
    """Adapter correctly dispatches to declarative_rule and returns R3 result."""
    result = evaluate(
        package=_PACKAGE,
        context=_R3_CTX,
        parameters={},
        hyperparameters=_DEFAULT_HP,
        history=[],
        package_runtime_state={},
    )
    assert result.result_type == ResultType.REST_PROPOSAL


def test_adapter_normalises_hybrid_only_fields_empty():
    """Adapter normalisation: scores, states, next_package_runtime_state are {}."""
    result = evaluate(
        package=_PACKAGE,
        context=_R3_CTX,
        parameters={},
        hyperparameters=_DEFAULT_HP,
        history=[],
        package_runtime_state={},
    )
    assert result.scores == {}
    assert result.states == {}
    assert result.next_package_runtime_state == {}


def test_adapter_score_not_none():
    """Adapter result carries a non-null ordinal blend score for R3."""
    result = evaluate(
        package=_PACKAGE,
        context=_R3_CTX,
        parameters={},
        hyperparameters=_DEFAULT_HP,
        history=[],
        package_runtime_state={},
    )
    assert result.score is not None
    assert result.score >= 3.0


def test_adapter_suppressed_candidate_preserved():
    """Suppressed R2 candidate is preserved in candidates (FR-008)."""
    ctx = {**_R3_CTX, "rest_spot_eta": "none"}
    result = evaluate(
        package=_PACKAGE,
        context=ctx,
        parameters={},
        hyperparameters=_DEFAULT_HP,
        history=[],
        package_runtime_state={},
    )
    assert result.result_type == ResultType.NO_PRACTICAL_ACTION_FALLBACK
    suppressed = [c for c in result.candidates if c.fire_control.suppressed]
    assert len(suppressed) >= 1


def test_adapter_r5_trigger_candidate_false():
    """Adapter returns trigger_candidate=False for R5 (NO_TRIGGER)."""
    ctx = {
        "drowsiness_level": "none", "fatigue_level": "low",
        "signal_duration": "transient", "continuous_driving_time": "short",
        "rest_spot_eta": "none",
    }
    result = evaluate(
        package=_PACKAGE, context=ctx, parameters={},
        hyperparameters=_DEFAULT_HP, history=[], package_runtime_state={},
    )
    assert result.result_type == ResultType.NO_TRIGGER
    assert result.trigger_candidate is False


# ---------------------------------------------------------------------------
# Error path: algorithm exception → AlgorithmAdapterError (FR-011)
# ---------------------------------------------------------------------------


def test_adapter_raises_algorithm_adapter_error_on_exception(monkeypatch):
    """An algorithm that raises becomes an AlgorithmAdapterError — not a DecisionResult."""
    import aica_api.algorithms.declarative_rule as dr_module

    def _raising(*args, **kwargs):
        raise RuntimeError("simulated algorithm crash")

    monkeypatch.setattr(dr_module, "evaluate", _raising)

    with pytest.raises(AlgorithmAdapterError) as exc_info:
        evaluate(
            package=_PACKAGE,
            context=_R3_CTX,
            parameters={},
            hyperparameters=_DEFAULT_HP,
            history=[],
            package_runtime_state={},
        )
    err = exc_info.value
    assert err.error_type == "algorithm_exception"
    assert "simulated algorithm crash" in err.message


def test_adapter_raises_on_invalid_return_shape(monkeypatch):
    """An algorithm returning a non-DecisionResult becomes AlgorithmAdapterError."""
    import aica_api.algorithms.declarative_rule as dr_module

    def _bad_return(*args, **kwargs):
        return {"result_type": "NOT_A_VALID_TYPE"}  # not a DecisionResult

    monkeypatch.setattr(dr_module, "evaluate", _bad_return)

    with pytest.raises(AlgorithmAdapterError) as exc_info:
        evaluate(
            package=_PACKAGE,
            context=_R3_CTX,
            parameters={},
            hyperparameters=_DEFAULT_HP,
            history=[],
            package_runtime_state={},
        )
    err = exc_info.value
    assert err.error_type == "invalid_result_shape"


def test_adapter_does_not_return_decision_result_on_algorithm_error(monkeypatch):
    """Verify the adapter truly raises, never returns a DecisionResult on error."""
    import aica_api.algorithms.declarative_rule as dr_module

    monkeypatch.setattr(dr_module, "evaluate",
                        lambda *a, **kw: (_ for _ in ()).throw(ValueError("oops")))

    with pytest.raises(AlgorithmAdapterError):
        evaluate(
            package=_PACKAGE, context=_R3_CTX, parameters={},
            hyperparameters=_DEFAULT_HP, history=[], package_runtime_state={},
        )


# ---------------------------------------------------------------------------
# AlgorithmAdapterError has error_type and message attributes
# ---------------------------------------------------------------------------


def test_algorithm_adapter_error_attributes(monkeypatch):
    """AlgorithmAdapterError exposes error_type and message attributes."""
    import aica_api.algorithms.declarative_rule as dr_module

    monkeypatch.setattr(dr_module, "evaluate",
                        lambda *a, **kw: (_ for _ in ()).throw(TypeError("type mismatch")))

    with pytest.raises(AlgorithmAdapterError) as exc_info:
        evaluate(
            package=_PACKAGE, context=_R3_CTX, parameters={},
            hyperparameters=_DEFAULT_HP, history=[], package_runtime_state={},
        )
    err = exc_info.value
    assert hasattr(err, "error_type")
    assert hasattr(err, "message")
    assert isinstance(err.error_type, str)
    assert isinstance(err.message, str)


# ---------------------------------------------------------------------------
# Determinism through the adapter
# ---------------------------------------------------------------------------


def test_adapter_determinism():
    """Same inputs → same DecisionResult through the adapter."""
    kwargs = dict(
        package=_PACKAGE,
        context=_R3_CTX,
        parameters={},
        hyperparameters=_DEFAULT_HP,
        history=[],
        package_runtime_state={},
    )
    r1 = evaluate(**kwargs)
    r2 = evaluate(**kwargs)
    assert r1.result_type == r2.result_type
    assert r1.score == r2.score
    assert r1.criteria == r2.criteria
