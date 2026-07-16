"""T042 [US3] — carry-over ledger tests (design §4.13, FR-023/024).

Identity keys (isrc / soundcharts_uuid / NFKC normalized name); append-only; every result
(accepted and miss, with reason/cell/loop) recorded so later loops skip prior work.
"""
from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from mdg.ledger import (
    accepted_cells,
    append_entry,
    is_known,
    known_identity_tokens,
    load_ledger,
)


def _accepted(isrc="A", name="song a|artist", cell="E-hi_T-hi_P-bv", loop=1):
    return {
        "keys": {"isrc": isrc, "soundcharts_uuid": f"uuid-{isrc}", "normalized_name": name},
        "outcome": "accepted", "miss_reason": None, "cell": cell, "loop": loop,
    }


def _miss(name="ghost|nobody", reason="audio_unavailable", loop=1):
    return {
        "keys": {"normalized_name": name},
        "outcome": "miss", "miss_reason": reason, "cell": None, "loop": loop,
    }


def test_append_and_load_preserves_order(tmp_path) -> None:
    path = tmp_path / "ledger.json"
    append_entry(path, _accepted(isrc="A"))
    append_entry(path, _miss(name="b|c"))
    ledger = load_ledger(path)
    assert [e["outcome"] for e in ledger] == ["accepted", "miss"]


def test_append_is_append_only(tmp_path) -> None:
    path = tmp_path / "ledger.json"
    append_entry(path, _accepted(isrc="A"))
    first_snapshot = json.loads(path.read_text())
    append_entry(path, _accepted(isrc="B", name="b|artist"))
    ledger = load_ledger(path)
    assert ledger[0] == first_snapshot[0]  # prior entry untouched
    assert len(ledger) == 2


def test_is_known_by_each_identity_key(tmp_path) -> None:
    ledger = [_accepted(isrc="A", name="night runner|real band")]
    assert is_known(ledger, {"isrc": "A"})
    assert is_known(ledger, {"soundcharts_uuid": "uuid-A"})
    assert is_known(ledger, {"normalized_name": "night runner|real band"})
    assert not is_known(ledger, {"isrc": "Z"})


def test_miss_is_known_and_never_retried(tmp_path) -> None:
    ledger = [_miss(name="ghost|nobody", reason="audio_unavailable")]
    assert is_known(ledger, {"normalized_name": "ghost|nobody"})


def test_accepted_cells_excludes_misses() -> None:
    ledger = [
        _accepted(isrc="A", cell="E-hi_T-hi_P-bv"),
        _miss(name="x|y"),
        _accepted(isrc="B", name="b|c", cell="E-lo_T-lo_P-bv"),
    ]
    assert set(accepted_cells(ledger)) == {"E-hi_T-hi_P-bv", "E-lo_T-lo_P-bv"}
    assert len(accepted_cells(ledger)) == 2  # misses excluded


def test_known_identity_tokens_union() -> None:
    ledger = [_accepted(isrc="A"), _miss(name="x|y")]
    tokens = known_identity_tokens(ledger)
    assert ("isrc", "A") in tokens
    assert ("normalized_name", "x|y") in tokens


def test_malformed_entry_rejected(tmp_path) -> None:
    path = tmp_path / "ledger.json"
    with pytest.raises(ValidationError):
        append_entry(path, {"keys": {"isrc": "A"}, "outcome": "accepted", "loop": 1})  # no normalized_name


def test_invalid_miss_reason_rejected(tmp_path) -> None:
    path = tmp_path / "ledger.json"
    with pytest.raises(ValidationError):
        append_entry(path, {
            "keys": {"normalized_name": "a|b"}, "outcome": "miss",
            "miss_reason": "not_a_real_reason", "loop": 1,
        })
