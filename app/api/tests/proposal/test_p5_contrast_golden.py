"""TDD: P5 Polish T033 - the algorithm doc's §11 "Contrast behavior" 13
one-field contrasts, each authored as a frozen golden fixture under
`proposal_contracts/fixtures/service/contrast-*.json` (never score-derived -
every fixture value is hand-picked to isolate exactly ONE field per §11's
own framing: "Each contrast freezes catalog, purpose, config, and seed and
changes one field, asserting the expected reorder").

Each test below loads its fixture, evaluates the real
`aica_transparent_service_selector_v1` package on both variants via
`service_selector.evaluate()`, and asserts the DIRECTION §11 documents
(a score increases, a gap widens/narrows, or an order/sign flips) - never an
invented absolute number. Every other field not mentioned by a fixture is
left absent from `feature_snapshot`, which the algorithm doc §8 defines as
neutral (`e=0`), so the two variants differ by exactly the one field named
in the fixture's `_comment`.

Fixture -> doc §11 item mapping:
  01 drowsiness, 02 fatigue, 03 monotony, 04 traffic, 05 road (highway<->
  mountain, general), 06 day/night           -> items 1-6
  07 child present                            -> item 7
  08 oshi mode                                -> item 8
  09 service recency                          -> item 9
  10 overall usage                            -> item 10
  11 recovery rate                            -> item 11
  12 route_music vs inattentive purpose       -> item 12
  13 mountain interaction-drop (quiz/ranking)  -> item 13
"""
from __future__ import annotations

import copy

import pytest

from tests.proposal.conftest import build_service_context, load_fixture, load_service_manifest


def _load(name: str) -> dict:
    return load_fixture(f"fixtures/service/contrast-{name}.json")


def _variant_context(fixture: dict, variant_key: str) -> dict:
    variant = fixture["variants"][variant_key]
    return build_service_context(
        trigger_purpose=fixture["trigger_purpose"],
        lifecycle_stage=fixture["lifecycle_stage"],
        allowed_service_ids=fixture["allowed_service_ids"],
        feature_snapshot=variant["feature_snapshot"],
    )


def _scores(service_selector, fixture: dict, variant_key: str) -> dict:
    out = service_selector.evaluate(_variant_context(fixture, variant_key))
    return {c["candidate_id"]: c["score"] for c in out["ranked_candidates"]}


# ---------------------------------------------------------------------------
# 1-6: one-directional situation fields (+ the signed road field, #5) -
# "activation vs calm order shifts among driving services".
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "fixture_name,activation_id,calm_id,low_key,high_key,signed",
    [
        # drowsiness/fatigue/monotony went through the 2026-07-19 SIGNED
        # driver-state evidence change (`e = 2*(x/100)^gamma - 1`, algorithm.py
        # `resolve_scalar_evidence`): "low" (10) is now BELOW the neutral
        # midpoint (50) and yields NEGATIVE evidence, so the activation
        # candidate (whose response is +1.0 here) goes strictly negative at
        # "low" - it no longer merely sits near 0. traffic_state/night_state
        # stayed categorical/unsigned (e in {0,1}), so "low" is still exactly 0.
        ("01-drowsiness", "call_response_driving", "radio_style", "low", "high", True),
        ("02-fatigue", "call_response_driving", "radio_style", "low", "high", True),
        ("03-monotony", "call_response_driving", "radio_style", "low", "high", True),
        ("04-traffic", "call_response_driving", "radio_style", "normal", "congested", False),
        ("06-day-night", "call_response_driving", "radio_style", "day", "night", False),
    ],
)
def test_activation_vs_calm_gap_widens(service_selector, fixture_name, activation_id, calm_id, low_key, high_key, signed):
    fixture = _load(fixture_name)
    low_scores = _scores(service_selector, fixture, low_key)
    high_scores = _scores(service_selector, fixture, high_key)

    # calm candidate never responds to this field - pinned at 0 in both.
    assert calm_id in low_scores and calm_id in high_scores
    assert low_scores[calm_id] == pytest.approx(0.0, abs=1e-12)
    assert high_scores[calm_id] == pytest.approx(0.0, abs=1e-12)

    # activation candidate strictly rises low -> high. For the signed
    # driver-state fields, "low" now sits below the neutral midpoint and is
    # strictly negative (an alert/rested/un-monotonous driver actively
    # disprefers activation content); the unsigned categorical fields are
    # still pinned at exactly 0 at "low".
    if signed:
        assert low_scores[activation_id] < 0.0
    else:
        assert low_scores[activation_id] == pytest.approx(0.0, abs=1e-12)
    assert high_scores[activation_id] > low_scores[activation_id]

    # the activation-over-calm gap strictly widens.
    gap_low = low_scores[activation_id] - low_scores[calm_id]
    gap_high = high_scores[activation_id] - high_scores[calm_id]
    assert gap_high > gap_low


