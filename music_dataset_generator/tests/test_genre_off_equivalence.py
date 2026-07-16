"""T051 [US5] — genre extension is opt-in and contract-preserving (SC-005).

With `genre_affinity_v1` disabled, the frozen catalog is byte-identical to the enabled
run — the genre map is a **separate** artifact, never written into a Song. So the
no-extension P6 ranking is reproduced exactly (the six genre features stay `context_only`).
When enabled, the extension validates against aica_api's GenreAffinityV1 shape.
"""
from __future__ import annotations

import json

from aica_api.models.proposal.genre_extension import GenreAffinityV1

from mdg.transform import run_transform


def _run(cache, *, genre_on):
    return run_transform(
        cache, seed=42, tier="demonstration", candidate_source="isrc_resolved",
        generated_at="2026-07-16T00:00:00Z", genre_affinity_v1=genre_on,
    )


def test_catalog_identical_with_and_without_genre(fixtures_dir) -> None:
    cache = fixtures_dir / "cache"
    off = _run(cache, genre_on=False)
    on = _run(cache, genre_on=True)
    assert json.dumps(off.catalog, sort_keys=True) == json.dumps(on.catalog, sort_keys=True)
    assert off.manifest["dataset_hash"] == on.manifest["dataset_hash"]


def test_extension_absent_when_disabled(fixtures_dir) -> None:
    off = _run(fixtures_dir / "cache", genre_on=False)
    assert off.genre_extension is None


def test_extension_present_and_valid_when_enabled(fixtures_dir) -> None:
    on = _run(fixtures_dir / "cache", genre_on=True)
    assert on.genre_extension is not None
    # Validates against the frozen aica_api GenreAffinityV1 shape (12-vocab enforced).
    model = GenreAffinityV1.model_validate(on.genre_extension)
    assert model.artist_genres  # at least one artist carries a mapped genre


def test_extension_never_leaks_into_song(fixtures_dir) -> None:
    on = _run(fixtures_dir / "cache", genre_on=True)
    for song in on.catalog:
        assert set(song.keys()) == {"spotify_track", "spotify_audio_features", "simulation_flags"}
        assert "genre_affinity_v1" not in json.dumps(song)
