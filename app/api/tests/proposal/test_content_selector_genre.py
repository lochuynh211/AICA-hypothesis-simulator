"""P6 T025 (US5) — genre_affinity_v1 opt-in extension (§5.7).

Extension OFF: the six genre leaves are context-only and ordering equals the
Spotify-only baseline. ON: they contribute via best-match genre affinity;
empty G_song → missing_neutral with the weight retained (no redistribution).
Child safety is unchanged either way.
"""
from __future__ import annotations

import copy

from tests.proposal.conftest import (
    build_content_context,
    load_catalog,
    load_content_selector,
    manifest_hyperparameters,
)

CS = load_content_selector()
HP = manifest_hyperparameters()
CATALOG = load_catalog("fixtures/catalog/smoke-catalog.json")

GENRE_FIDS = {"route_tags", "destination_tags", "child_present", "hobby_interest_tags",
              "content_tag_usage_level", "scene_content_tag_usage_level"}

ACTIVE = "synthetic-track-1001"  # artist synthetic-artist-1001
LOW = "synthetic-track-1003"     # ranks near the bottom of the Spotify-only baseline


def _run(*, extensions=None, gav1=None, situation=None, catalog=None):
    snap = {"catalog": catalog or CATALOG,
            "situation": situation or {"drowsiness_level": 60, "motion_state": "stopped",
                                       "route_tags": ["highway"]}}
    if gav1 is not None:
        snap["genre_affinity_v1"] = gav1
    ctx = build_content_context(
        selected_service_id="music_playlist",
        feature_snapshot=snap,
        enabled_feature_extensions=extensions or [],
        hyperparameters={**HP, "plan_item_count": 6},
    )
    return CS.evaluate(ctx)


def _ids(result):
    return [it["item_id"] for it in result["ordered_items"]]


def test_extension_off_genre_leaves_are_context_only():
    result = _run(extensions=[])
    prov = result["algorithm_provenance"]
    active = set(prov["active_features"])
    ctx_only = set(prov["context_only_features"])
    for fid in GENRE_FIDS:
        assert fid not in active, f"{fid} must not be active when extension off"
        assert fid in ctx_only, f"{fid} must be context_only when extension off"


def test_extension_on_empty_song_genres_is_missing_neutral_no_redistribution():
    off = _run(extensions=[])
    # extension on but no artist genres -> every G_song empty -> missing_neutral
    on = _run(extensions=["genre_affinity_v1"], gav1={"artist_genres": {}})
    # ordering unchanged (genre leaves contribute nothing either way)
    assert _ids(on) == _ids(off)
    prov = on["algorithm_provenance"]
    missing = set(prov["missing_features"])
    active = set(prov["active_features"])
    weights = prov["normalized_effective_weights"]
    # leaves with no evidence at all are missing_neutral, but their weight is retained
    for fid in {"content_tag_usage_level", "scene_content_tag_usage_level",
                "destination_tags", "hobby_interest_tags"}:
        assert fid in missing, f"{fid} should be missing_neutral (empty G_song)"
        assert weights.get(fid, 0.0) > 0.0, f"{fid} weight must be retained (no redistribution)"
    # route_tags has recognized evidence (highway) though best-match is neutral → active
    assert "route_tags" in active
    assert weights.get("route_tags", 0.0) > 0.0


def test_extension_on_best_match_promotes_matching_genre():
    off = _run(extensions=[])
    gav1 = {"artist_genres": {"synthetic-artist-1003": ["j-rock"]}}  # highway → j-rock 0.7
    on = _run(extensions=["genre_affinity_v1"], gav1=gav1)
    # the low-ranked j-rock song should rise strictly under the extension
    off_rank = _ids(off).index(LOW)
    on_rank = _ids(on).index(LOW)
    assert on_rank < off_rank, "matching-genre song should rise under the extension"
    # route_tags is now an active feature
    assert "route_tags" in set(on["algorithm_provenance"]["active_features"])


def test_child_safety_unchanged_by_extension():
    cat = copy.deepcopy(CATALOG)
    cat[ACTIVE]["spotify_track"]["explicit"] = True
    sit = {"child_present": True, "motion_state": "stopped", "route_tags": ["highway"]}
    off = _run(extensions=[], situation=sit, catalog=cat)
    on = _run(extensions=["genre_affinity_v1"],
              gav1={"artist_genres": {"synthetic-artist-1001": ["j-rock"]}},
              situation=sit, catalog=cat)
    for result in (off, on):
        excl = {e["item_id"] for e in result["excluded_items"]}
        assert ACTIVE in excl
        assert ACTIVE not in _ids(result)
