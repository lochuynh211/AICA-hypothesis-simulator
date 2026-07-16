"""Soundcharts client — song metadata by ISRC / UUID (design §1.1, §4.5b).

`by_isrc`/`by_uuid` return the song object (the `{name, isrc, audio, languageCode, …}`
shape the cache stores) or ``None`` on 404. Other HTTP errors raise
`soundcharts_harvest_failed`. `search` (the off-subscription search-by-metric endpoint)
raises `strategy_unavailable` (design D9). Every metadata call increments `quota_used`
for the build report.

Credentials come from the environment only (never written anywhere): the caller passes
`app_id`/`api_key` obtained via `mdg.config.soundcharts_credentials()`.
"""
from __future__ import annotations

from typing import Any

from mdg.errors import ErrorCode, MdgFatalError
from mdg.sources.http import Session, default_session

_BASE = "https://customer.api.soundcharts.com"


class SoundchartsClient:
    def __init__(
        self,
        *,
        app_id: str,
        api_key: str,
        session: Session | None = None,
        base_url: str = _BASE,
    ) -> None:
        self._app_id = app_id
        self._api_key = api_key
        self._session = session
        self._base = base_url.rstrip("/")
        self.quota_used = 0

    # -- internals ----------------------------------------------------------

    @property
    def _headers(self) -> dict[str, str]:
        return {"x-app-id": self._app_id, "x-api-key": self._api_key}

    def _sess(self) -> Session:
        if self._session is None:
            self._session = default_session()
        return self._session

    @staticmethod
    def _unwrap(payload: Any) -> dict:
        """Return the song object from either an enveloped or bare response."""
        if isinstance(payload, dict) and "object" in payload:
            return payload["object"]
        return payload

    def _get_song(self, path: str) -> dict | None:
        self.quota_used += 1
        resp = self._sess().get(
            f"{self._base}{path}", headers=self._headers, timeout=30
        )
        if resp.status_code == 404:
            return None
        if resp.status_code != 200:
            raise MdgFatalError(
                ErrorCode.soundcharts_harvest_failed,
                f"GET {path} -> HTTP {resp.status_code}",
            )
        return self._unwrap(resp.json())

    # -- public API ---------------------------------------------------------

    def by_isrc(self, isrc: str) -> dict | None:
        """Fetch a song by ISRC (`/api/v2.25/song/by-isrc/{isrc}`)."""
        return self._get_song(f"/api/v2.25/song/by-isrc/{isrc}")

    def by_uuid(self, uuid: str) -> dict | None:
        """Fetch a song by Soundcharts UUID (`/api/v2.25/song/{uuid}`)."""
        return self._get_song(f"/api/v2.25/song/{uuid}")

    def search(self, *, query: str) -> Any:
        """The search-by-metric endpoint is unavailable on the current subscription."""
        raise MdgFatalError(
            ErrorCode.strategy_unavailable,
            "soundcharts_search (search-by-metric) is unavailable on this subscription; "
            "use candidate_source=isrc_resolved",
        )
