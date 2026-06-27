"""TDD tests for python_module adapter + _derive_history (M3 T004, T005).

Written BEFORE implementation — must be RED first, then GREEN after impl.

Covers:
  1. Happy path: load + call → normalized DecisionResult; result_type verbatim.
  2. Caching: module loaded once (import counter stays at 1 after two calls).
  3. Suppressed retained: suppressed candidate survives normalisation.
  4. Runtime-state threaded: non-empty next_package_runtime_state preserved.
  5. Error matrix: missing_evaluate / algorithm_exception / invalid_result_shape /
     context_error all raise AlgorithmAdapterError with the exact error_type.
  6. _derive_history: fired proposal + decline → correct proposal_history;
     empty events → all-None/0/0.0.
"""

from __future__ import annotations

import textwrap

import pytest

from aica_api.algorithms.adapter import AlgorithmAdapterError, evaluate
from aica_api.models.decision import DecisionResult, FireControl, Proposal
from aica_api.models.log import ActionEvent, TickEvent, TraceEntry
from aica_api.models.package import (
    AlgorithmDef,
    FeatureDef,
    FireControlRule,
    HyperparameterDef,
    PackageManifest,
    ProposalDef,
    TriggerCategoryDef,
)
from aica_api.models.run import TickState
from aica_api.services.run_manager import _derive_history


# ---------------------------------------------------------------------------
# Shared fixtures and helpers
# ---------------------------------------------------------------------------

_PKG_ID = "test_python_pkg"


def _make_pm_package(tmp_path, entrypoint: str = "algorithm.py") -> PackageManifest:
    """Build a python_module PackageManifest pointing at tmp_path/<_PKG_ID>/."""
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
                key="w_test",
                label={"ja": "", "en": ""},
                kind="numeric",
                default=0.5,
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


# Minimal valid context for python_module (includes T005 injected fields).
_VALID_PM_CTX = {
    "simulation_time_sec": 120.0,
    "raw_state": {
        "drowsinessLevel": 40.0,
        "fatigueLevel": 30.0,
        "attentionLevel": 70.0,
        "speedKph": 80.0,
    },
    "feature_groups": {
        "normalized": {
            "drowsiness_score": 0.4,
            "fatigue_score": 0.3,
        }
    },
    "proposal_history": {
        "lastProposalTimeSec": None,
        "lastProposalCategory": None,
        "lastProposalResult": None,
        "proposalCountLast30Min": 0,
        "acceptanceRateRecent": 0.0,
    },
    "user_action_history": [],
}

# Single-line dict string safe to embed in an f-string (no multiline indentation issues).
_VALID_RESULT_EXPR = (
    '{"result_type": "MONOTONY_PROPOSAL", "trigger_candidate": True,'
    ' "selected_category": "rest_required", "score": 0.75, "features": {},'
    ' "scores": {"test_score": 0.75}, "states": {"test_state": "active"},'
    ' "criteria": {},'
    ' "candidates": [{"category": "rest_required", "exists": True, "score": 0.75,'
    ' "state": None, "strength": "clear",'
    ' "fire_control": {"fired": True, "suppressed": False, "override": False,'
    ' "reason": "test_reason"}}],'
    ' "fire_control": {"fired": True, "suppressed": False, "override": False,'
    ' "reason": "test_reason"},'
    ' "proposal": None, "reason_inputs": ["drowsinessLevel"],'
    ' "explanation": "Test algorithm explanation",'
    ' "next_package_runtime_state": {}}'
)

_HAPPY_ALGORITHM_PY = f"""\
IMPORT_COUNT = [0]
IMPORT_COUNT[0] += 1

_received_context = [None]

def evaluate(context):
    _received_context[0] = dict(context)
    return {_VALID_RESULT_EXPR}
"""


@pytest.fixture()
def pkg_dir(tmp_path):
    """Create tmp_path/<_PKG_ID>/algorithm.py with the happy-path implementation."""
    pkg = tmp_path / _PKG_ID
    pkg.mkdir()
    (pkg / "algorithm.py").write_text(_HAPPY_ALGORITHM_PY)
    return tmp_path


@pytest.fixture(autouse=True)
def clear_module_cache():
    """Isolate tests: clear the python_module load cache before and after each test."""
    from aica_api.algorithms import python_module as _pm

    _pm._MODULE_CACHE.clear()
    yield
    _pm._MODULE_CACHE.clear()


