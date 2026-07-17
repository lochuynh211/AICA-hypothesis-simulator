"""TDD (T004): pure ``apply_overrides`` helper, extracted from
``WorldCloneStore.create_clone`` (research.md D2).

Covers:
  - an EMPTY override list returns the base world unchanged with an empty
    diff (unlike ``create_clone``, which still requires >=1 override);
  - one valid ``situation.drowsiness_level`` override returns a new
    ``World`` + exactly one ``FieldDiff``;
  - an unknown/malformed override path, an out-of-range value, and a
    dangling catalog reference each raise ``InvalidOverrideError`` with
    ``.issues``.
"""
from __future__ import annotations

import json

import pytest

from aica_api.config import settings
from aica_api.models.proposal.song_schema import Song
from aica_api.models.proposal.world import FieldDiff, FieldOverride, World
from aica_api.services.world_clone_store import InvalidOverrideError, apply_overrides
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


# ---------------------------------------------------------------------------
# Empty override list -> base world unchanged, empty diff
# ---------------------------------------------------------------------------


def test_empty_overrides_returns_base_world_unchanged(base_world: World, catalog: list[Song]):
    world, diffs = apply_overrides(base_world, [], catalog=catalog)
    assert diffs == []
    assert world.model_dump(mode="json") == base_world.model_dump(mode="json")


def test_empty_overrides_without_catalog_returns_base_world_unchanged(base_world: World):
    world, diffs = apply_overrides(base_world, [])
    assert diffs == []
    assert world.model_dump(mode="json") == base_world.model_dump(mode="json")


# ---------------------------------------------------------------------------
# One valid override -> new World + one FieldDiff
# ---------------------------------------------------------------------------


def test_one_valid_override_returns_new_world_and_one_diff(base_world: World, catalog: list[Song]):
    world, diffs = apply_overrides(
        base_world,
        [FieldOverride(path="situation.drowsiness_level", value=10)],
        catalog=catalog,
    )
    assert isinstance(world, World)
    assert world.situation.drowsiness_level == 10
    assert len(diffs) == 1
    assert isinstance(diffs[0], FieldDiff)
    assert diffs[0].path == "situation.drowsiness_level"
    assert diffs[0].before == base_world.situation.drowsiness_level
    assert diffs[0].after == 10
    # The base world itself is untouched.
    assert base_world.situation.drowsiness_level != 10


def test_one_valid_override_accepts_dict_shape(base_world: World, catalog: list[Song]):
    world, diffs = apply_overrides(
        base_world,
        [{"path": "situation.fatigue_level", "value": 20}],
        catalog=catalog,
    )
    assert world.situation.fatigue_level == 20
    assert len(diffs) == 1


# ---------------------------------------------------------------------------
# Invalid overrides -> InvalidOverrideError with .issues
# ---------------------------------------------------------------------------


def test_unknown_path_raises_invalid_override_error(base_world: World):
    with pytest.raises(InvalidOverrideError) as exc_info:
        apply_overrides(base_world, [FieldOverride(path="situation.no_such_field", value=1)])
    assert exc_info.value.issues


def test_out_of_range_value_raises_invalid_override_error(base_world: World):
    with pytest.raises(InvalidOverrideError) as exc_info:
        apply_overrides(base_world, [FieldOverride(path="situation.drowsiness_level", value=999)])
    assert any("drowsiness_level" in issue.path for issue in exc_info.value.issues)


def test_dangling_catalog_reference_raises_when_catalog_supplied(base_world: World, catalog: list[Song]):
    with pytest.raises(InvalidOverrideError) as exc_info:
        apply_overrides(
            base_world,
            [FieldOverride(path="driver_profile.oshi_id", value="synthetic-artist-DOES-NOT-EXIST")],
            catalog=catalog,
        )
    assert any(issue.code == "unknown_catalog_reference" for issue in exc_info.value.issues)


def test_dangling_catalog_reference_raises_when_no_catalog_supplied(base_world: World):
    """Mirrors WorldCloneStore's FIX-5 behavior: a world that (after the
    override) HAS catalog references but no catalog was supplied is a
    validation error, never a silent skip."""
    with pytest.raises(InvalidOverrideError) as exc_info:
        apply_overrides(
            base_world,
            [FieldOverride(path="driver_profile.oshi_id", value="synthetic-artist-DOES-NOT-EXIST")],
        )
    assert any(issue.code == "unresolvable_catalog" for issue in exc_info.value.issues)
