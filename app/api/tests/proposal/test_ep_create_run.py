"""TDD: POST /api/proposal/runs — create run + STEP 1 (service) — T022.

Covers:
  - 201 with a resolved opportunity (allowed_service_ids from the matrix),
    an OPPORTUNITY_OPENED + SERVICE_SELECTED event pair, one service-step
    AlgorithmEvidence, default selected_service = rank-1 (mirrored into
    journey_state.active_service_id), status "service_selected".
  - Ranked candidates are a subset of the opportunity's allowed_service_ids.
  - 422 on incompatible purpose/stage, unknown package, mis-slotted package
    (content pkg used as service pkg or vice versa), and an empty request.
  - A raising service-selector package produces status "error", an
    ALGORITHM_ERROR event, and evidence[0].error set — never a fabricated
    ranked_candidates list.
  - Persists to the isolated (monkeypatched) proposal_runs_dir only.
"""
from __future__ import annotations

import copy
import json

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app

client = TestClient(app)

_DATASET_ID = "soundcharts-grounded-spotify-compatible-demonstration-seed-1042"
_DATASET_HASH = "sha256:83d8079c7a81bc6afbd01cdba65fe2330de66b900a113723814fa938fce516cd"
_SEED_ID = "seed-night-highway-oshi"


def _load_seed_world_dict(seed_id: str = _SEED_ID) -> dict:
    path = settings.proposal_contracts_dir / "seeds" / f"{seed_id}.json"
    return json.loads(path.read_text(encoding="utf-8"))["world"]


@pytest.fixture(autouse=True)
def isolate_proposal_runs_dir(tmp_path, monkeypatch):
    """Never let these tests write into the real proposal_runs/ directory."""
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path))
    yield


def _valid_body(**overrides) -> dict:
    body = {
        "trigger_purpose": "rest_recommended",
        "lifecycle_stage": "after_rest_before_restart",
        "motion_state": "stopped",
        "world_snapshot": {
            "feature_snapshot": {"drowsiness_level": 72, "fatigue_level": 55},
            "feature_provenance": {},
            "profile_id": "profile-test-1",
        },
        "service_package_id": "mock_service_selector_v1",
        "content_package_id": "mock_content_selector_v1",
        "mode": "interactive",
        "enabled_feature_extensions": [],
        "parameters": {},
        "hyperparameters": {},
        "run_seed": "seed-1",
        "simulation_time": "2026-07-16T10:00:00Z",
    }
    body.update(overrides)
    return body


# ---------------------------------------------------------------------------
# Success path
# ---------------------------------------------------------------------------


def test_create_run_returns_201_service_selected():
    resp = client.post("/api/proposal/runs", json=_valid_body())
    assert resp.status_code == 201
    body = resp.json()

    assert body["status"] == "service_selected"
    assert body["run_id"].startswith("prun_")
    assert body["matrix_version"] == "v1"
    assert body["service_package_id"] == "mock_service_selector_v1"
    assert body["content_package_id"] == "mock_content_selector_v1"
    assert set(body["opportunity"]["allowed_service_ids"]) == {
        "live_viewing",
        "stretch_video",
        "full_karaoke",
        "oshi_reexperience",
        "call_response_stopped",
    }

    assert len(body["evidence"]) == 1
    ev = body["evidence"][0]
    assert ev["step"] == "service"
    assert ev["package_id"] == "mock_service_selector_v1"
    assert ev["error"] is None
    assert ev["output"]["decision_type"] == "ranked_candidates"
    assert len(ev["output"]["ranked_candidates"]) <= 3

    event_types = [e["event_type"] for e in body["events"]]
    assert event_types == ["OPPORTUNITY_OPENED", "SERVICE_SELECTED"]


def test_create_run_ranked_candidates_are_subset_of_allowed_service_ids():
    resp = client.post("/api/proposal/runs", json=_valid_body())
    body = resp.json()
    allowed = set(body["opportunity"]["allowed_service_ids"])
    for cand in body["evidence"][0]["output"]["ranked_candidates"]:
        assert cand["candidate_id"] in allowed


