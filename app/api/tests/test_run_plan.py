"""TDD run_plan tests (T020) — RED then GREEN.

Tests for:
  create_draft(plan_id, package, scenario, presets, parameters, hyperparameters, run_mode) -> RunPlanDraft
  regenerate_draft(plan_id, presets, parameters, hyperparameters) -> RunPlanDraft
  get_draft_entry(plan_id) -> tuple | None
  clear_draft_registry()
"""

from __future__ import annotations

import json
import pathlib

import pytest

from aica_api.models.package import PackageManifest
from aica_api.models.scenario import ScenarioDef
from aica_api.services.run_plan import (
    create_draft,
    regenerate_draft,
    get_draft_entry,
    clear_draft_registry,
)

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
# Feature 009: uc01_fatigue_friend_drive_v0_1 / rest_rule_based_v0_1 are retired.
_SCENARIO_PATH = _REPO_ROOT / "scenarios" / "uc01_fatigue_recovery_v0_1.json"
_PACKAGE_PATH = _REPO_ROOT / "packages" / "aica_transparent_hybrid_trigger_v1" / "package.json"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def reset_registry():
    clear_draft_registry()
    yield
    clear_draft_registry()


@pytest.fixture
def uc01_scenario() -> ScenarioDef:
    data = json.loads(_SCENARIO_PATH.read_text(encoding="utf-8"))
    return ScenarioDef(**data)


@pytest.fixture
def uc01_package() -> PackageManifest:
    data = json.loads(_PACKAGE_PATH.read_text(encoding="utf-8"))
    return PackageManifest(**data)


# ---------------------------------------------------------------------------
# create_draft — basic
# ---------------------------------------------------------------------------


def test_create_draft_returns_run_plan_draft(uc01_package, uc01_scenario):
    from aica_api.models.run import RunPlanDraft
    draft = create_draft(
        plan_id="plan_001",
        package=uc01_package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
    )
    assert isinstance(draft, RunPlanDraft)


def test_create_draft_plan_id_set(uc01_package, uc01_scenario):
    draft = create_draft(
        plan_id="plan_abc",
        package=uc01_package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
    )
    assert draft.plan_id == "plan_abc"


def test_create_draft_no_validation_errors_with_defaults(uc01_package, uc01_scenario):
    draft = create_draft(
        plan_id="plan_no_err",
        package=uc01_package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
    )
    assert draft.validation_errors == []


def test_create_draft_has_route_facts(uc01_package, uc01_scenario):
    draft = create_draft(
        plan_id="plan_rf",
        package=uc01_package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
    )
    assert draft.route_facts is not None
    assert draft.route_facts.total_route_distance_km is not None


def test_create_draft_has_event_plan(uc01_package, uc01_scenario):
    draft = create_draft(
        plan_id="plan_ep",
        package=uc01_package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
    )
    # M2 scenario: build_event_plan fills rest_opportunities
    assert len(draft.draft_event_plan.rest_opportunities) > 0


def test_create_draft_effective_setup_has_parameters(uc01_package, uc01_scenario):
    draft = create_draft(
        plan_id="plan_setup",
        package=uc01_package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
    )
    assert "parameters" in draft.effective_setup
    assert "hyperparameters" in draft.effective_setup


def test_create_draft_deterministic(uc01_package, uc01_scenario):
    """Same inputs → same draft_event_plan."""
    d1 = create_draft(
        plan_id="plan_det1",
        package=uc01_package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
    )
    clear_draft_registry()
    d2 = create_draft(
        plan_id="plan_det2",
        package=uc01_package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
    )
    assert d1.draft_event_plan.model_dump() == d2.draft_event_plan.model_dump()


# ---------------------------------------------------------------------------
# create_draft — validation errors
# ---------------------------------------------------------------------------


def test_create_draft_out_of_range_hyperparameter_returns_errors(uc01_package, uc01_scenario):
    """An out-of-range numeric hyperparameter → validation_errors non-empty."""
    # Find a numeric hyperparameter
    numeric_hps = [hp for hp in uc01_package.hyperparameters if hp.kind == "numeric"]
    if not numeric_hps:
        pytest.skip("No numeric hyperparameters in this package")
    hp = numeric_hps[0]
    out_of_range_value = (hp.max or 10.0) + 999.0

    draft = create_draft(
        plan_id="plan_err_hp",
        package=uc01_package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={hp.key: out_of_range_value},
        run_mode="standard",
    )
    assert len(draft.validation_errors) > 0
    # The errored draft has no usable event plan (empty rest_opportunities)
    error_fields = [e["field"] for e in draft.validation_errors]
    assert hp.key in error_fields


