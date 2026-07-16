"""S4 — Mapper: real Soundcharts payload → frozen `Song` dict (design §4.7).

`CatalogMapper` maps a sequence of raw `by-isrc` payloads into `Song` dicts:

- **Real kept:** song name, artist names, verbatim audio values, real ISRC (D1/D2/D6).
- **Synthetic identity:** track/artist/album IDs become `synthetic-…`, all URLs use a
  `.invalid` host. `timeSignature`→`time_signature`; `duration` (seconds) →
  `duration_ms`.
- **Synthesized fields** Soundcharts lacks — album wrapper (from `releaseDate`),
  `available_markets`, `popularity`, `track_number`/`disc_number`, and negative-fixture
  `restrictions`/`is_playable:false` — are derived **deterministically** from the run
  seed + the song's real ISRC (FR-029), so the same cache + seed reproduces byte-for-byte.

IDs are allocated in call order (the transform feeds payloads sorted by ISRC), so track
IDs are stable; artist IDs dedupe by real artist name across the catalog.

No score/label/rank/target field is ever written (firewall, catalog stays label-free).
"""
from __future__ import annotations

import hashlib
import random
from typing import Any

_API = "https://api.synthetic.invalid"
_OPEN = "https://open.synthetic.invalid"

# Audio fields copied verbatim from the real payload (timeSignature handled separately).
_AUDIO_VERBATIM = (
    "acousticness", "danceability", "energy", "instrumentalness", "key",
    "liveness", "loudness", "mode", "speechiness", "tempo", "valence",
)

# Deterministic market pools per language (synthesized; not from Soundcharts).
_MARKETS_BY_LANGUAGE = {
    "ja": ["JP"],
    "en": ["US", "GB"],
}
_DEFAULT_MARKETS = ["JP", "US"]


def _stable_rng(seed: int, isrc: str) -> random.Random:
    """A deterministic per-song PRNG seeded from (run seed, real ISRC).

    Uses sha256 (not the salted builtin hash()) so the seed is stable across processes.
    """
    digest = hashlib.sha256(f"{seed}:{isrc}".encode("utf-8")).hexdigest()
    return random.Random(int(digest[:16], 16))


class CatalogMapper:
    """Allocates synthetic identities and maps real payloads to `Song` dicts."""

    def __init__(self, seed: int) -> None:
        self.seed = seed
        self._track_seq = 0
        self._album_seq = 0
        self._artist_seq = 0
        self._artist_ids: dict[str, str] = {}  # real artist name -> synthetic-artist id

    # -- ID allocation ------------------------------------------------------

    def _next_track_id(self) -> str:
        self._track_seq += 1
        return f"synthetic-track-{self._track_seq:04d}"

    def _next_album_id(self) -> str:
        self._album_seq += 1
        return f"synthetic-album-{self._album_seq:04d}"

    def _artist_id_for(self, name: str) -> str:
        if name not in self._artist_ids:
            self._artist_seq += 1
            self._artist_ids[name] = f"synthetic-artist-{self._artist_seq:04d}"
        return self._artist_ids[name]

    # -- mapping ------------------------------------------------------------

    def _map_artists(self, payload: dict) -> list[dict]:
        artists = payload.get("artists") or payload.get("mainArtists") or []
        out: list[dict] = []
        for artist in artists:
            name = artist["name"]
            aid = self._artist_id_for(name)
            out.append({
                "id": aid,
                "name": name,  # real name kept
                "type": "artist",
                "uri": f"spotify:artist:{aid}",
                "href": f"{_API}/artists/{aid}",
                "external_urls": {"spotify": f"{_OPEN}/artist/{aid}"},
            })
        return out

    def map_song(self, payload: dict, *, negative_fixture: bool = False) -> dict[str, Any]:
        """Map one raw payload to a `Song` dict."""
        isrc = payload["isrc"]["value"]
        rng = _stable_rng(self.seed, isrc)

        track_id = self._next_track_id()
        album_id = self._next_album_id()
        uri = f"spotify:track:{track_id}"
        duration_ms = int(round(float(payload["duration"]) * 1000))
        language = payload.get("languageCode")
        release_date = payload.get("releaseDate") or "2000-01-01"

        artists = self._map_artists(payload)

        # Deterministic synthesized fields.
        popularity = rng.randint(0, 100)
        track_number = rng.randint(1, 12)
        markets = list(_MARKETS_BY_LANGUAGE.get(language, _DEFAULT_MARKETS))

        album = {
            "album_type": "single",
            "total_tracks": 1,
            "available_markets": markets,
            "external_urls": {"spotify": f"{_OPEN}/album/{album_id}"},
            "href": f"{_API}/albums/{album_id}",
            "id": album_id,
            "images": [{"url": f"{_API}/images/{album_id}.jpg", "height": 640, "width": 640}],
            "name": payload.get("name", ""),  # real song name reused as single title
            "release_date": release_date,
            "release_date_precision": "day",
            "type": "album",
            "uri": f"spotify:album:{album_id}",
            "artists": artists,
        }

        track: dict[str, Any] = {
            "album": album,
            "artists": artists,
            "available_markets": markets,
            "disc_number": 1,
            "duration_ms": duration_ms,
            "explicit": bool(payload.get("explicit", False)),
            "external_ids": {"isrc": isrc},  # real ISRC kept (D6)
            "external_urls": {"spotify": f"{_OPEN}/track/{track_id}"},
            "href": f"{_API}/tracks/{track_id}",
            "id": track_id,
            "is_local": False,
            "is_playable": not negative_fixture,
            "name": payload["name"],  # real name kept (D1)
            "popularity": popularity,
            "track_number": track_number,
            "type": "track",
            "uri": uri,
        }
        if negative_fixture:
            track["restrictions"] = {"reason": "market"}

        src_audio = payload["audio"]
        audio_features: dict[str, Any] = {
            "id": track_id,
            "uri": uri,
            "type": "audio_features",
            "duration_ms": duration_ms,
            "time_signature": int(src_audio["timeSignature"]),
            "analysis_url": f"{_API}/audio-analysis/{track_id}",
            "track_href": f"{_API}/tracks/{track_id}",
        }
        for field in _AUDIO_VERBATIM:
            audio_features[field] = src_audio[field]

        return {
            "spotify_track": track,
            "spotify_audio_features": audio_features,
            "simulation_flags": {
                "humming_karaoke_available": 1,
                "full_karaoke_available": 1,
            },
        }
