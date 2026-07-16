"""Golden projection test (T009) — ``World.project()`` — P3 Editable World (feature 014).

This is the most load-bearing test in feature 014: it pins ``World.project()``'s
output shape against the two ground-truth sources named in
``specs/014-proposal-p3-editable-world/research.md`` §R1:

1. The fixture ``proposal_contracts/fixtures/worlds/night-highway-baseline.json``
   (and its genre-affinity sibling) — group keys + field names per group.
2. The real content selector (``packages/aica_transparent_content_selector_v1``)
   — a cross-check that ``project()``'s output, plus a caller-supplied ``catalog``
   and ``_service_id``, is accepted by ``evaluate()`` without a KeyError and
   yields a valid ``CompletePlan``-shaped dict.
"""
from __future__ import annotations

import json

import pytest

from aica_api.config import settings
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
    ServiceId,
    TrafficState,
    TriggerPurpose,
)
from aica_api.models.proposal.selector_input import FeatureProvenanceEntry
from aica_api.models.proposal.world import ControlInputs, DriverProfile, Situation, World

from tests.proposal.conftest import build_content_context, load_catalog, load_content_selector

# ---------------------------------------------------------------------------
# Ground truth #1 — the P0.5 world/feature-snapshot fixtures
# ---------------------------------------------------------------------------

_WORLDS_FIXTURE_DIR = settings.proposal_contracts_dir / "fixtures" / "worlds"


def _load_fixture_groups(name: str) -> dict:
    with (_WORLDS_FIXTURE_DIR / name).open(encoding="utf-8") as fh:
        return json.load(fh)


_BASELINE_FIXTURE = _load_fixture_groups("night-highway-baseline.json")
_GENRE_FIXTURE = _load_fixture_groups("night-highway-genre-affinity-v1.json")


# ---------------------------------------------------------------------------
# Helpers — build a representative, fully-populated World
# ---------------------------------------------------------------------------


def _build_world(*, genre_on: bool = False) -> World:
    control_inputs = ControlInputs(
        trigger_purpose=TriggerPurpose.rest_recommended,
        lifecycle_stage=LifecycleStage.before_rest_until_stop,
        motion_state=MotionState.driving,
        matrix_version="1.0.0",
        dataset_id="soundcharts-grounded-spotify-compatible-demonstration-seed-1042",
    )
    situation = Situation(
        drowsiness_level=80,
        fatigue_level=70,
        traffic_state=TrafficState.congested,
        road_type=RoadType.highway,
        night_state=NightState.night,
        monotony_level=90,
        route_tags=["highway", "long_distance"],
        destination_tags=["urban"],
        child_present=False,
        multiple_passengers=False,
        motion_state=MotionState.driving,
        estimated_min_until_rest_spot=25,
        rest_spot_type=RestSpotType.sa_pa,
        active_service=None,
        recent_service_rejections=[
            {"service_id": "music_playlist", "rejected_at": "2026-07-14T20:00:00Z"}
        ],
    )
    driver_profile_kwargs = dict(
        oshi_registered=False,
        oshi_mode=OshiMode.off,
        oshi_id=None,
        oshi_type=None,
        oshi_tags=[],
        age_band=AgeBand.thirties,
        gender=Gender.unspecified,
        hobby_interest_tags=["music", "driving"],
        service_usage_level={"music_playlist": "med"},
        service_recency_state={"music_playlist": "recent"},
        scene_service_usage_level={"night_highway": {"music_playlist": "low"}},
        catalog_item_usage_level={"synthetic-track-1001": "med"},
        catalog_item_recency_state={"synthetic-track-1001": "recent"},
        content_tag_usage_level={"j-pop": "med"},
        content_tag_recency_state={"j-pop": "recent"},
        scene_content_tag_usage_level={"night_highway": {"j-pop": "low"}},
        played_items=[{"track_id": "synthetic-track-1001", "last_played_at": "2026-07-14T21:00:00Z"}],
        skipped_items=[],
        changed_from_items=[],
        cancelled_content_plans=[],
        completed_items=[],
        manually_selected_items=[],
        repeated_items=[],
        service_proposal_acceptance_rate={"music_playlist": 65.0},
        service_recovery_rate={"music_playlist": 70.0},
        content_proposal_acceptance_rate={"synthetic-track-1001": 60.0},
        content_recovery_rate={"synthetic-track-1001": 55.0},
        service_proposal_acceptance_confidence={"music_playlist": 0.5},
        service_recovery_confidence={"music_playlist": 0.5},
        content_proposal_acceptance_confidence={"synthetic-track-1001": 0.3},
        content_recovery_confidence={"synthetic-track-1001": 0.3},
        scheduled_event_type=None,
        scheduled_event_timing=None,
        scheduled_event_tags=[],
    )
    if genre_on:
        driver_profile_kwargs.update(
            genre_affinity_v1_enabled=True,
            usage_by_genre={"j-pop": "high", "ambient": "med"},
            scene_genre_usage={"night_highway": {"j-pop": "high"}},
        )
    driver_profile = DriverProfile(**driver_profile_kwargs)
    catalog_ref = CatalogRef(
        dataset_id="soundcharts-grounded-spotify-compatible-demonstration-seed-1042",
        dataset_version=DatasetVersion(
            schema_version="1.0.0",
            spotify_track_reference_version="1.0.0",
            spotify_audio_features_reference_version="1.0.0",
        ),
        dataset_hash="deadbeef",
    )
    return World(
        control_inputs=control_inputs,
        situation=situation,
        driver_profile=driver_profile,
        catalog_ref=catalog_ref,
    )