# ---------------------------------------------------------------------------
# Test 1 — Happy path
# ---------------------------------------------------------------------------


def test_happy_path_returns_decision_result(pkg_dir, monkeypatch):
    """evaluate() with python_module package → normalised DecisionResult."""
    monkeypatch.setenv("AICA_PACKAGES_DIR", str(pkg_dir))
    pkg = _make_pm_package(pkg_dir)

    result = evaluate(
        package=pkg,
        context=_VALID_PM_CTX,
        parameters={},
        hyperparameters={"w_test": 0.5},
        history=[],
        package_runtime_state={},
    )
    assert isinstance(result, DecisionResult)


def test_happy_path_result_type_verbatim(pkg_dir, monkeypatch):
    """result_type is stored verbatim — non-built-in string not aliased."""
    monkeypatch.setenv("AICA_PACKAGES_DIR", str(pkg_dir))
    pkg = _make_pm_package(pkg_dir)

    result = evaluate(
        package=pkg,
        context=_VALID_PM_CTX,
        parameters={},
        hyperparameters={"w_test": 0.5},
        history=[],
        package_runtime_state={},
    )
    # Package returns "MONOTONY_PROPOSAL" — must arrive unchanged, no alias map.
    assert result.result_type == "MONOTONY_PROPOSAL"


def test_happy_path_context_received(pkg_dir, monkeypatch):
    """The package's evaluate() receives the expected py_context keys."""
    monkeypatch.setenv("AICA_PACKAGES_DIR", str(pkg_dir))
    pkg = _make_pm_package(pkg_dir)

    evaluate(
        package=pkg,
        context=_VALID_PM_CTX,
        parameters={},
        hyperparameters={"w_test": 0.5},
        history=[],
        package_runtime_state={},
    )

    from aica_api.algorithms import python_module as _pm  # noqa: PLC0415

    module = _pm._MODULE_CACHE[_PKG_ID][1]
    received = module._received_context[0]

    assert received is not None
    assert "simulation_time_sec" in received
    assert "raw_state" in received
    assert "hyperparameters" in received
    assert "proposal_history" in received
    assert "package_runtime_state" in received
    assert received["simulation_time_sec"] == _VALID_PM_CTX["simulation_time_sec"]


# ---------------------------------------------------------------------------
# Test 2 — Caching
# ---------------------------------------------------------------------------


def test_caching_module_loaded_once(pkg_dir, monkeypatch):
    """Two calls with the same package load the module only once."""
    monkeypatch.setenv("AICA_PACKAGES_DIR", str(pkg_dir))
    pkg = _make_pm_package(pkg_dir)

    evaluate(
        package=pkg,
        context=_VALID_PM_CTX,
        parameters={},
        hyperparameters={"w_test": 0.5},
        history=[],
        package_runtime_state={},
    )
    evaluate(
        package=pkg,
        context=_VALID_PM_CTX,
        parameters={},
        hyperparameters={"w_test": 0.5},
        history=[],
        package_runtime_state={},
    )

    from aica_api.algorithms import python_module as _pm  # noqa: PLC0415

    module = _pm._MODULE_CACHE[_PKG_ID][1]
    # IMPORT_COUNT[0] is incremented once at module import; must still be 1.
    assert module.IMPORT_COUNT[0] == 1


# ---------------------------------------------------------------------------
# Test 3 — Suppressed candidate retained
# ---------------------------------------------------------------------------


def test_suppressed_candidate_retained(tmp_path, monkeypatch):
    """A returned candidate with suppressed=True survives normalisation."""
    pkg_dir = tmp_path
    algo_py = textwrap.dedent("""\
        def evaluate(context):
            return {
                "result_type": "NO_PRACTICAL_ACTION_FALLBACK",
                "trigger_candidate": False,
                "selected_category": None,
                "score": 0.5,
                "features": {},
                "scores": {},
                "states": {},
                "criteria": {},
                "candidates": [
                    {
                        "category": "rest_required",
                        "exists": True,
                        "score": 0.5,
                        "state": None,
                        "strength": "clear",
                        "fire_control": {
                            "fired": False,
                            "suppressed": True,
                            "override": False,
                            "reason": "rest_not_reachable",
                        },
                    }
                ],
                "fire_control": {
                    "fired": False,
                    "suppressed": True,
                    "override": False,
                    "reason": "rest_not_reachable",
                },
                "proposal": None,
                "reason_inputs": [],
                "explanation": "No rest reachable",
                "next_package_runtime_state": {},
            }
    """)
    (tmp_path / _PKG_ID).mkdir()
    (tmp_path / _PKG_ID / "algorithm.py").write_text(algo_py)

    monkeypatch.setenv("AICA_PACKAGES_DIR", str(pkg_dir))
    pkg = _make_pm_package(pkg_dir)

    result = evaluate(
        package=pkg,
        context=_VALID_PM_CTX,
        parameters={},
        hyperparameters={"w_test": 0.5},
        history=[],
        package_runtime_state={},
    )

    suppressed = [c for c in result.candidates if c.fire_control.suppressed]
    assert len(suppressed) == 1, "Suppressed candidate must be preserved"
    assert suppressed[0].fire_control.reason == "rest_not_reachable"


