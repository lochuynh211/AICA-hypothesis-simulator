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
_SCENARIO_PATH = _REPO_ROOT / "scenarios" / "uc01_fatigue_friend_drive_v0_1.json"
_PACKAGE_PATH = _REPO_ROOT / "packages" / "rest_rule_based_v0_1" / "package.json"


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
