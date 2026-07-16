"""T029 [US1] — deterministic transform reproducibility (SC-001).

The same accumulated raw cache + seed → **byte-identical** catalog + manifest + hash
across two runs, with no network and no agent.
"""
from __future__ import annotations

import json

from mdg.transform import run_transform


def _run(cache_dir):
    return run_transform(
        cache_dir,
        seed=42,
        tier="demonstration",
        candidate_source="isrc_resolved",
        generated_at="2026-07-16T00:00:00Z",
    )


def test_transform_byte_identical_across_runs(fixtures_dir) -> None:
    cache = fixtures_dir / "cache"
    a = _run(cache)
    b = _run(cache)
    assert json.dumps(a.catalog, sort_keys=True) == json.dumps(b.catalog, sort_keys=True)
    assert a.manifest == b.manifest
    assert a.manifest["dataset_hash"] == b.manifest["dataset_hash"]


def test_transform_produces_valid_songs(fixtures_dir) -> None:
    from aica_api.models.proposal.song_schema import Song

    result = _run(fixtures_dir / "cache")
    assert result.catalog  # non-empty
    for song in result.catalog:
        Song.model_validate(song)


def test_transform_catalog_matches_accepted_count(fixtures_dir) -> None:
    result = _run(fixtures_dir / "cache")
    n_cache = len(list((fixtures_dir / "cache").glob("*.json")))
    assert len(result.catalog) == n_cache  # no dup ISRCs in the fixture cache


def test_irreparable_record_dropped_not_fatal(fixtures_dir, tmp_path) -> None:
    # A single real record that can't map to a valid Song (Soundcharts time_signature=1,
    # outside the schema's 3..7) must be dropped and logged, NOT halt the whole freeze.
    import shutil

    cache = tmp_path / "cache"
    cache.mkdir()
    goods = list((fixtures_dir / "cache").glob("*.json"))[:3]
    for g in goods:
        shutil.copy(g, cache / g.name)
    bad = json.loads(goods[0].read_text())
    bad["isrc"]["value"] = "BADTS0000001"
    bad["name"] = "Broken Meter Song"                 # distinct identity (no dedup collision)
    bad["artists"] = [{"uuid": "bad-uuid", "name": "Broken Meter Artist"}]
    bad["audio"]["timeSignature"] = 1                  # invalid, unrepairable
    (cache / "BADTS0000001.json").write_text(json.dumps(bad))

    result = run_transform(cache, seed=1, tier="demonstration",
                           candidate_source="isrc_resolved",
                           generated_at="2026-07-16T00:00:00Z")
    assert len(result.catalog) == 3  # the 3 good songs frozen
    assert len(result.dropped) == 1
    assert result.dropped[0]["isrc"] == "BADTS0000001"
    assert result.dropped[0]["code"] == "catalog_generation_failed"


def test_seed_changes_hash(fixtures_dir) -> None:
    cache = fixtures_dir / "cache"
    a = run_transform(cache, seed=1, tier="demonstration",
                      candidate_source="isrc_resolved", generated_at="2026-07-16T00:00:00Z")
    b = run_transform(cache, seed=2, tier="demonstration",
                      candidate_source="isrc_resolved", generated_at="2026-07-16T00:00:00Z")
    assert a.manifest["dataset_hash"] != b.manifest["dataset_hash"]
