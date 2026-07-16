"""Soundcharts client — song metadata by ISRC / UUID (design §1.1, §4.5b).

Supports both Soundcharts auth schemes:
- **OAuth client-credentials** (recommended): Client ID + Secret → a short-lived Bearer
  token from ``account.soundcharts.com/oauth/token``, sent as ``Authorization: Bearer``.
  The token is cached and auto-refreshed before expiry.
- **Legacy API key**: ``x-app-id`` + ``x-api-key`` headers (also the public sandbox).

`by_isrc`/`by_uuid` return the song object (the `{name, isrc, audio, languageCode, …}`
shape the cache stores) or ``None`` on 404. Other HTTP errors raise
`soundcharts_harvest_failed`. `search` (the off-subscription search-by-metric endpoint)
raises `strategy_unavailable` (design D9). Every metadata call increments `quota_used`.

Credentials come from the environment only (never written anywhere) — the caller obtains
them via `mdg.config.soundcharts_auth()`.
"""
from __future__ import annotations

import base64
import time
from typing import Any

from mdg.errors import ErrorCode, MdgFatalError
from mdg.sources.http import Session, default_session

_BASE = "https://customer.api.soundcharts.com"
_TOKEN_URL = "https://account.soundcharts.com/oauth/token"
_TOKEN_SAFETY_S = 30  # refresh this many seconds before the token actually expires


class SoundchartsClient:
    def __init__(
        self,
        *,
        app_id: str | None = None,
        api_key: str | None = None,
        client_id: str | None = None,
        client_secret: str | None = None,
        team_id: str | None = None,
        session: Session | None = None,
        base_url: str = _BASE,
        token_url: str = _TOKEN_URL,
    ) -> None:
        if client_id and client_secret:
            self._mode = "oauth"
            self._client_id = client_id
            self._client_secret = client_secret
        elif app_id and api_key:
            self._mode = "legacy"
            self._app_id = app_id
            self._api_key = api_key
        else:
            raise ValueError(
                "SoundchartsClient needs either client_id+client_secret (oauth) or "
                "app_id+api_key (legacy)"
            )
        self._team_id = team_id
        self._session = session
        self._base = base_url.rstrip("/")
        self._token_url = token_url
        self._token: str | None = None
        self._token_expiry = 0.0  # monotonic seconds
        self.quota_used = 0

    # -- auth ---------------------------------------------------------------

    def _ensure_token(self) -> str:
        """Return a valid Bearer token, fetching/refreshing via client-credentials."""
        if self._token and time.monotonic() < self._token_expiry - _TOKEN_SAFETY_S:
            return self._token
        basic = base64.b64encode(
            f"{self._client_id}:{self._client_secret}".encode()
        ).decode()
        body = {"grant_type": "client_credentials"}
        if self._team_id:
            body["team_id"] = self._team_id
        resp = self._sess().post(
            self._token_url,
            headers={"Content-Type": "application/x-www-form-urlencoded",
                     "Authorization": f"Basic {basic}"},
            data=body,
            timeout=30,
        )
        if resp.status_code != 200:
            raise MdgFatalError(
                ErrorCode.soundcharts_harvest_failed,
                f"OAuth token request failed: HTTP {resp.status_code}",
            )
        payload = resp.json()
        self._token = payload["access_token"]
        self._token_expiry = time.monotonic() + float(payload.get("expires_in", 900))
        return self._token

    @property
    def _headers(self) -> dict[str, str]:
        if self._mode == "oauth":
            return {"Authorization": f"Bearer {self._ensure_token()}"}
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
