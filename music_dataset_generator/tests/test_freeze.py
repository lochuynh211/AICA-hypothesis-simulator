"""T027 [US1] — S6 freeze tests.

Freeze builds the `dataset_manifest` (kind/versions/seed/hash) and asserts the frozen
catalog is label-free (FR-019). `generated_at` is supplied externally — the deterministic
core never reads the wall clock.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from mdg.errors import ErrorCode, MdgFatalError
from mdg.freeze import assert_label_free, build_manifest, compute_dataset_hash
from mdg.mapper import CatalogMapper


def _catalog(fixtures_dir: Path) -> list[dict]:
    mapper = CatalogMapper(seed=1042)
    out = []
    for isrc in ("JPXX01900123", "JPXX01900124"):
        payload = json.loads((fixtures_dir / "cache" / f"{isrc}.json").read_text(encoding="utf-8"))
        out.append(mapper.map_song(payload))
    return out


def test_manifest_fields(fixtures_dir: Path) -> None:
    catalog = _catalog(fixtures_dir)
    m = build_manifest(
        catalog, seed=1042, tier="demonstration",
        candidate_source="isrc_resolved", generated_at="2026-07-16T00:00:00Z",
    )
    assert m["dataset_kind"] == "soundcharts_grounded_spotify_compatible"
    assert m["synthetic_only"] is False
    assert m["random_seed"] == 1042
    assert m["generated_at"] == "2026-07-16T00:00:00Z"
    assert m["candidate_source"] == "isrc_resolved"
    assert m["tier"] == "demonstration"
    assert m["dataset_hash"].startswith("sha256:")
    assert m["generator_version"] and m["schema_version"]
    assert m["provenance_note"]


def test_dataset_hash_stable_and_order_sensitive(fixtures_dir: Path) -> None:
    catalog = _catalog(fixtures_dir)
    assert compute_dataset_hash(catalog) == compute_dataset_hash(catalog)
    # Different content → different hash.
    mutated = json.loads(json.dumps(catalog))
    mutated[0]["spotify_track"]["popularity"] = (
        mutated[0]["spotify_track"]["popularity"] + 1
    ) % 101
    assert compute_dataset_hash(mutated) != compute_dataset_hash(catalog)


def test_generated_at_not_from_wall_clock(fixtures_dir: Path) -> None:
    # build_manifest requires generated_at as an argument (no default wall-clock).
    catalog = _catalog(fixtures_dir)
    with pytest.raises(TypeError):
        build_manifest(  # type: ignore[call-arg]
            catalog, seed=1, tier="smoke", candidate_source="isrc_resolved"
        )


def test_label_free_passes_clean_catalog(fixtures_dir: Path) -> None:
    assert_label_free(_catalog(fixtures_dir))  # no raise


@pytest.mark.parametrize("bad_key", ["recommended", "best_for_world", "target_rank",
                                     "item_fit", "why_fits_cell"])
def test_label_free_rejects_forbidden_key(fixtures_dir: Path, bad_key: str) -> None:
    catalog = _catalog(fixtures_dir)
    catalog[0]["spotify_track"][bad_key] = "leak"
    with pytest.raises(MdgFatalError) as exc:
        assert_label_free(catalog)
    assert exc.value.code == ErrorCode.catalog_generation_failed


def test_build_manifest_rejects_labelled_catalog(fixtures_dir: Path) -> None:
    catalog = _catalog(fixtures_dir)
    catalog[0]["spotify_track"]["target_rank"] = 1
    with pytest.raises(MdgFatalError):
        build_manifest(
            catalog, seed=1, tier="smoke",
            candidate_source="isrc_resolved", generated_at="2026-01-01T00:00:00Z",
        )