def test_create_run_default_selected_service_is_rank_one():
    resp = client.post("/api/proposal/runs", json=_valid_body())
    body = resp.json()
    top_candidate = body["evidence"][0]["output"]["ranked_candidates"][0]
    assert top_candidate["rank"] == 1

    assert body["journey_state"]["active_service_id"] == top_candidate["candidate_id"]

    selected_events = [e for e in body["events"] if e["event_type"] == "SERVICE_SELECTED"]
    assert len(selected_events) == 1
    assert selected_events[0]["payload"]["selected_service_id"] == top_candidate["candidate_id"]


def test_create_run_persists_only_under_isolated_proposal_runs_dir(tmp_path):
    resp = client.post("/api/proposal/runs", json=_valid_body())
    run_id = resp.json()["run_id"]
    assert (tmp_path / f"{run_id}.json").exists()

    on_disk = json.loads((tmp_path / f"{run_id}.json").read_text(encoding="utf-8"))
    assert on_disk["run_id"] == run_id
    assert on_disk["status"] == "service_selected"


def test_create_run_two_calls_are_deterministic_in_output_shape():
    resp1 = client.post("/api/proposal/runs", json=_valid_body())
    resp2 = client.post("/api/proposal/runs", json=_valid_body())
    body1, body2 = resp1.json(), resp2.json()
    assert body1["run_id"] != body2["run_id"]
    # Identical inputs -> identical (fixed) mock service-selector output.
    assert body1["evidence"][0]["output"] == body2["evidence"][0]["output"]


# ---------------------------------------------------------------------------
# 422s
# ---------------------------------------------------------------------------


def test_create_run_422_on_incompatible_purpose_stage():
    resp = client.post(
        "/api/proposal/runs",
        json=_valid_body(trigger_purpose="route_music", lifecycle_stage="before_rest_until_stop"),
    )
    assert resp.status_code == 422


def test_create_run_422_on_unknown_service_package():
    resp = client.post(
        "/api/proposal/runs",
        json=_valid_body(service_package_id="does_not_exist_pkg"),
    )
    assert resp.status_code == 422


def test_create_run_422_on_unknown_content_package():
    resp = client.post(
        "/api/proposal/runs",
        json=_valid_body(content_package_id="does_not_exist_pkg"),
    )
    assert resp.status_code == 422


def test_create_run_422_on_content_package_used_as_service_package():
    resp = client.post(
        "/api/proposal/runs",
        json=_valid_body(service_package_id="mock_content_selector_v1"),
    )
    assert resp.status_code == 422


def test_create_run_422_on_service_package_used_as_content_package():
    resp = client.post(
        "/api/proposal/runs",
        json=_valid_body(content_package_id="mock_service_selector_v1"),
    )
    assert resp.status_code == 422


def test_create_run_422_on_empty_request():
    resp = client.post("/api/proposal/runs", json={})
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Selector-failure semantics — never a fabricated ranked_candidates
# ---------------------------------------------------------------------------


