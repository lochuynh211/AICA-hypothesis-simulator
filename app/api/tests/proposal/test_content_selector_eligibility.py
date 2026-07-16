"""P6 T020 (US3) — Hard eligibility & safety (§7, §13).

Eligibility runs before scoring and cannot be reversed by score; typed outcomes for
motion/insufficient/no-proposal/invalid-catalog; karaoke flags never change score.
"""
from __future__ import annotations

import copy

import pytest

from tests.proposal.conftest import (
    build_content_context,
    load_catalog,
    load_content_selector,
    manifest_hyperparameters,
)

CS = load_content_selector()
HP = manifest_hyperparameters()
CATALOG = load_catalog("fixtures/catalog/smoke-catalog.json")


def _ctx(catalog, situation, service="music_playlist", count=None, extra=None):
    hp = HP
    if count is not None:
        hp = copy.deepcopy(HP)
        hp["plan_item_count"] = count
    snap = {"catalog": catalog, "situation": situation}
    if extra:
        snap.update(extra)
    return build_content_context(selected_service_id=service, feature_snapshot=snap, hyperparameters=hp)


def _excluded_reasons(result, tid):
    for e in result["excluded_items"]:
        if e["item_id"] == tid:
            return e["reason_codes"]
    return None


def test_explicit_under_child_excluded_and_not_in_plan():
    cat = copy.deepcopy(CATALOG)
    cat["synthetic-track-1001"]["spotify_track"]["explicit"] = True
    result = CS.evaluate(_ctx(cat, {"drowsiness_level": 100, "child_present": True,
                                     "motion_state": "stopped"}, count=5))
    ids = [it["item_id"] for it in result["ordered_items"]]
    assert "synthetic-track-1001" not in ids
    assert "explicit_under_child" in _excluded_reasons(result, "synthetic-track-1001")


def test_full_karaoke_while_driving_refused():
    result = CS.evaluate(_ctx(CATALOG, {"motion_state": "driving"}, service="full_karaoke"))
    assert result["decision_type"] == "full_karaoke_requires_stopped"
    assert result["ordered_items"] == []


def test_full_karaoke_stopped_ok():
    result = CS.evaluate(_ctx(CATALOG, {"motion_state": "stopped"}, service="full_karaoke", count=5))
    assert result["decision_type"] == "complete_plan"
    assert result["mode"]["stopped_only"] is True


def test_not_playable_excluded():
    cat = copy.deepcopy(CATALOG)
    cat["synthetic-track-1002"]["spotify_track"]["is_playable"] = False
    result = CS.evaluate(_ctx(cat, {"motion_state": "stopped"}, count=5))
    assert "not_playable" in _excluded_reasons(result, "synthetic-track-1002")


def test_market_unavailable_excluded():
    cat = copy.deepcopy(CATALOG)
    cat["synthetic-track-1003"]["spotify_track"]["available_markets"] = ["US"]
    result = CS.evaluate(_ctx(cat, {"motion_state": "stopped"}, count=5, extra={"market": "JP"}))
    assert "market_unavailable" in _excluded_reasons(result, "synthetic-track-1003")


def test_restriction_excluded():
    cat = copy.deepcopy(CATALOG)
    cat["synthetic-track-1004"]["spotify_track"]["restrictions"] = {"reason": "market"}
    result = CS.evaluate(_ctx(cat, {"motion_state": "stopped"}, count=5))
    assert "restricted" in _excluded_reasons(result, "synthetic-track-1004")


