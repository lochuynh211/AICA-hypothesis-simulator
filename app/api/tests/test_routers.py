"""Router contract tests (T020) — FastAPI TestClient, no docker required.

Covers:
  - GET /api/packages          list + errors envelope
  - GET /api/packages/{id}     detail + 404
  - GET /api/scenarios         list + errors envelope
  - GET /api/scenarios/{id}    detail + 404
  - POST /api/runs             201 with valid fixtures; 400 for bad pairing
  - POST /api/runs/{id}/tick   200 envelope (run_state, decision, paused, completed)
  - GET  /api/runs/{id}/log    200 persisted JSON
  - POST /api/runs/{id}/actions 409 when no proposal pending

Uses monkeypatch of AICA_RUNS_DIR so tests never litter the repo's runs/ dir.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app
from aica_api.services.run_manager import clear_registry

# ── Constants ─────────────────────────────────────────────────────────────────

VALID_PACKAGE_ID = "rest_rule_based_v0_1"
VALID_SCENARIO_ID = "uc01_fatigue_friend_drive_v0_1"


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def reset_run_registry():
    """Isolate every test — clear the in-memory run registry before and after."""
    clear_registry()
    yield
    clear_registry()


@pytest.fixture
def client(tmp_path, monkeypatch):
    """TestClient with runs dir redirected to a temp directory."""
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    return TestClient(app)


@pytest.fixture
def run_id(client) -> str:
    """Create a run and return its run_id."""
    resp = client.post(
        "/api/runs",
        json={"package_id": VALID_PACKAGE_ID, "scenario_id": VALID_SCENARIO_ID},
    )
    assert resp.status_code == 201
    return resp.json()["run_id"]


# ── Package endpoint tests ────────────────────────────────────────────────────


def test_list_packages_returns_envelope(client):
    """GET /api/packages returns {packages: [...], errors: [...]}."""
    resp = client.get("/api/packages")
    assert resp.status_code == 200
    body = resp.json()
    assert "packages" in body
    assert "errors" in body
    assert isinstance(body["packages"], list)
    assert isinstance(body["errors"], list)


def test_list_packages_contains_fixture(client):
    """The valid fixture package appears in the summaries."""
    resp = client.get("/api/packages")
    ids = [p["id"] for p in resp.json()["packages"]]
    assert VALID_PACKAGE_ID in ids


def test_get_package_valid(client):
    """GET /api/packages/{id} returns the full manifest for a valid id."""
    resp = client.get(f"/api/packages/{VALID_PACKAGE_ID}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == VALID_PACKAGE_ID


def test_get_package_not_found(client):
    """GET /api/packages/{id} returns 404 for an unknown id."""
    resp = client.get("/api/packages/no_such_package")
    assert resp.status_code == 404


# ── Scenario endpoint tests ───────────────────────────────────────────────────


def test_list_scenarios_returns_envelope(client):
    """GET /api/scenarios returns {scenarios: [...], errors: [...]}."""
    resp = client.get("/api/scenarios")
    assert resp.status_code == 200
    body = resp.json()
    assert "scenarios" in body
    assert "errors" in body
    assert isinstance(body["scenarios"], list)
    assert isinstance(body["errors"], list)


def test_list_scenarios_contains_fixture(client):
    """The valid fixture scenario appears in the summaries."""
    resp = client.get("/api/scenarios")
    ids = [s["id"] for s in resp.json()["scenarios"]]
    assert VALID_SCENARIO_ID in ids


def test_get_scenario_valid(client):
    """GET /api/scenarios/{id} returns the full scenario def for a valid id."""
    resp = client.get(f"/api/scenarios/{VALID_SCENARIO_ID}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == VALID_SCENARIO_ID


def test_get_scenario_not_found(client):
    """GET /api/scenarios/{id} returns 404 for an unknown id."""
    resp = client.get("/api/scenarios/no_such_scenario")
    assert resp.status_code == 404


# ── Run creation tests ────────────────────────────────────────────────────────


def test_create_run_201(client):
    """POST /api/runs with valid ids → 201 + RunState."""
    resp = client.post(
        "/api/runs",
        json={"package_id": VALID_PACKAGE_ID, "scenario_id": VALID_SCENARIO_ID},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert "run_id" in body
    assert body["run_id"].startswith("run_")
    assert body["status"] == "created"
    # RunState must include frozen snapshot, event_plan, route_facts
    assert "snapshot" in body
    assert "event_plan" in body
    assert "route_facts" in body


def test_create_run_bad_package(client):
    """POST /api/runs with an invalid package_id → 400."""
    resp = client.post(
        "/api/runs",
        json={"package_id": "no_such_pkg", "scenario_id": VALID_SCENARIO_ID},
    )
    assert resp.status_code == 400


def test_create_run_bad_scenario(client):
    """POST /api/runs with an invalid scenario_id → 400."""
    resp = client.post(
        "/api/runs",
        json={"package_id": VALID_PACKAGE_ID, "scenario_id": "no_such_scenario"},
    )
    assert resp.status_code == 400


# ── Tick tests ────────────────────────────────────────────────────────────────


def test_tick_returns_envelope(client, run_id):
    """POST /api/runs/{id}/tick returns {run_state, decision, paused, completed}."""
    resp = client.post(f"/api/runs/{run_id}/tick")
    assert resp.status_code == 200
    body = resp.json()
    assert "run_state" in body
    # Normal tick: has decision, paused, completed
    assert "paused" in body or "error" in body


def test_tick_unknown_run(client):
    """POST /api/runs/{id}/tick → 404 for unknown run."""
    resp = client.post("/api/runs/no_such_run/tick")
    assert resp.status_code == 404


def test_tick_normal_envelope_fields(client, run_id):
    """Normal tick envelope has run_state, decision, paused, completed."""
    resp = client.post(f"/api/runs/{run_id}/tick")
    assert resp.status_code == 200
    body = resp.json()
    # Only check for standard fields; algorithm errors would show 'error' instead
    if "error" not in body:
        assert "decision" in body
        assert "paused" in body
        assert "completed" in body


# ── Run listing and detail tests ──────────────────────────────────────────────


def test_list_runs_empty(client):
    """GET /api/runs with no runs returns {runs: []}."""
    resp = client.get("/api/runs")
    assert resp.status_code == 200
    body = resp.json()
    assert "runs" in body
    assert isinstance(body["runs"], list)


def test_list_runs_after_create(client, run_id):
    """GET /api/runs returns the created run in the list."""
    resp = client.get("/api/runs")
    assert resp.status_code == 200
    run_ids = [r["run_id"] for r in resp.json()["runs"]]
    assert run_id in run_ids


def test_list_runs_entry_shape(client, run_id):
    """Each entry in /api/runs has the required summary fields."""
    resp = client.get("/api/runs")
    runs = resp.json()["runs"]
    entry = next(r for r in runs if r["run_id"] == run_id)
    assert "created_at" in entry
    assert entry["package_id"] == VALID_PACKAGE_ID
    assert entry["scenario_id"] == VALID_SCENARIO_ID
    assert "status" in entry


def test_get_run_detail(client, run_id):
    """GET /api/runs/{id} returns current RunState."""
    resp = client.get(f"/api/runs/{run_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["run_id"] == run_id


def test_get_run_detail_not_found(client):
    """GET /api/runs/{id} → 404 for unknown run."""
    resp = client.get("/api/runs/no_such_run")
    assert resp.status_code == 404


# ── Run log tests ─────────────────────────────────────────────────────────────


def test_get_run_log(client, run_id):
    """GET /api/runs/{id}/log returns the persisted RunLog JSON."""
    resp = client.get(f"/api/runs/{run_id}/log")
    assert resp.status_code == 200
    body = resp.json()
    # RunLog fields
    assert body["run_id"] == run_id
    assert "created_at" in body
    assert "snapshot" in body
    assert "events" in body


def test_get_run_log_contains_tick_after_tick(client, run_id):
    """After one tick, the log contains one tick event."""
    client.post(f"/api/runs/{run_id}/tick")
    resp = client.get(f"/api/runs/{run_id}/log")
    assert resp.status_code == 200
    events = resp.json()["events"]
    tick_events = [e for e in events if e.get("kind") in ("tick", "algorithm_error")]
    assert len(tick_events) >= 1


def test_get_run_log_not_found(client):
    """GET /api/runs/{id}/log → 404 for unknown run."""
    resp = client.get("/api/runs/no_such_run/log")
    assert resp.status_code == 404


# ── Action tests ──────────────────────────────────────────────────────────────


def test_action_409_when_no_proposal(client, run_id):
    """POST /api/runs/{id}/actions → 409 when run has no pending proposal (status=created)."""
    resp = client.post(
        f"/api/runs/{run_id}/actions",
        json={"action": "accept_rest"},
    )
    assert resp.status_code == 409


def test_action_404_unknown_run(client):
    """POST /api/runs/{id}/actions → 404 for unknown run."""
    resp = client.post(
        "/api/runs/no_such_run/actions",
        json={"action": "accept_rest"},
    )
    assert resp.status_code == 404
