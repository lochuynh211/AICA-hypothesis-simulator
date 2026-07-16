"""Tests for the seed-promotion mapping (T014) — P3 Editable World (feature 014).

Loads ``scripts/promote_seeds.py`` by file path (it lives outside the
``aica_api`` package — this is a one-time authoring script, not runtime app
code) and exercises its generator-world -> ``SeedWorld`` mapping directly,
without touching the committed ``proposal_contracts/seeds/*.json`` files.

Asserts: running the promotion mapping on a real
``generation_workspace/worlds.json`` entry yields a valid, COMPLETE
``SeedWorld`` that round-trips (load -> model_dump -> re-load is identical),
and that the 5-seed build (``build_all_seeds``) produces exactly the 5
representative seeds named in milestones §5 with unique, stable ids.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from aica_api.config import settings
from aica_api.models.proposal.dispositions import CONTENT_FEATURE_DISPOSITIONS
from aica_api.models.proposal.enums import RestSpotType
from aica_api.models.proposal.world import SeedWorld, World

_REPO_ROOT = settings.proposal_contracts_dir.parent
_SCRIPT_PATH = _REPO_ROOT / "scripts" / "promote_seeds.py"

_EXPECTED_SEED_IDS = {
    "seed-night-highway-oshi",
    "seed-daytime-ordinary",
    "seed-characteristic-route-event",
    "seed-multiple-passengers-child",
    "seed-upcoming-oshi-live-event",
}


def _load_promote_seeds_module():
    spec = importlib.util.spec_from_file_location("promote_seeds", _SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def promote_seeds():
    return _load_promote_seeds_module()


@pytest.fixture(scope="module")
def generator_worlds(promote_seeds):
    return promote_seeds.load_generator_worlds()


@pytest.fixture(scope="module")
def catalog_ref(promote_seeds):
    return promote_seeds.load_catalog_ref()


@pytest.fixture(scope="module")
def matrix_version(promote_seeds):
    return promote_seeds.load_matrix_version()


# ---------------------------------------------------------------------------
# The script module itself
# ---------------------------------------------------------------------------


def test_generator_worlds_json_is_a_list_keyed_by_world_id(promote_seeds):
    raw = json.loads(promote_seeds.GENERATOR_WORLDS_PATH.read_text(encoding="utf-8"))
    assert isinstance(raw, list)
    assert len(raw) >= 5


def test_load_generator_worlds_returns_world_id_map(generator_worlds):
    assert "world-daytime-commute" in generator_worlds
    assert generator_worlds["world-daytime-commute"]["world_id"] == "world-daytime-commute"


def test_load_catalog_ref_matches_frozen_manifest(promote_seeds, catalog_ref):
    manifest_path = promote_seeds.DATASET_DIR / "dataset_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert catalog_ref.dataset_id == manifest["dataset_id"]
    assert catalog_ref.dataset_hash == manifest["dataset_hash"]


def test_load_matrix_version_non_empty(matrix_version):
    assert matrix_version


# ---------------------------------------------------------------------------
# Mapping a single generator-world entry yields a valid, complete SeedWorld
# ---------------------------------------------------------------------------


def test_build_seed_world_from_one_generator_entry_is_complete_and_valid(
    promote_seeds, generator_worlds, catalog_ref, matrix_version
):
    seed = promote_seeds.build_seed_world(
        generator_worlds,
        catalog_ref,
        matrix_version,
        seed_id="seed-test-mapping",
        label={"ja": "テスト", "en": "Test"},
        description={"ja": "テスト説明", "en": "Test description"},
        generator_world_id="world-daytime-commute",
        situation_kwargs=dict(rest_spot_type=RestSpotType.unknown),
    )

    assert isinstance(seed, SeedWorld)
    assert isinstance(seed.world, World)

    # Complete: every A.1/A.2 registry feature is present in the dump.
    situation_dump = seed.world.situation.model_dump(mode="json")
    profile_dump = seed.world.driver_profile.model_dump(
        mode="json",
        exclude={"genre_affinity_v1_enabled", "usage_by_genre", "scene_genre_usage"},
    )
    flat = {**situation_dump, **profile_dump}
    registry_feature_ids = [entry.feature_id for entry in CONTENT_FEATURE_DISPOSITIONS]
    missing = [fid for fid in registry_feature_ids if fid not in flat]
    assert not missing, f"A.1/A.2 fields missing: {missing}"

    # Round-trips.
    dumped = seed.model_dump(mode="json")
    reloaded = SeedWorld.model_validate(dumped)
    assert reloaded.model_dump(mode="json") == dumped

    # Values were actually mapped from the generator world, not left at some
    # unrelated default.
    assert seed.world.situation.night_state.value == "day"
    assert seed.world.situation.drowsiness_level == 20
    assert seed.world.driver_profile.oshi_id == "synthetic-artist-0001"


def test_build_seed_world_defaults_trigger_from_generator_world(
    promote_seeds, generator_worlds, catalog_ref, matrix_version
):
    gw = generator_worlds["world-daytime-commute"]
    seed = promote_seeds.build_seed_world(
        generator_worlds,
        catalog_ref,
        matrix_version,
        seed_id="seed-test-trigger-default",
        label={"ja": "テスト", "en": "Test"},
        description={"ja": "テスト説明", "en": "Test description"},
        generator_world_id="world-daytime-commute",
        situation_kwargs=dict(rest_spot_type=RestSpotType.unknown),
    )
    assert seed.world.control_inputs.trigger_purpose.value == gw["trigger"]["trigger_purpose"]
    assert seed.world.control_inputs.lifecycle_stage.value == gw["trigger"]["lifecycle_stage"]


def test_build_seed_world_trigger_override_applied(
    promote_seeds, generator_worlds, catalog_ref, matrix_version
):
    seed = promote_seeds.build_seed_world(
        generator_worlds,
        catalog_ref,
        matrix_version,
        seed_id="seed-test-trigger-override",
        label={"ja": "テスト", "en": "Test"},
        description={"ja": "テスト説明", "en": "Test description"},
        generator_world_id="world-night-highway-high-drowsiness",
        trigger_purpose="rest_recommended",
        lifecycle_stage="before_rest_until_stop",
        situation_kwargs=dict(rest_spot_type=RestSpotType.sa_pa, estimated_min_until_rest_spot=8),
    )
    assert seed.world.control_inputs.trigger_purpose.value == "rest_recommended"
    assert seed.world.control_inputs.lifecycle_stage.value == "before_rest_until_stop"


# ---------------------------------------------------------------------------
# The full 5-seed build (what main() commits)
# ---------------------------------------------------------------------------


def test_build_all_seeds_yields_exactly_the_5_representative_seeds(
    promote_seeds, generator_worlds, catalog_ref, matrix_version
):
    seeds = promote_seeds.build_all_seeds(generator_worlds, catalog_ref, matrix_version)
    assert len(seeds) == 5
    ids = {s.seed_id for s in seeds}
    assert ids == _EXPECTED_SEED_IDS


def test_build_all_seeds_are_all_complete_valid_and_round_trip(
    promote_seeds, generator_worlds, catalog_ref, matrix_version
):
    seeds = promote_seeds.build_all_seeds(generator_worlds, catalog_ref, matrix_version)
    registry_feature_ids = [entry.feature_id for entry in CONTENT_FEATURE_DISPOSITIONS]

    for seed in seeds:
        situation_dump = seed.world.situation.model_dump(mode="json")
        profile_dump = seed.world.driver_profile.model_dump(
            mode="json",
            exclude={"genre_affinity_v1_enabled", "usage_by_genre", "scene_genre_usage"},
        )
        flat = {**situation_dump, **profile_dump}
        missing = [fid for fid in registry_feature_ids if fid not in flat]
        assert not missing, f"{seed.seed_id}: A.1/A.2 fields missing: {missing}"

        dumped = seed.model_dump(mode="json")
        reloaded = SeedWorld.model_validate(dumped)
        assert reloaded.model_dump(mode="json") == dumped


def test_build_all_seeds_is_deterministic(promote_seeds, generator_worlds, catalog_ref, matrix_version):
    first = promote_seeds.build_all_seeds(generator_worlds, catalog_ref, matrix_version)
    second = promote_seeds.build_all_seeds(generator_worlds, catalog_ref, matrix_version)
    assert [s.model_dump(mode="json") for s in first] == [s.model_dump(mode="json") for s in second]


# ---------------------------------------------------------------------------
# Committed seed files on disk were produced by this exact mapping
# ---------------------------------------------------------------------------


def test_committed_seed_files_match_current_promotion_output(
    promote_seeds, generator_worlds, catalog_ref, matrix_version
):
    """Regenerating from the same (committed) generator input must reproduce
    byte-identical committed seed JSON — guards against the committed seeds
    drifting from what the script actually produces."""
    seeds_dir: Path = settings.proposal_contracts_dir / "seeds"
    seeds = promote_seeds.build_all_seeds(generator_worlds, catalog_ref, matrix_version)

    for seed in seeds:
        on_disk_path = seeds_dir / f"{seed.seed_id}.json"
        assert on_disk_path.exists(), f"missing committed seed file for {seed.seed_id}"
        on_disk = json.loads(on_disk_path.read_text(encoding="utf-8"))
        assert seed.model_dump(mode="json") == on_disk