def test_create_run_algorithm_error_on_raising_service_package(tmp_path, monkeypatch):
    pkgs_dir = tmp_path / "pkgs"
    pkgs_dir.mkdir()

    # A real, loadable content package (the create-run flow validates its slot
    # even though STEP 1 never dispatches it).
    import shutil

    shutil.copytree(
        settings.packages_dir / "mock_content_selector_v1",
        pkgs_dir / "mock_content_selector_v1",
    )

    broken_dir = pkgs_dir / "broken_service_selector"
    broken_dir.mkdir()
    (broken_dir / "package.json").write_text(
        json.dumps(
            {
                "id": "broken_service_selector",
                "version": "1.0.0",
                "label": {"ja": "x", "en": "x"},
                "kind": "service_selector",
                "family": "service_selector",
                "approach": "transparent",
                "contract_version": "1.0.0",
                "algorithm": {
                    "type": "python_module",
                    "entrypoint": "algorithm.py",
                    "error_mode": "blocking",
                },
                "supported_services": [],
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

    resp = client.post(
        "/api/proposal/runs",
        json=_valid_body(
            service_package_id="broken_service_selector",
            content_package_id="mock_content_selector_v1",
        ),
    )
    assert resp.status_code == 201
    body = resp.json()

    assert body["status"] == "error"
    assert len(body["evidence"]) == 1
    assert body["evidence"][0]["error"] is not None
    assert body["evidence"][0]["output"] is None
    assert "boom" in body["evidence"][0]["error"]["message"]

    event_types = [e["event_type"] for e in body["events"]]
    assert "ALGORITHM_ERROR" in event_types
    assert "SERVICE_SELECTED" not in event_types

    assert body["journey_state"]["active_service_id"] is None


def test_create_run_algorithm_error_on_candidate_outside_allowed_set(tmp_path, monkeypatch):
    """FR-013/SC-002: a service-selector package that returns a candidate_id
    OUTSIDE the opportunity's frozen allowed_service_ids must never be
    persisted as a legitimate recommendation — it must surface as
    status "error" with an algorithm_error evidence entry."""
    pkgs_dir = tmp_path / "pkgs"
    pkgs_dir.mkdir()

    import shutil

    shutil.copytree(
        settings.packages_dir / "mock_content_selector_v1",
        pkgs_dir / "mock_content_selector_v1",
    )

    cheating_dir = pkgs_dir / "cheating_service_selector"
    cheating_dir.mkdir()
    (cheating_dir / "package.json").write_text(
        json.dumps(
            {
                "id": "cheating_service_selector",
                "version": "1.0.0",
                "label": {"ja": "x", "en": "x"},
                "kind": "service_selector",
                "family": "service_selector",
                "approach": "transparent",
                "contract_version": "1.0.0",
                "algorithm": {
                    "type": "python_module",
                    "entrypoint": "algorithm.py",
                    "error_mode": "blocking",
                },
                "supported_services": [],
                "parameters": {},
                "hyperparameters": [],
            }
        ),
        encoding="utf-8",
    )
    # rest_recommended/after_rest_before_restart's allowed set does NOT
    # include music_playlist -> this candidate is outside the frozen set.
    (cheating_dir / "algorithm.py").write_text(
        "def evaluate(context):\n"
        "    return {\n"
        "        'decision_type': 'ranked_candidates',\n"
        "        'ranked_candidates': [{\n"
        "            'rank': 1,\n"
        "            'candidate_id': 'music_playlist',\n"
        "            'score': 0.9,\n"
        "            'rationale': ['x'],\n"
        "            'supporting_feature_ids': [],\n"
        "            'opposing_feature_ids': [],\n"
        "            'uncertainty': None,\n"
        "            'feature_contributions': [],\n"
        "        }],\n"
        "        'excluded_candidates': [],\n"
        "        'unused_available_features': [],\n"
        "        'missing_features': [],\n"
        "        'next_package_runtime_state': {},\n"
        "        'algorithm_provenance': {},\n"
        "    }\n",
        encoding="utf-8",
    )

    monkeypatch.setenv("AICA_PACKAGES_DIR", str(pkgs_dir))

    resp = client.post(
        "/api/proposal/runs",
        json=_valid_body(
            service_package_id="cheating_service_selector",
            content_package_id="mock_content_selector_v1",
        ),
    )
    assert resp.status_code == 201
    body = resp.json()

    assert body["status"] == "error"
    assert len(body["evidence"]) == 1
    assert body["evidence"][0]["error"] is not None
    assert body["evidence"][0]["error"]["category"] == "candidate_outside_allowed_set"
    assert body["evidence"][0]["output"] is None

    event_types = [e["event_type"] for e in body["events"]]
    assert "ALGORITHM_ERROR" in event_types
    assert "SERVICE_SELECTED" not in event_types
    assert body["journey_state"]["active_service_id"] is None


def test_create_run_honest_mock_unaffected_by_allowed_set_enforcement():
    """The real mock service selector's candidates are always in-set, so
    enabling FR-013 enforcement must not change its 201/service_selected
    behavior."""
    resp = client.post("/api/proposal/runs", json=_valid_body())
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "service_selected"
    assert body["evidence"][0]["error"] is None


# ---------------------------------------------------------------------------
# T023 — typed World path: freezes a SetupSnapshot (P3)
# ---------------------------------------------------------------------------


def _typed_world_body(**overrides) -> dict:
    body = {
        "world": _load_seed_world_dict(),
        "service_package_id": "mock_service_selector_v1",
        "content_package_id": "mock_content_selector_v1",
        "mode": "interactive",
        "run_seed": "seed-1",
        "simulation_time": "2026-07-16T10:00:00Z",
    }
    body.update(overrides)
    return body


def test_create_run_typed_world_201_freezes_setup_snapshot():
    resp = client.post("/api/proposal/runs", json=_typed_world_body())
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "service_selected"

    snap = body["setup_snapshot"]
    assert snap is not None
    assert snap["dataset_id"] == _DATASET_ID
    assert snap["dataset_hash"] == _DATASET_HASH
    assert snap["matrix_version"] == "v1"
    assert snap["service_package_id"] == "mock_service_selector_v1"
    assert snap["service_contract_version"] == "1.0.0"
    assert snap["content_package_id"] == "mock_content_selector_v1"
    assert snap["content_contract_version"] == "1.0.0"
    assert snap["service_parameter_set_version"]
    assert snap["content_parameter_set_version"]
    assert snap["feature_provenance"]  # non-empty: every A.1/A.2 field has provenance
    assert snap["origin"] == {
        "seed_id": None,
        "clone_id": None,
        "profile_id": None,
        "origin_preset_id": None,
    }


def test_create_run_typed_world_derives_purpose_stage_motion_from_world():
    resp = client.post("/api/proposal/runs", json=_typed_world_body())
    assert resp.status_code == 201
    body = resp.json()
    assert body["opportunity"]["trigger_purpose"] == "rest_recommended"
    assert body["opportunity"]["lifecycle_stage"] == "before_rest_until_stop"
    assert set(body["opportunity"]["allowed_service_ids"]) == {
        "music_playlist",
        "humming_karaoke",
        "quiz",
        "ranking_creation",
        "radio_style",
        "call_response_driving",
    }


def test_create_run_typed_world_records_origin_hints_when_supplied():
    resp = client.post(
        "/api/proposal/runs",
        json=_typed_world_body(origin_seed_id=_SEED_ID, origin_profile_id="profile-neutral-default"),
    )
    assert resp.status_code == 201
    snap = resp.json()["setup_snapshot"]
    assert snap["origin"] == {
        "seed_id": _SEED_ID,
        "clone_id": None,
        "profile_id": "profile-neutral-default",
        "origin_preset_id": None,
    }


def test_create_run_typed_world_persisted_run_reopens_with_setup_snapshot(tmp_path):
    resp = client.post("/api/proposal/runs", json=_typed_world_body())
    run_id = resp.json()["run_id"]

    reopened = client.get(f"/api/proposal/runs/{run_id}")
    assert reopened.status_code == 200
    assert reopened.json()["setup_snapshot"]["dataset_id"] == _DATASET_ID


def test_create_run_world_snapshot_backcompat_has_no_setup_snapshot():
    resp = client.post("/api/proposal/runs", json=_valid_body())
    assert resp.status_code == 201
    assert resp.json()["setup_snapshot"] is None


def test_create_run_typed_world_422_field_level_on_invalid_world():
    world = copy.deepcopy(_load_seed_world_dict())
    world["driver_profile"]["oshi_artists"][0]["artist_id"] = "synthetic-artist-DOES-NOT-EXIST"
    resp = client.post("/api/proposal/runs", json=_typed_world_body(world=world))
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert any(
        isinstance(issue, dict) and issue.get("code") == "unknown_catalog_reference"
        for issue in detail
    )


def test_create_run_422_neither_world_nor_world_snapshot():
    body = _typed_world_body()
    del body["world"]
    resp = client.post("/api/proposal/runs", json=body)
    assert resp.status_code == 422


def test_create_run_world_takes_precedence_over_world_snapshot_when_both_given():
    body = _typed_world_body(world_snapshot={"feature_snapshot": {"ignored": True}, "feature_provenance": {}})
    resp = client.post("/api/proposal/runs", json=body)
    assert resp.status_code == 201
    assert resp.json()["setup_snapshot"] is not None
