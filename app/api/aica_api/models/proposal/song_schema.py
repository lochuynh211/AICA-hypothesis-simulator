"""Song schema models for the P0.5 Content Contract & Song-Schema Freeze.

Implements:
- SpotifyTrack and sub-objects (Album, ArtistRef, ExternalIds, ExternalUrls,
  Image, Restrictions, LinkedFrom) — extra="ignore" (lenient inside Spotify objects).
- SpotifyAudioFeatures (18 fields, §5.1) — extra="ignore"; range validators.
- SimulationFlags — extra="forbid"; Literal[0,1] fields.
- Song wrapper — extra="forbid" (namespace-strict); cross-object identity validator;
  synthetic-identity validator.

Key invariants (§5.3 / data-model.md):
- [0,1] fields: finite and in range.
- key ∈ {-1, 0..11}.
- mode ∈ {0, 1}.
- tempo > 0.
- loudness: finite.
- time_signature ∈ {3, 4, 5, 6, 7}.
- type == "audio_features".
- track.id == audio_features.id; track.uri == audio_features.uri;
  track.duration_ms == audio_features.duration_ms.
- Synthetic-identity: every ID value starts "synthetic-"; every URL host ends ".invalid";
  hosts api.spotify.com / open.spotify.com are forbidden.
"""
from __future__ import annotations

import math
from typing import Any, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# ---------------------------------------------------------------------------
# URL / ID validation helpers
# ---------------------------------------------------------------------------

_FORBIDDEN_HOSTS = {"api.spotify.com", "open.spotify.com"}


def _assert_invalid_domain(url: str, field_name: str) -> None:
    """Raise ValueError if the URL host does not end with '.invalid'."""
    if not url:
        return
    parsed = urlparse(url)
    host = parsed.hostname or ""
    if host in _FORBIDDEN_HOSTS:
        raise ValueError(
            f"{field_name}: URL host must not be api.spotify.com or open.spotify.com, "
            f"got '{host}'"
        )
    if not host.endswith(".invalid"):
        raise ValueError(
            f"{field_name}: URL host must end with '.invalid' for synthetic fixtures, "
            f"got '{host}'"
        )


def _assert_synthetic_id(value: str, field_name: str) -> None:
    """Raise ValueError if the ID does not start with 'synthetic-'."""
    if not value.startswith("synthetic-"):
        raise ValueError(
            f"{field_name}: ID must start with 'synthetic-', got '{value}'"
        )


# ---------------------------------------------------------------------------
# Spotify sub-objects (extra="ignore")
# ---------------------------------------------------------------------------

class ExternalUrls(BaseModel):
    """Spotify external_urls object."""

    model_config = ConfigDict(extra="ignore")

    spotify: str | None = None

    @field_validator("spotify", mode="after")
    @classmethod
    def _spotify_url_must_be_invalid(cls, v: str | None) -> str | None:
        if v is not None:
            _assert_invalid_domain(v, "external_urls.spotify")
        return v


class ExternalIds(BaseModel):
    """Spotify external_ids object."""

    model_config = ConfigDict(extra="ignore")

    isrc: str | None = None
    ean: str | None = None
    upc: str | None = None


class Image(BaseModel):
    """Spotify Image object."""

    model_config = ConfigDict(extra="ignore")

    url: str
    height: int | None = None
    width: int | None = None

    @field_validator("url", mode="after")
    @classmethod
    def _url_must_be_invalid(cls, v: str) -> str:
        _assert_invalid_domain(v, "image.url")
        return v


class Restrictions(BaseModel):
    """Spotify Restrictions object."""

    model_config = ConfigDict(extra="ignore")

    reason: str


class ArtistRef(BaseModel):
    """Spotify artist reference (trimmed — not the full Artist object)."""

    model_config = ConfigDict(extra="ignore")

    external_urls: ExternalUrls | None = None
    href: str | None = None
    id: str
    name: str
    type: str
    uri: str

    @field_validator("id", mode="after")
    @classmethod
    def _id_must_be_synthetic(cls, v: str) -> str:
        _assert_synthetic_id(v, "artist.id")
        return v

    @field_validator("href", mode="after")
    @classmethod
    def _href_must_be_invalid(cls, v: str | None) -> str | None:
        if v is not None:
            _assert_invalid_domain(v, "artist.href")
        return v


