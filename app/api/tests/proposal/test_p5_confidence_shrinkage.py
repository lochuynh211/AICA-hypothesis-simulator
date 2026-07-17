"""TDD: P5 Unit F T030 - `confidence_shrinkage_v1` opt-in extension (US4),
algorithm doc SS5.4 note / SS5.6 / SS5.7, contracts/evaluate_contract.md
"Confidence-shrinkage hyperparameter", spec.md FR-019/FR-020.

(a) FIREWALL: off (default) is byte-for-byte identical to the frozen
    pre-Unit-F baseline (golden captured BEFORE this unit's implementation
    landed) across the worked example + two contrast worlds, AND is
    invariant to whatever confidence values happen to be present in the
    world (proves the two confidence fields have zero causal effect when
    off) -- the two confidence fields stay `available_but_not_used`.
(b) ON: two candidates with an IDENTICAL acceptance rate but DIFFERENT
    confidence get DIFFERENT (lower-confidence-smaller) acceptance
    contributions; the affected rows carry
    `response_provenance == "confidence_shrinkage_v1"`.
(c) missing confidence => treated as 1.0 (no shrink), disclosed in the row.
(d) whole-branch review fix: `algorithm_provenance.extensions_on` (data-model.md
    SS4, the run-level record of enabled extensions) must reflect whether the
    hyperparameter was on, at BOTH sites that build `algorithm_provenance`
    (the `ranked_candidates` path and the `no_proposal`/empty-eligible-set
    path) -- it must never be hardcoded `[]`.
"""
from __future__ import annotations

import json
import pathlib

import pytest

from tests.proposal.conftest import build_service_context, load_worked_example_context

_FIXTURES_DIR = pathlib.Path(__file__).parent.parent / "fixtures" / "proposal"
_GOLDEN = json.loads((_FIXTURES_DIR / "p5_confidence_shrinkage_off_golden.json").read_text(encoding="utf-8"))


def _canonical(d: dict) -> str:
    """Byte-equality proxy: canonical (sorted-key) JSON serialization."""
    return json.dumps(d, sort_keys=True)


def _contrast_a_context(*, confidence: dict | None = None) -> dict:
    return build_service_context(
        trigger_purpose="rest_recommended",
        lifecycle_stage="after_rest_before_restart",
        allowed_service_ids=["live_viewing", "stretch_video", "call_response_stopped"],
        feature_snapshot={
            "situation": {
                "drowsiness_level": 30, "fatigue_level": 40, "traffic_state": "normal",
                "road_type": "local", "night_state": "day", "monotony_level": 20,
                "route_tags": [], "destination_tags": [], "child_present": False,
                "multiple_passengers": False,
            },
            "preference": {"oshi_registered": False, "oshi_mode": "off"},
            "history": {
                "service_proposal_acceptance_rate": {"live_viewing": 60, "stretch_video": 40},
                "service_recovery_rate": {"live_viewing": 55, "stretch_video": 65},
            },
            "additional_proposed": {
                "service_proposal_acceptance_confidence": confidence if confidence is not None else {"live_viewing": 0.9},
                "service_recovery_confidence": {},
            },
        },
    )


def _contrast_b_context(*, confidence: dict | None = None) -> dict:
    return build_service_context(
        trigger_purpose="route_music",
        lifecycle_stage="active_driving_content",
        allowed_service_ids=["music_playlist", "humming_karaoke"],
        feature_snapshot={
            "situation": {
                "drowsiness_level": 10, "fatigue_level": 15, "traffic_state": "congested",
                "road_type": "mountain", "night_state": "night", "monotony_level": 55,
                "route_tags": ["scenic_byway"], "destination_tags": [], "child_present": True,
                "multiple_passengers": False,
            },
            "preference": {"oshi_registered": True, "oshi_mode": "off"},
            "history": {
                "service_proposal_acceptance_rate": {"music_playlist": 60, "humming_karaoke": 60},
                "service_recovery_rate": {"music_playlist": 50, "humming_karaoke": 50},
            },
            "additional_proposed": {
                "service_proposal_acceptance_confidence": confidence if confidence is not None else {"music_playlist": 1.0, "humming_karaoke": 0.2},
                "service_recovery_confidence": {},
            },
        },
    )


# ---------------------------------------------------------------------------
# (a) FIREWALL -- off == frozen pre-Unit-F baseline, byte-for-byte
# ---------------------------------------------------------------------------


def test_off_matches_frozen_baseline_worked_example(service_selector):
    result = service_selector.evaluate(load_worked_example_context())
    assert _canonical(result) == _canonical(_GOLDEN["worked_example"])


