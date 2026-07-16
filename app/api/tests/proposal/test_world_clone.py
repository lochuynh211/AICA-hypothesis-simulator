"""Tests for the world-clone store (T028) — P3 Editable World, Driver Profiles &
Contrast (feature 014).

Covers (data-model.md §WorldClone, research.md §R5, contracts/proposal-p3-api.md
"Worlds: clone & validate"):
  - cloning with one override yields a COMPLETE, valid ``World``;
  - ``diff`` lists EXACTLY the overridden path(s) with before/after — nothing
    unchanged ever appears in it;
  - deterministic on repeat: cloning the same base+override twice yields an
    identical ``world``/``diff`` (clone_id itself is random and excluded from
    the comparison);
  - an invalid override path / value / catalog reference raises
    ``InvalidOverrideError`` (the router maps this to 422);
  - the milestone §5 one-variable presets each produce the expected
    single-field diff;
  - list/get/delete round-trip.
"""
from __future__ import annotations

import json

import pytest

from aica_api.config import settings
from aica_api.models.proposal.song_schema import Song
from aica_api.models.proposal.world import FieldOverride, World, WorldClone
from aica_api.services.world_clone_store import InvalidOverrideError, WorldCloneStore
from aica_api.services.world_seed_store import WorldSeedStore

_SEEDS_DIR = settings.proposal_contracts_dir / "seeds"
_DATASET_ID = "soundcharts-grounded-spotify-compatible-demonstration-seed-1042"
_DATASET_DIR = settings.proposal_dataset_dir / _DATASET_ID
_BASE_SEED_ID = "seed-night-highway-oshi"


@pytest.fixture(scope="module")
def base_world() -> World:
    seed = WorldSeedStore(_SEEDS_DIR).get_seed(_BASE_SEED_ID)
    assert seed is not None
    return seed.world


@pytest.fixture(scope="module")
def catalog() -> list[Song]:
    raw = json.loads((_DATASET_DIR / "catalog.json").read_text(encoding="utf-8"))
    return [Song.model_validate(entry) for entry in raw]


@pytest.fixture()
def store(tmp_path) -> WorldCloneStore:
    return WorldCloneStore(tmp_path)


# ---------------------------------------------------------------------------
# One override -> complete valid world + exact diff
# ---------------------------------------------------------------------------


def test_clone_with_one_override_yields_complete_valid_world(
    store: WorldCloneStore, base_world: World, catalog: list[Song]
):
    clone = store.create_clone(
        base_world=base_world,
        base_seed_id=_BASE_SEED_ID,
        overrides=[FieldOverride(path="situation.drowsiness_level", value=10)],
        catalog=catalog,
    )
    assert isinstance(clone, WorldClone)
    assert clone.base_seed_id == _BASE_SEED_ID
    # Re-validating via the model constructor must not raise -> complete/valid.
    revalidated = World.model_validate(clone.world.model_dump(mode="json"))
    assert isinstance(revalidated, World)
    assert clone.world.situation.drowsiness_level == 10


def test_clone_diff_lists_exactly_the_overridden_path_and_nothing_else(
    store: WorldCloneStore, base_world: World, catalog: list[Song]
):
    clone = store.create_clone(
        base_world=base_world,
        base_seed_id=_BASE_SEED_ID,
        overrides=[FieldOverride(path="situation.drowsiness_level", value=10)],
        catalog=catalog,
    )
    assert len(clone.diff) == 1
    entry = clone.diff[0]
    assert entry.path == "situation.drowsiness_level"
    assert entry.before == base_world.situation.drowsiness_level
    assert entry.after == 10
    assert entry.before != entry.after

    # Every other field of the world is untouched.
    base_dump = base_world.model_dump(mode="json")
    clone_dump = clone.world.model_dump(mode="json")
    clone_dump["situation"]["drowsiness_level"] = base_dump["situation"]["drowsiness_level"]
    assert clone_dump == base_dump


def test_clone_with_two_overrides_diff_lists_exactly_those_two(
    store: WorldCloneStore, base_world: World, catalog: list[Song]
):
    clone = store.create_clone(
        base_world=base_world,
        base_seed_id=_BASE_SEED_ID,
        overrides=[
            FieldOverride(path="situation.drowsiness_level", value=5),
            FieldOverride(path="driver_profile.oshi_mode", value="off"),
        ],
        catalog=catalog,
    )
    paths = {d.path for d in clone.diff}
    assert paths == {"situation.drowsiness_level", "driver_profile.oshi_mode"}


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


