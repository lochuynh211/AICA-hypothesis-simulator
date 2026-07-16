"""TDD: SetupSnapshot model + additive ProposalRunLog field — T019/T020.

Covers data-model.md §SetupSnapshot / research.md §R6:

  - ``SetupSnapshot`` constructs/validates with the fields data-model.md
    lists (``origin`` seed/clone/profile refs, ``matrix_version``,
    ``dataset_id`` + ``dataset_hash``, ``service_package_id`` +
    ``service_contract_version``, ``content_package_id`` +
    ``content_contract_version``, ``service_parameter_set_version``,
    ``content_parameter_set_version``, ``feature_provenance`` map);
  - a ``ProposalRunLog`` carrying a ``setup_snapshot`` round-trips
    (``model_dump`` -> re-load) identically;
  - a ``ProposalRunLog`` WITHOUT a ``setup_snapshot`` still loads (backward
    compatibility with pre-P3 persisted runs) and defaults to ``None``.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from aica_api.models.proposal.enums import FeatureOriginProvenance
from aica_api.models.proposal.proposal_run import ProposalRunLog
from aica_api.models.proposal.selector_input import FeatureProvenanceEntry
from aica_api.models.proposal.world import SetupSnapshot, SetupSnapshotOrigin

VALID_OPPORTUNITY: dict = {
    "opportunity_id": "op-001",
    "trigger_purpose": "rest_recommended",
    "lifecycle_stage": "before_rest_until_stop",
    "allowed_service_ids": ["music_playlist"],
    "simulation_time": "2026-07-16T10:00:00Z",
    "run_seed": "seed-abc",
}

VALID_JOURNEY_STATE: dict = {
    "lifecycle_stage": "before_rest_until_stop",
    "motion_state": "driving",
    "active_service_id": None,
    "active_plan_id": None,
}


def _valid_setup_snapshot_kwargs(**overrides) -> dict:
    base = {
        "origin": {"seed_id": "seed-night-highway-oshi", "clone_id": None, "profile_id": None},
        "matrix_version": "v1",
        "dataset_id": "soundcharts-grounded-spotify-compatible-demonstration-seed-1042",
        "dataset_hash": "sha256:83d8079c7a81bc6afbd01cdba65fe2330de66b900a113723814fa938fce516cd",
        "service_package_id": "mock_service_selector_v1",
        "service_contract_version": "1.0.0",
        "content_package_id": "mock_content_selector_v1",
        "content_contract_version": "1.0.0",
        "service_parameter_set_version": "v1",
        "content_parameter_set_version": "v1",
        "feature_provenance": {
            "drowsiness_level": {
                "feature_origin": "cdc_su_baseline",
                "source_reference": "spec-8",
            }
        },
    }
    base.update(overrides)
    return base


def _proposal_run_log_kwargs(**overrides) -> dict:
    base = {
        "run_id": "prun_20260716-100000_abc123",
        "created_at": "2026-07-16T10:00:00Z",
        "opportunity": VALID_OPPORTUNITY,
        "matrix_version": "v1",
        "world_snapshot": {"drowsiness_level": "high"},
        "service_package_id": "mock_service_selector_v1",
        "content_package_id": None,
        "parameters": {},
        "hyperparameters": {},
        "journey_state": VALID_JOURNEY_STATE,
        "events": [],
        "evidence": [],
        "status": "created",
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# SetupSnapshot constructs / validates
# ---------------------------------------------------------------------------


class TestSetupSnapshotConstruction:
    def test_valid_setup_snapshot_constructs(self):
        snapshot = SetupSnapshot(**_valid_setup_snapshot_kwargs())
        assert isinstance(snapshot.origin, SetupSnapshotOrigin)
        assert snapshot.origin.seed_id == "seed-night-highway-oshi"
        assert snapshot.origin.clone_id is None
        assert snapshot.origin.profile_id is None
        assert snapshot.matrix_version == "v1"
        assert snapshot.dataset_id == "soundcharts-grounded-spotify-compatible-demonstration-seed-1042"
        assert snapshot.service_contract_version == "1.0.0"
        assert snapshot.content_package_id == "mock_content_selector_v1"
        assert isinstance(
            snapshot.feature_provenance["drowsiness_level"], FeatureProvenanceEntry
        )
        assert (
            snapshot.feature_provenance["drowsiness_level"].feature_origin
            == FeatureOriginProvenance.cdc_su_baseline
        )

    def test_content_fields_optional_for_service_only_runs(self):
        kwargs = _valid_setup_snapshot_kwargs(
            content_package_id=None,
            content_contract_version=None,
            content_parameter_set_version=None,
        )
        snapshot = SetupSnapshot(**kwargs)
        assert snapshot.content_package_id is None
        assert snapshot.content_contract_version is None
        assert snapshot.content_parameter_set_version is None

    def test_origin_all_none_is_valid(self):
        # A hand-edited world with no seed/clone/profile loaded.
        kwargs = _valid_setup_snapshot_kwargs(
            origin={"seed_id": None, "clone_id": None, "profile_id": None}
        )
        snapshot = SetupSnapshot(**kwargs)
        assert snapshot.origin.seed_id is None
        assert snapshot.origin.clone_id is None
        assert snapshot.origin.profile_id is None

    def test_feature_provenance_defaults_to_empty_map(self):
        kwargs = _valid_setup_snapshot_kwargs()
        del kwargs["feature_provenance"]
        snapshot = SetupSnapshot(**kwargs)
        assert snapshot.feature_provenance == {}

    def test_missing_required_field_rejected(self):
        kwargs = _valid_setup_snapshot_kwargs()
        del kwargs["dataset_hash"]
        with pytest.raises(ValidationError):
            SetupSnapshot(**kwargs)

    def test_unknown_field_rejected(self):
        kwargs = _valid_setup_snapshot_kwargs(unexpected_field="nope")
        with pytest.raises(ValidationError):
            SetupSnapshot(**kwargs)

    def test_round_trip_is_identical(self):
        snapshot = SetupSnapshot(**_valid_setup_snapshot_kwargs())
        dumped = snapshot.model_dump(mode="json")
        reloaded = SetupSnapshot.model_validate(dumped)
        assert reloaded.model_dump(mode="json") == dumped


# ---------------------------------------------------------------------------
# ProposalRunLog carrying a setup_snapshot round-trips identically
# ---------------------------------------------------------------------------


class TestProposalRunLogWithSetupSnapshot:
    def test_setup_snapshot_round_trips_identically(self):
        log = ProposalRunLog(
            **_proposal_run_log_kwargs(
                setup_snapshot=_valid_setup_snapshot_kwargs()
            )
        )
        assert isinstance(log.setup_snapshot, SetupSnapshot)

        dumped = log.model_dump(mode="json")
        reloaded = ProposalRunLog.model_validate(dumped)
        assert reloaded.model_dump(mode="json") == dumped
        assert isinstance(reloaded.setup_snapshot, SetupSnapshot)
        assert reloaded.setup_snapshot.dataset_id == log.setup_snapshot.dataset_id


# ---------------------------------------------------------------------------
# Backward compatibility — a ProposalRunLog WITHOUT setup_snapshot still loads
# ---------------------------------------------------------------------------


class TestProposalRunLogBackwardCompat:
    def test_missing_setup_snapshot_key_defaults_to_none(self):
        kwargs = _proposal_run_log_kwargs()
        assert "setup_snapshot" not in kwargs
        log = ProposalRunLog(**kwargs)
        assert log.setup_snapshot is None

    def test_pre_p3_persisted_run_dict_still_loads(self):
        # Simulates a run persisted before P3 existed: no setup_snapshot key
        # at all in the on-disk JSON.
        pre_p3_dict = _proposal_run_log_kwargs()
        assert "setup_snapshot" not in pre_p3_dict
        log = ProposalRunLog.model_validate(pre_p3_dict)
        assert log.setup_snapshot is None
        # And it still round-trips (dump omits nothing required downstream).
        dumped = log.model_dump(mode="json")
        assert dumped["setup_snapshot"] is None
        reloaded = ProposalRunLog.model_validate(dumped)
        assert reloaded.setup_snapshot is None

    def test_explicit_null_setup_snapshot_loads(self):
        log = ProposalRunLog(**_proposal_run_log_kwargs(setup_snapshot=None))
        assert log.setup_snapshot is None
