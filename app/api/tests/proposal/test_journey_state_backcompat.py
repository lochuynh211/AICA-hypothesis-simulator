"""TDD (T009): JourneyState back-compat — an old-shape (pre-P4) dict, holding
only the original 4 fields, still constructs a valid JourneyState with the
new P4 fields all defaulted.

data-model.md §"JourneyState (extend journey.py)": "Additive: all new fields
have defaults so existing persisted runs deserialize unchanged."
"""
from __future__ import annotations

from aica_api.models.proposal.enums import LifecycleStage, MotionState, PlaybackState
from aica_api.models.proposal.journey import JourneyState


def test_old_shape_dict_constructs_with_new_defaults():
    old_shape = {
        "lifecycle_stage": "before_rest_until_stop",
        "motion_state": "driving",
        "active_service_id": "music_playlist",
        "active_plan_id": None,
    }

    state = JourneyState(**old_shape)

    assert state.lifecycle_stage == LifecycleStage.before_rest_until_stop
    assert state.motion_state == MotionState.driving
    assert state.active_service_id.value == "music_playlist"
    assert state.active_plan_id is None
    # New P4 fields all default.
    assert state.playback_state == PlaybackState.idle
    assert state.current_plan_ref is None
    assert state.previous_content is None
    assert state.rejected_service_ids == []


def test_old_shape_with_none_active_service_and_plan():
    old_shape = {
        "lifecycle_stage": "during_rest_stopped",
        "motion_state": "stopped",
        "active_service_id": None,
        "active_plan_id": None,
    }

    state = JourneyState(**old_shape)

    assert state.active_service_id is None
    assert state.active_plan_id is None
    assert state.playback_state == PlaybackState.idle
    assert state.rejected_service_ids == []


def test_round_trip_json_serialization_preserves_new_defaults():
    old_shape = {
        "lifecycle_stage": "active_driving_content",
        "motion_state": "driving",
        "active_service_id": None,
        "active_plan_id": None,
    }
    state = JourneyState(**old_shape)
    dumped = state.model_dump(mode="json")

    assert dumped["playback_state"] == "idle"
    assert dumped["current_plan_ref"] is None
    assert dumped["previous_content"] is None
    assert dumped["rejected_service_ids"] == []

    # Re-loading the dump (as a full-shape run log would) round-trips.
    reloaded = JourneyState(**dumped)
    assert reloaded == state
