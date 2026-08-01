"""TDD — the oshi_artists contract (feature 025 slice S2).

Replaces the single ``oshi_id``/``oshi_type`` pair on ``DriverProfile`` with a
list of ``OshiArtist`` entries, each carrying its own 熱狂度 (enthusiasm) in
[0.0, 1.0] on a 0.1 grid (the UI slider's own grid — a value the slider
cannot produce must not be loadable from JSON either). This is a HARD
migration (the owner explicitly chose it over a compatibility shim): a
legacy profile dict still carrying ``oshi_id`` is now REJECTED outright by
``DriverProfile``'s ``extra="forbid"``.

Covers:
  - ``OshiArtist.enthusiasm`` range + 0.1-grid validation.
  - Duplicate ``artist_id`` rejection within one profile.
  - The hard migration (a legacy ``oshi_id`` key is now an unknown/forbidden
    field on ``DriverProfile``).
  - ``World.project()`` writing ``oshi_artists`` into
    ``feature_snapshot["preference"]`` as plain JSON-safe dicts.
  - The disposition registry rename (``oshi_id`` -> ``oshi_artists``; the
    ``oshi_type`` row is gone).
  - The content selector's ``oshi`` leaf: gate unchanged, affinity becomes
    the MAX enthusiasm among matched artists (not a sum) — byte-identical to
    the old binary behaviour for a single artist at enthusiasm 1.0.
  - ``world_validation``'s per-index unknown-artist reporting.
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
    OshiType,
    RestSpotType,
    RoadType,
    TrafficState,
    TriggerPurpose,
)
from aica_api.models.proposal.song_schema import Song
from aica_api.models.proposal.world import ControlInputs, DriverProfile, OshiArtist, Situation, World
from aica_api.services.world_validation import validate_world

from tests.proposal.conftest import (
    build_content_context,
    load_catalog,
    load_content_selector,
    manifest_hyperparameters,
)

# ---------------------------------------------------------------------------
# Helpers — mirrors test_world_model.py's _valid_driver_profile shape, minus
# the now-deleted oshi_id/oshi_type, plus oshi_artists. Kept local (not
# imported) since this test file must not depend on the sibling data-
# migration slice's fixtures/seeds, which still carry the OLD shape.
# ---------------------------------------------------------------------------


def _valid_driver_profile(**overrides) -> dict:
    base = dict(
        oshi_registered=False,
        oshi_mode=OshiMode.off,
        oshi_artists=[],
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


def _build_world(driver_profile: DriverProfile) -> World:
    return World(
        control_inputs=ControlInputs(
            trigger_purpose=TriggerPurpose.rest_recommended,
            lifecycle_stage=LifecycleStage.before_rest_until_stop,
            motion_state=MotionState.driving,
            matrix_version="1.0.0",
            dataset_id="soundcharts-grounded-spotify-compatible-demonstration-seed-1042",
        ),
        situation=Situation(**_valid_situation()),
        driver_profile=driver_profile,
        catalog_ref=_valid_catalog_ref(),
    )


# ---------------------------------------------------------------------------
# OshiArtist — enthusiasm range + 0.1-grid validation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("value", [0.0, 0.1, 0.5, 0.9, 1.0])
def test_enthusiasm_on_grid_is_accepted(value):
    artist = OshiArtist(artist_id="artist-1", enthusiasm=value)
    assert artist.enthusiasm == value


def test_enthusiasm_off_grid_is_rejected():
    with pytest.raises(ValidationError, match="0.1"):
        OshiArtist(artist_id="artist-1", enthusiasm=0.35)


@pytest.mark.parametrize("value", [-0.1, 1.1, -1.0, 2.0])
def test_enthusiasm_out_of_range_is_rejected(value):
    with pytest.raises(ValidationError):
        OshiArtist(artist_id="artist-1", enthusiasm=value)


def test_oshi_artist_default_type_and_enthusiasm():
    artist = OshiArtist(artist_id="artist-1")
    assert artist.oshi_type == OshiType.artist
    assert artist.enthusiasm == 1.0


def test_oshi_artist_forbids_extra_fields():
    with pytest.raises(ValidationError):
        OshiArtist(artist_id="artist-1", oshi_id="legacy-leftover")


# ---------------------------------------------------------------------------
# Duplicate artist_id within one profile
# ---------------------------------------------------------------------------


def test_duplicate_artist_id_is_rejected():
    with pytest.raises(ValidationError, match="[Dd]uplicate"):
        DriverProfile(**_valid_driver_profile(
            oshi_registered=True,
            oshi_mode=OshiMode.on,
            oshi_artists=[
                OshiArtist(artist_id="artist-1", enthusiasm=0.5),
                OshiArtist(artist_id="artist-1", enthusiasm=0.8),
            ],
        ))


def test_distinct_artist_ids_are_accepted():
    profile = DriverProfile(**_valid_driver_profile(
        oshi_registered=True,
        oshi_mode=OshiMode.on,
        oshi_artists=[
            OshiArtist(artist_id="artist-1", enthusiasm=0.5),
            OshiArtist(artist_id="artist-2", enthusiasm=0.8),
        ],
    ))
    assert len(profile.oshi_artists) == 2


# ---------------------------------------------------------------------------
# Hard migration — a legacy oshi_id JSON field is REJECTED (extra="forbid")
# ---------------------------------------------------------------------------


def test_legacy_oshi_id_field_is_rejected():
    legacy = _valid_driver_profile()
    legacy.pop("oshi_artists")
    legacy["oshi_id"] = "some-artist-id"
    legacy["oshi_type"] = "artist"
    with pytest.raises(ValidationError):
        DriverProfile(**legacy)


# ---------------------------------------------------------------------------
# World.project() — oshi_artists lands in feature_snapshot["preference"] as
# plain JSON-safe dicts (not OshiArtist model instances).
# ---------------------------------------------------------------------------


def test_project_puts_oshi_artists_dict_shape_into_preference():
    world = _build_world(DriverProfile(**_valid_driver_profile(
        oshi_registered=True,
        oshi_mode=OshiMode.on,
        oshi_artists=[
            OshiArtist(artist_id="artist-1", oshi_type=OshiType.artist, enthusiasm=0.7),
            OshiArtist(artist_id="artist-2", oshi_type=OshiType.group, enthusiasm=0.3),
        ],
    )))
    feature_snapshot, _ = world.project()
    assert feature_snapshot["preference"]["oshi_artists"] == [
        {"artist_id": "artist-1", "oshi_type": "artist", "enthusiasm": 0.7},
        {"artist_id": "artist-2", "oshi_type": "group", "enthusiasm": 0.3},
    ]
    for entry in feature_snapshot["preference"]["oshi_artists"]:
        assert isinstance(entry, dict)  # not an OshiArtist instance


def test_disposition_registry_scores_oshi_artists_not_oshi_id():
    entry = next(e for e in CONTENT_FEATURE_DISPOSITIONS if e.feature_id == "oshi_artists")
    assert entry.category == "Preference"
    assert entry.disposition.value == "scored"
    assert entry.response_provenance.value == "cdc_su_explicit"
    assert not any(e.feature_id == "oshi_id" for e in CONTENT_FEATURE_DISPOSITIONS)
    assert not any(e.feature_id == "oshi_type" for e in CONTENT_FEATURE_DISPOSITIONS)
    # oshi_tags stays untouched (still context-only, still present).
    tags_entry = next(e for e in CONTENT_FEATURE_DISPOSITIONS if e.feature_id == "oshi_tags")
    assert tags_entry.disposition.value == "context_only"


# ---------------------------------------------------------------------------
# Scoring — packages/aica_transparent_content_selector_v1/algorithm.py's
# `oshi` leaf: max enthusiasm among MATCHED artists, not sum.
# ---------------------------------------------------------------------------

CS = load_content_selector()
HP = manifest_hyperparameters()


def _oshi_leaf(snap: dict, track: dict):
    traits = {"arousal_signed": 0.0, "valence_signed": 0.0}
    return CS._feature_e_a(
        "oshi", {"feature_id": "oshi_artists"}, snap, track, traits, HP, None, False, None, None
    )


def _track(artist_ids: list[str]) -> dict:
    return {"id": "trk", "artists": [{"id": aid} for aid in artist_ids]}


def _oshi_snapshot(entries: list[dict], *, registered: bool = True, mode: str = "on") -> dict:
    return {"preference": {
        "oshi_registered": registered,
        "oshi_mode": mode,
        "oshi_artists": entries,
    }}


def test_single_artist_enthusiasm_one_reproduces_old_binary_match_exactly():
    snap = _oshi_snapshot([{"artist_id": "artist-1", "enthusiasm": 1.0}])
    e, a, meta = _oshi_leaf(snap, _track(["artist-1"]))
    assert e == 1.0
    assert a == 1.0
    assert meta["exact_match"] is True


def test_matched_artist_at_partial_enthusiasm():
    snap = _oshi_snapshot([{"artist_id": "artist-1", "enthusiasm": 0.4}])
    e, a, meta = _oshi_leaf(snap, _track(["artist-1"]))
    assert a == 0.4


def test_two_matched_oshi_on_same_song_take_max_not_sum():
    snap = _oshi_snapshot([
        {"artist_id": "artist-1", "enthusiasm": 0.3},
        {"artist_id": "artist-2", "enthusiasm": 0.8},
    ])
    e, a, meta = _oshi_leaf(snap, _track(["artist-1", "artist-2"]))
    assert a == 0.8
    assert a != pytest.approx(0.3 + 0.8)


def test_no_matching_artist_gives_zero_affinity():
    snap = _oshi_snapshot([{"artist_id": "artist-1", "enthusiasm": 1.0}])
    e, a, meta = _oshi_leaf(snap, _track(["someone-else"]))
    assert a == 0.0
    assert meta["exact_match"] is False


def test_oshi_mode_off_gates_to_zero_regardless_of_matches():
    snap = _oshi_snapshot([{"artist_id": "artist-1", "enthusiasm": 1.0}], mode="off")
    e, a, meta = _oshi_leaf(snap, _track(["artist-1"]))
    assert e == 0.0


def test_trace_carries_matched_artist_ids_and_enthusiasm():
    snap = _oshi_snapshot([{"artist_id": "artist-1", "enthusiasm": 0.6}])
    e, a, meta = _oshi_leaf(snap, _track(["artist-1"]))
    assert meta["matched_artist_ids"] == ["artist-1"]
    assert meta["enthusiasm"] == 0.6


def test_matched_artist_ids_survives_all_the_way_to_the_frozen_output_model():
    """The leaf emitting ``matched_artist_ids`` is not enough — it has to reach
    the API.

    It previously did not, in two independent places, and the test above passed
    the whole time because it only ever inspected ``_feature_e_a``'s own ``meta``
    dict: ``evaluate``'s per-contribution assembly listed its keys explicitly and
    never read this one, and ``ItemFeatureContribution`` had no field for it, so
    anything that did slip through was dropped again at serialization. This test
    goes through the real ``evaluate`` and the real frozen model, which is the
    only path that can catch either.
    """
    from aica_api.models.proposal.content_output import CompletePlan

    # The smoke catalog, not worked-example: the latter holds a single song, so
    # the selector returns `insufficient_eligible_items` with no plan at all and
    # every assertion below would pass vacuously on an empty list.
    catalog = load_catalog("fixtures/catalog/smoke-catalog.json")
    # An artist genuinely credited on a track in the fixture catalog, so the leaf
    # actually matches rather than the assertion passing on an empty plan.
    song = next(iter(catalog.values()))
    artist_id = song["spotify_track"]["artists"][0]["id"]

    ctx = build_content_context(
        feature_snapshot={
            "catalog": catalog,
            "preference": {
                "oshi_registered": True,
                "oshi_mode": "on",
                "oshi_artists": [{"artist_id": artist_id, "oshi_type": "artist", "enthusiasm": 0.6}],
            },
        }
    )
    plan = CompletePlan.model_validate(CS.evaluate(ctx))

    oshi_rows = [
        c
        for item in plan.ordered_items
        for c in item.feature_contributions
        if c.feature_id == "oshi_artists"
    ]
    assert oshi_rows, "no oshi row in the plan — the fixture stopped exercising this leaf"
    matched = [r for r in oshi_rows if r.matched_artist_ids]
    assert matched, "matched_artist_ids never survived to the frozen output model"
    assert matched[0].matched_artist_ids == [artist_id]
    # a_i carries the degree; the id list says WHICH oshi produced it.
    assert matched[0].a_i == pytest.approx(0.6)


# ---------------------------------------------------------------------------
# world_validation — unknown artist reported at the offending index
# ---------------------------------------------------------------------------


def test_unknown_artist_reported_at_offending_index():
    song_map = load_catalog("fixtures/catalog/worked-example.json")
    song = next(iter(song_map.values()))
    catalog = [Song.model_validate(song)]
    known_artist_id = song["spotify_track"]["artists"][0]["id"]

    world = _build_world(DriverProfile(**_valid_driver_profile(
        oshi_registered=True,
        oshi_mode=OshiMode.on,
        oshi_artists=[
            OshiArtist(artist_id=known_artist_id, enthusiasm=0.5),
            OshiArtist(artist_id="synthetic-artist-DOES-NOT-EXIST", enthusiasm=0.5),
        ],
    )))

    issues = validate_world(world, catalog)
    matches = [i for i in issues if i.path == "driver_profile.oshi_artists[1].artist_id"]
    assert len(matches) == 1
    assert matches[0].code == "unknown_catalog_reference"
    # The FIRST (valid) entry must NOT be reported.
    assert not any(i.path == "driver_profile.oshi_artists[0].artist_id" for i in issues)
