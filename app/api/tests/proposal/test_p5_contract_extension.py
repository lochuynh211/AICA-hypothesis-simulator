"""TDD: P5 Unit A T006/T007 — additive optional extension of
`ServiceSelectorOutput` (contracts/service_output_extension.md,
data-model.md §1-§4).

Backward-compatibility rule under test: every new field is OPTIONAL
(Python default ``None``/absent) — the existing `mock_service_selector_v1`
output, which emits none of them, must still validate unchanged. A
fully-populated "real-shaped" dict (every new §14 field + `DominanceReadout`
+ subtotals) must also validate, with the documented bounds holding.

This test intentionally imports `mock_service_selector_v1`'s `algorithm.py`
by file path (mirrors `test_mock_packages.py::_load_algorithm`) rather than
going through `dispatch_selector`, so it can validate the RAW dict directly
against the model under test.
"""
from __future__ import annotations

import importlib.util
import pathlib

import pytest

from aica_api.config import settings
from aica_api.models.proposal.service_output import (
    DominanceReadout,
    FeatureContribution,
    RankedCandidate,
    ServiceSelectorOutput,
)

_REPO_ROOT = settings.proposal_contracts_dir.parent
_SERVICE_PKG_DIR = _REPO_ROOT / "packages" / "mock_service_selector_v1"


