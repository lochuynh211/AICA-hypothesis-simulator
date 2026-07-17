"""TDD: P5 Unit B T010-T011 - the numerically-critical core.

T010: WeightResolver reproduces the doc's §6.2 normalized-weight table for
all 4 purposes (Sigma w = 1 within 1e-12; each cell matches the doc's
published 6-decimal figure).

T011: the §10 worked example (`humming_karaoke` under
inattentive_driving_prevention_recovery / active_driving_content) scores
+0.772349 and ranks above `music_playlist`.

See `proposal_contracts/fixtures/service/worked-example.golden.md` for the
full e/a/r/w/k reconciliation table and the documented ~1.4e-6 doc-rounding
finding behind this file's `_SCORE_TOLERANCE`.
"""
from __future__ import annotations

import pytest

from tests.proposal.conftest import (
    load_service_manifest,
    load_worked_example_context,
    service_manifest_hyperparameters,
)

# The doc's own §10 worked-example headline total (+0.772349) does not
# reproduce to 1e-12 from the doc's OWN fully-specified inputs (verified via
# independent exact-rational recomputation, see the golden note) - the true
# value is +0.7723503548287566..., a ~1.4e-6 doc rounding artifact. Per-row
# w_i/k_i values DO match the doc's published 6-decimal table exactly.
_ROW_TOLERANCE = 6e-7
_SCORE_TOLERANCE = 2e-6

_PURPOSES = [
    "rest_recommended",
    "inattentive_driving_prevention_recovery",
    "route_music",
    "child_passenger_experience",
]

# doc §6.2 "Resulting normalized weights" table, verbatim.
_DOC_WEIGHTS = {
    "rest_recommended": {
        "drowsiness_level": 0.256538, "fatigue_level": 0.209895, "traffic_state": 0.051308,
        "road_type": 0.051308, "night_state": 0.051308, "monotony_level": 0.102615,
        "route_tags": 0.027486, "destination_tags": 0.022489, "child_present": 0.032484,
        "multiple_passengers": 0.017491, "oshi_registered": 0.008746, "oshi_mode": 0.016242,
        "service_recency_state": 0.007996, "service_usage_level": 0.022489,
        "scene_service_usage_level": 0.039980, "service_proposal_acceptance_rate": 0.016658,
        "service_recovery_rate": 0.064968,
    },
    "inattentive_driving_prevention_recovery": {
        "drowsiness_level": 0.254551, "fatigue_level": 0.208269, "traffic_state": 0.060475,
        "road_type": 0.060475, "night_state": 0.060475, "monotony_level": 0.120950,
        "route_tags": 0.019091, "destination_tags": 0.015620, "child_present": 0.025571,
        "multiple_passengers": 0.013769, "oshi_registered": 0.006479, "oshi_mode": 0.012033,
        "service_recency_state": 0.007405, "service_usage_level": 0.020827,
        "scene_service_usage_level": 0.040728, "service_proposal_acceptance_rate": 0.015427,
        "service_recovery_rate": 0.057853,
    },
    "route_music": {
        "drowsiness_level": 0.233546, "fatigue_level": 0.191083, "traffic_state": 0.049540,
        "road_type": 0.049540, "night_state": 0.049540, "monotony_level": 0.099080,
        "route_tags": 0.058386, "destination_tags": 0.047771, "child_present": 0.027601,
        "multiple_passengers": 0.014862, "oshi_registered": 0.010218, "oshi_mode": 0.018976,
        "service_recency_state": 0.008493, "service_usage_level": 0.023885,
        "scene_service_usage_level": 0.046709, "service_proposal_acceptance_rate": 0.017693,
        "service_recovery_rate": 0.053079,
    },
    "child_passenger_experience": {
        "drowsiness_level": 0.234729, "fatigue_level": 0.192051, "traffic_state": 0.049791,
        "road_type": 0.049791, "night_state": 0.049791, "monotony_level": 0.099582,
        "route_tags": 0.022006, "destination_tags": 0.018005, "child_present": 0.069352,
        "multiple_passengers": 0.037343, "oshi_registered": 0.007002, "oshi_mode": 0.013003,
        "service_recency_state": 0.008536, "service_usage_level": 0.026674,
        "scene_service_usage_level": 0.051214, "service_proposal_acceptance_rate": 0.017783,
        "service_recovery_rate": 0.053348,
    },
}


