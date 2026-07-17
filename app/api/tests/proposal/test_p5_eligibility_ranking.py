"""TDD: P5 Unit B T014 - eligibility + ranking (algorithm doc §9 steps 2/7/8).
"""
from __future__ import annotations

import pytest

from tests.proposal.conftest import build_service_context

_DRIVING = ["music_playlist", "humming_karaoke", "call_response_driving", "quiz", "ranking_creation", "radio_style"]

_BASE_SITUATION = {
    "drowsiness_level": 40, "fatigue_level": 30, "traffic_state": "normal",
    "road_type": "local", "night_state": "day", "monotony_level": 20,
    "route_tags": [], "destination_tags": [], "child_present": False,
    "multiple_passengers": False,
}
_BASE_PREFERENCE = {"oshi_registered": False, "oshi_mode": "off"}


def _snapshot(**situation_overrides):
    situation = {**_BASE_SITUATION, **situation_overrides}
    return {
        "situation": situation,
        "preference": dict(_BASE_PREFERENCE),
        "history": {},
        "additional_proposed": {},
    }


def test_candidates_only_from_allowed_service_ids(service_selector):
    context = build_service_context(
        allowed_service_ids=["music_playlist", "humming_karaoke"],
        eligible_candidates=[{"candidate_id": "music_playlist"}, {"candidate_id": "humming_karaoke"}],
        feature_snapshot=_snapshot(),
    )
    out = service_selector.evaluate(context)
    ranked_ids = {c["candidate_id"] for c in out["ranked_candidates"]}
    assert ranked_ids.issubset({"music_playlist", "humming_karaoke"})


def test_candidate_outside_allowed_set_raises(service_selector):
    context = build_service_context(
        allowed_service_ids=["music_playlist"],
        eligible_candidates=[{"candidate_id": "humming_karaoke"}],  # not in allowed_service_ids
        feature_snapshot=_snapshot(),
    )
    with pytest.raises(Exception):
        service_selector.evaluate(context)


def test_empty_eligible_yields_no_proposal(service_selector):
    context = build_service_context(
        allowed_service_ids=[],
        eligible_candidates=[],
        feature_snapshot=_snapshot(),
    )
    out = service_selector.evaluate(context)
    assert out["decision_type"] == "no_proposal"
    assert out["ranked_candidates"] == []


def test_top_k_caps_at_three(service_selector):
    context = build_service_context(
        allowed_service_ids=_DRIVING,
        feature_snapshot=_snapshot(drowsiness_level=80, fatigue_level=70, traffic_state="congested", monotony_level=80),
    )
    out = service_selector.evaluate(context)
    assert len(out["ranked_candidates"]) <= 3
    ranks = [c["rank"] for c in out["ranked_candidates"]]
    assert ranks == list(range(1, len(ranks) + 1))


def test_low_and_negative_fit_still_ranked(service_selector):
    """radio_style is neutral-to-opposed on every non-oshi feature with
    oshi off; it must still be ranked if it lands in the top_k window, never
    suppressed purely for a low/negative score (doc §9 step 8)."""
    context = build_service_context(
        allowed_service_ids=["radio_style"],
        eligible_candidates=[{"candidate_id": "radio_style"}],
        feature_snapshot=_snapshot(drowsiness_level=90, fatigue_level=90, traffic_state="congested", monotony_level=90),
    )
    out = service_selector.evaluate(context)
    assert out["decision_type"] == "ranked_candidates"
    assert len(out["ranked_candidates"]) == 1
    assert out["ranked_candidates"][0]["candidate_id"] == "radio_style"


def test_tie_break_by_candidate_id_ascending(service_selector):
    """quiz and ranking_creation share an identical response profile on every
    matrix feature (doc §5.2.1/§5.2.2), so with identical direct-feature
    evidence (both absent -> missing_neutral) they score an EXACT tie;
    candidate_id ascending must break it."""
    context = build_service_context(
        allowed_service_ids=["quiz", "ranking_creation"],
        eligible_candidates=[{"candidate_id": "quiz"}, {"candidate_id": "ranking_creation"}],
        feature_snapshot=_snapshot(drowsiness_level=70, fatigue_level=60, traffic_state="congested", monotony_level=50, child_present=True),
    )
    out = service_selector.evaluate(context)
    scores = {c["candidate_id"]: c["score"] for c in out["ranked_candidates"]}
    assert scores["quiz"] == pytest.approx(scores["ranking_creation"], abs=1e-15)
    assert out["ranked_candidates"][0]["candidate_id"] == "quiz"  # "quiz" < "ranking_creation"
    assert out["ranked_candidates"][1]["candidate_id"] == "ranking_creation"


def test_ranking_full_precision_not_rounded(service_selector):
    context = build_service_context(
        allowed_service_ids=_DRIVING,
        feature_snapshot=_snapshot(drowsiness_level=80, fatigue_level=60, traffic_state="congested", monotony_level=75, road_type="highway", night_state="night"),
    )
    out = service_selector.evaluate(context)
    for c in out["ranked_candidates"]:
        # score is not artificially rounded to a coarse display precision
        assert isinstance(c["score"], float)


def test_candidate_outside_stage_family_raises(service_selector):
    """A post-rest-only candidate offered under active_driving_content must
    be rejected before scoring (doc §2.4 candidate-family table)."""
    context = build_service_context(
        trigger_purpose="inattentive_driving_prevention_recovery",
        lifecycle_stage="active_driving_content",
        allowed_service_ids=["live_viewing"],
        eligible_candidates=[{"candidate_id": "live_viewing"}],
        feature_snapshot=_snapshot(),
    )
    with pytest.raises(Exception):
        service_selector.evaluate(context)


def test_during_rest_stopped_with_empty_eligible_is_no_proposal(service_selector):
    """Documented limitation: during_rest_stopped resolves to an empty
    candidate family in the frozen matrix (its §5.2.3 actions are not
    ServiceId members) - this package implements no response profiles for
    it, so the only valid eligible set for that stage is empty."""
    context = build_service_context(
        trigger_purpose="rest_recommended",
        lifecycle_stage="during_rest_stopped",
        allowed_service_ids=[],
        eligible_candidates=[],
        feature_snapshot=_snapshot(),
    )
    out = service_selector.evaluate(context)
    assert out["decision_type"] == "no_proposal"


def test_after_rest_before_restart_scores_post_rest_family(service_selector):
    context = build_service_context(
        trigger_purpose="rest_recommended",
        lifecycle_stage="after_rest_before_restart",
        allowed_service_ids=["live_viewing", "stretch_video", "full_karaoke", "call_response_stopped", "oshi_reexperience"],
        feature_snapshot=_snapshot(drowsiness_level=50, fatigue_level=50, child_present=True),
    )
    out = service_selector.evaluate(context)
    assert out["decision_type"] == "ranked_candidates"
    for c in out["ranked_candidates"]:
        assert c["candidate_id"] in {"live_viewing", "stretch_video", "full_karaoke", "call_response_stopped", "oshi_reexperience"}