class LinkedFrom(BaseModel):
    """Spotify LinkedFrom object (track relinking)."""

    model_config = ConfigDict(extra="ignore")

    external_urls: ExternalUrls | None = None
    href: str | None = None
    id: str | None = None
    type: str | None = None
    uri: str | None = None

    @field_validator("id", mode="after")
    @classmethod
    def _id_must_be_synthetic(cls, v: str | None) -> str | None:
        if v is not None:
            _assert_synthetic_id(v, "linked_from.id")
        return v


class Album(BaseModel):
    """Spotify Album object (simplified — tracks the V1 stored fields)."""

    model_config = ConfigDict(extra="ignore")

    album_type: str
    total_tracks: int
    available_markets: list[str] | None = None
    external_urls: ExternalUrls | None = None
    href: str | None = None
    id: str
    images: list[Image] | None = None
    name: str
    release_date: str
    release_date_precision: str
    restrictions: Restrictions | None = None
    type: str
    uri: str
    artists: list[ArtistRef] | None = None

    @field_validator("id", mode="after")
    @classmethod
    def _id_must_be_synthetic(cls, v: str) -> str:
        _assert_synthetic_id(v, "album.id")
        return v

    @field_validator("href", mode="after")
    @classmethod
    def _href_must_be_invalid(cls, v: str | None) -> str | None:
        if v is not None:
            _assert_invalid_domain(v, "album.href")
        return v


# ---------------------------------------------------------------------------
# SpotifyTrack (extra="ignore")
# ---------------------------------------------------------------------------

class SpotifyTrack(BaseModel):
    """Spotify Track object (V1 stored shape — §4.1).

    extra="ignore" so that future provider-added fields do not break validation.
    Synthetic-identity invariants are enforced here.
    """

    model_config = ConfigDict(extra="ignore")

    album: Album | None = None
    artists: list[ArtistRef] | None = None
    available_markets: list[str] | None = None
    disc_number: int | None = None
    duration_ms: int
    explicit: bool
    external_ids: ExternalIds | None = None
    external_urls: ExternalUrls | None = None
    href: str | None = None
    id: str
    is_local: bool
    is_playable: bool | None = None
    linked_from: LinkedFrom | None = None
    name: str
    popularity: int = Field(ge=0, le=100)
    preview_url: str | None = None
    restrictions: Restrictions | None = None
    track_number: int
    type: str
    uri: str

    @field_validator("id", mode="after")
    @classmethod
    def _id_must_be_synthetic(cls, v: str) -> str:
        _assert_synthetic_id(v, "track.id")
        return v

    @field_validator("href", mode="after")
    @classmethod
    def _href_must_be_invalid(cls, v: str | None) -> str | None:
        if v is not None:
            _assert_invalid_domain(v, "track.href")
        return v

    @field_validator("preview_url", mode="after")
    @classmethod
    def _preview_url_must_be_invalid(cls, v: str | None) -> str | None:
        if v is not None:
            _assert_invalid_domain(v, "track.preview_url")
        return v

    @field_validator("duration_ms", mode="after")
    @classmethod
    def _duration_must_be_positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError(f"track.duration_ms must be positive, got {v}")
        return v


# ---------------------------------------------------------------------------
# SpotifyAudioFeatures (extra="ignore", 18 fields, range invariants)
# ---------------------------------------------------------------------------

_ZERO_ONE_FIELDS = {
    "acousticness", "danceability", "energy", "instrumentalness",
    "liveness", "speechiness", "valence",
}