def test_clone_is_deterministic_on_repeat(store: WorldCloneStore, base_world: World, catalog: list[Song]):
    overrides = [FieldOverride(path="situation.fatigue_level", value=15)]
    first = store.create_clone(base_world=base_world, base_seed_id=_BASE_SEED_ID, overrides=overrides, catalog=catalog)
    second = store.create_clone(base_world=base_world, base_seed_id=_BASE_SEED_ID, overrides=overrides, catalog=catalog)

    assert first.clone_id != second.clone_id  # each clone gets its own id
    assert first.world.model_dump(mode="json") == second.world.model_dump(mode="json")
    assert [d.model_dump(mode="json") for d in first.diff] == [d.model_dump(mode="json") for d in second.diff]


# ---------------------------------------------------------------------------
# Invalid override -> InvalidOverrideError
# ---------------------------------------------------------------------------


def test_clone_unknown_override_path_raises(store: WorldCloneStore, base_world: World):
    with pytest.raises(InvalidOverrideError) as exc_info:
        store.create_clone(
            base_world=base_world,
            base_seed_id=_BASE_SEED_ID,
            overrides=[FieldOverride(path="situation.no_such_field", value=1)],
        )
    assert exc_info.value.issues


def test_clone_unknown_group_path_raises(store: WorldCloneStore, base_world: World):
    with pytest.raises(InvalidOverrideError):
        store.create_clone(
            base_world=base_world,
            base_seed_id=_BASE_SEED_ID,
            overrides=[FieldOverride(path="no_such_group.field", value=1)],
        )


def test_clone_invalid_value_raises_structural_error(store: WorldCloneStore, base_world: World):
    with pytest.raises(InvalidOverrideError) as exc_info:
        store.create_clone(
            base_world=base_world,
            base_seed_id=_BASE_SEED_ID,
            overrides=[FieldOverride(path="situation.drowsiness_level", value=999)],
        )
    assert any("drowsiness_level" in issue.path for issue in exc_info.value.issues)


def test_clone_invalid_enum_value_raises(store: WorldCloneStore, base_world: World):
    with pytest.raises(InvalidOverrideError):
        store.create_clone(
            base_world=base_world,
            base_seed_id=_BASE_SEED_ID,
            overrides=[FieldOverride(path="driver_profile.oshi_mode", value="not-a-real-mode")],
        )


def test_clone_dangling_catalog_reference_raises_when_catalog_supplied(
    store: WorldCloneStore, base_world: World, catalog: list[Song]
):
    with pytest.raises(InvalidOverrideError) as exc_info:
        store.create_clone(
            base_world=base_world,
            base_seed_id=_BASE_SEED_ID,
            overrides=[FieldOverride(path="driver_profile.oshi_id", value="synthetic-artist-DOES-NOT-EXIST")],
            catalog=catalog,
        )
    assert any(issue.code == "unknown_catalog_reference" for issue in exc_info.value.issues)


def test_clone_unresolvable_catalog_raises_when_world_has_catalog_references(
    store: WorldCloneStore, base_world: World
):
    """Whole-branch review FIX 5: an unresolvable/None catalog for a world
    that HAS catalog references (here: the overridden ``oshi_id`` itself) is
    now a validation error — never silently skipped. (Previously this exact
    call succeeded with a dangling reference left unchecked — that
    contradictory behaviour is precisely what FIX 5 closes; the router always
    supplies the resolved catalog for the one frozen dataset in production,
    so this only fires for a genuinely unresolvable/quarantined dataset.)
    """
    with pytest.raises(InvalidOverrideError) as exc_info:
        store.create_clone(
            base_world=base_world,
            base_seed_id=_BASE_SEED_ID,
            overrides=[FieldOverride(path="driver_profile.oshi_id", value="synthetic-artist-DOES-NOT-EXIST")],
        )
    assert any(issue.code == "unresolvable_catalog" for issue in exc_info.value.issues)


def test_clone_unresolvable_catalog_not_raised_when_world_has_no_catalog_references(store: WorldCloneStore):
    """A world with NO catalog references at all (oshi off, no history) is
    safe to clone without a catalog — nothing would need to be checked."""
    from aica_api.models.proposal.world import ControlInputs, DriverProfile, Situation
    from aica_api.models.proposal.dataset import CatalogRef, DatasetVersion

    bare_world = World(
        control_inputs=ControlInputs(
            trigger_purpose="rest_recommended",
            lifecycle_stage="before_rest_until_stop",
            motion_state="driving",
            matrix_version="v1",
            dataset_id="soundcharts-grounded-spotify-compatible-demonstration-seed-1042",
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
            dataset_id="soundcharts-grounded-spotify-compatible-demonstration-seed-1042",
            dataset_version=DatasetVersion(
                schema_version="1.0.0",
                spotify_track_reference_version="1.0.0",
                spotify_audio_features_reference_version="1.0.0",
            ),
            dataset_hash="sha256:83d8079c7a81bc6afbd01cdba65fe2330de66b900a113723814fa938fce516cd",
        ),
    )

    clone = store.create_clone(
        base_world=bare_world,
        base_seed_id=_BASE_SEED_ID,
        overrides=[FieldOverride(path="situation.drowsiness_level", value=10)],
    )
    assert clone.world.situation.drowsiness_level == 10


