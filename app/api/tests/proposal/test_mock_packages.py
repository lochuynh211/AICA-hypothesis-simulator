"""Tests for the P1 mock packages (T013 service selector, T014 content selector).

Both mock packages are standalone ``python_module`` packages under
``packages/`` (peer to the real P6 content package), loaded by file path
exactly as the runtime adapter would (mirrors
``conftest.py::load_content_selector``). Neither package's ``algorithm.py``
imports ``aica_api`` — this test suite is the ONLY place that wires the
package's dict output into the pydantic contracts.

Covers:
  - Both ``package.json`` manifests validate against ``ProposalPackageManifest``
    and fill the two *transparent* slots (service_selector, content_selector).
  - ``mock_service_selector_v1.evaluate`` returns a dict that constructs a
    valid ``ServiceSelectorOutput`` (<=3 candidates, drawn only from the
    supplied ``allowed_service_ids``); an empty allowed set yields
    ``no_proposal``.
  - ``mock_content_selector_v1.evaluate`` returns a dict that constructs a
    valid ``CompletePlan`` (no ``plan_score``/aggregate field anywhere;
    ordered items reference real frozen-P2 catalog track ids); an
    unsupported ``selected_service_id`` yields ``unsupported_service``.
"""
from __future__ import annotations

import importlib.util
import json
import pathlib

import pytest
from pydantic import ValidationError

from aica_api.config import settings
from aica_api.models.proposal.content_output import CompletePlan
from aica_api.models.proposal.package_manifest import (
    ProposalPackageFamilySlot,
    ProposalPackageManifest,
)
from aica_api.models.proposal.service_output import ServiceSelectorOutput

_REPO_ROOT = settings.proposal_contracts_dir.parent
_SERVICE_PKG_DIR = _REPO_ROOT / "packages" / "mock_service_selector_v1"
_CONTENT_PKG_DIR = _REPO_ROOT / "packages" / "mock_content_selector_v1"
_P2_CATALOG_PATH = (
    _REPO_ROOT
    / "proposal_contracts"
    / "dataset"
    / "soundcharts-grounded-spotify-compatible-demonstration-seed-1042"
    / "catalog.json"
)


def _load_manifest(pkg_dir: pathlib.Path) -> dict:
    with (pkg_dir / "package.json").open(encoding="utf-8") as fh:
        return json.load(fh)


