"""Backend-only end-to-end API run-loop test (T029 / US3).

M2 extension: covers all four pairings (both packages × both scenarios) via the
plan_id flow (POST /api/run-plans → POST /api/runs{plan_id} → tick → action →
GET /log), with full log-structure and determinism assertions.

Coverage:
  1. Full loop   — POST /api/runs → tick to REST_PROPOSAL → accept_rest → GET /log
  2. Determinism — two independent runs produce identical decision-trace sequences
  3. Past-end    — ticking after completion is idempotent (completed: true)
  4. Overtime decline e2e — decline → resume → complete, no further proposal
  5. All-pairings e2e (M2, T029) — all four pairings (rule_based + weighted_score ×
     friend_drive + overtime) via plan_id flow; asserts exactly one REST_PROPOSAL,
     full log structure, and per-tick raw_state/feature_groups/driver+vehicle
     updates/package_runtime_state.
  6. All-pairings determinism (M2, T029) — two runs → identical decision-trace sequences
  7. Weighted-score overtime strength (M2, T029/FR-013) — fired candidate strength is
     "gentle" or "clear", never "strong".
  8. Decline with no pending proposal → 409 (M2, T029)

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
OVERTIME_SCENARIO_ID = "uc01_overtime_driver_v0_1"
WEIGHTED_PACKAGE_ID = "rest_weighted_score_v0_1"

# Safety cap: the fixture scenario has 120 ticks total; 200 is generous.
_MAX_TICKS = 200

# M2 pairings that fire exactly one REST_PROPOSAL: (package_id, scenario_id, resolve_action)
_FIRING_PAIRINGS = [
    pytest.param(
        "rest_rule_based_v0_1", "uc01_fatigue_friend_drive_v0_1", "accept_rest",
        id="rule-friend",
    ),
    pytest.param(
        "rest_rule_based_v0_1", "uc01_overtime_driver_v0_1", "decline",
        id="rule-overtime",
    ),
    pytest.param(
        "rest_weighted_score_v0_1", "uc01_overtime_driver_v0_1", "decline",
        id="ws-overtime",
    ),
    pytest.param(
        "rest_weighted_score_v0_1", "uc01_fatigue_friend_drive_v0_1", "accept_rest",
        id="ws-friend",
    ),
]


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


# ── Helpers for overtime tests ────────────────────────────────────────────────


def _create_overtime_run(client: TestClient) -> str:
    """Create a run with the overtime scenario + rule package."""
    plan_resp = client.post(
        "/api/run-plans",
        json={
            "package_id": VALID_PACKAGE_ID,
            "scenario_id": OVERTIME_SCENARIO_ID,
            "parameters": {},
            "hyperparameters": {},
            "run_mode": "standard",
        },
    )
    assert plan_resp.status_code == 201, f"Plan creation failed: {plan_resp.json()}"
    plan_id = plan_resp.json()["plan_id"]

    resp = client.post("/api/runs", json={"plan_id": plan_id})
    assert resp.status_code == 201, f"Run creation failed: {resp.json()}"
    return resp.json()["run_id"]


def _tick_to_completion(client: TestClient, run_id: str, max_ticks: int = 200) -> list[dict]:
    """Tick until completed. Returns all tick response bodies."""
    bodies = []
    for _ in range(max_ticks):
        resp = client.post(f"/api/runs/{run_id}/tick")
        assert resp.status_code == 200
        body = resp.json()
        bodies.append(body)
        if body.get("completed"):
            return bodies
    pytest.fail(f"Run {run_id!r} did not complete within {max_ticks} ticks.")


# ── Test T028: overtime decline e2e ──────────────────────────────────────────


def test_overtime_decline_loop(client):
    """T028: overtime scenario — tick to proposal → decline → tick to end → completed.

    Verifies:
    - Exactly one REST_PROPOSAL in the run
    - Decline is recorded in the log with resulting_status='playing'
    - Run completes at route end (status=completed)
    - No further REST_PROPOSAL after decline
    """
    run_id = _create_overtime_run(client)

    # Tick until first proposal
    all_pre, paused_body = _tick_until_paused(client, run_id)

    decision = paused_body["decision"]
    assert decision is not None
    assert decision["result_type"] == "REST_PROPOSAL"

    # Decline the proposal
    decline_resp = client.post(
        f"/api/runs/{run_id}/actions",
        json={"action": "decline"},
    )
    assert decline_resp.status_code == 200
    resumed_state = decline_resp.json()
    assert resumed_state["status"] == "playing"
    assert resumed_state["pending_proposal"] is None

    # Tick to completion — no further pause expected
    post_decline_bodies = _tick_to_completion(client, run_id)

    # Must not pause again (no second proposal)
    second_pauses = [b for b in post_decline_bodies if b.get("paused") is True]
    assert len(second_pauses) == 0, (
        f"Run paused again after decline — no further proposal expected; "
        f"got {len(second_pauses)} pause(s)"
    )

    # Final state must be completed
    assert post_decline_bodies[-1].get("completed") is True

    # Verify log: exactly one REST_PROPOSAL, one decline action event
    log_resp = client.get(f"/api/runs/{run_id}/log")
    assert log_resp.status_code == 200
    log = log_resp.json()

    tick_events = [e for e in log["events"] if e.get("kind") == "tick"]
    action_events = [e for e in log["events"] if e.get("kind") == "action"]

    rest_proposals = [
        e for e in tick_events
        if e.get("trace", {}).get("decision_result", {}).get("result_type") == "REST_PROPOSAL"
    ]
    assert len(rest_proposals) == 1, (
        f"Expected exactly 1 REST_PROPOSAL in log, got {len(rest_proposals)}"
    )

    assert len(action_events) == 1
    assert action_events[0]["action"] == "decline"
    assert action_events[0]["resulting_status"] == "playing"


# ── Helpers ── plan_id flow for arbitrary package/scenario ────────────────────


def _create_run_for_pairing(
    client: TestClient, package_id: str, scenario_id: str
) -> str:
    """Create a run via the plan_id flow for any package+scenario pairing."""
    plan_resp = client.post(
        "/api/run-plans",
        json={
            "package_id": package_id,
            "scenario_id": scenario_id,
            "parameters": {},
            "hyperparameters": {},
            "run_mode": "standard",
        },
    )
    assert plan_resp.status_code == 201, (
        f"Plan creation failed for {package_id}×{scenario_id}: {plan_resp.json()}"
    )
    plan_id = plan_resp.json()["plan_id"]

    run_resp = client.post("/api/runs", json={"plan_id": plan_id})
    assert run_resp.status_code == 201, (
        f"Run creation failed for {package_id}×{scenario_id}: {run_resp.json()}"
    )
    return run_resp.json()["run_id"]


# ── T029: All-pairings e2e (M2) ───────────────────────────────────────────────


@pytest.mark.parametrize("package_id,scenario_id,resolve_action", _FIRING_PAIRINGS)
def test_all_pairings_e2e(client, package_id, scenario_id, resolve_action):
    """T029: both packages × both scenarios, via plan_id flow.

    For each of the four pairings:
    - Creates a run via POST /api/run-plans → POST /api/runs{plan_id}
    - Ticks to exactly one REST_PROPOSAL
    - Asserts the persisted log carries setup snapshot, frozen plan, per-tick M2
      fields (raw_state, feature_groups, driver_update, vehicle_update,
      package_runtime_state), and original/modified values
    - Resolves with the pairing's action and verifies log completeness
    """
    # ── Create run via plan_id flow ───────────────────────────────────────────
    run_id = _create_run_for_pairing(client, package_id, scenario_id)

    # Log persisted immediately after creation
    log_resp = client.get(f"/api/runs/{run_id}/log")
    assert log_resp.status_code == 200, "Log must be available after run creation"
    initial_log = log_resp.json()
    assert initial_log["run_id"] == run_id

    # ── Assert setup snapshot in the log ─────────────────────────────────────
    assert initial_log["snapshot"]["package"]["id"] == package_id, (
        f"Log snapshot must reference package {package_id!r}"
    )
    assert initial_log["snapshot"]["scenario"]["id"] == scenario_id, (
        f"Log snapshot must reference scenario {scenario_id!r}"
    )

    # ── Assert frozen plan fields ─────────────────────────────────────────────
    event_plan = initial_log.get("event_plan", {})
    assert event_plan.get("tick_seconds", 0) > 0, (
        "event_plan.tick_seconds must be set in the frozen plan"
    )
    assert len(event_plan.get("rest_opportunities", [])) > 0, (
        "event_plan.rest_opportunities must be non-empty in the frozen plan"
    )

    # ── Assert original/modified values present ───────────────────────────────
    assert "original_values" in initial_log, "Log must carry original_values"
    assert "modified_values" in initial_log, "Log must carry modified_values"

    # ── Tick until paused (REST_PROPOSAL fires) ───────────────────────────────
    all_bodies, paused_body = _tick_until_paused(client, run_id)

    decision = paused_body["decision"]
    assert decision is not None, "Paused tick must carry a decision"
    assert decision["result_type"] == "REST_PROPOSAL", (
        f"Expected REST_PROPOSAL at paused tick for {package_id}×{scenario_id}, "
        f"got {decision['result_type']!r}"
    )
    assert decision["proposal"] is not None, "REST_PROPOSAL must include a proposal"

    # Exactly one paused tick across the run
    paused_ticks = [b for b in all_bodies if b.get("paused") is True]
    assert len(paused_ticks) == 1, (
        f"Expected exactly one paused tick, got {len(paused_ticks)} "
        f"for {package_id}×{scenario_id}"
    )

    # ── Assert per-tick M2 fields in tick events (check first tick event) ────
    log_after_ticks = client.get(f"/api/runs/{run_id}/log").json()
    tick_events = [e for e in log_after_ticks["events"] if e.get("kind") == "tick"]
    assert len(tick_events) >= 1, "Must have at least one tick event in the log"

    first_tick = tick_events[0]
    # These keys are all required M2 TickEvent fields (may be empty dicts/default).
    for field in ("raw_state", "feature_groups", "driver_update", "vehicle_update",
                  "package_runtime_state"):
        assert field in first_tick, (
            f"TickEvent must carry {field!r} field (M2 extension); "
            f"pairing={package_id}×{scenario_id}"
        )

    # ── Resolve the proposal ──────────────────────────────────────────────────
    action_resp = client.post(
        f"/api/runs/{run_id}/actions",
        json={"action": resolve_action},
    )
    assert action_resp.status_code == 200, (
        f"Action {resolve_action!r} should succeed; got {action_resp.json()}"
    )

    # ── Verify final log completeness ─────────────────────────────────────────
    final_log = client.get(f"/api/runs/{run_id}/log").json()

    # Exactly one REST_PROPOSAL in tick events
    rest_proposals = [
        e for e in final_log["events"]
        if e.get("kind") == "tick"
        and e.get("trace", {}).get("decision_result", {}).get("result_type") == "REST_PROPOSAL"
    ]
    assert len(rest_proposals) == 1, (
        f"Expected exactly 1 REST_PROPOSAL in persisted log for {package_id}×{scenario_id}, "
        f"got {len(rest_proposals)}"
    )

    # Exactly one action event
    action_events = [e for e in final_log["events"] if e.get("kind") == "action"]
    assert len(action_events) == 1, (
        f"Expected 1 action event in log for {package_id}×{scenario_id}"
    )
    assert action_events[0]["action"] == resolve_action


# ── T029: All-pairings determinism (M2) ───────────────────────────────────────


def _tick_to_paused_or_complete(
    client: TestClient, run_id: str, max_ticks: int = 200
) -> list[dict]:
    """Tick until paused (REST_PROPOSAL) or completed. Returns all tick response bodies."""
    all_bodies: list[dict] = []
    for _ in range(max_ticks):
        resp = client.post(f"/api/runs/{run_id}/tick")
        assert resp.status_code == 200
        body = resp.json()
        all_bodies.append(body)
        if body.get("paused") is True or body.get("completed") is True:
            return all_bodies
    pytest.fail(
        f"Run {run_id!r} did not pause or complete within {max_ticks} ticks."
    )


@pytest.mark.parametrize("package_id,scenario_id,resolve_action", _FIRING_PAIRINGS)
def test_all_pairings_determinism(tmp_path, monkeypatch, package_id, scenario_id, resolve_action):
    """T029: two runs of each firing pairing → identical decision-trace sequences.

    Runs A and B are created independently with the same package+scenario.
    The per-tick (result_type, score, selected_category) sequences must match.
    """
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    client = TestClient(app)

    # Run A
    run_id_a = _create_run_for_pairing(client, package_id, scenario_id)
    all_bodies_a, _ = _tick_until_paused(client, run_id_a)
    trace_a = _extract_trace(all_bodies_a)

    # Run B — independent run, same pairing
    run_id_b = _create_run_for_pairing(client, package_id, scenario_id)
    all_bodies_b, _ = _tick_until_paused(client, run_id_b)
    trace_b = _extract_trace(all_bodies_b)

    assert len(trace_a) == len(trace_b), (
        f"Determinism failed for {package_id}×{scenario_id}: "
        f"Run A has {len(trace_a)} decisions, Run B has {len(trace_b)}"
    )

    for i, (entry_a, entry_b) in enumerate(zip(trace_a, trace_b)):
        assert entry_a == entry_b, (
            f"Tick {i} diverged for {package_id}×{scenario_id}: "
            f"Run A={entry_a!r}, Run B={entry_b!r}"
        )


# ── T029 / FR-013: weighted-score overtime proposal strength ───────────────────


def test_weighted_score_overtime_proposal_strength(client):
    """FR-013: the firing REST_PROPOSAL for weighted-score + overtime must have
    candidate strength 'gentle' or 'clear', never 'strong' (which maps to
    SEVERE_INTERVENTION, not REST_PROPOSAL).
    """
    run_id = _create_run_for_pairing(
        client, WEIGHTED_PACKAGE_ID, OVERTIME_SCENARIO_ID
    )
    all_bodies, paused_body = _tick_until_paused(client, run_id)

    decision = paused_body["decision"]
    assert decision["result_type"] == "REST_PROPOSAL", (
        f"Expected REST_PROPOSAL for ws×overtime, got {decision['result_type']!r}"
    )

    # Find the fired candidate (fire_control.fired == True)
    candidates = decision.get("candidates", [])
    fired = [c for c in candidates if c.get("fire_control", {}).get("fired") is True]
    assert len(fired) >= 1, (
        "Expected at least one fired candidate in the REST_PROPOSAL decision"
    )

    for candidate in fired:
        strength = candidate.get("strength")
        assert strength in ("gentle", "clear"), (
            f"FR-013 micro-rest requirement: fired candidate strength must be "
            f"'gentle' or 'clear', got {strength!r}; "
            f"'strong' maps to SEVERE_INTERVENTION, not REST_PROPOSAL"
        )


# ── T029: decline with no pending proposal → 409 ──────────────────────────────


def test_decline_with_no_pending_proposal_is_409(client):
    """Decline when there is no pending proposal must return 409.

    Uses the overtime scenario (where 'decline' IS in allowed_actions) but does
    not advance to a proposal, ensuring the 409 is for 'no pending proposal' and
    not for the disallowed-action case (which returns 400).
    """
    # Create an overtime run — 'decline' is in allowed_actions for this scenario
    plan_resp = client.post(
        "/api/run-plans",
        json={
            "package_id": VALID_PACKAGE_ID,
            "scenario_id": OVERTIME_SCENARIO_ID,
            "parameters": {},
            "hyperparameters": {},
            "run_mode": "standard",
        },
    )
    assert plan_resp.status_code == 201
    plan_id = plan_resp.json()["plan_id"]

    run_resp = client.post("/api/runs", json={"plan_id": plan_id})
    assert run_resp.status_code == 201
    run_id = run_resp.json()["run_id"]

    # Do NOT tick — no pending proposal
    action_resp = client.post(
        f"/api/runs/{run_id}/actions",
        json={"action": "decline"},
    )
    assert action_resp.status_code == 409, (
        f"decline with no pending proposal must return 409 (No pending proposal), "
        f"not {action_resp.status_code}: {action_resp.json()}"
    )
