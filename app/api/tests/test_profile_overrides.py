"""TDD profile-override tests (T008 / U5) — RED then GREEN.

Tests that setup-time driver/vehicle/speed profile overrides are:
  - Accepted in CreateRunPlanBody.profiles (typed, optional per sub-object)
  - Deep-merged onto the scenario profile (unset fields keep scenario defaults)
  - Validated against the existing profile models (invalid → no run created)
  - Frozen into the run snapshot / RunLog at run start
  - Consumed by the tick engine (tick values reflect the override, not scenario default)
  - No-override → identical behaviour to pre-override code (back-compat)

Partial-override semantics: each provided profile dict is deep-merged onto the
scenario profile dict field-by-field (including nested dicts). Unset fields keep
the scenario value. After merging, the whole merged dict is validated against the
typed profile model. Invalid merged result → validation_errors, NO run created.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from aica_api.models.package import PackageManifest
from aica_api.models.run import RunState
from aica_api.models.scenario import ScenarioDef
from aica_api.services.run_manager import (
    clear_registry,
    create_run,
    tick,
)
from aica_api.services.run_plan import clear_draft_registry, create_draft, get_draft_entry, regenerate_draft

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_SCENARIO_PATH = _REPO_ROOT / "scenarios" / "uc01_fatigue_friend_drive_v0_1.json"
_PACKAGE_PATH = _REPO_ROOT / "packages" / "rest_rule_based_v0_1" / "package.json"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def reset_registries():
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


@pytest.fixture
def uc01_package() -> PackageManifest:
    data = json.loads(_PACKAGE_PATH.read_text(encoding="utf-8"))
    return PackageManifest(**data)


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _plan_and_run(package, scenario, run_id, tmp_path, profiles=None):
    """Create a draft plan and a run from it, optionally with profile overrides."""
    plan_id = f"plan_{run_id}"
    draft = create_draft(
        plan_id=plan_id,
        package=package,
        scenario=scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
        profiles=profiles,
    )
    assert not draft.validation_errors, f"Unexpected validation errors: {draft.validation_errors}"
    return create_run(plan_id, run_id, tmp_path)


def _run_one_tick(run_id):
    """Run a single tick and return the TickOutcome."""
    return tick(run_id)


# ---------------------------------------------------------------------------
# T008-1: Speed override changes engine tick values
# ---------------------------------------------------------------------------


def test_speed_override_changes_tick_speed(tmp_path, uc01_package, uc01_scenario):
    """A speed override causes the tick engine to use the overridden speed.

    Scenario default: normal_road_kph=60.  Override: normal_road_kph=120.
    After tick 0 (first segment = normal_road), raw_state["speedKph"] should
    be 120 for the override run and 60 for the baseline.
    """
    from aica_api.services.run_manager import get_active_run_log

    # Baseline run — no override
    baseline_state = _plan_and_run(uc01_package, uc01_scenario, "run_baseline", tmp_path)
    tick(baseline_state.run_id)

    # Override run — double normal_road speed
    overridden_state = _plan_and_run(
        uc01_package, uc01_scenario, "run_override_speed", tmp_path,
        profiles={"speed": {"normal_road_kph": 120}},
    )
    tick(overridden_state.run_id)

    # Read raw tick state from the recorder
    baseline_log = get_active_run_log(baseline_state.run_id)
    override_log = get_active_run_log(overridden_state.run_id)

    baseline_tick = [e for e in baseline_log.events if e.kind == "tick"][0]
    override_tick = [e for e in override_log.events if e.kind == "tick"][0]

    # Baseline should use scenario default (60 kph); override should use 120 kph
    assert baseline_tick.raw_state["speedKph"] == 60
    assert override_tick.raw_state["speedKph"] == 120

    # The overridden RunState snapshot also reflects the override
    assert overridden_state.speed_profile is not None
    assert overridden_state.speed_profile["normal_road_kph"] == 120


def test_speed_override_distance_larger_than_baseline(tmp_path, uc01_package, uc01_scenario):
    """With a higher normal_road speed, one tick covers more distance than baseline."""
    # Baseline: normal_road_kph=60
    baseline_state = _plan_and_run(uc01_package, uc01_scenario, "run_dist_base", tmp_path)
    baseline_outcome = tick(baseline_state.run_id)

    # Override: normal_road_kph=120 (double)
    override_state = _plan_and_run(
        uc01_package, uc01_scenario, "run_dist_override", tmp_path,
        profiles={"speed": {"normal_road_kph": 120}},
    )
    override_outcome = tick(override_state.run_id)

    # Get distance_km from the EvidenceRecorder's RunLog (tick events are recorded there)
    from aica_api.services.run_manager import get_active_run_log
    baseline_log = get_active_run_log(baseline_state.run_id)
    override_log = get_active_run_log(override_state.run_id)

    baseline_tick_events = [e for e in baseline_log.events if e.kind == "tick"]
    override_tick_events = [e for e in override_log.events if e.kind == "tick"]

    assert len(baseline_tick_events) == 1
    assert len(override_tick_events) == 1

    baseline_distance = baseline_tick_events[0].tick_state.distance_km
    override_distance = override_tick_events[0].tick_state.distance_km

    # Override should cover exactly double the distance (120 vs 60 kph on same segment)
    assert override_distance == pytest.approx(baseline_distance * 2, rel=1e-6)


# ---------------------------------------------------------------------------
# T008-2: Driver override changes drowsiness growth
# ---------------------------------------------------------------------------


def test_driver_override_changes_drowsiness_growth(tmp_path, uc01_package, uc01_scenario):
    """A driver override causes faster drowsiness growth in the tick engine.

    Scenario default: base_growth_per_min=0.9.  Override: 9.0 (10x).
    Initial drowsiness = 0.0 (initial_state.drowsiness_level="none").
    After tick 0 (5 min of tick_seconds=300):
      baseline: 0.0 + 0.9 * 5 = 4.5
      override: 0.0 + 9.0 * 5 = 45.0
    """
    # Baseline
    baseline_state = _plan_and_run(uc01_package, uc01_scenario, "run_drown_base", tmp_path)
    tick(baseline_state.run_id)

    # Override: 10x drowsiness growth
    override_state = _plan_and_run(
        uc01_package, uc01_scenario, "run_drown_override", tmp_path,
        profiles={"driver": {"drowsiness_model": {"base_growth_per_min": 9.0}}},
    )
    tick(override_state.run_id)

    from aica_api.services.run_manager import get_active_run_log
    baseline_log = get_active_run_log(baseline_state.run_id)
    override_log = get_active_run_log(override_state.run_id)

    baseline_tick = [e for e in baseline_log.events if e.kind == "tick"][0]
    override_tick = [e for e in override_log.events if e.kind == "tick"][0]

    baseline_drowsiness = baseline_tick.raw_state["drowsinessLevel"]
    override_drowsiness = override_tick.raw_state["drowsinessLevel"]

    # Override drowsiness must be substantially higher (10x growth rate)
    assert override_drowsiness > baseline_drowsiness * 5, (
        f"Expected override ({override_drowsiness:.2f}) >> baseline ({baseline_drowsiness:.2f})"
    )


# ---------------------------------------------------------------------------
# T008-3: Partial override deep-merges onto scenario (unset fields preserved)
# ---------------------------------------------------------------------------


def test_partial_speed_override_preserves_unset_fields(tmp_path, uc01_package, uc01_scenario):
    """Partial speed override: only highway_kph overridden; other fields keep scenario values."""
    scenario_normal_road = uc01_scenario.speed_profile.normal_road_kph  # 60
    scenario_mountain = uc01_scenario.speed_profile.mountain_road_kph   # 40

    state = _plan_and_run(
        uc01_package, uc01_scenario, "run_partial_speed", tmp_path,
        profiles={"speed": {"highway_kph": 200}},
    )

    sp = state.speed_profile
    assert sp is not None
    assert sp["highway_kph"] == 200, "Override should be applied"
    assert sp["normal_road_kph"] == scenario_normal_road, "Unset field should keep scenario value"
    assert sp["mountain_road_kph"] == scenario_mountain, "Unset field should keep scenario value"


def test_partial_driver_override_preserves_unset_sub_fields(tmp_path, uc01_package, uc01_scenario):
    """Partial driver override: only one drowsiness_model field; others from scenario."""
    scenario_night_add = uc01_scenario.driver_profile.drowsiness_model.night_add_per_min  # 0.3

    state = _plan_and_run(
        uc01_package, uc01_scenario, "run_partial_driver", tmp_path,
        profiles={"driver": {"drowsiness_model": {"base_growth_per_min": 5.0}}},
    )

    dp = state.driver_profile
    assert dp is not None
    assert dp["drowsiness_model"]["base_growth_per_min"] == 5.0, "Override should be applied"
    assert dp["drowsiness_model"]["night_add_per_min"] == scenario_night_add, (
        "Unset sub-field should keep scenario value"
    )


# ---------------------------------------------------------------------------
# T008-4: Invalid override → validation error, NO run created
# ---------------------------------------------------------------------------


def test_invalid_negative_driver_field_rejected(uc01_package, uc01_scenario, tmp_path):
    """Negative rate in driver override violates nonneg validator → validation error."""
    plan_id = "plan_invalid_neg"
    draft = create_draft(
        plan_id=plan_id,
        package=uc01_package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
        profiles={"driver": {"drowsiness_model": {"base_growth_per_min": -1.0}}},
    )

    assert draft.validation_errors, "Negative rate must produce a validation error"
    assert any("profiles.driver" in e.get("field", "") for e in draft.validation_errors)
    # Draft must NOT be in registry — no run can be created
    assert get_draft_entry(plan_id) is None, "Invalid draft must not be registered"


def test_invalid_extra_speed_field_rejected(uc01_package, uc01_scenario, tmp_path):
    """Unknown field in speed override violates extra='forbid' → validation error."""
    plan_id = "plan_invalid_extra"
    draft = create_draft(
        plan_id=plan_id,
        package=uc01_package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
        profiles={"speed": {"nonexistent_kph": 999}},
    )

    assert draft.validation_errors, "Unknown field must produce a validation error"
    assert any("profiles.speed" in e.get("field", "") for e in draft.validation_errors)
    assert get_draft_entry(plan_id) is None, "Invalid draft must not be registered"


def test_invalid_vehicle_negative_field_rejected(uc01_package, uc01_scenario, tmp_path):
    """Negative value in vehicle override violates nonneg → validation error."""
    plan_id = "plan_invalid_vehicle"
    draft = create_draft(
        plan_id=plan_id,
        package=uc01_package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
        profiles={"vehicle": {"steering_instability": {"base_level": -5.0}}},
    )

    assert draft.validation_errors, "Negative vehicle field must produce a validation error"
    assert any("profiles.vehicle" in e.get("field", "") for e in draft.validation_errors)
    assert get_draft_entry(plan_id) is None, "Invalid draft must not be registered"


# ---------------------------------------------------------------------------
# T008-5: Effective profiles frozen in snapshot (RunState + RunLog)
# ---------------------------------------------------------------------------


def test_effective_speed_profile_frozen_in_run_state(tmp_path, uc01_package, uc01_scenario):
    """After creating a run with a speed override, RunState.speed_profile reflects the override."""
    state = _plan_and_run(
        uc01_package, uc01_scenario, "run_frozen_speed", tmp_path,
        profiles={"speed": {"highway_kph": 199}},
    )

    assert state.speed_profile is not None
    assert state.speed_profile["highway_kph"] == 199


def test_effective_driver_profile_frozen_in_run_state(tmp_path, uc01_package, uc01_scenario):
    """After creating a run with a driver override, RunState.driver_profile reflects it."""
    state = _plan_and_run(
        uc01_package, uc01_scenario, "run_frozen_driver", tmp_path,
        profiles={"driver": {"drowsiness_model": {"base_growth_per_min": 7.7}}},
    )

    assert state.driver_profile is not None
    assert state.driver_profile["drowsiness_model"]["base_growth_per_min"] == 7.7


def test_effective_profiles_visible_in_run_log(tmp_path, uc01_package, uc01_scenario):
    """After creating a run with overrides, RunLog.speed_profile reflects the effective values."""
    state = _plan_and_run(
        uc01_package, uc01_scenario, "run_log_profile", tmp_path,
        profiles={"speed": {"highway_kph": 155}},
    )
    # Run a tick to have a persisted log
    tick(state.run_id)

    from aica_api.services.run_manager import get_active_run_log
    log = get_active_run_log(state.run_id)

    assert log is not None
    assert log.speed_profile is not None
    assert log.speed_profile["highway_kph"] == 155


# ---------------------------------------------------------------------------
# T008-6: No override → same behaviour as today (back-compat regression guard)
# ---------------------------------------------------------------------------


def test_no_override_same_as_baseline(tmp_path, uc01_package, uc01_scenario):
    """No profiles → same tick decisions as before (back-compat regression)."""
    # Two baseline runs — no override at all
    state_a = _plan_and_run(uc01_package, uc01_scenario, "run_compat_a", tmp_path)
    outcome_a = tick(state_a.run_id)

    state_b = _plan_and_run(uc01_package, uc01_scenario, "run_compat_b", tmp_path)
    outcome_b = tick(state_b.run_id)

    from aica_api.services.run_manager import get_active_run_log
    log_a = get_active_run_log(state_a.run_id)
    log_b = get_active_run_log(state_b.run_id)

    tick_a = [e for e in log_a.events if e.kind == "tick"][0]
    tick_b = [e for e in log_b.events if e.kind == "tick"][0]

    assert tick_a.raw_state["drowsinessLevel"] == tick_b.raw_state["drowsinessLevel"]
    assert tick_a.raw_state["speedKph"] == tick_b.raw_state["speedKph"]
    assert tick_a.tick_state.distance_km == tick_b.tick_state.distance_km


def test_null_profiles_accepted_same_as_no_profiles(tmp_path, uc01_package, uc01_scenario):
    """profiles=None is equivalent to no override — no validation errors, run created."""
    plan_id = "plan_null_profiles"
    draft = create_draft(
        plan_id=plan_id,
        package=uc01_package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
        profiles=None,
    )
    assert not draft.validation_errors
    assert get_draft_entry(plan_id) is not None


# ---------------------------------------------------------------------------
# T008-7: effective_setup in draft reflects overrides
# ---------------------------------------------------------------------------


def test_effective_setup_reflects_speed_override(uc01_package, uc01_scenario):
    """effective_setup.speed_profile in the draft reflects the override value."""
    plan_id = "plan_eff_setup"
    draft = create_draft(
        plan_id=plan_id,
        package=uc01_package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
        profiles={"speed": {"highway_kph": 150}},
    )
    assert not draft.validation_errors
    sp = draft.effective_setup.get("speed_profile")
    assert sp is not None
    assert sp["highway_kph"] == 150


# ---------------------------------------------------------------------------
# T008-8: API-level (router) profile validation returns 400, no run created
# ---------------------------------------------------------------------------


def test_api_invalid_profile_returns_400(tmp_path, monkeypatch):
    """POST /api/run-plans with invalid profiles returns 400 (via TestClient)."""
    import os
    os.environ["AICA_RUNS_DIR"] = str(tmp_path)
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))

    from fastapi.testclient import TestClient
    from aica_api.main import app
    client = TestClient(app)

    resp = client.post(
        "/api/run-plans",
        json={
            "package_id": "rest_rule_based_v0_1",
            "scenario_id": "uc01_fatigue_friend_drive_v0_1",
            "profiles": {
                "speed": {"nonexistent_field": 999}
            },
        },
    )
    assert resp.status_code == 400
    body = resp.json()
    assert "validation_errors" in body.get("detail", body)


def test_api_valid_profile_returns_201(tmp_path, monkeypatch):
    """POST /api/run-plans with valid profiles returns 201."""
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))

    from fastapi.testclient import TestClient
    from aica_api.main import app
    client = TestClient(app)

    resp = client.post(
        "/api/run-plans",
        json={
            "package_id": "rest_rule_based_v0_1",
            "scenario_id": "uc01_fatigue_friend_drive_v0_1",
            "profiles": {
                "speed": {"highway_kph": 150},
            },
        },
    )
    assert resp.status_code == 201


# ---------------------------------------------------------------------------
# T008-9 (IMPORTANT): extra fields in driver/vehicle profiles are rejected
# ---------------------------------------------------------------------------


def test_invalid_extra_driver_field_rejected(uc01_package, uc01_scenario, tmp_path):
    """Unknown field in a nested driver override violates extra='forbid' → validation error.

    Mirrors test_invalid_extra_speed_field_rejected but for the driver profile.
    A typo'd key (basse_growth_per_min) must produce a validation error and
    prevent the draft from being registered.
    """
    plan_id = "plan_invalid_extra_driver"
    draft = create_draft(
        plan_id=plan_id,
        package=uc01_package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
        profiles={"driver": {"drowsiness_model": {"basse_growth_per_min": 1.0}}},
    )

    assert draft.validation_errors, "Unknown driver field must produce a validation error"
    assert any("profiles.driver" in e.get("field", "") for e in draft.validation_errors), (
        f"Expected 'profiles.driver' in error fields, got: {draft.validation_errors}"
    )
    assert get_draft_entry(plan_id) is None, "Invalid draft must not be registered"


def test_invalid_extra_vehicle_field_rejected(uc01_package, uc01_scenario, tmp_path):
    """Unknown field in a nested vehicle override violates extra='forbid' → validation error.

    A typo'd key (baes_level) inside steering_instability must produce a validation
    error and prevent the draft from being registered.
    """
    plan_id = "plan_invalid_extra_vehicle"
    draft = create_draft(
        plan_id=plan_id,
        package=uc01_package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
        profiles={"vehicle": {"steering_instability": {"baes_level": 5.0}}},
    )

    assert draft.validation_errors, "Unknown vehicle field must produce a validation error"
    assert any("profiles.vehicle" in e.get("field", "") for e in draft.validation_errors), (
        f"Expected 'profiles.vehicle' in error fields, got: {draft.validation_errors}"
    )
    assert get_draft_entry(plan_id) is None, "Invalid draft must not be registered"


# ---------------------------------------------------------------------------
# T008-10 (Minor 2): profile overrides survive regenerate_draft
# ---------------------------------------------------------------------------


def test_overrides_survive_regenerate_draft(tmp_path, uc01_package, uc01_scenario):
    """Profile overrides applied at create_draft remain in effect after regenerate_draft.

    Flow: create_draft with speed override → regenerate_draft (change presets) →
    create_run → tick → assert override speedKph is used in the tick engine.
    """
    from aica_api.services.run_manager import get_active_run_log

    plan_id = "plan_regen_override"

    # 1. Create draft with speed override (normal_road_kph=120)
    draft_v1 = create_draft(
        plan_id=plan_id,
        package=uc01_package,
        scenario=uc01_scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
        profiles={"speed": {"normal_road_kph": 120}},
    )
    assert not draft_v1.validation_errors, f"Unexpected errors: {draft_v1.validation_errors}"

    # 2. Regenerate the draft (different preset/parameters — no new profiles arg).
    #    The effective scenario with the override is already in the registry.
    draft_v2 = regenerate_draft(
        plan_id=plan_id,
        presets={},
        parameters={},
        hyperparameters={},
    )
    assert not draft_v2.validation_errors, f"Unexpected regen errors: {draft_v2.validation_errors}"

    # 3. Create a run from the regenerated draft
    from aica_api.services.run_manager import create_run, tick
    run_state = create_run(plan_id, "run_regen_override", tmp_path)
    tick(run_state.run_id)

    # 4. Assert the override is still in effect in the tick engine
    log = get_active_run_log(run_state.run_id)
    assert log is not None
    tick_event = [e for e in log.events if e.kind == "tick"][0]
    assert tick_event.raw_state["speedKph"] == 120, (
        f"Expected 120 kph after regenerate, got {tick_event.raw_state['speedKph']}"
    )

    # 5. The profile_overrides should be carried through to the RunLog
    assert log.profile_overrides is not None, "profile_overrides must be set in RunLog"
    assert log.profile_overrides.get("speed", {}).get("normal_road_kph") == 120


# ---------------------------------------------------------------------------
# T008-11 (Minor 3): profile_overrides captured in RunLog evidence
# ---------------------------------------------------------------------------


def test_profile_overrides_recorded_in_run_log(tmp_path, uc01_package, uc01_scenario):
    """When profile overrides are active, RunLog.profile_overrides records the raw override dict.

    The field is additive/optional: None when no override was submitted.
    """
    from aica_api.services.run_manager import get_active_run_log

    # Run WITH override
    override_state = _plan_and_run(
        uc01_package, uc01_scenario, "run_log_overrides", tmp_path,
        profiles={"speed": {"highway_kph": 175}},
    )
    tick(override_state.run_id)
    override_log = get_active_run_log(override_state.run_id)

    assert override_log.profile_overrides is not None
    assert override_log.profile_overrides == {"speed": {"highway_kph": 175}}

    # Run WITHOUT override — field should be None
    baseline_state = _plan_and_run(uc01_package, uc01_scenario, "run_log_no_overrides", tmp_path)
    tick(baseline_state.run_id)
    baseline_log = get_active_run_log(baseline_state.run_id)

    assert baseline_log.profile_overrides is None
