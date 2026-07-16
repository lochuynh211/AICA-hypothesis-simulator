"""Tests for the committed base-seed store (T012) — P3 Editable World (feature 014).

Covers (data-model.md §SeedWorld, research.md §R5):
  - the 5 representative base seeds (milestones §5) load from
    ``proposal_contracts/seeds/`` with no errors;
  - each seed is a COMPLETE, valid ``World`` — every A.1/A.2 field
    (``CONTENT_FEATURE_DISPOSITIONS``) is present in the dumped
    situation/driver_profile, adapting the completeness assertion from
    ``test_world_model.py``;
  - round-trip (load -> model_dump -> re-load) is byte-for-byte identical;
  - every catalog reference a seed carries (``oshi_id``, ``played_items``
    track ids, the content-rate/confidence map keys) resolves against the
    frozen catalog (``proposal_contracts/dataset/<id>/catalog.json``).
"""
from __future__ import annotations

import json

import pytest

from aica_api.config import settings
from aica_api.models.proposal.dispositions import CONTENT_FEATURE_DISPOSITIONS
from aica_api.models.proposal.world import DriverProfile, SeedWorld, Situation, World
from aica_api.services.world_seed_store import WorldSeedStore

_SEEDS_DIR = settings.proposal_contracts_dir / "seeds"
_DATASET_ID = "soundcharts-grounded-spotify-compatible-demonstration-seed-1042"
_DATASET_DIR = settings.proposal_dataset_dir / _DATASET_ID

_EXPECTED_SEED_IDS = {
    "seed-night-highway-oshi",
    "seed-daytime-ordinary",
    "seed-characteristic-route-event",
    "seed-multiple-passengers-child",
    "seed-upcoming-oshi-live-event",
}


@pytest.fixture()
def store() -> WorldSeedStore:
    return WorldSeedStore(_SEEDS_DIR)


@pytest.fixture(scope="module")
def catalog_track_ids() -> set[str]:
    catalog = json.loads((_DATASET_DIR / "catalog.json").read_text(encoding="utf-8"))
    return {song["spotify_track"]["id"] for song in catalog}


@pytest.fixture(scope="module")
def catalog_artist_ids() -> set[str]:
    catalog = json.loads((_DATASET_DIR / "catalog.json").read_text(encoding="utf-8"))
    ids: set[str] = set()
    for song in catalog:
        for artist in song["spotify_track"]["album"]["artists"]:
            ids.add(artist["id"])
    return ids


# ---------------------------------------------------------------------------
# The 5 seeds load with no errors
# ---------------------------------------------------------------------------


def test_no_errors_loading_committed_seeds(store: WorldSeedStore):
    assert store.list_errors() == []


def test_exactly_the_5_representative_seeds_are_present(store: WorldSeedStore):
    summaries = store.list_seeds()
    ids = {s["seed_id"] for s in summaries}
    assert ids == _EXPECTED_SEED_IDS
    assert len(summaries) == 5


def test_list_seeds_summary_shape(store: WorldSeedStore):
    for summary in store.list_seeds():
        assert set(summary.keys()) == {"seed_id", "label", "description"}
        assert set(summary["label"].keys()) == {"ja", "en"}
        assert set(summary["description"].keys()) == {"ja", "en"}
        assert summary["label"]["ja"] and summary["label"]["en"]
        assert summary["description"]["ja"] and summary["description"]["en"]


def test_get_seed_returns_full_seed_world(store: WorldSeedStore):
    for seed_id in _EXPECTED_SEED_IDS:
        seed = store.get_seed(seed_id)
        assert isinstance(seed, SeedWorld)
        assert seed.seed_id == seed_id
        assert isinstance(seed.world, World)


def test_unknown_seed_id_returns_none(store: WorldSeedStore):
    assert store.get_seed("no-such-seed") is None


# ---------------------------------------------------------------------------
# Each seed is a COMPLETE, valid World
# ---------------------------------------------------------------------------


def _assert_world_complete(world: World) -> None:
    """Adapted from test_world_model.py's TestFieldCompleteness: every A.1/A.2
    registry feature is present (with a value) in the dumped situation +
    driver_profile."""
    situation_dump = world.situation.model_dump(mode="json")
    profile_dump = world.driver_profile.model_dump(
        mode="json",
        exclude={"genre_affinity_v1_enabled", "usage_by_genre", "scene_genre_usage"},
    )
    flat = {**situation_dump, **profile_dump}

    registry_feature_ids = [entry.feature_id for entry in CONTENT_FEATURE_DISPOSITIONS]
    missing = [fid for fid in registry_feature_ids if fid not in flat]
    assert not missing, f"A.1/A.2 fields missing from the dumped world: {missing}"


