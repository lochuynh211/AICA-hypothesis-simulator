"""S8 — Blind judge + cross-check (design §4.11).

The LLM assigns `positive/negative/neutral` **blind** (a handoff whose output must NOT
carry the P6 score); this module reads those blind labels, then reveals the P6 score and
records `agreement`. Blind-first ordering (SC-009) is enforced structurally: an LLM output
that already contains `algorithm_score`/`agreement` is rejected — it wasn't blind.

The song catalog stays label-free (FR-026): labels live only in the separate TestCase
artifacts produced here.
"""
from __future__ import annotations

from typing import Any

from mdg.models import TestCase

# |score| below this counts as neutral for agreement with a "neutral" label.
_NEUTRAL_BAND = 0.10


class BlindOrderingError(Exception):
    """Raised when an LLM judge output leaks the P6 score/agreement (not blind)."""


def read_blind_labels(items: list[dict]) -> list[dict]:
    """Validate the blind-label handoff output; reject any score/agreement leakage."""
    for i, item in enumerate(items):
        if "algorithm_score" in item or "agreement" in item:
            raise BlindOrderingError(
                f"judge item[{i}] carries a score/agreement before reveal (SC-009); "
                "the label must be committed blind"
            )
        for required in ("test_case_id", "world_ref", "candidate_song_ref",
                         "expected_label", "judge_folds"):
            if required not in item:
                raise BlindOrderingError(f"judge item[{i}] missing '{required}'")
        if item["expected_label"] not in ("positive", "negative", "neutral"):
            raise BlindOrderingError(
                f"judge item[{i}] label '{item['expected_label']}' invalid"
            )
    return items


def _label_sign(label: str) -> int:
    return {"positive": 1, "negative": -1, "neutral": 0}[label]


def _agreement(label: str, score: float) -> str:
    """Agree iff the revealed P6 score's sign matches the blind label (neutral band)."""
    if label == "neutral":
        return "agree" if abs(score) < _NEUTRAL_BAND else "disagree"
    score_sign = 1 if score >= _NEUTRAL_BAND else (-1 if score <= -_NEUTRAL_BAND else 0)
    return "agree" if score_sign == _label_sign(label) else "disagree"


def finalize_test_cases(
    blind_labels: list[dict], p6_scores: dict[str, float]
) -> list[dict[str, Any]]:
    """Join blind labels with revealed P6 scores; record agreement; validate TestCases.

    `p6_scores` maps `test_case_id → algorithm_score`. Called only after
    `read_blind_labels`, so the labels are already committed blind.
    """
    out: list[dict] = []
    for item in blind_labels:
        tc_id = item["test_case_id"]
        score = p6_scores[tc_id]
        case = {
            "test_case_id": tc_id,
            "world_ref": item["world_ref"],
            "candidate_song_ref": item["candidate_song_ref"],
            "expected_label": item["expected_label"],
            "judge_folds": item["judge_folds"],
            "algorithm_score": score,
            "agreement": _agreement(item["expected_label"], score),
            "contrast_partner": item.get("contrast_partner"),
            "expected_direction": item.get("expected_direction"),
        }
        TestCase.model_validate(case)  # enforce the frozen TestCase shape
        out.append(case)
    return out
