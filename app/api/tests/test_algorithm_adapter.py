"""Adapter dispatch tests (feature 009: signal-tier redesign).

``python_module`` is the only supported ``package.algorithm.type``; the
built-in ``declarative_rule`` and ``weighted_score`` algorithm types were
retired.  These tests cover the adapter's own responsibilities:

  1. Dispatch: a ``python_module`` package's ``evaluate()`` is reached via
     ``aica_api.algorithms.adapter.evaluate`` and its result comes back
     unmodified (result_type verbatim, next_package_runtime_state threaded
     through) — the full python_module load/validate/normalise matrix is
     covered by ``test_python_module.py``.
  2. Error path: any ``package.algorithm.type`` other than ``python_module``
     raises ``AlgorithmAdapterError(error_type="unsupported_algorithm_type")``
     — never a faked ``DecisionResult`` (FR-011).

Contract:
  evaluate(package, context, parameters, hyperparameters, history,
           package_runtime_state) → DecisionResult
  …or raises AlgorithmAdapterError.
"""

from __future__ import annotations

import textwrap

import pytest

from aica_api.algorithms.adapter import AlgorithmAdapterError, evaluate
from aica_api.models.decision import DecisionResult
from aica_api.models.package import (
    AlgorithmDef,
    FeatureDef,
    FireControlRule,
    HyperparameterDef,
    PackageManifest,
    ProposalDef,
    TriggerCategoryDef,
)

_PKG_ID = "test_adapter_pkg"

_VALID_CTX = {
    "simulation_time_sec": 60.0,
    "signals": {
        "fixed": {"isNight": False, "familiarRoute": True, "childPassenger": False},
        "dynamic": {"isTrafficJam": False, "segmentType": "normal_road", "motionState": "MOVING"},
        "simulated": {"drowsiness": 40.0, "fatigue": 30.0, "anomaly_rate": 0.0},
    },
    "feature_groups": {"normalized": {"drowsiness_score": 0.4}, "ordinal": {}},
    "proposal_history": {
        "lastProposalTimeSec": None,
        "lastProposalCategory": None,
        "lastProposalResult": None,
        "proposalCountLast30Min": 0,
        "acceptanceRateRecent": 0.0,
    },
    "user_action_history": [],
}

_VALID_RESULT_EXPR = (
    '{"result_type": "MONOTONY_PROPOSAL", "trigger_candidate": True,'
    ' "selected_category": "rest_required", "score": 0.75, "features": {},'
    ' "scores": {}, "states": {}, "criteria": {}, "candidates": [],'
    ' "fire_control": {"fired": True, "suppressed": False, "override": False,'
    ' "reason": "test_reason"},'
    ' "proposal": None, "reason_inputs": [],'
    ' "explanation": "Test algorithm explanation",'
    ' "next_package_runtime_state": {"tick_count": 3}}'
)