# ---------------------------------------------------------------------------
# Test 4 — Runtime state threaded
# ---------------------------------------------------------------------------


def test_runtime_state_preserved(tmp_path, monkeypatch):
    """next_package_runtime_state from the package is preserved, not forced to {}."""
    algo_py = textwrap.dedent("""\
        def evaluate(context):
            return {
                "result_type": "NO_TRIGGER",
                "trigger_candidate": False,
                "selected_category": None,
                "score": 0.1,
                "features": {},
                "scores": {},
                "states": {},
                "criteria": {},
                "candidates": [],
                "fire_control": {
                    "fired": False,
                    "suppressed": False,
                    "override": False,
                    "reason": "below_threshold",
                },
                "proposal": None,
                "reason_inputs": [],
                "explanation": "No trigger",
                "next_package_runtime_state": {"monotony_tick_count": 42, "last_score": 0.1},
            }
    """)
    (tmp_path / _PKG_ID).mkdir()
    (tmp_path / _PKG_ID / "algorithm.py").write_text(algo_py)

    monkeypatch.setenv("AICA_PACKAGES_DIR", str(tmp_path))
    pkg = _make_pm_package(tmp_path)

    result = evaluate(
        package=pkg,
        context=_VALID_PM_CTX,
        parameters={},
        hyperparameters={"w_test": 0.5},
        history=[],
        package_runtime_state={},
    )

    assert result.next_package_runtime_state == {
        "monotony_tick_count": 42,
        "last_score": 0.1,
    }


# ---------------------------------------------------------------------------
# Test 5 — Error matrix
# ---------------------------------------------------------------------------


def test_missing_evaluate_attr_raises(tmp_path, monkeypatch):
    """Module without callable 'evaluate' → missing_evaluate."""
    (tmp_path / _PKG_ID).mkdir()
    (tmp_path / _PKG_ID / "algorithm.py").write_text("# no evaluate here\nFOO = 1\n")

    monkeypatch.setenv("AICA_PACKAGES_DIR", str(tmp_path))
    pkg = _make_pm_package(tmp_path)

    with pytest.raises(AlgorithmAdapterError) as exc_info:
        evaluate(
            package=pkg,
            context=_VALID_PM_CTX,
            parameters={},
            hyperparameters={"w_test": 0.5},
            history=[],
            package_runtime_state={},
        )
    assert exc_info.value.error_type == "missing_evaluate"


def test_missing_entrypoint_file_raises(tmp_path, monkeypatch):
    """Non-existent entrypoint file → missing_evaluate."""
    (tmp_path / _PKG_ID).mkdir()
    # Intentionally do NOT write algorithm.py

    monkeypatch.setenv("AICA_PACKAGES_DIR", str(tmp_path))
    pkg = _make_pm_package(tmp_path)

    with pytest.raises(AlgorithmAdapterError) as exc_info:
        evaluate(
            package=pkg,
            context=_VALID_PM_CTX,
            parameters={},
            hyperparameters={"w_test": 0.5},
            history=[],
            package_runtime_state={},
        )
    assert exc_info.value.error_type == "missing_evaluate"


def test_evaluate_raises_becomes_algorithm_exception(tmp_path, monkeypatch):
    """Package's evaluate() raising → algorithm_exception."""
    algo_py = textwrap.dedent("""\
        def evaluate(context):
            raise RuntimeError("simulated algorithm crash")
    """)
    (tmp_path / _PKG_ID).mkdir()
    (tmp_path / _PKG_ID / "algorithm.py").write_text(algo_py)

    monkeypatch.setenv("AICA_PACKAGES_DIR", str(tmp_path))
    pkg = _make_pm_package(tmp_path)

    with pytest.raises(AlgorithmAdapterError) as exc_info:
        evaluate(
            package=pkg,
            context=_VALID_PM_CTX,
            parameters={},
            hyperparameters={"w_test": 0.5},
            history=[],
            package_runtime_state={},
        )
    err = exc_info.value
    assert err.error_type == "algorithm_exception"
    assert "simulated algorithm crash" in err.message


