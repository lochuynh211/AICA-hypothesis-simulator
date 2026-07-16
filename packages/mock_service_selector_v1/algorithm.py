"""mock_service_selector_v1 — a FIXED, valid ServiceSelectorOutput-shaped mock.

Stand-in for the real transparent service-proposal algorithm
(docs/master/aica_transparent_service_proposal_algorithm.md) until P5 ships.
This package exists to exercise the P1 proposal-screen flow (World -> Service
-> Content) end-to-end against the real §11-contract shapes, so the mock
manifest carries a representative full parameter/hyperparameter set (see
package.json) even though `evaluate()` below deliberately IGNORES those
values and returns a fixed, illustrative ranking.

Contract:
  evaluate(context: dict) -> dict   # SelectorInput-shaped in, ServiceSelectorOutput-shaped out

Rules preserved from the real algorithm's engineering contract even in mock
form:
  - Ranked candidates are drawn ONLY from `context["allowed_service_ids"]`
    (never invented) — up to 3, ranks contiguous from 1.
  - An empty `allowed_service_ids` yields `no_proposal` with an empty
    `ranked_candidates` list (§13 "no_proposal": the eligible list is empty).
  - Pure dict in / dict out. No imports of `aica_api`. No file/network I/O,
    no clock, no randomness — identical input always yields this identical
    fixed output shape (module-level constants only).
"""
from __future__ import annotations

_PACKAGE_ID = "mock_service_selector_v1"
_CONTRACT_VERSION = "1.0.0"
_SCHEMA_VERSION = "1.0.0"

# Fixed illustrative per-candidate feature-contribution rows, reused for
# every ranked candidate (mock: rows do not vary by candidate identity;
# only the derived score/uncertainty vary by rank). Each row's fields mirror
# the real algorithm's per-feature explainability contract (§14):
# feature_id, feature_value, response_coefficient (a_i), weight (w_i),
# contribution (w_i * a_i * normalized evidence).
_FEATURE_ROWS = [
    {
        "feature_id": "drowsiness_level",
        "feature_value": 72,
        "response_coefficient": 1.0,
        "weight": 0.254551,
        "contribution": 0.183277,
    },
    {
        "feature_id": "fatigue_level",
        "feature_value": 55,
        "response_coefficient": 1.0,
        "weight": 0.208269,
        "contribution": 0.114548,
    },
    {
        "feature_id": "monotony_level",
        "feature_value": 60,
        "response_coefficient": 1.0,
        "weight": 0.120950,
        "contribution": 0.072570,
    },
    {
        "feature_id": "service_recency_state",
        "feature_value": "long_unused",
        "response_coefficient": 1.0,
        "weight": 0.007405,
        "contribution": 0.003703,
    },
    {
        "feature_id": "service_proposal_acceptance_rate",
        "feature_value": 68,
        "response_coefficient": 1.0,
        "weight": 0.015427,
        "contribution": 0.005554,
    },
]

_SUPPORTING_FEATURE_IDS = ["drowsiness_level", "fatigue_level", "monotony_level"]

# Illustrative descending score + uncertainty per rank (fixed, not derived from context).
_RANK_SCORE = {1: 0.772, 2: 0.451, 3: 0.132}
_RANK_UNCERTAINTY = {1: None, 2: "moderate", 3: "low_sample_support"}

_RATIONALE_BY_RANK = {
    1: [
        "眠気・疲労・単調さの証拠が最も強く支持する候補です（固定モック説明）。",
        "This candidate has the strongest drowsiness/fatigue/monotony support (fixed mock rationale).",
    ],
    2: [
        "上位候補ほどではありませんが、運転環境の証拠が一定程度この候補を支持しています（固定モック説明）。",
        "Driving-environment evidence moderately supports this candidate, though less than the top rank (fixed mock rationale).",
    ],
    3: [
        "支持する証拠は弱く、参考候補として提示されています（固定モック説明）。",
        "Supporting evidence is weak; this candidate is offered only as a reference option (fixed mock rationale).",
    ],
}


def _build_candidate(rank: int, candidate_id: str) -> dict:
    return {
        "rank": rank,
        "candidate_id": candidate_id,
        "score": _RANK_SCORE.get(rank, 0.0),
        "rationale": _RATIONALE_BY_RANK.get(rank, _RATIONALE_BY_RANK[3]),
        "supporting_feature_ids": list(_SUPPORTING_FEATURE_IDS),
        "opposing_feature_ids": [],
        "uncertainty": _RANK_UNCERTAINTY.get(rank),
        "feature_contributions": [dict(row) for row in _FEATURE_ROWS],
    }


def evaluate(context: dict) -> dict:
    """Return a fixed, valid ServiceSelectorOutput-shaped dict.

    `context["allowed_service_ids"]` is the sole source of candidate
    identity — this mock never invents a candidate id outside that set.
    """
    allowed = list(context.get("allowed_service_ids") or [])

    algorithm_provenance = {
        "package_id": _PACKAGE_ID,
        "contract_version": _CONTRACT_VERSION,
        "schema_version": _SCHEMA_VERSION,
    }

    if not allowed:
        return {
            "decision_type": "no_proposal",
            "ranked_candidates": [],
            "excluded_candidates": [],
            "unused_available_features": [],
            "missing_features": [],
            "next_package_runtime_state": {},
            "algorithm_provenance": algorithm_provenance,
        }

    top = allowed[:3]
    rest = allowed[3:]

    ranked_candidates = [
        _build_candidate(rank, candidate_id) for rank, candidate_id in enumerate(top, start=1)
    ]
    excluded_candidates = [
        {
            "candidate_id": candidate_id,
            "platform_reason": "mock_service_selector_returns_top_3_only",
        }
        for candidate_id in rest
    ]

    return {
        "decision_type": "ranked_candidates",
        "ranked_candidates": ranked_candidates,
        "excluded_candidates": excluded_candidates,
        "unused_available_features": [],
        "missing_features": [],
        "next_package_runtime_state": {},
        "algorithm_provenance": algorithm_provenance,
    }
