"""TDD parity tests for rest_python_v0_1 + tick_seconds precedence (M3 T006, T007).

RED first: tests fail because package files don't exist and tick_seconds precedence
is not implemented.
GREEN after: package files created + tick_seconds precedence implemented in _build_draft.

Covers:
  - T006: Registry lists rest_python_v0_1 with algorithm_type == "python_module".
  - T006: Parity between rest_python_v0_1 (python_module) and weighted_score on shared
          inputs — identical result_type, selected_category, trigger_candidate,
          per-candidate fired/suppressed, and scores within 1e-9.
          Scenarios: no-trigger, fired REST_PROPOSAL, suppressed rest_required.
  - T006: rest_python_v0_1 is stateless (next_package_runtime_state == {}).
  - T007: Package-declared tick_seconds overrides scenario cadence in frozen event plan.
  - T007: rest_python_v0_1 (no tick_seconds) inherits scenario cadence.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from aica_api.algorithms import python_module as _pm
from aica_api.algorithms.weighted_score import evaluate as ws_evaluate
from aica_api.config import settings
from aica_api.models.package import (
    AlgorithmDef,
    FeatureDef,
    FireControlRule,
    HyperparameterDef,
    PackageManifest,
    ProposalDef,
    TriggerCategoryDef,
)
from aica_api.models.scenario import ScenarioDef
from aica_api.services.package_registry import PackageRegistry
from aica_api.services.run_plan import clear_draft_registry, create_draft

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_SCENARIO_PATH = _REPO_ROOT / "scenarios" / "uc01_fatigue_friend_drive_v0_1.json"
_PKG_JSON_PATH = _REPO_ROOT / "packages" / "rest_python_v0_1" / "package.json"


# ---------------------------------------------------------------------------
# Autouse fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def clear_module_cache():
    """Ensure each test starts with a clean module cache."""
    _pm._MODULE_CACHE.clear()
    yield
    _pm._MODULE_CACHE.clear()


@pytest.fixture(autouse=True)
def reset_draft_registry():
    clear_draft_registry()
    yield
    clear_draft_registry()


# ---------------------------------------------------------------------------
# Scenario / package fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def uc01_scenario() -> ScenarioDef:
    data = json.loads(_SCENARIO_PATH.read_text(encoding="utf-8"))
    return ScenarioDef(**data)


@pytest.fixture
def rest_python_package() -> PackageManifest:
    registry = PackageRegistry(settings.packages_dir)
    pkg = registry.get("rest_python_v0_1")
    assert pkg is not None, (
        "rest_python_v0_1 not found in package registry — "
        "create packages/rest_python_v0_1/package.json first."
    )
    return pkg


# ---------------------------------------------------------------------------
# Default hyperparameters (must exactly match the package's declared defaults)
# ---------------------------------------------------------------------------

_DEFAULT_HP: dict = {
    "w_drowsiness": 0.40,
    "w_fatigue": 0.25,
    "w_driving_anomaly": 0.25,
    "w_future_fatigue": 0.10,
    "minimum_risk_for_rest_bonus": 0.45,
    "w_rest_window": 0.10,
    "w_rest_scarcity": 0.08,
    "w_monotony": 0.30,
    "w_familiar_route": 0.20,
    "w_attention_drop": 0.25,
    "w_traffic_jam": 0.15,
    "w_long_highway": 0.10,
    "threshold_suggest": 0.62,
    "threshold_recommend": 0.76,
    "threshold_urgent": 0.88,
    "require_rest_actionable": True,
    "rest_actionable_max_min": 30.0,
}

# Minimal proposal_history for full context shape
_EMPTY_PROPOSAL_HISTORY = {
    "lastProposalTimeSec": None,
    "lastProposalCategory": None,
    "lastProposalResult": None,
    "proposalCountLast30Min": 0,
    "acceptanceRateRecent": 0.0,
}


# ---------------------------------------------------------------------------
# Context builder helpers
# ---------------------------------------------------------------------------


def _norm_from_raw(raw: dict) -> dict:
    """Derive a feature_groups.normalized dict from raw sensor values."""
    drowsiness = float(raw.get("drowsinessLevel", 0.0))
    fatigue = float(raw.get("fatigueLevel", 0.0))
    attention = float(raw.get("attentionLevel", 100.0))
    steering = float(raw.get("steeringInstabilityLevel", 0.0))
    return {
        "drowsiness_score": min(1.0, max(0.0, drowsiness / 100.0)),
        "fatigue_score": min(1.0, max(0.0, fatigue / 100.0)),
        "attention_score": min(1.0, max(0.0, attention / 100.0)),
        "driving_anomaly_score": min(1.0, max(0.0, steering / 100.0)),
    }


def _make_full_context(raw_state: dict) -> dict:
    """Build a full tick context including all T005-injected fields."""
    return {
        "simulation_time_sec": 3600.0,
        "raw_state": raw_state,
        "feature_groups": {"normalized": _norm_from_raw(raw_state)},
        "proposal_history": _EMPTY_PROPOSAL_HISTORY,
        "user_action_history": [],
    }


# ---------------------------------------------------------------------------
# Reusable raw_states (matching test_weighted_score but with required speedKph)
# ---------------------------------------------------------------------------

# High risk — should trigger REST_PROPOSAL; actionable rest spot
_HIGH_RISK_RAW = {
    "drowsinessLevel": 80.0,
    "fatigueLevel": 70.0,
    "attentionLevel": 40.0,
    "steeringInstabilityLevel": 50.0,
    "pedalAbnormalityLevel": 0.0,
    "speedKph": 80.0,
    "nextRestSpotMin": 10.0,
    "isNight": False,
    "weatherRiskLevel": 0.0,
}

# Low risk — no trigger
_NO_TRIGGER_RAW = {
    "drowsinessLevel": 10.0,
    "fatigueLevel": 10.0,
    "attentionLevel": 90.0,
    "steeringInstabilityLevel": 0.0,
    "pedalAbnormalityLevel": 0.0,
    "speedKph": 60.0,
    "nextRestSpotMin": 5.0,
    "isNight": False,
    "weatherRiskLevel": 0.0,
}

# High risk but no rest spot — suppressed rest_required
_HIGH_RISK_NO_REST_RAW = {
    **_HIGH_RISK_RAW,
    "nextRestSpotMin": 9999.0,
}


# ---------------------------------------------------------------------------
# Parity helper
# ---------------------------------------------------------------------------


def _run_parity(raw_state: dict, pkg: PackageManifest):
    """Run weighted_score and rest_python_v0_1 on identical inputs; return both."""
    context = _make_full_context(raw_state)

    # Built-in weighted_score
    ws_result = ws_evaluate(
        context=context,
        parameters={},
        hyperparameters=_DEFAULT_HP,
    )

    # Python-module rest_python_v0_1 (via adapter dispatch)
    py_result = _pm.dispatch(
        package=pkg,
        context=context,
        parameters={},
        hyperparameters=_DEFAULT_HP,
        package_runtime_state={},
    )

    return ws_result, py_result


# ---------------------------------------------------------------------------
# T006 — Registry
# ---------------------------------------------------------------------------


def test_registry_lists_rest_python_v0_1():
    """PackageRegistry includes rest_python_v0_1 with algorithm_type == 'python_module'."""
    registry = PackageRegistry(settings.packages_dir)
    summaries = {s["id"]: s for s in registry.list_summaries()}
    assert "rest_python_v0_1" in summaries, (
        f"rest_python_v0_1 not found; known packages: {list(summaries.keys())}"
    )
    assert summaries["rest_python_v0_1"]["algorithm_type"] == "python_module"


# ---------------------------------------------------------------------------
# T006 — Parity: no-trigger case
# ---------------------------------------------------------------------------


def test_parity_no_trigger_result_type(rest_python_package):
    """Identical result_type on a no-trigger input."""
    ws_result, py_result = _run_parity(_NO_TRIGGER_RAW, rest_python_package)
    assert py_result.result_type == ws_result.result_type, (
        f"result_type: ws={ws_result.result_type!r}, py={py_result.result_type!r}"
    )


def test_parity_no_trigger_trigger_candidate(rest_python_package):
    """Identical trigger_candidate on a no-trigger input."""
    ws_result, py_result = _run_parity(_NO_TRIGGER_RAW, rest_python_package)
    assert py_result.trigger_candidate == ws_result.trigger_candidate


def test_parity_no_trigger_selected_category(rest_python_package):
    """Identical selected_category on a no-trigger input."""
    ws_result, py_result = _run_parity(_NO_TRIGGER_RAW, rest_python_package)
    assert py_result.selected_category == ws_result.selected_category


def test_parity_no_trigger_scores(rest_python_package):
    """Identical scores (within 1e-9) on a no-trigger input."""
    ws_result, py_result = _run_parity(_NO_TRIGGER_RAW, rest_python_package)
    for key in ("base_safety_risk", "rest_required_score", "monotony_prevention_score"):
        ws_s = ws_result.scores.get(key, 0.0)
        py_s = py_result.scores.get(key, 0.0)
        assert abs(ws_s - py_s) < 1e-9, (
            f"scores[{key!r}]: ws={ws_s}, py={py_s}, diff={abs(ws_s - py_s)}"
        )


# ---------------------------------------------------------------------------
# T006 — Parity: fired REST_PROPOSAL case
# ---------------------------------------------------------------------------


def test_parity_fired_rest_proposal_result_type(rest_python_package):
    """Identical result_type on high-risk (REST_PROPOSAL) input."""
    ws_result, py_result = _run_parity(_HIGH_RISK_RAW, rest_python_package)
    assert py_result.result_type == ws_result.result_type, (
        f"result_type: ws={ws_result.result_type!r}, py={py_result.result_type!r}"
    )


def test_parity_fired_rest_proposal_trigger_candidate(rest_python_package):
    """Identical trigger_candidate on high-risk input."""
    ws_result, py_result = _run_parity(_HIGH_RISK_RAW, rest_python_package)
    assert py_result.trigger_candidate == ws_result.trigger_candidate


def test_parity_fired_rest_proposal_selected_category(rest_python_package):
    """Identical selected_category on high-risk input."""
    ws_result, py_result = _run_parity(_HIGH_RISK_RAW, rest_python_package)
    assert py_result.selected_category == ws_result.selected_category


def test_parity_fired_rest_proposal_per_candidate_fire_control(rest_python_package):
    """Per-candidate fired/suppressed matches weighted_score on high-risk input."""
    ws_result, py_result = _run_parity(_HIGH_RISK_RAW, rest_python_package)
    ws_by_cat = {c.category: c for c in ws_result.candidates}
    py_by_cat = {c.category: c for c in py_result.candidates}
    for cat, ws_c in ws_by_cat.items():
        assert cat in py_by_cat, f"Candidate {cat!r} missing from py result"
        py_c = py_by_cat[cat]
        assert py_c.fire_control.fired == ws_c.fire_control.fired, (
            f"{cat}.fire_control.fired: ws={ws_c.fire_control.fired}, "
            f"py={py_c.fire_control.fired}"
        )
        assert py_c.fire_control.suppressed == ws_c.fire_control.suppressed, (
            f"{cat}.fire_control.suppressed: ws={ws_c.fire_control.suppressed}, "
            f"py={py_c.fire_control.suppressed}"
        )


def test_parity_fired_rest_proposal_scores(rest_python_package):
    """Identical scores (within 1e-9) on high-risk input."""
    ws_result, py_result = _run_parity(_HIGH_RISK_RAW, rest_python_package)
    for key in ("base_safety_risk", "rest_required_score", "monotony_prevention_score"):
        ws_s = ws_result.scores.get(key, 0.0)
        py_s = py_result.scores.get(key, 0.0)
        assert abs(ws_s - py_s) < 1e-9, (
            f"scores[{key!r}]: ws={ws_s}, py={py_s}, diff={abs(ws_s - py_s)}"
        )


# ---------------------------------------------------------------------------
# T006 — Parity: suppressed rest_required case
# ---------------------------------------------------------------------------


def test_parity_suppressed_rest_result_type(rest_python_package):
    """Identical result_type on high-risk / no-rest-spot (suppressed) input."""
    ws_result, py_result = _run_parity(_HIGH_RISK_NO_REST_RAW, rest_python_package)
    assert py_result.result_type == ws_result.result_type, (
        f"result_type: ws={ws_result.result_type!r}, py={py_result.result_type!r}"
    )


def test_parity_suppressed_rest_candidate_suppressed(rest_python_package):
    """rest_required candidate is suppressed in both results (no rest spot)."""
    ws_result, py_result = _run_parity(_HIGH_RISK_NO_REST_RAW, rest_python_package)
    ws_rest = next(
        (c for c in ws_result.candidates if c.category == "rest_required"), None
    )
    py_rest = next(
        (c for c in py_result.candidates if c.category == "rest_required"), None
    )
    if ws_rest is not None and ws_rest.fire_control.suppressed:
        assert py_rest is not None, "rest_required candidate missing in py result"
        assert py_rest.fire_control.suppressed, (
            "Expected rest_required to be suppressed in py result (no rest spot)"
        )


def test_parity_suppressed_rest_scores(rest_python_package):
    """Identical scores (within 1e-9) on suppressed input."""
    ws_result, py_result = _run_parity(_HIGH_RISK_NO_REST_RAW, rest_python_package)
    for key in ("base_safety_risk", "rest_required_score", "monotony_prevention_score"):
        ws_s = ws_result.scores.get(key, 0.0)
        py_s = py_result.scores.get(key, 0.0)
        assert abs(ws_s - py_s) < 1e-9, (
            f"scores[{key!r}]: ws={ws_s}, py={py_s}, diff={abs(ws_s - py_s)}"
        )


# ---------------------------------------------------------------------------
# T006 — Stateless: next_package_runtime_state == {}
# ---------------------------------------------------------------------------


def test_rest_python_stateless(rest_python_package):
    """rest_python_v0_1 is stateless: next_package_runtime_state == {}."""
    context = _make_full_context(_HIGH_RISK_RAW)
    py_result = _pm.dispatch(
        package=rest_python_package,
        context=context,
        parameters={},
        hyperparameters=_DEFAULT_HP,
        package_runtime_state={},
    )
    assert py_result.next_package_runtime_state == {}, (
        f"Expected empty runtime state, got: {py_result.next_package_runtime_state!r}"
    )


# ---------------------------------------------------------------------------
# T007 — tick_seconds precedence: package overrides scenario
# ---------------------------------------------------------------------------


def _make_synthetic_python_pkg(tick_seconds: int | None = None) -> PackageManifest:
    """Build a minimal valid python_module PackageManifest for tick_seconds testing.

    Compatible with uc01_fatigue scenarios. The algorithm.py doesn't need to exist
    for draft creation (no actual algorithm evaluation during plan freezing).
    """
    algorithm_kwargs = {"type": "python_module", "entrypoint": "algorithm.py"}
    if tick_seconds is not None:
        algorithm_kwargs["tick_seconds"] = tick_seconds

    # Re-use one hyperparameter to satisfy the PackageManifest validator
    return PackageManifest(
        id="test_tick_override_pkg",
        version="0.1.0",
        label={"ja": "テスト", "en": "Tick Test Package"},
        compatible_scenario_types=["uc01_fatigue"],
        algorithm=AlgorithmDef(**algorithm_kwargs),
        parameters=[],
        features=[FeatureDef(key="drowsiness_score", band_values=[])],
        hyperparameters=[
            HyperparameterDef(
                key="threshold_suggest",
                label={"ja": "閾値", "en": "Threshold"},
                kind="numeric",
                default=0.62,
                min=0.0,
                max=1.0,
                step=0.01,
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
                options=["accept_rest"],
            )
        ],
    )


def test_tick_seconds_package_overrides_scenario(uc01_scenario):
    """Package with tick_seconds=30 overrides scenario tick_seconds=60 in frozen plan."""
    assert uc01_scenario.tick_seconds == 60, (
        "Scenario must have tick_seconds=60 for this test to be meaningful"
    )

    pkg = _make_synthetic_python_pkg(tick_seconds=30)
    assert pkg.algorithm.tick_seconds == 30

    draft = create_draft(
        plan_id="plan_tick_override",
        package=pkg,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={"threshold_suggest": 0.62},
        run_mode="standard",
    )

    assert draft.validation_errors == [], (
        f"Unexpected draft validation errors: {draft.validation_errors}"
    )
    assert draft.draft_event_plan.tick_seconds == 30, (
        f"Expected tick_seconds=30 from package override, "
        f"got {draft.draft_event_plan.tick_seconds}"
    )


def test_tick_seconds_package_override_is_explicit_not_preset(uc01_scenario):
    """Package tick_seconds takes precedence even when no explicit preset is passed."""
    pkg = _make_synthetic_python_pkg(tick_seconds=15)

    draft = create_draft(
        plan_id="plan_tick_explicit",
        package=pkg,
        scenario=uc01_scenario,
        presets={},          # no explicit tick_seconds in presets
        parameters={},
        hyperparameters={"threshold_suggest": 0.62},
        run_mode="standard",
    )

    assert draft.validation_errors == []
    assert draft.draft_event_plan.tick_seconds == 15, (
        f"Expected 15 from package, got {draft.draft_event_plan.tick_seconds}"
    )


# ---------------------------------------------------------------------------
# T007 — tick_seconds precedence: no declaration → inherits scenario
# ---------------------------------------------------------------------------


def test_tick_seconds_no_package_declaration_inherits_scenario(uc01_scenario, rest_python_package):
    """rest_python_v0_1 (no tick_seconds) inherits scenario's tick_seconds=60."""
    assert rest_python_package.algorithm.tick_seconds is None, (
        "rest_python_v0_1 must not declare tick_seconds (it should inherit scenario)"
    )

    draft = create_draft(
        plan_id="plan_tick_inherit",
        package=rest_python_package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
    )

    assert draft.validation_errors == [], (
        f"Unexpected draft errors: {draft.validation_errors}"
    )
    assert draft.draft_event_plan.tick_seconds == 60, (
        f"Expected tick_seconds=60 (from scenario), "
        f"got {draft.draft_event_plan.tick_seconds}"
    )


def test_tick_seconds_synthetic_no_declaration_inherits_scenario(uc01_scenario):
    """Synthetic package with no tick_seconds declaration inherits scenario cadence."""
    pkg = _make_synthetic_python_pkg(tick_seconds=None)
    assert pkg.algorithm.tick_seconds is None

    draft = create_draft(
        plan_id="plan_tick_none",
        package=pkg,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={"threshold_suggest": 0.62},
        run_mode="standard",
    )

    assert draft.validation_errors == []
    assert draft.draft_event_plan.tick_seconds == 60, (
        f"Expected 60 from scenario, got {draft.draft_event_plan.tick_seconds}"
    )
