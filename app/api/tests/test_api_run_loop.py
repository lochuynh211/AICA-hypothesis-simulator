"""Backend-only end-to-end API run-loop test (T029 / US3).

Proves the full M1 loop works via the FastAPI TestClient with no frontend.
Coverage:
  1. Full loop   — POST /api/runs → tick to REST_PROPOSAL → accept_rest → GET /log
  2. Determinism — two independent runs produce identical decision-trace sequences
  3. Past-end    — ticking after completion is idempotent (completed: true)

Isolation: runs dir is redirected to tmp_path via AICA_RUNS_DIR monkeypatch;
the in-memory run registry is cleared before and after every test (autouse).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry

# ── Constants ──────────────────────────────────────────────────────────────────

VALID_PACKAGE_ID = "rest_rule_based_v0_1"
VALID_SCENARIO_ID = "uc01_fatigue_friend_drive_v0_1"

# Safety cap: the fixture scenario has 120 ticks total; 200 is generous.
_MAX_TICKS = 200


# ── Fixtures ───────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def reset_run_registry():
    """Isolate every test — clear both in-memory registries before and after."""
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


# ── Helpers ────────────────────────────────────────────────────────────────────


def _create_run(client: TestClient) -> str:
    """Create a run plan then a run via the plan flow; return the run_id."""
    # Step 1: Create run plan
    plan_resp = client.post(
        "/api/run-plans",
        json={
            "package_id": VALID_PACKAGE_ID,
            "scenario_id": VALID_SCENARIO_ID,
            "parameters": {},
            "hyperparameters": {},
            "run_mode": "standard",
        },
    )
    assert plan_resp.status_code == 201, f"Plan creation failed: {plan_resp.json()}"
    plan_id = plan_resp.json()["plan_id"]

    # Step 2: Create run from plan
    resp = client.post("/api/runs", json={"plan_id": plan_id})
    assert resp.status_code == 201, f"Run creation failed: {resp.json()}"
    return resp.json()["run_id"]


def _tick_until_paused(
    client: TestClient, run_id: str
) -> tuple[list[dict], dict]:
    """POST /tick repeatedly until a response has paused=True.

    Returns:
        all_bodies   — every tick response body (including the paused one)
        paused_body  — the last (paused) body, for convenient access
    """
    all_bodies: list[dict] = []
    for _ in range(_MAX_TICKS):
        resp = client.post(f"/api/runs/{run_id}/tick")
        assert resp.status_code == 200
        body = resp.json()
        all_bodies.append(body)
        if body.get("paused") is True:
            return all_bodies, body
    pytest.fail(
        f"Run {run_id!r} did not pause within {_MAX_TICKS} ticks — "
        "REST_PROPOSAL never fired."
    )


def _extract_trace(tick_bodies: list[dict]) -> list[dict]:
    """Extract a comparable, timestamp-free decision trace from tick response bodies.

    Returns a list of ``{result_type, score, selected_category}`` dicts, one
    per tick that produced a decision (algorithm_error ticks have no decision
    and are skipped).
    """
    return [
        {
            "result_type": body["decision"]["result_type"],
            "score": body["decision"]["score"],
            "selected_category": body["decision"]["selected_category"],
        }
        for body in tick_bodies
        if body.get("decision") is not None
    ]


# ── Test 1: Full loop (FR-014, SC-002, SC-004) ────────────────────────────────


def test_full_loop(client):
    """Full M1 loop: create → tick to REST_PROPOSAL → accept_rest → verify log."""

    # ── 1a. Create run ────────────────────────────────────────────────────────
    run_id = _create_run(client)

    # Log file must be persisted immediately after creation.
    log_resp = client.get(f"/api/runs/{run_id}/log")
    assert log_resp.status_code == 200
    assert log_resp.json()["run_id"] == run_id

    # ── 1b. Tick until paused (REST_PROPOSAL must fire) ───────────────────────
    all_bodies, paused_body = _tick_until_paused(client, run_id)

    # The paused tick must carry a REST_PROPOSAL decision with a proposal object.
    decision = paused_body["decision"]
    assert decision is not None, "Paused tick must include a decision"
    assert decision["result_type"] == "REST_PROPOSAL", (
        f"Expected REST_PROPOSAL at paused tick, got {decision['result_type']!r}"
    )
    assert decision["proposal"] is not None, "REST_PROPOSAL must include a proposal"

    # Exactly ONE tick must have been paused (SC-002: only one proposal in the loop).
    paused_ticks = [b for b in all_bodies if b.get("paused") is True]
    assert len(paused_ticks) == 1, (
        f"Expected exactly one paused tick, got {len(paused_ticks)}"
    )

    # All ticks before the proposal must be NO_TRIGGER or SOFT_WARNING (SC-002).
    pre_proposal_bodies = all_bodies[:-1]
    for i, body in enumerate(pre_proposal_bodies):
        pre_decision = body.get("decision")
        if pre_decision is None:
            continue  # algorithm_error tick — allowed, not a proposal
        assert pre_decision["result_type"] in ("NO_TRIGGER", "SOFT_WARNING"), (
            f"Tick {i} before proposal should be NO_TRIGGER or SOFT_WARNING, "
            f"got {pre_decision['result_type']!r}"
        )

    # ── 1c. Accept the rest proposal ─────────────────────────────────────────
    action_resp = client.post(
        f"/api/runs/{run_id}/actions",
        json={"action": "accept_rest"},
    )
    assert action_resp.status_code == 200
    updated_state = action_resp.json()
    assert updated_state["status"] == "completed"
    assert updated_state["pending_proposal"] is None

    # ── 1d. GET /log — must contain tick trace AND action event (SC-004) ──────
    log_resp = client.get(f"/api/runs/{run_id}/log")
    assert log_resp.status_code == 200
    log = log_resp.json()

    events = log["events"]
    tick_events = [e for e in events if e.get("kind") == "tick"]
    action_events = [e for e in events if e.get("kind") == "action"]

    # At least one tick event, each with a trace containing a decision_result.
    assert len(tick_events) >= 1, "Log must contain tick events"
    for evt in tick_events:
        assert "trace" in evt, "Every tick event must carry a trace"
        assert "decision_result" in evt["trace"], (
            "Every trace must contain a decision_result"
        )

    # Exactly one action event with the expected fields.
    assert len(action_events) == 1, "Log must contain exactly one action event"
    assert action_events[0]["action"] == "accept_rest"
    assert action_events[0]["resulting_status"] == "completed"


# ── Test 2: Determinism (SC-003) ──────────────────────────────────────────────


def test_determinism(tmp_path, monkeypatch):
    """Two independent runs of the same package+scenario produce identical traces.

    Each run is created, ticked to REST_PROPOSAL, and the per-tick
    (result_type, score, selected_category) sequences are compared.
    Timestamps and run_ids are excluded from the comparison.
    """
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    client = TestClient(app)

    # Run A
    run_id_a = _create_run(client)
    all_bodies_a, _ = _tick_until_paused(client, run_id_a)
    trace_a = _extract_trace(all_bodies_a)

    # Run B — separate run, same fixture identifiers
    run_id_b = _create_run(client)
    all_bodies_b, _ = _tick_until_paused(client, run_id_b)
    trace_b = _extract_trace(all_bodies_b)

    # Sequences must be the same length.
    assert len(trace_a) == len(trace_b), (
        f"Run A produced {len(trace_a)} decisions; Run B produced {len(trace_b)}"
    )

    # Every per-tick entry must be identical.
    for i, (entry_a, entry_b) in enumerate(zip(trace_a, trace_b)):
        assert entry_a == entry_b, (
            f"Tick {i} diverged between the two runs: "
            f"Run A={entry_a!r}, Run B={entry_b!r}"
        )


# ── Test 3: Ticking past end is idempotent (SC-006) ──────────────────────────


def test_tick_past_end_is_idempotent(client):
    """After accept_rest (status=completed), further ticks return completed=True idempotently."""

    run_id = _create_run(client)

    # Advance to proposal and resolve it.
    _tick_until_paused(client, run_id)
    action_resp = client.post(
        f"/api/runs/{run_id}/actions",
        json={"action": "accept_rest"},
    )
    assert action_resp.status_code == 200
    assert action_resp.json()["status"] == "completed"

    # First tick after completion must return completed=True.
    resp1 = client.post(f"/api/runs/{run_id}/tick")
    assert resp1.status_code == 200
    body1 = resp1.json()
    assert body1.get("completed") is True, (
        "First tick after completion must return completed=True"
    )

    # Second tick must also return completed=True (idempotent).
    resp2 = client.post(f"/api/runs/{run_id}/tick")
    assert resp2.status_code == 200
    body2 = resp2.json()
    assert body2.get("completed") is True, (
        "Subsequent ticks must remain completed=True"
    )

    # current_tick must not advance between the two completed-state ticks.
    assert body1["run_state"]["current_tick"] == body2["run_state"]["current_tick"], (
        "current_tick must not advance once the run is completed"
    )
