"""TDD: T033 (US3/P3c) — STEP 2 dispatches the REAL transparent content
selector (``aica_transparent_content_selector_v1``) over the frozen catalog.

Covers (per tasks.md T033 / research.md R2):
  (a) a typed-world run + STEP 2 with the real package returns a valid
      complete_plan scoring real frozen-P2 catalog songs;
  (b) identical world -> identical CompletePlan (determinism);
  (c) two worlds differing ONLY in a scored driver-profile dimension
      (driver_profile.oshi_id) -> DIFFERENT CompletePlans;
  (d) a content package that raises -> algorithm_error evidence (never a
      faked plan), even when it is registered under the real content
      package's own id and dispatched via the new real-context path;
  (e) a chosen service outside the real package's supported_services ->
      the existing 422 unsupported-service handling;
  (f) a world where every catalog song is excluded (recent_skip on the
      full catalog) -> explicit no_proposal (not a crash, not a fabricated
      plan).
"""
from __future__ import annotations

import copy
import json
import shutil

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app
from aica_api.services.dataset_catalog_registry import DatasetCatalogRegistry

client = TestClient(app)

_REAL_CONTENT_PACKAGE_ID = "aica_transparent_content_selector_v1"
_DATASET_ID = "soundcharts-grounded-spotify-compatible-demonstration-seed-1042"
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


def _select_service(run_id: str, selected_service_id: str) -> dict:
    resp = client.post(
        f"/api/proposal/runs/{run_id}/select-service",
        json={"selected_service_id": selected_service_id},
    )
    return resp


# ---------------------------------------------------------------------------
# (a) valid CompletePlan over the real catalog
# ---------------------------------------------------------------------------


def test_real_content_selector_returns_complete_plan_over_real_catalog():
    run = _create_run(_load_seed_world_dict())
    resp = _select_service(run["run_id"], "music_playlist")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["status"] == "content_selected"
    content_ev = body["evidence"][-1]
    assert content_ev["step"] == "content"
    assert content_ev["package_id"] == _REAL_CONTENT_PACKAGE_ID
    assert content_ev["error"] is None

    output = content_ev["output"]
    assert output["decision_type"] == "complete_plan"
    assert output["selected_service_id"] == "music_playlist"
    assert output["ordered_items"]
    for item in output["ordered_items"]:
        assert item["item_id"].startswith("synthetic-track-")
        assert item["item_fit"] is not None
        assert item["feature_contributions"]


def test_real_content_selector_no_plan_score_anywhere():
    run = _create_run(_load_seed_world_dict())
    resp = _select_service(run["run_id"], "music_playlist")
    output = resp.json()["evidence"][-1]["output"]

    def _walk(node):
        if isinstance(node, dict):
            assert "plan_score" not in node
            assert "aggregate_score" not in node
            assert "plan_fit" not in node
            for v in node.values():
                _walk(v)
        elif isinstance(node, list):
            for v in node:
                _walk(v)

    _walk(output)


# ---------------------------------------------------------------------------
# (b) determinism — identical world -> identical plan
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


# ---------------------------------------------------------------------------
# (c) two worlds differing ONLY in a scored profile dimension -> DIFFERENT plans
# ---------------------------------------------------------------------------


def test_worlds_differing_in_oshi_id_yield_different_plans():
    """driver_profile.oshi_id is a scored (mask=1) leaf: the exact matching
    artist's tracks get a nonzero contribution. Changing it (leaving
    everything else identical) is a single-variable change that must be
    visible in the resulting plan — the whole point of P3c."""
    world_a = _load_seed_world_dict()
    assert world_a["driver_profile"]["oshi_id"] == "synthetic-artist-0001"

    world_b = copy.deepcopy(world_a)
    world_b["driver_profile"]["oshi_id"] = "synthetic-artist-0157"

    run_a = _create_run(world_a)
    run_b = _create_run(world_b)

    resp_a = _select_service(run_a["run_id"], "music_playlist")
    resp_b = _select_service(run_b["run_id"], "music_playlist")
    assert resp_a.status_code == 200
    assert resp_b.status_code == 200

    plan_a = resp_a.json()["evidence"][-1]["output"]
    plan_b = resp_b.json()["evidence"][-1]["output"]
    assert plan_a != plan_b
    ids_a = [it["item_id"] for it in plan_a["ordered_items"]]
    ids_b = [it["item_id"] for it in plan_b["ordered_items"]]
    assert ids_a != ids_b

    # The differing feature (oshi match) is reflected in the reasoning for
    # whichever plan actually surfaces the newly-matched artist's track(s).
    oshi_reason_present = any(
        any("oshi" in r.lower() or "推し" in r for r in item["rationale"])
        for item in plan_b["ordered_items"]
    )
    assert oshi_reason_present


