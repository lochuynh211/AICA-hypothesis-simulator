"""TDD: T036 — the milestone-exit contrast demonstration (SC-004).

Builds two worlds via CLONE (``WorldCloneStore``) that differ in exactly ONE
scored driver-profile dimension (``driver_profile.oshi_id``), runs
STEP 1 (mock service selector, picking ``music_playlist``) -> STEP 2 (the
REAL transparent content selector) on each, and asserts:

  - the two resulting content plans differ;
  - the differing feature (oshi match) is visible in the per-item
    reasoning/contributions of whichever plan surfaces the newly-matched
    artist's track(s).

This is the headline proof that P3 delivers: a different driver profile
produces a visibly different, deterministic real content proposal.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app
from aica_api.models.proposal.world import FieldOverride
from aica_api.services.world_clone_store import WorldCloneStore
from aica_api.services.world_seed_store import WorldSeedStore

client = TestClient(app)

_REAL_CONTENT_PACKAGE_ID = "aica_transparent_content_selector_v1"
_BASE_SEED_ID = "seed-night-highway-oshi"


@pytest.fixture(autouse=True)
def isolate_proposal_runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path / "runs"))
    yield


def _create_and_select(world_dict: dict, *, selected_service_id: str = "music_playlist") -> dict:
    resp = client.post(
        "/api/proposal/runs",
        json={
            "world": world_dict,
            "service_package_id": "mock_service_selector_v1",
            "content_package_id": _REAL_CONTENT_PACKAGE_ID,
            "mode": "interactive",
            "run_seed": "seed-contrast",
            "simulation_time": "2026-07-16T10:00:00Z",
        },
    )
    assert resp.status_code == 201, resp.text
    run = resp.json()

    resp2 = client.post(
        f"/api/proposal/runs/{run['run_id']}/select-service",
        json={"selected_service_id": selected_service_id},
    )
    assert resp2.status_code == 200, resp2.text
    return resp2.json()


def test_contrast_demo_two_clones_differing_in_oshi_id_yield_different_plans(tmp_path):
    seed_store = WorldSeedStore(settings.proposal_contracts_dir / "seeds")
    seed = seed_store.get_seed(_BASE_SEED_ID)
    assert seed is not None
    assert seed.world.driver_profile.oshi_id == "synthetic-artist-0001"

    dataset_dir = settings.proposal_dataset_dir / seed.world.control_inputs.dataset_id
    catalog_raw = json.loads((dataset_dir / "catalog.json").read_text(encoding="utf-8"))
    from aica_api.models.proposal.song_schema import Song

    catalog = [Song.model_validate(entry) for entry in catalog_raw]

    clone_store = WorldCloneStore(tmp_path / "clones")

    # World A: the base seed's world unchanged.
    clone_a = clone_store.create_clone(
        base_world=seed.world,
        base_seed_id=_BASE_SEED_ID,
        overrides=[FieldOverride(path="driver_profile.oshi_id", value="synthetic-artist-0001")],
        catalog=catalog,
    )
    # World B: EXACTLY one field changed — a different oshi artist.
    clone_b = clone_store.create_clone(
        base_world=seed.world,
        base_seed_id=_BASE_SEED_ID,
        overrides=[FieldOverride(path="driver_profile.oshi_id", value="synthetic-artist-0157")],
        catalog=catalog,
    )

    # The clone mechanism itself proves the one-variable-change property.
    assert len(clone_b.diff) == 1
    assert clone_b.diff[0].path == "driver_profile.oshi_id"
    assert clone_b.diff[0].before == "synthetic-artist-0001"
    assert clone_b.diff[0].after == "synthetic-artist-0157"

    run_a = _create_and_select(clone_a.world.model_dump(mode="json"))
    run_b = _create_and_select(clone_b.world.model_dump(mode="json"))

    plan_a = run_a["evidence"][-1]["output"]
    plan_b = run_b["evidence"][-1]["output"]

    assert plan_a["decision_type"] == "complete_plan"
    assert plan_b["decision_type"] == "complete_plan"

    # SC-004: the two plans differ.
    assert plan_a != plan_b
    ids_a = [it["item_id"] for it in plan_a["ordered_items"]]
    ids_b = [it["item_id"] for it in plan_b["ordered_items"]]
    assert ids_a != ids_b

    # The differing feature (oshi match) is cited in the reasoning of
    # whichever plan surfaces the newly-matched artist's track(s), and its
    # feature_contributions row shows a nonzero exact_match/contribution —
    # never a silent, unexplained reordering.
    def _oshi_hits(plan):
        hits = []
        for item in plan["ordered_items"]:
            for c in item["feature_contributions"]:
                if c["feature_id"] == "oshi_id" and c["exact_match"]:
                    hits.append((item["item_id"], c))
        return hits

    oshi_hits_a = _oshi_hits(plan_a)
    oshi_hits_b = _oshi_hits(plan_b)
    assert oshi_hits_a != oshi_hits_b

    reason_texts_b = [r for item in plan_b["ordered_items"] for r in item["rationale"]]
    assert any("推し" in r or "oshi" in r.lower() for r in reason_texts_b) or oshi_hits_b


def test_contrast_demo_is_deterministic_on_repeat(tmp_path):
    """Re-running the exact same clone twice through create->select reproduces
    an identical plan (Constitution III: replay/determinism)."""
    seed_store = WorldSeedStore(settings.proposal_contracts_dir / "seeds")
    seed = seed_store.get_seed(_BASE_SEED_ID)
    assert seed is not None

    dataset_dir = settings.proposal_dataset_dir / seed.world.control_inputs.dataset_id
    catalog_raw = json.loads((dataset_dir / "catalog.json").read_text(encoding="utf-8"))
    from aica_api.models.proposal.song_schema import Song

    catalog = [Song.model_validate(entry) for entry in catalog_raw]

    clone_store = WorldCloneStore(tmp_path / "clones")
    clone = clone_store.create_clone(
        base_world=seed.world,
        base_seed_id=_BASE_SEED_ID,
        overrides=[FieldOverride(path="driver_profile.oshi_id", value="synthetic-artist-0157")],
        catalog=catalog,
    )

    world_dict = clone.world.model_dump(mode="json")
    run1 = _create_and_select(world_dict)
    run2 = _create_and_select(world_dict)

    assert run1["evidence"][-1]["output"] == run2["evidence"][-1]["output"]
