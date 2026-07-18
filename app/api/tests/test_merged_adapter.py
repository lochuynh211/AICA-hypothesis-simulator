"""Tests for the merged-simulator TriggerTickAdapter (feature 020, Task 2).

Pure mapping from a trigger ``TickOutcome``/``TickState`` onto a proposal
``World`` — the merge's core seam (design §4). No IO, no trigger/proposal
router imports here; only the models needed to build fixtures.
"""
from __future__ import annotations

import types

import pytest

from aica_api.models.proposal.dataset import CatalogRef, DatasetVersion
from aica_api.models.proposal.enums import (
    AgeBand,
    Gender,
    LifecycleStage,
    MotionState,
    NightState,
    OshiMode,
    RestSpotType,
    RoadType,
    TrafficState,
    TriggerPurpose,
)
from aica_api.models.proposal.world import ControlInputs, DriverProfile, Situation, World
from aica_api.services.merged_adapter import (
    build_world_from_tick,
    map_lifecycle_stage,
    map_road_type,
    map_trigger_purpose,
)

# ---------------------------------------------------------------------------
# Fixtures — minimal valid World template + a fake TickState
# ---------------------------------------------------------------------------


@pytest.fixture()
def base_world_template() -> World:
    return World(
        control_inputs=ControlInputs(
            trigger_purpose=TriggerPurpose.rest_recommended,
            lifecycle_stage=LifecycleStage.before_rest_until_stop,
            motion_state=MotionState.driving,
            matrix_version="1.0.0",
            dataset_id="soundcharts-grounded-spotify-compatible-demonstration-seed-1042",
        ),
        situation=Situation(
            drowsiness_level=50,
            fatigue_level=30,
            traffic_state=TrafficState.normal,
            road_type=RoadType.highway,
            night_state=NightState.night,
            monotony_level=60,
            route_tags=["highway"],
            destination_tags=["urban"],
            child_present=False,
            multiple_passengers=False,
            motion_state=MotionState.driving,
            estimated_min_until_rest_spot=25,
            rest_spot_type=RestSpotType.sa_pa,
            active_service=None,
            recent_service_rejections=[],
        ),
        driver_profile=DriverProfile(
            oshi_registered=False,
            oshi_mode=OshiMode.off,
            age_band=AgeBand.thirties,
            gender=Gender.unspecified,
            hobby_interest_tags=["music", "driving"],
        ),
        catalog_ref=CatalogRef(
            dataset_id="soundcharts-grounded-spotify-compatible-demonstration-seed-1042",
            dataset_version=DatasetVersion(
                schema_version="1.0.0",
                spotify_track_reference_version="1.0.0",
                spotify_audio_features_reference_version="1.0.0",
            ),
            dataset_hash="deadbeef",
        ),
    )


@pytest.fixture()
def fake_tick_state() -> types.SimpleNamespace:
    return types.SimpleNamespace(
        signals={
            "fixed": {"isNight": True},
            "dynamic": {
                "motionState": "STOPPED",
                "isTrafficJam": True,
                "segmentType": "mountain_road",
                "nextRestSpotMin": 3,
            },
            "simulated": {"drowsiness": 72.4, "fatigue": 55.1},
        },
        route_fraction=0.42,
        distance_km=12.3,
    )


# ---------------------------------------------------------------------------
# map_trigger_purpose
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "rt,exp",
    [
        ("REST_PROPOSAL", "rest_recommended"),
        ("MONOTONY_PROPOSAL", "inattentive_driving_prevention_recovery"),
        ("SUPPRESSED", None),
        ("NO_PROPOSAL", None),
    ],
)
def test_purpose_mapping(rt, exp):
    assert map_trigger_purpose(rt) == exp


# ---------------------------------------------------------------------------
# map_lifecycle_stage
# ---------------------------------------------------------------------------


def test_stage_mapping():
    assert map_lifecycle_stage(fired=True, result_type="REST_PROPOSAL", recovery_phase=None) == "before_rest_until_stop"
    assert map_lifecycle_stage(fired=False, result_type="NO_PROPOSAL", recovery_phase=None) == "active_driving_content"
    assert map_lifecycle_stage(fired=True, result_type="REST_PROPOSAL", recovery_phase="nap") == "during_rest_stopped"


# ---------------------------------------------------------------------------
# map_road_type
# ---------------------------------------------------------------------------


def test_road_mapping():
    assert map_road_type("mountain_road") == "mountain"
    assert map_road_type("highway") == "highway"
    assert map_road_type(None) == "parking"


# ---------------------------------------------------------------------------
# build_world_from_tick
# ---------------------------------------------------------------------------


def test_build_world_overwrites_generated_and_syncs_motion(base_world_template, fake_tick_state):
    w = build_world_from_tick(
        base_world_template,
        fake_tick_state,
        trigger_purpose="rest_recommended",
        lifecycle_stage="before_rest_until_stop",
    )
    assert w.situation.drowsiness_level == 72 and w.situation.fatigue_level == 55
    assert w.situation.traffic_state == "congested" and w.situation.road_type == "mountain" and w.situation.night_state == "night"
    assert w.situation.motion_state == "stopped" and w.control_inputs.motion_state == "stopped"  # BOTH synced
    assert w.control_inputs.trigger_purpose == "rest_recommended" and w.control_inputs.lifecycle_stage == "before_rest_until_stop"
    # INLINE fields preserved from template:
    assert w.driver_profile == base_world_template.driver_profile
    assert w.situation.destination_tags == base_world_template.situation.destination_tags
