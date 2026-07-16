"""S7 — Worlds + real-grounded profiles + one-variable contrast pairs (design §4.10).

Produced **only after freeze** (they reference the frozen catalog's synthetic IDs). The
driver/traffic/night fixtures are deterministic (pure physiology/traffic cannot be
grounded); histories/oshi are grounded to real catalog IDs. `validate_world_references`
enforces that every track/artist reference resolves to a catalog ID
(`world_reference_failed` otherwise).

`build_contrast_pairs` emits the 12 one-variable pairs (data-spec §15): each pair's two
worlds differ in exactly one controlled input, the catalog/seed/trigger frozen.
"""
from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any

from mdg.errors import ErrorCode, MdgFatalError

_TRACK_RE = re.compile(r"synthetic-track-\d+")
_ARTIST_RE = re.compile(r"synthetic-artist-\d+")


# ---------------------------------------------------------------------------
# Canonical base template
# ---------------------------------------------------------------------------

def _base_template(track_ids: list[str], artist_ids: list[str]) -> dict:
    """A canonical night-highway world referencing the first catalog IDs (deterministic)."""
    history_track = track_ids[0]
    oshi_artist = artist_ids[0]
    return {
        "world_id": "world-base",
        "current_time": "2026-07-14T22:10:00Z",
        "trigger": {
            "trigger_purpose": "inattentive_driving_prevention_recovery",
            "lifecycle_stage": "active_driving_content",
        },
        "driver": {"age_band": "30s", "drowsiness_level": 80, "fatigue_level": 70},
        "environment": {
            "traffic_state": "congested", "road_type": "highway", "night_state": "night",
            "monotony_level": 90, "motion_state": "driving",
            "route_tags": ["highway"], "destination_tags": ["coast"],
        },
        "passengers": {"child_present": False, "multiple_passengers": False},
        "upro": {
            "oshi_registered": True, "oshi_mode": "on",
            "oshi_id": oshi_artist, "oshi_type": "artist", "oshi_tags": [],
        },
        "direct_item_history": {
            history_track: {
                "last_played_at": "2026-07-13T21:00:00Z",
                "play_count_30d": 3, "skipped_count_30d": 0, "changed_count_30d": 0,
                "cancelled_count_30d": 0, "acceptance_rate": 0.80, "recovery_rate": 0.70,
            }
        },
        "selected_service": {
            "selected_service_id": "humming_karaoke", "lifecycle_state": "active",
        },
    }


def _world(base: dict, world_id: str, **path_overrides: Any) -> dict:
    """Clone `base` with `world_id` and dotted-path field overrides applied."""
    world = copy.deepcopy(base)
    world["world_id"] = world_id
    for dotted, value in path_overrides.items():
        node = world
        parts = dotted.split(".")
        for part in parts[:-1]:
            node = node[part]
        node[parts[-1]] = value
    return world


# ---------------------------------------------------------------------------
# Base worlds (data-spec §14)
# ---------------------------------------------------------------------------

def build_base_worlds(*, track_ids: list[str], artist_ids: list[str]) -> list[dict]:
    """Build the ≥15 deterministic base worlds referencing catalog IDs."""
    base = _base_template(track_ids, artist_ids)
    explicit_track = track_ids[1] if len(track_ids) > 1 else track_ids[0]
    worlds = [
        _world(base, "world-daytime-commute", **{
            "environment.night_state": "day", "environment.traffic_state": "normal",
            "driver.drowsiness_level": 20, "driver.fatigue_level": 20,
            "environment.monotony_level": 30}),
        _world(base, "world-night-highway-high-drowsiness"),
        _world(base, "world-night-highway-low-drowsiness", **{"driver.drowsiness_level": 20}),
        _world(base, "world-low-fatigue", **{"driver.fatigue_level": 20}),
        _world(base, "world-high-fatigue", **{"driver.fatigue_level": 90}),
        _world(base, "world-normal-traffic", **{"environment.traffic_state": "normal"}),
        _world(base, "world-congested-traffic", **{"environment.traffic_state": "congested"}),
        _world(base, "world-highway", **{"environment.road_type": "highway"}),
        _world(base, "world-mountain-road", **{"environment.road_type": "mountain"}),
        _world(base, "world-day", **{"environment.night_state": "day"}),
        _world(base, "world-night", **{"environment.night_state": "night"}),
        _world(base, "world-low-monotony", **{"environment.monotony_level": 20}),
        _world(base, "world-high-monotony", **{"environment.monotony_level": 90}),
        _world(base, "world-child-present", **{"passengers.child_present": True}),
        _world(base, "world-oshi-enabled", **{"upro.oshi_mode": "on"}),
        _world(base, "world-oshi-disabled", **{"upro.oshi_mode": "off"}),
        _world(base, "world-stopped-post-rest", **{
            "environment.motion_state": "stopped",
            "selected_service.selected_service_id": "full_karaoke"}),
        _world(_with_history(base, explicit_track), "world-recent-play-present"),
    ]
    return worlds


def _with_history(base: dict, track_id: str) -> dict:
    world = copy.deepcopy(base)
    world["direct_item_history"][track_id] = {
        "last_played_at": "2026-07-14T21:00:00Z", "play_count_30d": 5,
        "skipped_count_30d": 0, "changed_count_30d": 0, "cancelled_count_30d": 0,
        "acceptance_rate": 0.9, "recovery_rate": 0.8,
    }
    return world


