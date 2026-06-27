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

import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aica_api.algorithms.adapter import AlgorithmAdapterError
from aica_api.main import app
from aica_api.models.decision import (
    Candidate,
    DecisionResult,
    FireControl,
    Proposal,
    ResultType,
)
from aica_api.services.run_manager import clear_registry

_REPO_ROOT = Path(__file__).resolve().parents[3]

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
    """Normal tick envelope has all four fields: run_state, decision, paused, completed."""
    resp = client.post(f"/api/runs/{run_id}/tick")
    assert resp.status_code == 200
    body = resp.json()
    assert "run_state" in body
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


# ── Fix 2: incompatible-pairing 400 ──────────────────────────────────────────


def test_create_run_incompatible_scenario_400(tmp_path, monkeypatch):
    """POST /api/runs with a scenario whose type is not in compatible_scenario_types → 400."""
    scenarios_dir = tmp_path / "scenarios"
    scenarios_dir.mkdir()
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()

    # Copy the standard valid scenario so the registry can load it
    src = _REPO_ROOT / "scenarios" / "uc01_fatigue_friend_drive_v0_1.json"
    shutil.copy(src, scenarios_dir / "uc01_fatigue_friend_drive_v0_1.json")

    # Write a minimal but valid ScenarioDef with an incompatible type
    incompat = {
        "id": "uc99_incompat_test_v0_1",
        "version": "0.1.0",
        "type": "uc99_other",
        "persona": {"name": "Test Driver", "description": ""},
        "route_intent": {
            "rest_facility": {"label": {"en": "Test Stop"}},
            "segments": [
                {
                    "id": "seg_start", "name": {"en": "Start"},
                    "type": "start", "at": 0.0,
                    "speed_band": "low", "length_band": "short",
                    "is_rest_facility": False,
                },
                {
                    "id": "seg_rest", "name": {"en": "Rest"},
                    "type": "rest", "at": 0.5,
                    "speed_band": "low", "length_band": "short",
                    "is_rest_facility": True,
                },
                {
                    "id": "seg_end", "name": {"en": "End"},
                    "type": "end", "at": 1.0,
                    "speed_band": "low", "length_band": "short",
                    "is_rest_facility": False,
                },
            ],
        },
        "initial_state": {},
        "event_presets": {
            "drowsiness_schedule": [{"at": 0.0, "band": "none"}],
            "signal_duration_at_trigger": "brief",
        },
        "total_duration_seconds": 3600,
        "tick_seconds": 60,
        "allowed_actions": ["accept_rest"],
        "review_focus": "",
    }
    (scenarios_dir / "uc99_incompat_test_v0_1.json").write_text(
        json.dumps(incompat), encoding="utf-8"
    )

    monkeypatch.setenv("AICA_SCENARIOS_DIR", str(scenarios_dir))
    monkeypatch.setenv("AICA_RUNS_DIR", str(runs_dir))

    test_client = TestClient(app)
    resp = test_client.post(
        "/api/runs",
        json={"package_id": VALID_PACKAGE_ID, "scenario_id": "uc99_incompat_test_v0_1"},
    )
    assert resp.status_code == 400
    # Confirm no run log was persisted
    assert list(runs_dir.glob("*.json")) == []


# ── Fix 3: action 400 (disallowed action) ────────────────────────────────────


def _make_fired_proposal_result() -> DecisionResult:
    """Build a DecisionResult that fires a REST_PROPOSAL (for test setup)."""
    proposal = Proposal(
        id="rest_guidance",
        message={"en": "Test proposal — take a rest."},
        options=["accept_rest", "postpone"],
    )
    fc_fired = FireControl(fired=True, suppressed=False, override=False, reason="test")
    candidate = Candidate(
        category="rest_required",
        exists=True,
        score=3.5,
        state=None,
        strength="clear",
        fire_control=fc_fired,
    )
    return DecisionResult(
        result_type=ResultType.REST_PROPOSAL,
        trigger_candidate=True,
        selected_category="rest_required",
        score=3.5,
        features={"drowsiness_level": "strong"},
        criteria={"reaction_point": 1.8, "proposal_cut": 3.0, "severe_cut": 4.0},
        candidates=[candidate],
        fire_control=fc_fired,
        proposal=proposal,
        reason_inputs=["drowsiness_level"],
        explanation="Forced proposal for test.",
    )


def test_action_400_disallowed_action(client, run_id, monkeypatch):
    """POST /actions with a disallowed action on a paused run → 400."""
    # Force the adapter to return a fired proposal so the run becomes paused
    fired_result = _make_fired_proposal_result()
    monkeypatch.setattr(
        "aica_api.algorithms.adapter.evaluate",
        lambda *a, **kw: fired_result,
    )

    # Tick once — should pause the run with a pending proposal
    tick_resp = client.post(f"/api/runs/{run_id}/tick")
    assert tick_resp.status_code == 200
    tick_body = tick_resp.json()
    assert tick_body["paused"] is True

    # Now submit a disallowed action
    resp = client.post(
        f"/api/runs/{run_id}/actions",
        json={"action": "demolish"},
    )
    assert resp.status_code == 400


# ── Fix 4: algorithm-error tick envelope (FR-011) ────────────────────────────


def test_tick_algorithm_error_envelope(client, run_id, monkeypatch):
    """Adapter failure → 200 with {run_state, error, paused: false}; log has algorithm_error."""
    # Force the adapter to raise AlgorithmAdapterError
    def _raise(*a, **kw):
        raise AlgorithmAdapterError(
            error_type="algorithm_exception",
            message="Simulated adapter failure for test",
        )

    monkeypatch.setattr("aica_api.algorithms.adapter.evaluate", _raise)

    resp = client.post(f"/api/runs/{run_id}/tick")
    assert resp.status_code == 200
    body = resp.json()

    # Envelope must have run_state, error, and paused=False
    assert "run_state" in body
    assert "error" in body
    assert body["paused"] is False

    # The persisted log must contain an algorithm_error event
    log_resp = client.get(f"/api/runs/{run_id}/log")
    assert log_resp.status_code == 200
    events = log_resp.json()["events"]
    error_events = [e for e in events if e.get("kind") == "algorithm_error"]
    assert len(error_events) >= 1
    assert error_events[0]["error_type"] == "algorithm_exception"