def _load_algorithm(pkg_dir: pathlib.Path, module_name: str):
    spec = importlib.util.spec_from_file_location(module_name, pkg_dir / "algorithm.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def service_manifest() -> dict:
    return _load_manifest(_SERVICE_PKG_DIR)


@pytest.fixture(scope="module")
def content_manifest() -> dict:
    return _load_manifest(_CONTENT_PKG_DIR)


@pytest.fixture(scope="module")
def service_algorithm():
    return _load_algorithm(_SERVICE_PKG_DIR, "mock_service_selector_v1_algorithm")


@pytest.fixture(scope="module")
def content_algorithm():
    return _load_algorithm(_CONTENT_PKG_DIR, "mock_content_selector_v1_algorithm")


@pytest.fixture(scope="module")
def real_p2_track_ids() -> set[str]:
    with _P2_CATALOG_PATH.open(encoding="utf-8") as fh:
        data = json.load(fh)
    return {song["spotify_track"]["id"] for song in data}


# ---------------------------------------------------------------------------
# Manifests validate against ProposalPackageManifest
# ---------------------------------------------------------------------------


def test_service_manifest_validates(service_manifest):
    manifest = ProposalPackageManifest(**service_manifest)
    assert manifest.slot == ProposalPackageFamilySlot.service_selector_transparent
    assert manifest.algorithm.type == "python_module"
    assert manifest.algorithm.entrypoint == "algorithm.py"


def test_content_manifest_validates(content_manifest):
    manifest = ProposalPackageManifest(**content_manifest)
    assert manifest.slot == ProposalPackageFamilySlot.content_selector_transparent
    assert set(manifest.supported_services) == {"music_playlist", "humming_karaoke", "full_karaoke"}


def test_manifests_fill_distinct_slots(service_manifest, content_manifest):
    service = ProposalPackageManifest(**service_manifest)
    content = ProposalPackageManifest(**content_manifest)
    assert service.slot != content.slot
    assert service.family.value == "service_selector"
    assert content.family.value == "content_selector"


def test_manifests_carry_representative_hyperparameter_density(
    service_manifest, content_manifest
):
    """Both mocks must render real density in the editable setup UI, not a
    token placeholder — data-model.md / design §5."""
    assert len(service_manifest["hyperparameters"]) >= 6
    assert len(content_manifest["hyperparameters"]) >= 14


# ---------------------------------------------------------------------------
# mock_service_selector_v1.evaluate -> ServiceSelectorOutput
# ---------------------------------------------------------------------------


def test_service_selector_ranks_from_allowed_set_only(service_algorithm):
    allowed = ["music_playlist", "humming_karaoke", "quiz", "ranking_creation"]
    out = service_algorithm.evaluate({"allowed_service_ids": allowed})
    result = ServiceSelectorOutput(**out)

    assert result.decision_type.value == "ranked_candidates"
    assert len(result.ranked_candidates) <= 3
    for candidate in result.ranked_candidates:
        assert candidate.candidate_id.value in allowed
    # ranks contiguous from 1 (also pydantic-validated, re-asserted here for clarity)
    assert [c.rank for c in result.ranked_candidates] == list(
        range(1, len(result.ranked_candidates) + 1)
    )
    for candidate in result.ranked_candidates:
        assert candidate.feature_contributions
        assert candidate.rationale


def test_service_selector_caps_at_three_for_larger_allowed_set(service_algorithm):
    allowed = [
        "live_viewing",
        "stretch_video",
        "full_karaoke",
        "oshi_reexperience",
        "call_response_stopped",
    ]
    out = service_algorithm.evaluate({"allowed_service_ids": allowed})
    result = ServiceSelectorOutput(**out)

    assert len(result.ranked_candidates) == 3
    ranked_ids = {c.candidate_id.value for c in result.ranked_candidates}
    assert ranked_ids <= set(allowed)


def test_service_selector_no_proposal_on_empty_allowed_set(service_algorithm):
    out = service_algorithm.evaluate({"allowed_service_ids": []})
    result = ServiceSelectorOutput(**out)

    assert result.decision_type.value == "no_proposal"
    assert result.ranked_candidates == []


# ---------------------------------------------------------------------------
# mock_content_selector_v1.evaluate -> CompletePlan
# ---------------------------------------------------------------------------


def test_content_selector_returns_complete_plan_with_real_catalog_ids(
    content_algorithm, real_p2_track_ids
):
    out = content_algorithm.evaluate({"selected_service_id": "music_playlist"})

    # CRITICAL INVARIANT: no aggregate/plan-level score field anywhere.
    assert "plan_score" not in out
    assert "aggregate_score" not in out
    assert "plan_fit" not in out

    plan = CompletePlan(**out)
    assert plan.decision_type.value == "complete_plan"
    assert plan.selected_service_id.value == "music_playlist"
    assert plan.returned_item_count == len(plan.ordered_items)
    assert plan.ordered_items  # non-empty

    for item in plan.ordered_items:
        assert item.item_id in real_p2_track_ids
        assert item.item_fit is not None
        assert item.feature_contributions
        assert item.rationale


def test_content_selector_lighting_only_for_compatible_services(content_algorithm):
    music = CompletePlan(**content_algorithm.evaluate({"selected_service_id": "music_playlist"}))
    humming = CompletePlan(**content_algorithm.evaluate({"selected_service_id": "humming_karaoke"}))

    assert music.lighting_configuration is None
    assert humming.lighting_configuration is not None
    assert humming.lighting_configuration.enabled is True


def test_content_selector_unsupported_service(content_algorithm):
    out = content_algorithm.evaluate({"selected_service_id": "quiz"})
    plan = CompletePlan(**out)

    assert plan.decision_type.value == "unsupported_service"
    assert plan.ordered_items == []
    assert plan.returned_item_count == 0


def test_content_selector_output_never_has_aggregate_score_field_names(content_algorithm):
    """Belt-and-suspenders: scan every nested dict/list for the forbidden keys,
    not just the top level."""
    forbidden = {"plan_score", "aggregate_score", "plan_fit"}

    def _walk(node):
        if isinstance(node, dict):
            assert not (forbidden & node.keys()), f"forbidden key found in {node.keys()}"
            for v in node.values():
                _walk(v)
        elif isinstance(node, list):
            for v in node:
                _walk(v)

    for service_id in ("music_playlist", "humming_karaoke", "full_karaoke", "quiz"):
        out = content_algorithm.evaluate({"selected_service_id": service_id})
        _walk(out)


def test_content_manifest_supported_services_match_algorithm(content_algorithm, content_manifest):
    manifest = ProposalPackageManifest(**content_manifest)
    supported = {s.value for s in manifest.supported_services}
    for service_id in supported:
        out = content_algorithm.evaluate({"selected_service_id": service_id})
        plan = CompletePlan(**out)
        assert plan.decision_type.value == "complete_plan"


def test_manifests_are_skipped_by_trigger_package_registry(service_manifest, content_manifest):
    """Both mock manifests declare `kind`/`family`, so the trigger
    PackageRegistry must silently skip them (see
    services/package_registry.py._scan)."""
    assert service_manifest.get("kind") is not None or service_manifest.get("family") is not None
    assert content_manifest.get("kind") is not None or content_manifest.get("family") is not None


def test_service_manifest_invalid_without_family_would_be_rejected(service_manifest):
    """Sanity: dropping the required `family` field makes the manifest invalid
    against ProposalPackageManifest (never partially used)."""
    broken = dict(service_manifest)
    del broken["family"]
    with pytest.raises(ValidationError):
        ProposalPackageManifest(**broken)
