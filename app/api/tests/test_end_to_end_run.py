"""Focused end-to-end test (feature 009, F1) — python_module packages on the
real tick loop, tiered signal context.

Proves that BOTH shipped python_module packages (aica_transparent_hybrid_trigger_v1
and nri_fatigue_score_v1) run to completion through the real run_manager tick loop
on the rewritten uc01_fatigue_recovery_v0_1 scenario, without ever raising
context_error/algorithm_error — the exact gap this unit closes (python_module.py
was still validating/building on the removed flat `raw_state`; run_manager now
emits `context["signals"] = {fixed, dynamic, simulated}`).

Also asserts determinism: running the same (scenario, package, run_seed) twice
produces an identical decision-type sequence — no adapter-introduced
non-determinism was added while switching context shapes.

Uses the real service layer (run_plan.create_draft + run_manager.create_run/tick/
action) — no HTTP layer, no mocking of the adapter or tick engine.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from aica_api.models.package import PackageManifest
from aica_api.models.scenario import ScenarioDef
from aica_api.services.run_manager import action, clear_registry, create_run, tick
from aica_api.services.run_plan import clear_draft_registry, create_draft

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_SCENARIO_PATH = _REPO_ROOT / "scenarios" / "uc01_fatigue_recovery_v0_1.json"

_PACKAGE_IDS = ["aica_transparent_hybrid_trigger_v1", "nri_fatigue_score_v1"]

# Generous tick budget: both packages complete the 120km route well within this
# (observed: hybrid ~217 ticks @30s, nri ~108 ticks @60s).
_MAX_TICKS = 400


@pytest.fixture(autouse=True)
def reset_registries():
    """Isolate each test — clear both in-memory registries."""
    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


@pytest.fixture
def uc01_scenario() -> ScenarioDef:
    data = json.loads(_SCENARIO_PATH.read_text(encoding="utf-8"))
    data.pop("_comment", None)
    return ScenarioDef(**data)


def _load_package(package_id: str) -> PackageManifest:
    pkg_path = _REPO_ROOT / "packages" / package_id / "package.json"
    return PackageManifest(**json.loads(pkg_path.read_text(encoding="utf-8")))


def _run_to_completion(package: PackageManifest, scenario: ScenarioDef, run_id: str, tmp_path):
    """Create a draft + run, then tick to completion (declining every proposal).

    Returns (result_type_sequence, algorithm_errors, ticks_run).
    Never lets an AlgorithmAdapterError escape as a faked decision — any
    algorithm_error/context_error is captured explicitly for the caller to
    assert against, per the constitution's "never disguise failures" rule.
    """
    plan_id = f"plan_{run_id}"
    draft = create_draft(
        plan_id=plan_id,
        package=package,
        scenario=scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
    )
    assert not draft.validation_errors, f"Unexpected draft validation errors: {draft.validation_errors}"

    create_run(plan_id, run_id, tmp_path)

    result_types: list[str | None] = []
    algorithm_errors: list[str] = []

    for _ in range(_MAX_TICKS):
        outcome = tick(run_id)

        if outcome.algorithm_error is not None:
            algorithm_errors.append(outcome.algorithm_error.error_type)
            # Blocking error_mode pauses the run at the broken tick — stop here,
            # the caller asserts algorithm_errors is empty.
            break

        if outcome.completed and outcome.decision is None:
            # run_manager's route-end short-circuit: the route is already fully
            # driven, so no adapter call was made for this "tick" — nothing to
            # record, and this is NOT an error.
            break

        result_types.append(outcome.decision.result_type if outcome.decision else None)

        if outcome.completed:
            break

        if outcome.paused:
            # Decline every proposal so the run keeps advancing to completion.
            action(run_id, "decline")

    return result_types, algorithm_errors


# ---------------------------------------------------------------------------
# Per-package end-to-end: no context_error/algorithm_error, decisions flow,
# run reaches completion.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("package_id", _PACKAGE_IDS)
def test_package_runs_end_to_end_no_errors(package_id, uc01_scenario, tmp_path):
    """Full tick loop on the tiered signal context: zero context/algorithm errors."""
    package = _load_package(package_id)

    result_types, algorithm_errors = _run_to_completion(
        package, uc01_scenario, f"run_{package_id}", tmp_path
    )

    assert algorithm_errors == [], (
        f"{package_id}: expected zero context_error/algorithm_error ticks, got {algorithm_errors}"
    )
    assert len(result_types) > 0, f"{package_id}: expected at least one tick decision"
    # Every tick produced a real decision (never None/absent) since no error occurred.
    assert all(rt is not None for rt in result_types), (
        f"{package_id}: every non-error tick must carry a decision result_type"
    )


@pytest.mark.parametrize("package_id", _PACKAGE_IDS)
def test_package_run_reaches_completion(package_id, uc01_scenario, tmp_path):
    """The run reaches completed=True (route fully driven) within the tick budget."""
    package = _load_package(package_id)

    plan_id = f"plan_completion_{package_id}"
    draft = create_draft(
        plan_id=plan_id,
        package=package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
    )
    assert not draft.validation_errors

    run_id = f"run_completion_{package_id}"
    create_run(plan_id, run_id, tmp_path)

    completed = False
    for _ in range(_MAX_TICKS):
        outcome = tick(run_id)
        assert outcome.algorithm_error is None, (
            f"{package_id}: unexpected algorithm_error {outcome.algorithm_error}"
        )
        if outcome.completed:
            completed = True
            break
        if outcome.paused:
            action(run_id, "decline")

    assert completed, f"{package_id}: run did not reach completion within {_MAX_TICKS} ticks"


# ---------------------------------------------------------------------------
# Determinism: same (scenario, package, run_seed) -> identical decision sequence.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("package_id", _PACKAGE_IDS)
def test_same_seed_produces_identical_decision_sequence(package_id, uc01_scenario, tmp_path):
    """Two independent runs with the same run_seed produce the same result_type sequence.

    uc01_fatigue_recovery_v0_1.json fixes run_seed_default=42 — both runs below use
    that same frozen seed, so the only source of stochasticity (the Tier-3b seeded
    anomaly-rate generator) is deterministic across runs.
    """
    package = _load_package(package_id)
    assert uc01_scenario.run_seed_default == 42  # the fixed seed this test relies on

    seq_a, errors_a = _run_to_completion(package, uc01_scenario, f"run_a_{package_id}", tmp_path)
    seq_b, errors_b = _run_to_completion(package, uc01_scenario, f"run_b_{package_id}", tmp_path)

    assert errors_a == [] and errors_b == []
    assert seq_a == seq_b, f"{package_id}: identical run_seed must produce an identical decision sequence"
    assert len(seq_a) > 0
