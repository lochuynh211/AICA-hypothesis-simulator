"""TDD: P5 Unit A T003 — the new `aica_transparent_service_selector_v1`
package is discovered by `ProposalPackageRegistry`.

Covers:
  - The package loads with no manifest-validation error.
  - It fills the `service_selector`/`transparent` slot (it sorts before
    `mock_service_selector_v1` alphabetically, so — exactly mirroring the
    precedent already set for the content selector, see
    `test_proposal_registry.py::test_slots_map_mocks_to_transparent_slots`'s
    "P3c" comment — it becomes the slot's default occupant; this is the
    intended "real package becomes the default" behavior, not a bug).
  - `mock_service_selector_v1` still loads successfully as a package (it is
    simply no longer the slot's occupant).
"""
from __future__ import annotations

from aica_api.config import settings
from aica_api.services.proposal_package_registry import ProposalPackageRegistry

_PACKAGES_DIR = settings.proposal_contracts_dir.parent / "packages"
_PACKAGE_ID = "aica_transparent_service_selector_v1"


def _registry() -> ProposalPackageRegistry:
    return ProposalPackageRegistry(_PACKAGES_DIR)


def test_new_package_loads_with_no_error():
    reg = _registry()
    assert reg.get(_PACKAGE_ID) is not None
    assert not any(err["package_dir"].endswith(_PACKAGE_ID) for err in reg.list_errors())


def test_new_package_fills_service_selector_transparent_slot():
    reg = _registry()
    slots = {(s["family"], s["approach"]): s["package_id"] for s in reg.list_slots()}
    assert slots[("service_selector", "transparent")] == _PACKAGE_ID


def test_mock_service_selector_still_loads():
    reg = _registry()
    ids = {pkg["id"] for pkg in reg.list_summaries()}
    assert "mock_service_selector_v1" in ids
    assert reg.get("mock_service_selector_v1") is not None


def test_new_package_manifest_shape():
    reg = _registry()
    pkg = reg.get(_PACKAGE_ID)
    assert pkg is not None
    assert pkg.family.value == "service_selector"
    assert pkg.approach.value == "transparent"
    assert pkg.algorithm.type == "python_module"
    assert pkg.algorithm.entrypoint == "algorithm.py"
    assert len(pkg.supported_services) == 14