def test_clone_requires_at_least_one_override(store: WorldCloneStore, base_world: World):
    with pytest.raises(InvalidOverrideError):
        store.create_clone(base_world=base_world, base_seed_id=_BASE_SEED_ID, overrides=[])


# ---------------------------------------------------------------------------
# Milestone §5 one-variable presets
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path,value",
    [
        ("control_inputs.motion_state", "stopped"),
        ("situation.motion_state", "stopped"),
        ("situation.drowsiness_level", 5),
        ("situation.drowsiness_level", 95),
        ("situation.fatigue_level", 5),
        ("situation.fatigue_level", 95),
        ("situation.estimated_min_until_rest_spot", 45),
        ("driver_profile.oshi_mode", "off"),
        ("driver_profile.genre_affinity_v1_enabled", True),
    ],
)
def test_preset_one_variable_change_yields_single_field_diff(
    store: WorldCloneStore, base_world: World, catalog: list[Song], path: str, value
):
    clone = store.create_clone(
        base_world=base_world,
        base_seed_id=_BASE_SEED_ID,
        overrides=[FieldOverride(path=path, value=value)],
        catalog=catalog,
    )
    assert len(clone.diff) == 1
    assert clone.diff[0].path == path
    assert clone.diff[0].after == value


def test_preset_recent_service_rejection_vs_none(store: WorldCloneStore, base_world: World, catalog: list[Song]):
    clone = store.create_clone(
        base_world=base_world,
        base_seed_id=_BASE_SEED_ID,
        overrides=[
            FieldOverride(
                path="situation.recent_service_rejections",
                value=[{"service_id": "music_playlist", "rejected_at": "2026-07-16T09:00:00Z"}],
            )
        ],
        catalog=catalog,
    )
    assert len(clone.diff) == 1
    assert clone.diff[0].path == "situation.recent_service_rejections"
    assert clone.diff[0].before == []
    assert clone.diff[0].after == [{"service_id": "music_playlist", "rejected_at": "2026-07-16T09:00:00Z"}]


def test_preset_acceptance_confidence_change(store: WorldCloneStore, base_world: World, catalog: list[Song]):
    clone = store.create_clone(
        base_world=base_world,
        base_seed_id=_BASE_SEED_ID,
        overrides=[
            FieldOverride(
                path="driver_profile.content_proposal_acceptance_confidence",
                value={"synthetic-track-0001": 0.1},
            )
        ],
        catalog=catalog,
    )
    assert len(clone.diff) == 1
    assert clone.diff[0].path == "driver_profile.content_proposal_acceptance_confidence"
    assert clone.diff[0].after == {"synthetic-track-0001": 0.1}


# ---------------------------------------------------------------------------
# list/get/delete round-trip
# ---------------------------------------------------------------------------


def test_list_get_delete_round_trip(store: WorldCloneStore, base_world: World, catalog: list[Song]):
    clone = store.create_clone(
        base_world=base_world,
        base_seed_id=_BASE_SEED_ID,
        overrides=[FieldOverride(path="situation.drowsiness_level", value=42)],
        catalog=catalog,
    )

    summaries = store.list_clones()
    assert any(s["clone_id"] == clone.clone_id and s["base_seed_id"] == _BASE_SEED_ID for s in summaries)

    fetched = store.get_clone(clone.clone_id)
    assert fetched is not None
    assert fetched.model_dump(mode="json") == clone.model_dump(mode="json")

    assert store.delete_clone(clone.clone_id) is True
    assert store.get_clone(clone.clone_id) is None
    assert store.delete_clone(clone.clone_id) is False


def test_get_unknown_clone_returns_none(store: WorldCloneStore):
    assert store.get_clone("no-such-clone") is None


def test_persisted_clone_visible_from_a_new_store_instance(tmp_path, base_world: World, catalog: list[Song]):
    store_a = WorldCloneStore(tmp_path)
    clone = store_a.create_clone(
        base_world=base_world,
        base_seed_id=_BASE_SEED_ID,
        overrides=[FieldOverride(path="situation.drowsiness_level", value=33)],
        catalog=catalog,
    )

    store_b = WorldCloneStore(tmp_path)
    reloaded = store_b.get_clone(clone.clone_id)
    assert reloaded is not None
    assert reloaded.clone_id == clone.clone_id
