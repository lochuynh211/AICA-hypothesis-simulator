"""P6 T027 (US6) — Deterministic, replayable plan (§8).

Identical frozen inputs reproduce a byte-equivalent plan; signed-zero is
normalised to +0; ties break by ascending Track ID.
"""
from __future__ import annotations

import copy
import json

from tests.proposal.conftest import (
    build_content_context,
    load_catalog,
    load_content_selector,
    manifest_hyperparameters,
)

CS = load_content_selector()
HP = manifest_hyperparameters()
CATALOG = load_catalog("fixtures/catalog/smoke-catalog.json")


def _ctx(catalog=None, count=5):
    snap = {"catalog": catalog or CATALOG,
            "situation": {"drowsiness_level": 80, "fatigue_level": 30, "monotony_level": 60,
                          "traffic_state": "congested", "road_type": "highway",
                          "night_state": "night", "motion_state": "stopped"}}
    return build_content_context(selected_service_id="music_playlist", feature_snapshot=snap,
                                 hyperparameters={**HP, "plan_item_count": count})


def _dumps(obj):
    return json.dumps(obj, sort_keys=True, ensure_ascii=False)


def test_two_runs_are_byte_equivalent():
    a = CS.evaluate(_ctx())
    b = CS.evaluate(_ctx())
    assert _dumps(a) == _dumps(b)


def _walk_floats(obj):
    if isinstance(obj, dict):
        for v in obj.values():
            yield from _walk_floats(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk_floats(v)
    elif isinstance(obj, float):
        yield obj


def test_no_negative_zero_anywhere():
    result = CS.evaluate(_ctx())
    import math
    for v in _walk_floats(result):
        if v == 0.0:
            assert math.copysign(1.0, v) > 0.0, "found signed negative zero"


def test_tie_break_by_ascending_track_id():
    # Two songs with identical audio features → identical item_fit → smaller id ranks first.
    base = copy.deepcopy(CATALOG["synthetic-track-1001"])
    twin_a = copy.deepcopy(base)
    twin_b = copy.deepcopy(base)
    for twin, tid in ((twin_a, "synthetic-track-aaaa"), (twin_b, "synthetic-track-zzzz")):
        uri = f"spotify:track:{tid}"
        twin["spotify_track"]["id"] = tid
        twin["spotify_track"]["uri"] = uri
        twin["spotify_audio_features"]["id"] = tid
        twin["spotify_audio_features"]["uri"] = uri
    catalog = {"synthetic-track-aaaa": twin_a, "synthetic-track-zzzz": twin_b,
               "synthetic-track-1002": copy.deepcopy(CATALOG["synthetic-track-1002"]),
               "synthetic-track-1003": copy.deepcopy(CATALOG["synthetic-track-1003"])}
    result = CS.evaluate(_ctx(catalog=catalog, count=4))
    ids = [it["item_id"] for it in result["ordered_items"]]
    fits = {it["item_id"]: it["item_fit"] for it in result["ordered_items"]}
    assert fits["synthetic-track-aaaa"] == fits["synthetic-track-zzzz"]
    assert ids.index("synthetic-track-aaaa") < ids.index("synthetic-track-zzzz")


def test_signed_zero_normalised_in_contributions():
    # every numeric field that could be -0.0 is normalised
    result = CS.evaluate(_ctx())
    for it in result["ordered_items"]:
        for c in it["feature_contributions"]:
            for key in ("e_i", "a_i", "r_i", "contribution"):
                v = c[key]
                assert not (v == 0.0 and str(v).startswith("-")), f"{key} is -0.0"