# ---------------------------------------------------------------------------
# (d) raising/invalid content package -> algorithm_error (never a faked plan)
# ---------------------------------------------------------------------------


def test_raising_real_content_package_surfaces_algorithm_error(tmp_path, monkeypatch):
    pkgs_dir = tmp_path / "pkgs"
    pkgs_dir.mkdir()
    shutil.copytree(settings.packages_dir / "mock_service_selector_v1", pkgs_dir / "mock_service_selector_v1")

    broken_dir = pkgs_dir / _REAL_CONTENT_PACKAGE_ID
    broken_dir.mkdir()
    (broken_dir / "package.json").write_text(
        json.dumps(
            {
                "id": _REAL_CONTENT_PACKAGE_ID,
                "version": "1.0.0",
                "label": {"ja": "x", "en": "x"},
                "kind": "content_selector",
                "family": "content_selector",
                "approach": "transparent",
                "contract_version": "1.0.0",
                "algorithm": {"type": "python_module", "entrypoint": "algorithm.py", "error_mode": "blocking"},
                "supported_services": ["music_playlist", "humming_karaoke", "full_karaoke"],
                "parameters": {},
                "hyperparameters": [],
            }
        ),
        encoding="utf-8",
    )
    (broken_dir / "algorithm.py").write_text(
        "def evaluate(context):\n    raise RuntimeError('boom')\n", encoding="utf-8"
    )

    monkeypatch.setenv("AICA_PACKAGES_DIR", str(pkgs_dir))

    run = _create_run(_load_seed_world_dict())
    resp = _select_service(run["run_id"], "music_playlist")
    assert resp.status_code == 200
    body = resp.json()

    assert body["status"] == "error"
    content_ev = body["evidence"][-1]
    assert content_ev["step"] == "content"
    assert content_ev["error"] is not None
    assert content_ev["error"]["category"] == "algorithm_exception"
    assert "boom" in content_ev["error"]["message"]
    assert content_ev["output"] is None

    event_types = [e["event_type"] for e in body["events"]]
    assert "ALGORITHM_ERROR" in event_types
    assert "CONTENT_SELECTED" not in event_types


# ---------------------------------------------------------------------------
# (e) unsupported service -> existing 422 handling, unaffected by the real pkg
# ---------------------------------------------------------------------------


def test_unsupported_service_still_422s_with_real_content_package():
    run = _create_run(_load_seed_world_dict())
    # "quiz" is in the before_rest_until_stop allowed set but not in the real
    # content package's supported_services.
    assert "quiz" in run["opportunity"]["allowed_service_ids"]
    resp = _select_service(run["run_id"], "quiz")
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# (f) no eligible candidates -> explicit no_proposal (not a crash)
# ---------------------------------------------------------------------------


def test_world_with_every_song_recently_skipped_yields_no_proposal():
    registry = DatasetCatalogRegistry(settings.proposal_dataset_dir)
    songs = registry.get_catalog(_DATASET_ID)
    assert songs

    world = _load_seed_world_dict()
    sim_time = "2026-07-16T10:00:00Z"
    world["driver_profile"]["skipped_items"] = [
        {"track_id": song.spotify_track.id, "skipped_at": sim_time} for song in songs
    ]

    resp = client.post(
        "/api/proposal/runs",
        json={
            "world": world,
            "service_package_id": "mock_service_selector_v1",
            "content_package_id": _REAL_CONTENT_PACKAGE_ID,
            "mode": "interactive",
            "run_seed": "seed-1",
            "simulation_time": sim_time,
        },
    )
    assert resp.status_code == 201, resp.text
    run = resp.json()

    resp2 = _select_service(run["run_id"], "music_playlist")
    assert resp2.status_code == 200
    body = resp2.json()
    output = body["evidence"][-1]["output"]
    assert output["decision_type"] == "no_proposal"
    assert output["ordered_items"] == []
    # Never a fabricated plan: still no algorithm_error (the selector itself
    # honestly reported the outcome), status reflects a completed STEP 2.
    assert body["evidence"][-1]["error"] is None
    assert body["status"] == "content_selected"