def test_road_highway_to_mountain_flips_moderate_vs_low_interaction(service_selector):
    """§11 item 1 (road, the two-directional situation field): humming_karaoke
    (moderate-interaction) leads on highway; the order FLIPS on mountain
    (humming goes negative, radio_style goes positive) - §5.2.2."""
    fixture = _load("05-road-highway-mountain")
    highway = _scores(service_selector, fixture, "highway")
    mountain = _scores(service_selector, fixture, "mountain")

    assert highway["humming_karaoke"] > highway["radio_style"]
    assert highway["radio_style"] == pytest.approx(0.0, abs=1e-12)

    assert mountain["humming_karaoke"] < 0.0
    assert mountain["radio_style"] > 0.0
    assert mountain["radio_style"] > mountain["humming_karaoke"]


# ---------------------------------------------------------------------------
# 7: child absent<->present
# ---------------------------------------------------------------------------


def test_child_present_widens_activation_over_calm_gap(service_selector):
    fixture = _load("07-child-present")
    absent = _scores(service_selector, fixture, "absent")
    present = _scores(service_selector, fixture, "present")

    assert absent["radio_style"] == pytest.approx(0.0, abs=1e-12)
    assert present["radio_style"] == pytest.approx(0.0, abs=1e-12)
    assert absent["call_response_driving"] == pytest.approx(0.0, abs=1e-12)
    assert present["call_response_driving"] > absent["call_response_driving"]
    assert (present["call_response_driving"] - present["radio_style"]) > (
        absent["call_response_driving"] - absent["radio_style"]
    )


# ---------------------------------------------------------------------------
# 8: oshi mode off<->on - a genuine reorder driven by signed evidence.
# ---------------------------------------------------------------------------


def test_oshi_mode_off_to_on_reorders_radio_vs_humming(service_selector):
    fixture = _load("08-oshi-mode")
    off = _scores(service_selector, fixture, "off")
    on = _scores(service_selector, fixture, "on")

    # off: signed opposing evidence (e=-1) - BOTH candidates go negative, but
    # radio_style's larger-magnitude oshi coefficient (+1.0 vs humming's
    # +0.5) makes it MORE negative, so humming_karaoke ranks above it.
    assert off["radio_style"] < 0.0
    assert off["humming_karaoke"] < 0.0
    assert off["humming_karaoke"] > off["radio_style"]

    # on: the same asymmetry now favors radio_style (more positive).
    assert on["radio_style"] > 0.0
    assert on["humming_karaoke"] > 0.0
    assert on["radio_style"] > on["humming_karaoke"]


# ---------------------------------------------------------------------------
# 9: service recency recent<->long_unused - a tie-break -> real-order flip.
# ---------------------------------------------------------------------------


def test_recency_recent_to_long_unused_reorders_music_vs_humming(service_selector):
    fixture = _load("09-recency")
    recent = _scores(service_selector, fixture, "recent")
    long_unused = _scores(service_selector, fixture, "long_unused")

    # 'recent' (e=0 for both): tie on score; candidate_id tie-break keeps
    # humming_karaoke ranked first (alphabetically before music_playlist).
    assert recent["music_playlist"] == pytest.approx(0.0, abs=1e-12)
    assert recent["humming_karaoke"] == pytest.approx(0.0, abs=1e-12)

    # 'long_unused': music_playlist gains a strictly positive novelty
    # contribution and overtakes the (still-tied-at-recent) humming_karaoke.
    assert long_unused["music_playlist"] > 0.0
    assert long_unused["music_playlist"] > long_unused["humming_karaoke"]


# ---------------------------------------------------------------------------
# 10: overall usage low<->high - negative-to-positive reorder.
# ---------------------------------------------------------------------------


def test_overall_usage_low_to_high_reorders_quiz_vs_ranking(service_selector):
    fixture = _load("10-overall-usage")
    low = _scores(service_selector, fixture, "low")
    high = _scores(service_selector, fixture, "high")

    assert low["ranking_creation"] == pytest.approx(0.0, abs=1e-12)
    assert low["quiz"] < 0.0
    assert low["ranking_creation"] > low["quiz"]

    assert high["quiz"] > 0.0
    assert high["quiz"] > high["ranking_creation"]


# ---------------------------------------------------------------------------
# 11: recovery rate low<->high - negative-to-positive reorder.
# ---------------------------------------------------------------------------


def test_recovery_rate_low_to_high_reorders_humming_vs_call_response(service_selector):
    fixture = _load("11-recovery-rate")
    low = _scores(service_selector, fixture, "low")
    high = _scores(service_selector, fixture, "high")

    assert low["call_response_driving"] == pytest.approx(0.0, abs=1e-12)
    assert low["humming_karaoke"] < 0.0
    assert low["call_response_driving"] > low["humming_karaoke"]

    assert high["humming_karaoke"] > 0.0
    assert high["humming_karaoke"] > high["call_response_driving"]


