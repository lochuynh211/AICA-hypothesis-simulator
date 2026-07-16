"""T046 [US4] — Strategy A (`soundcharts_search`) front-half (design §4.2–4.5).

The front-half harvests a shortlist to the same cache+lineage boundary; a live
search-by-metric call raises `strategy_unavailable` (FR-009, off-subscription).
"""
from __future__ import annotations

import pytest

from mdg.errors import ErrorCode, MdgFatalError
from mdg.harvest.search import harvest_shortlist, search_candidates
from mdg.sources.soundcharts import SoundchartsClient


def _song(uuid="u1", lang="ja"):
    return {
        "uuid": uuid, "name": "Night Runner", "isrc": {"value": "JPXX01900123"},
        "duration": 218, "releaseDate": "2019-06-01", "languageCode": lang,
        "genres": [{"root": "j-pop", "sub": ["j-rock"]}],
        "artists": [{"uuid": "a1", "name": "Real Band"}],
        "audio": {
            "acousticness": 0.03, "danceability": 0.62, "energy": 0.86,
            "instrumentalness": 0.0, "key": 7, "liveness": 0.11, "loudness": -4.2,
            "mode": 1, "speechiness": 0.05, "tempo": 148.0, "timeSignature": 4,
            "valence": 0.55,
        },
    }


class FakeUUIDSession:
    """Serves by-uuid responses; a search call would be a real HTTP call it never makes."""

    def __init__(self, mapping):
        self._mapping = mapping

    def get(self, url, *, params=None, headers=None, timeout=None):
        class R:
            status_code = 200
            def __init__(self, payload):
                self._p = payload
            def json(self):
                return {"object": self._p}
        uuid = url.rstrip("/").split("/")[-1]
        return R(self._mapping[uuid])


def test_live_search_raises_strategy_unavailable() -> None:
    sc = SoundchartsClient(app_id="id", api_key="key", session=FakeUUIDSession({}))
    with pytest.raises(MdgFatalError) as exc:
        search_candidates(sc, seeds=["uptempo j-rock 2019"])
    assert exc.value.code == ErrorCode.strategy_unavailable


def test_harvest_shortlist_terminates_at_cache_boundary() -> None:
    sc = SoundchartsClient(
        app_id="id", api_key="key", session=FakeUUIDSession({"u1": _song("u1")})
    )
    outcomes = harvest_shortlist(sc, ["u1"], target_language="ja")
    assert outcomes[0].status == "accepted"
    assert outcomes[0].song["audio"]["energy"] == 0.86  # ready for cache + S3 binning
