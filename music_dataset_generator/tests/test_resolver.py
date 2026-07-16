"""T035 [US2] — S2b ISRC resolver tests (MusicBrainz + Deezer reconciled).

The resolver turns a `(title, artist, year)` identity into a **deduped, ordered
candidate-ISRC list**, original-release-first. Year is a ±1 match used to prefer the
original studio release over remasters. No ISRC from either source →
`song_not_found_in_sources` (R2).
"""
from __future__ import annotations

import pytest

from mdg.errors import ErrorCode, MdgMissSignal
from mdg.sources.resolver import ISRCResolver


class FakeMB:
    def __init__(self, recordings):
        self._recordings = recordings

    def recordings_by_name(self, title, artist, year=None):
        return self._recordings


class FakeDZ:
    def __init__(self, isrcs):
        self._isrcs = isrcs

    def isrcs_for(self, title, artist, year=None):
        return self._isrcs


def test_reconcile_dedupe_and_order_original_first() -> None:
    mb = FakeMB([
        {"isrcs": ["ORIG2019"], "first_release_date": "2019-06-01"},
        {"isrcs": ["REMASTER2021"], "first_release_date": "2021-03-01"},
    ])
    dz = FakeDZ([{"isrc": "ORIG2019", "release_date": "2019-06-01"}])  # dup of MB original
    resolver = ISRCResolver(mb, dz)
    isrcs = resolver.resolve("Night Runner", "Real Band", 2019)
    assert isrcs == ["ORIG2019", "REMASTER2021"]  # deduped, original-release-first


def test_year_match_prefers_original() -> None:
    mb = FakeMB([
        {"isrcs": ["REMASTER2021"], "first_release_date": "2021-03-01"},
        {"isrcs": ["ORIG2019"], "first_release_date": "2019-06-01"},
    ])
    dz = FakeDZ([])
    resolver = ISRCResolver(mb, dz)
    isrcs = resolver.resolve("Night Runner", "Real Band", 2019)
    # 2019 is within ±1 of requested year -> ranked ahead of 2021 remaster.
    assert isrcs[0] == "ORIG2019"


def test_no_isrc_raises_song_not_found() -> None:
    resolver = ISRCResolver(FakeMB([]), FakeDZ([]))
    with pytest.raises(MdgMissSignal) as exc:
        resolver.resolve("Ghost Song", "Nobody", 1990)
    assert exc.value.code == ErrorCode.song_not_found_in_sources


def test_deezer_only_source_works() -> None:
    resolver = ISRCResolver(FakeMB([]), FakeDZ([{"isrc": "DZONLY", "release_date": "2020-01-01"}]))
    assert resolver.resolve("X", "Y", 2020) == ["DZONLY"]


def test_all_candidate_isrcs_deduped() -> None:
    mb = FakeMB([{"isrcs": ["A", "B", "A"], "first_release_date": "2018-01-01"}])
    dz = FakeDZ([{"isrc": "B", "release_date": "2018-01-01"}])
    resolver = ISRCResolver(mb, dz)
    isrcs = resolver.resolve("X", "Y", 2018)
    assert sorted(isrcs) == ["A", "B"]
    assert len(isrcs) == 2  # no duplicates
