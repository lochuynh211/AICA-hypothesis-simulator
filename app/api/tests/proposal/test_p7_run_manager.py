"""TDD (T003): P7 run-manager surface widening.

Covers (data-model.md §"Run-manager surface", research.md D4):
  - ``create_run(..., world=..., mode=quick_check)`` persists both fields.
  - ``update_state(..., opportunity=..., world_snapshot=..., \
opportunity_history=[...], setup_snapshot_history=[...])`` replaces the head
    fields + history lists, deep-copying so a later mutation of the caller's
    own objects never retroactively changes the persisted log.
  - Omitted (``None``) kwargs on ``update_state`` leave the corresponding
    fields unchanged.
"""
from __future__ import annotations

import copy

from aica_api.models.proposal.dataset import CatalogRef, DatasetVersion
from aica_api.models.proposal.enums import (
    LifecycleStage,
    ProposalRunMode,
    ServiceId,
    TriggerPurpose,
)
from aica_api.models.proposal.journey import JourneyState
from aica_api.models.proposal.opportunity import ProposalOpportunity
from aica_api.models.proposal.proposal_run import ProposalRunLog
from aica_api.models.proposal.world import (
    ControlInputs,
    DriverProfile,
    Situation,
    SetupSnapshot,
    SetupSnapshotOrigin,
    World,
)
from aica_api.services import proposal_run_manager as prm

_DATASET_ID = "soundcharts-grounded-spotify-compatible-demonstration-seed-1042"


def _bare_world() -> World:
    return World(
        control_inputs=ControlInputs(
            trigger_purpose="rest_recommended",
            lifecycle_stage="before_rest_until_stop",
            motion_state="driving",
            matrix_version="v1",
            dataset_id=_DATASET_ID,
        ),
        situation=Situation(
            drowsiness_level=50,
            fatigue_level=50,
            traffic_state="normal",
            road_type="highway",
            night_state="day",
            monotony_level=50,
            route_tags=[],
            destination_tags=[],
            child_present=False,
            multiple_passengers=False,
            motion_state="driving",
            estimated_min_until_rest_spot=10,
            rest_spot_type="sa_pa",
            active_service=None,
            recent_service_rejections=[],
        ),
        driver_profile=DriverProfile(
            oshi_registered=False,
            oshi_mode="off",
            age_band="30s",
            gender="unspecified",
        ),
        catalog_ref=CatalogRef(
            dataset_id=_DATASET_ID,
            dataset_version=DatasetVersion(
                schema_version="1.0.0",
                spotify_track_reference_version="1.0.0",
                spotify_audio_features_reference_version="1.0.0",
            ),
            dataset_hash="sha256:83d8079c7a81bc6afbd01cdba65fe2330de66b900a113723814fa938fce516cd",
        ),
    )


def _opportunity(opportunity_id: str = "op-test-1") -> ProposalOpportunity:
    return ProposalOpportunity(
        opportunity_id=opportunity_id,
        trigger_purpose=TriggerPurpose.rest_recommended,
        lifecycle_stage=LifecycleStage.after_rest_before_restart,
        allowed_service_ids=[ServiceId.live_viewing, ServiceId.stretch_video],
        simulation_time="2026-07-16T10:00:00Z",
        run_seed="seed-1",
    )


def _journey_state() -> JourneyState:
    return JourneyState(
        lifecycle_stage=LifecycleStage.after_rest_before_restart,
        motion_state="stopped",
        active_service_id=None,
        active_plan_id=None,
    )


def _setup_snapshot() -> SetupSnapshot:
    return SetupSnapshot(
        origin=SetupSnapshotOrigin(seed_id="seed-night-highway-oshi"),
        matrix_version="v1",
        dataset_id=_DATASET_ID,
        dataset_hash="sha256:83d8079c7a81bc6afbd01cdba65fe2330de66b900a113723814fa938fce516cd",
        service_package_id="aica_transparent_service_selector_v1",
        service_contract_version="1.0.0",
        service_parameter_set_version="1.0.0",
    )


def _create(runs_dir, **overrides) -> ProposalRunLog:
    kwargs = dict(
        opportunity=_opportunity(),
        matrix_version="v1",
        world_snapshot={"feature_snapshot": {}, "feature_provenance": {}},
        service_package_id="mock_service_selector_v1",
        content_package_id=None,
        parameters={"top_k": 3},
        hyperparameters={"response_matrix": {}},
        journey_state=_journey_state(),
        runs_dir=runs_dir,
    )
    kwargs.update(overrides)
    return prm.create_run(**kwargs)


