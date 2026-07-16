"""TDD: ProposalPackageRegistry — T015.

Mirrors the trigger PackageRegistry's scan/error structure
(services/package_registry.py) but scoped to proposal-family manifests
only ({service_selector, content_selector}), validated against
ProposalPackageManifest, and additionally indexed by the 4-slot model
(ProposalPackageFamilySlot / ALL_FAMILY_SLOTS).

Covers:
  - Loads both real mock packages (packages/mock_service_selector_v1,
    packages/mock_content_selector_v1) into their transparent slots.
  - The 2 constrained_llm slots are empty (package_id is None).
  - A content package cannot fill a service slot (and vice versa) — the
    family determines the slot, never an assignment choice.
  - A malformed proposal manifest (family present but invalid shape) is
    reported in list_errors(), never partially used (absent from .get()
    and list_summaries()).
  - A manifest with no `family` key at all (a trigger package) is skipped
    silently — not an error, not loaded.
"""
from __future__ import annotations

import json
import pathlib

import pytest

from aica_api.config import settings
from aica_api.services.proposal_package_registry import ProposalPackageRegistry

_REPO_ROOT = settings.proposal_contracts_dir.parent
_PACKAGES_DIR = _REPO_ROOT / "packages"


@pytest.fixture
def real_registry() -> ProposalPackageRegistry:
    return ProposalPackageRegistry(_PACKAGES_DIR)


# ---------------------------------------------------------------------------
# Real packages/ directory — both mocks load into their transparent slots
# ---------------------------------------------------------------------------


def test_loads_both_mock_packages(real_registry):
    ids = {pkg["id"] for pkg in real_registry.list_summaries()}
    assert "mock_service_selector_v1" in ids
    assert "mock_content_selector_v1" in ids


def test_no_errors_for_real_packages_dir(real_registry):
    assert real_registry.list_errors() == []


def test_slots_map_mocks_to_transparent_slots(real_registry):
    slots = {(s["family"], s["approach"]): s["package_id"] for s in real_registry.list_slots()}
    # P5 Unit A (feature 016, T001/T003): the REAL service selector now also
    # declares family/approach and sorts before the mock alphabetically, so
    # it (not the mock) fills the service_selector/transparent slot — the
    # same "real package becomes the default" behavior already established
    # below for the content selector (P3c, feature 014, T032).
    assert slots[("service_selector", "transparent")] == "aica_transparent_service_selector_v1"
    assert slots[("content_selector", "transparent")] == "aica_transparent_content_selector_v1"


def test_constrained_llm_slots_are_empty(real_registry):
    slots = {(s["family"], s["approach"]): s["package_id"] for s in real_registry.list_slots()}
    assert slots[("service_selector", "constrained_llm")] is None
    assert slots[("content_selector", "constrained_llm")] is None


def test_list_slots_has_exactly_four_entries(real_registry):
    assert len(real_registry.list_slots()) == 4


def test_get_returns_full_manifest(real_registry):
    pkg = real_registry.get("mock_service_selector_v1")
    assert pkg is not None
    assert pkg.family.value == "service_selector"
    assert pkg.approach.value == "transparent"


def test_get_unknown_returns_none(real_registry):
    assert real_registry.get("does_not_exist") is None


# ---------------------------------------------------------------------------
# A content package cannot fill a service slot (and vice versa)
# ---------------------------------------------------------------------------


def test_content_package_not_in_service_slot(real_registry):
    slots = {(s["family"], s["approach"]): s["package_id"] for s in real_registry.list_slots()}
    assert slots[("service_selector", "transparent")] != "mock_content_selector_v1"


def test_service_package_not_in_content_slot(real_registry):
    slots = {(s["family"], s["approach"]): s["package_id"] for s in real_registry.list_slots()}
    assert slots[("content_selector", "transparent")] != "mock_service_selector_v1"


# ---------------------------------------------------------------------------
# Malformed proposal manifest -> errors list, never partially used
# ---------------------------------------------------------------------------