class SpotifyAudioFeatures(BaseModel):
    """Spotify Audio Features object (§5.1, 18 fields).

    extra="ignore" per spec D3 (lenient inside Spotify objects).
    Range invariants per §5.3.
    """

    model_config = ConfigDict(extra="ignore")

    acousticness: float
    analysis_url: str | None = None
    danceability: float
    duration_ms: int
    energy: float
    id: str
    instrumentalness: float
    key: int
    liveness: float
    loudness: float
    mode: int
    speechiness: float
    tempo: float
    time_signature: int
    track_href: str | None = None
    type: str
    uri: str
    valence: float

    # [0,1] range validators
    @field_validator("acousticness", "danceability", "energy", "instrumentalness",
                     "liveness", "speechiness", "valence", mode="after")
    @classmethod
    def _must_be_in_zero_one(cls, v: float, info: Any) -> float:
        if not math.isfinite(v):
            raise ValueError(f"{info.field_name} must be finite, got {v}")
        if not (0.0 <= v <= 1.0):
            raise ValueError(
                f"{info.field_name} must be in [0, 1], got {v}"
            )
        return v

    @field_validator("key", mode="after")
    @classmethod
    def _key_valid(cls, v: int) -> int:
        if v not in range(-1, 12):  # -1 or 0..11
            raise ValueError(f"key must be -1 or 0..11, got {v}")
        return v

    @field_validator("mode", mode="after")
    @classmethod
    def _mode_valid(cls, v: int) -> int:
        if v not in (0, 1):
            raise ValueError(f"mode must be 0 or 1, got {v}")
        return v

    @field_validator("tempo", mode="after")
    @classmethod
    def _tempo_positive(cls, v: float) -> float:
        if not math.isfinite(v) or v <= 0:
            raise ValueError(f"tempo must be finite and > 0, got {v}")
        return v

    @field_validator("loudness", mode="after")
    @classmethod
    def _loudness_finite(cls, v: float) -> float:
        if not math.isfinite(v):
            raise ValueError(f"loudness must be finite, got {v}")
        return v

    @field_validator("time_signature", mode="after")
    @classmethod
    def _time_signature_valid(cls, v: int) -> int:
        if v not in range(3, 8):  # 3..7
            raise ValueError(f"time_signature must be 3..7, got {v}")
        return v

    @field_validator("type", mode="after")
    @classmethod
    def _type_must_be_audio_features(cls, v: str) -> str:
        if v != "audio_features":
            raise ValueError(f"type must be 'audio_features', got '{v}'")
        return v

    @field_validator("id", mode="after")
    @classmethod
    def _id_must_be_synthetic(cls, v: str) -> str:
        _assert_synthetic_id(v, "audio_features.id")
        return v

    @field_validator("analysis_url", mode="after")
    @classmethod
    def _analysis_url_must_be_invalid(cls, v: str | None) -> str | None:
        if v is not None:
            _assert_invalid_domain(v, "audio_features.analysis_url")
        return v

    @field_validator("track_href", mode="after")
    @classmethod
    def _track_href_must_be_invalid(cls, v: str | None) -> str | None:
        if v is not None:
            _assert_invalid_domain(v, "audio_features.track_href")
        return v

    @field_validator("duration_ms", mode="after")
    @classmethod
    def _duration_must_be_positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError(f"audio_features.duration_ms must be positive, got {v}")
        return v


# ---------------------------------------------------------------------------
# SimulationFlags (extra="forbid")
# ---------------------------------------------------------------------------

class SimulationFlags(BaseModel):
    """Simulator availability flags.

    extra="forbid" — only the two gate fields are allowed; no extra keys.
    Values are Literal[0, 1] only (no other integers, not booleans).
    Both default to 1 per §6.
    """

    model_config = ConfigDict(extra="forbid")

    humming_karaoke_available: Literal[0, 1] = 1
    full_karaoke_available: Literal[0, 1] = 1


# ---------------------------------------------------------------------------
# Song wrapper (extra="forbid", cross-object + synthetic-identity validators)
# ---------------------------------------------------------------------------

class Song(BaseModel):
    """Top-level song wrapper.

    Exactly three namespaces: spotify_track, spotify_audio_features, simulation_flags.
    extra="forbid" — unknown top-level namespaces are rejected (namespace-strict).

    Cross-object identity (model_validator):
    - track.id == audio_features.id
    - track.uri == audio_features.uri
    - track.duration_ms == audio_features.duration_ms
    """

    model_config = ConfigDict(extra="forbid")

    spotify_track: SpotifyTrack
    spotify_audio_features: SpotifyAudioFeatures
    simulation_flags: SimulationFlags = Field(default_factory=SimulationFlags)

    @model_validator(mode="after")
    def _cross_object_identity(self) -> "Song":
        """Enforce cross-object identity between track and audio_features."""
        track = self.spotify_track
        af = self.spotify_audio_features

        if track.id != af.id:
            raise ValueError(
                f"Cross-object identity mismatch: track.id='{track.id}' "
                f"!= audio_features.id='{af.id}'"
            )
        if track.uri != af.uri:
            raise ValueError(
                f"Cross-object identity mismatch: track.uri='{track.uri}' "
                f"!= audio_features.uri='{af.uri}'"
            )
        if track.duration_ms != af.duration_ms:
            raise ValueError(
                f"Cross-object identity mismatch: track.duration_ms={track.duration_ms} "
                f"!= audio_features.duration_ms={af.duration_ms}"
            )
        return self