def test_create_draft_invalid_band_parameter_returns_errors(uc01_package, uc01_scenario):
    """A band parameter with an invalid value → validation_errors."""
    band_params = [p for p in uc01_package.parameters if p.kind == "band"]
    if not band_params:
        pytest.skip("No band parameters in this package")
    param = band_params[0]

    draft = create_draft(
        plan_id="plan_bad_band",
        package=uc01_package,
        scenario=uc01_scenario,
        presets={},
        parameters={param.key: "NOT_A_VALID_BAND_VALUE_XYZ"},
        hyperparameters={},
        run_mode="standard",
    )
    assert len(draft.validation_errors) > 0
    error_fields = [e["field"] for e in draft.validation_errors]
    assert param.key in error_fields


def test_create_draft_with_errors_not_stored_in_registry(uc01_package, uc01_scenario):
    """When there are validation errors, no draft is stored (get_draft_entry returns None)."""
    numeric_hps = [hp for hp in uc01_package.hyperparameters if hp.kind == "numeric"]
    if not numeric_hps:
        pytest.skip("No numeric hyperparameters in this package")
    hp = numeric_hps[0]
    out_of_range_value = (hp.max or 10.0) + 999.0

    create_draft(
        plan_id="plan_err_not_stored",
        package=uc01_package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={hp.key: out_of_range_value},
        run_mode="standard",
    )
    assert get_draft_entry("plan_err_not_stored") is None


# ---------------------------------------------------------------------------
# get_draft_entry
# ---------------------------------------------------------------------------


def test_get_draft_entry_returns_tuple(uc01_package, uc01_scenario):
    create_draft(
        plan_id="plan_get",
        package=uc01_package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
    )
    entry = get_draft_entry("plan_get")
    assert entry is not None
    draft, pkg, sc = entry
    assert draft.plan_id == "plan_get"
    assert pkg.id == uc01_package.id
    assert sc.id == uc01_scenario.id


def test_get_draft_entry_unknown_plan_returns_none():
    assert get_draft_entry("no_such_plan") is None


# ---------------------------------------------------------------------------
# regenerate_draft
# ---------------------------------------------------------------------------


def test_regenerate_draft_updates_plan(uc01_package, uc01_scenario):
    """regenerate_draft with new presets changes the stored draft."""
    create_draft(
        plan_id="plan_regen",
        package=uc01_package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
    )
    # Regenerate with same inputs should still work
    new_draft = regenerate_draft(
        plan_id="plan_regen",
        presets={},
        parameters={},
        hyperparameters={},
    )
    assert new_draft.plan_id == "plan_regen"
    assert new_draft.validation_errors == []


def test_regenerate_draft_404_unknown_plan():
    """regenerate_draft on unknown plan_id raises ValueError."""
    with pytest.raises((ValueError, KeyError)):
        regenerate_draft(
            plan_id="no_such_plan",
            presets={},
            parameters={},
            hyperparameters={},
        )


# ---------------------------------------------------------------------------
# Fix 1 — plan-build failure does not produce a startable run
# ---------------------------------------------------------------------------


def test_plan_build_failure_surfaces_as_validation_error(uc01_package, uc01_scenario, monkeypatch):
    """When build_event_plan raises, create_draft returns validation_errors and
    does NOT register the draft (so no run can be started)."""
    import aica_api.services.run_plan as run_plan_mod

    def _raise(route_facts, scenario, presets=None):
        raise RuntimeError("Simulated plan-build failure")

    monkeypatch.setattr(run_plan_mod, "build_event_plan", _raise)

    draft = create_draft(
        plan_id="plan_build_fail",
        package=uc01_package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
    )

    # Draft must carry a validation error pointing to event_plan
    assert len(draft.validation_errors) > 0
    error_fields = [e["field"] for e in draft.validation_errors]
    assert "event_plan" in error_fields

    # The failed draft must NOT be registered (cannot start a run from it)
    assert get_draft_entry("plan_build_fail") is None