def test_evaluate_returns_non_dict_raises_invalid_shape(tmp_path, monkeypatch):
    """Package returning a non-dict → invalid_result_shape."""
    algo_py = textwrap.dedent("""\
        def evaluate(context):
            return "this is not a dict"
    """)
    (tmp_path / _PKG_ID).mkdir()
    (tmp_path / _PKG_ID / "algorithm.py").write_text(algo_py)

    monkeypatch.setenv("AICA_PACKAGES_DIR", str(tmp_path))
    pkg = _make_pm_package(tmp_path)

    with pytest.raises(AlgorithmAdapterError) as exc_info:
        evaluate(
            package=pkg,
            context=_VALID_PM_CTX,
            parameters={},
            hyperparameters={"w_test": 0.5},
            history=[],
            package_runtime_state={},
        )
    assert exc_info.value.error_type == "invalid_result_shape"


def test_evaluate_returns_invalid_shape_dict_raises(tmp_path, monkeypatch):
    """Package returning a dict that fails DecisionResult validation → invalid_result_shape."""
    algo_py = textwrap.dedent("""\
        def evaluate(context):
            return {"result_type": "NO_TRIGGER"}  # missing required fields
    """)
    (tmp_path / _PKG_ID).mkdir()
    (tmp_path / _PKG_ID / "algorithm.py").write_text(algo_py)

    monkeypatch.setenv("AICA_PACKAGES_DIR", str(tmp_path))
    pkg = _make_pm_package(tmp_path)

    with pytest.raises(AlgorithmAdapterError) as exc_info:
        evaluate(
            package=pkg,
            context=_VALID_PM_CTX,
            parameters={},
            hyperparameters={"w_test": 0.5},
            history=[],
            package_runtime_state={},
        )
    assert exc_info.value.error_type == "invalid_result_shape"


def test_context_missing_raw_state_raises_context_error(tmp_path, monkeypatch):
    """Context without raw_state → context_error (NOT silent 0)."""
    # Entrypoint doesn't matter — validation runs before module load.
    (tmp_path / _PKG_ID).mkdir()
    (tmp_path / _PKG_ID / "algorithm.py").write_text("def evaluate(ctx): pass\n")

    monkeypatch.setenv("AICA_PACKAGES_DIR", str(tmp_path))
    pkg = _make_pm_package(tmp_path)

    bad_ctx = {k: v for k, v in _VALID_PM_CTX.items() if k != "raw_state"}

    with pytest.raises(AlgorithmAdapterError) as exc_info:
        evaluate(
            package=pkg,
            context=bad_ctx,
            parameters={},
            hyperparameters={"w_test": 0.5},
            history=[],
            package_runtime_state={},
        )
    assert exc_info.value.error_type == "context_error"


def test_context_missing_required_sensor_field_raises_context_error(tmp_path, monkeypatch):
    """raw_state missing a required core field → context_error."""
    (tmp_path / _PKG_ID).mkdir()
    (tmp_path / _PKG_ID / "algorithm.py").write_text("def evaluate(ctx): pass\n")

    monkeypatch.setenv("AICA_PACKAGES_DIR", str(tmp_path))
    pkg = _make_pm_package(tmp_path)

    # Drop speedKph — one of the 4 required core sensor fields.
    raw_without_speed = {
        k: v for k, v in _VALID_PM_CTX["raw_state"].items() if k != "speedKph"
    }
    bad_ctx = {**_VALID_PM_CTX, "raw_state": raw_without_speed}

    with pytest.raises(AlgorithmAdapterError) as exc_info:
        evaluate(
            package=pkg,
            context=bad_ctx,
            parameters={},
            hyperparameters={"w_test": 0.5},
            history=[],
            package_runtime_state={},
        )
    assert exc_info.value.error_type == "context_error"


