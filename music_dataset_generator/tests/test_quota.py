"""Quota checks over a frozen catalog (§10.3–§10.4)."""
from __future__ import annotations

from mdg.coverage.quota import compute_quota_checks


def _song(track_id, artist_id, album_id, *, release="2019-01-01", explicit=False,
          key=5, ts=4, duration_ms=210_000, is_playable=True):
    track = {
        "id": track_id, "duration_ms": duration_ms, "explicit": explicit,
        "is_playable": is_playable,
        "artists": [{"id": artist_id}],
        "album": {"id": album_id, "release_date": release},
    }
    return {"spotify_track": track,
            "spotify_audio_features": {"key": key, "time_signature": ts}}


def test_all_quotas_met():
    catalog = []
    for i in range(36):  # 12 artists × 3 tracks, 12 albums
        catalog.append(_song(f"synthetic-track-{i:04d}", f"synthetic-artist-{i // 3:04d}",
                             f"synthetic-album-{i // 3:04d}",
                             release=["1998", "2008", "2020"][i % 3] + "-01-01",
                             explicit=(i < 6), key=(-1 if i == 0 else 5),
                             ts=[3, 4, 5][i % 3],
                             duration_ms=[150_000, 240_000, 320_000][i % 3],
                             is_playable=(i >= 4)))  # 4 negatives
    checks = compute_quota_checks(catalog, {})
    assert all(checks.values()), checks


def test_missing_explicit_fails():
    catalog = [_song(f"synthetic-track-{i:04d}", f"synthetic-artist-{i:04d}",
                     f"synthetic-album-{i:04d}", explicit=False) for i in range(12)]
    checks = compute_quota_checks(catalog, {})
    assert checks["min_explicit"] is False


def test_missing_era_spread_fails():
    catalog = [_song(f"synthetic-track-{i:04d}", f"synthetic-artist-{i:04d}",
                     f"synthetic-album-{i:04d}", release="2020-01-01") for i in range(12)]
    checks = compute_quota_checks(catalog, {})
    assert checks["min_eras"] is False  # all one era


def test_time_signature_spread_needs_third_value():
    catalog = [_song(f"synthetic-track-{i:04d}", f"synthetic-artist-{i:04d}",
                     f"synthetic-album-{i:04d}", ts=(3 if i % 2 else 4)) for i in range(12)]
    checks = compute_quota_checks(catalog, {})
    assert checks["time_signature_spread"] is False  # only 3 and 4, no third value
