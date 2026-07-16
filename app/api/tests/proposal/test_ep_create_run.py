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

import json

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app

client = TestClient(app)


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