def _load_algorithm(pkg_dir: pathlib.Path, module_name: str):
    spec = importlib.util.spec_from_file_location(module_name, pkg_dir / "algorithm.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


@pytest.fixture(scope="module")
def mock_service_algorithm():
    return _load_algorithm(_SERVICE_PKG_DIR, "p5_contract_mock_service_algorithm")


# ---------------------------------------------------------------------------
# (a) The CURRENT mock output validates through the extended model, unchanged.
# ---------------------------------------------------------------------------


def test_mock_output_validates_through_extended_model_unchanged(mock_service_algorithm):
    context = {
        "allowed_service_ids": ["live_viewing", "stretch_video", "full_karaoke", "oshi_reexperience"],
    }
    raw = mock_service_algorithm.evaluate(context)

    validated = ServiceSelectorOutput(**raw)

    assert validated.decision_type.value == "ranked_candidates"
    assert len(validated.ranked_candidates) == 3
    # None of the new optional fields are populated by the mock.
    assert validated.dominance is None
    assert validated.effective_weights is None
    assert validated.resolved_config_versions is None
    for candidate in validated.ranked_candidates:
        assert candidate.situation_fit is None
        assert candidate.preference_fit is None
        assert candidate.history_fit is None
        assert candidate.strongest_support is None
        assert candidate.strongest_oppose is None
        assert candidate.dominance is None
        for fc in candidate.feature_contributions:
            assert fc.source_reference is None
            assert fc.raw_value is None
            assert fc.normalization_function is None
            assert fc.normalized_evidence is None
            assert fc.response_provenance is None
            assert fc.normalized_feature_response is None
            assert fc.hierarchy_path is None
            assert fc.base_weight is None
            assert fc.purpose_multiplier is None
            assert fc.effective_weight is None
            assert fc.status is None

    # Round-tripping through model_dump must not introduce the new keys with
    # non-None values (byte-for-byte-shape backward compatibility).
    dumped = validated.model_dump(mode="json")
    for candidate in dumped["ranked_candidates"]:
        assert candidate["dominance"] is None
        for fc in candidate["feature_contributions"]:
            assert fc["status"] is None


def test_mock_no_proposal_output_validates_through_extended_model():
    from aica_api.models.proposal.service_output import ServiceSelectorOutput as _SSO

    validated = _SSO(
        decision_type="no_proposal",
        ranked_candidates=[],
        excluded_candidates=[],
        unused_available_features=[],
        missing_features=[],
        next_package_runtime_state={},
        algorithm_provenance={},
    )
    assert validated.dominance is None


# ---------------------------------------------------------------------------
# (b) A fully-populated real-shaped dict validates; bounds hold.
# ---------------------------------------------------------------------------


def _full_feature_contribution(**overrides) -> dict:
    row = {
        "feature_id": "drowsiness_level",
        "feature_value": 80,
        "response_coefficient": 1.0,
        "weight": 0.254551,
        "contribution": 0.203641,
        "source_reference": "Slide 67 driver row",
        "raw_value": 80,
        "normalization_function": "(x/100)^gamma",
        "normalized_evidence": 0.80,
        "response_provenance": "cdc_su_explicit",
        "normalized_feature_response": 0.80,
        "hierarchy_path": "Situation/Driver state/drowsiness",
        "base_weight": 0.22,
        "purpose_multiplier": 1.5,
        "effective_weight": 0.254551,
        "status": "used",
    }
    row.update(overrides)
    return row


def _full_dominance(**overrides) -> dict:
    row = {
        "status": "default_dominance_preserved",
        "w_d": 0.85,
        "w_l": 0.15,
        "required_gap": 0.3529411764705882,
        "material_safety_gap": 1.00,
        "safety_share": 0.85,
        "safety_share_warning": False,
    }
    row.update(overrides)
    return row


def _full_ranked_candidate(**overrides) -> dict:
    row = {
        "rank": 1,
        "candidate_id": "humming_karaoke",
        "score": 0.772349,
        "rationale": ["日本語の理由", "English rationale"],
        "supporting_feature_ids": ["drowsiness_level"],
        "opposing_feature_ids": [],
        "uncertainty": None,
        "feature_contributions": [_full_feature_contribution()],
        "situation_fit": 0.60,
        "preference_fit": 0.10,
        "history_fit": 0.072349,
        "strongest_support": {"feature_id": "drowsiness_level", "contribution": 0.203641},
        "strongest_oppose": None,
        "dominance": _full_dominance(),
    }
    row.update(overrides)
    return row


def _full_output(**overrides) -> dict:
    row = {
        "decision_type": "ranked_candidates",
        "ranked_candidates": [_full_ranked_candidate()],
        "excluded_candidates": [],
        "unused_available_features": [],
        "missing_features": [],
        "next_package_runtime_state": {},
        "algorithm_provenance": {
            "package_id": "aica_transparent_service_selector_v1",
            "contract_version": "1.0.0",
            "schema_version": "1.0.0",
            "purpose": "inattentive_driving_prevention_recovery",
            "extensions_on": [],
        },
        "dominance": _full_dominance(),
        "effective_weights": {"drowsiness_level": 0.254551},
        "resolved_config_versions": {"parameter_set_version": "1.0.0", "formula_version": "1.0.0"},
    }
    row.update(overrides)
    return row


def test_real_shaped_output_validates_with_all_new_fields_populated():
    validated = ServiceSelectorOutput(**_full_output())

    assert validated.dominance is not None
    assert validated.dominance.status == "default_dominance_preserved"
    assert validated.effective_weights == {"drowsiness_level": 0.254551}
    assert validated.resolved_config_versions == {
        "parameter_set_version": "1.0.0",
        "formula_version": "1.0.0",
    }

    candidate = validated.ranked_candidates[0]
    assert candidate.situation_fit == 0.60
    assert candidate.preference_fit == 0.10
    assert candidate.history_fit == pytest.approx(0.072349)
    assert candidate.strongest_support == {"feature_id": "drowsiness_level", "contribution": 0.203641}
    assert candidate.strongest_oppose is None
    assert candidate.dominance.safety_share == 0.85

    fc = candidate.feature_contributions[0]
    assert fc.source_reference == "Slide 67 driver row"
    assert fc.normalized_evidence == 0.80
    assert fc.normalized_feature_response == 0.80
    assert fc.status == "used"

    # Bounds (data-model.md §1): normalized_evidence, response_coefficient,
    # normalized_feature_response in [-1, 1]; effective_weight in [0, 1].
    assert -1.0 <= fc.normalized_evidence <= 1.0
    assert -1.0 <= fc.response_coefficient <= 1.0
    assert -1.0 <= fc.normalized_feature_response <= 1.0
    assert 0.0 <= fc.effective_weight <= 1.0


def test_dominance_readout_constructs_standalone():
    d = DominanceReadout(**_full_dominance())
    assert d.status == "default_dominance_preserved"
    assert d.w_d + d.w_l == pytest.approx(1.0)


def test_feature_contribution_full_row_constructs_standalone():
    fc = FeatureContribution(**_full_feature_contribution())
    assert fc.status == "used"


def test_ranked_candidate_full_row_constructs_standalone():
    rc = RankedCandidate(**_full_ranked_candidate())
    assert rc.dominance is not None