# ---------------------------------------------------------------------------
# create_run — world / mode
# ---------------------------------------------------------------------------


def test_create_run_persists_world_and_mode(tmp_path):
    world = _bare_world()
    log = _create(tmp_path, world=world, mode=ProposalRunMode.quick_check)

    assert log.world is not None
    assert log.world.model_dump(mode="json") == world.model_dump(mode="json")
    assert log.mode == ProposalRunMode.quick_check

    reopened = prm.get_run(log.run_id, tmp_path)
    assert reopened.world is not None
    assert reopened.mode == ProposalRunMode.quick_check


def test_create_run_defaults_world_none_and_mode_interactive(tmp_path):
    log = _create(tmp_path)
    assert log.world is None
    assert log.mode == ProposalRunMode.interactive


def test_create_run_deep_copies_world(tmp_path):
    world = _bare_world()
    log = _create(tmp_path, world=world)
    world.situation.drowsiness_level = 999  # mutate caller's world after creation

    reopened = prm.get_run(log.run_id, tmp_path)
    assert reopened.world.situation.drowsiness_level != 999


def test_list_runs_reports_mode(tmp_path):
    _create(tmp_path, mode=ProposalRunMode.quick_check)
    _create(tmp_path, mode=ProposalRunMode.interactive)

    summaries = prm.list_runs(tmp_path)
    modes = {s.mode for s in summaries}
    assert modes == {ProposalRunMode.quick_check, ProposalRunMode.interactive}


# ---------------------------------------------------------------------------
# update_state — opportunity / world_snapshot / opportunity_history /
# setup_snapshot_history
# ---------------------------------------------------------------------------


def test_update_state_replaces_opportunity_head(tmp_path):
    log = _create(tmp_path)
    new_opportunity = _opportunity("op-test-2")

    updated = prm.update_state(log.run_id, tmp_path, opportunity=new_opportunity)
    assert updated.opportunity.opportunity_id == "op-test-2"

    reopened = prm.get_run(log.run_id, tmp_path)
    assert reopened.opportunity.opportunity_id == "op-test-2"


def test_update_state_replaces_world_snapshot(tmp_path):
    log = _create(tmp_path)
    new_snapshot = {"feature_snapshot": {"situation": {"drowsiness_level": 90}}, "feature_provenance": {}}

    updated = prm.update_state(log.run_id, tmp_path, world_snapshot=new_snapshot)
    assert updated.world_snapshot == new_snapshot

    reopened = prm.get_run(log.run_id, tmp_path)
    assert reopened.world_snapshot == new_snapshot


def test_update_state_replaces_history_lists(tmp_path):
    log = _create(tmp_path)
    opp_history = [_opportunity("op-test-0")]
    setup_history = [_setup_snapshot()]

    updated = prm.update_state(
        log.run_id,
        tmp_path,
        opportunity_history=opp_history,
        setup_snapshot_history=setup_history,
    )
    assert [o.opportunity_id for o in updated.opportunity_history] == ["op-test-0"]
    assert len(updated.setup_snapshot_history) == 1

    reopened = prm.get_run(log.run_id, tmp_path)
    assert [o.opportunity_id for o in reopened.opportunity_history] == ["op-test-0"]
    assert len(reopened.setup_snapshot_history) == 1


def test_update_state_deep_copies_history_lists(tmp_path):
    log = _create(tmp_path)
    opp_history = [_opportunity("op-test-0")]

    prm.update_state(log.run_id, tmp_path, opportunity_history=opp_history)
    opp_history[0] = _opportunity("op-test-MUTATED")  # mutate caller's list after the call

    reopened = prm.get_run(log.run_id, tmp_path)
    assert [o.opportunity_id for o in reopened.opportunity_history] == ["op-test-0"]


def test_update_state_omitted_kwargs_leave_fields_unchanged(tmp_path):
    world = _bare_world()
    log = _create(tmp_path, world=world, mode=ProposalRunMode.quick_check)

    updated = prm.update_state(log.run_id, tmp_path, status=log.status)

    assert updated.world is not None
    assert updated.mode == ProposalRunMode.quick_check
    assert updated.opportunity.opportunity_id == log.opportunity.opportunity_id
    assert updated.world_snapshot == log.world_snapshot
    assert updated.opportunity_history == []
    assert updated.setup_snapshot_history == []