# ---------------------------------------------------------------------------
# Shape — group keys match the fixture exactly
# ---------------------------------------------------------------------------


class TestProjectionShape:
    def test_top_level_groups_without_genre(self):
        snapshot, _ = _build_world(genre_on=False).project()
        assert set(snapshot.keys()) == {
            "situation",
            "preference",
            "history",
            "additional_proposed",
            "_genre_extension_enabled",
        }
        assert snapshot["_genre_extension_enabled"] is False

    def test_top_level_groups_with_genre(self):
        snapshot, _ = _build_world(genre_on=True).project()
        assert set(snapshot.keys()) == {
            "situation",
            "preference",
            "history",
            "additional_proposed",
            "_genre_extension_enabled",
            "genre_affinity_v1",
        }
        assert snapshot["_genre_extension_enabled"] is True

    @pytest.mark.parametrize("group", ["situation", "preference", "history", "additional_proposed"])
    def test_group_field_names_match_baseline_fixture(self, group):
        snapshot, _ = _build_world(genre_on=False).project()
        assert set(snapshot[group].keys()) == set(_BASELINE_FIXTURE[group].keys()), (
            f"project()[{group!r}] field names diverge from the P0.5 fixture"
        )

    def test_genre_affinity_v1_block_is_world_owned_subset(self):
        """project() emits only the World-owned genre fields (usage_by_genre,
        scene_genre_usage) — NOT artist_genres, which is catalog-derived and
        merged in by the caller (see module docstring / research.md §R1)."""
        snapshot, _ = _build_world(genre_on=True).project()
        assert set(snapshot["genre_affinity_v1"].keys()) == {"usage_by_genre", "scene_genre_usage"}
        fixture_keys = set(_GENRE_FIXTURE["genre_affinity_v1"].keys())
        assert set(snapshot["genre_affinity_v1"].keys()) <= fixture_keys

    def test_no_catalog_or_service_id_leaked_by_project(self):
        """catalog / _service_id are not world-owned; project() must not invent them."""
        snapshot, _ = _build_world(genre_on=False).project()
        assert "catalog" not in snapshot
        assert "_service_id" not in snapshot


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