def _make_package(entrypoint: str = "algorithm.py") -> PackageManifest:
    return PackageManifest(
        id=_PKG_ID,
        version="0.1.0",
        label={"ja": "テスト", "en": "Test"},
        compatible_scenario_types=["uc01_fatigue"],
        algorithm=AlgorithmDef(type="python_module", entrypoint=entrypoint),
        parameters=[],
        features=[FeatureDef(key="drowsiness_score", band_values=[])],
        hyperparameters=[
            HyperparameterDef(
                key="w_test", label={"ja": "", "en": ""}, kind="numeric", default=0.5
            )
        ],
        trigger_categories=[TriggerCategoryDef(id="rest_required", priority=1)],
        rules=[],
        fire_control=FireControlRule(
            threshold_source="threshold_suggest",
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


@pytest.fixture(autouse=True)
def clear_module_cache():
    """Isolate tests from the python_module load cache."""
    from aica_api.algorithms import python_module as _pm

    _pm._MODULE_CACHE.clear()
    yield
    _pm._MODULE_CACHE.clear()


@pytest.fixture()
def pkg_dir(tmp_path):
    """tmp_path/<_PKG_ID>/algorithm.py implementing the happy path."""
    pkg = tmp_path / _PKG_ID
    pkg.mkdir()
    (pkg / "algorithm.py").write_text(f"def evaluate(context):\n    return {_VALID_RESULT_EXPR}\n")
    return tmp_path


# ---------------------------------------------------------------------------
# Dispatch: python_module
# ---------------------------------------------------------------------------


def test_adapter_dispatches_python_module_returns_decision_result(pkg_dir, monkeypatch):
    """evaluate() with a python_module package returns a DecisionResult."""
    monkeypatch.setenv("AICA_PACKAGES_DIR", str(pkg_dir))
    pkg = _make_package()

    result = evaluate(
        package=pkg,
        context=_VALID_CTX,
        parameters={},
        hyperparameters={"w_test": 0.5},
        history=[],
        package_runtime_state={},
    )
    assert isinstance(result, DecisionResult)


def test_adapter_dispatches_python_module_result_type_verbatim(pkg_dir, monkeypatch):
    """result_type is stored verbatim — no built-in alias map."""
    monkeypatch.setenv("AICA_PACKAGES_DIR", str(pkg_dir))
    pkg = _make_package()

    result = evaluate(
        package=pkg,
        context=_VALID_CTX,
        parameters={},
        hyperparameters={"w_test": 0.5},
        history=[],
        package_runtime_state={},
    )
    assert result.result_type == "MONOTONY_PROPOSAL"


def test_adapter_dispatches_python_module_next_state_threaded(pkg_dir, monkeypatch):
    """next_package_runtime_state from the package is preserved (not forced to {})."""
    monkeypatch.setenv("AICA_PACKAGES_DIR", str(pkg_dir))
    pkg = _make_package()

    result = evaluate(
        package=pkg,
        context=_VALID_CTX,
        parameters={},
        hyperparameters={"w_test": 0.5},
        history=[],
        package_runtime_state={"prior": "state"},
    )
    assert result.next_package_runtime_state == {"tick_count": 3}


def test_adapter_propagates_algorithm_exception(tmp_path, monkeypatch):
    """A package evaluate() exception surfaces as AlgorithmAdapterError, never a faked result."""
    algo_py = textwrap.dedent("""\
        def evaluate(context):
            raise RuntimeError("simulated algorithm crash")
    """)
    (tmp_path / _PKG_ID).mkdir()
    (tmp_path / _PKG_ID / "algorithm.py").write_text(algo_py)

    monkeypatch.setenv("AICA_PACKAGES_DIR", str(tmp_path))
    pkg = _make_package()

    with pytest.raises(AlgorithmAdapterError) as exc_info:
        evaluate(
            package=pkg,
            context=_VALID_CTX,
            parameters={},
            hyperparameters={"w_test": 0.5},
            history=[],
            package_runtime_state={},
        )
    err = exc_info.value
    assert err.error_type == "algorithm_exception"
    assert "simulated algorithm crash" in err.message


# ---------------------------------------------------------------------------
# Error path: unsupported algorithm.type
# ---------------------------------------------------------------------------


def test_adapter_raises_on_unsupported_algorithm_type():
    """Any package.algorithm.type other than python_module → unsupported_algorithm_type."""
    pkg = _make_package()
    # AlgorithmDef.type is a narrowed Literal["python_module"] at construction time;
    # mutate post-construction to simulate a retired/unknown type reaching the adapter.
    pkg.algorithm.type = "declarative_rule"

    with pytest.raises(AlgorithmAdapterError) as exc_info:
        evaluate(
            package=pkg,
            context=_VALID_CTX,
            parameters={},
            hyperparameters={},
            history=[],
            package_runtime_state={},
        )
    err = exc_info.value
    assert err.error_type == "unsupported_algorithm_type"
    assert "declarative_rule" in err.message


def test_adapter_raises_on_unknown_algorithm_type():
    """A never-registered algorithm type also raises unsupported_algorithm_type."""
    pkg = _make_package()
    pkg.algorithm.type = "some_future_type"

    with pytest.raises(AlgorithmAdapterError) as exc_info:
        evaluate(
            package=pkg,
            context=_VALID_CTX,
            parameters={},
            hyperparameters={},
            history=[],
            package_runtime_state={},
        )
    assert exc_info.value.error_type == "unsupported_algorithm_type"
