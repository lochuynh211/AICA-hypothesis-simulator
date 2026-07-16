"""Quota checks over a frozen catalog (data-spec §10.3–§10.4, §17.6).

`compute_quota_checks(catalog, quotas)` returns a `{check_name: passed}` map for the
§10.3/§10.4 quotas (artists, albums, eras, explicit, negatives, key:-1, duration and
time-signature spread). It is fed to `validate_coverage`'s `extra_checks` on the enforced
freeze path so a demonstration freeze fails loudly on an unmet quota — never silently.
"""
from __future__ import annotations

from collections import Counter
from typing import Any

from mdg.binner import era_bucket


def _duration_band(duration_ms: int) -> str:
    seconds = duration_ms / 1000.0
    if seconds < 180:
        return "short"
    if seconds <= 300:
        return "medium"
    return "long"


def compute_quota_checks(catalog: list[dict], quotas: dict[str, Any]) -> dict[str, bool]:
    """Return per-quota pass/fail booleans computed from the frozen catalog."""
    artist_ids: set[str] = set()
    artist_track_counts: Counter = Counter()
    album_ids: set[str] = set()
    eras: set[str] = set()
    duration_bands: set[str] = set()
    time_signatures: set[int] = set()
    explicit = 0
    key_minus_one = 0
    negatives = 0

    for song in catalog:
        track = song["spotify_track"]
        af = song["spotify_audio_features"]
        for artist in track.get("artists") or []:
            artist_ids.add(artist["id"])
            artist_track_counts[artist["id"]] += 1
        album = track.get("album") or {}
        if album.get("id"):
            album_ids.add(album["id"])
            eras.add(era_bucket(album.get("release_date")))
        duration_bands.add(_duration_band(track["duration_ms"]))
        time_signatures.add(af["time_signature"])
        if track.get("explicit"):
            explicit += 1
        if af.get("key") == -1:
            key_minus_one += 1
        if track.get("is_playable") is False or track.get("restrictions"):
            negatives += 1

    ts_spread = quotas.get("time_signature_spread", {})
    ts_required = set(ts_spread.get("required_values", [3, 4]))
    ts_others = time_signatures - ts_required

    tracks_per_artist = quotas.get("tracks_per_artist", 3)
    artists_at_depth = sum(1 for n in artist_track_counts.values()
                           if n >= tracks_per_artist)
    return {
        "artists_count": len(artist_ids) >= quotas.get("artists_count", 12),
        "tracks_per_artist": artists_at_depth >= quotas.get("artists_count", 12),
        "min_albums": len(album_ids) >= quotas.get("min_albums", 12),
        "min_eras": len(eras) >= quotas.get("min_eras", 3),
        "min_explicit": explicit >= quotas.get("min_explicit", 6),
        "min_negatives_outside_36": negatives >= quotas.get("min_negatives_outside_36", 4),
        "min_key_minus_one": key_minus_one >= quotas.get("min_key_minus_one", 1),
        "duration_spread": {"short", "medium", "long"}.issubset(duration_bands),
        "time_signature_spread": ts_required.issubset(time_signatures)
        and len(ts_others) >= ts_spread.get("min_others", 1),
    }