def test_off_matches_frozen_baseline_contrast_a(service_selector):
    result = service_selector.evaluate(_contrast_a_context())
    assert _canonical(result) == _canonical(_GOLDEN["contrast_a"])


def test_off_matches_frozen_baseline_contrast_b(service_selector):
    result = service_selector.evaluate(_contrast_b_context())
    assert _canonical(result) == _canonical(_GOLDEN["contrast_b"])


@pytest.mark.parametrize("ctx_builder", [_contrast_a_context, _contrast_b_context])
def test_off_is_invariant_to_confidence_values(service_selector, ctx_builder):
    """With the extension off, whatever confidence values the world happens
    to carry must have ZERO effect on the output -- proves the confidence
    fields are truly inert in the baseline path (FR-019)."""
    no_confidence = service_selector.evaluate(ctx_builder(confidence={}))
    high_confidence = service_selector.evaluate(ctx_builder(confidence={"music_playlist": 1.0, "humming_karaoke": 1.0, "live_viewing": 1.0, "stretch_video": 1.0}))
    low_confidence = service_selector.evaluate(ctx_builder(confidence={"music_playlist": 0.01, "humming_karaoke": 0.01, "live_viewing": 0.01, "stretch_video": 0.01}))
    assert _canonical(no_confidence) == _canonical(high_confidence) == _canonical(low_confidence)


def test_off_reports_confidence_fields_as_unused(service_selector):
    result = service_selector.evaluate(load_worked_example_context())
    assert "service_proposal_acceptance_confidence" in result["unused_available_features"]
    assert "service_recovery_confidence" in result["unused_available_features"]


def test_off_response_provenance_is_unaffected(service_selector):
    """Off: the acceptance/recovery rows keep the ordinary direct-candidate-
    feature provenance -- never the shrinkage marker."""
    result = service_selector.evaluate(load_worked_example_context())
    top = result["ranked_candidates"][0]
    by_id = {c["feature_id"]: c for c in top["feature_contributions"]}
    assert by_id["service_proposal_acceptance_rate"]["response_provenance"] == "cdc_su_direct_candidate_feature"
    assert by_id["service_recovery_rate"]["response_provenance"] == "cdc_su_direct_candidate_feature"


# ---------------------------------------------------------------------------
# (b) ON -- identical rate, different confidence => different contribution
# ---------------------------------------------------------------------------


def _on_hyperparameters(service_hyperparameters) -> dict:
    hp = dict(service_hyperparameters)
    hp["confidence_shrinkage_v1"] = True
    return hp


def test_on_lower_confidence_shrinks_acceptance_contribution_more(service_selector, service_hyperparameters):
    ctx = _contrast_b_context(confidence={"music_playlist": 1.0, "humming_karaoke": 0.2})
    ctx["hyperparameters"] = _on_hyperparameters(service_hyperparameters)
    result = service_selector.evaluate(ctx)

    rows_by_candidate = {}
    for candidate in result["ranked_candidates"]:
        by_feature = {c["feature_id"]: c for c in candidate["feature_contributions"]}
        rows_by_candidate[candidate["candidate_id"]] = by_feature

    high_conf_row = rows_by_candidate["music_playlist"]["service_proposal_acceptance_rate"]
    low_conf_row = rows_by_candidate["humming_karaoke"]["service_proposal_acceptance_rate"]

    # Identical acceptance rate (60) => identical evidence BEFORE shrink;
    # after shrink the low-confidence candidate's magnitude is strictly
    # smaller (both are positive here since rate=60 > neutral 50).
    assert abs(low_conf_row["contribution"]) < abs(high_conf_row["contribution"])
    assert low_conf_row["contribution"] > 0
    assert high_conf_row["contribution"] > 0

    # And the shrink is exact: e = (2*60/100-1) * clamp(conf,0,1) = 0.2*conf.
    assert high_conf_row["normalized_evidence"] == pytest.approx(0.2 * 1.0, abs=1e-12)
    assert low_conf_row["normalized_evidence"] == pytest.approx(0.2 * 0.2, abs=1e-12)


def test_on_marks_affected_rows_with_confidence_shrinkage_provenance(service_selector, service_hyperparameters):
    ctx = _contrast_b_context()
    ctx["hyperparameters"] = _on_hyperparameters(service_hyperparameters)
    result = service_selector.evaluate(ctx)
    top = result["ranked_candidates"][0]
    by_id = {c["feature_id"]: c for c in top["feature_contributions"]}
    assert by_id["service_proposal_acceptance_rate"]["response_provenance"] == "confidence_shrinkage_v1"
    assert by_id["service_recovery_rate"]["response_provenance"] == "confidence_shrinkage_v1"
    # Unaffected rows keep their ordinary provenance.
    assert by_id["drowsiness_level"]["response_provenance"] != "confidence_shrinkage_v1"


