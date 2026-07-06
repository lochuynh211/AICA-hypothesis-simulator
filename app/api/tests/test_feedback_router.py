"""Router tests for T007 — GET /feedback-schema and POST /feedback endpoints.

Covers:
  - GET /api/runs/{id}/feedback-schema  (active run + on-disk run + unknown → 404)
  - POST /api/runs/{id}/feedback
      · scope="run"       → 201 (event appended)
      · scope="decision"  → 201 (event_ref resolved from tick_index)
      · scope="proposal"  → 201 (event_ref resolved; tick must have fired a proposal)
      · scope="action"    → 201 (event_ref resolved from tick_index + action)
      · bad label         → 400 with validation_errors; nothing appended
      · bad target        → 400 with validation_errors; nothing appended
      · unknown run       → 404

Uses monkeypatch of AICA_RUNS_DIR so tests never litter the repo's runs/ dir.
"""

from __future__ import annotations

import json
import pathlib

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]

VALID_PACKAGE_ID = "aica_transparent_hybrid_trigger_v1"
VALID_SCENARIO_ID = "uc01_fatigue_recovery_v0_1"


# ── Fixtures ───────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def reset_registries():
    """Isolate every test — clear in-memory registries before and after."""
    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


@pytest.fixture
def client(tmp_path, monkeypatch):
    """TestClient with runs dir redirected to a temp directory."""
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    return TestClient(app)


@pytest.fixture
def active_run_id(client) -> str:
    """Create a plan + run; return run_id (run is active in memory)."""
    plan_resp = client.post(
        "/api/run-plans",
        json={
            "package_id": VALID_PACKAGE_ID,
            "scenario_id": VALID_SCENARIO_ID,
            "parameters": {},
            "hyperparameters": {},
        },
    )
    assert plan_resp.status_code == 201
    plan_id = plan_resp.json()["plan_id"]

    run_resp = client.post("/api/runs", json={"plan_id": plan_id})
    assert run_resp.status_code == 201
    return run_resp.json()["run_id"]


@pytest.fixture
def disk_run_id(tmp_path, monkeypatch) -> str:
    """Write a minimal RunLog JSON to disk (no active registry entry)."""
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    run_id = "run_disk_test_001"
    run_log = {
        "run_id": run_id,
        "created_at": "2026-01-01T00:00:00Z",
        "simulator_version": "0.1.0",
        "snapshot": {
            "package": {"id": VALID_PACKAGE_ID, "version": "0.1.0", "hash": "abc"},
            "scenario": {"id": VALID_SCENARIO_ID, "version": "0.1.0", "hash": "def"},
        },
        "route_facts": {
            "total_route_distance_km": 100.0,
            "estimated_duration_seconds": 3600,
            "rest_spot_positions": [],
            "route_source": "local",
        },
        "event_plan": {"ticks": []},
        "run_mode": "standard",
        "evidence_status": "standard",
        "events": [],
    }
    (tmp_path / f"{run_id}.json").write_text(json.dumps(run_log), encoding="utf-8")
    return run_id


@pytest.fixture
def active_run_with_tick(client, active_run_id) -> tuple[str, int]:
    """Tick an active run once; return (run_id, tick_index)."""
    tick_resp = client.post(f"/api/runs/{active_run_id}/tick")
    assert tick_resp.status_code == 200
    tick_index = tick_resp.json()["tick_index"]
    return active_run_id, tick_index


@pytest.fixture
def active_run_with_proposal(client, active_run_id) -> tuple[str, int, str]:
    """Tick until paused (proposal fired); return (run_id, tick_index, proposal_id)."""
    tick_index = None
    proposal_id = None
    for _ in range(300):
        tick_resp = client.post(f"/api/runs/{active_run_id}/tick")
        assert tick_resp.status_code == 200
        body = tick_resp.json()
        if body.get("paused"):
            tick_index = body["tick_index"]
            decision = body.get("decision", {})
            proposal = decision.get("proposal") or {}
            proposal_id = proposal.get("id", "rest_required")
            break
    else:
        pytest.skip("Run never paused within 300 ticks; skipping proposal test")
    return active_run_id, tick_index, proposal_id


@pytest.fixture
def active_run_with_action(client, active_run_with_proposal) -> tuple[str, int, str]:
    """Tick until paused, take 'postpone' action; return (run_id, action_tick_index, action)."""
    run_id, proposal_tick_index, _ = active_run_with_proposal
    action_resp = client.post(f"/api/runs/{run_id}/actions", json={"action": "postpone"})
    assert action_resp.status_code == 200
    return run_id, proposal_tick_index, "postpone"


