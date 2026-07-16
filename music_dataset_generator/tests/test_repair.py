"""T025 [US1] — S5 repair-loop tests (worked example §7, data-spec §18).

`validate_and_repair(song)` runs the deterministic repair loop: validate → on a
`SongViolation`, apply the matching §18 repair (copy canonical duration/id, rebuild a
`.invalid` URL, …), re-validate. Every repair is logged. After the **2-repair budget**
is exhausted and the record still fails, it halts with
`MdgFatalError(catalog_generation_failed)` — no silent hand-edit.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from mdg.errors import ErrorCode, MdgFatalError
from mdg.mapper import CatalogMapper
from mdg.repair import validate_and_repair


def _valid_song(fixtures_dir: Path, isrc: str = "JPXX01900123") -> dict:
    payload = json.loads((fixtures_dir / "cache" / f"{isrc}.json").read_text(encoding="utf-8"))
    return CatalogMapper(seed=1042).map_song(payload)


def test_valid_song_needs_no_repair(fixtures_dir: Path) -> None:
    song = _valid_song(fixtures_dir)
    repaired, log = validate_and_repair(song)
    assert log == []
    assert repaired == song


def test_duration_mismatch_repair(fixtures_dir: Path) -> None:
    song = _valid_song(fixtures_dir)
    song["spotify_audio_features"]["duration_ms"] = 218  # seconds, not ms — mismatch
    repaired, log = validate_and_repair(song)
    assert repaired["spotify_audio_features"]["duration_ms"] == \
        repaired["spotify_track"]["duration_ms"]
    assert len(log) == 1
    assert log[0]["rule"] == "copy_canonical_duration"


def test_id_mismatch_repair(fixtures_dir: Path) -> None:
    song = _valid_song(fixtures_dir)
    song["spotify_audio_features"]["id"] = "synthetic-track-9999"  # disagrees with track
    repaired, log = validate_and_repair(song)
    assert repaired["spotify_audio_features"]["id"] == repaired["spotify_track"]["id"]
    assert any(r["rule"] == "copy_canonical_id" for r in log)


def test_bad_url_rebuilt_from_id(fixtures_dir: Path) -> None:
    song = _valid_song(fixtures_dir)
    song["spotify_track"]["href"] = "https://realcdn.com/tracks/x"
    repaired, log = validate_and_repair(song)
    assert ".invalid" in repaired["spotify_track"]["href"]
    assert repaired["spotify_track"]["id"] in repaired["spotify_track"]["href"]
    assert any(r["rule"] == "rebuild_invalid_url" for r in log)


def test_two_repairs_then_pass(fixtures_dir: Path) -> None:
    # Worked example §7: duration mismatch + bad URL → 2 repairs → pass.
    song = _valid_song(fixtures_dir)
    song["spotify_audio_features"]["duration_ms"] = 218
    song["spotify_track"]["href"] = "https://realcdn.com/tracks/x"
    repaired, log = validate_and_repair(song)
    assert len(log) == 2


def test_two_failed_repairs_halts(fixtures_dir: Path) -> None:
    # An out-of-[0,1] audio value beyond serialization noise cannot be repaired
    # deterministically; the 2-strike budget is exhausted → catalog_generation_failed.
    song = _valid_song(fixtures_dir)
    song["spotify_audio_features"]["energy"] = 1.5
    with pytest.raises(MdgFatalError) as exc:
        validate_and_repair(song)
    assert exc.value.code == ErrorCode.catalog_generation_failed


def test_serialization_noise_clamped(fixtures_dir: Path) -> None:
    song = _valid_song(fixtures_dir)
    song["spotify_audio_features"]["valence"] = 1.0 + 1e-10  # within 1e-9 noise
    repaired, log = validate_and_repair(song)
    assert repaired["spotify_audio_features"]["valence"] == 1.0
    assert any(r["rule"] == "clamp_serialization_noise" for r in log)


def test_repair_deterministic(fixtures_dir: Path) -> None:
    song = _valid_song(fixtures_dir)
    song["spotify_audio_features"]["duration_ms"] = 218
    a = validate_and_repair(copy.deepcopy(song))
    b = validate_and_repair(copy.deepcopy(song))
    assert json.dumps(a[0], sort_keys=True) == json.dumps(b[0], sort_keys=True)
    assert a[1] == b[1]
