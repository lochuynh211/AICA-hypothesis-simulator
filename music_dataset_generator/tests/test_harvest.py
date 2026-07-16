"""T037 [US2] — S2c by-ISRC harvest gate tests.

Walk the candidate-ISRC list calling `by-isrc`, applying the deterministic gates in order
(design §4.5b):
- 404 (`isrc_not_in_soundcharts`) → advance to the next candidate;
- null/partial `audio` (`audio_unavailable`) → advance to the next candidate;
- real `languageCode` ≠ target (`language_mismatch`) → discard the song (never relabel);
- populated audio + matching language → accept and store to cache + lineage.
"""
from __future__ import annotations

import json

from mdg.harvest.by_isrc import harvest_by_isrc
from mdg.harvest.cache import (
    backfill_lineage_ids,
    load_cache_entry,
    load_lineage,
    store_accepted,
)


def _song(isrc="JPXX01900123", lang="ja", audio=True):
    payload = {
        "name": "Night Runner",
        "isrc": {"value": isrc},
        "duration": 218,
        "releaseDate": "2019-06-01",
        "languageCode": lang,
        "genres": [{"root": "j-pop", "sub": ["j-rock"]}],
        "artists": [{"uuid": "u1", "name": "Real Band"}],
    }
    if audio:
        payload["audio"] = {
            "acousticness": 0.03, "danceability": 0.62, "energy": 0.86,
            "instrumentalness": 0.0, "key": 7, "liveness": 0.11, "loudness": -4.2,
            "mode": 1, "speechiness": 0.05, "tempo": 148.0, "timeSignature": 4,
            "valence": 0.55,
        }
    else:
        payload["audio"] = None
    return payload


class FakeSC:
    def __init__(self, mapping):
        self._mapping = mapping  # isrc -> song dict or None
        self.calls = []

    def by_isrc(self, isrc):
        self.calls.append(isrc)
        return self._mapping.get(isrc)


def test_accepts_first_populated_matching_song() -> None:
    sc = FakeSC({"ORIG": _song(isrc="ORIG")})
    outcome = harvest_by_isrc(sc, ["ORIG"], target_language="ja")
    assert outcome.status == "accepted"
    assert outcome.isrc == "ORIG"
    assert outcome.song["audio"]["energy"] == 0.86


def test_advances_past_404_and_audio_unavailable() -> None:
    sc = FakeSC({
        "MISS": None,                       # 404 -> next
        "NOAUDIO": _song(isrc="NOAUDIO", audio=False),  # audio_unavailable -> next
        "GOOD": _song(isrc="GOOD"),         # accepted
    })
    outcome = harvest_by_isrc(sc, ["MISS", "NOAUDIO", "GOOD"], target_language="ja")
    assert outcome.status == "accepted"
    assert outcome.isrc == "GOOD"
    assert sc.calls == ["MISS", "NOAUDIO", "GOOD"]


def test_language_mismatch_discards_never_relabels() -> None:
    sc = FakeSC({"EN": _song(isrc="EN", lang="en")})
    outcome = harvest_by_isrc(sc, ["EN"], target_language="ja")
    assert outcome.status == "language_mismatch"
    assert outcome.song is None  # discarded, not relabeled


def test_all_candidates_404_is_isrc_not_in_soundcharts() -> None:
    sc = FakeSC({"A": None, "B": None})
    outcome = harvest_by_isrc(sc, ["A", "B"], target_language="ja")
    assert outcome.status == "isrc_not_in_soundcharts"
    assert outcome.song is None


def test_all_candidates_found_but_audio_missing_is_audio_unavailable() -> None:
    # Every candidate exists (no 404s) but has null audio → audio_unavailable, not
    # the isrc_not_in_soundcharts fallback (miss-code correctness).
    sc = FakeSC({"A": _song(isrc="A", audio=False), "B": _song(isrc="B", audio=False)})
    outcome = harvest_by_isrc(sc, ["A", "B"], target_language="ja")
    assert outcome.status == "audio_unavailable"
    assert outcome.song is None


def test_no_language_target_accepts_any_language() -> None:
    sc = FakeSC({"EN": _song(isrc="EN", lang="en")})
    outcome = harvest_by_isrc(sc, ["EN"], target_language=None)
    assert outcome.status == "accepted"


def test_store_accepted_writes_cache_and_lineage(tmp_path) -> None:
    song = _song(isrc="GOOD")
    cache_dir = tmp_path / "cache"
    lineage_path = tmp_path / "lineage.json"
    store_accepted(
        song, cache_dir=cache_dir, lineage_path=lineage_path,
        soundcharts_uuid="uuid-good",
        resolved_isrc="GOOD", candidate_isrcs=["GOOD", "OTHER"], loop=1,
    )
    cached = load_cache_entry(cache_dir, "GOOD")
    assert cached["name"] == "Night Runner"
    lineage = load_lineage(lineage_path)
    entry = lineage["entries"][0]
    assert entry["synthetic_id"] is None  # deferred until transform-time backfill
    assert entry["resolved_isrc"] == "GOOD"
    assert entry["candidate_isrcs"] == ["GOOD", "OTHER"]


def test_backfill_lineage_ids_joins_on_isrc(tmp_path) -> None:
    lineage_path = tmp_path / "lineage.json"
    store_accepted(
        _song(isrc="GOOD"), cache_dir=tmp_path / "cache", lineage_path=lineage_path,
        soundcharts_uuid="uuid-good", resolved_isrc="GOOD",
        candidate_isrcs=["GOOD"], loop=1,
    )
    catalog = [{"spotify_track": {"id": "synthetic-track-0042",
                                  "external_ids": {"isrc": "GOOD"}}}]
    backfill_lineage_ids(lineage_path, catalog)
    entry = load_lineage(lineage_path)["entries"][0]
    assert entry["synthetic_id"] == "synthetic-track-0042"  # matches frozen catalog id