# ── GET /api/runs/{id}/feedback-schema ────────────────────────────────────────


class TestGetFeedbackSchema:
    def test_active_run_returns_200_with_fields(self, client, active_run_id):
        """Active run → feedback-schema returns {fields: [...]} with V1 baseline."""
        resp = client.get(f"/api/runs/{active_run_id}/feedback-schema")
        assert resp.status_code == 200
        body = resp.json()
        assert "fields" in body
        # V1 baseline has 9 fields; at minimum 9 must be present
        assert len(body["fields"]) >= 9

    def test_active_run_fields_have_expected_shape(self, client, active_run_id):
        """Each field in the schema has key, label, type."""
        resp = client.get(f"/api/runs/{active_run_id}/feedback-schema")
        assert resp.status_code == 200
        for field in resp.json()["fields"]:
            assert "key" in field
            assert "label" in field
            assert "type" in field

    def test_disk_run_returns_200_with_fields(self, client, disk_run_id):
        """On-disk run (no active registry entry) → schema returned correctly."""
        resp = client.get(f"/api/runs/{disk_run_id}/feedback-schema")
        assert resp.status_code == 200
        body = resp.json()
        assert "fields" in body
        assert len(body["fields"]) >= 9

    def test_unknown_run_returns_404(self, client):
        """Unknown run_id → 404."""
        resp = client.get("/api/runs/nonexistent_run_xyz/feedback-schema")
        assert resp.status_code == 404


# ── POST /api/runs/{id}/feedback ──────────────────────────────────────────────


