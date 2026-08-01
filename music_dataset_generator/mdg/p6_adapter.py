"""P6 context adapter — build a real content-selector context from an mdg World.

Maps an mdg `World` (§13 shape) + the frozen catalog into the P6 content-selector's
`context` (the `feature_snapshot.situation/preference/history` contract the algorithm
reads), loads the committed disposition registry + manifest hyperparameters, and runs
`evaluate` to rank/score songs. This lets S9 certify assert **real** contrast reversals
and S8 judge reveal **real** P6 scores — no numeric tuning, the algorithm decides.

All inputs are frozen committed artifacts; the adapter performs no network/LLM call.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable

# A score floor for candidates the selector excluded (eligibility) so ranking is total.
_EXCLUDED_SCORE = -2.0


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_dispositions(path: Path | None = None) -> list[dict]:
    """Load the committed content-feature disposition registry entries."""
    path = Path(path) if path else (
        _repo_root() / "proposal_contracts" / "dispositions"
        / "content_feature_dispositions.v1.json"
    )
    return json.loads(path.read_text(encoding="utf-8"))["entries"]


def load_manifest(package_dir: Path | None = None) -> dict:
    """Load the P6 package manifest (package.json)."""
    package_dir = Path(package_dir) if package_dir else (
        _repo_root() / "packages" / "aica_transparent_content_selector_v1"
    )
    return json.loads((package_dir / "package.json").read_text(encoding="utf-8"))


def manifest_hyperparameters(manifest: dict) -> dict:
    return {h["key"]: h["default"] for h in manifest["hyperparameters"]}


def world_to_snapshot(world: dict, catalog_map: dict[str, dict]) -> dict:
    """Map an mdg World + catalog into the P6 feature_snapshot (situation/preference/history)."""
    driver = world.get("driver", {})
    env = world.get("environment", {})
    passengers = world.get("passengers", {})
    upro = world.get("upro", {})
    history_src = world.get("direct_item_history", {}) or {}

    situation = {
        "drowsiness_level": driver.get("drowsiness_level", 0),
        "fatigue_level": driver.get("fatigue_level", 0),
        "monotony_level": env.get("monotony_level", 0),
        "traffic_state": env.get("traffic_state", "normal"),
        "road_type": env.get("road_type", "local"),
        "night_state": env.get("night_state", "day"),
        "motion_state": env.get("motion_state", "stopped"),
        "route_tags": env.get("route_tags", []),
        "destination_tags": env.get("destination_tags", []),
        "child_present": passengers.get("child_present", False),
    }
    # feature 025 slice S2: the real P6 selector's oshi leaf now reads
    # preference["oshi_artists"] (a list of {artist_id, enthusiasm, ...}),
    # not the old single oshi_id/oshi_type pair — mdg's own `upro` schema
    # still carries the single pair (an mdg-internal build-time shape), so
    # translate it here. A single artist at enthusiasm 1.0 reproduces the
    # old binary match exactly; no oshi_id -> an empty list (gate stays 0).
    oshi_id = upro.get("oshi_id")
    oshi_artists = (
        [{"artist_id": oshi_id, "oshi_type": upro.get("oshi_type", "artist"), "enthusiasm": 1.0}]
        if oshi_id
        else []
    )
    preference = {
        "oshi_registered": upro.get("oshi_registered", False),
        "oshi_mode": upro.get("oshi_mode", "off"),
        "oshi_artists": oshi_artists,
        "played_items": [
            {"item_id": tid, "last_played_at": h.get("last_played_at"),
             "play_count_30d": h.get("play_count_30d", 0)}
            for tid, h in history_src.items() if h.get("play_count_30d")
        ],
        "skipped_items": [],
    }
    history = {
        "content_proposal_acceptance_rate": {
            tid: h["acceptance_rate"] for tid, h in history_src.items()
            if h.get("acceptance_rate") is not None
        },
        "content_recovery_rate": {
            tid: h["recovery_rate"] for tid, h in history_src.items()
            if h.get("recovery_rate") is not None
        },
    }
    return {"catalog": catalog_map, "situation": situation,
            "preference": preference, "history": history}


def catalog_map(catalog: list[dict]) -> dict[str, dict]:
    """Build the {track_id: Song} map the selector expects."""
    return {song["spotify_track"]["id"]: song for song in catalog}


def build_context(
    world: dict,
    catalog: list[dict],
    *,
    service_id: str = "music_playlist",
    dispositions: list[dict] | None = None,
    manifest: dict | None = None,
    plan_item_count: int | None = None,
) -> dict:
    """Assemble a P6 `context` for `evaluate`.

    `plan_item_count` defaults to the catalog size (rank every song); callers use the
    two-pass `_evaluate_ranked` below to shrink it to the eligible count when the catalog
    contains ineligible songs (negative fixtures, child+explicit), so P6 returns a real
    ranking instead of `insufficient_eligible_items`.
    """
    manifest = manifest or load_manifest()
    dispositions = dispositions if dispositions is not None else load_dispositions()
    hp = dict(manifest_hyperparameters(manifest))
    hp["plan_item_count"] = plan_item_count if plan_item_count is not None else max(1, len(catalog))
    cmap = catalog_map(catalog)
    trigger = world.get("trigger", {})
    return {
        "contract_version": manifest.get("contract_version", "1.0.0"),
        "opportunity_id": f"certify-{world.get('world_id', 'w')}",
        "simulation_time": world.get("current_time", "2026-07-14T22:10:00Z"),
        "trigger_purpose": trigger.get("trigger_purpose", "rest_recommended"),
        "lifecycle_stage": trigger.get("lifecycle_stage", "before_rest_until_stop"),
        "allowed_service_ids": [service_id],
        "selected_service_id": service_id,
        "feature_snapshot": world_to_snapshot(world, cmap),
        "feature_provenance": {},
        "enabled_feature_extensions": [],
        "eligible_candidates": [{"candidate_id": tid} for tid in cmap],
        "excluded_candidates": [],
        "parameters": manifest.get("parameters", {}),
        "hyperparameters": hp,
        "package_runtime_state": {},
        "feature_dispositions": dispositions,
        "catalog_version": "p2-frozen",
        "run_seed": "certify",
    }


def _evaluate_ranked(evaluate: Callable, world: dict, catalog: list[dict],
                     **ctx_kwargs) -> dict:
    """Run P6 evaluate ranking ALL eligible songs, adapting plan_item_count.

    P6 returns `insufficient_eligible_items` (0 items) when eligible < plan_item_count. A
    quota-compliant catalog always has ineligible songs (negatives, child+explicit), so we
    retry with plan_item_count = eligible_count = len(catalog) − len(excluded_items). The
    returned ordered_items then cover every genuinely-eligible song with its real item_fit;
    only truly-excluded songs are absent (and get the exclusion sentinel downstream).
    """
    result = evaluate(build_context(world, catalog, **ctx_kwargs))
    if result.get("ordered_items"):
        return result
    if result.get("decision_type") == "insufficient_eligible_items":
        eligible = len(catalog) - len(result.get("excluded_items", []))
        if eligible >= 1:
            return evaluate(build_context(
                world, catalog, plan_item_count=eligible, **ctx_kwargs))
    return result  # no_proposal / all excluded → 0 items (all songs get the sentinel)


def make_rank_fn(
    evaluate: Callable, catalog: list[dict], **ctx_kwargs
) -> Callable[[dict], dict[str, int]]:
    """Return rank_fn(world) -> {track_id: position} backed by the real P6 evaluate."""
    def rank_fn(world: dict) -> dict[str, int]:
        result = _evaluate_ranked(evaluate, world, catalog, **ctx_kwargs)
        ranks = {it["item_id"]: it["position"] for it in result.get("ordered_items", [])}
        # Excluded songs get a position after all ranked ones (deterministic, by id).
        # P6 positions are 1-indexed, so start past the current max (1 when none ranked).
        nxt = (max(ranks.values()) + 1) if ranks else 1
        for tid in sorted(t["spotify_track"]["id"] for t in catalog):
            if tid not in ranks:
                ranks[tid] = nxt
                nxt += 1
        return ranks
    return rank_fn


def score_song(evaluate: Callable, world: dict, catalog: list[dict], track_id: str,
               **ctx_kwargs) -> float:
    """Return the signed item_fit the P6 selector assigns `track_id` in `world`.

    An eligible song returns its real item_fit ∈ [−1, +1]; a song excluded by eligibility
    (e.g. an explicit track when a child is present) returns the exclusion sentinel −2.0,
    which is semantically "must not be proposed" — not a fabricated fit.
    """
    result = _evaluate_ranked(evaluate, world, catalog, **ctx_kwargs)
    for item in result.get("ordered_items", []):
        if item["item_id"] == track_id:
            return float(item.get("item_fit", 0.0))
    return _EXCLUDED_SCORE  # excluded by eligibility
