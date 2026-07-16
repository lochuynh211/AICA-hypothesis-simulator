"""T057 [US7] — P6 contrast certification (design §4.12, SC-004, FR-027).

`load_evaluate` loads the P6 `evaluate` by file path; the reversal logic asserts each
contrast pair's two songs flip order between the pair's two worlds; a non-reversing pair
emits a re-harvest signal (never a numeric tweak).
"""
from __future__ import annotations

from pathlib import Path

from mdg.certify import certify_reversals, load_evaluate

_P6 = (Path(__file__).resolve().parents[2] / "packages"
       / "aica_transparent_content_selector_v1")


def test_load_p6_evaluate_by_path() -> None:
    evaluate = load_evaluate(_P6)
    assert callable(evaluate)


_WORLDS = {"wa": {"world_id": "wa"}, "wb": {"world_id": "wb"}}
_PAIRS = [{"pair_id": "p1", "world_a_ref": "wa", "world_b_ref": "wb",
           "song_hi": "HI", "song_lo": "LO", "cell": "E-hi_T-hi_P-bv"}]


def test_reversing_pair_is_certified() -> None:
    # HI ranks ahead in wa, LO ranks ahead in wb → reversal.
    ranks = {"wa": {"HI": 0, "LO": 1}, "wb": {"HI": 1, "LO": 0}}
    report = certify_reversals(lambda w: ranks[w["world_id"]], _PAIRS, _WORLDS)
    assert report["all_reversed"] is True
    assert report["certified"] == ["p1"]
    assert report["re_harvest_signals"] == []


def test_non_reversing_pair_emits_reharvest_signal() -> None:
    # HI ranks ahead in BOTH worlds → no reversal.
    ranks = {"wa": {"HI": 0, "LO": 1}, "wb": {"HI": 0, "LO": 1}}
    report = certify_reversals(lambda w: ranks[w["world_id"]], _PAIRS, _WORLDS)
    assert report["all_reversed"] is False
    signal = report["re_harvest_signals"][0]
    assert signal["signal"] == "re_harvest_cell"
    assert signal["cell"] == "E-hi_T-hi_P-bv"
    # FR-027: the signal is a re-harvest instruction, never a score adjustment.
    assert "score" not in signal and "adjust" not in signal


def test_all_twelve_pairs_reverse_under_ideal_rank_fn() -> None:
    from mdg.worlds import build_contrast_pairs

    bundle = build_contrast_pairs(
        track_ids=[f"synthetic-track-{i:04d}" for i in range(1, 20)],
        artist_ids=[f"synthetic-artist-{i:04d}" for i in range(1, 13)],
    )
    worlds = {w["world_id"]: w for w in bundle["worlds"]}
    pairs = [{**p, "song_hi": "HI", "song_lo": "LO"} for p in bundle["pairs"]]

    # An ideal rank_fn that flips HI/LO between each pair's two worlds.
    def rank_fn(world):
        # world_a of every pair ends in "-a"; make HI win there, LO win in "-b".
        hi_wins = world["world_id"].endswith("-a")
        return {"HI": 0, "LO": 1} if hi_wins else {"HI": 1, "LO": 0}

    report = certify_reversals(rank_fn, pairs, worlds)
    assert len(report["certified"]) == 12
    assert report["all_reversed"] is True
