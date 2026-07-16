"""T023 [US1] — S5 validator tests.

The validator wraps the frozen `Song` schema plus the data-spec §17 rule families and
surfaces failures as typed codes (contracts/error-taxonomy.md):
- track↔audio-features id/uri/duration disagreement → `cross_object_identity_mismatch`
- non-`synthetic-` ID or non-`.invalid` URL → `synthetic_identity_violation`
- a generic schema/range/flag breakage → a repairable `SchemaViolation`
- a required coverage cell/quota unmet at freeze → `coverage_contract_failed`
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from mdg.errors import ErrorCode, MdgFatalError
from mdg.mapper import CatalogMapper
from mdg.validator import (
    SongViolation,
    validate_coverage,
    validate_song,
)


def _valid_song(fixtures_dir: Path, isrc: str = "JPXX01900123") -> dict:
    payload = json.loads((fixtures_dir / "cache" / f"{isrc}.json").read_text(encoding="utf-8"))
    return CatalogMapper(seed=1042).map_song(payload)


def test_passes_valid_song(fixtures_dir: Path) -> None:
    validate_song(_valid_song(fixtures_dir))  # must not raise


def test_cross_object_identity_mismatch(fixtures_dir: Path) -> None:
    song = _valid_song(fixtures_dir)
    song["spotify_audio_features"]["duration_ms"] += 1
    with pytest.raises(SongViolation) as exc:
        validate_song(song)
    assert exc.value.code == ErrorCode.cross_object_identity_mismatch


def test_synthetic_identity_violation_bad_id(fixtures_dir: Path) -> None:
    song = _valid_song(fixtures_dir)
    song["spotify_track"]["id"] = "spotify-track-real"
    song["spotify_audio_features"]["id"] = "spotify-track-real"
    with pytest.raises(SongViolation) as exc:
        validate_song(song)
    assert exc.value.code == ErrorCode.synthetic_identity_violation


def test_synthetic_identity_violation_bad_url(fixtures_dir: Path) -> None:
    song = _valid_song(fixtures_dir)
    song["spotify_track"]["href"] = "https://api.spotify.com/tracks/x"
    with pytest.raises(SongViolation) as exc:
        validate_song(song)
    assert exc.value.code == ErrorCode.synthetic_identity_violation


def test_range_violation_is_repairable_schema_violation(fixtures_dir: Path) -> None:
    song = _valid_song(fixtures_dir)
    song["spotify_audio_features"]["energy"] = 1.5  # out of [0,1]
    with pytest.raises(SongViolation) as exc:
        validate_song(song)
    assert exc.value.category == "schema"


def test_flag_violation(fixtures_dir: Path) -> None:
    song = _valid_song(fixtures_dir)
    song["simulation_flags"]["humming_karaoke_available"] = 2
    with pytest.raises(SongViolation) as exc:
        validate_song(song)
    assert exc.value.category == "flag"  # simulation_flags loc → "flag" category


def test_coverage_contract_failed_on_unmet_cell() -> None:
    covered = {"E-hi_T-hi_P-bv", "E-lo_T-lo_P-bv"}
    required = {"E-hi_T-hi_P-bv", "E-lo_T-lo_P-bv", "E-md_T-md_P-dv"}
    with pytest.raises(MdgFatalError) as exc:
        validate_coverage(covered_cells=covered, required_cells=required)
    assert exc.value.code == ErrorCode.coverage_contract_failed


def test_coverage_contract_passes_when_all_covered() -> None:
    covered = {"E-hi_T-hi_P-bv", "E-lo_T-lo_P-bv"}
    required = {"E-hi_T-hi_P-bv", "E-lo_T-lo_P-bv"}
    validate_coverage(covered_cells=covered, required_cells=required)  # no raise


def test_valid_fixtures_unchanged(fixtures_dir: Path) -> None:
    # Validation is read-only: it does not mutate the song.
    song = _valid_song(fixtures_dir)
    before = copy.deepcopy(song)
    validate_song(song)
    assert song == before