def test_context_missing_simulation_time_sec_raises_context_error(tmp_path, monkeypatch):
    """Context without simulation_time_sec → context_error."""
    (tmp_path / _PKG_ID).mkdir()
    (tmp_path / _PKG_ID / "algorithm.py").write_text("def evaluate(ctx): pass\n")

    monkeypatch.setenv("AICA_PACKAGES_DIR", str(tmp_path))
    pkg = _make_pm_package(tmp_path)

    bad_ctx = {k: v for k, v in _VALID_PM_CTX.items() if k != "simulation_time_sec"}

    with pytest.raises(AlgorithmAdapterError) as exc_info:
        evaluate(
            package=pkg,
            context=bad_ctx,
            parameters={},
            hyperparameters={"w_test": 0.5},
            history=[],
            package_runtime_state={},
        )
    assert exc_info.value.error_type == "context_error"


def test_context_missing_feature_groups_normalized_raises_context_error(tmp_path, monkeypatch):
    """Context with feature_groups but no .normalized → context_error."""
    (tmp_path / _PKG_ID).mkdir()
    (tmp_path / _PKG_ID / "algorithm.py").write_text("def evaluate(ctx): pass\n")

    monkeypatch.setenv("AICA_PACKAGES_DIR", str(tmp_path))
    pkg = _make_pm_package(tmp_path)

    bad_ctx = {**_VALID_PM_CTX, "feature_groups": {"ordinal": {}}}  # no 'normalized'

    with pytest.raises(AlgorithmAdapterError) as exc_info:
        evaluate(
            package=pkg,
            context=bad_ctx,
            parameters={},
            hyperparameters={"w_test": 0.5},
            history=[],
            package_runtime_state={},
        )
    assert exc_info.value.error_type == "context_error"


def test_optional_sensor_fields_absent_does_not_raise(pkg_dir, monkeypatch):
    """Optional enhancement fields (trafficJamAheadMin, etc.) may be absent — no error."""
    monkeypatch.setenv("AICA_PACKAGES_DIR", str(pkg_dir))
    pkg = _make_pm_package(pkg_dir)

    # Context has only the 4 required core fields in raw_state; no optional fields.
    ctx = {
        **_VALID_PM_CTX,
        "raw_state": {
            "drowsinessLevel": 40.0,
            "fatigueLevel": 30.0,
            "attentionLevel": 70.0,
            "speedKph": 80.0,
            # no trafficJamAheadMin, restSpotDensityNext30Min, etc.
        },
    }

    result = evaluate(
        package=pkg,
        context=ctx,
        parameters={},
        hyperparameters={"w_test": 0.5},
        history=[],
        package_runtime_state={},
    )
    assert isinstance(result, DecisionResult)


# ---------------------------------------------------------------------------
# Test 6 — _derive_history (T005)
# ---------------------------------------------------------------------------


def _make_tick_state(tick_index: int) -> TickState:
    """Build a minimal TickState for test events."""
    return TickState(
        tick_index=tick_index,
        elapsed_seconds=tick_index * 60,
        route_fraction=0.1 * tick_index,
        active_segment_id="seg1",
        drowsiness_level="moderate",
        fatigue_level="medium",
        signal_duration="sustained",
        continuous_driving_time="moderate",
        rest_spot_eta="near",
        completed=False,
    )


def _make_fired_tick_event(tick_index: int) -> TickEvent:
    """Build a TickEvent representing a fired REST_PROPOSAL at tick_index."""
    dr = DecisionResult(
        result_type="REST_PROPOSAL",
        trigger_candidate=True,
        selected_category="rest_required",
        score=0.8,
        features={},
        scores={},
        states={},
        criteria={},
        candidates=[],
        fire_control=FireControl(
            fired=True, suppressed=False, override=False, reason="test"
        ),
        proposal=Proposal(
            id="rest_guidance",
            message={"ja": "休憩", "en": "Rest"},
            options=["accept_rest", "postpone"],
        ),
        reason_inputs=[],
        explanation="Test fired proposal",
        next_package_runtime_state={},
    )
    return TickEvent(
        kind="tick",
        tick_index=tick_index,
        tick_state=_make_tick_state(tick_index),
        trace=TraceEntry(tick_index=tick_index, decision_result=dr),
    )