def _write_manifest(pkg_dir: pathlib.Path, data: dict) -> None:
    pkg_dir.mkdir(parents=True, exist_ok=True)
    (pkg_dir / "package.json").write_text(json.dumps(data), encoding="utf-8")


def test_malformed_proposal_manifest_reported_as_error(tmp_path):
    # family present (declares intent to be a proposal package) but missing
    # required fields (algorithm, parameters, hyperparameters, ...).
    bad_dir = tmp_path / "bad_service_selector"
    _write_manifest(
        bad_dir,
        {
            "id": "bad_service_selector",
            "family": "service_selector",
            "approach": "transparent",
        },
    )
    reg = ProposalPackageRegistry(tmp_path)
    errors = reg.list_errors()
    assert len(errors) == 1
    assert errors[0]["package_dir"] == str(bad_dir)


def test_malformed_manifest_never_partially_used(tmp_path):
    bad_dir = tmp_path / "bad_content_selector"
    _write_manifest(
        bad_dir,
        {
            "id": "bad_content_selector",
            "family": "content_selector",
            "approach": "transparent",
            # missing supported_services -> content-family validator rejects
            "version": "1.0.0",
            "label": {"ja": "x", "en": "x"},
            "contract_version": "1.0.0",
            "algorithm": {"type": "python_module", "entrypoint": "algorithm.py"},
            "parameters": {},
            "hyperparameters": [],
        },
    )
    reg = ProposalPackageRegistry(tmp_path)
    assert reg.get("bad_content_selector") is None
    assert all(pkg["id"] != "bad_content_selector" for pkg in reg.list_summaries())
    assert len(reg.list_errors()) == 1


def test_invalid_family_value_reported_as_error(tmp_path):
    bad_dir = tmp_path / "bad_family"
    _write_manifest(
        bad_dir,
        {
            "id": "bad_family",
            "family": "not_a_real_family",
            "approach": "transparent",
            "version": "1.0.0",
            "label": {"ja": "x", "en": "x"},
            "contract_version": "1.0.0",
            "algorithm": {"type": "python_module", "entrypoint": "algorithm.py"},
            "parameters": {},
            "hyperparameters": [],
        },
    )
    reg = ProposalPackageRegistry(tmp_path)
    assert len(reg.list_errors()) == 1
    assert reg.get("bad_family") is None


def test_valid_package_not_contaminated_by_invalid_sibling(tmp_path):
    good_dir = tmp_path / "mock_service_selector_v1"
    good_data = json.loads((_PACKAGES_DIR / "mock_service_selector_v1" / "package.json").read_text())
    _write_manifest(good_dir, good_data)

    bad_dir = tmp_path / "bad_pkg"
    _write_manifest(bad_dir, {"id": "bad", "family": "service_selector"})

    reg = ProposalPackageRegistry(tmp_path)
    assert reg.get("mock_service_selector_v1") is not None
    assert len(reg.list_errors()) == 1


# ---------------------------------------------------------------------------
# A manifest with no `family` key at all is skipped silently (not a proposal
# package — owned by the trigger registry, never surfaced as an error here).
# ---------------------------------------------------------------------------


def test_non_proposal_manifest_skipped_silently(tmp_path):
    trigger_like_dir = tmp_path / "some_trigger_package"
    _write_manifest(
        trigger_like_dir,
        {
            "id": "some_trigger_package",
            "version": "1.0",
            "label": "Trigger Package",
            "algorithm": {"type": "python_module", "entrypoint": "algorithm.py"},
        },
    )
    reg = ProposalPackageRegistry(tmp_path)
    assert reg.list_errors() == []
    assert reg.get("some_trigger_package") is None
    assert reg.list_summaries() == []


def test_missing_packages_dir_yields_empty_registry(tmp_path):
    missing = tmp_path / "does_not_exist"
    reg = ProposalPackageRegistry(missing)
    assert reg.list_summaries() == []
    assert reg.list_errors() == []
    assert len(reg.list_slots()) == 4
