"""TDD: ProposalPackageManifest + ProposalPackageFamilySlot — T010.

Authoritative field spec: data-model.md §"ProposalPackageManifest".

Covers:
- The 4 valid (family, approach) slots are enumerated as a constant.
- A content_selector manifest REQUIRES non-empty supported_services.
- A service_selector manifest does NOT require supported_services.
- python_module is the only algorithm.type.
- Missing family-required fields -> validation error (never partially used).
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from aica_api.models.proposal.enums import ProposalPackageApproach, ProposalPackageFamily
from aica_api.models.proposal.package_manifest import (
    ALL_FAMILY_SLOTS,
    HyperparameterDef,
    ProposalPackageFamilySlot,
    ProposalPackageManifest,
)

VALID_SERVICE_MANIFEST: dict = {
    "id": "mock_service_selector_v1",
    "version": "1.0.0",
    "label": {"ja": "モックサービスセレクタ", "en": "Mock Service Selector"},
    "family": "service_selector",
    "approach": "transparent",
    "contract_version": "1.0.0",
    "algorithm": {"type": "python_module", "entrypoint": "algorithm.py", "error_mode": "blocking"},
    "supported_services": [],
    "parameters": {},
    "hyperparameters": [],
}

VALID_CONTENT_MANIFEST: dict = {
    "id": "mock_content_selector_v1",
    "version": "1.0.0",
    "label": {"ja": "モックコンテンツセレクタ", "en": "Mock Content Selector"},
    "family": "content_selector",
    "approach": "transparent",
    "contract_version": "1.0.0",
    "algorithm": {"type": "python_module", "entrypoint": "algorithm.py", "error_mode": "blocking"},
    "supported_services": ["music_playlist", "humming_karaoke"],
    "parameters": {},
    "hyperparameters": [
        {"key": "response_weight", "kind": "numeric", "label": {"ja": "重み", "en": "Weight"}, "default": 0.5},
    ],
}


# ---------------------------------------------------------------------------
# ProposalPackageFamilySlot — the 4 valid slots
# ---------------------------------------------------------------------------


class TestFamilySlots:
    def test_four_slots_enumerated(self):
        assert len(ProposalPackageFamilySlot) == 4

    def test_all_family_slots_constant_has_four_entries(self):
        assert len(ALL_FAMILY_SLOTS) == 4

    def test_all_family_slots_cover_full_cartesian_product(self):
        expected = {
            (ProposalPackageFamily.service_selector, ProposalPackageApproach.transparent),
            (ProposalPackageFamily.service_selector, ProposalPackageApproach.constrained_llm),
            (ProposalPackageFamily.content_selector, ProposalPackageApproach.transparent),
            (ProposalPackageFamily.content_selector, ProposalPackageApproach.constrained_llm),
        }
        assert set(ALL_FAMILY_SLOTS) == expected


# ---------------------------------------------------------------------------
# HyperparameterDef — basic shape
# ---------------------------------------------------------------------------


class TestHyperparameterDef:
    def test_valid_numeric_hyperparameter(self):
        hp = HyperparameterDef(key="w", kind="numeric", label={"ja": "a", "en": "b"}, default=1.0)
        assert hp.key == "w"
        assert hp.kind == "numeric"
        assert hp.default == 1.0

    def test_invalid_kind_rejected(self):
        with pytest.raises(ValidationError):
            HyperparameterDef(key="w", kind="not_a_kind", label={"ja": "a", "en": "b"}, default=1.0)

    def test_matrix_kind_with_extra_fields_accepted(self):
        hp = HyperparameterDef(
            key="purpose_multiplier",
            kind="matrix",
            label={"ja": "マトリックス", "en": "Matrix"},
            default={},
            rows=["rest_recommended"],
            columns=["music_playlist"],
        )
        assert hp.kind == "matrix"


# ---------------------------------------------------------------------------
# ProposalPackageManifest — valid cases
# ---------------------------------------------------------------------------


class TestValidManifest:
    def test_valid_service_manifest_accepted(self):
        m = ProposalPackageManifest(**VALID_SERVICE_MANIFEST)
        assert m.family == ProposalPackageFamily.service_selector
        assert m.supported_services == []

    def test_valid_content_manifest_accepted(self):
        m = ProposalPackageManifest(**VALID_CONTENT_MANIFEST)
        assert m.family == ProposalPackageFamily.content_selector
        assert len(m.supported_services) == 2
        assert len(m.hyperparameters) == 1

    def test_service_manifest_with_populated_supported_services_also_accepted(self):
        """service_selector 'must not require it' means non-empty is not
        mandatory — it does not forbid populating it either."""
        payload = {**VALID_SERVICE_MANIFEST, "supported_services": ["music_playlist"]}
        m = ProposalPackageManifest(**payload)
        assert m.supported_services == ["music_playlist"]


# ---------------------------------------------------------------------------
# ProposalPackageManifest — validator rejections
# ---------------------------------------------------------------------------


class TestContentRequiresSupportedServices:
    def test_content_selector_with_empty_supported_services_rejected(self):
        payload = {**VALID_CONTENT_MANIFEST, "supported_services": []}
        with pytest.raises(ValidationError):
            ProposalPackageManifest(**payload)


class TestAlgorithmTypeFixed:
    def test_non_python_module_algorithm_type_rejected(self):
        payload = {
            **VALID_SERVICE_MANIFEST,
            "algorithm": {"type": "declarative_rule", "entrypoint": "algorithm.py", "error_mode": "blocking"},
        }
        with pytest.raises(ValidationError):
            ProposalPackageManifest(**payload)

    def test_invalid_error_mode_rejected(self):
        payload = {
            **VALID_SERVICE_MANIFEST,
            "algorithm": {"type": "python_module", "entrypoint": "algorithm.py", "error_mode": "silent"},
        }
        with pytest.raises(ValidationError):
            ProposalPackageManifest(**payload)


class TestInvalidFamilyApproach:
    def test_invalid_family_rejected(self):
        payload = {**VALID_SERVICE_MANIFEST, "family": "not_a_family"}
        with pytest.raises(ValidationError):
            ProposalPackageManifest(**payload)

    def test_invalid_approach_rejected(self):
        payload = {**VALID_SERVICE_MANIFEST, "approach": "not_an_approach"}
        with pytest.raises(ValidationError):
            ProposalPackageManifest(**payload)


class TestMissingRequiredFields:
    def test_missing_label_rejected(self):
        payload = {k: v for k, v in VALID_SERVICE_MANIFEST.items() if k != "label"}
        with pytest.raises(ValidationError):
            ProposalPackageManifest(**payload)

    def test_missing_algorithm_rejected(self):
        payload = {k: v for k, v in VALID_SERVICE_MANIFEST.items() if k != "algorithm"}
        with pytest.raises(ValidationError):
            ProposalPackageManifest(**payload)
