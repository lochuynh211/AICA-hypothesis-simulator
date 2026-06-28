"""TDD tests for recovery API surface in /api/runs (Task 6).

Verifies:
  - GET  /api/runs/{id}/rest-spots returns deterministic fallback spots from
    route_facts.rest_spot_positions when no maps_key is supplied.
  - POST /api/runs/{id}/actions accepts recovery_option_id + rest_spot in the body.
  - POST /api/runs/{id}/tick response includes motion_state + recovery_phase fields.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry
from tests.helpers_recovery import create_paused_rest_run

client = TestClient(app)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def reset_registry():
    """Isolate each test — clear both in-memory registries before and after."""
    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_rest_spots_fallback_without_key():
    """GET /rest-spots without maps_key returns deterministic scenario-derived spots."""
    run_id = create_paused_rest_run()
    r = client.get(f"/api/runs/{run_id}/rest-spots")
    assert r.status_code == 200
    spots = r.json()["rest_spots"]
    assert len(spots) >= 1
    assert "route_fraction" in spots[0]


def test_action_body_accepts_recovery_payload():
    """POST /actions with recovery_option_id + rest_spot accepted; run resumes playing."""
    run_id = create_paused_rest_run()
    r = client.post(f"/api/runs/{run_id}/actions", json={
        "action": "accept_rest",
        "recovery_option_id": "nap_karaoke",
        "rest_spot": {"id": "p1", "label": {"ja": "SA", "en": "SA"}, "route_fraction": 0.5},
    })
    assert r.status_code == 200
    assert r.json()["status"] == "playing"


def test_tick_response_exposes_motion_and_phase():
    """POST /tick response includes motion_state and recovery_phase keys."""
    run_id = create_paused_rest_run()
    client.post(f"/api/runs/{run_id}/actions", json={
        "action": "accept_rest",
        "recovery_option_id": "nap_karaoke",
        "rest_spot": {"id": "p1", "label": {"ja": "SA", "en": "SA"}, "route_fraction": 0.5},
    })
    r = client.post(f"/api/runs/{run_id}/tick")
    body = r.json()
    assert "motion_state" in body and "recovery_phase" in body


def test_rest_spots_404_for_unknown_run():
    """GET /rest-spots returns 404 for an unknown run_id."""
    r = client.get("/api/runs/nonexistent_run_xyz/rest-spots")
    assert r.status_code == 404
