"""TDD: world_validation service — T017/T018 — P3 Editable World (feature 014).

Covers data-model.md "Validation rules" 1-3 (enum/range, purpose/stage
compatibility, catalog reference existence) via
``aica_api.services.world_validation.validate_world(world, catalog)``:

  - a valid world (loaded from a committed seed via ``WorldSeedStore``, with
    the frozen catalog from ``DatasetCatalogRegistry``) yields no issues;
  - an out-of-range numeric field, an invalid enum member, an incompatible
    (trigger_purpose, lifecycle_stage) pair, and each kind of unknown
    catalog reference (``oshi_artists[*].artist_id``, a played-item track id,
    a ``catalog_item_usage_level`` key) each produce a field-level
    ``{path, code, message}`` issue naming the offending field.

Mutating a field directly on an already-validated ``World`` (bypassing
Pydantic's constructor-time validators, since these models do not set
``validate_assignment``) is how these tests manufacture an "invalid but
in-memory" World — exactly the scenario ``validate_world`` exists to catch.
"""
from __future__ import annotations

import pytest

from aica_api.config import settings
from aica_api.models.proposal.enums import TriggerPurpose, UsageLevel
from aica_api.models.proposal.song_schema import Song
from aica_api.models.proposal.world import PlayedItem, World
from aica_api.services.dataset_catalog_registry import DatasetCatalogRegistry
from aica_api.services.world_seed_store import WorldSeedStore
from aica_api.services.world_validation import ValidationIssue, validate_world

_DATASET_ID = "soundcharts-grounded-spotify-compatible-demonstration-seed-1042"
_SEED_ID = "seed-night-highway-oshi"


@pytest.fixture(scope="module")
def catalog() -> list[Song]:
    registry = DatasetCatalogRegistry(settings.proposal_dataset_dir)
    songs = registry.get_catalog(_DATASET_ID)
    assert songs is not None
    return songs


@pytest.fixture()
def world() -> World:
    """A fresh, independent, valid World copy for each test to freely mutate."""
    store = WorldSeedStore(settings.proposal_contracts_dir / "seeds")
    seed = store.get_seed(_SEED_ID)
    assert seed is not None
    return World.model_validate(seed.world.model_dump(mode="json"))


# ---------------------------------------------------------------------------
# A valid world yields no issues
# ---------------------------------------------------------------------------


def test_valid_world_yields_no_issues(world: World, catalog: list[Song]):
    assert validate_world(world, catalog) == []


def test_returns_validation_issue_instances(world: World, catalog: list[Song]):
    world.situation.drowsiness_level = 150
    issues = validate_world(world, catalog)
    assert issues
    assert all(isinstance(issue, ValidationIssue) for issue in issues)
    assert all(issue.path and issue.code and issue.message for issue in issues)


# ---------------------------------------------------------------------------
# Rule 1 — enum / range violations
# ---------------------------------------------------------------------------


def test_out_of_range_int_produces_field_level_issue(world: World, catalog: list[Song]):
    world.situation.drowsiness_level = 150  # out of [0, 100]
    issues = validate_world(world, catalog)
    assert any(issue.path == "situation.drowsiness_level" for issue in issues)


def test_invalid_enum_member_produces_field_level_issue(world: World, catalog: list[Song]):
    world.situation.traffic_state = "bogus-state"  # not a TrafficState member
    issues = validate_world(world, catalog)
    assert any(issue.path == "situation.traffic_state" for issue in issues)


# ---------------------------------------------------------------------------
# Rule 2 — purpose/stage compatibility
# ---------------------------------------------------------------------------


def test_incompatible_purpose_stage_produces_field_level_issue(world: World, catalog: list[Song]):
    # Seed's lifecycle_stage ("before_rest_until_stop") is rest-only; pairing
    # it with a non-rest purpose is incompatible (shared rule in ControlInputs).
    world.control_inputs.trigger_purpose = TriggerPurpose.route_music
    issues = validate_world(world, catalog)
    assert any(issue.path == "control_inputs" for issue in issues)
    assert any("route_music" in issue.message for issue in issues)


# ---------------------------------------------------------------------------
# Rule 3 — catalog reference existence
# ---------------------------------------------------------------------------


def test_unknown_oshi_id_produces_field_level_issue(world: World, catalog: list[Song]):
    # The seed's own oshi_artists[0] already resolves (see
    # test_seed_store.py::test_seed_catalog_references_resolve) — mutate its
    # artist_id in place to a dangling id.
    world.driver_profile.oshi_artists[0].artist_id = "synthetic-artist-DOES-NOT-EXIST"
    issues = validate_world(world, catalog)
    matches = [issue for issue in issues if issue.path == "driver_profile.oshi_artists[0].artist_id"]
    assert len(matches) == 1
    assert matches[0].code == "unknown_catalog_reference"
    # The offending id is NOT spliced into the message — an identifier is not
    # something a reviewer can act on, and `path` already pins the field.
    assert "synthetic-artist-DOES-NOT-EXIST" not in matches[0].message
    assert "推しアーティスト" in matches[0].message


def test_unknown_played_item_track_id_produces_field_level_issue(world: World, catalog: list[Song]):
    world.driver_profile.played_items = [
        PlayedItem(track_id="synthetic-track-DOES-NOT-EXIST", last_played_at="2026-07-16T10:00:00Z")
    ]
    issues = validate_world(world, catalog)
    matches = [issue for issue in issues if issue.path == "driver_profile.played_items[0].track_id"]
    assert len(matches) == 1
    assert matches[0].code == "unknown_catalog_reference"
    assert "synthetic-track-DOES-NOT-EXIST" not in matches[0].message
    assert "楽曲" in matches[0].message


def test_unknown_catalog_item_usage_level_key_produces_field_level_issue(
    world: World, catalog: list[Song]
):
    world.driver_profile.catalog_item_usage_level = {"synthetic-track-NOPE": UsageLevel.high}
    issues = validate_world(world, catalog)
    matches = [
        issue
        for issue in issues
        if issue.path.startswith("driver_profile.catalog_item_usage_level")
    ]
    assert len(matches) == 1
    assert matches[0].code == "unknown_catalog_reference"
    assert "synthetic-track-NOPE" not in matches[0].message
    assert "楽曲" in matches[0].message


def test_known_references_do_not_produce_issues(world: World, catalog: list[Song]):
    # The seed's own oshi_artists/played_items already resolve against the
    # catalog (see test_seed_store.py::test_seed_catalog_references_resolve)
    # — this is the negative-control complement of the "unknown reference"
    # tests above, on the very same fields.
    issues = validate_world(world, catalog)
    assert not any(issue.code == "unknown_catalog_reference" for issue in issues)


def test_multiple_violations_all_reported(world: World, catalog: list[Song]):
    world.situation.drowsiness_level = 999
    world.driver_profile.oshi_artists[0].artist_id = "synthetic-artist-DOES-NOT-EXIST"
    issues = validate_world(world, catalog)
    paths = {issue.path for issue in issues}
    assert "situation.drowsiness_level" in paths
    assert "driver_profile.oshi_artists[0].artist_id" in paths
