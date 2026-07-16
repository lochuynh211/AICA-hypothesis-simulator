"""T052 [US6] — worlds + real-grounded references (design §4.10, data-spec §13–14).

Worlds are produced only after freeze (they need the frozen catalog IDs); every
history/oshi reference must resolve to a catalog ID (`world_reference_failed` otherwise);
a saved world reloads identically.
"""
from __future__ import annotations

import json

import pytest

from mdg.errors import ErrorCode, MdgFatalError
from mdg.worlds import (
    build_base_worlds,
    load_world,
    save_world,
    validate_world_references,
)


def _catalog_ids():
    track_ids = {f"synthetic-track-{i:04d}" for i in range(1, 20)}
    artist_ids = {f"synthetic-artist-{i:04d}" for i in range(1, 13)}
    return track_ids, artist_ids


def test_base_worlds_reference_only_catalog_ids() -> None:
    track_ids, artist_ids = _catalog_ids()
    worlds = build_base_worlds(track_ids=sorted(track_ids), artist_ids=sorted(artist_ids))
    assert len(worlds) >= 15  # data-spec §14
    for world in worlds:
        validate_world_references(world, track_ids=track_ids, artist_ids=artist_ids)


def test_dangling_track_reference_fails() -> None:
    track_ids, artist_ids = _catalog_ids()
    worlds = build_base_worlds(track_ids=sorted(track_ids), artist_ids=sorted(artist_ids))
    world = json.loads(json.dumps(worlds[1]))
    world["direct_item_history"] = {"synthetic-track-9999": {"play_count_30d": 1}}
    with pytest.raises(MdgFatalError) as exc:
        validate_world_references(world, track_ids=track_ids, artist_ids=artist_ids)
    assert exc.value.code == ErrorCode.world_reference_failed


def test_dangling_oshi_reference_fails() -> None:
    track_ids, artist_ids = _catalog_ids()
    worlds = build_base_worlds(track_ids=sorted(track_ids), artist_ids=sorted(artist_ids))
    world = json.loads(json.dumps(worlds[0]))
    world["upro"] = {"oshi_registered": True, "oshi_mode": "on",
                     "oshi_id": "synthetic-artist-9999", "oshi_type": "artist"}
    with pytest.raises(MdgFatalError) as exc:
        validate_world_references(world, track_ids=track_ids, artist_ids=artist_ids)
    assert exc.value.code == ErrorCode.world_reference_failed


def test_world_save_reload_roundtrip(tmp_path) -> None:
    track_ids, artist_ids = _catalog_ids()
    worlds = build_base_worlds(track_ids=sorted(track_ids), artist_ids=sorted(artist_ids))
    path = tmp_path / "world.json"
    save_world(worlds[0], path)
    assert load_world(path) == worlds[0]


def test_worlds_deterministic() -> None:
    track_ids, artist_ids = _catalog_ids()
    a = build_base_worlds(track_ids=sorted(track_ids), artist_ids=sorted(artist_ids))
    b = build_base_worlds(track_ids=sorted(track_ids), artist_ids=sorted(artist_ids))
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
