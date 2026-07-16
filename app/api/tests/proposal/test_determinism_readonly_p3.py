"""TDD: T039 (P3 POLISH unit) — determinism / read-only / reopen-no-recompute.

Covers:
  (a) the frozen dataset files under ``proposal_contracts/dataset/`` are
      byte-unchanged after a full create-run + real STEP-2 session (hash the
      directory before/after) — the catalog stays read-only, per the
      Constitution / data-model.md preamble;
  (b) reopening a persisted run (``GET /runs/{id}``) returns the stored
      plan/world/setup-snapshot WITHOUT recomputing any selector — proven two
      ways: (b1) the selector dispatch function is monkeypatched to raise,
      and the GET still succeeds with the identical persisted output; (b2)
      the packages directory is made unusable after the run exists, and the
      GET still succeeds identically;
  (c) identical world -> identical plan (reuses the Unit-I real-content
      determinism assertion, over the typed-World + real content selector
      path introduced by T033-T036/MF2).
"""
from __future__ import annotations

import copy
import hashlib
import json

import pytest
from fastapi.testclient import TestClient

import aica_api.routers.proposal as proposal_router
from aica_api.config import settings
from aica_api.main import app

client = TestClient(app)

_REAL_CONTENT_PACKAGE_ID = "aica_transparent_content_selector_v1"
_SEED_ID = "seed-night-highway-oshi"


@pytest.fixture(autouse=True)
def isolate_proposal_runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path))
    yield


def _load_seed_world_dict(seed_id: str = _SEED_ID) -> dict:
    path = settings.proposal_contracts_dir / "seeds" / f"{seed_id}.json"
    return json.loads(path.read_text(encoding="utf-8"))["world"]


def _create_run(world: dict, *, content_package_id: str = _REAL_CONTENT_PACKAGE_ID) -> dict:
    resp = client.post(
        "/api/proposal/runs",
        json={
            "world": world,
            "service_package_id": "mock_service_selector_v1",
            "content_package_id": content_package_id,
            "mode": "interactive",
            "run_seed": "seed-1",
            "simulation_time": "2026-07-16T10:00:00Z",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _select_service(run_id: str, selected_service_id: str):
    return client.post(
        f"/api/proposal/runs/{run_id}/select-service",
        json={"selected_service_id": selected_service_id},
    )


def _hash_dataset_dir() -> str:
    """A stable content hash over every file under proposal_contracts/dataset/."""
    dataset_dir = settings.proposal_dataset_dir
    digest = hashlib.sha256()
    for path in sorted(dataset_dir.rglob("*")):
        if not path.is_file():
            continue
        digest.update(str(path.relative_to(dataset_dir)).encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()


# ---------------------------------------------------------------------------
# (a) frozen dataset byte-unchanged
# ---------------------------------------------------------------------------


def test_frozen_dataset_is_byte_unchanged_after_a_full_session():
    before = _hash_dataset_dir()

    world = _load_seed_world_dict()
    run = _create_run(world)
    resp = _select_service(run["run_id"], "music_playlist")
    assert resp.status_code == 200, resp.text
    assert resp.json()["evidence"][-1]["output"]["decision_type"] == "complete_plan"

    # Also exercise the read-only dataset endpoints, in case they somehow
    # touched the files.
    ds_id = world["control_inputs"]["dataset_id"]
    assert client.get("/api/proposal/datasets").status_code == 200
    assert client.get(f"/api/proposal/datasets/{ds_id}/catalog").status_code == 200

    after = _hash_dataset_dir()
    assert before == after, "the frozen dataset directory was mutated by a create-run + STEP-2 session"


# ---------------------------------------------------------------------------
# (b) reopen renders from the persisted log WITHOUT recomputing the selector
# ---------------------------------------------------------------------------


def test_reopen_does_not_invoke_dispatch_selector(monkeypatch):
    run = _create_run(_load_seed_world_dict())
    resp = _select_service(run["run_id"], "music_playlist")
    assert resp.status_code == 200
    run_id = resp.json()["run_id"]
    persisted_output = resp.json()["evidence"][-1]["output"]

    def _must_not_be_called(*_args, **_kwargs):
        raise AssertionError("dispatch_selector must not be invoked when reopening a persisted run")

    monkeypatch.setattr(proposal_router, "dispatch_selector", _must_not_be_called)

    reopened = client.get(f"/api/proposal/runs/{run_id}")
    assert reopened.status_code == 200
    body = reopened.json()
    assert body["evidence"][-1]["output"] == persisted_output
    assert body["world_snapshot"] == resp.json()["world_snapshot"]
    assert body["setup_snapshot"] == resp.json()["setup_snapshot"]


def test_reopen_survives_an_unusable_packages_directory(monkeypatch, tmp_path):
    """Even if the packages directory becomes unreadable after the run was
    created, GET /runs/{id} still renders the persisted record — proof that
    no algorithm is re-loaded/re-invoked on reopen."""
    run = _create_run(_load_seed_world_dict())
    resp = _select_service(run["run_id"], "music_playlist")
    assert resp.status_code == 200
    run_id = resp.json()["run_id"]
    persisted_output = resp.json()["evidence"][-1]["output"]

    empty_pkgs_dir = tmp_path / "no_packages_here"
    empty_pkgs_dir.mkdir()
    monkeypatch.setenv("AICA_PACKAGES_DIR", str(empty_pkgs_dir))

    reopened = client.get(f"/api/proposal/runs/{run_id}")
    assert reopened.status_code == 200
    assert reopened.json()["evidence"][-1]["output"] == persisted_output


# ---------------------------------------------------------------------------
# (c) identical world -> identical plan (typed-World + real content selector)
# ---------------------------------------------------------------------------


def test_identical_world_yields_identical_plan():
    world = _load_seed_world_dict()
    run1 = _create_run(copy.deepcopy(world))
    run2 = _create_run(copy.deepcopy(world))

    resp1 = _select_service(run1["run_id"], "music_playlist")
    resp2 = _select_service(run2["run_id"], "music_playlist")
    assert resp1.status_code == 200
    assert resp2.status_code == 200

    assert resp1.json()["evidence"][-1]["output"] == resp2.json()["evidence"][-1]["output"]