# ---------------------------------------------------------------------------
# 12: route_music vs inattentive purpose on the same snapshot - gap narrows.
# ---------------------------------------------------------------------------


def test_route_music_purpose_narrows_humming_over_music_gap(service_selector):
    fixture = _load("12-purpose-route-music-vs-inattentive")

    # The fixture's raw drowsiness_level=40/fatigue_level=30 predate the
    # 2026-07-19 SIGNED driver-state evidence change (`e = 2*(x/100)^gamma -
    # 1`): both values now sit BELOW the neutral midpoint (50), so
    # humming_karaoke's exclusive driver-state edge (music_playlist doesn't
    # respond to drowsiness/fatigue at all, see service_response_profiles)
    # flips NEGATIVE and music_playlist leads instead -- contradicting item
    # 12's "humming leads under both purposes" premise this test exercises.
    # Route/destination tags (the only other differentiator here) respond
    # identically for both candidates and cancel out of the gap, so this is
    # driven entirely by drowsiness/fatigue. Raise both above the new
    # midpoint (mirroring the §10 worked example's drowsy/fatigued driver)
    # so the scenario is a genuinely drowsy driver again, restoring the
    # documented "humming leads, route_music narrows the gap" story without
    # touching the frozen fixture file itself.
    situation_override = {"drowsiness_level": 80, "fatigue_level": 70}

    def _score_pair(purpose: str) -> tuple[float, float]:
        snapshot = copy.deepcopy(fixture["feature_snapshot"])
        snapshot["situation"].update(situation_override)
        context = build_service_context(
            trigger_purpose=purpose,
            lifecycle_stage=fixture["lifecycle_stage"],
            allowed_service_ids=fixture["allowed_service_ids"],
            feature_snapshot=snapshot,
        )
        out = service_selector.evaluate(context)
        by_id = {c["candidate_id"]: c["score"] for c in out["ranked_candidates"]}
        return by_id["humming_karaoke"], by_id["music_playlist"]

    humming_inattentive, music_inattentive = _score_pair(fixture["trigger_purpose_variants"]["inattentive"])
    humming_route, music_route = _score_pair(fixture["trigger_purpose_variants"]["route_music"])

    gap_inattentive = humming_inattentive - music_inattentive
    gap_route_music = humming_route - music_route

    # humming leads under both purposes (doc §10: "ranks well above
    # playlist") but route_music's route/destination weight rise narrows it
    # (doc §10: "narrowing the gap on the same raw snapshot").
    assert gap_inattentive > 0.0
    assert gap_route_music > 0.0
    assert gap_route_music < gap_inattentive


# ---------------------------------------------------------------------------
# 13: mountain vs highway - interaction-heavy services drop below
# low-interaction ones.
# ---------------------------------------------------------------------------


def test_mountain_drops_quiz_and_ranking_below_low_interaction_services(service_selector):
    fixture = _load("13-mountain-interaction-drop")

    # 4 candidates of interest but the manifest's default top_k=3 would
    # truncate one of the tied-at-0 low-interaction candidates off the
    # ranked list on the 'highway' variant - bump top_k to 4 for THIS
    # fixture only (a parameters override, not a change to package.json)
    # so all 4 candidates are comparable in both variants.
    params = copy.deepcopy(load_service_manifest()["parameters"])
    params["top_k"] = 4

    def _scores_top4(variant_key: str) -> dict:
        variant = fixture["variants"][variant_key]
        context = build_service_context(
            trigger_purpose=fixture["trigger_purpose"],
            lifecycle_stage=fixture["lifecycle_stage"],
            allowed_service_ids=fixture["allowed_service_ids"],
            feature_snapshot=variant["feature_snapshot"],
            parameters=params,
        )
        out = service_selector.evaluate(context)
        return {c["candidate_id"]: c["score"] for c in out["ranked_candidates"]}

    highway = _scores_top4("highway")
    mountain = _scores_top4("mountain")

    for high_interaction_id in ("quiz", "ranking_creation"):
        for low_interaction_id in ("music_playlist", "radio_style"):
            assert highway[high_interaction_id] > highway[low_interaction_id], (
                f"highway: {high_interaction_id} should lead {low_interaction_id}"
            )
            assert mountain[high_interaction_id] < mountain[low_interaction_id], (
                f"mountain: {high_interaction_id} should drop below {low_interaction_id}"
            )

    assert mountain["quiz"] < 0.0
    assert mountain["ranking_creation"] < 0.0
    assert mountain["music_playlist"] > 0.0
    assert mountain["radio_style"] > 0.0