@pytest.mark.parametrize("purpose", _PURPOSES)
def test_weight_resolution(service_selector, service_hyperparameters, purpose):
    weights = service_selector.resolve_weights(service_hyperparameters, purpose)

    total = sum(e["effective_weight"] for e in weights.values())
    assert total == pytest.approx(1.0, abs=1e-12)

    for feature_id, expected in _DOC_WEIGHTS[purpose].items():
        actual = weights[feature_id]["effective_weight"]
        assert actual == pytest.approx(expected, abs=_ROW_TOLERANCE), (
            f"{purpose}/{feature_id}: expected {expected}, got {actual}"
        )


def test_sibling_scale_invariance(service_hyperparameters, service_selector):
    """Scaling every sibling weight in a group by a constant changes nothing
    (SS16 required test / data-model.md SS6.1 'ratios, not absolutes')."""
    import copy

    base = service_hyperparameters
    scaled = copy.deepcopy(base)
    for cat_def in scaled["hierarchy_weights"].values():
        cat_def["share"] = cat_def["share"] * 10.0
        for sub in cat_def["subgroups"].values():
            sub["share"] = sub["share"] * 3.0
            for leaf_def in sub["leaves"].values():
                leaf_def["share"] = leaf_def["share"] * 7.0

    w_base = service_selector.resolve_weights(base, "inattentive_driving_prevention_recovery")
    w_scaled = service_selector.resolve_weights(scaled, "inattentive_driving_prevention_recovery")

    for fid in w_base:
        assert w_scaled[fid]["effective_weight"] == pytest.approx(
            w_base[fid]["effective_weight"], abs=1e-12
        )


def test_worked_example(service_selector):
    context = load_worked_example_context()
    out = service_selector.evaluate(context)

    assert out["decision_type"] == "ranked_candidates"
    by_id = {c["candidate_id"]: c for c in out["ranked_candidates"]}
    assert "humming_karaoke" in by_id

    humming = by_id["humming_karaoke"]
    assert humming["score"] == pytest.approx(0.772349, abs=_SCORE_TOLERANCE)

    # per-feature k_i reconciliation against the doc's §10 table.
    doc_k = {
        "drowsiness_level": 0.203641, "fatigue_level": 0.124961, "traffic_state": 0.060475,
        "road_type": 0.060475, "night_state": 0.060475, "monotony_level": 0.090713,
        "route_tags": 0.019091, "destination_tags": 0.007810, "child_present": 0.025571,
        "multiple_passengers": 0.013769, "oshi_registered": 0.003240, "oshi_mode": 0.006017,
        "service_recency_state": 0.003703, "service_usage_level": 0.020827,
        "scene_service_usage_level": 0.040728, "service_proposal_acceptance_rate": 0.007714,
        "service_recovery_rate": 0.023141,
    }
    contributions = {c["feature_id"]: c for c in humming["feature_contributions"]}
    assert set(contributions) == set(doc_k)
    for fid, expected_k in doc_k.items():
        assert contributions[fid]["contribution"] == pytest.approx(expected_k, abs=_ROW_TOLERANCE), fid

    # music_playlist scores strictly lower - humming dominates on this snapshot
    # (doc §10: "Humming therefore ranks well above playlist here").
    if "music_playlist" in by_id:
        assert by_id["music_playlist"]["score"] < humming["score"]

    ranks = [c["candidate_id"] for c in out["ranked_candidates"]]
    assert ranks[0] == "humming_karaoke"


def test_worked_example_music_playlist_in_expected_neighborhood(service_selector):
    """music_playlist's score is not doc-pinned (only the ordering is, see
    the golden note) but should land in the ballpark the doc's narrative
    describes ("approx +0.132"). music_playlist ranks below top_k=3 among
    all 6 driving candidates on this snapshot (the four activation services
    dominate) - narrow the eligible set to the two candidates under
    comparison so both appear in the output."""
    context = load_worked_example_context()
    context["allowed_service_ids"] = ["music_playlist", "humming_karaoke"]
    context["eligible_candidates"] = [{"candidate_id": "music_playlist"}, {"candidate_id": "humming_karaoke"}]
    out = service_selector.evaluate(context)
    by_id = {c["candidate_id"]: c for c in out["ranked_candidates"]}
    assert by_id["music_playlist"]["score"] == pytest.approx(0.132, abs=0.03)
    assert by_id["humming_karaoke"]["score"] > by_id["music_playlist"]["score"]


def test_manifest_loads_and_matches_algorithm_feature_order(service_selector):
    manifest = load_service_manifest()
    assert manifest["id"] == "aica_transparent_service_selector_v1"
    hp = service_manifest_hyperparameters()
    weights = service_selector.resolve_weights(hp, "rest_recommended")
    assert set(weights) == set(service_selector.FEATURE_ORDER)
