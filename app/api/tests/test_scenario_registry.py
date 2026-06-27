"""TDD scenario_registry tests (T019) — RED then GREEN.

Tests for ScenarioRegistry:
  - Load valid fixtures
  - Correct summaries
  - Detail returns full model
  - Compatibility check passes for matched pair
"""

from __future__ import annotations

import json
import pathlib
import shutil

import pytest

from aica_api.models.scenario import ScenarioDef
from aica_api.services.scenario_registry import ScenarioRegistry

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_SCENARIOS_DIR = _REPO_ROOT / "scenarios"
_PACKAGES_DIR = _REPO_ROOT / "packages"


@pytest.fixture
def registry() -> ScenarioRegistry:
    return ScenarioRegistry(_SCENARIOS_DIR)


# ---------------------------------------------------------------------------
# Load valid fixtures
# ---------------------------------------------------------------------------


def test_registry_loads_valid_scenario(registry):
    summaries = registry.list_summaries()
    assert any(s["id"] == "uc01_fatigue_friend_drive_v0_1" for s in summaries)


def test_registry_no_errors_for_valid_fixture(registry):
    errors = registry.list_errors()
    assert len(errors) == 0


# ---------------------------------------------------------------------------
# Summaries
# ---------------------------------------------------------------------------


def test_list_summaries_returns_list(registry):
    result = registry.list_summaries()
    assert isinstance(result, list)
    assert len(result) >= 1


def test_summary_has_required_keys(registry):
    summaries = registry.list_summaries()
    for s in summaries:
        assert "id" in s
        assert "version" in s
        assert "type" in s
        assert "review_focus" in s


def test_summary_id_correct(registry):
    summaries = registry.list_summaries()
    s = next(s for s in summaries if s["id"] == "uc01_fatigue_friend_drive_v0_1")
    assert s["type"] == "uc01_fatigue"


# ---------------------------------------------------------------------------
# Detail (full model)
# ---------------------------------------------------------------------------


def test_get_returns_scenario_def(registry):
    sc = registry.get("uc01_fatigue_friend_drive_v0_1")
    assert isinstance(sc, ScenarioDef)


def test_get_returns_correct_scenario(registry):
    sc = registry.get("uc01_fatigue_friend_drive_v0_1")
    assert sc.id == "uc01_fatigue_friend_drive_v0_1"
    assert sc.version == "0.1.0"


def test_get_unknown_returns_none(registry):
    sc = registry.get("does_not_exist")
    assert sc is None


def test_get_includes_route_intent(registry):
    sc = registry.get("uc01_fatigue_friend_drive_v0_1")
    assert len(sc.route_intent.segments) >= 2


def test_get_includes_event_presets(registry):
    sc = registry.get("uc01_fatigue_friend_drive_v0_1")
    assert len(sc.event_presets.drowsiness_schedule) >= 1


def test_get_includes_allowed_actions(registry):
    sc = registry.get("uc01_fatigue_friend_drive_v0_1")
    assert "accept_rest" in sc.allowed_actions


def test_get_total_duration(registry):
    sc = registry.get("uc01_fatigue_friend_drive_v0_1")
    assert sc.total_duration_seconds == 7200


# ---------------------------------------------------------------------------
# Compatibility
# ---------------------------------------------------------------------------


def test_is_compatible_matched_pair(registry):
    """The UC-01 scenario is compatible with the rule-based package."""
    from aica_api.models.package import PackageManifest

    pkg_data = json.loads(
        (_PACKAGES_DIR / "rest_rule_based_v0_1" / "package.json").read_text()
    )
    package = PackageManifest(**pkg_data)
    sc = registry.get("uc01_fatigue_friend_drive_v0_1")

    assert registry.is_compatible(sc, package) is True


def test_is_compatible_mismatched(registry):
    """Scenario type not in package compat list → not compatible."""
    from aica_api.models.package import PackageManifest

    pkg_data = json.loads(
        (_PACKAGES_DIR / "rest_rule_based_v0_1" / "package.json").read_text()
    )
    pkg_data["compatible_scenario_types"] = ["uc99_something_else"]
    package = PackageManifest(**pkg_data)
    sc = registry.get("uc01_fatigue_friend_drive_v0_1")

    assert registry.is_compatible(sc, package) is False


# ---------------------------------------------------------------------------
# Invalid file handling
# ---------------------------------------------------------------------------


def test_registry_reports_errors_for_invalid_scenario(tmp_path):
    """Invalid .json files are reported in errors."""
    (tmp_path / "bad_scenario.json").write_text('{"id": "bad"}', encoding="utf-8")
    reg = ScenarioRegistry(tmp_path)
    errors = reg.list_errors()
    assert len(errors) == 1
    assert errors[0]["file"] == str(tmp_path / "bad_scenario.json")


def test_registry_valid_not_contaminated_by_invalid(tmp_path):
    """A valid scenario alongside an invalid one still loads correctly."""
    # Copy the valid fixture
    src = _SCENARIOS_DIR / "uc01_fatigue_friend_drive_v0_1.json"
    dst = tmp_path / "uc01_fatigue_friend_drive_v0_1.json"
    shutil.copy(src, dst)

    # Add an invalid one
    (tmp_path / "bad.json").write_text("{}", encoding="utf-8")

    reg = ScenarioRegistry(tmp_path)
    sc = reg.get("uc01_fatigue_friend_drive_v0_1")
    assert sc is not None
    assert len(reg.list_errors()) == 1