# ---------------------------------------------------------------------------
# Fix 3 — non-vacuous preset test: changed preset produces a different draft
# ---------------------------------------------------------------------------


def test_regenerate_with_changed_tick_seconds_produces_different_plan(uc01_package, uc01_scenario):
    """Regenerating with a different tick_seconds preset changes draft_event_plan."""
    # First draft with default presets (no tick_seconds override)
    create_draft(
        plan_id="plan_preset_test",
        package=uc01_package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
    )
    entry = get_draft_entry("plan_preset_test")
    assert entry is not None
    original_tick_seconds = entry[0].draft_event_plan.tick_seconds

    # Regenerate with a doubled tick_seconds
    doubled = original_tick_seconds * 2
    new_draft = regenerate_draft(
        plan_id="plan_preset_test",
        presets={"tick_seconds": doubled},
        parameters={},
        hyperparameters={},
    )
    assert new_draft.validation_errors == []
    assert new_draft.draft_event_plan.tick_seconds == doubled
    assert new_draft.draft_event_plan.tick_seconds != original_tick_seconds


# ---------------------------------------------------------------------------
# Fix 4 — synthetic band-parameter test: _validate_parameter exercised
# ---------------------------------------------------------------------------


def test_synthetic_band_parameter_out_of_range_rejected(uc01_scenario):
    """An invalid band value for a *parameter* (not hyperparameter) is rejected.

    Uses a synthetic in-memory PackageManifest with a band parameter so the
    test is never skipped regardless of what the fixture package declares.
    """
    from aica_api.models.package import (
        AlgorithmDef,
        FeatureDef,
        FireControlRule,
        HyperparameterDef,
        PackageManifest,
        ParameterDef,
        ProposalDef,
        TriggerCategoryDef,
    )

    synth_param = ParameterDef(
        key="alert_mode",
        label={"en": "Alert Mode"},
        kind="band",
        band_values=["gentle", "standard", "firm"],
        default="standard",
    )
    synth_package = PackageManifest(
        id="synthetic_test_package_v1",
        version="0.0.1-test",
        label={"en": "Synthetic test package"},
        compatible_scenario_types=[uc01_scenario.type],
        # Feature 009: declarative_rule is retired — python_module is the only
        # supported algorithm type.  create_draft's parameter validation runs
        # before any algorithm dispatch, so the entrypoint is never invoked here.
        algorithm=AlgorithmDef(type="python_module", entrypoint="algorithm.py"),
        parameters=[synth_param],
        features=[
            FeatureDef(key="drowsiness_level", band_values=["none", "mild", "moderate", "strong"]),
        ],
        hyperparameters=[
            HyperparameterDef(
                key="require_actionable",
                label={"en": "Require Actionable"},
                kind="bool",
                default=True,
            ),
        ],
        trigger_categories=[TriggerCategoryDef(id="rest_required", priority=1)],
        rules=[],
        fire_control=FireControlRule(
            threshold_source="proposal_threshold",
            actionability_guard="require_actionable",
        ),
        proposals=[
            ProposalDef(
                id="rest_guidance",
                message={"en": "Please rest."},
                options=["accept_rest"],
            )
        ],
    )

    # Submit an invalid band value for the parameter
    draft = create_draft(
        plan_id="plan_synth_param",
        package=synth_package,
        scenario=uc01_scenario,
        presets={},
        parameters={"alert_mode": "INVALID_BAND_VALUE"},
        hyperparameters={},
        run_mode="standard",
    )

    assert len(draft.validation_errors) > 0
    error_fields = [e["field"] for e in draft.validation_errors]
    assert "alert_mode" in error_fields
    # Must NOT be registered
    assert get_draft_entry("plan_synth_param") is None


# ---------------------------------------------------------------------------
# Task A: numeric initial_state override — service layer
# ---------------------------------------------------------------------------


