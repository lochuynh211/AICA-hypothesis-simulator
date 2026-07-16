"""T021 [US1] — S4 mapper tests.

The mapper transforms a real Soundcharts `by-isrc` payload into a frozen `Song` dict
(design §4.7). Real names + verbatim audio + real ISRC are kept (D1/D2/D6); IDs become
`synthetic-…`, URLs become `.invalid`. `timeSignature`→`time_signature`, `duration`
(seconds) → `duration_ms`. Album/markets/popularity/track-number/negative-fixture
restrictions are synthesized deterministically (seed-pinned, FR-029).

The output must validate against the frozen `Song` model imported from aica_api.
"""
from __future__ import annotations

import json
from pathlib import Path

from aica_api.models.proposal.song_schema import Song

from mdg.mapper import CatalogMapper


def _load(fixtures_dir: Path, isrc: str) -> dict:
    return json.loads((fixtures_dir / "cache" / f"{isrc}.json").read_text(encoding="utf-8"))


def test_maps_to_valid_song(fixtures_dir: Path) -> None:
    mapper = CatalogMapper(seed=1042)
    song = mapper.map_song(_load(fixtures_dir, "JPXX01900123"))
    # Validates against the frozen schema (raises on any violation).
    Song.model_validate(song)


def test_real_name_and_audio_kept_verbatim(fixtures_dir: Path) -> None:
    payload = _load(fixtures_dir, "JPXX01900123")
    song = CatalogMapper(seed=1042).map_song(payload)
    assert song["spotify_track"]["name"] == "Night Runner"
    assert song["spotify_track"]["artists"][0]["name"] == "Real Band"
    af = song["spotify_audio_features"]
    src = payload["audio"]
    for field in ("acousticness", "danceability", "energy", "instrumentalness",
                  "key", "liveness", "loudness", "mode", "speechiness", "tempo",
                  "valence"):
        assert af[field] == src[field]
    # timeSignature -> time_signature (renamed, value kept)
    assert af["time_signature"] == src["timeSignature"]
    assert "timeSignature" not in af


def test_duration_seconds_to_ms(fixtures_dir: Path) -> None:
    song = CatalogMapper(seed=1042).map_song(_load(fixtures_dir, "JPXX01900123"))
    assert song["spotify_track"]["duration_ms"] == 218_000       # 218 s * 1000
    assert song["spotify_audio_features"]["duration_ms"] == 218_000


def test_synthetic_ids_and_invalid_urls(fixtures_dir: Path) -> None:
    song = CatalogMapper(seed=1042).map_song(_load(fixtures_dir, "JPXX01900123"))
    track = song["spotify_track"]
    assert track["id"].startswith("synthetic-track-")
    assert track["artists"][0]["id"].startswith("synthetic-artist-")
    assert track["album"]["id"].startswith("synthetic-album-")
    assert song["spotify_audio_features"]["id"] == track["id"]
    # every URL host ends .invalid
    assert ".invalid" in track["href"]
    assert ".invalid" in track["external_urls"]["spotify"]
    assert ".invalid" in song["spotify_audio_features"]["analysis_url"]


def test_real_isrc_kept(fixtures_dir: Path) -> None:
    song = CatalogMapper(seed=1042).map_song(_load(fixtures_dir, "JPXX01900123"))
    assert song["spotify_track"]["external_ids"]["isrc"] == "JPXX01900123"


def test_synthesized_fields_present(fixtures_dir: Path) -> None:
    song = CatalogMapper(seed=1042).map_song(_load(fixtures_dir, "JPXX01900123"))
    track = song["spotify_track"]
    assert 0 <= track["popularity"] <= 100
    assert isinstance(track["available_markets"], list) and track["available_markets"]
    assert track["album"]["release_date"] == "2019-06-01"   # from releaseDate
    assert track["explicit"] is False
    assert track["is_local"] is False
    assert track["is_playable"] is True


def test_negative_fixture_restriction(fixtures_dir: Path) -> None:
    song = CatalogMapper(seed=1042).map_song(
        _load(fixtures_dir, "GBUM71900001"), negative_fixture=True
    )
    track = song["spotify_track"]
    assert track["is_playable"] is False
    assert track["restrictions"]["reason"]  # a restriction reason is set
    Song.model_validate(song)


def test_deterministic_across_instances(fixtures_dir: Path) -> None:
    payload = _load(fixtures_dir, "JPXX01900123")
    a = CatalogMapper(seed=1042).map_song(payload)
    b = CatalogMapper(seed=1042).map_song(payload)
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def test_seed_changes_synthesized_fields(fixtures_dir: Path) -> None:
    payload = _load(fixtures_dir, "JPXX01900123")
    a = CatalogMapper(seed=1).map_song(payload)
    b = CatalogMapper(seed=2).map_song(payload)
    # Real fields identical; at least one synthesized field differs across seeds.
    assert a["spotify_track"]["name"] == b["spotify_track"]["name"]
    assert (
        a["spotify_track"]["popularity"] != b["spotify_track"]["popularity"]
        or a["spotify_track"]["track_number"] != b["spotify_track"]["track_number"]
    )


def test_artist_dedup_across_songs(fixtures_dir: Path) -> None:
    # Two payloads by the same artist name -> same synthetic-artist id.
    p1 = _load(fixtures_dir, "JPXX01900123")
    p2 = _load(fixtures_dir, "JPXX01900124")
    p2["artists"] = p1["artists"]
    p2["mainArtists"] = p1["mainArtists"]
    mapper = CatalogMapper(seed=1042)
    s1 = mapper.map_song(p1)
    s2 = mapper.map_song(p2)
    assert s1["spotify_track"]["artists"][0]["id"] == s2["spotify_track"]["artists"][0]["id"]
    # but distinct track ids
    assert s1["spotify_track"]["id"] != s2["spotify_track"]["id"]


def test_no_score_or_label_in_song(fixtures_dir: Path) -> None:
    song = CatalogMapper(seed=1042).map_song(_load(fixtures_dir, "JPXX01900123"))
    blob = json.dumps(song)
    for forbidden in ("recommended", "best_for_world", "target_rank",
                      "item_fit", "why_fits_cell", "web_evidence"):
        assert forbidden not in blob
