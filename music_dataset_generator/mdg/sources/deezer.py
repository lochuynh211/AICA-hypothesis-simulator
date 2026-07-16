"""Deezer public-API client — ISRC per track by name (design §4.5b).

Deezer's public API needs no credentials. A search returns tracks; the per-track endpoint
carries the ISRC. `isrcs_for` searches, then fetches each matched track (bounded) and
returns `[{isrc, release_date, title}]` for the resolver to reconcile with MusicBrainz.
"""
from __future__ import annotations

from typing import Any

from mdg.sources.http import Session, default_session

_BASE = "https://api.deezer.com"
_MAX_TRACKS = 3  # bound per-name track lookups


class DeezerClient:
    def __init__(self, *, session: Session | None = None, max_tracks: int = _MAX_TRACKS) -> None:
        self._session = session
        self._max_tracks = max_tracks

    def _sess(self) -> Session:
        if self._session is None:
            self._session = default_session()
        return self._session

    def isrcs_for(self, title: str, artist: str, year: int | None = None) -> list[dict]:
        """Return `[{isrc, release_date, title}]` for the named track (best-effort)."""
        resp = self._sess().get(
            f"{_BASE}/search",
            params={"q": f'artist:"{artist}" track:"{title}"'},
            timeout=30,
        )
        if resp.status_code != 200:
            return []
        hits = (resp.json() or {}).get("data", [])
        out: list[dict] = []
        for hit in hits[: self._max_tracks]:
            track_id = hit.get("id")
            if track_id is None:
                continue
            track = self._track(track_id)
            isrc = (track or {}).get("isrc")
            if isrc:
                out.append({
                    "isrc": isrc,
                    "release_date": track.get("release_date"),
                    "title": track.get("title"),
                })
        return out

    def _track(self, track_id: Any) -> dict:
        resp = self._sess().get(f"{_BASE}/track/{track_id}", timeout=30)
        if resp.status_code != 200:
            return {}
        return resp.json() or {}