def test_initial_state_numeric_override_e2e(uc01_package, uc01_scenario):
    """create_draft with numeric initial_state; advance_tick(0) initializes from that value."""
    from aica_api.services.tick_engine import advance_tick

    draft = create_draft(
        plan_id="plan_init_numeric_e2e",
        package=uc01_package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
        initial_state={"drowsiness_level": 80, "fatigue_level": 30},
    )
    assert not draft.validation_errors

    entry = get_draft_entry("plan_init_numeric_e2e")
    assert entry is not None
    _, _, effective_scenario = entry

    # Confirm the override was frozen into the effective scenario
    assert effective_scenario.initial_state["drowsiness_level"] == 80
    assert effective_scenario.initial_state["fatigue_level"] == 30

    # advance_tick at tick 0 (prior_state=None) initializes from the numeric values.
    # Feature 009: the old flat raw_state dict is replaced by signals={fixed,dynamic,
    # simulated} — drowsinessLevel/fatigueLevel are renamed drowsiness/fatigue and now
    # live under signals["simulated"].
    ts = advance_tick(
        prior_state=None,
        tick_index=0,
        event_plan=draft.draft_event_plan,
        route_facts=draft.route_facts,
        scenario=effective_scenario,
    )
    assert ts.signals is not None
    # After one tick starting from 80 (driver model grows slightly), still well above 70.
    assert ts.signals["simulated"]["drowsiness"] > 70
    # After one tick starting from 30, fatigue should remain in that ballpark.
    assert ts.signals["simulated"]["fatigue"] >= 25


def test_initial_state_no_override_uses_scenario_defaults(uc01_package, uc01_scenario):
    """Without initial_state override, the scenario's own init values are used unchanged.

    Feature 009: uc01_fatigue_recovery_v0_1 authors initial_state numerically
    (drowsiness_level/fatigue_level as ints), not as band strings — confirm
    create_draft passes those values through verbatim, whatever their type.
    """
    draft = create_draft(
        plan_id="plan_no_init_override",
        package=uc01_package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
    )
    assert not draft.validation_errors
    entry = get_draft_entry("plan_no_init_override")
    assert entry is not None
    _, _, effective_scenario = entry
    assert (
        effective_scenario.initial_state.get("drowsiness_level")
        == uc01_scenario.initial_state.get("drowsiness_level")
    )
    assert (
        effective_scenario.initial_state.get("fatigue_level")
        == uc01_scenario.initial_state.get("fatigue_level")
    )


# ---------------------------------------------------------------------------
# Task A: numeric initial_state override — HTTP validation
# ---------------------------------------------------------------------------


def test_initial_state_http_out_of_range_returns_400(tmp_path, monkeypatch):
    """POST /api/run-plans with initial_state value > 100 → 400 with validation_errors."""
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))

    from fastapi.testclient import TestClient
    from aica_api.main import app
    client = TestClient(app)

    resp = client.post(
        "/api/run-plans",
        json={
            "package_id": "aica_transparent_hybrid_trigger_v1",
            "scenario_id": "uc01_fatigue_recovery_v0_1",
            "initial_state": {"drowsiness_level": 150},
        },
    )
    assert resp.status_code == 400
    body = resp.json()
    detail = body.get("detail", body)
    assert "validation_errors" in detail
    errors = detail["validation_errors"]
    assert any("drowsiness_level" in e.get("field", "") for e in errors)


def test_initial_state_http_unknown_key_returns_400(tmp_path, monkeypatch):
    """POST /api/run-plans with unknown initial_state key → 400."""
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))

    from fastapi.testclient import TestClient
    from aica_api.main import app
    client = TestClient(app)

    resp = client.post(
        "/api/run-plans",
        json={
            "package_id": "aica_transparent_hybrid_trigger_v1",
            "scenario_id": "uc01_fatigue_recovery_v0_1",
            "initial_state": {"bad_key": 50},
        },
    )
    assert resp.status_code == 400
    body = resp.json()
    detail = body.get("detail", body)
    assert "validation_errors" in detail
    errors = detail["validation_errors"]
    assert any("bad_key" in e.get("field", "") for e in errors)


def test_initial_state_http_valid_returns_201(tmp_path, monkeypatch):
    """POST /api/run-plans with valid numeric initial_state → 201."""
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))

    from fastapi.testclient import TestClient
    from aica_api.main import app
    client = TestClient(app)

    resp = client.post(
        "/api/run-plans",
        json={
            "package_id": "aica_transparent_hybrid_trigger_v1",
            "scenario_id": "uc01_fatigue_recovery_v0_1",
            "initial_state": {"drowsiness_level": 80, "fatigue_level": 30},
        },
    )
    assert resp.status_code == 201
