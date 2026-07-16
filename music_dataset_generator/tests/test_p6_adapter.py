"""P6 adapter — real evaluate over a frozen catalog produces rankings + signed scores.

Verifies the World→context mapping runs the real content-selector package and that its
signed item_fit is what the judge/certify consume (no numeric fabrication).
"""
from __future__ import annotations

from pathlib import Path

from mdg.certify import load_evaluate
from mdg.p6_adapter import build_context, make_rank_fn, score_song, world_to_snapshot
from mdg.transform import run_transform

_P6 = Path(__file__).resolve().parents[2] / "packages" / "aica_transparent_content_selector_v1"
_CACHE = Path(__file__).parent / "fixtures" / "cache"


def _catalog():
    return run_transform(_CACHE, seed=1, tier="demonstration",
                         candidate_source="isrc_resolved",
                         generated_at="2026-07-16T00:00:00Z").catalog


def _world(**driver_env):
    return {"world_id": "w", "driver": {"drowsiness_level": driver_env.get("drowsy", 0),
                                        "fatigue_level": 0},
            "environment": {"monotony_level": driver_env.get("monotony", 0),
                            "traffic_state": "normal", "road_type": "local",
                            "night_state": "day", "motion_state": "stopped"}}


def test_world_to_snapshot_maps_situation_and_history() -> None:
    world = {
        "driver": {"drowsiness_level": 80, "fatigue_level": 70},
        "environment": {"monotony_level": 90, "traffic_state": "congested",
                        "road_type": "highway", "night_state": "night",
                        "motion_state": "driving"},
        "passengers": {"child_present": True},
        "upro": {"oshi_registered": True, "oshi_mode": "on", "oshi_id": "synthetic-artist-0001"},
        "direct_item_history": {"synthetic-track-0001": {"acceptance_rate": 0.8,
                                                         "play_count_30d": 3}},
    }
    snap = world_to_snapshot(world, {})
    assert snap["situation"]["drowsiness_level"] == 80
    assert snap["situation"]["child_present"] is True
    assert snap["preference"]["oshi_id"] == "synthetic-artist-0001"
    assert snap["history"]["content_proposal_acceptance_rate"]["synthetic-track-0001"] == 0.8


def test_evaluate_ranks_whole_catalog() -> None:
    catalog = _catalog()
    evaluate = load_evaluate(_P6)
    rank_fn = make_rank_fn(evaluate, catalog)
    ranks = rank_fn(_world(drowsy=90, monotony=90))
    # every catalog song gets a distinct position (total ranking)
    assert set(ranks) == {s["spotify_track"]["id"] for s in catalog}
    assert len(set(ranks.values())) == len(catalog)  # no colliding positions


def test_score_song_returns_signed_item_fit() -> None:
    catalog = _catalog()
    evaluate = load_evaluate(_P6)
    tid = catalog[0]["spotify_track"]["id"]
    score = score_song(evaluate, _world(drowsy=90, monotony=90), catalog, tid)
    assert isinstance(score, float)
    assert -1.0 <= score <= 1.0


def test_context_has_required_p6_keys() -> None:
    ctx = build_context(_world(), _catalog())
    for key in ("hyperparameters", "feature_dispositions", "feature_snapshot",
                "selected_service_id", "eligible_candidates"):
        assert key in ctx
    assert ctx["feature_dispositions"]  # real registry loaded