def _make_no_trigger_tick_event(tick_index: int) -> TickEvent:
    """Build a TickEvent for a non-firing tick (NO_TRIGGER)."""
    dr = DecisionResult(
        result_type="NO_TRIGGER",
        trigger_candidate=False,
        selected_category=None,
        score=0.1,
        features={},
        scores={},
        states={},
        criteria={},
        candidates=[],
        fire_control=FireControl(
            fired=False, suppressed=False, override=False, reason="below_threshold"
        ),
        proposal=None,
        reason_inputs=[],
        explanation="No trigger",
        next_package_runtime_state={},
    )
    return TickEvent(
        kind="tick",
        tick_index=tick_index,
        tick_state=_make_tick_state(tick_index),
        trace=TraceEntry(tick_index=tick_index, decision_result=dr),
    )


def test_derive_history_empty_events():
    """Empty event list → all-None/0/0.0 proposal_history, empty user_action_history."""
    ph, uah = _derive_history([], tick_seconds=60.0, current_sim_sec=0.0)

    assert ph["lastProposalTimeSec"] is None
    assert ph["lastProposalCategory"] is None
    assert ph["lastProposalResult"] is None
    assert ph["proposalCountLast30Min"] == 0
    assert ph["acceptanceRateRecent"] == 0.0
    assert uah == []


def test_derive_history_fired_then_decline():
    """One fired proposal followed by a decline action → correct history."""
    tick_event = _make_fired_tick_event(tick_index=2)
    action_event = ActionEvent(
        kind="action",
        tick_index=3,
        action="decline",
        resulting_status="playing",
    )
    events = [tick_event, action_event]

    ph, uah = _derive_history(events, tick_seconds=60.0, current_sim_sec=180.0)

    # tick 2 × 60 = 120 sec — the proposal time
    assert ph["lastProposalTimeSec"] == 120.0
    assert ph["lastProposalCategory"] == "rest_required"
    assert ph["lastProposalResult"] == "decline"
    # proposal at 120 sec; current = 180 sec; 180-120=60 sec < 1800 → in window
    assert ph["proposalCountLast30Min"] == 1
    # decline is not accept_rest → acceptance_rate = 0/1 = 0.0
    assert ph["acceptanceRateRecent"] == 0.0
    assert uah == [{"tick_index": 3, "action": "decline"}]


def test_derive_history_fired_then_accept():
    """One fired proposal followed by accept_rest → acceptanceRateRecent = 1.0."""
    tick_event = _make_fired_tick_event(tick_index=1)
    action_event = ActionEvent(
        kind="action",
        tick_index=2,
        action="accept_rest",
        resulting_status="completed",
    )
    events = [tick_event, action_event]

    ph, uah = _derive_history(events, tick_seconds=60.0, current_sim_sec=120.0)

    assert ph["lastProposalCategory"] == "rest_required"
    assert ph["lastProposalResult"] == "accept_rest"
    assert ph["acceptanceRateRecent"] == 1.0


def test_derive_history_proposal_outside_30min_window():
    """Proposal older than 30 min not counted in proposalCountLast30Min."""
    # Proposal at tick 0 (0 sec), current sim = 2000 sec → outside 1800 sec window
    tick_event = _make_fired_tick_event(tick_index=0)
    events = [tick_event]

    ph, uah = _derive_history(events, tick_seconds=60.0, current_sim_sec=2000.0)

    assert ph["proposalCountLast30Min"] == 0


def test_derive_history_no_trigger_ticks_ignored():
    """Non-firing tick events do not affect proposal_history."""
    events = [
        _make_no_trigger_tick_event(0),
        _make_no_trigger_tick_event(1),
        _make_no_trigger_tick_event(2),
    ]
    ph, uah = _derive_history(events, tick_seconds=60.0, current_sim_sec=180.0)

    assert ph["lastProposalTimeSec"] is None
    assert ph["lastProposalCategory"] is None
    assert ph["lastProposalResult"] is None
    assert ph["proposalCountLast30Min"] == 0
    assert ph["acceptanceRateRecent"] == 0.0
    assert uah == []


def test_derive_history_user_action_history_order():
    """user_action_history preserves event order."""
    t0 = _make_fired_tick_event(tick_index=0)
    a1 = ActionEvent(kind="action", tick_index=1, action="postpone", resulting_status="playing")
    t2 = _make_fired_tick_event(tick_index=2)
    a3 = ActionEvent(kind="action", tick_index=3, action="accept_rest", resulting_status="completed")

    ph, uah = _derive_history([t0, a1, t2, a3], tick_seconds=60.0, current_sim_sec=200.0)

    assert uah == [
        {"tick_index": 1, "action": "postpone"},
        {"tick_index": 3, "action": "accept_rest"},
    ]
