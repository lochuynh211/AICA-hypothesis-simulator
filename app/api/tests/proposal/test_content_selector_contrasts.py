"""P6 T018 (US2) — Context contrasts (§11).

Six single-field driver/environment contrasts each REVERSE the calm/active ordering;
a route-only change (genre extension off) causes no rank change; the directional
hypothesis knob behaves as specified.

Method: an anchor song carries a constant acceptance bonus so that at the "low" pole
(mood evidence ~0) the anchor wins, while at the "high" pole the toggled mood feature
dominates and flips the winner between the active and calm song. Only one field changes
between the two worlds of each contrast.
"""
from __future__ import annotations

import copy

from tests.proposal.conftest import (
    load_catalog,
    load_content_selector,
    manifest_hyperparameters,
    build_content_context,
)

CS = load_content_selector()
HP_ALL = manifest_hyperparameters()
CATALOG = load_catalog("fixtures/catalog/smoke-catalog.json")

ACTIVE = "synthetic-track-1001"  # active-bright
CALM = "synthetic-track-1006"    # calm-bright

_HP6 = copy.deepcopy(HP_ALL)
_HP6["plan_item_count"] = 6  # rank the whole catalog so both songs appear


def _rank(result, tid):
    for it in result["ordered_items"]:
        if it["item_id"] == tid:
            return it["position"]
    return 999


def _run(situation, anchor=None, anchor_rate=55):
    # A weak anchor (rate 55 -> evidence +0.10) decides the "low" pole where mood
    # evidence is ~0, while staying small enough that the toggled mood feature
    # dominates and flips the winner at the "high" pole.
    history = {}
    if anchor is not None:
        history = {"content_proposal_acceptance_rate": {anchor: anchor_rate}}
    snap = {"catalog": CATALOG, "situation": situation, "history": history}
    ctx = build_content_context(
        selected_service_id="music_playlist",
        feature_snapshot=snap,
        hyperparameters=_HP6,
    )
    return CS.evaluate(ctx)


def _neutral(**over):
    base = {"drowsiness_level": 0, "fatigue_level": 0, "monotony_level": 0,
            "traffic_state": "normal", "road_type": "local", "night_state": "day",
            "motion_state": "stopped"}
    base.update(over)
    return base


def _assert_flip(low_world, high_world, anchor, active_wins_pole):
    """active_wins_pole: 'high' if the active song should win at the high world, else 'low'."""
    low = _run(low_world, anchor=anchor)
    high = _run(high_world, anchor=anchor)
    if active_wins_pole == "high":
        assert _rank(high, ACTIVE) < _rank(high, CALM), "active should win at high pole"
        assert _rank(low, CALM) < _rank(low, ACTIVE), "calm should win at low pole"
    else:
        assert _rank(low, ACTIVE) < _rank(low, CALM), "active should win at low pole"
        assert _rank(high, CALM) < _rank(high, ACTIVE), "calm should win at high pole"


def test_drowsiness_contrast_reverses():
    # active-wanting; anchor calm so low pole -> calm wins, high pole -> active wins
    _assert_flip(_neutral(drowsiness_level=0), _neutral(drowsiness_level=100),
                 anchor=CALM, active_wins_pole="high")


def test_monotony_contrast_reverses():
    _assert_flip(_neutral(monotony_level=0), _neutral(monotony_level=100),
                 anchor=CALM, active_wins_pole="high")


def test_fatigue_contrast_reverses():
    # calm-wanting; anchor active so low pole -> active wins, high pole -> calm wins
    _assert_flip(_neutral(fatigue_level=0), _neutral(fatigue_level=100),
                 anchor=ACTIVE, active_wins_pole="low")


def test_traffic_contrast_reverses():
    _assert_flip(_neutral(traffic_state="normal"), _neutral(traffic_state="congested"),
                 anchor=ACTIVE, active_wins_pole="low")


def test_night_contrast_reverses():
    _assert_flip(_neutral(night_state="day"), _neutral(night_state="night"),
                 anchor=ACTIVE, active_wins_pole="low")


def test_road_highway_mountain_reverses():
    # bidirectional demand: highway wants active, mountain wants calm (no anchor needed)
    highway = _run(_neutral(road_type="highway"))
    mountain = _run(_neutral(road_type="mountain"))
    assert _rank(highway, ACTIVE) < _rank(highway, CALM)
    assert _rank(mountain, CALM) < _rank(mountain, ACTIVE)


def test_route_only_change_no_rank_change_extension_off():
    # genre extension OFF: route is context-only, so changing route_tags cannot reorder.
    w_a = _run(_neutral(drowsiness_level=70, route_tags=["highway"]))
    w_b = _run(_neutral(drowsiness_level=70, route_tags=["mountain"]))
    assert [it["item_id"] for it in w_a["ordered_items"]] == [it["item_id"] for it in w_b["ordered_items"]]


def test_directional_hypothesis_keep_alert_flips_fatigue_sign():
    # Under keep_alert, fatigue's arousal sign flips (+), so high fatigue rewards ACTIVE.
    hp = copy.deepcopy(_HP6)
    hp["directional_hypothesis"] = "keep_alert"
    snap = {"catalog": CATALOG, "situation": _neutral(fatigue_level=100),
            "history": {"content_proposal_acceptance_rate": {CALM: 100}}}
    ctx = build_content_context(selected_service_id="music_playlist", feature_snapshot=snap, hyperparameters=hp)
    result = CS.evaluate(ctx)
    # keep_alert => fatigue rewards active despite the calm anchor bonus
    assert _rank(result, ACTIVE) < _rank(result, CALM)
