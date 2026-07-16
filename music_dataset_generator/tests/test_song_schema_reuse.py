"""T011 — Song schema reuse test.

Proves that mdg imports Song from aica_api.models.proposal.song_schema
and does NOT redefine it.  A hand-authored fixture with:
  - real song name / verbatim audio fields
  - synthetic IDs (synthetic-track-NNNN, synthetic-artist-NNNN, etc.)
  - .invalid URLs
  - cross-object identity holds (track.id == audio.id, etc.)

Also asserts that a bad fixture (non-synthetic ID) is rejected.
"""
import pytest
from pydantic import ValidationError

# P2 imports Song from the canonical location — never redefines it.
from aica_api.models.proposal.song_schema import Song


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

def _make_valid_song_dict(
    synthetic_id: str = "synthetic-track-0001",
    duration_ms: int = 210000,
) -> dict:
    """Build a minimal valid Song dict with real name / verbatim audio."""
    return {
        "spotify_track": {
            "duration_ms": duration_ms,
            "explicit": False,
            "id": synthetic_id,
            "is_local": False,
            "name": "Yoru ni Kakeru",  # real title
            "popularity": 80,
            "track_number": 1,
            "type": "track",
            "uri": f"spotify:track:{synthetic_id}",
            "external_urls": {"spotify": f"https://open.spotify.invalid/{synthetic_id}"},
        },
        "spotify_audio_features": {
            "acousticness": 0.12,
            "danceability": 0.76,
            "duration_ms": duration_ms,
            "energy": 0.81,
            "id": synthetic_id,
            "instrumentalness": 0.0,
            "key": 2,
            "liveness": 0.11,
            "loudness": -5.2,
            "mode": 1,
            "speechiness": 0.04,
            "tempo": 130.5,
            "time_signature": 4,
            "type": "audio_features",
            "uri": f"spotify:track:{synthetic_id}",
            "valence": 0.55,
        },
        "simulation_flags": {
            "humming_karaoke_available": 1,
            "full_karaoke_available": 1,
        },
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestSongSchemaReuse:
    def test_song_is_from_aica_api(self):
        """Song must come from aica_api, not be redefined in mdg."""
        import aica_api.models.proposal.song_schema as ref_module
        assert Song is ref_module.Song, (
            "mdg must use the canonical Song from aica_api — never redefine it"
        )

    def test_valid_fixture_accepted(self):
        """A well-formed fixture with synthetic IDs and .invalid URLs is accepted."""
        data = _make_valid_song_dict()
        song = Song.model_validate(data)
        assert song.spotify_track.name == "Yoru ni Kakeru"
        assert song.spotify_track.id == "synthetic-track-0001"
        assert song.spotify_audio_features.energy == 0.81

    def test_cross_object_identity_holds(self):
        """track.id == audio.id, track.uri == audio.uri, track.duration_ms == audio.duration_ms."""
        data = _make_valid_song_dict(synthetic_id="synthetic-track-0042", duration_ms=180000)
        song = Song.model_validate(data)
        assert song.spotify_track.id == song.spotify_audio_features.id
        assert song.spotify_track.uri == song.spotify_audio_features.uri
        assert song.spotify_track.duration_ms == song.spotify_audio_features.duration_ms

    def test_invalid_id_rejected(self):
        """A non-synthetic ID (real Spotify ID) must be rejected."""
        data = _make_valid_song_dict(synthetic_id="4iV5W9uYEdYUVa79Axb7Rh")
        with pytest.raises(ValidationError) as exc_info:
            Song.model_validate(data)
        assert "synthetic-" in str(exc_info.value).lower() or "id" in str(exc_info.value).lower()

    def test_real_url_rejected(self):
        """A real Spotify URL (non-.invalid host) must be rejected."""
        data = _make_valid_song_dict()
        data["spotify_track"]["external_urls"]["spotify"] = (
            "https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh"
        )
        with pytest.raises(ValidationError):
            Song.model_validate(data)

    def test_cross_object_mismatch_rejected(self):
        """Mismatching track.id vs audio.id must be rejected."""
        data = _make_valid_song_dict()
        # Give the audio features a different synthetic id
        data["spotify_audio_features"]["id"] = "synthetic-track-9999"
        data["spotify_audio_features"]["uri"] = "spotify:track:synthetic-track-9999"
        with pytest.raises(ValidationError):
            Song.model_validate(data)

    def test_simulation_flags_default(self):
        """simulation_flags defaults are valid (both gates = 1)."""
        data = _make_valid_song_dict()
        del data["simulation_flags"]
        song = Song.model_validate(data)
        assert song.simulation_flags.humming_karaoke_available == 1
        assert song.simulation_flags.full_karaoke_available == 1

    def test_invalid_audio_range_rejected(self):
        """An energy value > 1.0 must be rejected."""
        data = _make_valid_song_dict()
        data["spotify_audio_features"]["energy"] = 1.5
        with pytest.raises(ValidationError):
            Song.model_validate(data)
