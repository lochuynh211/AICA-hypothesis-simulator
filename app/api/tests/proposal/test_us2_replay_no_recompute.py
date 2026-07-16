"""TDD (T020/T021): US2 replay-without-recompute via the real HTTP endpoint.

Runs the full accept -> complete -> continue -> stop sequence through
``POST /api/proposal/runs/{run_id}/journey/action`` (spec.md User Story 2
Independent Test / SC-004), asserting each response's events/journey_state/
status, then confirms ``GET /api/proposal/runs/{run_id}`` renders the
IDENTICAL persisted log — same event list, same final journey_state, same
AlgorithmEvidence count (no selector re-invoked, no new evidence fabricated;
Principle III / FR-018 / SC-004).
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


def _create_run_body(**overrides) -> dict:
    body = {
        "trigger_purpose": "rest_recommended",
        "lifecycle_stage": "after_rest_before_restart",
        "motion_state": "stopped",
        "world_snapshot": {"feature_snapshot": {}, "feature_provenance": {}},
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


def _content_selected_run() -> dict:
    created = client.post("/api/proposal/runs", json=_create_run_body())
    assert created.status_code == 201, created.text
    run_id = created.json()["run_id"]

    selected = client.post(
        f"/api/proposal/runs/{run_id}/select-service",
        json={"selected_service_id": "full_karaoke"},
    )
    assert selected.status_code == 200, selected.text
    body = selected.json()
    assert body["status"] == "content_selected"
    return body


def _action(run_id: str, action_type: str, payload: dict | None = None):
    return client.post(
        f"/api/proposal/runs/{run_id}/journey/action",
        json={"action_type": action_type, "payload": payload or {}},
    )


def test_full_accept_complete_continue_stop_sequence_through_endpoint():
    run = _content_selected_run()
    run_id = run["run_id"]
    baseline_evidence_count = len(run["evidence"])
    assert baseline_evidence_count == 2  # service + content

    # ---- accept ------------------------------------------------------------
    r1 = _action(run_id, "accept")
    assert r1.status_code == 200, r1.text
    body1 = r1.json()
    assert body1["status"] == "content_started"
    assert body1["journey_state"]["playback_state"] == "active"
    assert body1["journey_state"]["previous_content"] is not None
    event_types_1 = [e["event_type"] for e in body1["events"]]
    assert event_types_1[-1] == "CONTENT_STARTED"
    assert len(body1["evidence"]) == baseline_evidence_count  # no recompute

    # ---- complete ------------------------------------------------------------
    r2 = _action(run_id, "complete")
    assert r2.status_code == 200, r2.text
    body2 = r2.json()
    assert body2["status"] == "content_completed"
    assert body2["journey_state"]["playback_state"] == "completed"
    assert [e["event_type"] for e in body2["events"]][-1] == "CONTENT_COMPLETED"
    assert len(body2["evidence"]) == baseline_evidence_count

    # ---- continue ------------------------------------------------------------
    r3 = _action(run_id, "continue")
    assert r3.status_code == 200, r3.text
    body3 = r3.json()
    assert body3["status"] == "content_completed"
    assert body3["journey_state"]["playback_state"] == "completed"
    continue_event = [e for e in body3["events"] if e["event_type"] == "CONTINUE_REQUESTED"]
    assert len(continue_event) == 1
    assert continue_event[0]["payload"]["next_transition_policy"]
    assert len(body3["evidence"]) == baseline_evidence_count

    # ---- stop ------------------------------------------------------------
    r4 = _action(run_id, "stop")
    assert r4.status_code == 200, r4.text
    body4 = r4.json()
    assert body4["status"] == "content_stopped"
    assert body4["journey_state"]["playback_state"] == "stopped"
    assert body4["journey_state"]["previous_content"] is None
    assert [e["event_type"] for e in body4["events"]][-1] == "RETURN_TO_PREVIOUS_CONTENT"
    assert len(body4["evidence"]) == baseline_evidence_count  # STILL no recompute

    # ---- full event sequence recorded, in order ----------------------------
    assert [e["event_type"] for e in body4["events"]] == [
        "OPPORTUNITY_OPENED",
        "SERVICE_SELECTED",
        "CONTENT_SELECTED",
        "CONTENT_STARTED",
        "CONTENT_COMPLETED",
        "CONTINUE_REQUESTED",
        "RETURN_TO_PREVIOUS_CONTENT",
    ]

    # ---- GET /runs/{id} renders the IDENTICAL persisted log, no recompute -
    reopened = client.get(f"/api/proposal/runs/{run_id}").json()
    assert reopened == body4
    assert reopened["events"] == body4["events"]
    assert reopened["journey_state"] == body4["journey_state"]
    assert reopened["status"] == body4["status"]
    assert len(reopened["evidence"]) == baseline_evidence_count


def test_invalid_precondition_actions_leave_persisted_log_unchanged():
    """complete before accept, and continue before complete, are rejected
    (422) and the persisted log (events/status/journey_state) is untouched —
    append-only discipline; a rejection is a no-op, never silent."""
    run = _content_selected_run()
    run_id = run["run_id"]

    r_complete_early = _action(run_id, "complete")
    assert r_complete_early.status_code == 422
    detail = r_complete_early.json()["detail"]
    assert detail["code"] == "invalid_precondition"

    reopened = client.get(f"/api/proposal/runs/{run_id}").json()
    assert reopened["events"] == run["events"]
    assert reopened["status"] == run["status"]
    assert reopened["journey_state"] == run["journey_state"]

    # accept, THEN try continue before complete -> also rejected, no-op.
    r_accept = _action(run_id, "accept")
    assert r_accept.status_code == 200
    accepted_body = r_accept.json()

    r_continue_early = _action(run_id, "continue")
    assert r_continue_early.status_code == 422
    assert r_continue_early.json()["detail"]["code"] == "invalid_precondition"

    reopened_after = client.get(f"/api/proposal/runs/{run_id}").json()
    assert reopened_after["events"] == accepted_body["events"]
    assert reopened_after["status"] == accepted_body["status"]
    assert reopened_after["journey_state"] == accepted_body["journey_state"]
