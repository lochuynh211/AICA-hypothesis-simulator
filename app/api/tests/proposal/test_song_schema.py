"""Tests for the Song schema contract (T014 / US2).

TDD: these tests are written BEFORE song_schema.py exists — they should be RED
until T015 implements the model.

Covers:
- Every songs/** fixture accepted (valid songs, smoke, pairs, karaoke).
- Every negative/** fixture raises pydantic ValidationError with offending field in loc.
- Cross-object identity validator (track.id == af.id, track.uri == af.uri, track.duration_ms == af.duration_ms).
- Synthetic-identity validator (IDs start "synthetic-"; URLs host ends ".invalid").
- Instrumental song valid & both flags remain 1 (flag-eligible).
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from aica_api.models.proposal.song_schema import Song
from tests.proposal.conftest import load_fixture


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_song(relative_path: str) -> dict:
    """Load a fixture dict without parsing it yet."""
    return load_fixture(relative_path)


def _parse_song(relative_path: str) -> Song:
    """Load and parse a fixture as a Song."""
    data = _load_song(relative_path)
    return Song.model_validate(data)


# ---------------------------------------------------------------------------
# T014-1: All valid smoke fixtures accepted
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("fixture_path", [
    "fixtures/songs/smoke/song-0001.json",
    "fixtures/songs/smoke/song-0002.json",
    "fixtures/songs/smoke/song-0003.json",
    "fixtures/songs/smoke/song-0004.json",
    "fixtures/songs/smoke/song-0005.json",
])
def test_valid_smoke_song_accepted(fixture_path: str) -> None:
    """All smoke fixtures must parse without error."""
    song = _parse_song(fixture_path)
    assert song.spotify_track is not None
    assert song.spotify_audio_features is not None
    assert song.simulation_flags is not None


# ---------------------------------------------------------------------------
# T014-2: Contrast pair fixtures accepted
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("fixture_path", [
    "fixtures/songs/pairs/calm.json",
    "fixtures/songs/pairs/active.json",
    "fixtures/songs/pairs/bright.json",
    "fixtures/songs/pairs/dark.json",
    "fixtures/songs/pairs/acoustic.json",
    "fixtures/songs/pairs/electric.json",
])
def test_valid_pair_song_accepted(fixture_path: str) -> None:
    """All contrast pair fixtures must parse without error."""
    song = _parse_song(fixture_path)
    assert song.spotify_track is not None


# ---------------------------------------------------------------------------
# T014-3: Instrumental song valid & flag-eligible
# ---------------------------------------------------------------------------

def test_instrumental_song_valid_and_flag_eligible() -> None:
    """High-instrumentalness song must parse; both karaoke flags must remain 1."""
    song = _parse_song("fixtures/songs/karaoke/instrumental.json")
    assert song.spotify_audio_features.instrumentalness >= 0.65, (
        "Expected high instrumentalness for the instrumental fixture"
    )
    assert song.simulation_flags.humming_karaoke_available == 1
    assert song.simulation_flags.full_karaoke_available == 1


# ---------------------------------------------------------------------------
# T014-4: Negative — out-of-range energy
# ---------------------------------------------------------------------------

def test_energy_out_of_range_rejected() -> None:
    data = _load_song("fixtures/negative/energy-out-of-range.json")
    with pytest.raises(ValidationError) as exc_info:
        Song.model_validate(data)
    locs = [err["loc"] for err in exc_info.value.errors()]
    # energy must appear somewhere in the error locations
    assert any("energy" in loc for loc in locs), (
        f"Expected 'energy' in error locations, got: {locs}"
    )


# ---------------------------------------------------------------------------
# T014-5: Negative — mode: 2
# ---------------------------------------------------------------------------

def test_mode_invalid_rejected() -> None:
    data = _load_song("fixtures/negative/mode-invalid.json")
    with pytest.raises(ValidationError) as exc_info:
        Song.model_validate(data)
    locs = [err["loc"] for err in exc_info.value.errors()]
    assert any("mode" in loc for loc in locs), (
        f"Expected 'mode' in error locations, got: {locs}"
    )


# ---------------------------------------------------------------------------
# T014-6: Negative — time_signature: 8
# ---------------------------------------------------------------------------

def test_time_signature_invalid_rejected() -> None:
    data = _load_song("fixtures/negative/time-signature-invalid.json")
    with pytest.raises(ValidationError) as exc_info:
        Song.model_validate(data)
    locs = [err["loc"] for err in exc_info.value.errors()]
    assert any("time_signature" in loc for loc in locs), (
        f"Expected 'time_signature' in error locations, got: {locs}"
    )


# ---------------------------------------------------------------------------
# T014-7: Negative — duration_ms mismatch
# ---------------------------------------------------------------------------

def test_duration_mismatch_rejected() -> None:
    data = _load_song("fixtures/negative/duration-mismatch.json")
    with pytest.raises(ValidationError) as exc_info:
        Song.model_validate(data)
    # The cross-object validator fires; look for duration_ms in any loc
    errors = exc_info.value.errors()
    error_texts = [str(err) for err in errors]
    assert any("duration_ms" in t or "duration" in t for t in error_texts), (
        f"Expected duration mismatch error, got: {errors}"
    )


# ---------------------------------------------------------------------------
# T014-8: Negative — non-.invalid URL
# ---------------------------------------------------------------------------

def test_non_invalid_url_rejected() -> None:
    data = _load_song("fixtures/negative/non-invalid-url.json")
    with pytest.raises(ValidationError) as exc_info:
        Song.model_validate(data)
    locs = [err["loc"] for err in exc_info.value.errors()]
    # The offending field is external_urls.spotify inside spotify_track
    assert any(
        loc == ("spotify_track", "external_urls", "spotify")
        for loc in locs
    ), (
        f"Expected loc ('spotify_track', 'external_urls', 'spotify') in error locs, got: {locs}"
    )


# ---------------------------------------------------------------------------
# T014-9: Negative — ID missing synthetic- prefix
# ---------------------------------------------------------------------------

def test_id_missing_synthetic_prefix_rejected() -> None:
    data = _load_song("fixtures/negative/id-missing-synthetic-prefix.json")
    with pytest.raises(ValidationError) as exc_info:
        Song.model_validate(data)
    locs = [err["loc"] for err in exc_info.value.errors()]
    # The offending field is id inside spotify_track
    assert any(
        loc == ("spotify_track", "id")
        for loc in locs
    ), (
        f"Expected loc ('spotify_track', 'id') in error locs, got: {locs}"
    )


# ---------------------------------------------------------------------------
# T014-14: Negative — preview_url on non-.invalid host
# ---------------------------------------------------------------------------

def test_preview_url_non_invalid_rejected() -> None:
    data = _load_song("fixtures/negative/preview-url-non-invalid.json")
    with pytest.raises(ValidationError) as exc_info:
        Song.model_validate(data)
    locs = [err["loc"] for err in exc_info.value.errors()]
    # The offending field is preview_url inside spotify_track
    assert any(
        loc == ("spotify_track", "preview_url")
        for loc in locs
    ), (
        f"Expected loc ('spotify_track', 'preview_url') in error locs, got: {locs}"
    )


# ---------------------------------------------------------------------------
# T014-10: Negative — simulation_flags value 2
# ---------------------------------------------------------------------------

def test_simulation_flags_value_invalid_rejected() -> None:
    data = _load_song("fixtures/negative/simulation-flags-value-invalid.json")
    with pytest.raises(ValidationError) as exc_info:
        Song.model_validate(data)
    locs = [err["loc"] for err in exc_info.value.errors()]
    assert any("humming_karaoke_available" in loc or "simulation_flags" in loc
               for loc in locs), (
        f"Expected simulation_flags error, got: {locs}"
    )


# ---------------------------------------------------------------------------
# T014-11: Negative — unknown top-level namespace
# ---------------------------------------------------------------------------

def test_unknown_top_level_namespace_rejected() -> None:
    data = _load_song("fixtures/negative/unknown-top-level-namespace.json")
    with pytest.raises(ValidationError) as exc_info:
        Song.model_validate(data)
    errors = exc_info.value.errors()
    # extra="forbid" on Song — "enriched_metadata" must be flagged
    error_texts = [str(err) for err in errors]
    assert any("enriched_metadata" in t or "extra" in t.lower() for t in error_texts), (
        f"Expected extra-field error for unknown namespace, got: {errors}"
    )


# ---------------------------------------------------------------------------
# T014-12: Cross-object identity enforced (inline)
# ---------------------------------------------------------------------------

def test_cross_object_id_mismatch_rejected() -> None:
    """Inline: audio_features.id does not match track.id — should fail."""
    base = _load_song("fixtures/songs/smoke/song-0001.json")
    base["spotify_audio_features"]["id"] = "synthetic-track-WRONG"
    with pytest.raises(ValidationError) as exc_info:
        Song.model_validate(base)
    errors = exc_info.value.errors()
    error_texts = [str(err) for err in errors]
    assert any("id" in t.lower() or "identity" in t.lower() for t in error_texts), (
        f"Expected cross-object id mismatch error, got: {errors}"
    )


def test_cross_object_uri_mismatch_rejected() -> None:
    """Inline: audio_features.uri does not match track.uri — should fail."""
    base = _load_song("fixtures/songs/smoke/song-0001.json")
    base["spotify_audio_features"]["uri"] = "spotify:track:synthetic-track-WRONG"
    with pytest.raises(ValidationError) as exc_info:
        Song.model_validate(base)
    errors = exc_info.value.errors()
    error_texts = [str(err) for err in errors]
    assert any("uri" in t.lower() or "identity" in t.lower() for t in error_texts), (
        f"Expected cross-object uri mismatch error, got: {errors}"
    )


# ---------------------------------------------------------------------------
# T014-13: Synthetic-identity — SpotifyAudioFeatures extra fields tolerated
# ---------------------------------------------------------------------------

def test_audio_features_extra_fields_tolerated() -> None:
    """extra='ignore' inside Spotify objects: provider extensions must not fail."""
    base = _load_song("fixtures/songs/smoke/song-0001.json")
    base["spotify_audio_features"]["future_provider_field"] = "some_value"
    song = Song.model_validate(base)
    # The extra field is silently dropped; the song validates fine
    assert song.spotify_audio_features is not None


def test_track_extra_fields_tolerated() -> None:
    """extra='ignore' inside SpotifyTrack: provider extensions must not fail."""
    base = _load_song("fixtures/songs/smoke/song-0001.json")
    base["spotify_track"]["future_provider_field"] = "some_value"
    song = Song.model_validate(base)
    assert song.spotify_track is not None
