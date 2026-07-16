"""T039 [US2] — step-zero audio-coverage probe gate (FR-008, §4.5c).

Probe a hand-picked set of ~15 ISRCs; if fewer than 60% (< 9/15) return a complete,
non-null audio block, raise `isrc_probe_gate_failed` before Strategy B commits.
"""
from __future__ import annotations

import pytest

from mdg.errors import ErrorCode, MdgFatalError
from mdg.harvest.probe import run_probe


def _song(populated=True, isrc="X"):
    audio = None
    if populated:
        audio = {k: 0.5 for k in (
            "acousticness", "danceability", "energy", "instrumentalness", "key",
            "liveness", "loudness", "mode", "speechiness", "tempo", "timeSignature",
            "valence")}
    return {"isrc": {"value": isrc}, "languageCode": "ja", "audio": audio}


class FakeSC:
    def __init__(self, populated_flags):
        self._flags = populated_flags  # isrc -> bool populated
        self.calls = []

    def by_isrc(self, isrc):
        self.calls.append(isrc)
        if isrc not in self._flags:
            return None
        return _song(populated=self._flags[isrc], isrc=isrc)


def _isrcs(n):
    return [f"ISRC{i:02d}" for i in range(n)]


def test_probe_passes_at_threshold() -> None:
    isrcs = _isrcs(15)
    flags = {i: (idx < 9) for idx, i in enumerate(isrcs)}  # 9/15 populated
    result = run_probe(FakeSC(flags), isrcs)
    assert result["fetched"] == 15
    assert result["populated_audio"] == 9
    assert result["passed"] is True


def test_probe_below_threshold_raises() -> None:
    isrcs = _isrcs(15)
    flags = {i: (idx < 8) for idx, i in enumerate(isrcs)}  # 8/15 populated
    with pytest.raises(MdgFatalError) as exc:
        run_probe(FakeSC(flags), isrcs)
    assert exc.value.code == ErrorCode.isrc_probe_gate_failed


def test_probe_counts_404_as_unpopulated() -> None:
    isrcs = _isrcs(15)
    flags = {i: True for i in isrcs[:10]}  # 5 missing (404) -> unpopulated
    result = run_probe(FakeSC(flags), isrcs)
    assert result["populated_audio"] == 10
    assert result["passed"] is True
