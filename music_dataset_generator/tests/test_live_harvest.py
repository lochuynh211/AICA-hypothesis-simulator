"""T041 [US2] — live end-to-end harvest (@live; skipped without --run-live + creds).

Exercises name→resolve→by-isrc on a tiny real cell against the real Soundcharts /
MusicBrainz / Deezer APIs. Deselected by default (see conftest --run-live gate); requires
SOUNDCHARTS_APP_ID / SOUNDCHARTS_API_KEY in the environment.
"""
from __future__ import annotations

import pytest

from mdg import config
from mdg.harvest.by_isrc import harvest_by_isrc
from mdg.sources.deezer import DeezerClient
from mdg.sources.musicbrainz import MusicBrainzClient
from mdg.sources.resolver import ISRCResolver
from mdg.sources.soundcharts import SoundchartsClient

pytestmark = pytest.mark.live


def _client() -> SoundchartsClient:
    creds = config.soundcharts_credentials()
    if creds is None:
        pytest.skip("SOUNDCHARTS_APP_ID / SOUNDCHARTS_API_KEY not set")
    return SoundchartsClient(app_id=creds[0], api_key=creds[1])


def test_live_resolve_and_harvest_one_song() -> None:
    resolver = ISRCResolver(MusicBrainzClient(), DeezerClient())
    # A widely-available real song for a smoke check of the whole chain.
    isrcs = resolver.resolve("Pretender", "Official HIGE DANdism", 2019)
    assert isrcs, "resolver returned no candidate ISRCs"
    outcome = harvest_by_isrc(_client(), isrcs, target_language=None)
    assert outcome.status in ("accepted", "isrc_not_in_soundcharts", "audio_unavailable")
    if outcome.status == "accepted":
        assert outcome.song["audio"]["energy"] is not None