class TestPostFeedback:
    def test_run_scope_valid_returns_201(self, client, active_run_id):
        """POST scope='run' with no labels → 201."""
        resp = client.post(
            f"/api/runs/{active_run_id}/feedback",
            json={"target": {"scope": "run"}},
        )
        assert resp.status_code == 201

    def test_run_scope_with_comment_returns_201(self, client, active_run_id):
        """POST scope='run' with comment → 201."""
        resp = client.post(
            f"/api/runs/{active_run_id}/feedback",
            json={"target": {"scope": "run"}, "comment": "Great run overall"},
        )
        assert resp.status_code == 201

    def test_run_scope_with_valid_label_returns_201(self, client, active_run_id):
        """POST scope='run' with a valid V1 label → 201."""
        resp = client.post(
            f"/api/runs/{active_run_id}/feedback",
            json={
                "target": {"scope": "run"},
                "labels": {"overall_judgment": "good_trigger"},
            },
        )
        assert resp.status_code == 201

    def test_decision_scope_event_ref_resolved(self, client, active_run_with_tick):
        """decision scope with tick_index → event_ref resolved from TickEvent, 201."""
        run_id, tick_index = active_run_with_tick
        resp = client.post(
            f"/api/runs/{run_id}/feedback",
            json={
                "target": {"scope": "decision", "tick_index": tick_index},
            },
        )
        assert resp.status_code == 201

    def test_decision_scope_pre_provided_event_ref_used(self, client, active_run_with_tick):
        """decision scope with event_ref already provided → used as-is (TickEvent at index 0)."""
        run_id, _tick_index = active_run_with_tick
        # First event (index 0) is the TickEvent from one tick
        resp = client.post(
            f"/api/runs/{run_id}/feedback",
            json={
                "target": {"scope": "decision", "event_ref": 0},
            },
        )
        assert resp.status_code == 201

    def test_proposal_scope_event_ref_resolved(self, client, active_run_with_proposal):
        """proposal scope with tick_index → event_ref resolved to the fired-proposal TickEvent."""
        run_id, tick_index, _proposal_id = active_run_with_proposal
        resp = client.post(
            f"/api/runs/{run_id}/feedback",
            json={
                "target": {
                    "scope": "proposal",
                    "tick_index": tick_index,
                },
            },
        )
        assert resp.status_code == 201

    def test_action_scope_event_ref_resolved(self, client, active_run_with_action):
        """action scope with tick_index + action → event_ref resolved to ActionEvent."""
        run_id, tick_index, action = active_run_with_action
        resp = client.post(
            f"/api/runs/{run_id}/feedback",
            json={
                "target": {
                    "scope": "action",
                    "tick_index": tick_index,
                    "action": action,
                },
            },
        )
        assert resp.status_code == 201

    def test_disk_run_scope_run_valid_returns_201(self, client, disk_run_id):
        """On-disk run → POST feedback returns 201."""
        resp = client.post(
            f"/api/runs/{disk_run_id}/feedback",
            json={"target": {"scope": "run"}, "comment": "disk run test"},
        )
        assert resp.status_code == 201

    def test_invalid_label_key_returns_400(self, client, active_run_id):
        """Unknown label key → 400 with validation_errors, nothing appended."""
        resp = client.post(
            f"/api/runs/{active_run_id}/feedback",
            json={
                "target": {"scope": "run"},
                "labels": {"totally_unknown_key_xyz": "value"},
            },
        )
        assert resp.status_code == 400
        body = resp.json()
        detail = body.get("detail", body)
        assert "validation_errors" in detail

    def test_invalid_label_choice_returns_400(self, client, active_run_id):
        """Bad choice value → 400 with validation_errors."""
        resp = client.post(
            f"/api/runs/{active_run_id}/feedback",
            json={
                "target": {"scope": "run"},
                "labels": {"proposal_timing": "not_a_valid_choice"},
            },
        )
        assert resp.status_code == 400
        body = resp.json()
        detail = body.get("detail", body)
        assert "validation_errors" in detail

    def test_invalid_target_decision_no_tick_index_returns_400(self, client, active_run_id):
        """decision scope without tick_index (and no event_ref) → 400."""
        resp = client.post(
            f"/api/runs/{active_run_id}/feedback",
            json={"target": {"scope": "decision"}},
        )
        assert resp.status_code == 400

    def test_nothing_appended_on_400(self, client, active_run_id):
        """After a 400, no feedback event is appended to the run log."""
        # Submit invalid feedback
        client.post(
            f"/api/runs/{active_run_id}/feedback",
            json={
                "target": {"scope": "run"},
                "labels": {"bad_key_zyx": "value"},
            },
        )
        # Verify no feedback events in the log
        log_resp = client.get(f"/api/runs/{active_run_id}/log")
        assert log_resp.status_code == 200
        events = log_resp.json()["events"]
        feedback_events = [e for e in events if e.get("kind") == "feedback"]
        assert len(feedback_events) == 0

    def test_unknown_run_returns_404(self, client):
        """Unknown run_id → 404."""
        resp = client.post(
            "/api/runs/nonexistent_run_xyz/feedback",
            json={"target": {"scope": "run"}},
        )
        assert resp.status_code == 404

    def test_response_body_is_feedback_event(self, client, active_run_id):
        """201 response body is the FeedbackEvent (kind='feedback')."""
        resp = client.post(
            f"/api/runs/{active_run_id}/feedback",
            json={"target": {"scope": "run"}, "comment": "check body"},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["kind"] == "feedback"
        assert body["target"]["scope"] == "run"
        assert body["comment"] == "check body"

    def test_feedback_event_persisted_to_log(self, client, active_run_id):
        """After 201, the FeedbackEvent appears in GET /api/runs/{id}/log."""
        client.post(
            f"/api/runs/{active_run_id}/feedback",
            json={"target": {"scope": "run"}, "comment": "persist check"},
        )
        log_resp = client.get(f"/api/runs/{active_run_id}/log")
        assert log_resp.status_code == 200
        events = log_resp.json()["events"]
        feedback_events = [e for e in events if e.get("kind") == "feedback"]
        assert len(feedback_events) == 1
        assert feedback_events[0]["comment"] == "persist check"

    def test_disk_run_feedback_persisted_to_disk(self, client, disk_run_id):
        """After POSTing feedback to a disk-only run, the FeedbackEvent is
        persisted to disk and readable via GET /api/runs/{id}/log. (Fix m-2)"""
        resp = client.post(
            f"/api/runs/{disk_run_id}/feedback",
            json={"target": {"scope": "run"}, "comment": "disk persist check"},
        )
        assert resp.status_code == 201

        # Read back via the log endpoint — verifies disk persistence, not just 201
        log_resp = client.get(f"/api/runs/{disk_run_id}/log")
        assert log_resp.status_code == 200
        events = log_resp.json()["events"]
        feedback_events = [e for e in events if e.get("kind") == "feedback"]
        assert len(feedback_events) == 1
        assert feedback_events[0]["comment"] == "disk persist check"

    def test_action_scope_missing_action_returns_400(self, client, active_run_with_action):
        """action scope with tick_index but no 'action' field → 400. (Fix m-3)"""
        run_id, tick_index, _ = active_run_with_action
        resp = client.post(
            f"/api/runs/{run_id}/feedback",
            json={
                "target": {
                    "scope": "action",
                    "tick_index": tick_index,
                    # no "action" field — must be required
                },
            },
        )
        assert resp.status_code == 400
        detail = resp.json().get("detail", "")
        assert "action" in detail.lower()