def test_on_moves_confidence_fields_out_of_unused_available_features(service_selector, service_hyperparameters):
    ctx = _contrast_b_context()
    ctx["hyperparameters"] = _on_hyperparameters(service_hyperparameters)
    result = service_selector.evaluate(ctx)
    assert "service_proposal_acceptance_confidence" not in result["unused_available_features"]
    assert "service_recovery_confidence" not in result["unused_available_features"]


def test_on_response_coefficient_stays_plus_one(service_selector, service_hyperparameters):
    """Shrinkage is purely additive to the EVIDENCE step -- the response
    coefficient for a direct candidate feature stays +1.0 (doc SS5.4)."""
    ctx = _contrast_b_context()
    ctx["hyperparameters"] = _on_hyperparameters(service_hyperparameters)
    result = service_selector.evaluate(ctx)
    top = result["ranked_candidates"][0]
    by_id = {c["feature_id"]: c for c in top["feature_contributions"]}
    assert by_id["service_proposal_acceptance_rate"]["response_coefficient"] == 1.0
    assert by_id["service_recovery_rate"]["response_coefficient"] == 1.0


# ---------------------------------------------------------------------------
# (c) missing confidence => 1.0 (no shrink), disclosed
# ---------------------------------------------------------------------------


def test_on_missing_confidence_treated_as_full_confidence_and_disclosed(service_selector, service_hyperparameters):
    # `music_playlist` has NO entry in service_proposal_acceptance_confidence.
    ctx = _contrast_b_context(confidence={"humming_karaoke": 0.2})
    ctx["hyperparameters"] = _on_hyperparameters(service_hyperparameters)
    result = service_selector.evaluate(ctx)
    by_candidate = {c["candidate_id"]: {fc["feature_id"]: fc for fc in c["feature_contributions"]} for c in result["ranked_candidates"]}

    missing_conf_row = by_candidate["music_playlist"]["service_proposal_acceptance_rate"]
    # No shrink applied: e = 2*60/100-1 = 0.2 exactly (confidence treated as 1.0).
    assert missing_conf_row["normalized_evidence"] == pytest.approx(0.2, abs=1e-12)
    # Still carries the extension's provenance marker (the row IS affected
    # by the extension being on, even though this candidate's own value is
    # unshrunk) -- and the missing-confidence fact is disclosed somewhere
    # visible in the row (normalization_function), never silently assumed.
    assert missing_conf_row["response_provenance"] == "confidence_shrinkage_v1"
    assert "missing" in missing_conf_row["normalization_function"].lower()

    shrunk_row = by_candidate["humming_karaoke"]["service_proposal_acceptance_rate"]
    assert "missing" not in shrunk_row["normalization_function"].lower()
    assert missing_conf_row["normalized_evidence"] != shrunk_row["normalized_evidence"]


# ---------------------------------------------------------------------------
# (d) whole-branch review fix -- algorithm_provenance.extensions_on must
#     reflect the hyperparameter, at both call sites (ranked + no_proposal).
# ---------------------------------------------------------------------------


def test_off_extensions_on_is_empty_ranked_path(service_selector):
    result = service_selector.evaluate(load_worked_example_context())
    assert result["decision_type"] == "ranked_candidates"
    assert result["algorithm_provenance"]["extensions_on"] == []


def test_on_extensions_on_lists_confidence_shrinkage_ranked_path(service_selector, service_hyperparameters):
    ctx = _contrast_b_context()
    ctx["hyperparameters"] = _on_hyperparameters(service_hyperparameters)
    result = service_selector.evaluate(ctx)
    assert result["decision_type"] == "ranked_candidates"
    assert result["algorithm_provenance"]["extensions_on"] == ["confidence_shrinkage_v1"]


def test_off_extensions_on_is_empty_no_proposal_path(service_selector, service_hyperparameters):
    ctx = build_service_context(allowed_service_ids=[], hyperparameters=service_hyperparameters)
    result = service_selector.evaluate(ctx)
    assert result["decision_type"] == "no_proposal"
    assert result["algorithm_provenance"]["extensions_on"] == []


def test_on_extensions_on_lists_confidence_shrinkage_no_proposal_path(service_selector, service_hyperparameters):
    ctx = build_service_context(allowed_service_ids=[], hyperparameters=_on_hyperparameters(service_hyperparameters))
    result = service_selector.evaluate(ctx)
    assert result["decision_type"] == "no_proposal"
    assert result["algorithm_provenance"]["extensions_on"] == ["confidence_shrinkage_v1"]
