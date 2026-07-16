"""T055 [US7] — blind judge + cross-check (design §4.11, SC-009, FR-026).

The LLM assigns positive/negative/neutral **blind** (before any P6 score); the score is
revealed after and `agreement` recorded. The test-case artifact carries judge provenance
(`judge_folds`); the song catalog stays label-free (the labels live only in test cases).
"""
from __future__ import annotations

import pytest

from mdg.judge import BlindOrderingError, finalize_test_cases, read_blind_labels


def _label(tc_id="tc-01", world="w1", song="synthetic-track-0001", label="positive"):
    return {
        "test_case_id": tc_id, "world_ref": world, "candidate_song_ref": song,
        "expected_label": label,
        "judge_folds": {"context_need": "drowsy → high arousal", "mood_genre_fit": "…",
                        "era_cultural_fit": "…", "coherence": "…", "web_evidence": "…"},
    }


def test_read_blind_labels_accepts_score_free_output() -> None:
    labels = read_blind_labels([_label()])
    assert labels[0]["expected_label"] == "positive"


def test_blind_ordering_rejects_output_carrying_score() -> None:
    bad = _label()
    bad["algorithm_score"] = 0.62  # score present at label time → not blind
    with pytest.raises(BlindOrderingError):
        read_blind_labels([bad])


def test_blind_ordering_rejects_output_carrying_agreement() -> None:
    bad = _label()
    bad["agreement"] = "agree"
    with pytest.raises(BlindOrderingError):
        read_blind_labels([bad])


def test_finalize_computes_agreement_after_reveal() -> None:
    labels = [
        _label("tc-pos", "w1", "synthetic-track-0001", "positive"),
        _label("tc-neg", "w2", "synthetic-track-0002", "negative"),
        _label("tc-dis", "w3", "synthetic-track-0003", "positive"),
    ]
    scores = {"tc-pos": 0.62, "tc-neg": -0.4, "tc-dis": -0.5}
    cases = finalize_test_cases(labels, scores)
    by_id = {c["test_case_id"]: c for c in cases}
    assert by_id["tc-pos"]["agreement"] == "agree"    # positive label, +score
    assert by_id["tc-neg"]["agreement"] == "agree"    # negative label, -score
    assert by_id["tc-dis"]["agreement"] == "disagree" # positive label, -score
    # provenance preserved; each is a valid TestCase.
    assert by_id["tc-pos"]["judge_folds"]["context_need"]
    assert by_id["tc-pos"]["algorithm_score"] == 0.62


def test_neutral_label_agrees_within_band() -> None:
    labels = [_label("tc-neu", "w1", "synthetic-track-0001", "neutral")]
    cases = finalize_test_cases(labels, {"tc-neu": 0.02})  # small |score| → neutral
    assert cases[0]["agreement"] == "agree"
    cases2 = finalize_test_cases(labels, {"tc-neu": 0.7})  # strong score vs neutral label
    assert cases2[0]["agreement"] == "disagree"


def test_test_cases_are_separate_from_catalog() -> None:
    # The judge produces TestCase artifacts; nothing here mutates or labels a Song.
    labels = [_label()]
    cases = finalize_test_cases(labels, {"tc-01": 0.5})
    for case in cases:
        assert set(case.keys()) >= {"test_case_id", "world_ref", "candidate_song_ref",
                                    "expected_label", "algorithm_score", "agreement"}
        assert "spotify_track" not in case  # not a song
