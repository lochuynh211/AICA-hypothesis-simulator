"""MusicBrainz client — recordings (with ISRCs + release dates) by name (design §4.5b).

MusicBrainz allows multiple ISRCs per recording and carries first-release-date, which the
resolver (S2b) uses to order candidates original-release-first. MusicBrainz requires a
descriptive User-Agent and rate-limits to ~1 req/s; the client sends the User-Agent and
sleeps between calls unless a `sleep` hook is injected (tests pass a no-op).
"""
from __future__ import annotations

import time
from typing import Any, Callable

from mdg.sources.http import Session, default_session

_BASE = "https://musicbrainz.org/ws/2"
_DEFAULT_UA = "aica-mdg/1.0 (local internal review tool)"


class MusicBrainzClient:
    def __init__(
        self,
        *,
        session: Session | None = None,
        user_agent: str = _DEFAULT_UA,
        sleep: Callable[[float], None] = time.sleep,
        min_interval_s: float = 1.0,
    ) -> None:
        self._session = session
        self._ua = user_agent
        self._sleep = sleep
        self._min_interval = min_interval_s
        self._last_call = 0.0

    def _sess(self) -> Session:
        if self._session is None:
            self._session = default_session()
        return self._session

    def _throttle(self) -> None:
        # Sleep only the *remaining* gap since the last call, and never before the first
        # call — so a single-call test does not block for a full interval.
        if self._last_call > 0.0:
            wait = self._min_interval - (time.monotonic() - self._last_call)
            if wait > 0:
                self._sleep(wait)
        self._last_call = time.monotonic()

    def recordings_by_name(
        self, title: str, artist: str, year: int | None = None
    ) -> list[dict]:
        """Return recordings matching (title, artist), each as {title, isrcs, first_release_date}.

        Year is advisory (the resolver applies a ±1 match); it is not part of the query so
        re-releases are all returned for reconciliation.
        """
        self._throttle()
        query = f'recording:"{title}" AND artist:"{artist}"'
        resp = self._sess().get(
            f"{_BASE}/recording",
            params={"query": query, "fmt": "json", "inc": "isrcs"},
            headers={"User-Agent": self._ua},
            timeout=30,
        )
        if resp.status_code != 200:
            return []
        data = resp.json() or {}
        out: list[dict] = []
        for rec in data.get("recordings", []):
            isrcs = list(rec.get("isrcs") or [])
            if not isrcs:
                continue
            out.append({
                "title": rec.get("title"),
                "isrcs": isrcs,
                "first_release_date": rec.get("first-release-date"),
                "artist": _first_artist(rec),
            })
        return out


def _first_artist(rec: dict) -> Any:
    credit = rec.get("artist-credit") or []
    if credit and isinstance(credit[0], dict):
        return credit[0].get("name")
    return None