class TestProjectionDeterminism:
    def test_identical_world_yields_identical_snapshot(self):
        world_a = _build_world(genre_on=True)
        world_b = _build_world(genre_on=True)
        snap_a, prov_a = world_a.project()
        snap_b, prov_b = world_b.project()
        assert snap_a == snap_b
        assert prov_a == prov_b

    def test_repeated_calls_on_same_world_are_identical(self):
        world = _build_world(genre_on=False)
        snap1, prov1 = world.project()
        snap2, prov2 = world.project()
        assert snap1 == snap2
        assert prov1 == prov2


# ---------------------------------------------------------------------------
# Provenance
# ---------------------------------------------------------------------------


class TestProjectionProvenance:
    def test_provenance_covers_every_projected_scalar_feature(self):
        world = _build_world(genre_on=False)
        snapshot, provenance = world.project()
        for group in ("situation", "preference", "history", "additional_proposed"):
            for feature_id in snapshot[group]:
                assert feature_id in provenance, f"missing provenance for {feature_id!r}"
                assert isinstance(provenance[feature_id], FeatureProvenanceEntry)

    def test_provenance_matches_known_disposition_registry_entries(self):
        _, provenance = _build_world().project()
        assert provenance["drowsiness_level"].feature_origin.value == "cdc_su_baseline"
        assert provenance["road_type"].feature_origin.value == "normalized_cdc_su_concept"
        assert provenance["estimated_min_until_rest_spot"].feature_origin.value == "proposed_addition"


# ---------------------------------------------------------------------------
# Cross-check — accepted by the real content selector's evaluate() contract
# ---------------------------------------------------------------------------


class TestProjectionSelectorCrossCheck:
    def _run_selector(self, world: World, *, genre_on: bool):
        snapshot, _ = world.project()
        catalog = load_catalog("fixtures/catalog/smoke-catalog.json")
        snapshot = {**snapshot, "catalog": catalog, "_service_id": "music_playlist"}

        context = build_content_context(
            selected_service_id="music_playlist",
            trigger_purpose="rest_recommended",
            lifecycle_stage="before_rest_until_stop",
            feature_snapshot=snapshot,
            enabled_feature_extensions=["genre_affinity_v1"] if genre_on else [],
        )
        selector = load_content_selector()
        return selector.evaluate(context)

    def test_evaluate_runs_without_keyerror_no_genre(self):
        result = self._run_selector(_build_world(genre_on=False), genre_on=False)
        assert isinstance(result, dict)
        assert "decision_type" in result
        assert "ordered_items" in result
        assert "algorithm_provenance" in result

    def test_evaluate_runs_without_keyerror_with_genre(self):
        result = self._run_selector(_build_world(genre_on=True), genre_on=True)
        assert isinstance(result, dict)
        assert "decision_type" in result
        assert "ordered_items" in result

    def test_evaluate_yields_complete_plan_shape(self):
        result = self._run_selector(_build_world(genre_on=False), genre_on=False)
        # Shape compatibility, not exact scores: every CompletePlan key present.
        expected_keys = {
            "decision_type",
            "selected_service_id",
            "requested_item_count",
            "returned_item_count",
            "ordered_items",
            "mode",
            "expected_duration_sec",
            "lighting_configuration",
            "approval_policy",
            "completion_rule",
            "next_transition_policy",
            "excluded_items",
            "unused_available_features",
            "missing_features",
            "algorithm_provenance",
        }
        assert expected_keys <= set(result.keys())

    def test_evaluate_produces_complete_plan_decision(self):
        """With a real 6-song catalog and default plan_item_count=5, the
        representative world should actually yield a complete_plan (not an
        error) — proving the projected snapshot is fully usable, not just
        KeyError-safe."""
        result = self._run_selector(_build_world(genre_on=False), genre_on=False)
        assert result["decision_type"] == "complete_plan"
        assert result["returned_item_count"] == 5
