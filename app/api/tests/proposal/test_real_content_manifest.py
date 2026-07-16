"""TDD: T032 — the REAL transparent content selector gains family/approach.

``packages/aica_transparent_content_selector_v1/package.json`` previously
declared ``kind: content_selector`` (the P6 direct-import convention) but not
the ``family``/``approach`` fields ``ProposalPackageManifest`` requires, so
``ProposalPackageRegistry`` silently skipped it (no ``family`` key => not a
proposal candidate). Adding ``family: content_selector`` +
``approach: transparent`` is additive — every other key (``kind``,
``compatible_scenario_types``, ``supported_services``, ``parameters``,
``hyperparameters``, ...) is unchanged, so the P6 direct-import harness
(``tests/proposal/conftest.py::load_content_selector``/``load_content_manifest``)
must keep working exactly as before.
"""
from __future__ import annotations

from aica_api.config import settings
from aica_api.models.proposal.enums import ProposalPackageApproach, ProposalPackageFamily
from aica_api.services.proposal_package_registry import ProposalPackageRegistry

from tests.proposal.conftest import load_content_manifest, load_content_selector

_REAL_CONTENT_PACKAGE_ID = "aica_transparent_content_selector_v1"


def test_manifest_declares_family_and_approach():
    manifest = load_content_manifest()
    assert manifest["family"] == "content_selector"
    assert manifest["approach"] == "transparent"
    # Additive: every P6-era key is still present.
    assert manifest["kind"] == "content_selector"
    assert manifest["compatible_scenario_types"] == ["proposal_content"]
    assert "supported_services" in manifest
    assert "parameters" in manifest
    assert "hyperparameters" in manifest


def test_registry_loads_real_content_package_no_errors():
    registry = ProposalPackageRegistry(settings.packages_dir)
    assert _REAL_CONTENT_PACKAGE_ID in {
        pkg["id"] for pkg in registry.list_summaries()
    }
    assert not any(
        _REAL_CONTENT_PACKAGE_ID in err.get("package_dir", "") for err in registry.list_errors()
    )


def test_registry_slots_real_content_package_into_content_transparent():
    registry = ProposalPackageRegistry(settings.packages_dir)
    pkg = registry.get(_REAL_CONTENT_PACKAGE_ID)
    assert pkg is not None
    assert pkg.family == ProposalPackageFamily.content_selector
    assert pkg.approach == ProposalPackageApproach.transparent

    slots = {(s["family"], s["approach"]): s["package_id"] for s in registry.list_slots()}
    assert slots[("content_selector", "transparent")] == _REAL_CONTENT_PACKAGE_ID


def test_p6_direct_import_harness_unaffected():
    """The P6 harness loads the package.json / algorithm.py by file path,
    entirely independent of the registry — adding family/approach must not
    change its behavior."""
    manifest = load_content_manifest()
    assert manifest["id"] == _REAL_CONTENT_PACKAGE_ID
    selector = load_content_selector()
    assert callable(selector.evaluate)