# ---------------------------------------------------------------------------
# Contrast pairs (data-spec §15)
# ---------------------------------------------------------------------------

def build_contrast_pairs(*, track_ids: list[str], artist_ids: list[str]) -> dict:
    """Return {"worlds": [...], "pairs": [...]} — 12 one-variable contrast pairs."""
    base = _base_template(track_ids, artist_ids)
    worlds: dict[str, dict] = {}
    pairs: list[dict] = []

    def add_pair(pair_id, variable, direction, a_id, a_ovr, b_id, b_ovr) -> None:
        worlds[a_id] = _world(base, a_id, **a_ovr)
        worlds[b_id] = _world(base, b_id, **b_ovr)
        pairs.append({
            "pair_id": pair_id, "variable": variable, "expected_direction": direction,
            "world_a_ref": a_id, "world_b_ref": b_id,
        })

    add_pair("pair-01-drowsiness", "drowsiness_level", "reversal_calm_active",
             "cp01-a", {"driver.drowsiness_level": 20},
             "cp01-b", {"driver.drowsiness_level": 90})
    add_pair("pair-02-fatigue", "fatigue_level", "reversal_calm_active",
             "cp02-a", {"driver.fatigue_level": 20},
             "cp02-b", {"driver.fatigue_level": 90})
    add_pair("pair-03-traffic", "traffic_state", "reversal_calm_active",
             "cp03-a", {"environment.traffic_state": "normal"},
             "cp03-b", {"environment.traffic_state": "congested"})
    add_pair("pair-04-road-type", "road_type", "reversal_active_calm",
             "cp04-a", {"environment.road_type": "highway"},
             "cp04-b", {"environment.road_type": "mountain"})
    add_pair("pair-05-day-night", "night_state", "reversal_calm_active",
             "cp05-a", {"environment.night_state": "day"},
             "cp05-b", {"environment.night_state": "night"})
    add_pair("pair-06-monotony", "monotony_level", "reversal_calm_active",
             "cp06-a", {"environment.monotony_level": 20},
             "cp06-b", {"environment.monotony_level": 90})
    add_pair("pair-07-motion", "motion_state", "full_karaoke_eligibility_change",
             "cp07-a", {"environment.motion_state": "driving"},
             "cp07-b", {"environment.motion_state": "stopped"})
    add_pair("pair-08-child-present", "child_present", "explicit_excluded_when_child_present",
             "cp08-a", {"passengers.child_present": False},
             "cp08-b", {"passengers.child_present": True})
    add_pair("pair-09-oshi-mode", "oshi_mode", "oshi_boost_removed",
             "cp09-a", {"upro.oshi_mode": "on"},
             "cp09-b", {"upro.oshi_mode": "off"})
    add_pair("pair-10-recent-play", "play_count_30d", "recency_suppression",
             "cp10-a", {f"direct_item_history.{track_ids[0]}.play_count_30d": 0},
             "cp10-b", {f"direct_item_history.{track_ids[0]}.play_count_30d": 5})
    add_pair("pair-11-acceptance", "acceptance_rate", "acceptance_boost",
             "cp11-a", {f"direct_item_history.{track_ids[0]}.acceptance_rate": 0.0},
             "cp11-b", {f"direct_item_history.{track_ids[0]}.acceptance_rate": 0.95})
    add_pair("pair-12-route-tag", "route_tags", "no_change_when_genre_off",
             "cp12-a", {"environment.route_tags": ["highway"]},
             "cp12-b", {"environment.route_tags": ["mountain"]})

    return {"worlds": list(worlds.values()), "pairs": pairs}


# ---------------------------------------------------------------------------
# Reference validation + persistence
# ---------------------------------------------------------------------------

def _referenced_ids(world: dict) -> tuple[set[str], set[str]]:
    blob = json.dumps(world)
    return set(_TRACK_RE.findall(blob)), set(_ARTIST_RE.findall(blob))


def validate_world_references(
    world: dict, *, track_ids: set[str], artist_ids: set[str]
) -> None:
    """Raise world_reference_failed if any track/artist reference is not in the catalog."""
    ref_tracks, ref_artists = _referenced_ids(world)
    dangling_tracks = ref_tracks - track_ids
    dangling_artists = ref_artists - artist_ids
    if dangling_tracks or dangling_artists:
        raise MdgFatalError(
            ErrorCode.world_reference_failed,
            f"world '{world.get('world_id')}' references unknown IDs: "
            f"tracks={sorted(dangling_tracks)} artists={sorted(dangling_artists)}",
        )


def apply_profiles(worlds: list[dict], profiles: dict) -> list[dict]:
    """Merge the S7 agent's composed profiles into the deterministic base worlds.

    `profiles` maps `world_id → {direct_item_history?, upro?, usage_by_genre?,
    scene_genre_usage?}`. Only history/oshi/genre-usage blocks are merged; the
    deterministic driver/environment/night fields are never overwritten. Worlds without a
    composed profile keep the base template. The caller re-runs
    `validate_world_references` afterwards so any dangling reference the agent introduced
    fails loudly.
    """
    merged = []
    for world in worlds:
        profile = profiles.get(world["world_id"])
        if not profile:
            merged.append(world)
            continue
        world = copy.deepcopy(world)
        for block in ("direct_item_history", "upro", "usage_by_genre", "scene_genre_usage"):
            if block in profile:
                world[block] = profile[block]
        merged.append(world)
    return merged


def save_world(world: dict, path: Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(
        json.dumps(world, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def load_world(path: Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))