def test_recent_skip_excluded_but_older_skip_scored():
    # in-window skip -> excluded; older skip -> not excluded (scored -0.5 on skipped leaf)
    situation = {"motion_state": "stopped"}
    snap = {"catalog": CATALOG, "situation": situation,
            "preference": {"skipped_items": [
                {"track_id": "synthetic-track-1001", "skipped_at": "2026-07-14T22:00:00Z"},   # ~10 min before sim time -> in window
                {"track_id": "synthetic-track-1002", "skipped_at": "2026-06-01T00:00:00Z"},   # weeks before -> older
            ]}}
    ctx = build_content_context(feature_snapshot=snap,
                                hyperparameters={**HP, "plan_item_count": 5})
    result = CS.evaluate(ctx)
    assert "recent_skip" in (_excluded_reasons(result, "synthetic-track-1001") or [])
    ids = [it["item_id"] for it in result["ordered_items"]]
    assert "synthetic-track-1002" in ids  # older skip not excluded


def test_duplicate_candidate_excluded_once():
    ctx = build_content_context(
        feature_snapshot={"catalog": CATALOG, "situation": {"motion_state": "stopped"}},
        eligible_candidates=[{"candidate_id": "synthetic-track-1001"},
                             {"candidate_id": "synthetic-track-1001"},
                             {"candidate_id": "synthetic-track-1002"},
                             {"candidate_id": "synthetic-track-1003"}],
        hyperparameters={**HP, "plan_item_count": 3},
    )
    result = CS.evaluate(ctx)
    ids = [it["item_id"] for it in result["ordered_items"]]
    assert ids.count("synthetic-track-1001") == 1
    assert "duplicate" in (_excluded_reasons(result, "synthetic-track-1001") or [])


def test_insufficient_eligible_items():
    small = {k: CATALOG[k] for k in ["synthetic-track-1001", "synthetic-track-1002"]}
    result = CS.evaluate(_ctx(small, {"motion_state": "stopped"}, count=5))
    assert result["decision_type"] == "insufficient_eligible_items"


def test_no_proposal_when_all_excluded():
    cat = copy.deepcopy(CATALOG)
    for song in cat.values():
        song["spotify_track"]["is_playable"] = False
    result = CS.evaluate(_ctx(cat, {"motion_state": "stopped"}, count=5))
    assert result["decision_type"] == "no_proposal"


def test_invalid_catalog_unknown_candidate():
    ctx = build_content_context(
        feature_snapshot={"catalog": CATALOG, "situation": {"motion_state": "stopped"}},
        eligible_candidates=[{"candidate_id": "synthetic-track-DOES-NOT-EXIST"}],
    )
    result = CS.evaluate(ctx)
    assert result["decision_type"] == "invalid_catalog"


def test_invalid_catalog_missing_trait_field():
    cat = copy.deepcopy(CATALOG)
    del cat["synthetic-track-1001"]["spotify_audio_features"]["energy"]
    result = CS.evaluate(_ctx(cat, {"motion_state": "stopped"}, count=5))
    assert result["decision_type"] == "invalid_catalog"


def test_humming_flag_zero_excludes_for_humming():
    cat = copy.deepcopy(CATALOG)
    cat["synthetic-track-1001"]["simulation_flags"]["humming_karaoke_available"] = 0
    result = CS.evaluate(_ctx(cat, {"motion_state": "stopped"}, service="humming_karaoke", count=5))
    assert "humming_unavailable" in _excluded_reasons(result, "synthetic-track-1001")


def test_karaoke_flags_never_change_playlist_score():
    # For a playlist, karaoke flags are irrelevant and must not change item_fit.
    base = CS.evaluate(_ctx(CATALOG, {"drowsiness_level": 80, "motion_state": "stopped"}, count=5))
    cat = copy.deepcopy(CATALOG)
    for song in cat.values():
        song["simulation_flags"]["humming_karaoke_available"] = 0
        song["simulation_flags"]["full_karaoke_available"] = 0
    flagged = CS.evaluate(_ctx(cat, {"drowsiness_level": 80, "motion_state": "stopped"}, count=5))
    base_fits = {it["item_id"]: it["item_fit"] for it in base["ordered_items"]}
    flagged_fits = {it["item_id"]: it["item_fit"] for it in flagged["ordered_items"]}
    assert base_fits == flagged_fits
