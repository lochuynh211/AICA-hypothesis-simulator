"""S3 — Binner: compute a real song's coverage coordinates from its real audio.

`bin_song(payload)` takes a raw Soundcharts `by-isrc` response (the shape stored in
the raw-response cache) and returns a dict of *coverage coordinates*:

    {
      "energy_band", "tempo_band", "profile_family", "cell_id",
      "valence_band", "mode", "acousticness_band",
      "humming_ease_band", "full_karaoke_ease_band",
      "language", "era",
      "genre_root", "genre_subs",   # provenance for lineage/genre map only
    }

This is **coverage arithmetic on the real audio, never an item_fit score** (design
§4.6). The firewall holds: the cell is decided by the real audio here, not by any
LLM guess or score. No score/label/rank field is ever emitted.

Band boundaries per data-spec §10.2. Because the published band ranges leave small
gaps (e.g. energy 0.35..0.40), binning uses total split-points at the gap midpoints
so every real value lands in exactly one band.
"""
from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Band split-points (total; gap midpoints of the §10.2 ranges)
# ---------------------------------------------------------------------------

# energy: low 0.10..0.35 | medium 0.40..0.65 | high 0.70..0.95
_ENERGY_LOW_MAX = 0.375   # midpoint of 0.35..0.40
_ENERGY_MED_MAX = 0.675   # midpoint of 0.65..0.70

# tempo: low 60..95 | medium 96..130 | high 131..180
_TEMPO_LOW_MAX = 95.5     # midpoint of 95..96
_TEMPO_MED_MAX = 130.5    # midpoint of 130..131

# valence thirds
_VALENCE_LOW_MAX = 0.34
_VALENCE_HIGH_MIN = 0.67

# acousticness
_ACOUSTIC_MIN = 0.50

# ease composite threshold
_EASE_HIGH_MIN = 0.50

# Short cell-id codes (must match coverage/plan.py)
_ENERGY_CODE = {"low": "lo", "medium": "md", "high": "hi"}
_TEMPO_CODE = {"low": "lo", "medium": "md", "high": "hi"}
_PROFILE_CODE = {
    "balanced_vocal": "bv",
    "danceable_vocal": "dv",
    "speech_forward": "sf",
    "instrumental_leaning": "il",
}


def _energy_band(energy: float) -> str:
    if energy < _ENERGY_LOW_MAX:
        return "low"
    if energy < _ENERGY_MED_MAX:
        return "medium"
    return "high"


def _tempo_band(tempo: float) -> str:
    if tempo < _TEMPO_LOW_MAX:
        return "low"
    if tempo < _TEMPO_MED_MAX:
        return "medium"
    return "high"


def _profile_family(audio: dict) -> str:
    """Assign a profile family by priority (§10.2 guidance).

    Priority order resolves the overlapping guidance deterministically:
    instrumental_leaning > speech_forward > danceable_vocal > balanced_vocal.
    """
    instrumentalness = audio["instrumentalness"]
    speechiness = audio["speechiness"]
    danceability = audio["danceability"]

    if instrumentalness >= 0.65:
        return "instrumental_leaning"
    if speechiness >= 0.40:
        return "speech_forward"
    if danceability >= 0.65 and instrumentalness <= 0.15:
        return "danceable_vocal"
    return "balanced_vocal"


def _valence_band(valence: float) -> str:
    if valence < _VALENCE_LOW_MAX:
        return "low"
    if valence < _VALENCE_HIGH_MIN:
        return "mid"
    return "high"


def _acousticness_band(acousticness: float) -> str:
    return "acoustic" if acousticness >= _ACOUSTIC_MIN else "electric"


def _humming_ease_band(audio: dict) -> str:
    """Humming-ease coverage proxy: danceability↑, instrumentalness↓, speechiness↓.

    Coverage arithmetic only (§4.6) — directional inputs match the P6 karaoke-ease
    proxy roles (§5.2), averaged and thresholded into a low/high coverage band.
    """
    composite = (
        audio["danceability"]
        + (1.0 - audio["instrumentalness"])
        + (1.0 - audio["speechiness"])
    ) / 3.0
    return "high" if composite >= _EASE_HIGH_MIN else "low"


def _full_karaoke_ease_band(audio: dict, duration_s: float) -> str:
    """Full-karaoke-ease coverage proxy: danceability↑, speechiness↓, moderate duration.

    Coverage arithmetic only. A song sings more easily end-to-end when it has clear
    vocals and a comfortable length; duration_moderateness peaks near ~210 s.
    """
    duration_moderateness = 1.0 - min(1.0, abs(duration_s - 210.0) / 150.0)
    composite = (
        audio["danceability"]
        + (1.0 - audio["speechiness"])
        + duration_moderateness
    ) / 3.0
    return "high" if composite >= _EASE_HIGH_MIN else "low"


def era_bucket(release_date: str | None) -> str:
    """Bucket a release date into an era (classic / modern / recent).

    classic = pre-2000, modern = 2000..2015, recent = 2016+. Derived only from the
    real `releaseDate` (design §4.1, D12).
    """
    if not release_date:
        return "unknown"
    year = int(str(release_date)[:4])
    if year < 2000:
        return "classic"
    if year <= 2015:
        return "modern"
    return "recent"


def make_cell_id(energy_band: str, tempo_band: str, profile_family: str) -> str:
    """Build the primary cell_id from the three primary bands (matches coverage/plan)."""
    return (
        f"E-{_ENERGY_CODE[energy_band]}_"
        f"T-{_TEMPO_CODE[tempo_band]}_"
        f"P-{_PROFILE_CODE[profile_family]}"
    )


def bin_song(payload: dict) -> dict[str, Any]:
    """Compute the coverage coordinates of a raw Soundcharts `by-isrc` payload.

    Raises KeyError if the audio block or a required audio field is absent — the
    harvest gate (S2c) is responsible for rejecting incomplete audio before binning.
    """
    audio = payload["audio"]

    energy_band = _energy_band(audio["energy"])
    tempo_band = _tempo_band(audio["tempo"])
    profile_family = _profile_family(audio)

    genres = payload.get("genres") or []
    first_genre = genres[0] if genres else {}

    return {
        "energy_band": energy_band,
        "tempo_band": tempo_band,
        "profile_family": profile_family,
        "cell_id": make_cell_id(energy_band, tempo_band, profile_family),
        "valence_band": _valence_band(audio["valence"]),
        "mode": int(audio["mode"]),
        "acousticness_band": _acousticness_band(audio["acousticness"]),
        "humming_ease_band": _humming_ease_band(audio),
        "full_karaoke_ease_band": _full_karaoke_ease_band(
            audio, float(payload.get("duration") or 0)
        ),
        "language": payload.get("languageCode"),
        "era": era_bucket(payload.get("releaseDate")),
        "genre_root": first_genre.get("root"),
        "genre_subs": list(first_genre.get("sub") or []),
    }
