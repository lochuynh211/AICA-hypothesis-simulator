"""T032 [US2] — source-client parse tests (recorded HTTP fixtures, no network).

Each client accepts an injected ``session`` (anything with ``.get(...) -> Response``) so
deterministic tests feed recorded response bodies without touching the network.
- Soundcharts ``by-isrc``: parse audio / languageCode / duration (seconds) / genres.
- MusicBrainz: parse ISRCs + first-release-date per recording.
- Deezer: parse ISRC via search → track.
"""
from __future__ import annotations

import pytest

from mdg.errors import ErrorCode, MdgFatalError
from mdg.sources.deezer import DeezerClient
from mdg.sources.musicbrainz import MusicBrainzClient
from mdg.sources.soundcharts import SoundchartsClient


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload


class FakeSession:
    """Records requests and returns queued responses in order."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def get(self, url, *, params=None, headers=None, timeout=None):
        self.calls.append({"method": "GET", "url": url, "params": params, "headers": headers})
        return self._responses.pop(0)

    def post(self, url, *, data=None, headers=None, timeout=None):
        self.calls.append({"method": "POST", "url": url, "data": data, "headers": headers})
        return self._responses.pop(0)


# ---------------------------------------------------------------------------
# Soundcharts by-isrc
# ---------------------------------------------------------------------------

_SC_BY_ISRC = {
    "object": {
        "name": "Night Runner",
        "isrc": {"value": "JPXX01900123", "countryCode": "JP"},
        "duration": 218,
        "explicit": False,
        "releaseDate": "2019-06-01",
        "languageCode": "ja",
        "genres": [{"root": "j-pop", "sub": ["j-rock"]}],
        "artists": [{"uuid": "u1", "name": "Real Band"}],
        "audio": {
            "acousticness": 0.03, "danceability": 0.62, "energy": 0.86,
            "instrumentalness": 0.0, "key": 7, "liveness": 0.11, "loudness": -4.2,
            "mode": 1, "speechiness": 0.05, "tempo": 148.0, "timeSignature": 4,
            "valence": 0.55,
        },
    }
}


def test_soundcharts_by_isrc_parse() -> None:
    session = FakeSession([FakeResponse(_SC_BY_ISRC)])
    client = SoundchartsClient(app_id="id", api_key="key", session=session)
    song = client.by_isrc("JPXX01900123")
    assert song["name"] == "Night Runner"
    assert song["languageCode"] == "ja"
    assert song["duration"] == 218  # seconds
    assert song["audio"]["energy"] == 0.86
    assert song["genres"][0]["sub"] == ["j-rock"]
    assert client.quota_used == 1


def test_soundcharts_by_isrc_404_returns_none() -> None:
    session = FakeSession([FakeResponse({"errors": ["not found"]}, status_code=404)])
    client = SoundchartsClient(app_id="id", api_key="key", session=session)
    assert client.by_isrc("XX0000000000") is None
    assert client.quota_used == 1


def test_soundcharts_sends_auth_headers() -> None:
    session = FakeSession([FakeResponse(_SC_BY_ISRC)])
    client = SoundchartsClient(app_id="APPID", api_key="APIKEY", session=session)
    client.by_isrc("JPXX01900123")
    headers = session.calls[0]["headers"]
    assert headers["x-app-id"] == "APPID"
    assert headers["x-api-key"] == "APIKEY"


def test_soundcharts_search_is_strategy_unavailable() -> None:
    client = SoundchartsClient(app_id="id", api_key="key", session=FakeSession([]))
    with pytest.raises(MdgFatalError) as exc:
        client.search(query="anything")
    assert exc.value.code == ErrorCode.strategy_unavailable


# ---------------------------------------------------------------------------
# Soundcharts OAuth client-credentials
# ---------------------------------------------------------------------------

_TOKEN_RESPONSE = {"access_token": "tok-abc", "token_type": "bearer", "expires_in": 900}


def test_oauth_fetches_token_then_sends_bearer() -> None:
    session = FakeSession([FakeResponse(_TOKEN_RESPONSE), FakeResponse(_SC_BY_ISRC)])
    client = SoundchartsClient(client_id="cid", client_secret="secret", session=session)
    song = client.by_isrc("JPXX01900123")
    assert song["name"] == "Night Runner"
    # first call is the token POST, second is the Bearer GET
    assert session.calls[0]["method"] == "POST"
    assert "oauth/token" in session.calls[0]["url"]
    assert session.calls[1]["headers"]["Authorization"] == "Bearer tok-abc"


def test_oauth_token_is_cached_across_calls() -> None:
    session = FakeSession([FakeResponse(_TOKEN_RESPONSE),
                           FakeResponse(_SC_BY_ISRC), FakeResponse(_SC_BY_ISRC)])
    client = SoundchartsClient(client_id="cid", client_secret="secret", session=session)
    client.by_isrc("JPXX01900123")
    client.by_isrc("JPXX01900123")
    posts = [c for c in session.calls if c["method"] == "POST"]
    assert len(posts) == 1  # token fetched once, reused


def test_oauth_token_failure_raises() -> None:
    session = FakeSession([FakeResponse({"error": "invalid_client"}, status_code=401)])
    client = SoundchartsClient(client_id="cid", client_secret="bad", session=session)
    with pytest.raises(MdgFatalError) as exc:
        client.by_isrc("JPXX01900123")
    assert exc.value.code == ErrorCode.soundcharts_harvest_failed


def test_requires_some_credentials() -> None:
    with pytest.raises(ValueError):
        SoundchartsClient(session=FakeSession([]))


# ---------------------------------------------------------------------------
# MusicBrainz
# ---------------------------------------------------------------------------

_MB_RECORDINGS = {
    "recordings": [
        {
            "title": "Night Runner",
            "first-release-date": "2019-06-01",
            "isrcs": ["JPXX01900123"],
            "artist-credit": [{"name": "Real Band"}],
        },
        {
            "title": "Night Runner",
            "first-release-date": "2021-03-01",  # a remaster
            "isrcs": ["JPXX02100999"],
            "artist-credit": [{"name": "Real Band"}],
        },
    ]
}


def test_musicbrainz_parse_recordings() -> None:
    session = FakeSession([FakeResponse(_MB_RECORDINGS)])
    client = MusicBrainzClient(session=session, user_agent="mdg-test/1.0")
    recs = client.recordings_by_name("Night Runner", "Real Band", 2019)
    isrcs = [i for r in recs for i in r["isrcs"]]
    assert "JPXX01900123" in isrcs
    # User-Agent header is required by MusicBrainz.
    assert "mdg-test/1.0" in session.calls[0]["headers"]["User-Agent"]


# ---------------------------------------------------------------------------
# Deezer
# ---------------------------------------------------------------------------

_DZ_SEARCH = {"data": [{"id": 555, "title": "Night Runner", "artist": {"name": "Real Band"}}]}
_DZ_TRACK = {"id": 555, "title": "Night Runner", "isrc": "JPXX01900123",
             "release_date": "2019-06-01"}


def test_deezer_parse_isrc_via_track() -> None:
    session = FakeSession([FakeResponse(_DZ_SEARCH), FakeResponse(_DZ_TRACK)])
    client = DeezerClient(session=session)
    result = client.isrcs_for("Night Runner", "Real Band", 2019)
    assert result[0]["isrc"] == "JPXX01900123"
    assert len(session.calls) == 2  # search then track
