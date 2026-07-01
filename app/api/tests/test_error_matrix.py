"""T008 — algorithm-error matrix at run level (M3 T008, T009).

Tests pause-by-default semantics for all four error_types raised by the
python_module adapter, plus one non_blocking package that continues instead.

Written RED-first: tests 1-4 and 6 fail until T009 (run_manager
pause-by-default) is implemented. Tests 5 validates the non_blocking path
(passes both before and after implementation — existing behavior preserved).

Covers:
  a) missing_evaluate   + blocking → run paused, tick NOT advanced
  b) algorithm_exception + blocking → run paused, tick NOT advanced
  c) invalid_result_shape + blocking → run paused, tick NOT advanced
  d) context_error       + blocking → run paused, tick NOT advanced
  e) algorithm_exception + non_blocking → run continues (paused=False)
  f) halted-run guard: second tick() on error-paused run is a no-op
"""

from __future__ import annotations

import json
import pathlib

import pytest

from aica_api.algorithms import python_module as _pm
from aica_api.models.package import (
    AlgorithmDef,
    FeatureDef,
    FireControlRule,
    HyperparameterDef,
    PackageManifest,
    ProposalDef,
    TriggerCategoryDef,
)
from aica_api.models.run import RunStatus
from aica_api.models.scenario import ScenarioDef
from aica_api.services.run_manager import clear_registry, create_run, tick
from aica_api.services.run_plan import clear_draft_registry, create_draft

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_SCENARIO_PATH = _REPO_ROOT / "scenarios" / "uc01_fatigue_friend_drive_v0_1.json"

_PKG_ID = "err_test_pkg"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def isolate():
    """Isolate each test — clear both in-memory registries."""
    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


@pytest.fixture(autouse=True)
def clear_cache():
    """Ensure each test starts with a clean python_module load cache."""
    _pm._MODULE_CACHE.clear()
    yield
    _pm._MODULE_CACHE.clear()