@pytest.mark.parametrize("seed_id", sorted(_EXPECTED_SEED_IDS))
def test_each_seed_world_is_complete_and_valid(store: WorldSeedStore, seed_id: str):
    seed = store.get_seed(seed_id)
    assert seed is not None

    # Re-validating via the model constructor must not raise (already proven
    # by successful load, but explicit here per T012).
    revalidated = World.model_validate(seed.world.model_dump(mode="json"))
    assert isinstance(revalidated, World)

    _assert_world_complete(seed.world)


# ---------------------------------------------------------------------------
# Round-trip: load -> model_dump -> re-load is identical
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("seed_id", sorted(_EXPECTED_SEED_IDS))
def test_seed_round_trip_is_identical(store: WorldSeedStore, seed_id: str):
    seed = store.get_seed(seed_id)
    dumped = seed.model_dump(mode="json")
    reloaded = SeedWorld.model_validate(dumped)
    assert reloaded.model_dump(mode="json") == dumped


def test_seed_files_round_trip_against_disk(store: WorldSeedStore):
    for path in sorted(_SEEDS_DIR.glob("*.json")):
        on_disk = json.loads(path.read_text(encoding="utf-8"))
        seed = SeedWorld.model_validate(on_disk)
        assert seed.model_dump(mode="json") == on_disk


# ---------------------------------------------------------------------------
# Catalog references resolve against the frozen catalog
# ---------------------------------------------------------------------------


def _referenced_track_ids(profile: DriverProfile) -> set[str]:
    ids: set[str] = set()
    ids.update(item.track_id for item in profile.played_items)
    ids.update(item.track_id for item in profile.skipped_items)
    ids.update(item.track_id for item in profile.changed_from_items)
    ids.update(item.track_id for item in profile.completed_items)
    ids.update(item.track_id for item in profile.manually_selected_items)
    ids.update(item.track_id for item in profile.repeated_items)
    ids.update(profile.catalog_item_usage_level.keys())
    ids.update(profile.catalog_item_recency_state.keys())
    ids.update(profile.content_proposal_acceptance_rate.keys())
    ids.update(profile.content_recovery_rate.keys())
    ids.update(profile.content_proposal_acceptance_confidence.keys())
    ids.update(profile.content_recovery_confidence.keys())
    return ids


@pytest.mark.parametrize("seed_id", sorted(_EXPECTED_SEED_IDS))
def test_seed_catalog_references_resolve(
    store: WorldSeedStore,
    seed_id: str,
    catalog_track_ids: set[str],
    catalog_artist_ids: set[str],
):
    seed = store.get_seed(seed_id)
    profile = seed.world.driver_profile

    track_refs = _referenced_track_ids(profile)
    dangling_tracks = track_refs - catalog_track_ids
    assert not dangling_tracks, f"{seed_id}: unknown track ids referenced: {dangling_tracks}"

    if profile.oshi_id is not None:
        assert profile.oshi_id in catalog_artist_ids, (
            f"{seed_id}: oshi_id {profile.oshi_id!r} not in the frozen catalog's artist ids"
        )


def test_seed_catalog_ref_matches_frozen_dataset(store: WorldSeedStore):
    manifest = json.loads((_DATASET_DIR / "dataset_manifest.json").read_text(encoding="utf-8"))
    for seed_id in _EXPECTED_SEED_IDS:
        seed = store.get_seed(seed_id)
        assert seed.world.catalog_ref.dataset_id == manifest["dataset_id"]
        assert seed.world.catalog_ref.dataset_hash == manifest["dataset_hash"]
        assert seed.world.control_inputs.dataset_id == manifest["dataset_id"]


# ---------------------------------------------------------------------------
# Read-only / error-quarantine behaviour (mirrors DatasetCatalogRegistry)
# ---------------------------------------------------------------------------


def test_invalid_seed_file_is_quarantined(tmp_path):
    (tmp_path / "broken.json").write_text(json.dumps({"seed_id": "x"}), encoding="utf-8")
    bad_store = WorldSeedStore(tmp_path)
    assert bad_store.list_seeds() == []
    errors = bad_store.list_errors()
    assert len(errors) == 1
    assert errors[0]["file"] == "broken.json"
    assert "message" in errors[0]


def test_nonexistent_seeds_dir_yields_empty_store(tmp_path):
    empty_store = WorldSeedStore(tmp_path / "does-not-exist")
    assert empty_store.list_seeds() == []
    assert empty_store.list_errors() == []


def test_frozen_seed_files_byte_unchanged_after_load():
    before = {p.name: p.read_bytes() for p in sorted(_SEEDS_DIR.glob("*.json"))}
    WorldSeedStore(_SEEDS_DIR)
    after = {p.name: p.read_bytes() for p in sorted(_SEEDS_DIR.glob("*.json"))}
    assert before == after
