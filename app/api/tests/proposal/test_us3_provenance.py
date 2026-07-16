"""US3 trust invariant — feature-origin provenance (T042). FR-005.

FR-005 requires every displayed world-feature field to be labelled with its
provenance (baseline concept / normalized concept / proposed addition) — see
``ProvenanceBadge.tsx`` (bilingual ``{ja, en}`` labels for the three
``FeatureOriginProvenance`` members) and ``WorldPanel.tsx`` (assigns one
provenance kind per editable world-feature field).

This backend test proves the CONTRACT that UI depends on actually holds
end-to-end: the same world-feature keys WorldPanel renders can each carry a
valid ``FeatureOriginProvenance`` through ``world_snapshot.feature_provenance``
-> ``SelectorInput.feature_provenance`` -> the persisted
``AlgorithmEvidence.input_snapshot`` UNCHANGED (never silently dropped or
altered on the way to becoming the evidence a reviewer inspects), and that
all three provenance kinds are actually exercised across the field set (not
just one, which would make the UI's 3-way badge distinction pointless).

The field/provenance pairing below is mirrored 1:1 from
``app/frontend/src/components/proposal/panels/WorldPanel.tsx``
(``WORLD_SITUATION_FIELDS`` + ``PREFERENCE_FIELDS`` + the standalone
``motion_state`` field) — keep the two in sync if either changes.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from aica_api.main import app
from aica_api.models.proposal.enums import FeatureOriginProvenance
from aica_api.models.proposal.selector_input import FeatureProvenanceEntry, SelectorInput

client = TestClient(app)

# Mirrors WorldPanel.tsx WORLD_SITUATION_FIELDS + PREFERENCE_FIELDS + motion_state.
WORLD_FEATURE_PROVENANCE: dict[str, str] = {
    "drowsiness_level": "cdc_su_baseline",
    "fatigue_level": "cdc_su_baseline",
    "monotony_level": "cdc_su_baseline",
    "traffic_state": "cdc_su_baseline",
    "road_type": "normalized_cdc_su_concept",
    "night_state": "cdc_su_baseline",
    "route_tags": "cdc_su_baseline",
    "destination_tags": "cdc_su_baseline",
    "child_present": "cdc_su_baseline",
    "multiple_passengers": "cdc_su_baseline",
    "age_band": "cdc_su_baseline",
    "gender": "cdc_su_baseline",
    "motion_state": "proposed_addition",
}


def _feature_provenance_map() -> dict:
    return {
        key: {"feature_origin": origin, "source_reference": "WorldPanel.tsx field definition"}
        for key, origin in WORLD_FEATURE_PROVENANCE.items()
    }


@pytest.fixture(autouse=True)
def isolate_proposal_runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path))
    yield


# ---------------------------------------------------------------------------
# Every world-feature key carries a valid FeatureOriginProvenance
# ---------------------------------------------------------------------------


def test_every_world_feature_has_a_valid_feature_origin_provenance():
    valid_values = {member.value for member in FeatureOriginProvenance}
    for key, origin in WORLD_FEATURE_PROVENANCE.items():
        assert origin in valid_values, f"{key!r} has an unknown provenance {origin!r}"
        entry = FeatureProvenanceEntry(feature_origin=origin, source_reference="test")
        assert entry.feature_origin.value == origin


def test_all_three_provenance_kinds_are_exercised_across_world_features():
    """A meaningful 3-way UI badge distinction requires all three kinds to
    actually appear somewhere in the world-feature set, not just one."""
    used = set(WORLD_FEATURE_PROVENANCE.values())
    assert used == {member.value for member in FeatureOriginProvenance}


# ---------------------------------------------------------------------------
# The full feature_provenance map validates against SelectorInput
# ---------------------------------------------------------------------------


def test_full_world_feature_provenance_map_validates_against_selector_input():
    payload = {
        "contract_version": "1.0.0",
        "opportunity_id": "op-provenance-test",
        "simulation_time": "2026-07-16T10:00:00Z",
        "trigger_purpose": "rest_recommended",
        "lifecycle_stage": "after_rest_before_restart",
        "allowed_service_ids": ["full_karaoke"],
        "feature_snapshot": {key: None for key in WORLD_FEATURE_PROVENANCE},
        "feature_provenance": _feature_provenance_map(),
        "enabled_feature_extensions": [],
        "selected_service_id": None,
        "eligible_candidates": [{"candidate_id": "full_karaoke"}],
        "excluded_candidates": [],
        "parameters": {},
        "hyperparameters": {},
        "package_runtime_state": {},
        "catalog_version": "n/a",
        "run_seed": "seed-provenance-test",
    }
    obj = SelectorInput(**payload)
    assert set(obj.feature_provenance.keys()) == set(WORLD_FEATURE_PROVENANCE.keys())
    for key, origin in WORLD_FEATURE_PROVENANCE.items():
        assert obj.feature_provenance[key].feature_origin.value == origin


def test_invalid_provenance_kind_is_rejected_by_selector_input():
    payload = {
        "contract_version": "1.0.0",
        "opportunity_id": "op-provenance-test",
        "simulation_time": "2026-07-16T10:00:00Z",
        "trigger_purpose": "rest_recommended",
        "lifecycle_stage": "after_rest_before_restart",
        "allowed_service_ids": ["full_karaoke"],
        "feature_snapshot": {"drowsiness_level": 72},
        "feature_provenance": {
            "drowsiness_level": {
                "feature_origin": "not_a_real_provenance_kind",
                "source_reference": "test",
            }
        },
        "enabled_feature_extensions": [],
        "selected_service_id": None,
        "eligible_candidates": [{"candidate_id": "full_karaoke"}],
        "excluded_candidates": [],
        "parameters": {},
        "hyperparameters": {},
        "package_runtime_state": {},
        "catalog_version": "n/a",
        "run_seed": "seed-provenance-test",
    }
    with pytest.raises(ValidationError):
        SelectorInput(**payload)


# ---------------------------------------------------------------------------
# End-to-end: the provenance map survives, byte-identical, into the
# persisted AlgorithmEvidence.input_snapshot a reviewer actually inspects.
# ---------------------------------------------------------------------------


def test_feature_provenance_survives_unchanged_into_persisted_evidence():
    provenance_map = _feature_provenance_map()
    body = {
        "trigger_purpose": "rest_recommended",
        "lifecycle_stage": "after_rest_before_restart",
        "motion_state": "stopped",
        "world_snapshot": {
            "feature_snapshot": {key: None for key in WORLD_FEATURE_PROVENANCE},
            "feature_provenance": provenance_map,
        },
        "service_package_id": "mock_service_selector_v1",
        "content_package_id": "mock_content_selector_v1",
        "mode": "interactive",
        "enabled_feature_extensions": [],
        "parameters": {},
        "hyperparameters": {},
        "run_seed": "seed-provenance-test",
        "simulation_time": "2026-07-16T10:00:00Z",
    }
    resp = client.post("/api/proposal/runs", json=body)
    assert resp.status_code == 201, resp.text
    run_log = resp.json()

    # Persisted on the run itself...
    assert run_log["world_snapshot"]["feature_provenance"] == provenance_map
    # ...and unchanged inside the evidence input_snapshot a reviewer inspects.
    service_ev = run_log["evidence"][0]
    assert service_ev["input_snapshot"]["feature_provenance"] == provenance_map

    # Reopen (no recompute) still carries it, byte-identical.
    reopened = client.get(f"/api/proposal/runs/{run_log['run_id']}").json()
    assert reopened["world_snapshot"]["feature_provenance"] == provenance_map
