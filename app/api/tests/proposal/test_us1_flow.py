"""US1 capstone integration test (T031) — a mock opportunity flows through BOTH
selector boundaries and yields a service ranking + a content plan.

Asserts the User-Story-1 success criteria end to end:
  - SC-001: a full proposal runs from create (STEP 1 service) through
    select-service (STEP 2 content) without any trigger run.
  - SC-002: 100% of ranked service candidates are in the frozen allowed set,
    and no run shows more than three ranked candidates.
  - SC-003: the content result is exactly one ordered plan — never multiple
    ranked plans and never an aggregate plan score.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolate_proposal_runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path))
    yield


# The mock content selector is a MUSIC selector — it only makes plans for these.
_MUSIC_SERVICES = {"music_playlist", "humming_karaoke", "full_karaoke"}


def _create_body(**overrides) -> dict:
    body = {
        # route_music / active_driving_content resolves to a driving-content row
        # that includes music_playlist + humming_karaoke (content-supported).
        "trigger_purpose": "route_music",
        "lifecycle_stage": "active_driving_content",
        "motion_state": "driving",
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
        "run_seed": "seed-us1",
        "simulation_time": "2026-07-16T10:00:00Z",
    }
    body.update(overrides)
    return body


def _no_aggregate_plan_score(plan: dict) -> None:
    """The content plan must carry no aggregate/plan-level score anywhere."""
    for banned in ("plan_score", "aggregate_score", "plan_fit"):
        assert banned not in plan, f"content plan must not contain {banned!r}"


def test_full_mock_proposal_flow_service_then_content():
    # ---- STEP 1: create run (service selection) ---------------------------
    r_create = client.post("/api/proposal/runs", json=_create_body())
    assert r_create.status_code == 201, r_create.text
    run = r_create.json()
    run_id = run["run_id"]

    opportunity = run["opportunity"]
    allowed = opportunity["allowed_service_ids"]
    # route_music / active_driving_content resolves to the driving-content row.
    assert "music_playlist" in allowed

    # SC-002: at most three ranked candidates, every one inside the allowed set.
    service_ev = next(e for e in run["evidence"] if e["step"] == "service")
    service_out = service_ev["output"]
    assert service_out["decision_type"] == "ranked_candidates"
    ranked = service_out["ranked_candidates"]
    assert 1 <= len(ranked) <= 3
    for cand in ranked:
        assert cand["candidate_id"] in allowed
    # ranks are contiguous from 1
    assert [c["rank"] for c in ranked] == list(range(1, len(ranked) + 1))
    assert run["status"] == "service_selected"

    # ---- STEP 2: choose a content-supported (music) service --------------
    music_cands = [c["candidate_id"] for c in ranked if c["candidate_id"] in _MUSIC_SERVICES]
    assert music_cands, "expected at least one music service among the ranked candidates"
    chosen = music_cands[0]
    r_select = client.post(
        f"/api/proposal/runs/{run_id}/select-service",
        json={"selected_service_id": chosen},
    )
    assert r_select.status_code == 200, r_select.text
    run2 = r_select.json()
    assert run2["status"] == "content_selected"

    # SC-003: exactly ONE ordered plan, no aggregate score, no ranked plans.
    content_ev = next(e for e in run2["evidence"] if e["step"] == "content")
    plan = content_ev["output"]
    assert plan["decision_type"] == "complete_plan"
    assert isinstance(plan["ordered_items"], list) and len(plan["ordered_items"]) >= 1
    _no_aggregate_plan_score(plan)
    # per-item fit present; no plan-level aggregate
    for item in plan["ordered_items"]:
        assert "item_fit" in item

    # SC-001: both boundaries were crossed and recorded in one run.
    steps = [e["step"] for e in run2["evidence"]]
    assert "service" in steps and "content" in steps
    event_types = [e["event_type"] for e in run2["events"]]
    assert "OPPORTUNITY_OPENED" in event_types
    assert "SERVICE_SELECTED" in event_types
    assert "CONTENT_SELECTED" in event_types


def test_flow_is_deterministic_for_identical_requests():
    """Transparent/mock determinism: identical create+select reproduce identical output."""
    def run_once() -> tuple:
        rc = client.post("/api/proposal/runs", json=_create_body())
        run = rc.json()
        svc = next(e for e in run["evidence"] if e["step"] == "service")["output"]
        chosen = next(
            c["candidate_id"] for c in svc["ranked_candidates"]
            if c["candidate_id"] in _MUSIC_SERVICES
        )
        rs = client.post(
            f"/api/proposal/runs/{run['run_id']}/select-service",
            json={"selected_service_id": chosen},
        )
        plan = next(e for e in rs.json()["evidence"] if e["step"] == "content")["output"]
        return (
            [(c["rank"], c["candidate_id"], c["score"]) for c in svc["ranked_candidates"]],
            [(i["position"], i["item_id"], i["item_fit"]) for i in plan["ordered_items"]],
        )

    assert run_once() == run_once()
