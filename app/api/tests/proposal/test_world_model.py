"""Tests for the typed World model (T007) — P3 Editable World (feature 014).

Covers:
- ``ControlInputs`` purpose/stage compatibility (reuses the shared rule already
  proven for ``ProposalOpportunity``/``SelectorInput``/``PurposeStageServiceMatrix``).
- ``Situation`` range/enum validation.
- ``DriverProfile`` range validation (percent/unit-interval maps) + genre extension.
- ``World`` assembly.
- Field completeness: every A.1/A.2 feature (the frozen
  ``CONTENT_FEATURE_DISPOSITIONS`` registry) appears exactly once across
  ``Situation`` + ``DriverProfile`` (excluding the opt-in genre fields, which are
  not part of the A.1/A.2 count).
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from aica_api.models.proposal.dataset import CatalogRef, DatasetVersion
from aica_api.models.proposal.dispositions import CONTENT_FEATURE_DISPOSITIONS
from aica_api.models.proposal.enums import (
    AgeBand,
    Gender,
    LifecycleStage,
    MotionState,
    NightState,
    OshiMode,
    RestSpotType,
    RoadType,
    ServiceId,
    TrafficState,
    TriggerPurpose,
)
from aica_api.models.proposal.world import ControlInputs, DriverProfile, Situation, World

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


def _valid_control_inputs(**overrides) -> dict:
    base = dict(
        trigger_purpose=TriggerPurpose.rest_recommended,
        lifecycle_stage=LifecycleStage.before_rest_until_stop,
        motion_state=MotionState.driving,
        matrix_version="1.0.0",
        dataset_id="soundcharts-grounded-spotify-compatible-demonstration-seed-1042",
    )
    base.update(overrides)
    return base


def _valid_situation(**overrides) -> dict:
    base = dict(
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
    )
    base.update(overrides)
    return base


def _valid_driver_profile(**overrides) -> dict:
    base = dict(
        oshi_registered=False,
        oshi_mode=OshiMode.off,
        oshi_id=None,
        oshi_type=None,
        oshi_tags=[],
        age_band=AgeBand.thirties,
        gender=Gender.unspecified,
        hobby_interest_tags=["music", "driving"],
        service_usage_level={},
        service_recency_state={},
        scene_service_usage_level={},
        catalog_item_usage_level={},
        catalog_item_recency_state={},
        content_tag_usage_level={},
        content_tag_recency_state={},
        scene_content_tag_usage_level={},
        played_items=[],
        skipped_items=[],
        changed_from_items=[],
        cancelled_content_plans=[],
        completed_items=[],
        manually_selected_items=[],
        repeated_items=[],
        service_proposal_acceptance_rate={},
        service_recovery_rate={},
        content_proposal_acceptance_rate={},
        content_recovery_rate={},
        service_proposal_acceptance_confidence={},
        service_recovery_confidence={},
        content_proposal_acceptance_confidence={},
        content_recovery_confidence={},
        scheduled_event_type=None,
        scheduled_event_timing=None,
        scheduled_event_tags=[],
    )
    base.update(overrides)
    return base


def _valid_catalog_ref() -> CatalogRef:
    return CatalogRef(
        dataset_id="soundcharts-grounded-spotify-compatible-demonstration-seed-1042",
        dataset_version=DatasetVersion(
            schema_version="1.0.0",
            spotify_track_reference_version="1.0.0",
            spotify_audio_features_reference_version="1.0.0",
        ),
        dataset_hash="deadbeef",
    )


def _valid_world(**overrides) -> World:
    return World(
        control_inputs=ControlInputs(**overrides.get("control_inputs", _valid_control_inputs())),
        situation=Situation(**overrides.get("situation", _valid_situation())),
        driver_profile=DriverProfile(**overrides.get("driver_profile", _valid_driver_profile())),
        catalog_ref=overrides.get("catalog_ref", _valid_catalog_ref()),
    )


# ---------------------------------------------------------------------------
# ControlInputs
# ---------------------------------------------------------------------------


class TestControlInputs:
    def test_valid_construction(self):
        ci = ControlInputs(**_valid_control_inputs())
        assert ci.trigger_purpose == TriggerPurpose.rest_recommended
        assert ci.motion_state == MotionState.driving

    def test_rest_stage_with_non_rest_purpose_rejected(self):
        with pytest.raises(ValidationError):
            ControlInputs(
                **_valid_control_inputs(
                    trigger_purpose=TriggerPurpose.route_music,
                    lifecycle_stage=LifecycleStage.during_rest_stopped,
                )
            )

    def test_active_driving_content_with_rest_purpose_rejected(self):
        with pytest.raises(ValidationError):
            ControlInputs(
                **_valid_control_inputs(
                    trigger_purpose=TriggerPurpose.rest_recommended,
                    lifecycle_stage=LifecycleStage.active_driving_content,
                )
            )

    def test_active_driving_content_with_compatible_purpose_accepted(self):
        ci = ControlInputs(
            **_valid_control_inputs(
                trigger_purpose=TriggerPurpose.route_music,
                lifecycle_stage=LifecycleStage.active_driving_content,
            )
        )
        assert ci.lifecycle_stage == LifecycleStage.active_driving_content

    def test_empty_matrix_version_rejected(self):
        with pytest.raises(ValidationError):
            ControlInputs(**_valid_control_inputs(matrix_version=""))

    def test_empty_dataset_id_rejected(self):
        with pytest.raises(ValidationError):
            ControlInputs(**_valid_control_inputs(dataset_id=""))

    def test_extra_field_rejected(self):
        with pytest.raises(ValidationError):
            ControlInputs(**_valid_control_inputs(), unknown_field=1)


# ---------------------------------------------------------------------------
# Situation
# ---------------------------------------------------------------------------


class TestSituation:
    def test_valid_construction(self):
        s = Situation(**_valid_situation())
        assert s.drowsiness_level == 50
        assert s.traffic_state == TrafficState.normal

    @pytest.mark.parametrize("field", ["drowsiness_level", "fatigue_level", "monotony_level"])
    def test_level_below_zero_rejected(self, field):
        with pytest.raises(ValidationError):
            Situation(**_valid_situation(**{field: -1}))

    @pytest.mark.parametrize("field", ["drowsiness_level", "fatigue_level", "monotony_level"])
    def test_level_above_100_rejected(self, field):
        with pytest.raises(ValidationError):
            Situation(**_valid_situation(**{field: 101}))

    @pytest.mark.parametrize("field", ["drowsiness_level", "fatigue_level", "monotony_level"])
    def test_level_boundary_values_accepted(self, field):
        assert Situation(**_valid_situation(**{field: 0}))
        assert Situation(**_valid_situation(**{field: 100}))

    def test_invalid_traffic_state_enum_rejected(self):
        with pytest.raises(ValidationError):
            Situation(**_valid_situation(traffic_state="gridlock"))

    def test_invalid_road_type_enum_rejected(self):
        with pytest.raises(ValidationError):
            Situation(**_valid_situation(road_type="dirt"))

    def test_negative_estimated_min_until_rest_spot_rejected(self):
        with pytest.raises(ValidationError):
            Situation(**_valid_situation(estimated_min_until_rest_spot=-1))

    def test_estimated_min_until_rest_spot_none_accepted(self):
        s = Situation(**_valid_situation(estimated_min_until_rest_spot=None))
        assert s.estimated_min_until_rest_spot is None

    def test_active_service_accepts_service_id_or_none(self):
        s = Situation(**_valid_situation(active_service=ServiceId.music_playlist))
        assert s.active_service == ServiceId.music_playlist

    def test_recent_service_rejections_shape(self):
        s = Situation(
            **_valid_situation(
                recent_service_rejections=[
                    {"service_id": "music_playlist", "rejected_at": "2026-07-14T22:00:00Z"}
                ]
            )
        )
        assert s.recent_service_rejections[0].service_id == ServiceId.music_playlist

    def test_extra_field_rejected(self):
        with pytest.raises(ValidationError):
            Situation(**_valid_situation(), unknown_field=1)


# ---------------------------------------------------------------------------
# DriverProfile
# ---------------------------------------------------------------------------


class TestDriverProfile:
    def test_valid_construction(self):
        dp = DriverProfile(**_valid_driver_profile())
        assert dp.age_band == AgeBand.thirties
        assert dp.genre_affinity_v1_enabled is False

    def test_rate_map_above_100_rejected(self):
        with pytest.raises(ValidationError):
            DriverProfile(
                **_valid_driver_profile(
                    service_proposal_acceptance_rate={"music_playlist": 150.0}
                )
            )

    def test_rate_map_negative_rejected(self):
        with pytest.raises(ValidationError):
            DriverProfile(
                **_valid_driver_profile(content_recovery_rate={"synthetic-track-0001": -5.0})
            )

    def test_confidence_map_above_one_rejected(self):
        with pytest.raises(ValidationError):
            DriverProfile(
                **_valid_driver_profile(
                    service_proposal_acceptance_confidence={"music_playlist": 1.5}
                )
            )

    def test_confidence_map_negative_rejected(self):
        with pytest.raises(ValidationError):
            DriverProfile(
                **_valid_driver_profile(
                    content_recovery_confidence={"synthetic-track-0001": -0.1}
                )
            )

    def test_rate_and_confidence_boundary_values_accepted(self):
        dp = DriverProfile(
            **_valid_driver_profile(
                service_proposal_acceptance_rate={"music_playlist": 0.0},
                service_recovery_rate={"music_playlist": 100.0},
                service_proposal_acceptance_confidence={"music_playlist": 0.0},
                service_recovery_confidence={"music_playlist": 1.0},
            )
        )
        assert dp.service_recovery_rate[ServiceId.music_playlist] == 100.0

    def test_played_items_shape(self):
        dp = DriverProfile(
            **_valid_driver_profile(
                played_items=[{"track_id": "synthetic-track-0001", "last_played_at": "2026-07-14T22:00:00Z"}]
            )
        )
        assert dp.played_items[0].track_id == "synthetic-track-0001"

    def test_genre_extension_off_by_default(self):
        dp = DriverProfile(**_valid_driver_profile())
        assert dp.genre_affinity_v1_enabled is False
        assert dp.usage_by_genre is None
        assert dp.scene_genre_usage is None

    def test_genre_extension_enabled_with_data(self):
        dp = DriverProfile(
            **_valid_driver_profile(
                genre_affinity_v1_enabled=True,
                usage_by_genre={"j-pop": "high", "ambient": "med"},
                scene_genre_usage={"night_highway": {"j-pop": "high"}},
            )
        )
        assert dp.genre_affinity_v1_enabled is True
        assert dp.usage_by_genre["j-pop"] == "high"

    def test_invalid_genre_literal_rejected(self):
        with pytest.raises(ValidationError):
            DriverProfile(
                **_valid_driver_profile(
                    genre_affinity_v1_enabled=True,
                    usage_by_genre={"not-a-real-genre": "high"},
                )
            )

    def test_extra_field_rejected(self):
        with pytest.raises(ValidationError):
            DriverProfile(**_valid_driver_profile(), unknown_field=1)


# ---------------------------------------------------------------------------
# World
# ---------------------------------------------------------------------------


class TestWorld:
    def test_valid_construction(self):
        world = _valid_world()
        assert isinstance(world.control_inputs, ControlInputs)
        assert isinstance(world.situation, Situation)
        assert isinstance(world.driver_profile, DriverProfile)
        assert isinstance(world.catalog_ref, CatalogRef)

    def test_extra_field_rejected(self):
        with pytest.raises(ValidationError):
            World(
                control_inputs=ControlInputs(**_valid_control_inputs()),
                situation=Situation(**_valid_situation()),
                driver_profile=DriverProfile(**_valid_driver_profile()),
                catalog_ref=_valid_catalog_ref(),
                unknown_field=1,
            )


# ---------------------------------------------------------------------------
# Field completeness — every A.1/A.2 registry feature appears exactly once
# ---------------------------------------------------------------------------


class TestFieldCompleteness:
    def test_every_disposition_feature_present_exactly_once(self):
        situation_fields = set(Situation.model_fields.keys())
        profile_fields = set(DriverProfile.model_fields.keys()) - {
            "genre_affinity_v1_enabled",
            "usage_by_genre",
            "scene_genre_usage",
        }

        # No collisions between the two owning models.
        assert situation_fields.isdisjoint(profile_fields), (
            f"Fields owned by both Situation and DriverProfile: "
            f"{situation_fields & profile_fields}"
        )

        owned_fields = situation_fields | profile_fields
        registry_feature_ids = [entry.feature_id for entry in CONTENT_FEATURE_DISPOSITIONS]

        # No duplicates in the registry itself (sanity).
        assert len(registry_feature_ids) == len(set(registry_feature_ids))

        missing = set(registry_feature_ids) - owned_fields
        assert not missing, f"A.1/A.2 fields missing from Situation/DriverProfile: {missing}"

        # Every registry feature is owned by exactly one of the two models.
        for feature_id in registry_feature_ids:
            in_situation = feature_id in situation_fields
            in_profile = feature_id in profile_fields
            assert in_situation != in_profile, (
                f"Feature '{feature_id}' must be owned by exactly one of "
                f"Situation/DriverProfile (situation={in_situation}, profile={in_profile})"
            )

    def test_registry_has_49_entries(self):
        # Sanity: 11 Situation + 20 Preference + 7 History + 11 Additional
        # proposed = 49 (spec §9 Appendix A.2 row count).
        assert len(CONTENT_FEATURE_DISPOSITIONS) == 49
