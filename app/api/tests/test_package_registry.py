"""TDD package_registry tests (T019) — RED then GREEN.

Tests for PackageRegistry:
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

from aica_api.models.package import PackageManifest
from aica_api.services.package_registry import PackageRegistry

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_PACKAGES_DIR = _REPO_ROOT / "packages"
_SCENARIOS_DIR = _REPO_ROOT / "scenarios"


@pytest.fixture
def registry() -> PackageRegistry:
    return PackageRegistry(_PACKAGES_DIR)


# ---------------------------------------------------------------------------
# Load valid fixtures
# ---------------------------------------------------------------------------


def test_registry_loads_valid_package(registry):
    """The real fixture package loads without errors."""
    summaries = registry.list_summaries()
    assert any(s["id"] == "aica_transparent_hybrid_trigger_v1" for s in summaries)


def test_registry_no_errors_for_valid_fixture(registry):
    """No errors should be reported for the valid fixture."""
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
        assert "label" in s
        assert "compatible_scenario_types" in s


def test_summary_id_matches_package_id(registry):
    summaries = registry.list_summaries()
    s = next(s for s in summaries if s["id"] == "aica_transparent_hybrid_trigger_v1")
    assert s["id"] == "aica_transparent_hybrid_trigger_v1"


# ---------------------------------------------------------------------------
# Detail (full model)
# ---------------------------------------------------------------------------


def test_get_returns_package_manifest(registry):
    pkg = registry.get("aica_transparent_hybrid_trigger_v1")
    assert isinstance(pkg, PackageManifest)


def test_get_returns_correct_package(registry):
    pkg = registry.get("aica_transparent_hybrid_trigger_v1")
    assert pkg.id == "aica_transparent_hybrid_trigger_v1"
    assert pkg.version == "0.2"


def test_get_unknown_returns_none(registry):
    pkg = registry.get("does_not_exist")
    assert pkg is None


def test_get_rules_is_empty_for_python_module(registry):
    """Feature 009: rules is a legacy declarative_rule-only field — python_module
    is the only surviving algorithm type, and it never populates rules."""
    pkg = registry.get("aica_transparent_hybrid_trigger_v1")
    assert pkg.rules == []


def test_get_includes_hyperparameters(registry):
    pkg = registry.get("aica_transparent_hybrid_trigger_v1")
    assert len(pkg.hyperparameters) >= 1


def test_get_includes_proposals(registry):
    pkg = registry.get("aica_transparent_hybrid_trigger_v1")
    assert any(p.id == "rest_required_proposal" for p in pkg.proposals)


# ---------------------------------------------------------------------------
# Compatibility check
# ---------------------------------------------------------------------------


def test_is_compatible_matching_pair(registry):
    """The fixture package is compatible with uc01_fatigue scenarios."""
    from aica_api.models.scenario import ScenarioDef

    scenario_data = json.loads(
        (_SCENARIOS_DIR / "uc01_fatigue_recovery_v0_1.json").read_text(encoding="utf-8")
    )
    scenario = ScenarioDef(**scenario_data)
    pkg = registry.get("aica_transparent_hybrid_trigger_v1")

    assert registry.is_compatible(pkg, scenario) is True


def test_is_compatible_mismatched_type(registry):
    """A package is not compatible with a scenario of a different type."""
    from aica_api.models.scenario import ScenarioDef

    scenario_data = json.loads(
        (_SCENARIOS_DIR / "uc01_fatigue_recovery_v0_1.json").read_text(encoding="utf-8")
    )
    scenario = ScenarioDef(**scenario_data)

    # Manually set type to something not in the package's compat list
    # (Pydantic v2: construct a new scenario with a different type)
    scenario_data["type"] = "uc99_unknown_type"
    scenario_mismatched = ScenarioDef(**scenario_data)

    pkg = registry.get("aica_transparent_hybrid_trigger_v1")
    assert registry.is_compatible(pkg, scenario_mismatched) is False


# ---------------------------------------------------------------------------
# Invalid file handling
# ---------------------------------------------------------------------------


def test_registry_reports_errors_for_invalid_package(tmp_path):
    """Invalid package.json files are reported in errors, not silently ignored."""
    # Create a package dir with an invalid package.json
    bad_dir = tmp_path / "bad_package"
    bad_dir.mkdir()
    (bad_dir / "package.json").write_text('{"id": "bad"}', encoding="utf-8")

    reg = PackageRegistry(tmp_path)
    errors = reg.list_errors()
    assert len(errors) == 1
    assert errors[0]["package_dir"] == str(bad_dir)


# ---------------------------------------------------------------------------
# T017 — Both surviving packages listed in the registry
# ---------------------------------------------------------------------------
# Feature 009: rest_weighted_score_v0_1 (weighted_score) is retired — the only
# surviving packages are both python_module: aica_transparent_hybrid_trigger_v1
# and nri_fatigue_score_v1.


def test_registry_lists_both_surviving_packages(registry):
    """Registry lists both surviving packages."""
    summaries = registry.list_summaries()
    ids = [s["id"] for s in summaries]
    assert "aica_transparent_hybrid_trigger_v1" in ids, f"missing from: {ids}"
    assert "nri_fatigue_score_v1" in ids, f"missing from: {ids}"


def test_nri_fatigue_score_package_loads_without_errors(registry):
    """nri_fatigue_score_v1 parses under PackageManifest with no errors."""
    pkg = registry.get("nri_fatigue_score_v1")
    assert pkg is not None, "nri_fatigue_score_v1 failed to load"
    assert pkg.id == "nri_fatigue_score_v1"
    assert pkg.algorithm.type == "python_module"
    assert len(pkg.hyperparameters) >= 1
    assert any(p.id == "rest_required_proposal" for p in pkg.proposals)
    assert pkg.compatible_scenario_types == ["uc01_fatigue"]


def test_registry_no_errors_for_real_packages(registry):
    """No registry errors are reported for the real packages/ directory."""
    errors = registry.list_errors()
    assert len(errors) == 0, f"Unexpected registry errors: {errors}"


def test_registry_valid_package_not_contaminated_by_invalid(tmp_path):
    """A valid package alongside an invalid one still loads correctly."""
    # Copy the valid fixture
    src = _PACKAGES_DIR / "aica_transparent_hybrid_trigger_v1"
    dst = tmp_path / "aica_transparent_hybrid_trigger_v1"
    shutil.copytree(src, dst)

    # Add an invalid one
    bad_dir = tmp_path / "bad_pkg"
    bad_dir.mkdir()
    (bad_dir / "package.json").write_text("{}", encoding="utf-8")

    reg = PackageRegistry(tmp_path)
    pkg = reg.get("aica_transparent_hybrid_trigger_v1")
    assert pkg is not None
    assert len(reg.list_errors()) == 1