@pytest.fixture
def uc01_scenario() -> ScenarioDef:
    data = json.loads(_SCENARIO_PATH.read_text(encoding="utf-8"))
    return ScenarioDef(**data)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_package(error_mode: str = "blocking") -> PackageManifest:
    """Build a minimal python_module PackageManifest for error testing."""
    return PackageManifest(
        id=_PKG_ID,
        version="0.1.0",
        label={"ja": "エラーテスト", "en": "Error Test"},
        compatible_scenario_types=["uc01_fatigue"],
        algorithm=AlgorithmDef(
            type="python_module",
            entrypoint="algorithm.py",
            error_mode=error_mode,
        ),
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


def _plan_and_run(package: PackageManifest, scenario: ScenarioDef, run_id: str, tmp_path):
    """Create a draft and a run from it."""
    plan_id = f"plan_{run_id}"
    create_draft(
        plan_id=plan_id,
        package=package,
        scenario=scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
    )
    return create_run(plan_id, run_id, tmp_path)


def _assert_blocking_pause(outcome, expected_error_type: str, run_id: str, tmp_path) -> None:
    """Common assertions for a blocking algorithm error outcome."""
    assert outcome.decision is None, "decision must be None — no faked result"
    assert outcome.algorithm_error is not None, "algorithm_error must be populated"
    assert outcome.algorithm_error.error_type == expected_error_type
    assert outcome.paused is True, (
        f"blocking error_mode must pause the run; got paused={outcome.paused!r}"
    )
    assert outcome.run_state.status == RunStatus.paused
    assert outcome.run_state.last_error is not None, "last_error must be set on blocking pause"
    assert outcome.run_state.last_error["error_type"] == expected_error_type
    # current_tick must NOT advance — run is halted at the broken tick
    assert outcome.run_state.current_tick == 0, (
        f"current_tick must not advance on blocking error; "
        f"got {outcome.run_state.current_tick}"
    )

    # Persisted log: algorithm_error event present, no tick event
    log_path = tmp_path / f"{run_id}.json"
    data = json.loads(log_path.read_text(encoding="utf-8"))
    error_events = [e for e in data["events"] if e["kind"] == "algorithm_error"]
    assert len(error_events) == 1
    assert error_events[0]["error_type"] == expected_error_type
    assert not any(e["kind"] == "tick" for e in data["events"])


# ---------------------------------------------------------------------------
# T008a — missing_evaluate (no evaluate attribute) + blocking
# ---------------------------------------------------------------------------


def test_missing_evaluate_blocking_pauses_run(tmp_path, uc01_scenario, monkeypatch):
    """error_type=missing_evaluate + default blocking → run paused, tick NOT advanced."""
    monkeypatch.setenv("AICA_PACKAGES_DIR", str(tmp_path))
    pkg_dir = tmp_path / _PKG_ID
    pkg_dir.mkdir()
    (pkg_dir / "algorithm.py").write_text("# no evaluate function here\n")

    package = _make_package(error_mode="blocking")
    _plan_and_run(package, uc01_scenario, "run_missing_eval", tmp_path)

    outcome = tick("run_missing_eval")
    _assert_blocking_pause(outcome, "missing_evaluate", "run_missing_eval", tmp_path)


# ---------------------------------------------------------------------------
# T008b — algorithm_exception (evaluate() raises) + blocking
# ---------------------------------------------------------------------------


def test_algorithm_exception_blocking_pauses_run(tmp_path, uc01_scenario, monkeypatch):
    """error_type=algorithm_exception + blocking → run paused, tick NOT advanced."""
    monkeypatch.setenv("AICA_PACKAGES_DIR", str(tmp_path))
    pkg_dir = tmp_path / _PKG_ID
    pkg_dir.mkdir()
    (pkg_dir / "algorithm.py").write_text(
        "def evaluate(ctx):\n    raise RuntimeError('injected crash')\n"
    )

    package = _make_package(error_mode="blocking")
    _plan_and_run(package, uc01_scenario, "run_algo_exc", tmp_path)

    outcome = tick("run_algo_exc")
    _assert_blocking_pause(outcome, "algorithm_exception", "run_algo_exc", tmp_path)


# ---------------------------------------------------------------------------
# T008c — invalid_result_shape (evaluate() returns non-dict) + blocking
# ---------------------------------------------------------------------------


def test_invalid_result_shape_blocking_pauses_run(tmp_path, uc01_scenario, monkeypatch):
    """error_type=invalid_result_shape + blocking → run paused, tick NOT advanced."""
    monkeypatch.setenv("AICA_PACKAGES_DIR", str(tmp_path))
    pkg_dir = tmp_path / _PKG_ID
    pkg_dir.mkdir()
    (pkg_dir / "algorithm.py").write_text(
        "def evaluate(ctx):\n    return 'not a dict -- invalid shape'\n"
    )

    package = _make_package(error_mode="blocking")
    _plan_and_run(package, uc01_scenario, "run_invalid_shape", tmp_path)

    outcome = tick("run_invalid_shape")
    _assert_blocking_pause(outcome, "invalid_result_shape", "run_invalid_shape", tmp_path)


# ---------------------------------------------------------------------------
# T008d — context_error (required field missing from context) + blocking
# ---------------------------------------------------------------------------


def test_context_error_blocking_pauses_run(tmp_path, uc01_scenario, monkeypatch):
    """error_type=context_error + blocking → run paused, tick NOT advanced.

    Monkeypatches build_adapter_context (in run_manager's namespace) to return
    a context that omits raw_state, causing _validate_context to raise context_error.
    """
    monkeypatch.setenv("AICA_PACKAGES_DIR", str(tmp_path))
    pkg_dir = tmp_path / _PKG_ID
    pkg_dir.mkdir()
    # Valid evaluate — the error comes from the missing context field, not from here
    (pkg_dir / "algorithm.py").write_text(
        "def evaluate(ctx):\n    return {}\n"
    )

    import aica_api.services.run_manager as rm_mod

    original_build = rm_mod.build_adapter_context

    def _stripped_context(tick_state):
        ctx = original_build(tick_state)
        ctx.pop("raw_state", None)  # remove required field → triggers context_error
        return ctx

    monkeypatch.setattr(rm_mod, "build_adapter_context", _stripped_context)

    package = _make_package(error_mode="blocking")
    _plan_and_run(package, uc01_scenario, "run_ctx_error", tmp_path)

    outcome = tick("run_ctx_error")
    _assert_blocking_pause(outcome, "context_error", "run_ctx_error", tmp_path)


# ---------------------------------------------------------------------------
# T008e — non_blocking package continues (error still recorded)
# ---------------------------------------------------------------------------


def test_non_blocking_error_continues_run(tmp_path, uc01_scenario, monkeypatch):
    """error_mode=non_blocking → tick advances, run NOT paused, error still recorded."""
    monkeypatch.setenv("AICA_PACKAGES_DIR", str(tmp_path))
    pkg_dir = tmp_path / _PKG_ID
    pkg_dir.mkdir()
    (pkg_dir / "algorithm.py").write_text(
        "def evaluate(ctx):\n    raise RuntimeError('non_blocking crash')\n"
    )

    package = _make_package(error_mode="non_blocking")
    _plan_and_run(package, uc01_scenario, "run_non_blocking", tmp_path)

    outcome = tick("run_non_blocking")

    assert outcome.decision is None
    assert outcome.algorithm_error is not None
    assert outcome.algorithm_error.error_type == "algorithm_exception"
    assert outcome.paused is False, "non_blocking error must NOT pause the run"
    assert outcome.run_state.status != RunStatus.paused
    # tick MUST advance for non_blocking
    assert outcome.run_state.current_tick == 1, (
        f"current_tick must advance for non_blocking; got {outcome.run_state.current_tick}"
    )

    # Error still recorded in the persisted log
    log_path = tmp_path / "run_non_blocking.json"
    data = json.loads(log_path.read_text(encoding="utf-8"))
    assert any(e["kind"] == "algorithm_error" for e in data["events"])


# ---------------------------------------------------------------------------
# T008f — halted-run guard: second tick() on error-paused run is a no-op
# ---------------------------------------------------------------------------


def test_second_tick_on_halted_run_is_noop(tmp_path, uc01_scenario, monkeypatch):
    """Calling tick() a second time on a blocking-error-paused run returns
    a no-op TickOutcome (paused=True) without appending a duplicate error event."""
    monkeypatch.setenv("AICA_PACKAGES_DIR", str(tmp_path))
    pkg_dir = tmp_path / _PKG_ID
    pkg_dir.mkdir()
    (pkg_dir / "algorithm.py").write_text("# no evaluate function\n")

    package = _make_package(error_mode="blocking")
    _plan_and_run(package, uc01_scenario, "run_halted_guard", tmp_path)

    # First tick: adapter fails → blocking pause
    outcome1 = tick("run_halted_guard")
    assert outcome1.paused is True
    assert outcome1.algorithm_error is not None

    # Second tick: must be a no-op (guard triggers)
    outcome2 = tick("run_halted_guard")
    assert outcome2.paused is True
    assert outcome2.decision is None
    assert outcome2.algorithm_error is None, (
        "no-op second tick must not produce a new algorithm_error"
    )

    # Exactly one algorithm_error event in the persisted log
    log_path = tmp_path / "run_halted_guard.json"
    data = json.loads(log_path.read_text(encoding="utf-8"))
    error_events = [e for e in data["events"] if e["kind"] == "algorithm_error"]
    assert len(error_events) == 1, (
        f"second tick() must not duplicate the algorithm_error event; "
        f"got {len(error_events)}"
    )
